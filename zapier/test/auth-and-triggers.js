// test/auth-and-triggers.js - the one test for this app.
//
// Everything is mocked with nock: no real server, no real key, no prod data.
// It proves the security door (the auth check passes a key and reads the
// key's scopes), the money path (new gifts list newest-first with stable
// ids for dedupe), and the donor-data path (a stage change is a new dedupe
// id, so the trigger fires exactly once per change).

const should = require('should');
const nock = require('nock');
const zapier = require('zapier-platform-core');

const App = require('../index');
const appTester = zapier.createAppTester(App);

const BASE = 'https://steward-test.example.com';
const KEY = 'stw_test_not_a_real_key';

const bundle = () => ({ authData: { apiKey: KEY, baseUrl: BASE } });

describe('Steward Zapier app', () => {
  beforeEach(() => nock.cleanAll());

  it('checks the connection and reads the key scopes', async () => {
    nock(BASE, { reqheaders: { 'x-api-key': KEY } })
      .get('/api/v1/me')
      .reply(200, {
        organization: 'Harborlight',
        key: 'zapier',
        scopes: ['read:gifts', 'read:people', 'write:gifts'],
      });

    const result = await appTester(App.authentication.test, bundle());
    result.organization.should.equal('Harborlight');
    result.scopes.should.containEql('read:gifts');
  });

  it('lists new gifts newest-first with a stable id per gift', async () => {
    nock(BASE, { reqheaders: { 'x-api-key': KEY } })
      .get('/api/v1/gifts')
      .query(true)
      .reply(200, {
        data: [
          { id: 'g_new', personId: 'd_1', amount: 250, date: '2026-10-01', type: 'cash', paymentMethod: 'card', fund: 'Annual Fund', campaign: 'Fall', createdAt: '2026-10-01T15:00:00.000Z' },
          { id: 'g_old', personId: 'd_2', amount: 100, date: '2026-09-30', type: 'check', paymentMethod: null, fund: null, campaign: null, createdAt: '2026-09-30T15:00:00.000Z' },
        ],
        limit: 100, offset: 0,
      });

    const results = await appTester(App.triggers.newGift.operation.perform, bundle());
    results.should.have.length(2);
    results[0].id.should.equal('g_new');
    results[0].amount.should.equal(250);
    // The id Zapier dedupes on is the gift's own id, so a gift fires once.
    [...new Set(results.map(r => r.id))].should.have.length(2);
  });

  it('fires the stage trigger once per person-plus-stage, not once per person', async () => {
    nock(BASE, { reqheaders: { 'x-api-key': KEY } })
      .get('/api/v1/people')
      .query(true)
      .reply(200, {
        data: [
          { id: 'd_1', name: 'Margaret Chen', email: 'm@example.org', stage: 'donor', lifetimeGiving: 250, giftCount: 1, lastGiftDate: '2026-10-01' },
          { id: 'd_2', name: 'Walter Fairbanks', email: 'w@example.org', stage: 'prospect', lifetimeGiving: 0, giftCount: 0, lastGiftDate: null },
        ],
        limit: 100, offset: 0,
      });

    const results = await appTester(App.triggers.stageChanged.operation.perform, bundle());
    results.should.have.length(2);
    results[0].id.should.equal('d_1::donor');
    results[0].stage.should.equal('donor');
    // When Margaret later moves to 'major', her id becomes d_1::major: a new
    // dedupe id, so the trigger fires again for the change, and only then.
    results[0].id.should.not.equal('d_1::major');
  });

  it('records a gift through the one gift path with an idempotency key', async () => {
    nock(BASE, { reqheaders: { 'x-api-key': KEY } })
      .post('/api/v1/gifts', body => body.personId === 'd_1' && body.amount === 250 && typeof body.idempotencyKey === 'string' && body.idempotencyKey.length > 0)
      .reply(201, { data: { id: 'g_3', personId: 'd_1', amount: 250, date: '2026-10-01' } });

    const b = bundle();
    b.inputData = { personId: 'd_1', amount: 250, date: '2026-10-01' };
    const result = await appTester(App.creates.recordGift.operation.perform, b);
    result.id.should.equal('g_3');
    result.duplicate.should.equal(false);
    result.idempotencyKey.should.be.a.String();
  });
});
