import axios from 'axios';
import { HubSpotSyncError } from './hubspotErrors.js';

const HUBSPOT_CONTACTS_URL = 'https://api.hubapi.com/crm/v3/objects/contacts';
const HUBSPOT_CONTACT_SEARCH_URL = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
const HUBSPOT_CONTACT_PROPERTIES_URL = 'https://api.hubapi.com/crm/v3/properties/contacts';

const WORKSHOP_DATE_PROPERTIES = new Set([
  'class_date',
  'choose_the_2nd_date_for_your_career_readiness_class_work',
  'choose_the_3rd_date_for_your_career_readiness_class_work',
]);

const REQUIRED_WORKSHOP_DATE_PROPERTIES = new Set([
  'choose_the_2nd_date_for_your_career_readiness_class_work',
  'choose_the_3rd_date_for_your_career_readiness_class_work',
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

function getPropertyDefinitionCache(config) {
  if (!config.propertyDefinitionCache) {
    config.propertyDefinitionCache = new Map();
  }
  return config.propertyDefinitionCache;
}

async function getPropertyDefinition(name, config) {
  const cache = getPropertyDefinitionCache(config);
  if (cache.has(name)) {
    return cache.get(name);
  }

  const response = await axios.get(
    `${HUBSPOT_CONTACT_PROPERTIES_URL}/${encodeURIComponent(name)}`,
    config
  );
  cache.set(name, response.data);
  return response.data;
}

function findEnumerationOptionForDate(options, dateISO) {
  const target = normalizeDateString(dateISO);

  return options.find((option) => {
    const candidates = [option.value, option.label].filter(Boolean);
    return candidates.some((candidate) => normalizeDateString(candidate) === target);
  });
}

async function formatWorkshopDateProperty(name, rawValue, config) {
  const dateISO = normalizeDateString(rawValue);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    throw new HubSpotSyncError(`Invalid date value for ${name}: ${rawValue}`, {
      step: 'hubspot_date_format',
      attemptedPayload: { [name]: rawValue },
    });
  }

  const definition = await getPropertyDefinition(name, config);

  if (definition.type === 'date') {
    return toHubSpotDateValue(dateISO);
  }

  if (definition.type === 'enumeration') {
    const match = findEnumerationOptionForDate(definition.options || [], dateISO);

    if (!match) {
      throw new HubSpotSyncError(
        `No HubSpot dropdown option matches ${dateISO} for ${name}`,
        {
          step: 'hubspot_enumeration_match',
          attemptedPayload: {
            [name]: dateISO,
            availableOptions: (definition.options || []).map((option) => ({
              label: option.label,
              value: option.value,
            })),
          },
        }
      );
    }

    return match.value;
  }

  throw new HubSpotSyncError(
    `Property ${name} must be a HubSpot date or dropdown field, but it is ${definition.type}`,
    {
      step: 'hubspot_property_type',
      attemptedPayload: {
        [name]: dateISO,
        propertyType: definition.type,
        fieldType: definition.fieldType,
      },
    }
  );
}

async function formatPropertiesForHubSpot(properties, config) {
  const formatted = {};

  for (const [name, value] of Object.entries(properties)) {
    if (WORKSHOP_DATE_PROPERTIES.has(name)) {
      formatted[name] = await formatWorkshopDateProperty(name, value, config);
    } else {
      formatted[name] = value;
    }
  }

  return formatted;
}

function buildHubSpotSyncError(err, step, attemptedPayload) {
  const hubspot = err?.response?.data || null;

  return new HubSpotSyncError(hubspot?.message || err.message || 'HubSpot sync failed', {
    step,
    status: err?.response?.status || null,
    hubspot,
    hubspotErrors: hubspot?.errors || [],
    attemptedPayload,
    cause: err,
  });
}

async function syncContactProperties(properties, config, existingContactId = null) {
  if (existingContactId) {
    const response = await axios.patch(
      `${HUBSPOT_CONTACTS_URL}/${existingContactId}`,
      { properties },
      config
    );
    return { response, syncedProperties: properties };
  }

  const response = await axios.post(
    HUBSPOT_CONTACTS_URL,
    { properties },
    config
  );
  return { response, syncedProperties: properties };
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

  const cleanedProperties = cleanProperties(properties);
  let payloadProperties;

  try {
    payloadProperties = await formatPropertiesForHubSpot(cleanedProperties, config);
  } catch (err) {
    if (err instanceof HubSpotSyncError) {
      throw err;
    }
    throw buildHubSpotSyncError(err, 'hubspot_property_format', cleanedProperties);
  }

  for (const name of REQUIRED_WORKSHOP_DATE_PROPERTIES) {
    if (cleanedProperties[name] && !payloadProperties[name]) {
      throw new HubSpotSyncError(`Required HubSpot property ${name} was not formatted`, {
        step: 'hubspot_required_property',
        attemptedPayload: cleanedProperties,
      });
    }
  }

  let existingContact = null;

  try {
    existingContact =
      (await findContactByEmail(properties.email, config)) ||
      (await findContactByName(properties.firstname, properties.lastname, config));
  } catch (err) {
    throw buildHubSpotSyncError(err, 'hubspot_contact_search', payloadProperties);
  }

  try {
    const { response, syncedProperties } = await syncContactProperties(
      payloadProperties,
      config,
      existingContact?.id || null
    );

    return {
      action: existingContact ? 'updated' : 'created',
      contact: response.data,
      syncedProperties,
    };
  } catch (err) {
    throw buildHubSpotSyncError(err, 'hubspot_contact_write', payloadProperties);
  }
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
    'choose_the_2nd_date_for_your_career_readiness_class_work',
    'choose_the_3rd_date_for_your_career_readiness_class_work',
    'what_is_your_racial_and_ethnic_identity_',
  ];

  const properties = {};

  for (const name of propertyNames) {
    try {
      const response = await getPropertyDefinition(name, config);
      properties[name] = {
        exists: true,
        type: response.type,
        fieldType: response.fieldType,
        label: response.label,
        options: (response.options || []).map((option) => ({
          label: option.label,
          value: option.value,
        })),
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
