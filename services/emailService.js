import { getGraphClient, getOutlookSenderEmail, getSignupNotificationRecipients } from './outlookServices.js';

async function sendEmail({ to, subject, content }) {
  const sender = getOutlookSenderEmail();
  if (!sender) {
    throw new Error('MS_OUTLOOK_USER_EMAIL is not configured');
  }

  const client = await getGraphClient();
  await client
    .api(`/users/${encodeURIComponent(sender)}/sendMail`)
    .post({
      message: {
        subject,
        body: { contentType: 'Text', content },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    });
}

function buildSignupEmailBody(bookingData = {}) {
  const name = [bookingData.first_name, bookingData.last_name].filter(Boolean).join(' ').trim();
  const lines = [
    'New Career Readiness workshop registration',
    '',
    `Name: ${name || 'Not provided'}`,
    `Email: ${bookingData.email || 'Not provided'}`,
    `Phone: ${bookingData.phone || 'Not provided'}`,
    `Primary workshop date: ${
      bookingData.which_career_readiness_date_are_you_interested_in_attending_work ||
      bookingData.date ||
      'Not provided'
    }`,
  ];

  if (bookingData.choose_the_2nd_date_for_your_career_readiness_class_work) {
    lines.push(
      `2nd workshop date: ${bookingData.choose_the_2nd_date_for_your_career_readiness_class_work}`
    );
  }

  if (bookingData.choose_the_3rd_date_for_your_career_readiness_class_work) {
    lines.push(
      `3rd workshop date: ${bookingData.choose_the_3rd_date_for_your_career_readiness_class_work}`
    );
  }

  return lines.join('\n');
}

export async function sendClassSignupNotifications(bookingData = {}) {
  const recipients = getSignupNotificationRecipients();
  if (!recipients.length) {
    console.warn('[email] No notification recipients in MS_OUTLOOK_USER_EMAIL; skipping signup notifications');
    return { sent: 0, skipped: true, recipients: [] };
  }

  const sender = getOutlookSenderEmail();
  if (!sender) {
    throw new Error('MS_OUTLOOK_USER_EMAIL is not configured');
  }

  const name = [bookingData.first_name, bookingData.last_name].filter(Boolean).join(' ').trim();
  const subject = `New workshop signup${name ? `: ${name}` : ''}`;
  const content = buildSignupEmailBody(bookingData);

  for (const to of recipients) {
    await sendEmail({ to, subject, content });
  }

  console.log(`[email] Sent class signup notifications to ${recipients.join(', ')}`);
  return { sent: recipients.length, skipped: false, recipients };
}
