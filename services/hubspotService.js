import axios from 'axios';
import { HubSpotSyncError } from './hubspotErrors.js';

const HUBSPOT_CONTACTS_URL = 'https://api.hubapi.com/crm/v3/objects/contacts';
const HUBSPOT_CONTACT_SEARCH_URL = 'https://api.hubapi.com/crm/v3/objects/contacts/search';

// Custom + mapped date fields — all use the same HubSpot date format as class_date.
const HUBSPOT_DATE_PROPERTIES = new Set([
  'class_date',
  'choose_your_2nd_date_for_career_readiness',
  'choose_your_3rd_date_for_career_readiness',
]);

function getAccessToken() {
  return process.env.HUBSPOT_ACCESS_TOKEN || process.env.ACCESS_TOKEN;
}

function cleanProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function normalizeDateString(rawValue) {
  const s = String(rawValue).trim();
  const usFormat = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);

  if (/^\d+$/.test(s)) {
    return new Date(Number(s)).toISOString().slice(0, 10);
  }

  if (usFormat) {
    return `${usFormat[3]}-${usFormat[1].padStart(2, '0')}-${usFormat[2].padStart(2, '0')}`;
  }

  return s.slice(0, 10);
}

function toHubSpotDateValue(rawValue) {
  const dateISO = normalizeDateString(rawValue);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    return rawValue;
  }

  const [year, month, day] = dateISO.split('-').map(Number);
  return String(Date.UTC(year, month - 1, day));
}

function formatPropertiesForHubSpot(properties) {
  const formatted = {};

  for (const [name, value] of Object.entries(properties)) {
    if (HUBSPOT_DATE_PROPERTIES.has(name)) {
      formatted[name] = toHubSpotDateValue(value);
    } else {
      formatted[name] = value;
    }
  }

  return formatted;
}

function buildHubSpotSyncError(err, step, attemptedPayload, skippedProperties = []) {
  const hubspot = err?.response?.data || null;

  return new HubSpotSyncError(hubspot?.message || err.message || 'HubSpot sync failed', {
    step,
    status: err?.response?.status || null,
    hubspot,
    hubspotErrors: hubspot?.errors || [],
    attemptedPayload,
    skippedProperties,
    cause: err,
  });
}

function getInvalidPropertyNames(error) {
  const names = new Set();
  const haystack = JSON.stringify(error?.response?.data || {});

  for (const entry of error?.response?.data?.errors || []) {
    for (const name of entry?.context?.propertyName || []) {
      names.add(name);
    }

    const match = entry?.message?.match(/Property "([^"]+)"/i);
    if (match) {
      names.add(match[1]);
    }
  }

  const topLevelMatch = error?.response?.data?.message?.match(/Property "([^"]+)"/i);
  if (topLevelMatch) {
    names.add(topLevelMatch[1]);
  }

  for (const name of HUBSPOT_DATE_PROPERTIES) {
    if (haystack.includes(name)) {
      names.add(name);
    }
  }

  return [...names];
}

async function syncContactProperties(properties, config, existingContactId = null) {
  let payloadProperties = { ...properties };
  const skippedProperties = [];
  const dateFormatFallback = new Set();
  let lastError = null;

  while (true) {
    try {
      if (existingContactId) {
        const response = await axios.patch(
          `${HUBSPOT_CONTACTS_URL}/${existingContactId}`,
          { properties: payloadProperties },
          config
        );
        return { response, syncedProperties: payloadProperties, skippedProperties };
      }

      const response = await axios.post(
        HUBSPOT_CONTACTS_URL,
        { properties: payloadProperties },
        config
      );
      return { response, syncedProperties: payloadProperties, skippedProperties };
    } catch (err) {
      lastError = err;
      console.error('[HubSpot] Contact sync attempt failed:', JSON.stringify(err.response?.data || err.message, null, 2));
      const invalidProperties = getInvalidPropertyNames(err);
      let retriedDateFormat = false;

      for (const name of invalidProperties) {
        if (
          HUBSPOT_DATE_PROPERTIES.has(name) &&
          name in payloadProperties &&
          !dateFormatFallback.has(name) &&
          /^\d+$/.test(String(payloadProperties[name]))
        ) {
          payloadProperties[name] = normalizeDateString(payloadProperties[name]);
          dateFormatFallback.add(name);
          retriedDateFormat = true;
          console.warn(`[HubSpot] Retrying ${name} with YYYY-MM-DD format`);
        }
      }

      if (retriedDateFormat) {
        continue;
      }

      const removable = invalidProperties.filter((name) => name in payloadProperties);

      if (!removable.length) {
        throw buildHubSpotSyncError(err, 'hubspot_contact_write', properties, skippedProperties);
      }

      for (const name of removable) {
        skippedProperties.push(name);
        delete payloadProperties[name];
        console.warn(`[HubSpot] Skipping invalid property and retrying: ${name}`);
      }

      if (!Object.keys(payloadProperties).length) {
        throw buildHubSpotSyncError(lastError, 'hubspot_contact_write', properties, skippedProperties);
      }
    }
  }
}

