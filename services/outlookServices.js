import 'isomorphic-fetch';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { Client } from '@microsoft/microsoft-graph-client';

let cca;
const CLASS_EVENT_SUBJECT = 'Ready.Set.Hire. Class';
const CLASS_ZOOM_LINK = 'https://us06web.zoom.us/j/5494309343?pwd=OXc5MkRvODhFQTV1RzJ5SkFUNlo5dz09';

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
  const attendees = getSignupNotificationRecipients();
  if (!sender) {
    throw new Error('MS_OUTLOOK_USER_EMAIL is not configured');
  }

  const client = await getGraphClient();
  const eventPayload = {
    subject: CLASS_EVENT_SUBJECT,
    body: {
      contentType: 'Text',
      content: `Join Zoom Meeting: ${CLASS_ZOOM_LINK}`,
    },
    location: {
      displayName: CLASS_ZOOM_LINK,
    },
    start: { dateTime: `${dateISO}T${startTime}:00`, timeZone: 'America/New_York' },
    end:   { dateTime: `${dateISO}T${endTime}:00`,   timeZone: 'America/New_York' },
    attendees: attendees.map((email) => ({
      emailAddress: {
        address: email,
      },
      type: 'required',
    })),
  };

  console.log(`[outlook] Creating event on ${sender} for ${dateISO} ${startTime}-${endTime}`);
  const event = await client
    .api(`/users/${encodeURIComponent(sender)}/events`)
    .post(eventPayload);
  console.log(`[outlook] Created event on ${sender} with attendees: ${attendees.join(', ') || 'none'}`);

  return event;
}
