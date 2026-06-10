import 'isomorphic-fetch';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { Client } from '@microsoft/microsoft-graph-client';

let cca;

async function getGraphClient() {
  // Created lazily so dotenv.config() has run before we read process.env
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
  const client = await getGraphClient();

  return client
    .api(`/users/${encodeURIComponent(process.env.MS_OUTLOOK_USER_EMAIL)}/events`)
    .post({
      subject: 'AI Class Booking',
      start: { dateTime: `${dateISO}T${startTime}:00`, timeZone: 'America/New_York' },
      end:   { dateTime: `${dateISO}T${endTime}:00`,   timeZone: 'America/New_York' },
    });
}