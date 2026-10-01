// creates/createPerson.js - "Create Person": add a supporter to Steward.
//
// POST /api/v1/people. If a person with that email already exists in the
// org, they are updated in place, never duplicated: posting the same
// supporter every night builds one record, not a thousand. Needs the key to
// carry the write:people scope.

const { baseUrl, headers } = require('../lib/api');

const perform = async (z, bundle) => {
  const body = {
    name: bundle.inputData.name,
    email: bundle.inputData.email || null,
    phone: bundle.inputData.phone || null,
    city: bundle.inputData.city || null,
    state: bundle.inputData.state || null,
    zip: bundle.inputData.zip || null,
  };
  const response = await z.request({
    method: 'POST',
    url: `${baseUrl(bundle)}/api/v1/people`,
    headers: headers(bundle),
    body,
  });
  response.throwForStatus();
  const data = response.json.data || {};
  return { id: data.id, created: response.json.created, ...data };
};

module.exports = {
  key: 'createPerson',
  noun: 'Person',
  display: {
    label: 'Create Person',
    description: 'Adds a person to Steward. If that email is already on file, the record is updated instead of duplicated.',
  },
  operation: {
    perform,
    inputFields: [
      { key: 'name', label: 'Full Name', type: 'string', required: true, helpText: 'The person as they should be addressed.' },
      { key: 'email', label: 'Email', type: 'string', helpText: 'Used to match an existing record, so an update never becomes a duplicate.' },
      { key: 'phone', label: 'Phone', type: 'string', required: false },
      { key: 'city', label: 'City', type: 'string', required: false },
      { key: 'state', label: 'State', type: 'string', required: false },
      { key: 'zip', label: 'ZIP', type: 'string', required: false },
    ],
    sample: {
      id: 'd_abc123',
      created: true,
      name: 'Margaret Chen',
      email: 'margaret@example.org',
      phone: '859-555-0142',
      city: 'Lexington',
      state: 'KY',
      zip: '40502',
      stage: 'prospect',
    },
    outputFields: [
      { key: 'id', label: 'Person ID' },
      { key: 'created', type: 'boolean', label: 'Newly Created' },
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'stage', label: 'Stage' },
    ],
  },
};
