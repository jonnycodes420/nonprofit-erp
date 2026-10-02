// triggers/newGift.js - "New Gift": a gift was recorded in Steward.
//
// Polls GET /api/v1/gifts, which lists gifts newest-first with an id, so
// Zapier's id dedupe does exactly the right thing. Needs the key to carry
// the read:gifts scope (a legacy read key works too).

const { baseUrl, headers } = require('../lib/api');

const perform = async (z, bundle) => {
  const response = await z.request({
    url: `${baseUrl(bundle)}/api/v1/gifts`,
    headers: headers(bundle),
    params: { limit: 100 },
  });
  response.throwForStatus();
  return (response.json.data || []).map(g => ({
    id: g.id,
    personId: g.personId,
    amount: g.amount,
    date: g.date,
    type: g.type,
    paymentMethod: g.paymentMethod,
    fund: g.fund,
    campaign: g.campaign,
    createdAt: g.createdAt,
  }));
};

module.exports = {
  key: 'newGift',
  noun: 'Gift',
  display: {
    label: 'New Gift',
    description: 'Triggers when a gift is recorded in Steward, however it arrived: online, a cheque, an import, or the API.',
  },
  operation: {
    perform,
    type: 'polling',
    sample: {
      id: 'g_abc123',
      personId: 'd_xyz789',
      amount: 250,
      date: '2026-10-01',
      type: 'cash',
      paymentMethod: 'card',
      fund: 'Annual Fund',
      campaign: 'Fall Appeal',
      createdAt: '2026-10-01T14:02:00.000Z',
    },
    outputFields: [
      { key: 'id', label: 'Gift ID' },
      { key: 'personId', label: 'Person ID' },
      { key: 'amount', type: 'number', label: 'Amount' },
      { key: 'date', type: 'datetime', label: 'Gift Date' },
      { key: 'type', label: 'Type' },
      { key: 'paymentMethod', label: 'Payment Method' },
      { key: 'fund', label: 'Fund' },
      { key: 'campaign', label: 'Campaign' },
      { key: 'createdAt', type: 'datetime', label: 'Recorded At' },
    ],
  },
};
