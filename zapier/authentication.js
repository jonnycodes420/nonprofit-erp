// authentication.js - Steward API key auth for the Zapier app.
//
// A Steward admin makes an API key inside Steward (Settings, API keys), ticks
// exactly the permissions the Zap needs, and pastes the key here. The key is
// shown once and stored hashed, so a lost key is revoked and remade, never
// recovered. The key always opens one organisation: nothing the caller sends
// can pick a different org.
//
// The key travels in the x-api-key header, which is how the Steward API reads
// it. Calls are scoped: read:people, read:gifts, read:events, write:people,
// write:gifts, write:notes. A key made before scopes existed carries the
// legacy "read" scope, which expands to every read scope and no write scope.

const { baseUrl, headers } = require('./lib/api');

const testAuth = async (z, bundle) => {
  const response = await z.request({
    url: `${baseUrl(bundle)}/api/v1/me`,
    headers: headers(bundle),
  });
  response.throwForStatus();
  const body = response.json;
  if (!body || !body.organization) {
    throw new z.errors.Error('Steward answered, but not the way the connection check expects. Is this the API host?');
  }
  return body;
};

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      type: 'password',
      required: true,
      helpText: 'Made in Steward under Settings, API keys. Tick the permissions the Zap needs: reading gifts for the New Gift trigger, writing gifts to record them, and so on.',
    },
    {
      key: 'baseUrl',
      label: 'API host',
      type: 'string',
      required: true,
      default: 'https://nonprofit-erp-production.up.railway.app',
      helpText: 'Where your Steward API lives. This is the production host for almost everyone; only change it if your Steward runs somewhere else.',
    },
  ],
  test: testAuth,
  connectionLabel: '{{organization}}',
};
