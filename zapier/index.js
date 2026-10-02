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
const personListTrigger = require('./triggers/personList');
const createPersonCreate = require('./creates/createPerson');
const recordGiftCreate = require('./creates/recordGift');
const addNoteCreate = require('./creates/addNote');

const { version } = require('./package.json');
const { version: platformVersion } = require('zapier-platform-core');

const App = {
  version,
  platformVersion,

  authentication,

  // D028. Zapier otherwise trims and strips the input before an action sees
  // it, so what the action receives is not quite what the Zap was shown. Each
  // action here already turns a blank into null, undefined or its default, so
  // turning the cleaning off changes no behaviour and makes the input
  // predictable.
  flags: {
    cleanInputData: false,
  },

  beforeRequest: [],

  afterResponse: [],

  triggers: {
    [newGiftTrigger.key]: newGiftTrigger,
    [newPersonTrigger.key]: newPersonTrigger,
    [stageChangedTrigger.key]: stageChangedTrigger,
    // Hidden: the people dropdown behind the Person fields.
    [personListTrigger.key]: personListTrigger,
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
