// index.js - the Steward app for Zapier.
//
// Steward is the donor CRM that remembers the next right thing for every
// donor. This app lets a Zap watch what happens in Steward (new gifts, new
// people, stage changes) and write back (people, gifts, notes) through the
// public API, using a scoped API key made inside Steward.

const authentication = require('./authentication');
const newGiftTrigger = require('./triggers/newGift');
const newPersonTrigger = require('./triggers/newPerson');
const stageChangedTrigger = require('./triggers/stageChanged');
const createPersonCreate = require('./creates/createPerson');
const recordGiftCreate = require('./creates/recordGift');
const addNoteCreate = require('./creates/addNote');

const { version } = require('./package.json');
const { version: platformVersion } = require('zapier-platform-core');

const App = {
  version,
  platformVersion,

  authentication,

  beforeRequest: [],

  afterResponse: [],

  triggers: {
    [newGiftTrigger.key]: newGiftTrigger,
    [newPersonTrigger.key]: newPersonTrigger,
    [stageChangedTrigger.key]: stageChangedTrigger,
  },

  searches: {},

  creates: {
    [createPersonCreate.key]: createPersonCreate,
    [recordGiftCreate.key]: recordGiftCreate,
    [addNoteCreate.key]: addNoteCreate,
  },

  resources: {},
};

module.exports = App;
