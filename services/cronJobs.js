import cron from 'node-cron';

const DEFAULT_CRON_SCHEDULE = '0 9 * * *';
const DEFAULT_CRON_TIMEZONE = 'America/New_York';

async function runDailyCronJob() {
  console.log(`[cron] Daily job ran at ${new Date().toISOString()}`);
}

export function startCronJobs() {
  if (process.env.CRON_ENABLED === 'false') {
    console.log('[cron] Cron jobs are disabled');
    return;
  }

  const schedule = process.env.CRON_SCHEDULE || DEFAULT_CRON_SCHEDULE;
  const timezone = process.env.CRON_TIMEZONE || DEFAULT_CRON_TIMEZONE;

  if (!cron.validate(schedule)) {
    console.error(`[cron] Invalid CRON_SCHEDULE: ${schedule}`);
    return;
  }

  cron.schedule(
    schedule,
    async () => {
      try {
        await runDailyCronJob();
      } catch (err) {
        console.error('[cron] Daily job failed:', err.message || err);
      }
    },
    { timezone }
  );

  console.log(`[cron] Scheduled daily job with "${schedule}" in ${timezone}`);
}
