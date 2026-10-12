// mailboxPush.js · PUSH-1. GMAIL AND OUTLOOK TELL STEWARD THE MOMENT SOMETHING
// CHANGES, AND THE 5-MINUTE READ BECOMES THE SAFETY NET.
//
// A notice from Google or Microsoft carries nothing Steward keeps. It says only
// "something changed in this mailbox or calendar", and Steward answers it with
// the same incremental read the tick does (FIX-34: Gmail's history id, the
// calendar's sync token, Graph delta), so what is fetched and what is stored is
// exactly what the Connections page promises and nothing more.
//
// Three kinds of notice, each verified BEFORE anything is read:
//   · Gmail: a Cloud Pub/Sub push. The request carries a Google-signed OIDC
//     token; its signature, issuer, audience and service account are checked.
//   · Google Calendar: a watch channel. The channel id, its resource id and the
//     per-channel secret token (stored only as a hash) must all match.
//   · Outlook mail and calendar: a Graph change notification. The subscription
//     id must be ours and its clientState secret (stored only as a hash) must
//     match, on every notice, lifecycle notices included.
// Anything else is refused with a 401 and one log line.
//
// Off until Jonathan sets it up: with no PUSH_BASE_URL nothing here runs, no
// channel is made, and the tick reads every 5 minutes exactly as before.
const crypto = require("crypto");

const PROVIDER_WORD = { google: "Google", microsoft: "Microsoft" };
// Which channels a connection needs, by what they cover.
const KINDS = {
  google: { mail: ["gmail"], calendar: ["gcal"] },
  microsoft: { mail: ["graph_inbox", "graph_sent"], calendar: ["graph_events"] },
};
const GRAPH_RESOURCE = {
  graph_inbox: "me/mailFolders('Inbox')/messages",
  graph_sent: "me/mailFolders('SentItems')/messages",
  graph_events: "me/events",
};
// Renewal timing. Gmail: Google asks for watch() to be called again every day
// (a watch lasts at most 7 days). Calendar: channels are asked for 7 days and
// renewed with 2 left. Graph: Outlook messages and events last at most 10,080
// minutes; Steward asks for 10,070 and renews with 3 days left.
const DAY = 864e5;
const RENEW_AHEAD_MS = { gmail: 6 * DAY, gcal: 2 * DAY, graph_inbox: 3 * DAY, graph_sent: 3 * DAY, graph_events: 3 * DAY };
const GCAL_TTL_SECONDS = 7 * 86400;
const GRAPH_MAX_MINUTES = 10070;
// The two cadences. With instant updates on, the tick still reads every 30
// minutes, as the check that they really are arriving.
const SAFETY_POLL_MS = 30 * 60e3;
const FALLBACK_POLL_MS = 5 * 60e3;
// A paused channel is tried again at most once an hour.
const RETRY_PAUSED_MS = 60 * 60e3;
const PROVIDER_TIMEOUT_MS = 20000;

function config(env = process.env) {
  const base = String(env.PUSH_BASE_URL || "").trim().replace(/\/+$/, "");
  return {
    base: base || null,
    gmailTopic: env.GMAIL_PUBSUB_TOPIC || null,
    pubsubAccount: env.PUBSUB_PUSH_SERVICE_ACCOUNT || null,
    pubsubAudience: env.PUBSUB_PUSH_AUDIENCE || (base ? base + "/push/google/gmail" : null),
    certsUrl: env.GOOGLE_OIDC_CERTS_URL || "https://www.googleapis.com/oauth2/v3/certs",
    gmailBase: env.GMAIL_API_BASE || "https://gmail.googleapis.com",
    calBase: env.GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com",
    graphBase: env.GRAPH_API_BASE || "https://graph.microsoft.com",
  };
}
// Gmail needs the topic AND the account the push subscription signs as, or no
// notice could ever be verified; the other two need only the public URL.
function kindEnabled(kind, cfg = config()) {
  if (!cfg.base) return false;
  if (kind === "gmail") return !!(cfg.gmailTopic && cfg.pubsubAccount);
  return true;
}
function wantedKinds(conn, cfg = config()) {
  const k = KINDS[conn.provider];
  if (!k) return [];
  return [...k.mail, ...(conn.calendar_granted === true ? k.calendar : [])].filter(x => kindEnabled(x, cfg));
}
const whatOf = kind => (kind === "gmail" || kind === "graph_inbox" || kind === "graph_sent") ? "mail" : "calendar";

