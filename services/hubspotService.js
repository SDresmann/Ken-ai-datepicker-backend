import axios from 'axios';

const HUBSPOT_CONTACTS_URL = 'https://api.hubapi.com/crm/v3/objects/contacts';
const HUBSPOT_CONTACT_SEARCH_URL = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
const HUBSPOT_CONTACT_PROPERTIES_URL = 'https://api.hubapi.com/crm/v3/properties/contacts';

function getAccessToken() {
  return process.env.HUBSPOT_ACCESS_TOKEN || process.env.ACCESS_TOKEN;
}

function cleanProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

async function getAllContactPropertyNames(config) {
  const propertyNames = new Set();
  let after;

  do {
    const url = after
      ? `${HUBSPOT_CONTACT_PROPERTIES_URL}?after=${after}`
      : HUBSPOT_CONTACT_PROPERTIES_URL;
    const response = await axios.get(url, config);
    response.data.results.forEach((property) => propertyNames.add(property.name));
    after = response.data.paging?.next?.after;
  } while (after);

  return propertyNames;
}

async function filterKnownContactProperties(properties, config) {
  try {
    const propertyNames = await getAllContactPropertyNames(config);
    const knownProperties = Object.fromEntries(
      Object.entries(properties).filter(([name]) => propertyNames.has(name))
    );
    const skippedProperties = Object.keys(properties).filter((name) => !propertyNames.has(name));

    if (skippedProperties.length) {
      console.warn(`Skipping unknown HubSpot contact properties: ${skippedProperties.join(', ')}`);
    }

    return knownProperties;
  } catch (err) {
    console.warn('[HubSpot] Could not verify contact properties; syncing provided payload:', err.response?.data || err.message || err);
    return properties;
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
    throw new Error('HubSpot access token is not configured');
  }

  if (!properties.email) {
    throw new Error('Email is required to sync a HubSpot contact');
  }

  const config = {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  };
  const knownProperties = await filterKnownContactProperties(cleanProperties(properties), config);
  const payload = { properties: knownProperties };

  const existingContact =
    (await findContactByEmail(properties.email, config)) ||
    (await findContactByName(properties.firstname, properties.lastname, config));

  if (existingContact) {
    const response = await axios.patch(
      `${HUBSPOT_CONTACTS_URL}/${existingContact.id}`,
      payload,
      config
    );
    return { action: 'updated', contact: response.data };
  }

  const response = await axios.post(HUBSPOT_CONTACTS_URL, payload, config);
  return { action: 'created', contact: response.data };
}
