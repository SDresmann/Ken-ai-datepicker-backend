import axios from 'axios';
import { HubSpotSyncError } from './hubspotErrors.js';

const HUBSPOT_CONTACTS_URL = 'https://api.hubapi.com/crm/v3/objects/contacts';
const HUBSPOT_CONTACT_SEARCH_URL = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
const HUBSPOT_CONTACT_PROPERTIES_URL = 'https://api.hubapi.com/crm/v3/properties/contacts';

const HUBSPOT_DATE_PROPERTIES = new Set([
  'which_career_readiness_date_are_you_interested_in_attending_work',
  'choose_the_2nd_date_for_your_career_readiness_class_work',
  'choose_the_3rd_date_for_your_career_readiness_class_work',
  'date_of_birth',
  'date_signed',
  'class_date',
]);

const REQUIRED_WORKSHOP_DATE_PROPERTIES = new Set([
  'choose_the_2nd_date_for_your_career_readiness_class_work',
  'choose_the_3rd_date_for_your_career_readiness_class_work',
]);

function formatMultiSelect(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(';');
  }
  return String(value);
}

function formatBoolean(value) {
  if (value === undefined || value === null || value === '') return '';
  return value ? 'true' : 'false';
}

export function buildHubSpotContactPropertiesFromBooking(data = {}) {
  const workshopDate = normalizeDateString(
    data.which_career_readiness_date_are_you_interested_in_attending_work ??
    data.class_date ??
    data.date
  );

  return {
    email: data.email,
    firstname: data.first_name,
    lastname: data.last_name,
    phone: data.phone,
    address: data.address,
    city: data.city,
    state: data.fullname_state,
    zip: data.zip,
    what_gender_do_you_identify_as_: data.what_gender_do_you_identify_as_,
    what_is_your_racial_and_ethnic_identity_: data.what_is_your_racial_and_ethnic_identity_,
    are_you_under_18_years_old: data.are_you_under_18_years_old,
    date_of_birth: data.date_of_birth ? normalizeDateString(data.date_of_birth) : '',
    are_you_still_finishing_high_school: data.are_you_still_finishing_high_school,
    whats_the_full_name_of_your_school: data.whats_the_full_name_of_your_school,
    what_grade_are_you_currently_in: data.what_grade_are_you_currently_in,
    highest_level_of_education_: data.highest_level_of_education_,
    i_or_a_family_member_i_live_with_receive_the_following_type_of_public_assistancecheck_all_that_apply: formatMultiSelect(
      data.i_or_a_family_member_i_live_with_receive_the_following_type_of_public_assistancecheck_all_that_apply
    ),
    please_check_all_of_these_situations_that_apply_to_you: formatMultiSelect(
      data.please_check_all_of_these_situations_that_apply_to_you
    ),
    are_you_a_parent: data.are_you_a_parent,
    how_many_children_do_you_have: data.how_many_children_do_you_have,
    are_you_a_single_parent: data.are_you_a_single_parent,
    are_you_involved_in_the_justice_system: data.are_you_involved_in_the_justice_system,
    what_is_your_status_in_the_justice_system_check_all_that_apply: formatMultiSelect(
      data.what_is_your_status_in_the_justice_system_check_all_that_apply
    ),
    what_is_your_offense_status_check_all_that_apply: formatMultiSelect(
      data.what_is_your_offense_status_check_all_that_apply
    ),
    what_is_your_system_level_check_all_that_apply: formatMultiSelect(
      data.what_is_your_system_level_check_all_that_apply
    ),
    do_you_grant_permission_for_your_data_as_it_relates_to_this_program_to_be_collected_and_tracked:
      data.do_you_grant_permission_for_your_data_as_it_relates_to_this_program_to_be_collected_and_tracked,
    i_consent_to_the_irrevocable_right_to_use_my_name__or_a_fictional_name___statement_s__story__photog: formatBoolean(
      data.i_consent_to_the_irrevocable_right_to_use_my_name__or_a_fictional_name___statement_s__story__photog
    ),
    digital_signature: data.digital_signature,
    date_signed: data.date_signed ? normalizeDateString(data.date_signed) : '',
    whats_your_employment_status_pick_only_1: data.whats_your_employment_status_pick_only_1,
    career_readiness_form_status: data.career_readiness_form_status || '',
    start_date_desired: workshopDate || '',
    which_career_readiness_date_are_you_interested_in_attending_work: workshopDate || '',
    class_date: workshopDate || '',
    choose_the_2nd_date_for_your_career_readiness_class_work: data.choose_the_2nd_date_for_your_career_readiness_class_work
      ? normalizeDateString(data.choose_the_2nd_date_for_your_career_readiness_class_work)
      : '',
    choose_the_3rd_date_for_your_career_readiness_class_work: data.choose_the_3rd_date_for_your_career_readiness_class_work
      ? normalizeDateString(data.choose_the_3rd_date_for_your_career_readiness_class_work)
      : '',
  };
}

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
    const cached = cache.get(name);
    if (cached === null) {
      const err = new Error(`Property ${name} does not exist`);
      err.response = { status: 404 };
      throw err;
    }
    return cached;
  }

  try {
    const response = await axios.get(
      `${HUBSPOT_CONTACT_PROPERTIES_URL}/${encodeURIComponent(name)}`,
      config
    );
    cache.set(name, response.data);
    return response.data;
  } catch (err) {
    if (err.response?.status === 404) {
      cache.set(name, null);
    }
    throw err;
  }
}

