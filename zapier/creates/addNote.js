// creates/addNote.js - "Add Note": log a conversation on somebody's record.
//
// POST /api/v1/notes. It can only add a note: it cannot change giving, and
// the person must already exist in the org. Needs the key to carry the
// write:notes scope.

const { baseUrl, headers } = require('../lib/api');

const perform = async (z, bundle) => {
  const body = {
    personId: bundle.inputData.personId,
    note: bundle.inputData.note,
    type: bundle.inputData.type || 'note',
    date: bundle.inputData.date || undefined,
  };
  const response = await z.request({
    method: 'POST',
    url: `${baseUrl(bundle)}/api/v1/notes`,
    headers: headers(bundle),
    body,
  });
  response.throwForStatus();
  const data = response.json.data || {};
  return { id: data.id, ...data };
};

module.exports = {
  key: 'addNote',
  noun: 'Note',
  display: {
    label: 'Add Note',
    description: 'Logs a call, meeting, email or note on a person\'s record in Steward. It adds the note and changes nothing else.',
  },
  operation: {
    perform,
    inputFields: [
      { key: 'personId', label: 'Person ID', type: 'string', required: true, helpText: 'The Steward person ID, from a New Person trigger or a Find step.' },
      { key: 'note', label: 'Note', type: 'text', required: true, helpText: 'What happened, in a line or two.' },
      {
        key: 'type', label: 'Type', required: false, default: 'note',
        choices: { call: 'Call', meeting: 'Meeting', email: 'Email', note: 'Note' },
      },
      { key: 'date', label: 'Date', type: 'string', required: false, helpText: 'As YYYY-MM-DD. Defaults to today.' },
    ],
    sample: {
      id: 'int_abc12345',
      personId: 'd_xyz789',
      type: 'call',
    },
    outputFields: [
      { key: 'id', label: 'Note ID' },
      { key: 'personId', label: 'Person ID' },
      { key: 'type', label: 'Type' },
    ],
  },
};
