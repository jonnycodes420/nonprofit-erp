// triggers/newPerson.js - "New Person": a person record was added in Steward.
//
// Polls GET /api/v1/people, newest-first with an id. Needs the key to carry
// the read:people scope (a legacy read key works too).

const { baseUrl, headers } = require('../lib/api');

const perform = async (z, bundle) => {
  const response = await z.request({
    url: `${baseUrl(bundle)}/api/v1/people`,
    headers: headers(bundle),
    params: { limit: 100 },
  });
  response.throwForStatus();
  return (response.json.data || []).map(p => ({
    id: p.id,
    name: p.name,
    email: p.email,
    phone: p.phone,
    city: p.city,
    state: p.state,
    zip: p.zip,
    types: p.types,
    stage: p.stage,
    lifetimeGiving: p.lifetimeGiving,
    giftCount: p.giftCount,
    lastGiftDate: p.lastGiftDate,
    createdAt: p.createdAt,
  }));
};

module.exports = {
  key: 'newPerson',
  noun: 'Person',
  display: {
    label: 'New Person',
    description: 'Runs when a new person record is created in Steward, from an import, a giving page, or the API.',
  },
  operation: {
    perform,
    type: 'polling',
    sample: {
      id: 'd_abc123',
      name: 'Margaret Chen',
      email: 'margaret@example.org',
      phone: '859-555-0142',
      city: 'Lexington',
      state: 'KY',
      zip: '40502',
      types: ['donor'],
      stage: 'prospect',
      lifetimeGiving: 0,
      giftCount: 0,
      lastGiftDate: null,
      createdAt: '2026-10-01T14:02:00.000Z',
    },
    outputFields: [
      { key: 'id', label: 'Person ID' },
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'zip', label: 'ZIP' },
      { key: 'stage', label: 'Stage' },
      { key: 'lifetimeGiving', type: 'number', label: 'Lifetime Giving' },
      { key: 'giftCount', type: 'integer', label: 'Gift Count' },
      { key: 'lastGiftDate', type: 'datetime', label: 'Last Gift Date' },
      { key: 'createdAt', type: 'datetime', label: 'Added At' },
    ],
  },
};
