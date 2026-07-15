import axios from 'axios';
import { HubSpotSyncError, serializeHubSpotError } from './hubspotErrors.js';

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
    firstname: String(data.first_name || data.firstname || '').trim(),
    lastname: String(data.last_name || data.lastname || '').trim(),
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
    are_you_unemployed: data.are_you_unemployed,
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
  const workshopYear = Number(target.slice(0, 4)) || new Date().getFullYear();

  return options.find((option) => {
    const candidates = [option.value, option.label].filter(Boolean);
    return candidates.some((candidate) => {
      const parsedWorkshopDate = parseWorkshopOptionDate(candidate, workshopYear);
      if (parsedWorkshopDate) {
        return parsedWorkshopDate === target;
      }

      return normalizeDateString(candidate) === target;
    });
  });
}

const WORKSHOP_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseWorkshopOptionDate(candidate, defaultYear = new Date().getFullYear()) {
  const match = String(candidate).match(/,\s*([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/);
  if (!match) return '';

  const monthIndex = WORKSHOP_MONTH_NAMES.findIndex(
    (month) => month.toLowerCase() === match[1].toLowerCase()
  );
  if (monthIndex < 0) return '';

  const day = Number(match[2]);
  return `${defaultYear}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

const HUBSPOT_FORMS_SUBMIT_URL = 'https://api.hsforms.com/submissions/v3/integration/submit';
const DEFAULT_HUBSPOT_PORTAL_ID = '8489989';
const DEFAULT_HUBSPOT_FORM_GUID = 'e3e38af4-9476-403f-b8ef-46cd0506de6e';

function formatHubSpotFormBoolean(value) {
  if (value === undefined || value === null || value === '') return '';
  return value ? 'true' : 'false';
}

function objectToHubSpotFormFields(values = {}) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => ({ name, value: String(value) }));
}

function buildHubSpotFormContext(data = {}, stage = 'complete') {
  const pageNames = {
    partial: 'Full Career Readiness Student Survey (RSH) - Partial',
    complete: 'Full Career Readiness Student Survey (RSH) - Complete',
  };

  const context = {
    pageUri: data.page_uri || 'https://ken-ai-datepicker-frontend.onrender.com',
    pageName: data.page_name || pageNames[stage] || 'Career Readiness Registration',
  };

  if (data.hubspotutk) {
    context.hutk = data.hubspotutk;
  }

  if (data.ip_address) {
    context.ipAddress = data.ip_address;
  }

  return context;
}

function getHubSpotFormSubmitRequest(portalId, formGuid) {
  // Public endpoint — no PAT required. The secure endpoint needs form-submissions-write.
  return {
    url: `${HUBSPOT_FORMS_SUBMIT_URL}/${portalId}/${formGuid}`,
    headers: {
      'Content-Type': 'application/json',
    },
  };
}

async function formatHubSpotFormDateField(propertyName, dateISO, config) {
  if (!dateISO) return '';

  const target = normalizeDateString(dateISO);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) return '';

  try {
    const definition = await getPropertyDefinition(propertyName, config);
    if (definition.type === 'enumeration') {
      const match = findEnumerationOptionForDate(definition.options || [], target);
      return match ? match.value : '';
    }

    if (definition.type === 'date') {
      return target;
    }

    return target;
  } catch (err) {
    if (err.response?.status === 404) {
      return '';
    }
    throw err;
  }
}

async function buildHubSpotFormFields(data = {}, stage = 'complete') {
  const properties = buildHubSpotContactPropertiesFromBooking(data);
  const formStatus = stage === 'partial' ? 'Partial' : (properties.career_readiness_form_status || 'Complete');
  const accessToken = getAccessToken();
  const config = accessToken
    ? {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    : null;

  const primaryWorkshopDate = properties.which_career_readiness_date_are_you_interested_in_attending_work;
  const secondWorkshopDate = data.choose_the_2nd_date_for_your_career_readiness_class_work
    ? normalizeDateString(data.choose_the_2nd_date_for_your_career_readiness_class_work)
    : '';
  const thirdWorkshopDate = data.choose_the_3rd_date_for_your_career_readiness_class_work
    ? normalizeDateString(data.choose_the_3rd_date_for_your_career_readiness_class_work)
    : '';

  const formattedDates = config
    ? {
        which_career_readiness_dates_are_you_interested_in_attending: await formatHubSpotFormDateField(
          'which_career_readiness_dates_are_you_interested_in_attending',
          primaryWorkshopDate,
          config
        ),
        choose_your_2nd_date_for_career_readiness: await formatHubSpotFormDateField(
          'choose_your_2nd_date_for_career_readiness',
          secondWorkshopDate,
          config
        ),
        choose_your_3rd_date_for_career_readiness: await formatHubSpotFormDateField(
          'choose_your_3rd_date_for_career_readiness',
          thirdWorkshopDate,
          config
        ),
      }
    : {
        which_career_readiness_dates_are_you_interested_in_attending: primaryWorkshopDate,
        choose_your_2nd_date_for_career_readiness: secondWorkshopDate,
        choose_your_3rd_date_for_career_readiness: thirdWorkshopDate,
      };

  const sharedFields = {
    firstname: properties.firstname,
    lastname: properties.lastname,
    email: properties.email,
    phone: properties.phone,
    zip: properties.zip,
    opt_in_check_for_emailing_texting_applicants: formatHubSpotFormBoolean(data.marketing_message_consent),
    ...formattedDates,
    ready_set_hire_survey_status: formStatus,
    utm_campaign: data.utm_campaign || '',
    utm_medium: data.utm_medium || '',
    utm_source: data.utm_source || '',
    utm_term: data.utm_term || '',
    utm_content: data.utm_content || '',
  };

  if (stage === 'partial') {
    return objectToHubSpotFormFields(sharedFields);
  }

  return objectToHubSpotFormFields({
    ...sharedFields,
    are_you_under_18_years_old: properties.are_you_under_18_years_old,
    address: properties.address,
    city: properties.city,
    fullname_state: properties.state,
    date_of_birth_date: properties.date_of_birth,
    what_gender_do_you_identify_as_: properties.what_gender_do_you_identify_as_,
    what_is_your_racial_and_ethnic_identity_: properties.what_is_your_racial_and_ethnic_identity_,
    are_you_still_finishing_high_school: properties.are_you_still_finishing_high_school,
    whats_the_full_name_of_your_school: properties.whats_the_full_name_of_your_school,
    what_grade_are_you_currently_in: properties.what_grade_are_you_currently_in,
    highest_level_of_education_: properties.highest_level_of_education_,
    i_or_a_family_member_i_live_with_receive_the_following_type_of_public_assistancecheck_all_that_apply:
      properties.i_or_a_family_member_i_live_with_receive_the_following_type_of_public_assistancecheck_all_that_apply,
    please_check_all_of_these_situations_that_apply_to_you:
      properties.please_check_all_of_these_situations_that_apply_to_you,
    are_you_a_parent: properties.are_you_a_parent,
    how_many_children_do_you_have: properties.how_many_children_do_you_have,
    are_you_a_single_parent: properties.are_you_a_single_parent,
    are_you_involved_in_the_justice_system: properties.are_you_involved_in_the_justice_system,
    what_is_your_status_in_the_justice_system_check_all_that_apply:
      properties.what_is_your_status_in_the_justice_system_check_all_that_apply,
    what_is_your_offense_status_check_all_that_apply:
      properties.what_is_your_offense_status_check_all_that_apply,
    what_is_your_system_level_check_all_that_apply:
      properties.what_is_your_system_level_check_all_that_apply,
    do_you_grant_permission_for_your_data_as_it_relates_to_this_program_to_be_collected_and_tracked:
      properties.do_you_grant_permission_for_your_data_as_it_relates_to_this_program_to_be_collected_and_tracked,
    i_consent_to_the_irrevocable_right_to_use_my_name__or_a_fictional_name___statement_s__story__photog:
      properties.i_consent_to_the_irrevocable_right_to_use_my_name__or_a_fictional_name___statement_s__story__photog,
    digital_signature: properties.digital_signature,
    date_signed: properties.date_signed,
    whats_your_employment_status_pick_only_1: properties.whats_your_employment_status_pick_only_1,
  });
}

export function getHubSpotFormGuid() {
  // Partial and complete both submit to the same HubSpot form.
  return (
    process.env.HUBSPOT_FORM_GUID
    || process.env.HUBSPOT_FORM_GUID_COMPLETE
    || DEFAULT_HUBSPOT_FORM_GUID
  );
}

export async function submitHubSpotFormSubmission(data = {}, { stage = 'complete' } = {}) {
  const portalId = process.env.HUBSPOT_PORTAL_ID || DEFAULT_HUBSPOT_PORTAL_ID;
  const formGuid = getHubSpotFormGuid();

  if (!portalId || !formGuid) {
    return { skipped: true, reason: 'HubSpot portal ID or form GUID is not configured', stage };
  }

  const fields = await buildHubSpotFormFields(data, stage);

  if (!fields.some((field) => field.name === 'email')) {
    return { skipped: true, reason: 'email is required for HubSpot form submission', stage };
  }

  const workshopDateField = fields.find(
    (field) => field.name === 'which_career_readiness_dates_are_you_interested_in_attending'
  );
  if (!workshopDateField?.value) {
    const primaryDate = data.which_career_readiness_date_are_you_interested_in_attending_work
      || data.class_date
      || '';
    throw new HubSpotSyncError(
      'Workshop date does not match a HubSpot form option. Please choose one of the scheduled workshop dates.',
      {
        step: 'hubspot_form_submission',
        hubspot: {
          errors: [{
            message: `Could not map workshop date "${primaryDate}" to which_career_readiness_dates_are_you_interested_in_attending`,
            errorType: 'REQUIRED_FIELD',
          }],
        },
        attemptedPayload: { stage, portalId, formGuid, fields },
      }
    );
  }

  const submitRequest = getHubSpotFormSubmitRequest(portalId, formGuid);
  const submissionBody = {
    submittedAt: Date.now(),
    fields,
    context: buildHubSpotFormContext(data, stage),
  };

  try {
    const response = await axios.post(submitRequest.url, submissionBody, {
      headers: submitRequest.headers,
    });

    return {
      ok: true,
      stage,
      formGuid,
      portalId,
      fieldsSubmitted: fields.length,
      submission: response.data,
      storedOnPageUri: submissionBody.context.pageUri,
    };
  } catch (err) {
    const hubspot = err.response?.data;
    const detail = hubspot?.message || hubspot?.errors?.map((entry) => entry.message).join(' | ') || err.message;
    console.error(`[hubspot-form:${stage}] submission failed`, detail, hubspot || '');
    throw new HubSpotSyncError(detail || 'HubSpot form submission failed', {
      step: 'hubspot_form_submission',
      status: err.response?.status || null,
      hubspot,
      attemptedPayload: { stage, portalId, formGuid, fields },
    });
  }
}

export async function inspectHubSpotFormsConfig() {
  const accessToken = getAccessToken();

  if (!accessToken) {
    return {
      ok: false,
      detail: 'HubSpot access token is not configured',
    };
  }

  const config = {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };

  let portalId = process.env.HUBSPOT_PORTAL_ID || DEFAULT_HUBSPOT_PORTAL_ID;

  try {
    const account = await axios.get('https://api.hubapi.com/account-info/v3/details', config);
    portalId = String(account.data.portalId || portalId);
  } catch (err) {
    console.warn('Could not resolve HubSpot portal from token:', err.response?.data?.message || err.message);
  }

  const sharedFormGuid = getHubSpotFormGuid();
  const forms = {
    shared: {
      envKeys: ['HUBSPOT_FORM_GUID', 'HUBSPOT_FORM_GUID_COMPLETE'],
      formGuid: sharedFormGuid,
      when: 'Used for both partial (step 1 Next) and complete (final Submit) form submissions',
      ignoredEnvKeys: process.env.HUBSPOT_FORM_GUID_PARTIAL
        ? ['HUBSPOT_FORM_GUID_PARTIAL']
        : [],
    },
    partial: {
      envKey: 'shared form GUID',
      formGuid: sharedFormGuid,
      stage: 'partial',
      when: 'After user completes step 1 and clicks Next',
    },
    complete: {
      envKey: 'shared form GUID',
      formGuid: sharedFormGuid,
      stage: 'complete',
      when: 'After user submits the full application',
    },
  };

  for (const entry of Object.values(forms)) {
    try {
      const response = await axios.get(
        `https://api.hubapi.com/marketing/v3/forms/${entry.formGuid}`,
        config
      );
      entry.exists = true;
      entry.name = response.data.name;
      entry.fieldCount = (response.data.fieldGroups || []).flatMap((group) => group.fields || []).length;
    } catch (err) {
      entry.exists = false;
      entry.status = err.response?.status || null;
      entry.detail = err.response?.data?.message || err.message;
    }
  }

  return {
    ok: true,
    portalId,
    whereToLook: 'HubSpot → Marketing → Forms (make sure you are in this portal ID)',
    forms,
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
