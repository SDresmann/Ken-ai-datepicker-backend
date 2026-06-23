export class HubSpotSyncError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'HubSpotSyncError';
    this.step = details.step || 'hubspot_sync';
    this.status = details.status || null;
    this.hubspot = details.hubspot || null;
    this.hubspotErrors = details.hubspotErrors || [];
    this.attemptedPayload = details.attemptedPayload || null;
    this.skippedProperties = details.skippedProperties || [];
    this.cause = details.cause || null;
  }
}

export function serializeHubSpotError(error, extra = {}) {
  const hubspot = error?.response?.data || error?.hubspot || null;
  const hubspotErrors = hubspot?.errors || error?.hubspotErrors || [];

  return {
    step: extra.step || error?.step || 'hubspot_sync',
    message: extra.message || 'HubSpot sync failed',
    detail: hubspot?.message || error?.message || 'Unknown HubSpot error',
    status: error?.response?.status || error?.status || null,
    hubspot,
    hubspotErrors,
    attemptedPayload: extra.attemptedPayload || error?.attemptedPayload || null,
    skippedProperties: extra.skippedProperties || error?.skippedProperties || [],
  };
}

export function logHubSpotFailure(label, error, extra = {}) {
  const details = serializeHubSpotError(error, extra);
  console.error(`[${label}]`, JSON.stringify(details, null, 2));
  return details;
}
