// shared/emailReadyBlocks.js · BUILDER-2A item 5. READY-MADE SECTIONS, STEWARD'S OWN.
//
// Pure: no DB, no network, no clock. The Blocks tab offers these beside an
// org's own saved blocks. Each is a short run of block types an email already
// takes, so it renders, validates and sends like anything she builds herself,
// in her brand (the renderer reads the brand at render time).
//
// THE RULES THEY KEEP. Words follow docs/MESSAGING.md: plain, short, no
// exclamation marks, nothing a person would not say out loud. They never claim
// an outcome: a number or a name is a [bracketed] blank she fills, and the
// renderer refuses a send with one left in. Every photo is one of Steward's own
// (EDITOR-1: there is always a photo): `stockPhoto: true` marks where it goes,
// and the server fills it with a photo from the org's mission group when the
// block is used (POST /email-blocks/ready/:key/use stores it for the org).
//
// Using one hands back a COPY with fresh ids (copyBlocks); nothing links back.

const p = text => ({ type: "p", text });
const h2 = text => ({ type: "h2", text });
const words = (...paras) => ({ type: "richtext", blocks: paras });
const photo = alt => ({ type: "image", image: null, alt, caption: "", stockPhoto: true });

export const READY_BLOCKS = [
  {
    key: "story_photo", name: "Story with a photo", hint: "One person's story, a photo and a way to read more",
    blocks: [
      photo(""),
      words(h2("[A line about one person you helped]"), p("[Tell what happened in two or three sentences, in your own words. Use a first name only with their permission.]")),
      { type: "button", action: "readmore", label: "Read the whole story", url: "" },
    ],
  },
  {
    key: "impact_numbers", name: "Impact numbers", hint: "Three of your own figures, with a line about each",
    blocks: [
      words(h2("What your giving did this year")),
      { type: "stats", items: [{ value: "", label: "[what it counts]" }, { value: "", label: "[what it counts]" }, { value: "", label: "[what it counts]" }] },
      words(p("Each of these is a person or a day that went differently because you gave. Thank you.")),
    ],
  },
  {
    key: "event_invite", name: "Event invite", hint: "A photo, the day and place, and a button to reply",
    blocks: [
      photo(""),
      words(h2("You are invited: [the event's name]"), p("[The day, the time and the place.]"), p("[One or two sentences on what the evening holds and who will be there.]")),
      { type: "button", action: "rsvp", label: "Let us know you are coming", url: "" },
      words(p("You are welcome to bring a friend. If you cannot make it, we would still love to hear from you.")),
    ],
  },
  {
    key: "director_thanks", name: "Thank-you from the director", hint: "A short thank-you, signed",
    blocks: [
      words(p("Hi {{first_name}},"), p("I wanted to write myself to say thank you. Your gift of {{last_gift_amount}} is already at work, and it matters to the people we serve."),
        p("If you ever want to see the work up close, write back and I will show you around.")),
      { type: "signature", name: "", title: "Executive Director", photo: null },
    ],
  },
  {
    key: "tax_note", name: "Year-end tax note", hint: "The lines a donor keeps for their taxes",
    blocks: [
      { type: "box", style: { bg: "cream", pad: [20, 24, 20, 24], mt: 8, mb: 8 },
        children: [words(p("For your records: {{org_name}} is a tax-exempt organization under section 501(c)(3), EIN [your EIN]. No goods or services were provided in exchange for your gifts. Please keep this email with your tax papers."))] },
    ],
  },
];

export function readyBlockByKey(key) {
  return READY_BLOCKS.find(r => r.key === key) || null;
}

// The number of parts a ready-made or saved block holds, for its card ("3 parts").
export const partsOf = blocks => (Array.isArray(blocks) ? blocks.length : 0);

// A deep copy with a fresh id on every block (a Box's children too), so a
// used block never links back to where it came from. `makeId` comes from the
// caller (the server's newId), so this module stays pure.
export function copyBlocks(blocks, makeId) {
  const one = b => {
    const c = JSON.parse(JSON.stringify(b));
    c.id = makeId();
    if (c.type === "box" && Array.isArray(c.children)) c.children = c.children.map(one);
    return c;
  };
  return (Array.isArray(blocks) ? blocks : []).map(one);
}

// The ready blocks with each `stockPhoto` place filled by `pic` ({ src, alt })
// and the marker taken off, ready for validateEmailBlocks.
export function fillStockPhotos(blocks, pic) {
  const one = b => {
    if (b && b.stockPhoto) {
      const { stockPhoto, ...rest } = b;
      return pic ? { ...rest, image: pic.src, alt: rest.alt || pic.alt || "" } : rest;
    }
    if (b && b.type === "box" && Array.isArray(b.children)) return { ...b, children: b.children.map(one) };
    return b;
  };
  return (Array.isArray(blocks) ? blocks : []).map(one);
}