async function findContactByEmail(email, config) {
  const response = await axios.post(
    HUBSPOT_CONTACT_SEARCH_URL,
    {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'email',
              operator: 'EQ',
              value: email,
            },
          ],
        },
      ],
      properties: ['email'],
      limit: 1,
    },
    config
  );

  return response.data.results?.[0] || null;
}

async function findContactByName(firstname, lastname, config) {
  if (!firstname || !lastname) return null;

  const response = await axios.post(
    HUBSPOT_CONTACT_SEARCH_URL,
    {
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'firstname',
              operator: 'EQ',
              value: firstname,
            },
            {
              propertyName: 'lastname',
              operator: 'EQ',
              value: lastname,
            },
          ],
        },
      ],
      properties: ['email', 'firstname', 'lastname'],
      limit: 2,
    },
    config
  );

  if (response.data.results.length === 1) {
    return response.data.results[0];
  }

  if (response.data.results.length > 1) {
    console.warn(`Multiple HubSpot contacts found for name: ${firstname} ${lastname}. Creating a new contact instead.`);
  }

  return null;
}

export async function upsertHubSpotContact(properties) {
  const accessToken = getAccessToken();

  if (!accessToken) {
    throw new HubSpotSyncError('HubSpot access token is not configured', {
      step: 'hubspot_config',
      attemptedPayload: properties,
    });
  }

  if (!properties.email) {
    throw new HubSpotSyncError('Email is required to sync a HubSpot contact', {
      step: 'hubspot_validation',
      attemptedPayload: properties,
    });
  }

  const config = {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };

  const payloadProperties = formatPropertiesForHubSpot(cleanProperties(properties));

  let existingContact = null;

  try {
    existingContact =
      (await findContactByEmail(properties.email, config)) ||
      (await findContactByName(properties.firstname, properties.lastname, config));
  } catch (err) {
    throw buildHubSpotSyncError(err, 'hubspot_contact_search', payloadProperties);
  }

  const { response, syncedProperties, skippedProperties } = await syncContactProperties(
    payloadProperties,
    config,
    existingContact?.id || null
  );

  return {
    action: existingContact ? 'updated' : 'created',
    contact: response.data,
    syncedProperties,
    skippedProperties,
  };
}

export async function inspectHubSpotSetup() {
  const accessToken = getAccessToken();

  if (!accessToken) {
    return {
      ok: false,
      step: 'hubspot_config',
      detail: 'HubSpot access token is not configured',
    };
  }

  const config = {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };

  const propertyNames = [
    'class_date',
    'choose_your_2nd_date_for_career_readiness',
    'choose_your_3rd_date_for_career_readiness',
    'what_is_your_racial_and_ethnic_identity_',
  ];

  const properties = {};

  for (const name of propertyNames) {
    try {
      const response = await axios.get(
        `https://api.hubapi.com/crm/v3/properties/contacts/${encodeURIComponent(name)}`,
        config
      );
      properties[name] = {
        exists: true,
        type: response.data.type,
        fieldType: response.data.fieldType,
        label: response.data.label,
      };
    } catch (err) {
      properties[name] = {
        exists: false,
        status: err.response?.status || null,
        detail: err.response?.data?.message || err.message,
      };
    }
  }

  return {
    ok: true,
    tokenConfigured: true,
    properties,
  };
}
