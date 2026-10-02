// triggers/stageChanged.js - "Stage Changed": somebody moved along the pipeline.
//
// There is no server-side "recently updated" feed for people, and webhook
// subscriptions can only be made by a logged-in admin, so this polls
// GET /api/v1/people and deduplicates on person-plus-stage: when a person's
// stage changes, the combination is new and the Zap fires once for it.
//
// LIMIT, HONESTLY STATED: the people list is newest-first by when the record
// was added, so a stage change on a record far down the list is only seen
// when the trigger pages deep enough to reach it. Stage changes on recently
// added people are caught reliably. Needs the read:people scope.

const { baseUrl, headers } = require('../lib/api');

const perform = async (z, bundle) => {
  const response = await z.request({
    url: `${baseUrl(bundle)}/api/v1/people`,
    headers: headers(bundle),
    params: { limit: 100 },
  });
  response.throwForStatus();
  return (response.json.data || []).map(p => ({
    // Person plus stage, so the same person changing stage fires again.
    id: `${p.id}::${p.stage || 'none'}`,
    personId: p.id,
    name: p.name,
    email: p.email,
    stage: p.stage,
    lifetimeGiving: p.lifetimeGiving,
    giftCount: p.giftCount,
    lastGiftDate: p.lastGiftDate,
  }));
};

module.exports = {
  key: 'stageChanged',
  noun: 'Stage Change',
  display: {
    label: 'Stage Changed',
    description: 'Triggers when a person moves to a new stage in Steward, for example from prospect to donor. Watches recently added records.',
  },
  operation: {
    perform,
    type: 'polling',
    sample: {
      id: 'd_abc123::donor',
      personId: 'd_abc123',
      name: 'Margaret Chen',
      email: 'margaret@example.org',
      stage: 'donor',
      lifetimeGiving: 250,
      giftCount: 1,
      lastGiftDate: '2026-10-01',
    },
    outputFields: [
      { key: 'personId', label: 'Person ID' },
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'stage', label: 'New Stage' },
      { key: 'lifetimeGiving', type: 'number', label: 'Lifetime Giving' },
      { key: 'giftCount', type: 'integer', label: 'Gift Count' },
      { key: 'lastGiftDate', type: 'datetime', label: 'Last Gift Date' },
    ],
  },
};
