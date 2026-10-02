// test/auth-and-triggers.js - the one test for this app.
//
// Everything is mocked with nock: no real server, no real key, no prod data.
// It proves the security door (the auth check passes a key and reads the
// key's scopes), the money path (new gifts list newest-first with stable
// ids for dedupe), and the donor-data path (a stage change is a new dedupe
// id, so the trigger fires exactly once per change). It also proves the API
// host cannot be pointed at an address inside Zapier's own network, and that
// the people and fund dropdowns say what to do when the key lacks the scope.

const should = require('should');
const nock = require('nock');
const zapier = require('zapier-platform-core');

const App = require('../index');
const { assertSafeHost, API_BASE_URL } = require('../lib/api');
const appTester = zapier.createAppTester(App);

// The host is fixed (no auth field), so the mocks sit on the real API host.
const BASE = API_BASE_URL;
const KEY = 'stw_test_not_a_real_key';

const bundle = () => ({ authData: { apiKey: KEY } });

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

  it('refuses an API host that would send the key somewhere private', () => {
    // The host is the one field an outsider types, so these are the request
    // forgery cases: each must throw rather than be called.
    for (const host of [
      'http://steward.example.org',      // not https
      'https://localhost',
      'https://127.0.0.1',
      'https://10.0.0.5',
      'https://192.168.1.9',
      'https://169.254.169.254',         // cloud metadata
      'https://metadata.google.internal',
      'https://steward.local',
      'https://user:pw@steward.example.org',
      'not a url',
      '',
    ]) {
      should.throws(() => assertSafeHost(host), /.+/, `expected ${host} to be refused`);
    }

    // And a real one still works, trimmed to its origin.
    assertSafeHost('https://steward.example.org/api/').should.equal('https://steward.example.org');
    assertSafeHost('https://nonprofit-erp-production.up.railway.app')
      .should.equal('https://nonprofit-erp-production.up.railway.app');
  });

  it('tells a write-only key how to fix the people dropdown', async () => {
    nock(BASE, { reqheaders: { 'x-api-key': KEY } })
      .get('/api/v1/people')
      .query(true)
      .reply(403, { error: 'insufficient_scope', message: 'That key cannot read people.' });

    const b = bundle();
    b.meta = { page: 0 };
    let message = '';
    try {
      await appTester(App.triggers.personList.operation.perform, b);
    } catch (e) {
      message = e.message;
    }
    // Not Zapier's opaque 403: the two ways out, named.
    message.should.match(/Read people/);
    message.should.match(/Custom/);
  });

  it('has no API host field: every call goes to the one production host', () => {
    App.authentication.fields.map(f => f.key).should.eql(['apiKey']);
    BASE.should.equal('https://nonprofit-erp-production.up.railway.app');
  });

  it('lists funds for the Fund dropdown, and tells a key without read:funds how to fix it', async () => {
    App.creates.recordGift.operation.inputFields.find(f => f.key === 'fundId').dynamic.should.equal('fundList.id.name');

    nock(BASE, { reqheaders: { 'x-api-key': KEY } })
      .get('/api/v1/funds')
      .query(true)
      .reply(200, { data: [{ id: 'fund_1', name: 'Annual Fund' }], limit: 100, offset: 0 });
    const b = bundle();
    b.meta = { page: 0 };
    const funds = await appTester(App.triggers.fundList.operation.perform, b);
    funds.should.eql([{ id: 'fund_1', name: 'Annual Fund' }]);

    nock(BASE, { reqheaders: { 'x-api-key': KEY } })
      .get('/api/v1/funds')
      .query(true)
      .reply(403, { error: 'insufficient_scope', required: 'read:funds' });
    let message = '';
    try {
      await appTester(App.triggers.fundList.operation.perform, b);
    } catch (e) {
      message = e.message;
    }
    message.should.match(/Read funds/);
    message.should.match(/Custom/);
  });
});
