// triggers/fundList.js - the funds dropdown behind the Fund field on Record Gift.
//
// HIDDEN, like personList: it exists so "Fund" is a list of names instead of
// an id the person has to go and find (D004). Polls GET /api/v1/funds a page
// at a time.
//
// IT NEEDS A SCOPE THE ACTION ITSELF DOES NOT. Recording a gift needs
// write:gifts; listing funds needs read:funds. A key without it gets a 403
// here, which is caught and answered with the two ways out: tick the
// permission, or map the id from an earlier step.

const { baseUrl, headers } = require('../lib/api');

const PAGE = 100;

const perform = async (z, bundle) => {
  const page = Number((bundle.meta && bundle.meta.page) || 0);
  const response = await z.request({
    url: `${baseUrl(bundle)}/api/v1/funds`,
    headers: headers(bundle),
    params: { limit: PAGE, offset: page * PAGE },
    skipThrowForStatus: true,
  });

  if (response.status === 403) {
    throw new z.errors.Error(
      'This list needs the "Read funds" permission on your Steward API key, and this key does not have it. ' +
      'Either tick "Read funds" on the key in Steward (Settings, API keys), or switch this field to Custom ' +
      'and map a Fund ID from an earlier step.',
      'ScopeMissing', 403
    );
  }
  response.throwForStatus();

  return (response.json.data || []).map(f => ({ id: f.id, name: f.name }));
};

module.exports = {
  key: 'fundList',
  noun: 'Fund',
  display: {
    label: 'Funds',
    description: 'Lists the funds on file so other steps can offer them in a dropdown.',
    hidden: true,
  },
  operation: {
    perform,
    type: 'polling',
    canPaginate: true,
    sample: { id: 'fund_abc123', name: 'Annual Fund' },
    outputFields: [
      { key: 'id', label: 'Fund ID' },
      { key: 'name', label: 'Name' },
    ],
  },
};
