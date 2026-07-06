import 'isomorphic-fetch';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { Client } from '@microsoft/microsoft-graph-client';

let cca;

function parseOutlookUserEmails() {
  return (process.env.MS_OUTLOOK_USER_EMAIL || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
}

export function getOutlookSenderEmail() {
  return parseOutlookUserEmails()[0] || '';
}

export function getSignupNotificationRecipients() {
  return parseOutlookUserEmails().slice(1);
}

export async function getGraphClient() {
  if (!cca) {
    cca = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.MS_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
        clientSecret: process.env.MS_CLIENT_SECRET,
      },
    });
  }

  const { accessToken } = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return Client.init({ authProvider: (done) => done(null, accessToken) });
}

export async function createOutlookEvent({ dateISO, startTime, endTime }) {
  const sender = getOutlookSenderEmail();
  if (!sender) {
    throw new Error('MS_OUTLOOK_USER_EMAIL is not configured');
  }

  const client = await getGraphClient();

  return client
    .api(`/users/${encodeURIComponent(sender)}/events`)
    .post({
      subject: 'AI Class Booking',
      start: { dateTime: `${dateISO}T${startTime}:00`, timeZone: 'America/New_York' },
      end:   { dateTime: `${dateISO}T${endTime}:00`,   timeZone: 'America/New_York' },
    });
}
