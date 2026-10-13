// mailboxFetch.js · SCALE-2. THE GMAIL HALF OF A MAILBOX READ, IN AS FEW
// SEARCHES AS GMAIL WILL RUN.
//
// A read asks Gmail only for messages that involve an address on file (the
// INT-4 rule in server.js's syncMailbox: nothing else is ever fetched). Until
// SCALE-2 it asked 15 addresses at a time, one search after another, so a
// first read for a 25,000-donor org was about 1,500 searches and a minute and
// a half before the connect page could say anything.
//
// Now one search carries as many addresses as fit in GMAIL_QUERY_MAX encoded
// characters, written with Gmail's {} grouping (one OR group, so the address is
// not followed by " OR " three times). If Gmail refuses a search as too long
// (400, 413 or 414), that search is split in half and the limit halves for the
// rest of the read, down to one address; so "as many as Gmail allows" is what
// Gmail said, not a guess. Searches run four ahead and message fetches eight at
// a time, but every message is kept in the same order as before (address
// order, then Gmail's own order), so the same 120 are kept.
//
// What a read finds is unchanged whenever no 15 addresses had more than 40
// matching messages and the whole read found under 120 (the old per-search
// and per-read limits). Past those limits the old read kept whichever 40 the
// first search returned, from donors in no fixed order; this one keeps the
// newest across the whole search, which is the better 120.
const GMAIL_MIN_CHUNK = 15;          // what every read used before SCALE-2
const LIST_AHEAD = 4;
const GET_PARALLEL = 8;
const TOO_LONG = new Set([400, 413, 414]);
const queryMax = () => Number(process.env.GMAIL_QUERY_MAX) > 0 ? Number(process.env.GMAIL_QUERY_MAX) : 6000;

// One address as Gmail search terms. An address with a character that would
// break the group is quoted.
const term = e => { const a = /[\s{}()"]/.test(e) ? `"${String(e).replace(/"/g, "")}"` : e; return `from:${a} to:${a} cc:${a}`; };
const gmailQuery = emails => "{" + emails.map(term).join(" ") + "}";
const enc = s => encodeURIComponent(s).length;

// The next search: as many addresses from `from` as fit in `max` encoded characters (at least one).
function takeChunk(emails, from, max) {
  let len = enc("{}"), i = from;
  while (i < emails.length) {
    const add = enc(term(emails[i])) + (i > from ? enc(" ") : 0);
    if (i > from && len + add > max) break;
    len += add; i++;
  }
  return emails.slice(from, i);
}
// Every search a read would send, at a fixed limit (for the tests and the measure).
function gmailChunks(emails, max = queryMax()) {
  const out = [];
  for (let i = 0; i < emails.length;) { const c = takeChunk(emails, i, max); out.push(c); i += c.length; }
  return out;
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k]); }
  }));
  return out;
}

/**
 * Read the messages that involve these addresses.
 *   ask(url, { soft }) → parsed JSON, null for a refusal it counted, or
 *     { tooLong: true } when `soft` and Gmail refused the search as too long.
 *   toMessage(full) → the normalized message (server.js gmailToMessage).
 *   onProgress(done, total) → after each search's addresses are finished.
 */
async function readGmail({ ask, base, emails, toMessage, cap = 120, onProgress = null, max = queryMax() }) {
  const out = [];
  const seen = new Set();
  const state = { max: Math.max(1, max) };
  const listUrl = (chunk, pageToken) => `${base}/gmail/v1/users/me/messages?` + new URLSearchParams({
    maxResults: String(cap), q: gmailQuery(chunk), ...(pageToken ? { pageToken } : {}) });
  const list = (chunk, pageToken) => ask(listUrl(chunk, pageToken), { soft: true });
  const pending = [];
  let cursor = 0, done = 0;
  const start = chunk => { const p = list(chunk, null); p.catch(() => {}); return { chunk, p }; };
  const fill = () => {
    while (pending.length < LIST_AHEAD && cursor < emails.length) {
      const chunk = takeChunk(emails, cursor, state.max); cursor += chunk.length; pending.push(start(chunk));
    }
  };
  // The messages of one answered page, fetched in parallel and kept in Gmail's order.
  const keepPage = async ids => {
    const fresh = [];
    for (const { id } of ids || []) if (id && !seen.has(String(id)) && !fresh.includes(String(id))) fresh.push(String(id));
    for (let k = 0; k < fresh.length && out.length < cap; ) {
      const slice = fresh.slice(k, k + (cap - out.length)); k += slice.length;
      const fulls = await mapLimit(slice, GET_PARALLEL, id => ask(`${base}/gmail/v1/users/me/messages/${id}?format=full`));
      for (const full of fulls) {
        const m = full ? toMessage(full) : null;
        if (m && m.id && !seen.has(String(m.id)) && out.length < cap) { seen.add(String(m.id)); out.push(m); }
      }
    }
  };
  for (;;) {
    fill();
    if (!pending.length || out.length >= cap) break;
    const { chunk, p } = pending.shift();
    let page = await p;
    if (page && page.tooLong) {
      if (chunk.length > 1) {
        // Too long for Gmail: this search and every one after it drop to three
        // quarters of THIS search's length (never of the current limit: the
        // searches already in flight were built before the limit fell, and
        // each one failing must not shrink it again).
        state.max = Math.max(1, Math.min(state.max, Math.floor(enc(gmailQuery(chunk)) * 3 / 4)));
        const parts = gmailChunks(chunk, state.max);
        if (parts.length < 2) parts.splice(0, 1, chunk.slice(0, Math.ceil(chunk.length / 2)), chunk.slice(Math.ceil(chunk.length / 2)));
        pending.unshift(...parts.map(start));
        continue;
      }
      page = null;   // one address refused: a refusal like any other
    }
    while (page) {
      await keepPage(page.messages);
      if (out.length >= cap || !page.nextPageToken) break;
      page = await list(chunk, page.nextPageToken);
      if (page && page.tooLong) page = null;
    }
    done += chunk.length;
    if (onProgress) await onProgress(done, emails.length);
  }
  return out;
}

module.exports = { readGmail, gmailChunks, gmailQuery, GMAIL_MIN_CHUNK, TOO_LONG, queryMax };
