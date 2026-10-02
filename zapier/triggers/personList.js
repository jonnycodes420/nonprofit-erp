// triggers/personList.js - the people dropdown behind every "Person ID" field.
//
// HIDDEN. It never appears in the trigger list; it exists so that "Person ID"
// on Record Gift and Add Note is a list of names instead of an id the person
// has to go and find (D004). Polls GET /api/v1/people, a page at a time, so a
// big file is still reachable by scrolling the dropdown.
//
// IT NEEDS A SCOPE THE ACTION ITSELF DOES NOT. Recording a gift needs
// write:gifts; listing people to choose from needs read:people. A key with
// only write scopes will get a 403 here, and the dropdown would otherwise
// fail with Zapier's own opaque wording, so the 403 is caught and answered
// with the two ways out: tick the permission, or map the id from an earlier
// step.

const { baseUrl, headers } = require('../lib/api');

const PAGE = 100;

const perform = async (z, bundle) => {
  const page = Number((bundle.meta && bundle.meta.page) || 0);
  const response = await z.request({
    url: `${baseUrl(bundle)}/api/v1/people`,
    headers: headers(bundle),
    params: { limit: PAGE, offset: page * PAGE },
    skipThrowForStatus: true,
  });

  if (response.status === 403) {
    throw new z.errors.Error(
      'This list needs the "Read people" permission on your Steward API key, and this key does not have it. ' +
      'Either tick "Read people" on the key in Steward (Settings, API keys), or switch this field to Custom ' +
      'and map a Person ID from an earlier step.',
      'ScopeMissing', 403
    );
  }
  response.throwForStatus();

  return (response.json.data || []).map(p => ({
    id: p.id,
    // What the dropdown shows. The email disambiguates two Margaret Chens.
    name: p.email ? `${p.name} (${p.email})` : p.name,
  }));
};

module.exports = {
  key: 'personList',
  noun: 'Person',
  display: {
    label: 'People',
    description: 'Lists the people on file so other steps can offer them in a dropdown.',
    hidden: true,
  },
  operation: {
    perform,
    type: 'polling',
    canPaginate: true,
    sample: { id: 'd_abc123', name: 'Margaret Chen (margaret@example.org)' },
    outputFields: [
      { key: 'id', label: 'Person ID' },
      { key: 'name', label: 'Name' },
    ],
  },
};
