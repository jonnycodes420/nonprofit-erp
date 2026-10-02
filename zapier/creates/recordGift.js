// creates/recordGift.js - "Record Gift": put a gift on somebody's record.
//
// POST /api/v1/gifts. This is the one gift path: the gift is written by the
// same recordGift function the app uses, so funds, rollups, receipts and
// thank-you follow-ups behave exactly as they would inside Steward.
//
// IDEMPOTENT BY A KEY THE CALLER CHOOSES: the idempotencyKey input is sent
// through, and when it is left blank the action makes one up per Zap run, so
// a retry after a timeout never records the same gift twice. Needs the key to
// carry the write:gifts scope.

const { randomUUID } = require('crypto');
const { baseUrl, headers } = require('../lib/api');

const perform = async (z, bundle) => {
  const idempotencyKey = (bundle.inputData.idempotencyKey || '').trim() || randomUUID();
  const body = {
    personId: bundle.inputData.personId,
    amount: Number(bundle.inputData.amount),
    date: bundle.inputData.date,
    type: bundle.inputData.type || 'cash',
    campaign: bundle.inputData.campaign || '',
    notes: bundle.inputData.notes || '',
    fundId: bundle.inputData.fundId || null,
    paymentMethod: bundle.inputData.paymentMethod || null,
    idempotencyKey,
  };
  const response = await z.request({
    method: 'POST',
    url: `${baseUrl(bundle)}/api/v1/gifts`,
    headers: headers(bundle),
    body,
  });
  response.throwForStatus();
  const data = response.json.data || {};
  return { id: data.id, duplicate: !!response.json.duplicate, idempotencyKey, ...data };
};

module.exports = {
  key: 'recordGift',
  noun: 'Gift',
  display: {
    label: 'Record Gift',
    description: 'Records a gift for a person in Steward. It travels the same path as a gift typed into the app, so totals and receipts stay right.',
  },
  operation: {
    perform,
    inputFields: [
      {
        key: 'personId', label: 'Person', type: 'string', required: true,
        dynamic: 'personList.id.name',
        helpText: 'Pick the person, or switch to Custom and map a Person ID from an earlier step. Listing people needs the "Read people" permission on your API key; mapping an id does not.',
      },
      { key: 'amount', label: 'Amount', type: 'number', required: true, helpText: 'Dollars and cents, for example 250.00.' },
      {
        key: 'date', label: 'Gift Date', type: 'string', required: true,
        helpText: 'As YYYY-MM-DD. Defaults to today.',
        default: new Date().toISOString().slice(0, 10),
      },
      { key: 'type', label: 'Type', type: 'string', required: false, default: 'cash', helpText: 'cash, check, card, stock, and so on.' },
      { key: 'campaign', label: 'Campaign', type: 'string', required: false },
      { key: 'fundId', label: 'Fund ID', type: 'string', required: false, helpText: 'The Steward fund ID, if the gift is restricted to a fund.' },
      { key: 'paymentMethod', label: 'Payment Method', type: 'string', required: false },
      { key: 'notes', label: 'Notes', type: 'text', required: false },
      {
        key: 'idempotencyKey', label: 'Idempotency Key', type: 'string', required: false,
        helpText: 'Your own reference for this gift, for example an order ID from the other app. Left blank, one is made up per Zap run, so a retry never records the gift twice.',
      },
    ],
    sample: {
      id: 'g_abc123',
      personId: 'd_xyz789',
      amount: 250,
      date: '2026-10-01',
      duplicate: false,
    },
    outputFields: [
      { key: 'id', label: 'Gift ID' },
      { key: 'personId', label: 'Person ID' },
      { key: 'amount', type: 'number', label: 'Amount' },
      { key: 'date', label: 'Gift Date' },
      { key: 'duplicate', type: 'boolean', label: 'Already Recorded' },
    ],
  },
};