const newSecret = () => crypto.randomBytes(32).toString("base64url");
const hashSecret = s => crypto.createHash("sha256").update(String(s || "")).digest("hex");
function secretMatches(given, storedHash) {
  if (!given || !storedHash) return false;
  const a = Buffer.from(hashSecret(given), "hex"), b = Buffer.from(String(storedHash), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── THE GMAIL NOTICE: A GOOGLE-SIGNED OIDC TOKEN ───────────────────────────
// Google's keys are cached for an hour. An unknown key id fetches them again,
// but at most once every 5 minutes, so a stream of forged tokens cannot turn
// into a stream of requests to Google.
let keyCache = { url: null, at: 0, keys: [], refetchedAt: 0 };
async function googleKeys(url, { force = false } = {}) {
  const fresh = keyCache.url === url && Date.now() - keyCache.at < 3600e3;
  if (fresh && !force) return keyCache.keys;
  if (force && keyCache.url === url && Date.now() - keyCache.refetchedAt < 5 * 60e3) return keyCache.keys;
  const r = await fetch(url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) }).catch(() => null);
  const b = r && r.ok ? await r.json().catch(() => null) : null;
  if (!b || !Array.isArray(b.keys)) return keyCache.url === url ? keyCache.keys : [];
  keyCache = { url, at: Date.now(), keys: b.keys, refetchedAt: force ? Date.now() : keyCache.refetchedAt };
  return b.keys;
}
const b64json = s => { try { return JSON.parse(Buffer.from(s, "base64url").toString("utf8")); } catch { return null; } };
async function verifyPubsubToken(authorization, cfg = config()) {
  const m = /^Bearer\s+([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(String(authorization || ""));
  if (!m) return { ok: false, why: "no signed token" };
  const header = b64json(m[1]), claims = b64json(m[2]);
  if (!header || !claims || header.alg !== "RS256") return { ok: false, why: "not an RS256 token" };
  let keys = await googleKeys(cfg.certsUrl);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { keys = await googleKeys(cfg.certsUrl, { force: true }); jwk = keys.find(k => k.kid === header.kid); }
  if (!jwk) return { ok: false, why: "unknown signing key" };
  let good = false;
  try {
    const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
    good = crypto.verify("RSA-SHA256", Buffer.from(m[1] + "." + m[2]), key, Buffer.from(m[3], "base64url"));
  } catch { good = false; }
  if (!good) return { ok: false, why: "bad signature" };
  const now = Math.floor(Date.now() / 1000);
  if (!["https://accounts.google.com", "accounts.google.com"].includes(claims.iss)) return { ok: false, why: "wrong issuer" };
  if (claims.aud !== cfg.pubsubAudience) return { ok: false, why: "wrong audience" };
  if (!cfg.pubsubAccount || claims.email !== cfg.pubsubAccount || claims.email_verified !== true) return { ok: false, why: "wrong service account" };
  if (!(Number(claims.exp) > now - 60) || Number(claims.iat) > now + 300) return { ok: false, why: "expired" };
  return { ok: true };
}

// ── MAKING, RENEWING AND STOPPING A CHANNEL ────────────────────────────────
const call = (url, token, method = "GET", body) => fetch(url, {
  method, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
async function answer(r, kind) {
  const b = await r.json().catch(() => null);
  if (r.ok) return b || {};
  const msg = (b && b.error && (b.error.message || b.error.code)) || `answered ${r.status}`;
  throw Object.assign(new Error(`${kind}: ${String(msg).slice(0, 200)}`), { status: r.status });
}
async function startChannel(kind, token, cfg = config()) {
  if (kind === "gmail") {
    const b = await answer(await call(`${cfg.gmailBase}/gmail/v1/users/me/watch`, token, "POST",
      { topicName: cfg.gmailTopic, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "INCLUDE" }), kind);
    return { channelId: null, resourceId: null, secret: null, expiresAt: new Date(Number(b.expiration) || Date.now() + 7 * DAY) };
  }
  if (kind === "gcal") {
    const secret = newSecret(), id = "stw-" + crypto.randomUUID();
    const b = await answer(await call(`${cfg.calBase}/calendar/v3/calendars/primary/events/watch`, token, "POST",
      { id, type: "web_hook", address: cfg.base + "/push/google/calendar", token: secret, params: { ttl: String(GCAL_TTL_SECONDS) } }), kind);
    return { channelId: id, resourceId: b.resourceId || null, secret, expiresAt: new Date(Number(b.expiration) || Date.now() + GCAL_TTL_SECONDS * 1000) };
  }
  // Graph checks the notification URL before it answers: it posts a
  // validationToken there and needs it echoed back (handleGraph does that).
  const secret = newSecret();
  const b = await answer(await call(`${cfg.graphBase}/v1.0/subscriptions`, token, "POST", {
    changeType: "created,updated,deleted", resource: GRAPH_RESOURCE[kind],
    notificationUrl: cfg.base + "/push/microsoft", lifecycleNotificationUrl: cfg.base + "/push/microsoft",
    expirationDateTime: new Date(Date.now() + GRAPH_MAX_MINUTES * 60e3).toISOString(), clientState: secret }), kind);
  return { channelId: b.id, resourceId: null, secret, expiresAt: new Date(b.expirationDateTime || Date.now() + GRAPH_MAX_MINUTES * 60e3) };
}
async function stopChannel(row, token, cfg = config()) {
  try {
    if (row.kind === "gmail") await call(`${cfg.gmailBase}/gmail/v1/users/me/stop`, token, "POST", {});
    else if (row.kind === "gcal" && row.channel_id) await call(`${cfg.calBase}/calendar/v3/channels/stop`, token, "POST", { id: row.channel_id, resourceId: row.resource_id });
    else if (row.channel_id) await call(`${cfg.graphBase}/v1.0/subscriptions/${encodeURIComponent(row.channel_id)}`, token, "DELETE");
  } catch { /* best effort: an unstopped channel expires on its own, and its notices no longer verify */ }
}
// Gmail renews by watching again; Graph by extending the same subscription
// (a 404 means it is gone, so a new one); a calendar channel cannot be
// extended, so a new one is made and the old one stopped.
async function renewChannel(row, token, cfg = config()) {
  if (row.kind.startsWith("graph_") && row.channel_id) {
    const r = await call(`${cfg.graphBase}/v1.0/subscriptions/${encodeURIComponent(row.channel_id)}`, token, "PATCH",
      { expirationDateTime: new Date(Date.now() + GRAPH_MAX_MINUTES * 60e3).toISOString() });
    if (r.status !== 404) {
      const b = await answer(r, row.kind);
      return { channelId: row.channel_id, resourceId: null, secret: undefined, expiresAt: new Date(b.expirationDateTime || Date.now() + GRAPH_MAX_MINUTES * 60e3) };
    }
  }
  const made = await startChannel(row.kind, token, cfg);
  if (row.kind === "gcal") await stopChannel(row, token, cfg);
  return made;
}

// ── KEEPING ONE CONNECTION'S CHANNELS ALIVE (the tick calls this) ──────────
// deps: { query, run, token: () => Promise<string|null>, now? }
async function ensurePush(conn, deps, cfg = config()) {
  const kinds = wantedKinds(conn, cfg);
  const rows = await deps.query(`SELECT * FROM mailbox_push WHERE connection_id=?`, [conn.id]);
  const byKind = new Map(rows.map(r => [r.kind, r]));
  const now = Date.now();
  let token = null;
  const tok = async () => (token = token || await deps.token());
  const done = [];
  // A channel this connection no longer wants (calendar unticked, or the
  // server lost its config) is stopped and forgotten.
  for (const r of rows) if (!kinds.includes(r.kind)) {
    if (await tok()) await stopChannel(r, token, cfg);
    await deps.run(`DELETE FROM mailbox_push WHERE id=?`, [r.id]);
  }
  for (const kind of kinds) {
    const row = byKind.get(kind);
    const expires = row && row.expires_at ? new Date(row.expires_at).getTime() : 0;
    const due = !row
      || (row.status === "paused" && (!row.retry_at || new Date(row.retry_at).getTime() <= now))
      || (row.status === "on" && expires - now < RENEW_AHEAD_MS[kind]);
    if (!due) continue;
    if (!(await tok())) return done;   // the token was refused: the read itself says so
    const verb = !row ? "start" : row.status === "paused" ? "restart" : "renew";
    try {
      const ch = row && row.status === "on" ? await renewChannel(row, token, cfg)
        : await (async () => { if (row) await stopChannel(row, token, cfg); return startChannel(kind, token, cfg); })();
      const secretHash = ch.secret === undefined ? (row && row.secret_hash) : ch.secret ? hashSecret(ch.secret) : null;
      if (row) {
        await deps.run(`UPDATE mailbox_push SET channel_id=?, resource_id=?, secret_hash=?, expires_at=?, renewed_at=NOW(), status='on',
                               paused_reason=NULL, paused_at=NULL, retry_at=NULL, last_error=NULL, updated_at=NOW() WHERE id=?`,
          [ch.channelId, ch.resourceId, secretHash, ch.expiresAt.toISOString(), row.id]);
      } else {
        await deps.run(`INSERT INTO mailbox_push (id,org_id,connection_id,user_id,provider,kind,channel_id,resource_id,secret_hash,expires_at,renewed_at,
                                                  status,created_by,created_by_name)
                        VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),'on',?,?) ON CONFLICT (connection_id, kind) DO NOTHING`,
          ["mpush_" + crypto.randomUUID().slice(0, 12), conn.org_id, conn.id, conn.user_id, conn.provider, kind,
           ch.channelId, ch.resourceId, secretHash, ch.expiresAt.toISOString(), `system:push/${conn.provider}/${conn.user_id}`, "Instant updates"]);
      }
      done.push({ kind, verb, ok: true });
    } catch (e) {
      console.error(`[push] ${conn.provider} ${kind} ${verb} for ${conn.id} failed:`, e.message);
      const reason = verb === "renew" ? "renew_failed" : "start_failed";
      if (row) await pauseRows(deps, [row.id], reason, e.message);
      else await deps.run(`INSERT INTO mailbox_push (id,org_id,connection_id,user_id,provider,kind,status,paused_reason,paused_at,retry_at,last_error,
                                                     created_by,created_by_name)
                           VALUES (?,?,?,?,?,?,'paused',?,NOW(),?,?,?,?) ON CONFLICT (connection_id, kind) DO NOTHING`,
        ["mpush_" + crypto.randomUUID().slice(0, 12), conn.org_id, conn.id, conn.user_id, conn.provider, kind, reason,
         new Date(now + RETRY_PAUSED_MS).toISOString(), String(e.message).slice(0, 300), `system:push/${conn.provider}/${conn.user_id}`, "Instant updates"]);
      done.push({ kind, verb, ok: false });
    }
  }
  return done;
}
async function pauseRows(deps, ids, reason, error = null) {
  if (!ids.length) return;
  await deps.run(`UPDATE mailbox_push SET status='paused', paused_reason=?, paused_at=NOW(), retry_at=?, last_error=?, updated_at=NOW()
                   WHERE id = ANY(?)`, [reason, new Date(Date.now() + RETRY_PAUSED_MS).toISOString(), error ? String(error).slice(0, 300) : null, ids]);
}

// ── HOW OFTEN THE TICK READS ───────────────────────────────────────────────
// Push is "on" for mail (or calendar) only when every channel it needs is on
// and unexpired. Then the tick reads every 30 minutes; otherwise every 5.
function pushState(conn, rows, what, cfg = config()) {
  const kinds = (KINDS[conn.provider] || {})[what] || [];
  if (what === "calendar" && conn.calendar_granted !== true) return { configured: false };
  if (!kinds.length || !kinds.every(k => kindEnabled(k, cfg))) return { configured: false };
  const mine = kinds.map(k => rows.find(r => r.kind === k));
  const now = Date.now();
  const paused = mine.find(r => r && r.status === "paused");
  const on = mine.every(r => r && r.status === "on" && r.expires_at && new Date(r.expires_at).getTime() > now);
  const notices = mine.map(r => r && r.last_notified_at ? new Date(r.last_notified_at).getTime() : 0);
  return { configured: true, on, paused: paused ? paused.paused_reason || "stopped" : (on ? null : (mine.some(r => r && r.status === "on") ? "expired" : null)),
           lastNoticeAt: Math.max(0, ...notices) ? new Date(Math.max(...notices)).toISOString() : null,
           rowIds: mine.filter(Boolean).map(r => r.id) };
}
// Due when push is not on and the last good read is 5 minutes old (the tick's
// own cadence, so: every tick), or push is on and it is 30 minutes old.
function readDue(state, lastOkAt, now = Date.now()) {
  if (!lastOkAt) return true;
  const age = now - new Date(lastOkAt).getTime();
  return state.on ? age >= SAFETY_POLL_MS - 60e3 : true;
}
// The safety read found a change that no notice announced: push stopped.
// `gatedChange` is true only when the incremental check itself (history id,
// sync token, delta link) said something changed, never for a first read.
function missedNotice(state, gatedChange, prevOkAt) {
  if (!state.on || !gatedChange || !prevOkAt) return false;
  return !state.lastNoticeAt || new Date(state.lastNoticeAt).getTime() < new Date(prevOkAt).getTime();
}
function instantSentence(state, provider) {
  const who = PROVIDER_WORD[provider] || "The provider";
  if (!state || !state.configured) return null;
  if (state.on) return "Instant updates: on";
  const why = state.paused === "stopped" ? `${who} stopped sending`
    : state.paused === "renew_failed" ? `${who} would not renew them`
    : state.paused === "start_failed" ? `${who} would not turn them on`
    : state.paused === "expired" ? `${who}'s permission for them ran out`
    : null;
  return why ? `Instant updates paused: ${why}. Reading every 5 minutes.` : "Instant updates: starting. Reading every 5 minutes until they do.";
}

module.exports = {
  KINDS, GRAPH_RESOURCE, RENEW_AHEAD_MS, GRAPH_MAX_MINUTES, GCAL_TTL_SECONDS, SAFETY_POLL_MS, FALLBACK_POLL_MS, RETRY_PAUSED_MS,
  config, kindEnabled, wantedKinds, whatOf, newSecret, hashSecret, secretMatches, verifyPubsubToken,
  startChannel, renewChannel, stopChannel, ensurePush, pauseRows, pushState, readDue, missedNotice, instantSentence,
};