async function ensureCareerReadinessFormStatusProperty(config) {
  const name = 'career_readiness_form_status';

  try {
    await getPropertyDefinition(name, config);
    return;
  } catch (err) {
    if (err.response?.status !== 404) {
      throw err;
    }
  }

  try {
    const response = await axios.post(
      HUBSPOT_CONTACT_PROPERTIES_URL,
      {
        name,
        label: 'Career Readiness Form Status',
        type: 'enumeration',
        fieldType: 'select',
        groupName: 'contactinformation',
        options: [
          { label: 'Partial', value: 'Partial', displayOrder: 0, hidden: false },
          { label: 'Complete', value: 'Complete', displayOrder: 1, hidden: false },
        ],
      },
      config
    );
    getPropertyDefinitionCache(config).set(name, response.data);
    console.log('Created HubSpot property career_readiness_form_status');
  } catch (err) {
    console.warn(
      'Could not auto-create career_readiness_form_status:',
      err.response?.data?.message || err.message
    );
  }
}

async function filterExistingProperties(properties, config) {
  const filtered = {};
  const skippedProperties = [];

  for (const [name, value] of Object.entries(properties)) {
    try {
      await getPropertyDefinition(name, config);
      filtered[name] = value;
    } catch (err) {
      if (err.response?.status === 404) {
        skippedProperties.push(name);
        console.warn(`Skipping HubSpot property that does not exist: ${name}`);
        continue;
      }
      throw err;
    }
  }

  return { filtered, skippedProperties };
}

function findEnumerationOptionForDate(options, dateISO) {
  const target = normalizeDateString(dateISO);

  return options.find((option) => {
    const candidates = [option.value, option.label].filter(Boolean);
    return candidates.some((candidate) => normalizeDateString(candidate) === target);
  });
}

function findEnumerationOptionForValue(options, rawValue) {
  const target = String(rawValue).trim().toLowerCase();

  return options.find((option) => {
    const candidates = [option.value, option.label].filter(Boolean);
    return candidates.some((candidate) => String(candidate).trim().toLowerCase() === target);
  });
}

async function formatEnumerationProperty(name, rawValue, config) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return rawValue;
  }

  try {
    const definition = await getPropertyDefinition(name, config);
    if (definition.type !== 'enumeration') {
      return rawValue;
    }

    if (String(rawValue).includes(';')) {
      const mapped = String(rawValue)
        .split(';')
        .filter(Boolean)
        .map((part) => {
          const match = findEnumerationOptionForValue(definition.options || [], part);
          return match ? match.value : part;
        });
      return mapped.join(';');
    }

    const match = findEnumerationOptionForValue(definition.options || [], rawValue);
    return match ? match.value : rawValue;
  } catch (err) {
    if (err.response?.status === 404) {
      return rawValue;
    }
    throw err;
  }
}

async function formatWorkshopDateProperty(name, rawValue, config) {
  const dateISO = normalizeDateString(rawValue);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    return rawValue;
  }

  try {
    const definition = await getPropertyDefinition(name, config);

    if (definition.type === 'date') {
      return toHubSpotDateValue(dateISO);
    }

    if (definition.type === 'enumeration') {
      const match = findEnumerationOptionForDate(definition.options || [], dateISO);
      if (match) {
        return match.value;
      }
    }

    return dateISO;
  } catch (err) {
    if (err.response?.status === 404) {
      return toHubSpotDateValue(dateISO);
    }
    throw err;
  }
}

async function formatPropertiesForHubSpot(properties, config) {
  const formatted = {};

  for (const [name, value] of Object.entries(properties)) {
    if (HUBSPOT_DATE_PROPERTIES.has(name)) {
      formatted[name] = await formatWorkshopDateProperty(name, value, config);
    } else {
      formatted[name] = await formatEnumerationProperty(name, value, config);
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
    await ensureCareerReadinessFormStatusProperty(config);
    payloadProperties = await formatPropertiesForHubSpot(cleanedProperties, config);
  } catch (err) {
    if (err instanceof HubSpotSyncError) {
      throw err;
    }
    throw buildHubSpotSyncError(err, 'hubspot_property_format', cleanedProperties);
  }

  let skippedProperties = [];

  try {
    const filtered = await filterExistingProperties(payloadProperties, config);
    payloadProperties = filtered.filtered;
    skippedProperties = filtered.skippedProperties;
  } catch (err) {
    throw buildHubSpotSyncError(err, 'hubspot_property_filter', payloadProperties);
  }

  if (!Object.keys(payloadProperties).length) {
    throw new HubSpotSyncError('No valid HubSpot properties remain after filtering', {
      step: 'hubspot_property_filter',
      attemptedPayload: cleanedProperties,
      skippedProperties,
    });
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
      skippedProperties,
    };
  } catch (err) {
    throw buildHubSpotSyncError(err, 'hubspot_contact_write', payloadProperties, skippedProperties);
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
    'which_career_readiness_date_are_you_interested_in_attending_work',
    'choose_the_2nd_date_for_your_career_readiness_class_work',
    'choose_the_3rd_date_for_your_career_readiness_class_work',
    'are_you_under_18_years_old',
    'career_readiness_form_status',
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
