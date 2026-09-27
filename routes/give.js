// routes/give.js — Steward Give: giving pages, forms, the donor portal, donor accounts, recurring gifts and giving sources.
//
// FIX-1 split: these routes and the helpers only they use were moved here
// VERBATIM from server.js. Nothing in them changed.
//
// How it is wired, so it behaves exactly as it did inside server.js:
//   * Each router below is mounted in server.js with app.use(...) at the place
//     its first route used to be declared, so it keeps its place in the stack
//     (before or after the same middleware, before or after the same routes).
//   * server.js calls mount() once, at the end of boot, when every binding the
//     code below reads exists. `app` inside mount() is the current router, so
//     the unchanged `app.get(...)` lines register on it.
//   * `__dirname` is server.js's own, so every path built from it resolves as
//     before; a relative require()/import() reads "../x" because it resolves
//     against this file, one folder down (readSource reads it back as "./x").
// Tests read this file through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");

const routers = {
  r0: express.Router(),
  r1: express.Router(),
};

function mount(ctx) {
const {
  ASSET_ID_RE, CARD_CHECK_BUDGET, DONOR_ACCOUNTS_ENABLED, DONOR_MAIL_ADDR, GIVE_MONTHLY_DEFAULT,
  GIVE_ONETIME_DEFAULT, GIVE_THEME_COLS, NETWORK_SIGNUP_ENABLED, PORTAL_CARD_STYLES,
  PORTAL_TYPE_PAIRINGS, RECOVERY_SECRET, accountEmailLimiter, accountIpLimiter, actor,
  addOrgLimiter, bcrypt, brandEmailHeaderHtml, buildCardUpdateUrl, bumpFormEvent,
  checkThemeImageDimensions, checkWriteAccess, classifySourceError, computeRecoveryRate,
  consumerEmailHtml, crypto, directorySearchLimiter, displayNameCase, donateLimiter, donorAudit,
  donorFacingOrgName, donorFromAddress, donorMailDecision, donorSendOpts, einLookup,
  ensureOrgLedger, escHtmlWf, escapeHtml, express, foldEmail, formConfigMod, fromWithDisplayName,
  fundraiserManageLimiter, getThemeAsset, giveThemePayload, invitationLimiter, linkAccountEmail,
  logRecoveryEvent, logRecurringChange, networkSignupLimiter, normalizeAccent, normalizeTint,
  normalizeUploadImage, notifyExpiringCards, notifyUserOnce, orgOwns, orgSendingIdentity, orgTime,
  orgToday, orgTz, parseCrop, portalCardTheme, portalLinkEmailLimiter, portalLinkIpLimiter,
  portalMutationLimiter, portalTimeline, processDunning, processGivingSources, pruneThemeAssets,
  pruneUnreferencedAssets, publicAppUrl, purgeExpiredAssets, putThemeAsset, query,
  recordAssetPointerHistory, recordGift, refreshCardsOnFile, requireAdmin, requireAuth, requireFlag,
  resend, resolveWidgetsPublic, run, sendDonorLifecycleEmail, sendDunningEmail, signToken,
  slugifyGivingPage, sourceAdapters, sourceConfig, sourceErrorSentence, stripe,
  stripeChargesEnabled, sustainerFileFacts, sweepMissedRecurring, syncSource, testMode, toCents,
  toDollars, uploadImageError, uuid, validateStoryBlocks, widgetMod, withAdvisoryLock, wrap,
} = ctx;
let app = routers.r0;

// BUILD-57 §2a (real-Stripe finding): a Checkout-born subscription's product
// is auto-created, INACTIVE, and IMMUTABLE ("created by Stripe automatically
// and cannot be updated") — so a reprice can never reuse it. Every reprice
// instead rides ONE durable, metadata-tagged product per connected account,
// found by search (create-on-miss; search lag can mint a rare duplicate
// product, which is harmless catalog clutter, never money).
async function ensureRecurringGiftProduct(stripeAccount, orgName) {
  try {
    const found = await stripe.products.search(
      { query: "active:'true' AND metadata['steward']:'recurring_gift'", limit: 1 },
      { stripeAccount });
    if (found?.data?.[0]?.id) return found.data[0].id;
  } catch { /* search unsupported/lagging — create below */ }
  const p = await stripe.products.create(
    { name: `${orgName} recurring gift`, metadata: { steward: "recurring_gift" } },
    { stripeAccount });
  return p?.id;
}

// BUILD-95 §5A — the answers an organisation gave a source, as a plain object.
// Never null: an adapter reads `config.locationIds` without guarding, and a
// null here would be the difference between "import nothing" and a crash.
// What a client may put in a source's config, and nothing else. An unknown
// key is DROPPED rather than stored: this object is read by an adapter that
// decides whether somebody's money becomes a gift, and it is not a place for
// a request body to put whatever it likes.
function normalizeSourceConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const out = {};
  if (Array.isArray(c.locationIds)) {
    out.locationIds = c.locationIds.map(x => String(x).trim()).filter(Boolean).slice(0, 50);
  }
  if (c.onlyNoteContains !== undefined) {
    out.onlyNoteContains = String(c.onlyNoteContains || "").trim().slice(0, 120);
  }
  return out;
}

// ── Request an invitation (public — invitation pivot, 2026-08-06) ──────────
// The landing/invitation form. No CAPTCHA by design (trust cost on a
// credibility page): a hidden honeypot field + a minimum-fill-time check
// stand in for it. Both bot signals return the SAME success response as a
// real submission — never tip a bot off that it was filtered — they just
// store nothing and email no one.
app.post("/invitation-request", invitationLimiter, wrap(async (req, res) => {
  const { name, email, organization, role, donorBand, hardestPart, website, elapsedMs } = req.body || {};
  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const n = clean(name, 120), e = clean(email, 200), org = clean(organization, 200);
  if (!n || !e || !org) return res.status(400).json({ error: "name, email, and organization are required" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: "That email doesn't look right" });

  // Honeypot: `website` is a visually-hidden field no human sees. Timing: the
  // client reports ms since the form rendered; a sub-3s fill is not a person.
  const isBot = !!clean(website, 500) || (elapsedMs !== undefined && Number(elapsedMs) < 3000);
  if (!isBot) {
    const id = "invreq_" + uuid().slice(0, 8);
    await run(
      `INSERT INTO invitation_requests (id, name, email, organization, role, donor_band, hardest_part)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, n, e, org, clean(role, 120) || null, clean(donorBand, 40) || null, clean(hardestPart, 2000) || null]
    );
    // Notify the founder — fire-and-forget; the stored row is the source of
    // truth, a mail failure must never fail the request.
    if (process.env.RESEND_API_KEY) {
      const founderEmail = process.env.FOUNDER_EMAIL || "jonathan@stewardapp.dev";
      const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      resend.emails.send({
        from: "Steward <noreply@stewardapp.dev>",
        to: founderEmail,
        replyTo: e,   // BUILD-88c C.1 — the SDK ignores `reply_to`; see donorSendOpts
        subject: `Invitation request — ${org}`,
        html: `<div style="font-family:Georgia,serif;line-height:1.7;color:#0f1a12">
          <p><strong>${esc(n)}</strong> (${esc(e)})<br/>${esc(org)}${role ? " · " + esc(clean(role, 120)) : ""}</p>
          <p>Donor database: ${esc(clean(donorBand, 40) || "not answered")}</p>
          <p>Hardest part of keeping donors: ${esc(clean(hardestPart, 2000) || "—")}</p>
        </div>`,
      }).catch(err => console.error("invitation-request notify failed:", err?.message || err));
    }
  }
  res.json({ received: true });
}));
app = routers.r1;

// The history. Newest first, read only.

// ---- BUILD-89S 89a - GIVING SOURCE ROUTES --------------------------------
//
// Every one of these is a READ or a local write. Nothing here can send money,
// and nothing here can write to a provider: the adapters only ever receive the
// read-only http handle, and that handle refuses a non-GET.
//
// Route ORDER matters (CLAUDE.md): the literal paths are declared before any
// "/giving-sources/:id" so Express never resolves "providers" as an id.

// What an org CAN connect, and what Steward would need from them. Read-only,
// no credentials involved, so plain requireAuth.
app.get("/giving-sources/providers", requireAuth, wrap(async (req, res) => {
  const { PROVIDERS } = await import("../shared/givingSources.js");
  const { credentialsConfigured, credentialKeyProblem } = await import("../shared/secretBox.js");
  res.json({
    // A provider is offered only when an adapter for it actually exists and
    // loads. An advertised connection that does not work is worse than an
    // absent one - the whole build is an answer to "do we have to switch".
    providers: Object.values(PROVIDERS).map(p => ({
      key: p.key, label: p.label, mode: p.mode, recurring: p.recurring,
      credentialFields: p.credentialFields, help: p.help, delay: p.delay || null,
      // BUILD-92 B2 — the numbered steps and the "this can take a day" note
      // come from the registry so the panel quotes ONE description of another
      // company's screens. Both are optional; a provider without them falls
      // back to `help`.
      steps: p.steps || null, waitNote: p.waitNote || null,
      available: p.mode === "file" ? true : sourceAdapters.adapterAvailable(p.key),
    })),
    // The one honest reason a connect button can be unavailable for every
    // provider at once. 89f turns this into a sentence for an administrator.
    credentialsReady: credentialsConfigured(),
    credentialsProblem: credentialKeyProblem(),
  });
}));

// "Where giving comes in." One row per source, with the sentence 89f renders.
app.get("/giving-sources", requireAuth, wrap(async (req, res) => {
  const { providerLabel } = await import("../shared/givingSources.js");
  const orgRow = await query(`SELECT other_giving_sources FROM orgs WHERE id = ?`, [req.user.orgId]);
  const rows = await query(
    `SELECT s.*, f.name AS fund_name,
            (SELECT COUNT(*) FROM gifts g
              WHERE g.org_id = s.org_id AND g.giving_source_id = s.id
                AND g.date >= TO_CHAR(NOW() - INTERVAL '7 days', 'YYYY-MM-DD')) AS gifts_this_week,
            (SELECT COUNT(*) FROM gifts g
              WHERE g.org_id = s.org_id AND g.giving_source_id = s.id) AS gifts_total
       FROM giving_sources s
       LEFT JOIN fin_funds f ON f.id = s.default_fund_id AND f.org_id = s.org_id
      WHERE s.org_id = ? ORDER BY s.created_at ASC`, [req.user.orgId]);
  res.json({
    sources: rows.map(r => ({
      id: r.id, provider: r.provider, providerLabel: providerLabel(r.provider),
      displayName: r.display_name, status: r.status,
      defaultFundId: r.default_fund_id, defaultFundName: r.fund_name || null,
      sitsOnTopOf: r.sits_on_top_of || null,
      lastSyncedAt: r.last_synced_at, lastError: r.last_error, lastErrorAt: r.last_error_at,
      // BUILD-92 A2 — ONE error per source (the sentence), with the provider's
      // own facts beside it, and the moment Steward last TRIED. `last_tried_at`
      // is stamped on every attempt, so a source that failed on its first
      // check can no longer read "never checked" next to an error - which is
      // the screen telling a person two contradictory things at once.
      lastErrorStatus: r.last_error_status === null || r.last_error_status === undefined ? null : Number(r.last_error_status),
      lastErrorProviderCode: r.last_error_provider_code || null,
      lastTriedAt: r.last_tried_at || r.last_error_at || r.last_synced_at || null,
      lastRunId: r.last_run_id,
      giftsThisWeek: Number(r.gifts_this_week) || 0, giftsTotal: Number(r.gifts_total) || 0,
      // Never "live", never "real time": Steward checks every six hours and a
      // provider can publish hours late. The screen says when it last looked.
      everChecked: !!(r.last_tried_at || r.last_error_at || r.last_synced_at),
      // Deliberately never the credential, and never a prefix of it.
      hasCredentials: !!r.credentials_sealed,
    })),
    // BUILD-92 B2 — what this organisation told us it also uses. No adapter,
    // no credential, no claim: a name, so the page can say it back and the
    // product knows what it keeps being asked for.
    otherSources: readOtherSources(orgRow[0] && orgRow[0].other_giving_sources),
  });
}));

// BUILD-92 A2 — ONE credential-cleaning rule, at the door, for every provider.
// A key copied out of a browser or a password manager arrives with a trailing
// newline or a leading space more often than not, and a secret with a newline
// on the end is a secret the provider refuses - which then reads as a wrong
// key and sends a person back to re-copy something that was already correct.
// Trimmed BEFORE it is tested and BEFORE it is sealed, so what Steward stores
// is exactly what it proved works. Only the outer whitespace goes; nothing
// inside a credential is touched.
function trimCredentials(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

// The ONE provider-test path. `/giving-sources/test` (the Test button) and
// `POST /giving-sources` (connect) both run THIS - a second implementation is
// a second set of rules about what "it works" means.
// Returns { ok, count, totalCents, message } or { ok:false, kind, status,
// providerCode, message } - never throws for a provider-side failure.
async function runSourceCredentialTest(provider, credentials, orgId, config) {
  const { PROVIDERS } = await import("../shared/givingSources.js");
  const spec = PROVIDERS[provider];
  const adapter = sourceAdapters.getAdapter(provider);
  if (!adapter) return { ok: false, kind: "NO_ADAPTER", status: null, providerCode: null,
                         message: `Steward does not read ${spec?.label || provider} automatically yet.` };
  const org = await orgTz(orgId);
  const today = orgToday(org);                          // ORG_TZ_SEAM_OK
  const http = sourceAdapters.readOnlyHttp(provider);
  try {
    // BUILD-95 §5A — the Test button has to tell Square's truth in BOTH
    // directions: the token works, AND nothing is being imported yet because
    // nobody has said which locations are giving.
    const out = await adapter.testCredentials({ credentials, http, today, config: config || {} });
    return { ok: !!out?.ok, kind: "ok", status: null, providerCode: null,
             count: out?.count || 0, totalCents: out?.totalCents || 0,
             message: out?.message || null, requests: http.requests.length };
  } catch (e) {
    const { kind, status, providerCode } = classifySourceError(e);
    return { ok: false, kind, status, providerCode,
             message: sourceErrorSentence(e, { provider, display_name: spec?.label || provider }),
             requests: http.requests.length };
  }
}

// Whether connect should TALK to the provider before it saves.
//
// In production this is always true: refusing a credential the provider has
// already rejected is the whole point of item 3. The one carve-out is a TEST
// boot that has not been handed a local seam for this provider - there the
// only thing on the other end of the wire is the real provider, and a suite
// must never reach for one. A test boot that DOES set the provider's base
// (tests/build92-source-errors.test.js boots a child server that way) verifies
// exactly as production does, which is how the refusal is proven at all.
const PROVIDER_BASE_ENV = {
  paypal: ["PAYPAL_API_BASE"],
  zeffy: ["ZEFFY_API_BASE"],
  stripe: ["STRIPE_SOURCE_API_BASE", "STRIPE_API_BASE"],
  givebutter: ["GIVEBUTTER_API_BASE"],
};
function verifyBeforeSaving(provider) {
  if (!process.env.TEST_MODE) return true;
  return (PROVIDER_BASE_ENV[provider] || []).some(k => !!process.env[k]);
}

// ── BUILD-92 A3 — THE QUESTIONS, AND THEIR TWO ANSWERS ─────────────────────
// Declared above "/giving-sources/:id" so Express never resolves "duplicates"
// as a source id - the same rule "providers" already lives by.
//
// A question is ONE LINE. It exists because Steward refused to guess, and it
// stays until a human answers it. Nothing here writes money by itself.
app.get("/giving-sources/duplicates", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT q.*, d.name AS donor_name, s.display_name AS source_name, s.provider AS source_provider,
            e.display_name AS existing_source_name
       FROM gift_duplicate_questions q
       LEFT JOIN donors d ON d.id = q.donor_id AND d.org_id = q.org_id
       LEFT JOIN giving_sources s ON s.id = q.source_id AND s.org_id = q.org_id
       LEFT JOIN giving_sources e ON e.id = q.existing_source_id AND e.org_id = q.org_id
      WHERE q.org_id = ? AND q.status = 'open'
      ORDER BY q.created_at ASC, q.id ASC`, [req.user.orgId]);
  res.json({
    questions: rows.map(r => ({
      id: r.id, sentence: r.sentence,
      donorId: r.donor_id, donorName: r.donor_name || null,
      amountCents: Number(r.amount_cents) || 0, occurredAt: r.occurred_at,
      sourceId: r.source_id, sourceName: r.source_name || r.source_provider,
      existingGiftId: r.existing_gift_id, existingSourceId: r.existing_source_id,
      existingSourceName: r.existing_source_name || null,
      createdAt: r.created_at,
    })),
  });
}));

// "Same gift." The second id goes ONTO the gift that is already on file, so
// the question never returns - not on the next sync, not on any sync, and not
// if the source is disconnected and reconnected.
app.post("/giving-sources/duplicates/:id/same-gift", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [q0] = await query("SELECT * FROM gift_duplicate_questions WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!q0) return res.status(404).json({ error: "question not found" });
  if (q0.status !== "open") return res.status(409).json({ error: "already_answered", status: q0.status });
  const a = actor(req);
  await run(
    `UPDATE gifts SET also_external_ids = COALESCE(also_external_ids, '[]'::jsonb) || ?::jsonb
      WHERE id=? AND org_id=?`, [JSON.stringify([q0.external_key]), q0.existing_gift_id, orgId]);
  await run(
    `UPDATE gift_duplicate_questions SET status='same_gift', resolved_at=NOW(), resolved_by=?, resolved_by_name=?
      WHERE id=? AND org_id=?`, [a.id, a.name, q0.id, orgId]);
  res.json({ ok: true, status: "same_gift", giftId: q0.existing_gift_id });
}));

// "Keep both." The provider's row was kept whole on the question, so the gift
// is written now, through recordGift, exactly as the sync would have written
// it. One gift, one write path - there is no second one here either.
app.post("/giving-sources/duplicates/:id/keep-both", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [q0] = await query("SELECT * FROM gift_duplicate_questions WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!q0) return res.status(404).json({ error: "question not found" });
  if (q0.status !== "open") return res.status(409).json({ error: "already_answered", status: q0.status });
  const [source] = await query("SELECT * FROM giving_sources WHERE id=? AND org_id=?", [q0.source_id, orgId]);
  if (!source) return res.status(404).json({ error: "source not found" });
  const row = typeof q0.candidate === "string" ? JSON.parse(q0.candidate) : q0.candidate;
  const a = actor(req);
  const written = await recordGift({
    orgId, donorId: q0.donor_id,
    amount: (Number(q0.amount_cents) || 0) / 100,
    date: q0.occurred_at,
    type: "cash",
    notes: row?.memo || "",
    fundId: source.default_fund_id || null,
    defaultFund: false,
    paymentMethod: source.display_name,
    externalId: q0.external_key,
    conflict: "external",
    givingSourceId: source.id,
    processorFeeAmount: (Number(row?.feeCents) || 0) / 100,
    providerRecurringRef: row?.recurringRef || null,
    post: true,
    source: `giving-source:${source.provider}`,
    actorId: a.id, actorName: a.name,
    thankYou: true,
  });
  await run(
    `UPDATE gift_duplicate_questions SET status='kept_both', resolved_at=NOW(), resolved_by=?, resolved_by_name=?
      WHERE id=? AND org_id=?`, [a.id, a.name, q0.id, orgId]);
  res.json({ ok: true, status: "kept_both", giftId: written?.gift?.id || null, duplicate: !!written?.duplicate });
}));

// The JSONB column answers as an array, a JSON string, or null depending on
// the driver and the row's age. One reader, so no caller has to know that.
function readOtherSources(raw) {
  if (Array.isArray(raw)) return raw.filter(v => typeof v === "string");
  if (typeof raw === "string") {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p.filter(v => typeof v === "string") : []; }
    catch { return []; }
  }
  return [];
}

// POST /giving-sources/other — record a source Steward cannot connect to.
// ADDITIVE AND DELIBERATELY SMALL: it stores a name and nothing else. The
// gifts themselves arrive through the ordinary statement import, which is why
// this route neither creates a giving_sources row nor promises a sync.
app.post("/giving-sources/other", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const name = String((req.body || {}).name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) return res.status(400).json({ error: "name_required", message: "Type the name of the place gifts come in." });
  const orgRow = await query(`SELECT other_giving_sources FROM orgs WHERE id = ?`, [req.user.orgId]);
  const have = readOtherSources(orgRow[0] && orgRow[0].other_giving_sources);
  // Case-folded dedupe: "Donorbox" and "donorbox" are one answer, and the
  // list is capped so a stuck client cannot grow a column without bound.
  const next = have.some(v => v.toLowerCase() === name.toLowerCase()) ? have : [...have, name].slice(-25);
  await run(`UPDATE orgs SET other_giving_sources = ? WHERE id = ?`, [JSON.stringify(next), req.user.orgId]);
  console.log(`[giving-sources] org ${req.user.orgId} named another source: ${name}`);
  res.json({ ok: true, otherSources: next });
}));

// Test a key WITHOUT storing it: the last seven days, a count and a total.
// She sees her own numbers before anything is written, which is the only way
// to know a key works. Nothing is persisted on this path at all.
app.post("/giving-sources/test", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { PROVIDERS } = await import("../shared/givingSources.js");
  const provider = String(req.body?.provider || "");
  const spec = PROVIDERS[provider];
  if (!spec || spec.mode !== "api") return res.status(400).json({ error: "unknown_provider" });
  const adapter = sourceAdapters.getAdapter(provider);
  if (!adapter) return res.status(400).json({ error: "adapter_unavailable", message: `Steward does not read ${spec.label} automatically yet.` });
  const credentials = trimCredentials(req.body?.credentials || {});
  const missing = spec.credentialFields.filter(f => !String(credentials[f.name] || "").trim()).map(f => f.label);
  if (missing.length) return res.status(400).json({ error: "missing_credentials", message: `Still needed: ${missing.join(", ")}.` });
  const out = await runSourceCredentialTest(provider, credentials, req.user.orgId, normalizeSourceConfig(req.body?.config));
  res.json({ ok: !!out.ok, count: out.count || 0, totalCents: out.totalCents || 0,
             message: out.message || null, requests: out.requests || 0,
             // The same two facts the source row carries, so the Test button
             // and the saved row can never disagree about what happened.
             errorStatus: out.ok ? null : (out.status ?? null),
             errorProviderCode: out.ok ? null : (out.providerCode || null) });
}));

// Connect. THE ONE PLACE A PROVIDER CREDENTIAL ENTERS THE DATABASE.
//
// There is no plaintext path: seal() throws when no credential key is
// configured, and that throw becomes a 503 here with nothing written. A
// missing key means the feature is unavailable, never that it is available
// and insecure.
app.post("/giving-sources", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { PROVIDERS, providerLabel } = await import("../shared/givingSources.js");
  const { sealBag, CredentialKeyMissing, CREDENTIAL_KEY_ENV } = await import("../shared/secretBox.js");
  const orgId = req.user.orgId;
  const provider = String(req.body?.provider || "");
  const spec = PROVIDERS[provider];
  if (!spec) return res.status(400).json({ error: "unknown_provider" });

  const credentials = trimCredentials(req.body?.credentials || {});
  const missing = spec.credentialFields.filter(f => !String(credentials[f.name] || "").trim()).map(f => f.label);
  if (missing.length) return res.status(400).json({ error: "missing_credentials", message: `Still needed: ${missing.join(", ")}.` });

  // BUILD-92 A2 item 3 — ASK THE PROVIDER BEFORE STORING THE KEY.
  // A credential the provider has already refused must not be saved: it
  // becomes a source that sits on the Settings screen failing every six hours
  // while the person who pasted it believes they are connected.
  //   The refusal is narrow ON PURPOSE. Only an AUTHENTICATION verdict stops
  // the save, because only that one is certain and only that one is fixed by
  // pasting a different key. A PERMISSIONS-PENDING result SAVES - PayPal's
  // Transaction Search switch genuinely takes up to a day, and refusing there
  // would make the product impossible to set up. Unreachable, rate-limited and
  // unknown also save: a network blip is not a fact about the key.
  //   It runs through runSourceCredentialTest, the same path the Test button
  // uses. There is no second notion of "it works".
  if (spec.credentialFields.length && verifyBeforeSaving(provider)) {
    const check = await runSourceCredentialTest(provider, credentials, orgId, normalizeSourceConfig(req.body?.config));
    if (!check.ok && (check.kind === "auth" || check.kind === "PROVIDER_WRITE_REFUSED")) {
      return res.status(400).json({
        error: "credentials_refused",
        message: check.message,
        errorStatus: check.status ?? null,
        errorProviderCode: check.providerCode || null,
      });
    }
  }

  // A fund is honoured only if it is this org's. A refused fund never
  // silently becomes a different fund (recordGift's rule, applied at the door).
  let fundId = req.body?.defaultFundId || null;
  if (fundId) {
    const [f] = await query("SELECT id FROM fin_funds WHERE id=? AND org_id=?", [fundId, orgId]);
    if (!f) return res.status(400).json({ error: "unknown_fund" });
  }

  let sealed = null;
  if (spec.credentialFields.length) {
    try {
      sealed = sealBag(credentials, { aad: orgId });   // bound to this tenant
    } catch (e) {
      if (e instanceof CredentialKeyMissing || e.code === "CREDENTIAL_KEY_MISSING") {
        return res.status(503).json({
          error: "credentials_unavailable",
          message: `Steward cannot store a provider key safely until ${CREDENTIAL_KEY_ENV} is set on the server. Nothing was saved.`,
        });
      }
      throw e;
    }
  }

  const displayName = String(req.body?.displayName || "").trim().slice(0, 60) || providerLabel(provider);

  // RECONNECTING RESUMES; IT DOES NOT START OVER. A provider this org has
  // disconnected before still owns the gifts Steward read through it, and the
  // recurring commitments those gifts taught it. Minting a SECOND row would
  // strand both under the old id: the gifts would stay on the donor records
  // (they are keyed to the donor, not the source) but the new row would show
  // zero, and Steward would have to watch three more months go by before it
  // could say "monthly" again about a donor it already knew. So the existing
  // row is ADOPTED - new credentials, active again, same id - and the next
  // sync re-reads history it already has, dedupes it, and restores the
  // commitments through the ordinary path.
  const [dormant] = await query(
    `SELECT id FROM giving_sources WHERE org_id=? AND provider=? AND status='disconnected'
      ORDER BY updated_at DESC LIMIT 1`, [orgId, provider]);
  if (dormant) {
    const revived = await query(
      `UPDATE giving_sources
          SET status='active', credentials_sealed=?, display_name=?, default_fund_id=COALESCE(?, default_fund_id),
              last_error=NULL, last_error_at=NULL, updated_at=NOW()
        WHERE id=? AND org_id=? AND status='disconnected'
        RETURNING id`, [sealed, displayName, fundId, dormant.id, orgId]);
    if (revived.length) {
      const [kept] = await query("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=? AND giving_source_id=?", [orgId, dormant.id]);
      return res.json({ id: dormant.id, provider, displayName, status: "active", reconnected: true, giftsKept: kept?.n || 0 });
    }
  }

  const id = "gs_" + uuid().slice(0, 10);
  const inserted = await query(
    `INSERT INTO giving_sources (id,org_id,provider,display_name,status,credentials_sealed,default_fund_id,created_by,created_by_name,config)
     VALUES (?,?,?,?,'active',?,?,?,?,?::jsonb)
     ON CONFLICT (org_id, provider) WHERE status <> 'disconnected' DO NOTHING
     RETURNING id`,
    [id, orgId, provider, displayName, sealed, fundId, actor(req).id, actor(req).name,
     JSON.stringify(normalizeSourceConfig(req.body?.config))]);
  if (!inserted.length) return res.status(409).json({ error: "already_connected", message: `${providerLabel(provider)} is already connected.` });
  res.json({ id, provider, displayName, status: "active", reconnected: false });
}));

// Rename, or set the default fund. Credentials are NOT editable here - a new
// key is a disconnect and a connect, so there is never a half-updated bag.
app.patch("/giving-sources/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [s] = await query("SELECT * FROM giving_sources WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!s) return res.status(404).json({ error: "source not found" });
  let fundId = s.default_fund_id;
  if (req.body?.defaultFundId !== undefined) {
    fundId = req.body.defaultFundId || null;
    if (fundId) {
      const [f] = await query("SELECT id FROM fin_funds WHERE id=? AND org_id=?", [fundId, orgId]);
      if (!f) return res.status(400).json({ error: "unknown_fund" });
    }
  }
  const displayName = req.body?.displayName !== undefined
    ? String(req.body.displayName || "").trim().slice(0, 60) || s.display_name : s.display_name;

  // BUILD-92 A3 — THE ONE SHORTCUT. "Donorbox sits on top of Stripe" is a fact
  // about the org's own stack that only a human can state; once stated, every
  // cross-source match between the two resolves as one gift without asking.
  // It must be THIS org's other source, and never itself - a source riding on
  // itself would make every match self-resolving and silently swallow real
  // gifts, which is the exact failure this whole part exists to prevent.
  let sitsOnTopOf = s.sits_on_top_of;
  if (req.body?.sitsOnTopOf !== undefined) {
    sitsOnTopOf = req.body.sitsOnTopOf || null;
    if (sitsOnTopOf) {
      if (sitsOnTopOf === req.params.id) return res.status(400).json({ error: "self_reference", message: "A source cannot sit on top of itself." });
      const [other] = await query("SELECT id FROM giving_sources WHERE id=? AND org_id=?", [sitsOnTopOf, orgId]);
      if (!other) return res.status(404).json({ error: "unknown_source" });
    }
  }
  // BUILD-95 §5A — the config is MERGED, not replaced: a PATCH that only
  // renames the source must not silently wipe the answer about which Square
  // locations are giving, which would stop every import with no error.
  const nextConfig = req.body?.config !== undefined
    ? { ...sourceConfig(s), ...normalizeSourceConfig(req.body.config) }
    : sourceConfig(s);
  await run("UPDATE giving_sources SET display_name=?, default_fund_id=?, sits_on_top_of=?, config=?::jsonb, updated_at=NOW() WHERE id=? AND org_id=?",
            [displayName, fundId, sitsOnTopOf, JSON.stringify(nextConfig), req.params.id, orgId]);
  res.json({ ok: true, displayName, defaultFundId: fundId, sitsOnTopOf });
}));

// "Check now". Same function the schedule calls - there is no second path.
app.post("/giving-sources/:id/sync", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [s] = await query("SELECT id FROM giving_sources WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!s) return res.status(404).json({ error: "source not found" });
  const out = await syncSource(req.user.orgId, req.params.id, {
    reason: "manual", actor: actor(req),
    today: req.body?.today || null,
  });
  res.json(out);
}));

// TEST-ONLY. The suites drive the REAL runner with a fake adapter, because a
// fixture that runs through a parallel implementation proves nothing about the
// implementation that ships. Armed by TEST_MODE=1 and by nothing else; in
// production this answers exactly as an unknown route does, which is what
// makes its absence provable rather than promised.
app.post("/giving-sources/:id/sync-fixture", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (!testMode()) return res.status(404).json({ error: "Not found" });
  const [s] = await query("SELECT id FROM giving_sources WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!s) return res.status(404).json({ error: "source not found" });
  const pages = Array.isArray(req.body?.pages) ? req.body.pages : [req.body?.rows || []];
  const out = await syncSource(req.user.orgId, req.params.id, {
    reason: "fixture", today: req.body?.today || null,
    adapter: sourceAdapters.fakeAdapter(pages),
  });
  res.json(out);
}));

// Disconnect. Stops syncing and KEEPS EVERY GIFT - the money did come in this
// way, and a product that erases that on disconnect is lying about history.
// The row survives as 'disconnected' so the gifts keep their source, and the
// partial unique index lets the same provider be connected again tomorrow.
app.delete("/giving-sources/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [s] = await query("SELECT id FROM giving_sources WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!s) return res.status(404).json({ error: "source not found" });
  const [kept] = await query("SELECT COUNT(*)::int AS n FROM gifts WHERE org_id=? AND giving_source_id=?", [orgId, req.params.id]);
  await run(`UPDATE giving_sources SET status='disconnected', credentials_sealed=NULL,
                                       last_error=NULL, last_error_at=NULL, updated_at=NOW()
              WHERE id=? AND org_id=?`, [req.params.id, orgId]);
  // A disconnected source raises no more work.
  await run("UPDATE giving_recurring SET status='ended', updated_at=NOW() WHERE org_id=? AND source_id=? AND status<>'ended'",
            [orgId, req.params.id]);
  res.json({ ok: true, giftsKept: kept?.n || 0 });
}));

// The recurring dashboard, provider-neutral: every source, one list, with the
// definition on the surface rather than in somebody's head.
app.get("/giving-recurring", requireAuth, wrap(async (req, res) => {
  const { providerLabel, recurringPhrase, RECURRING_MIN_RUN, MONTH_MIN_DAYS, MONTH_MAX_DAYS, MISSED_GRACE_DAYS } =
    await import("../shared/givingSources.js");
  const rows = await query(
    `SELECT r.*, d.name AS donor_name, d.email AS donor_email, s.display_name
       FROM giving_recurring r
       JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id
       JOIN giving_sources s ON s.id = r.source_id AND s.org_id = r.org_id
      WHERE r.org_id=? AND r.status <> 'ended' AND d.deleted_at IS NULL
      ORDER BY r.expected_next ASC NULLS LAST, r.amount_cents DESC`, [req.user.orgId]);
  const out = rows.map(r => ({
    id: r.id, donorId: r.donor_id, donorName: r.donor_name, donorEmail: r.donor_email,
    sourceId: r.source_id, provider: r.provider, providerLabel: providerLabel(r.provider),
    sourceName: r.display_name,
    amountCents: Number(r.amount_cents), interval: r.interval,
    confidence: r.confidence, confirmed: !!r.confirmed_at,
    giftCount: Number(r.gift_count) || 0,
    firstGiftOn: r.first_gift_on, lastGiftOn: r.last_gift_on,
    expectedNext: r.expected_next, status: r.status,
    // The sentence, built in the shared module so the dashboard, the donor
    // header and the Thread label cannot drift apart.
    phrase: recurringPhrase({ amountCents: Number(r.amount_cents), interval: r.interval,
                              confidence: r.confidence }, { provider: r.provider }),
  }));
  res.json({
    recurring: out,
    totalMonthlyCents: out.filter(r => r.interval === "month" && r.status === "active")
                          .reduce((s, r) => s + r.amountCents, 0),
    // NO NUMBER WITHOUT A DEFINITION.
    definition: {
      what: "Donors giving on a schedule through any connected source.",
      looksMonthly: `"Looks monthly" means Steward saw the pattern and nobody has confirmed it: ${RECURRING_MIN_RUN} or more gifts of the same amount, each ${MONTH_MIN_DAYS} to ${MONTH_MAX_DAYS} days after the last.`,
      confirmed: "A confirmed one was either named by the provider or confirmed here by a person.",
      missed: `Steward raises a follow-up when an expected payment is ${MISSED_GRACE_DAYS} days late, once per missed payment.`,
    },
  });
}));

// ONE TAP turns "looks monthly" into a fact. Only a human can do this, which
// is the entire difference between the two words on the screen.
app.post("/giving-recurring/:id/confirm", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [r] = await query("SELECT * FROM giving_recurring WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!r) return res.status(404).json({ error: "not found" });
  await run(`UPDATE giving_recurring SET confirmed_at=NOW(), confirmed_by=?, confirmed_by_name=?, updated_at=NOW()
              WHERE id=? AND org_id=?`,
            [actor(req).id, actor(req).name, req.params.id, orgId]);
  res.json({ ok: true, confirmed: true });
}));

// She can say it is not a recurring gift. 'ended' stops the expectation and
// therefore the follow-up - a wrong guess has to be one tap to switch off, or
// the next wrong guess is ignored along with the right ones.
app.post("/giving-recurring/:id/dismiss", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [r] = await query("SELECT id FROM giving_recurring WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!r) return res.status(404).json({ error: "not found" });
  await run("UPDATE giving_recurring SET status='ended', updated_at=NOW() WHERE id=? AND org_id=?", [req.params.id, orgId]);
  res.json({ ok: true });
}));

// Ops/test hook, same bar as /recurring/check-cards: drives the schedule for
// THIS org only, so the sweep is testable without waiting six hours.
app.post("/giving-sources/run-schedule", requireAuth, requireAdmin, wrap(async (req, res) => {
  const out = await processGivingSources({ orgId: req.user.orgId });
  res.json(out);
}));

// The sweep alone, with a pinned date, so a missed payment is testable without
// waiting for a calendar. Pinning is the BUILD-84 rule for clock-dependent
// behaviour: pin the clock, never synchronise the assertion to it.
app.post("/giving-recurring/sweep", requireAuth, requireAdmin, wrap(async (req, res) => {
  const out = await sweepMissedRecurring(req.user.orgId, { today: req.body?.today || null });
  res.json(out);
}));

function verifyRecoveryToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", RECOVERY_SECRET).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig), expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!decoded.subscriptionId || !decoded.orgId) return null;
    return decoded;
  } catch { return null; }
}

// BUILD-77 Part 6 — the reconnect token binds a giving-page prefill to the
// EXISTING donor so the new subscription stitches back to their record
// (never a second donor). Same HMAC construction as the recovery token.
function signReconnectToken(donorId, orgId) {
  const payload = Buffer.from(JSON.stringify({ donorId, orgId, k: "reconnect" })).toString("base64url");
  const sig = crypto.createHmac("sha256", RECOVERY_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyReconnectToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", RECOVERY_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const d = JSON.parse(Buffer.from(payload, "base64url").toString()); return (d.k === "reconnect" && d.donorId && d.orgId) ? d : null; }
  catch { return null; }
}

// UNSUPPRESSIBLE donor notification for STAFF-side subscription changes.
// The standing rule (BUILD-57): every staff action on a donor's recurring
// gift notifies the donor, and NO role, setting, or flag can turn that off —
// not recurring_dunning_enabled, not the suppression list, not notification
// prefs. It is a transactional service message about the donor's own money,
// not marketing (hence no unsubscribe footer, same rule as receipts). Tested
// by tests/recurring-surface.test.js with every suppression lever thrown.
async function sendRecurringDonorEmail(org, donor, subject, bodyText, { actionUrl = null, actionLabel = null } = {}) {
  if (!process.env.RESEND_API_KEY) return true;
  if (!donor?.email) return true;
  // W-4: TRANSACTIONAL via the one policy — the suppression list, prefs, and
  // do_not_contact never block it (the unsuppressible rule, unchanged); only
  // the policy's hard block (deceased) refuses.
  const decision = await donorMailDecision("recurring_change", donor.email, org.id);
  if (!decision.send) { console.log(`[recurring] donor notification refused (${decision.reason})`); return false; }
  const orgName = await donorFacingOrgName(org.id, org.name);
  const psRows = await query("SELECT enabled FROM portal_settings WHERE org_id=?", [org.id]).catch(() => []);
  const ps = psRows[0];
  const html = await brandEmailHeaderHtml(org.id) + `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;padding:24px;color:#0f1a12;">
      <p>${escHtmlWf(bodyText)}</p>
      ${actionUrl ? `<p style="margin:22px 0;"><a href="${actionUrl}" style="background:#c9a84c;color:#0f1a12;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">${escHtmlWf(actionLabel || "Review")}</a></p>` : ""}
      ${ps?.enabled && org.org_slug ? `<p style="font-size:13px;color:#555;">You can review your giving anytime: <a href="${publicAppUrl()}/portal/${org.org_slug}">${escHtmlWf(orgName)} donor portal</a>.</p>` : ""}
      <p style="font-size:13px;color:#555;">If you didn't expect this change, reply to this email and ${escHtmlWf(orgName)} will make it right.</p>
    </div>`;
  try {
    const { error: sendErr } = await resend.emails.send({
      ...(await donorSendOpts(org.id, donor.email, "campaign")), // BUILD-88c C.1
      to: donor.email, subject: `${subject} — ${orgName}`, html,
    });
    if (sendErr) { console.error("[recurring] donor notification error:", sendErr.message); return false; }
    return true;
  } catch (e) { console.error("[recurring] donor notification failed:", e.message); return false; }
}

// Proposal tokens: 256-bit CSPRNG, stored SHA-256 (hash-at-rest — a DB leak
// must never leak a live completion link), 14-day expiry, resendable once
// (a resend supersedes the old token). Same discipline as portal_magic_links.
const PROPOSAL_EXPIRY_DAYS = 14;
const hashProposalToken = t => crypto.createHash("sha256").update(String(t)).digest("hex");
function mintProposalToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashProposalToken(token) };
}
// Lazy expiry — flipped at every read/confirm; no new scheduler.
async function expireStaleProposals(orgId) {
  const args = orgId ? [orgId] : [];
  await run(
    `UPDATE recurring_proposals SET status='expired', updated_at=NOW()
      WHERE status='pending' AND expires_at < NOW()${orgId ? " AND org_id=?" : ""}`, args
  ).catch(() => {});
}
const PROPOSAL_KIND_LABELS = {
  create: "start a recurring gift",
  amount: "change your recurring gift amount",
  frequency: "change how often your recurring gift repeats",
  card_update: "update the card on your recurring gift",
};

// ── Tracking pixel (no auth) ───────────────────────────────────────────────
app.get("/track/:recipientId/open.gif", wrap(async (req, res) => {
  const { recipientId } = req.params;
  const wasAlreadyOpen = await query("SELECT opened_at FROM campaign_recipients WHERE id=?", [recipientId]);
  const alreadyOpened = wasAlreadyOpen[0]?.opened_at != null;
  await run("UPDATE campaign_recipients SET opened_at = NOW() WHERE id = ? AND opened_at IS NULL", [recipientId]);
  // Count UNIQUE opens only — this counter is divided by recipient_count as
  // "open rate" in the UI, so counting every pixel refetch inflated rates
  // (and could push them past 100%). BUILD-06 Phase C fix.
  if (!alreadyOpened) {
    await run(
      `UPDATE campaigns SET open_count = open_count + 1
       WHERE id = (SELECT campaign_id FROM campaign_recipients WHERE id = ?)`,
      [recipientId]
    );
  }

  // Log interaction + engagement intelligence (fire-and-forget)
  if (!alreadyOpened) {
    (async () => {
      try {
        const recRows = await query(
          `SELECT cr.email, cr.donor_id, c.name AS campaign_name, c.org_id
           FROM campaign_recipients cr JOIN campaigns c ON c.id=cr.campaign_id WHERE cr.id=?`,
          [recipientId]
        );
        if (!recRows.length) return;
        const rec = recRows[0];
        const donorId = rec.donor_id || (rec.email
          ? (await query("SELECT id FROM donors WHERE org_id=? AND email ILIKE ?", [rec.org_id, rec.email]))[0]?.id
          : null);
        if (!donorId) return;
        const today = new Date().toISOString().slice(0, 10);
        await run("INSERT INTO interactions (id,org_id,donor_id,type,note,date) VALUES (?,?,?,'email',?,?)",
          ["i_"+uuid().slice(0,8), rec.org_id, donorId, `Opened campaign: ${rec.campaign_name}`, today]);
        // Check last 3 email interactions for engagement signals
        const recent = await query(
          "SELECT note FROM interactions WHERE donor_id=? AND org_id=? AND type='email' ORDER BY date DESC, created_at DESC LIMIT 3",
          [donorId, rec.org_id]
        );
        const opens = recent.filter(r => r.note?.startsWith("Opened"));
        if (opens.length >= 2) {
          await run(`UPDATE donors SET notes = CASE WHEN notes NOT LIKE '%High engagement%'
            THEN TRIM(COALESCE(notes||' | ','') || 'High engagement — opened last 2+ emails')
            ELSE notes END WHERE id=? AND org_id=?`, [donorId, rec.org_id]);
        } else if (opens.length === 0 && recent.length >= 3) {
          await run(`UPDATE donors SET notes = CASE WHEN notes NOT LIKE '%Low email engagement%'
            THEN TRIM(COALESCE(notes||' | ','') || 'Low email engagement — consider phone outreach')
            ELSE notes END WHERE id=? AND org_id=?`, [donorId, rec.org_id]);
        }
      } catch (e) { /* non-critical */ }
    })();
  }

  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.end(gif);
}));
async function uniqueGivingPageSlug(orgId, base, excludeId) {
  let slug = base, n = 1;
  while (true) {
    const rows = excludeId
      ? await query("SELECT id FROM giving_pages WHERE org_id=? AND slug=? AND id<>?", [orgId, slug, excludeId])
      : await query("SELECT id FROM giving_pages WHERE org_id=? AND slug=?", [orgId, slug]);
    if (!rows.length) return slug;
    n++;
    slug = `${base}-${n}`;
  }
}

// Admin list — includes the same real, live SUM(gifts.amount) used by the
// public page's progress bar, so the manager list never shows a number that
// could drift from the public one.
app.get("/giving-pages", requireAuth, wrap(async (req, res) => {
  // raised_amount counts what donors INTENDED for the page's ask (amount −
  // cover_fee_amount) — the donor-covers-fees rule; the charged total lives in
  // Reports/Finance/receipts. campaign_* expose the "counts toward" linkage
  // (attribution FIX): a linked page's public thermometer tracks the CAMPAIGN's
  // progress (one goal concept), so the manager list carries the same figures.
  const rows = await query(
    `SELECT gp.*, f.name AS fund_name, c.name AS campaign_name, c.goal_amount AS campaign_goal,
       COALESCE((SELECT SUM(amount - COALESCE(cover_fee_amount,0)) FROM gifts WHERE giving_page_id = gp.id), 0) AS raised_amount,
       CASE WHEN gp.campaign_id IS NOT NULL THEN
         COALESCE((SELECT SUM(g.amount - COALESCE(g.cover_fee_amount,0)) FROM gifts g WHERE g.org_id = gp.org_id AND (g.campaign_id = gp.campaign_id OR g.campaign = c.name)), 0)
       END AS campaign_raised
     FROM giving_pages gp
     LEFT JOIN fin_funds f ON f.id = gp.fund_id
     LEFT JOIN campaigns c ON c.id = gp.campaign_id AND c.org_id = gp.org_id
     WHERE gp.org_id = ?
     ORDER BY gp.created_at DESC`,
    [req.user.orgId]
  );
  res.json(rows);
}));

// Same length/amount limits as the public peer-fundraiser creation route
// below (POST /org/:orgSlug/giving-page/:pageSlug/fundraisers) — that
// sibling route validates these; this one didn't, which was an
// inconsistency within the same feature rather than a real exposure (this
// route is admin+org-scoped, so a bad value only ever lands in the caller's
// own org), but a negative/non-finite goalAmount would still render a
// nonsensical progress-bar percentage on the public page.
function validateGivingPageFields(title, story, imageUrl, goalAmount) {
  if (title !== undefined && title.trim().length > 200) return "Title is too long.";
  if (story && story.length > 5000) return "Story is too long (5,000 character max).";
  if (imageUrl && imageUrl.length > 2000) return "Image URL is too long.";
  if (goalAmount && (!Number.isFinite(parseFloat(goalAmount)) || parseFloat(goalAmount) <= 0)) return "Goal amount must be a positive number.";
  return null;
}

app.post("/giving-pages", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { title, goalAmount, story, imageUrl, fundId, slug, campaignId } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "title required" });
  const validationErr = validateGivingPageFields(title, story, imageUrl, goalAmount);
  if (validationErr) return res.status(400).json({ error: validationErr });
  if (fundId) {
    const fundRow = await query("SELECT id FROM fin_funds WHERE id=? AND org_id=?", [fundId, req.user.orgId]);
    if (!fundRow.length) return res.status(400).json({ error: "Invalid fund" });
  }
  // Attribution FIX — org-scoped validation so a page from org A can never
  // attribute to org B's campaign. Optional: a general page stays unattributed.
  if (campaignId) {
    const campRow = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignId, req.user.orgId]);
    if (!campRow.length) return res.status(400).json({ error: "Invalid campaign" });
  }
  const base = slugifyGivingPage(slug || title);
  const finalSlug = await uniqueGivingPageSlug(req.user.orgId, base);
  const id = "gp_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO giving_pages (id, org_id, slug, title, goal_amount, story, image_url, fund_id, status, campaign_id, created_by, created_by_name)
     VALUES (?,?,?,?,?,?,?,?,'active',?,?,?)`,
    [id, req.user.orgId, finalSlug, title.trim(), goalAmount ? parseFloat(goalAmount) : null, story || "", imageUrl || "", fundId || null, campaignId || null, actor(req).id, actor(req).name]
  );
  const rows = await query("SELECT *, 0 AS raised_amount FROM giving_pages WHERE id=?", [id]);
  res.status(201).json(rows[0]);
}));

app.put("/giving-pages/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const existingRows = await query("SELECT * FROM giving_pages WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!existingRows.length) return res.status(404).json({ error: "Not found" });
  const existing = existingRows[0];
  const { title, goalAmount, story, imageUrl, fundId, slug, status, campaignId } = req.body;
  const validationErr = validateGivingPageFields(title, story, imageUrl, goalAmount);
  if (validationErr) return res.status(400).json({ error: validationErr });
  if (fundId) {
    const fundRow = await query("SELECT id FROM fin_funds WHERE id=? AND org_id=?", [fundId, req.user.orgId]);
    if (!fundRow.length) return res.status(400).json({ error: "Invalid fund" });
  }
  // Attribution FIX — set / change / clear (campaignId:"" → NULL), org-scoped.
  if (campaignId) {
    const campRow = await query("SELECT id FROM campaigns WHERE id=? AND org_id=?", [campaignId, req.user.orgId]);
    if (!campRow.length) return res.status(400).json({ error: "Invalid campaign" });
  }
  // Only touches the slug when the request actually included one (the full
  // edit form always sends it; a partial update like the archive toggle,
  // which sends only {status}, must not silently regenerate a custom slug
  // from the title).
  let finalSlug = existing.slug;
  if (slug !== undefined) {
    const requestedSlug = slugifyGivingPage(slug || title || existing.title);
    if (requestedSlug !== existing.slug) {
      finalSlug = await uniqueGivingPageSlug(req.user.orgId, requestedSlug, existing.id);
    }
  }
  await run(
    `UPDATE giving_pages SET title=?, goal_amount=?, story=?, image_url=?, fund_id=?, slug=?, status=?, campaign_id=?, updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [
      title?.trim() || existing.title,
      goalAmount !== undefined ? (goalAmount ? parseFloat(goalAmount) : null) : existing.goal_amount,
      story !== undefined ? story : existing.story,
      imageUrl !== undefined ? imageUrl : existing.image_url,
      fundId !== undefined ? (fundId || null) : existing.fund_id,
      finalSlug,
      status && ["active", "archived"].includes(status) ? status : existing.status,
      campaignId !== undefined ? (campaignId || null) : existing.campaign_id,
      req.params.id, req.user.orgId,
    ]
  );
  const rows = await query(
    `SELECT gp.*, COALESCE((SELECT SUM(amount - COALESCE(cover_fee_amount,0)) FROM gifts WHERE giving_page_id = gp.id), 0) AS raised_amount
     FROM giving_pages gp WHERE gp.id=?`,
    [req.params.id]
  );
  res.json(rows[0]);
}));

// Hard delete — separate from archive (status='active'|'archived' above),
// which is the reversible day-to-day "stop accepting gifts on this page"
// action. This is for removing a mistake/duplicate/test page outright.
// gifts.giving_page_id has no FK constraint (see db.js), so this never
// errors on existing gifts; a gift that already came through a deleted page
// simply keeps a giving_page_id that no longer resolves, same tolerated
// pattern as other dangling-reference cases in this codebase (see "Admin
// data integrity" in CLAUDE.md). DELETE routes are intentionally never
// checkWriteAccess-gated, consistent with every other DELETE in this app.
// ── BUILD-95 §5B — THE GIVING-PAGE BUILDER ─────────────────────────────────
// The SAME widgets, the SAME renderer, the SAME draft/published rule the
// portal has had since BUILD-54 — and the surface is a filter, not a fork.
//
// The form is NOT among the widgets. A giving page whose one job is taking a
// gift must not be able to lose it, so it is always rendered and she chooses
// only which side of the page it leads from.
// Two starting points, and NEITHER INVENTS CONTENT — the portal starters'
// rule (tests/portal-page.test.js pins it there): a starter lays out empty
// widgets and prompts, never a fabricated number, quote or testimonial.
const GIVE_STARTERS = {
  story_first: {
    label: "Story first",
    widgets: [
      { type: "hero", heading: "", sub: "", image: null, size: "tall" },
      { type: "richtext", blocks: [{ type: "p", text: "Say what this page is for, in your own words." }] },
      { type: "funds", heading: "Where you can give", fundIds: [] },
    ],
  },
  short_and_clear: {
    label: "Short and clear",
    widgets: [
      { type: "hero", heading: "", sub: "", image: null, size: "standard" },
      { type: "stats", items: [{ value: "", label: "" }] },
    ],
  },
};

const givingPageOr404 = async (id, orgId) => {
  const [p] = await query(`SELECT * FROM giving_pages WHERE id = ? AND org_id = ?`, [id, orgId]);
  return p || null;
};

// POST /forms/:id/event — the public counter. A view and a start are the only two
// things the PAGE may report; a COMPLETION is counted from the gift itself in the
// webhook, because a page cannot be trusted to know whether money actually moved
// and a completion nobody paid for is the one number that would matter.
app.post("/forms/:id/event", donateLimiter, wrap(async (req, res) => {
  const kind = String(req.body && req.body.kind || "");
  if (!["view", "start"].includes(kind)) {
    return res.status(400).json({ error: "bad_event", code: "bad_event" });
  }
  const [page] = await query("SELECT id, org_id, status FROM giving_pages WHERE id=?", [req.params.id]);
  // An unknown or archived form counts nothing, and answers 204 either way: this is
  // called from a public page and must never leak whether an id exists.
  if (!page || page.status !== "active") return res.status(204).end();
  const variant = req.body && (req.body.variant === "b" ? "b" : req.body.variant === "a" ? "a" : null);
  await bumpFormEvent(page.org_id, page.id, kind === "view" ? "views" : "starts", { variant })
    .catch(e => console.error("[forms] counting a " + kind + ":", e.message));
  // NO BODY, EVER. There is nothing to tell the page, and a response with content
  // is a response somebody will eventually read something into.
  res.status(204).end();
}));

// GET /giving-pages/:id/funnel — the numbers, each with its definition.
app.get("/giving-pages/:id/funnel", requireAuth, wrap(async (req, res) => {
  const F = await formConfigMod();
  const pg = await givingPageOr404(req.params.id, req.user.orgId);
  if (!pg) return res.status(404).json({ error: "not_found" });
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 90));
  const org = await orgTz(req.user.orgId);
  const today = orgToday(org);                                         // ORG_TZ_SEAM_OK
  const from = orgTime.addDays(today, -(days - 1));
  const rows = await query(
    `SELECT variant, COALESCE(SUM(views),0)::int AS views, COALESCE(SUM(starts),0)::int AS starts,
            COALESCE(SUM(completions),0)::int AS completions, COALESCE(SUM(completed_cents),0)::bigint AS cents
       FROM form_events WHERE org_id=? AND form_id=? AND day >= ? AND day <= ?
      GROUP BY variant`, [req.user.orgId, pg.id, from, today]);
  const pick = v => {
    const r = rows.find(x => (x.variant || null) === v) || {};
    return F.funnelFor({ views: r.views, starts: r.starts, completions: r.completions,
                         completedCents: Number(r.cents || 0) });
  };
  // The whole form is every variant together — an A/B splits the SAME traffic, so
  // the total is what the org actually received.
  const all = F.funnelFor(rows.reduce((acc, r) => ({
    views: acc.views + Number(r.views || 0), starts: acc.starts + Number(r.starts || 0),
    completions: acc.completions + Number(r.completions || 0),
    completedCents: acc.completedCents + Number(r.cents || 0),
  }), { views: 0, starts: 0, completions: 0, completedCents: 0 }));
  const ab = pg.ab_test && typeof pg.ab_test === "object" ? pg.ab_test : null;
  const a = pick("a"), b = pick("b");
  res.json({
    formId: pg.id, formTitle: pg.title, from, to: today, days,
    funnel: all,
    money: { completed: toDollars(all.completedCents),
             averageGift: all.averageGiftCents == null ? null : toDollars(all.averageGiftCents) },
    // EVERY FIGURE CARRIES ITS DEFINITION, one string from the registry to the
    // hover — never a copy (BUILD-86 C.3).
    metrics: F.FUNNEL_METRICS,
    definitions: Object.fromEntries(F.FUNNEL_METRICS.map(m => [m.key, m.definition])),
    // A clamped figure is SAID, so a reader knows they are looking at a floor.
    note: all.clamped
      ? "Some counts arrived out of order, so these are a floor rather than an exact figure."
      : null,
    abTest: ab ? {
      running: ab.running !== false, b: ab.b || null,
      minViews: F.AB_MIN_VIEWS,
      a, bFunnel: b,
      verdict: F.abVerdict(a, b),
    } : null,
    // NOTHING ABOUT WHO, and the screen says so rather than leaving somebody to
    // wonder what Steward knows about their donors' browsing.
    privacyNote: "Steward counts how many times this form was opened and finished. "
      + "It records nothing about who opened it — no names, no addresses, no cookies.",
  });
}));

// PUT /giving-pages/:id/ab-test — start, change or stop a test.
app.put("/giving-pages/:id/ab-test", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const F = await formConfigMod();
  const pg = await givingPageOr404(req.params.id, req.user.orgId);
  if (!pg) return res.status(404).json({ error: "not_found" });
  const orgFundIds = await orgFundIdsFor(req.user.orgId);
  const v = F.validateAbTest(req.body && req.body.abTest === undefined ? null : req.body.abTest, { orgFundIds });
  if (!v.ok) return res.status(400).json({ error: v.errors[0].message, code: "bad_ab_test", errors: v.errors });
  await run("UPDATE giving_pages SET ab_test=?, updated_at=NOW() WHERE id=? AND org_id=?",
    [v.test ? JSON.stringify(v.test) : null, pg.id, req.user.orgId]);
  res.json({ formId: pg.id, abTest: v.test, fields: F.AB_FIELDS, minViews: F.AB_MIN_VIEWS });
}));

// ── BUILD-102 (Steward Give) Part 4 — THE EMBED ────────────────────────────
// One public read, by FORM ID, so `embed.js` needs nothing but the id the org
// pasted into its own page. It is the same payload shape the giving page's own
// public route returns — the same `formSpec`, the same theme — because an embedded
// form that differed from the hosted one would be a second product.
//
// AN ARCHIVED FORM ANSWERS 200 WITH `closed: true`, NOT 404. The embed is sitting
// on somebody else's website: a 404 there renders as a broken box or a console
// error on a page the org is judged by, where a quiet "this form is closed" line
// is the truth and costs them nothing.
app.get("/forms/:id/public", wrap(async (req, res) => {
  const F = await formConfigMod();
  const [page] = await query(
    `SELECT gp.*, o.id AS org_id, o.name AS org_name, o.org_slug, o.cover_fees_enabled,
            o.form_upsell_threshold_cents, ${GIVE_THEME_COLS}
       FROM giving_pages gp
       JOIN orgs o ON o.id = gp.org_id
       LEFT JOIN portal_settings ps ON ps.org_id = o.id
      WHERE gp.id = ?`, [req.params.id]);
  // An id that never existed is a 404 — there is nothing honest to render for it.
  if (!page) return res.status(404).json({ error: "form_not_found" });
  const orgName = await donorFacingOrgName(page.org_id, page.org_name || "").catch(() => page.org_name || "");
  if (page.status !== "active") {
    return res.json({
      closed: true,
      // Enough to render the line in the org's own colours rather than Steward's.
      org: { name: orgName, slug: page.org_slug, theme: giveThemePayload(page) },
      message: "This form is closed.",
    });
  }
  const funds = await query("SELECT id, name FROM fin_funds WHERE org_id=? ORDER BY name ASC", [page.org_id]);
  res.json({
    closed: false,
    org: { name: orgName, slug: page.org_slug,
           coverFeesEnabled: page.cover_fees_enabled !== false, theme: giveThemePayload(page) },
    form: {
      id: page.id, slug: page.slug, title: page.title,
      // BUILD-102 Part 6 — the variant the caller was assigned. The SPLIT is the
      // page's (a cookie it sets itself); the SPEC for each side comes from here,
      // through one function, so A and B cannot drift into two forms.
      spec: F.specForVariant(page.form_config, page.ab_test, req.query.v,
        { funds: funds.map(f => ({ id: f.id, name: f.name })), orgName }),
      abRunning: !!(page.ab_test && page.ab_test.running !== false && page.ab_test.b),
      upsellThresholdCents: page.form_upsell_threshold_cents != null
        ? Number(page.form_upsell_threshold_cents)
        : F.UPSELL_DEFAULT_THRESHOLD_CENTS,
    },
  });
}));

// GET /giving-pages/:id/embed — the two snippets, for Settings. Generated HERE so
// the script URL, the id and the fallback cannot drift from each other in three
// places of copy (the BUILD-95 registry lesson, applied to two lines of HTML).
app.get("/giving-pages/:id/embed", requireAuth, requireAdmin, wrap(async (req, res) => {
  const pg = await givingPageOr404(req.params.id, req.user.orgId);
  if (!pg) return res.status(404).json({ error: "not_found" });
  const base = publicAppUrl();
  res.json({
    pageId: pg.id, status: pg.status,
    // ONE LINE, which is the whole promise of the product's first page.
    script: `<script src="${base}/embed.js" data-form="${pg.id}"></script>`,
    // The fallback, for a site that refuses third-party script tags (a Squarespace
    // or Wix plan without code injection). It cannot self-size, so it carries a
    // height somebody may change.
    iframe: `<iframe src="${base}/embed/${pg.id}" width="100%" height="720" style="border:0" `
      + `title="Donation form" loading="lazy"></iframe>`,
    previewUrl: `${base}/embed/${pg.id}`,
    // NO CARD FIELD EVER LIVES ON THE ORG'S SITE, and the screen says so rather
    // than leaving somebody to wonder what their PCI exposure is.
    note: "Payment always finishes on Stripe's own page. No card details are ever "
      + "typed on your website, and the form cannot read the page it sits on.",
  });
}));

// The org's own funds, which is what makes "a fund from another org is refused"
// a fact rather than a hope (BUILD-37 B9: the caller does not get to assert what
// it owns).
async function orgFundIdsFor(orgId) {
  return (await query("SELECT id FROM fin_funds WHERE org_id=?", [orgId])).map(r => r.id);
}
async function orgFundsForSpec(orgId) {
  return query("SELECT id, name FROM fin_funds WHERE org_id=? ORDER BY name ASC", [orgId]);
}

// GET /giving-pages/:id/form — the stored config, the spec the editor renders,
// and the registry the editor's own labels come from (never a copy of them).
app.get("/giving-pages/:id/form", requireAuth, requireAdmin, wrap(async (req, res) => {
  const F = await formConfigMod();
  const pg = await givingPageOr404(req.params.id, req.user.orgId);
  if (!pg) return res.status(404).json({ error: "not_found" });
  const funds = await orgFundsForSpec(req.user.orgId);
  const [org] = await query("SELECT name FROM orgs WHERE id=?", [req.user.orgId]);
  const orgName = await donorFacingOrgName(req.user.orgId, (org && org.name) || "").catch(() => (org && org.name) || "");
  res.json({
    pageId: pg.id, pageTitle: pg.title, pageSlug: pg.slug, status: pg.status,
    config: F.normalizeFormConfig(pg.form_config, { orgFundIds: funds.map(f => f.id) }),
    // THE SAME SPEC THE DONOR GETS, through the SAME function — including the
    // A/B, so an admin running a test can preview either side with `?v=b` and the
    // preview is still the donor's own form rather than a near-copy of it.
    //
    // Part 6 broke this for one commit: the public read moved to `specForVariant`
    // (which stamps `variant`) while this one stayed on `formSpec`, and the
    // byte-identical guard in build102-form-config §5 caught the divergence
    // immediately. That is the guard doing exactly what it was written for.
    spec: F.specForVariant(pg.form_config, pg.ab_test, req.query.v, { funds, orgName }),
    abTest: pg.ab_test || null,
    funds: funds.map(f => ({ id: f.id, name: f.name })),
    // The registry, so the editor's copy is ONE string from here to the screen.
    designationModes: F.DESIGNATION_MODES,
    questionTypes: F.QUESTION_TYPES,
    frequencies: F.FREQUENCIES,
    limits: F.LIMITS,
    defaults: F.DEFAULT_CONFIG,
  });
}));

// PUT /giving-pages/:id/form — save it. The validator is the SAME one the editor
// read, so a field the editor offered cannot be a field the server refuses.
app.put("/giving-pages/:id/form", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const F = await formConfigMod();
  const pg = await givingPageOr404(req.params.id, req.user.orgId);
  if (!pg) return res.status(404).json({ error: "not_found" });
  const orgFundIds = await orgFundIdsFor(req.user.orgId);
  const v = F.validateFormConfig(req.body && req.body.config, { orgFundIds });
  // EVERY BAD FIELD IS NAMED, not just the first — an editor that reports one
  // problem at a time makes somebody press save five times to learn five things.
  if (!v.ok) return res.status(400).json({ error: v.errors[0].message, code: "bad_form_config", errors: v.errors });

  await run("UPDATE giving_pages SET form_config=?, updated_at=NOW() WHERE id=? AND org_id=?",
    [JSON.stringify(v.config), pg.id, req.user.orgId]);

  // A CUSTOM QUESTION IS A CUSTOM FIELD ON THE PERSON, created here so an answer
  // is queryable in the report builder like any other field (Part 3 writes the
  // answers). Created, never renamed and never deleted: a field somebody already
  // answered is data, and a form edit must not take it away.
  const failedQuestions = [];
  // `custom_field_defs` is the BUILD-78 table the report builder reads
  // (`rbCustomDefs`), keyed by `key` — NOT the older `custom_fields`, which has
  // no key column at all and which nothing in the report builder can see. A
  // question written into the wrong table would be an answer nobody can filter
  // on, which is the whole promise of Part 3.
  //
  // AND THE ENTITY IS `donor`, NOT `person`. `CF_ENTITIES` is ["donor","gift"]
  // and reportBuilder's people entity declares `custom: { entity: "donor" }`, so
  // `person` would have stored a definition the catalogue cannot see — a field
  // that exists and is invisible, which is worse than one that does not exist.
  // The suite caught it by asking the catalogue rather than trusting the insert.
  const created = [];
  for (const q of v.config.questions) {
    const [existing] = await query(
      "SELECT id FROM custom_field_defs WHERE org_id=? AND entity='donor' AND key=?", [req.user.orgId, q.key]);
    if (existing) continue;
    const t = F.questionType(q.type);
    const [maxPos] = await query(
      "SELECT MAX(position) AS mp FROM custom_field_defs WHERE org_id=? AND entity='donor'", [req.user.orgId]);
    const id = "cfd_" + uuid().slice(0, 10);
    try {
      await run(
        `INSERT INTO custom_field_defs (id,org_id,entity,key,label,type,options,position,created_by,created_by_name,created_source)
         VALUES (?,?,'donor',?,?,?,?,?,?,?,'donation_form')`,
        [id, req.user.orgId, q.key, q.label, t ? t.cfType : "text",
         JSON.stringify(q.options || []), Number((maxPos && maxPos.mp) || 0) + 1,
         actor(req).id, actor(req).name]);
      created.push({ key: q.key, label: q.label, type: t ? t.cfType : "text" });
    } catch (e) {
      // A field that cannot be created is a question whose answers would go
      // nowhere, so it is REPORTED rather than swallowed — the form still saves,
      // because refusing the whole save over one field would lose her other work.
      console.error("[form] custom field for question", q.key, e.message);
      failedQuestions.push({ key: q.key, label: q.label, why: e.message });
    }
  }

  const funds = await orgFundsForSpec(req.user.orgId);
  const [org] = await query("SELECT name FROM orgs WHERE id=?", [req.user.orgId]);
  const orgName = await donorFacingOrgName(req.user.orgId, (org && org.name) || "").catch(() => (org && org.name) || "");
  res.json({
    pageId: pg.id, config: v.config,
    spec: F.formSpec(v.config, { funds, orgName }),
    customFieldsCreated: created,
    // Said out loud rather than swallowed (BUILD-37 H2).
    questionsWithoutAField: failedQuestions,
  });
}));

app.get("/giving-pages/:id/page", requireAuth, requireAdmin, wrap(async (req, res) => {
  const pg = await givingPageOr404(req.params.id, req.user.orgId);
  if (!pg) return res.status(404).json({ error: "not_found" });
  const { DEFAULT_FORM_POSITION, normalizeFormPosition, typesForSurface } = await widgetMod();
  res.json({
    draft: Array.isArray(pg.draft) ? pg.draft : null,
    published: Array.isArray(pg.published) ? pg.published : null,
    draftUpdatedAt: pg.draft_updated_at, publishedAt: pg.published_at,
    formPosition: normalizeFormPosition(pg.form_position) || DEFAULT_FORM_POSITION,
    // So the editor can name what she is arranging rather than saying "portal".
    pageTitle: pg.title, pageSlug: pg.slug,
    // The palette the editor may offer for THIS surface, from the one registry.
    widgetTypes: typesForSurface("give"),
    starters: Object.entries(GIVE_STARTERS).map(([key, st]) => ({ key, label: st.label })),
  });
}));

app.put("/giving-pages/:id/page/draft", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const pg = await givingPageOr404(req.params.id, req.user.orgId);
  if (!pg) return res.status(404).json({ error: "not_found" });
  const { typesForSurface, normalizeFormPosition } = await widgetMod();

  const v = await validateWidgets(req.body?.widgets, req.user.orgId);
  if (v.error) return res.status(400).json({ error: "bad_widget", message: v.error });
  // THE SURFACE IS A FILTER AT BOTH ENDS. The palette offers what belongs here
  // and the server REFUSES the rest — a hand-rolled request cannot put My
  // Giving on a page a stranger opens from a flyer.
  const allowed = new Set(typesForSurface("give"));
  const stray = v.widgets.find(w => !allowed.has(w.type));
  if (stray) return res.status(400).json({ error: "wrong_surface",
    message: `A "${stray.type}" widget does not belong on a giving page.` });

  const pos = normalizeFormPosition(req.body?.formPosition ?? pg.form_position);
  await run(`UPDATE giving_pages SET draft = ?, draft_updated_at = NOW(), form_position = ?, updated_at = NOW()
             WHERE id = ? AND org_id = ?`,
    [JSON.stringify(v.widgets), pos, pg.id, req.user.orgId]);
  await recordAssetPointerHistory(req.user.orgId, "giving_page.draft", pg.id,
    widgetPathsOrNull(pg.draft), widgetPathsOrNull(v.widgets), req.user.id, req.user.name);
  await pruneWidgetAssets(req.user.orgId);
  res.json({ ok: true, draft: v.widgets, formPosition: pos });
}));

app.post("/giving-pages/:id/page/starter", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const pg = await givingPageOr404(req.params.id, req.user.orgId);
  if (!pg) return res.status(404).json({ error: "not_found" });
  const st = GIVE_STARTERS[req.body?.key];
  if (!st) return res.status(400).json({ error: "unknown_starter" });
  // Through the SAME validator every other draft goes through — a starter is
  // not a privileged path into the page.
  const v = await validateWidgets(st.widgets, req.user.orgId);
  if (v.error) return res.status(400).json({ error: "bad_widget", message: v.error });
  await run(`UPDATE giving_pages SET draft = ?, draft_updated_at = NOW(), updated_at = NOW()
             WHERE id = ? AND org_id = ?`, [JSON.stringify(v.widgets), pg.id, req.user.orgId]);
  res.json({ ok: true, draft: v.widgets });
}));

app.post("/giving-pages/:id/page/publish", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const pg = await givingPageOr404(req.params.id, req.user.orgId);
  if (!pg) return res.status(404).json({ error: "not_found" });
  if (!Array.isArray(pg.draft) || !pg.draft.length) return res.status(400).json({ error: "nothing_to_publish" });
  await run(`UPDATE giving_pages SET published = draft, published_at = NOW(), updated_at = NOW()
             WHERE id = ? AND org_id = ?`, [pg.id, req.user.orgId]);
  await recordAssetPointerHistory(req.user.orgId, "giving_page.published", pg.id,
    widgetPathsOrNull(pg.published), widgetPathsOrNull(pg.draft), req.user.id, req.user.name);
  res.json({ ok: true });
}));

app.post("/giving-pages/:id/page/revert", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const pg = await givingPageOr404(req.params.id, req.user.orgId);
  if (!pg) return res.status(404).json({ error: "not_found" });
  await run(`UPDATE giving_pages SET draft = published, draft_updated_at = NOW(), updated_at = NOW()
             WHERE id = ? AND org_id = ?`, [pg.id, req.user.orgId]);
  await recordAssetPointerHistory(req.user.orgId, "giving_page.draft", pg.id,
    widgetPathsOrNull(pg.draft), widgetPathsOrNull(pg.published), req.user.id, req.user.name);
  // The reverted-away draft's photos are no longer referenced by anything.
  await pruneWidgetAssets(req.user.orgId);
  res.json({ ok: true });
}));

app.delete("/giving-pages/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { changes } = await run("DELETE FROM giving_pages WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!changes) return res.status(404).json({ error: "Not found" }); // BUILD-75 B: a foreign/unknown id answers 404, never a false success — one answer everywhere
  res.json({ success: true });
}));

// Public, token-authenticated — the entire "manage your fundraiser" auth
// model for v1 (see db.js comment). GET loads current editable fields; PUT
// saves them. Deliberately cannot touch status/slug/email — status is
// admin-only (takedown, below), and slug/email changes would break the
// link the supporter already shared or the one they received this token
// through, defeating the point of a durable bookmarkable link.
app.get("/peer-fundraisers/manage/:token", fundraiserManageLimiter, wrap(async (req, res) => {
  const rows = await query(
    `SELECT pf.*, gp.title AS giving_page_title, gp.slug AS giving_page_slug, o.name AS org_name, o.org_slug
     FROM peer_fundraisers pf
     JOIN giving_pages gp ON gp.id = pf.giving_page_id
     JOIN orgs o ON o.id = gp.org_id
     WHERE pf.edit_token = ?`,
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json({ error: "This link is invalid or has expired." });
  const f = rows[0];
  const raisedRow = await query("SELECT COALESCE(SUM(amount),0) AS total FROM gifts WHERE peer_fundraiser_id=?", [f.id]);
  res.json({
    name: f.name, slug: f.slug, story: f.story, imageUrl: f.image_url,
    personalGoalAmount: f.personal_goal_amount != null ? parseFloat(f.personal_goal_amount) : null,
    status: f.status,
    raisedAmount: parseFloat(raisedRow[0]?.total) || 0,
    orgName: f.org_name, givingPageTitle: f.giving_page_title,
    publicUrl: `${publicAppUrl()}/give/${f.org_slug}/${f.giving_page_slug}/${f.slug}`,
  });
}));

app.put("/peer-fundraisers/manage/:token", fundraiserManageLimiter, wrap(async (req, res) => {
  const rows = await query("SELECT * FROM peer_fundraisers WHERE edit_token = ?", [req.params.token]);
  if (!rows.length) return res.status(404).json({ error: "This link is invalid or has expired." });
  const existing = rows[0];
  const { name, personalGoalAmount, story, imageUrl } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: "Name cannot be empty." });
  if (name !== undefined && name.trim().length > 200) return res.status(400).json({ error: "Name is too long." });
  if (story && story.length > 5000) return res.status(400).json({ error: "Story is too long (5,000 character max)." });
  if (imageUrl && imageUrl.length > 2000) return res.status(400).json({ error: "Image URL is too long." });
  if (personalGoalAmount && (!Number.isFinite(parseFloat(personalGoalAmount)) || parseFloat(personalGoalAmount) <= 0)) return res.status(400).json({ error: "Personal goal must be a positive number." });
  await run(
    `UPDATE peer_fundraisers SET name=?, personal_goal_amount=?, story=?, image_url=?, updated_at=NOW() WHERE id=?`,
    [
      name !== undefined ? name.trim() : existing.name,
      personalGoalAmount !== undefined ? (personalGoalAmount ? parseFloat(personalGoalAmount) : null) : existing.personal_goal_amount,
      story !== undefined ? story : existing.story,
      imageUrl !== undefined ? imageUrl : existing.image_url,
      existing.id,
    ]
  );
  res.json({ success: true });
}));

// Staff-level read (requireAuth only, matches GET /giving-pages and the
// donor-list convention — donor/fundraiser PII is visible to any
// authenticated staff member throughout this app, not gated to admins;
// only the takedown mutation below is admin-only). org_id is filtered
// directly (see db.js comment on why peer_fundraisers carries its own
// org_id rather than relying solely on the giving_page_id join). Column
// list is explicit and deliberately omits edit_token — that's the
// fundraiser owner's own credential (see generateEditToken comment); the
// admin UI never needs it and has no legitimate reason to see it, so it's
// left out of the response rather than trusted to nobody reading pf.*.
app.get("/giving-pages/:id/fundraisers", requireAuth, wrap(async (req, res) => {
  const pageRows = await query("SELECT id FROM giving_pages WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!pageRows.length) return res.status(404).json({ error: "Not found" });
  const rows = await query(
    `SELECT pf.id, pf.giving_page_id, pf.name, pf.email, pf.slug, pf.personal_goal_amount, pf.story, pf.image_url, pf.status, pf.created_at, pf.updated_at,
       COALESCE((SELECT SUM(amount - COALESCE(cover_fee_amount,0)) FROM gifts WHERE peer_fundraiser_id = pf.id), 0) AS raised_amount
     FROM peer_fundraisers pf WHERE pf.giving_page_id=? AND pf.org_id=? ORDER BY raised_amount DESC, pf.created_at DESC`,
    [req.params.id, req.user.orgId]
  );
  res.json(rows);
}));

// Admin takedown — the safety valve: anyone can spin up a public page under
// an org's name, so staff need to be able to pull one down immediately.
// Status-only by design (not a general edit route) — content edits are the
// fundraiser owner's own business via their edit_token above; this route's
// entire job is the active/archived switch. Archiving here has the exact
// same effect as archiving a Giving Page itself: the public fundraiser page
// 404s and POST /donate/:orgSlug rejects new donations against it (both
// enforced by the WHERE status='active' clauses in the routes above).
app.put("/peer-fundraisers/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const { status } = req.body;
  if (!status || !["active", "archived"].includes(status)) return res.status(400).json({ error: "status must be 'active' or 'archived'" });
  const rows = await query("SELECT id FROM peer_fundraisers WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  await run("UPDATE peer_fundraisers SET status=?, updated_at=NOW() WHERE id=?", [status, req.params.id]);
  const updated = await query(
    `SELECT pf.id, pf.giving_page_id, pf.name, pf.email, pf.slug, pf.personal_goal_amount, pf.story, pf.image_url, pf.status, pf.created_at, pf.updated_at,
       COALESCE((SELECT SUM(amount - COALESCE(cover_fee_amount,0)) FROM gifts WHERE peer_fundraiser_id = pf.id), 0) AS raised_amount
     FROM peer_fundraisers pf WHERE pf.id=?`,
    [req.params.id]
  );
  res.json(updated[0]);
}));

// Donor-covers-fees gross-up (BUILD-08 Phase B): the amount to charge so the
// org nets approximately the intended gift after Stripe's standard card fee
// (2.9% + 30¢): gross = (net + 30) / (1 - 0.029). Standard published rate
// only — orgs on negotiated/nonprofit rates net slightly more, never less.
// The client computes the same number for DISPLAY; this server-side
// derivation is the one that gets charged (client math is never trusted).
const COVER_FEES_PCT = 0.029;
const COVER_FEES_FLAT_CENTS = 30;
function coverFeesGrossUpCents(netCents) {
  return Math.ceil((netCents + COVER_FEES_FLAT_CENTS) / (1 - COVER_FEES_PCT));
}

app.post("/donate/:orgSlug", donateLimiter, wrap(async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  const { firstName, lastName, email, campaignId } = req.body;
  // BUILD-102 Part 2 — `fundId` is a `let` because the FORM's designation
  // replaces whatever the request carried (a fixed form was never asking).
  let { amount, frequency, coverFees, fundId } = req.body;
  // BUILD-102 Part 3 — what the FORM asked, filled in below once its config has
  // been read. Declared here, above every line that reads it: the TDZ class has
  // cost this repo five builds and now fails the pre-push hook.
  let formAsks = null;
  let { givingPageId, peerFundraiserId } = req.body;
  // BUILD-98 (switch) Part 4 — a TICKET is priced by the SERVER from the level,
  // never by the amount the page sent. One-time only, and no fee gross-up: the
  // receipt's deductible split is computed on exactly what the level costs.
  const eventLevelId = req.body.eventLevelId ? String(req.body.eventLevelId) : null;
  const eventQty = eventLevelId ? Number(req.body.quantity || 1) : 1;
  if (eventLevelId) {
    if (!Number.isInteger(eventQty) || eventQty < 1 || eventQty > 50) return res.status(400).json({ error: "Choose between 1 and 50 tickets." });
    frequency = "once"; coverFees = false; amount = amount || "1";
  }
  // BUILD-101 Part 4 — a MEMBERSHIP, priced by the SERVER from the level (the
  // page's amount is ignored). One-time, or auto-renewing yearly through the
  // existing recurring path — only a 12-month level can auto-renew.
  const membershipLevelId = !eventLevelId && req.body.membershipLevelId ? String(req.body.membershipLevelId) : null;
  if (membershipLevelId) {
    frequency = frequency === "annual" ? "annual" : "once"; coverFees = false; amount = amount || "1";
  }
  if (!amount || !firstName || !lastName || !email) return res.status(400).json({ error: "All fields required" });

  const orgs = await query(
    "SELECT id, name, plan, stripe_account_id, stripe_connected, cover_fees_enabled FROM orgs WHERE org_slug = $1",
    [req.params.orgSlug]
  );
  if (!orgs.length) return res.status(404).json({ error: "Organization not found" });
  const org = orgs[0];
  if (!org.stripe_connected || !org.stripe_account_id) {
    return res.status(400).json({ error: "This organization is not set up to accept online donations yet." });
  }
  // BUILD-46 S-14: a network (Portal-tier) org is un-giftable until a human
  // approved its application — indistinguishable from a not-set-up org. An
  // auto-delisted org is blocked the same way (portal stays up, new gifts
  // stop). CRM orgs (any other plan) are untouched.
  if (org.plan === "portal") {
    const appRows = await query(`SELECT status FROM network_applications WHERE org_id = ?`, [org.id]);
    if (!appRows.length || appRows[0].status !== "approved") {
      return res.status(400).json({ error: "This organization is not set up to accept online donations yet." });
    }
  }

  let baseCents = toCents(amount);                       // BUILD-73: the money seam
  let eventLevel = null, eventRow = null;
  if (eventLevelId) {
    [eventLevel] = await query("SELECT * FROM event_levels WHERE id=? AND org_id=?", [eventLevelId, org.id]);
    if (eventLevel) [eventRow] = await query("SELECT * FROM events WHERE id=? AND org_id=? AND status <> 'cancelled'", [eventLevel.event_id, org.id]);
    if (!eventLevel || !eventRow) return res.status(400).json({ error: "This ticket is no longer available." });
    if (eventLevel.capacity != null) {
      const [t] = await query("SELECT COALESCE(SUM(quantity),0)::int AS n FROM event_attendees WHERE level_id=? AND status <> 'cancelled'", [eventLevel.id]);
      if ((t?.n || 0) + eventQty > eventLevel.capacity) return res.status(409).json({ error: `${eventLevel.name} is sold out.` });
    }
    baseCents = Math.round(Number(eventLevel.price) * 100) * eventQty;
  }
  let memLevel = null;
  if (membershipLevelId) {
    [memLevel] = await query("SELECT * FROM membership_levels WHERE id=? AND org_id=? AND active IS NOT FALSE", [membershipLevelId, org.id]);
    if (!memLevel) return res.status(400).json({ error: "This membership is no longer available." });
    if (frequency === "annual" && memLevel.term !== "12_months") return res.status(400).json({ error: "This membership cannot renew automatically." });
    baseCents = Math.round(Number(memLevel.price) * 100);
  }
  if (baseCents === null) return res.status(400).json({ error: "Invalid donation amount" });
  if (baseCents < 100) return res.status(400).json({ error: "Minimum donation is $1" });

  // Re-derived server-side from the base amount — the client sends only the
  // boolean, never its own total. The full charged amount IS the donation
  // (gifts + receipts record what was actually charged; no fee itemization).
  const feesCovered = !!coverFees && org.cover_fees_enabled !== false;
  const amountCents = feesCovered ? coverFeesGrossUpCents(baseCents) : baseCents;

  const donorName = `${firstName} ${lastName}`.trim();
  const isRecurring = frequency === "monthly" || frequency === "annual";
  const frontendUrl = publicAppUrl();


  // Peer-fundraiser donations always resolve givingPageId from the
  // fundraiser row itself, not whatever the client sent — the fundraiser
  // record is the source of truth for which campaign it belongs to (see
  // "no such thing as a fundraiser not tied to a campaign" in db.js), so
  // this can never end up with a peer_fundraiser_id/giving_page_id pair
  // that disagree. A fundraiser whose parent page has since been archived
  // is treated as unavailable too — a fundraiser can't outlive its campaign.
  let fundraiserSlug = "";
  let fundraiserName = "";
  if (peerFundraiserId) {
    const fRow = await query(
      `SELECT pf.slug, pf.name, pf.giving_page_id FROM peer_fundraisers pf
       JOIN giving_pages gp ON gp.id = pf.giving_page_id
       WHERE pf.id=? AND pf.status='active' AND gp.org_id=? AND gp.status='active'`,
      [peerFundraiserId, org.id]
    );
    if (!fRow.length) return res.status(400).json({ error: "This fundraiser is no longer available." });
    fundraiserSlug = fRow[0].slug;
    fundraiserName = fRow[0].name;
    givingPageId = fRow[0].giving_page_id;
  } else {
    peerFundraiserId = null;
  }

  // Independent of campaignId (email-campaign attribution) — validated
  // against this org so a stale/foreign givingPageId can't get tagged onto
  // a gift. Determines the return URL (back to the specific giving page,
  // not the org-wide one) as well as the metadata thread.
  let givingPageSlug = "";
  let pageTitle = "";
  let pageCampaignId = null;
  if (givingPageId) {
    const pageRow = await query("SELECT slug, title, campaign_id FROM giving_pages WHERE id=? AND org_id=? AND status='active'", [givingPageId, org.id]);
    if (!pageRow.length) return res.status(400).json({ error: "This giving page is no longer available." });
    givingPageSlug = pageRow[0].slug;
    pageTitle = pageRow[0].title;
    pageCampaignId = pageRow[0].campaign_id || null;
  }

  // ── BUILD-102 Part 2 — THE FORM'S CONFIG CONSTRAINS THE CHARGE ───────────
  // The server has always priced the charge; this is the narrower rule the form
  // adds. A form offering four amounts and no box to type in may not be charged
  // $3.17 because somebody edited the request, and the designation is the FORM's
  // rather than the request's (the BUILD-88a rule — which fund is the default is
  // the server's to say — applied to a page a stranger opens from a flyer).
  //
  // It runs ONLY for a gift arriving through a giving page, and only for a plain
  // donation: a ticket and a membership are already priced from their own level
  // above, and running this over them would be a second opinion about a price
  // the server itself just set.
  if (givingPageId && !eventLevelId && !membershipLevelId) {
    const F = await formConfigMod();
    const [pageCfgRow] = await query("SELECT form_config FROM giving_pages WHERE id=? AND org_id=?", [givingPageId, org.id]);
    const cfg = pageCfgRow ? pageCfgRow.form_config : null;
    const orgFunds = await query("SELECT id, name FROM fin_funds WHERE org_id=?", [org.id]);
    const amountCheck = F.checkRequestedAmount(cfg, baseCents, { funds: orgFunds });
    if (!amountCheck.ok) {
      return res.status(400).json({ error: amountCheck.message, code: amountCheck.code,
                                    amountsCents: amountCheck.amountsCents });
    }
    const des = F.resolveDesignation(cfg, fundId, { funds: orgFunds });
    if (des.from === "refused") return res.status(400).json({ error: des.message, code: des.code });
    // The form's answer REPLACES whatever the request carried, and `fundName` is
    // re-read from it below rather than from the request's id.
    fundId = des.fundId || null;
    // A FREQUENCY THE FORM DOES NOT OFFER IS REFUSED. A form with monthly
    // switched off must not be able to mint a subscription through a hand-rolled
    // request — that is a recurring charge the org never agreed to take.
    const spec = F.formSpec(cfg, { funds: orgFunds, orgName: "" });
    const wanted = frequency === "monthly" || frequency === "annual" ? "monthly" : "once";
    if (!spec.amount.frequencies.includes(wanted)) {
      return res.status(400).json({ error: "This form does not offer monthly giving.", code: "frequency_not_offered" });
    }
    // ── BUILD-102 Part 3 — ONLY WHAT THE FORM ASKED IS KEPT ────────────────
    // A tribute from a form that does not show tribute fields, an employer from
    // a form that does not ask where you work, an answer to a question that is
    // not on the form: each is a field nobody was asked, arriving from a request
    // somebody wrote by hand. Dropped silently rather than refused — the donor
    // did nothing wrong and their gift must still go through — but never stored,
    // because a tribute nobody was asked for becomes a draft letter to a family.
    formAsks = { tributeType: null, tributeName: null, employer: null, answers: {} };
    if (spec.details.tribute && req.body.tributeType) {
      const t = String(req.body.tributeType) === "memory" ? "memory"
        : String(req.body.tributeType) === "honor" ? "honor" : null;
      if (t) {
        formAsks.tributeType = t;
        formAsks.tributeName = String(req.body.tributeName || "").trim().slice(0, 200);
        // WHO SHOULD HEAR ABOUT IT. BUILD-98 writes a tribute notice only when
        // somebody is named to receive one, which is right — a notice with nobody
        // to send it to is a draft nobody will ever open. Optional: a donor may
        // dedicate a gift without telling a family about it.
        formAsks.notifyName = String(req.body.notifyName || "").trim().slice(0, 200);
        formAsks.notifyEmail = String(req.body.notifyEmail || "").trim().slice(0, 200);
      }
    }
    if (spec.details.employerMatch && req.body.employer) {
      formAsks.employer = String(req.body.employer).trim().slice(0, 200);
    }
    const asked = new Map(spec.details.questions.map(q => [q.key, q]));
    const given = req.body.answers && typeof req.body.answers === "object" ? req.body.answers : {};
    for (const [k, v] of Object.entries(given)) {
      const q = asked.get(k);
      if (!q) continue;                               // not on this form
      if (q.type === "yesno") { formAsks.answers[k] = v === true || v === "yes"; continue; }
      const val = String(v == null ? "" : v).trim().slice(0, 480);
      if (!val) continue;
      // A CHOICE MAY ONLY BE ONE OF ITS OWN OPTIONS. Otherwise a hand-rolled
      // answer writes free text into a field the report builder groups by, and
      // the grouping quietly stops meaning anything.
      if (q.type === "choice" && !q.options.includes(val)) continue;
      formAsks.answers[k] = val;
    }
  }

  // Resolved AFTER the form has had its say, so a fixed designation cannot
  // charge one fund and label the gift with the one the request asked for.
  let fundName = "";
  if (fundId) {
    const fundRow = await query("SELECT name FROM fin_funds WHERE id=$1 AND org_id=$2", [fundId, org.id]);
    if (fundRow.length) fundName = fundRow[0].name;
  }

  // Attribution FIX — a page configured to count toward a campaign stamps that
  // campaign into the charge metadata, so the webhook writes gifts.campaign_id
  // and the thermometer moves with no human touch. The page's own configured
  // campaign WINS over any client-sent campaignId (an email-campaign ref):
  // the admin explicitly declared where this page's money counts. Validated by
  // construction — pageCampaignId was written through the org-scoped
  // POST/PUT /giving-pages validation, never trusted raw from this request.
  const effectiveCampaignId = pageCampaignId || campaignId || "";

  const productName = memLevel
    ? `${memLevel.name} membership — ${org.name}`
    : eventLevel
    ? `${eventQty} × ${eventLevel.name} — ${eventRow.name}`
    : peerFundraiserId
    ? `Donation to ${org.name} — ${pageTitle} (via ${fundraiserName}'s fundraiser)`
    : givingPageId
      ? `Donation to ${org.name} — ${pageTitle}`
      : `Donation to ${org.name}${fundName ? ` — ${fundName}` : ""}`;
  const metadata = {
    donor_email: email,
    donor_name: donorName,
    fund_id: fundId || "",
    frequency,
    campaign_id: effectiveCampaignId,
    giving_page_id: givingPageId || "",
    peer_fundraiser_id: peerFundraiserId || "",
    org_id: org.id,
    // Reference only — the gift/receipt record the full charged amount.
    cover_fees: feesCovered ? "true" : "",
    base_amount_cents: feesCovered ? String(baseCents) : "",
    // BUILD-98 (switch) Part 4 — the webhook writes the ticket's fair-market
    // split and the guest-list row from these, re-reading the level itself.
    event_level_id: eventLevel ? eventLevel.id : "",
    event_qty: eventLevel ? String(eventQty) : "",
    // BUILD-101 Part 4 — the webhook re-reads the level from this id.
    membership_level_id: memLevel ? memLevel.id : "",
  };
  // ── BUILD-102 Part 3 — WHAT THE FORM ASKED, carried to the webhook ────────
  // One metadata key per thing rather than a JSON blob, because Stripe's own
  // dashboard is where a support question actually gets answered, and a blob is
  // unreadable there. Stripe allows 50 keys of 500 characters; five questions
  // plus a tribute plus an employer fits with room to spare.
  //
  // These are only carried for a gift arriving through a CONFIGURED form: the
  // form is what asked the questions, and a field nobody was asked must not
  // arrive from a hand-rolled request. `formAsks` is set by the Part 2 block.
  // BUILD-102 Part 5 — the UTM tags, carried for EVERY gift through a giving
  // page, not only a configured form: a tagged link to an unconfigured page is
  // still a link somebody sent, and the question "which email brought this in" is
  // the same question. Read through the ONE shared cleaner.
  {
    const F = await formConfigMod();
    const utm = F.utmFrom(req.body.utm && typeof req.body.utm === "object" ? req.body.utm : req.body);
    for (const [k, v] of Object.entries(utm)) metadata[k] = v;
    // BUILD-102 Part 6 — which side of an A/B this gift came through, so the
    // completion lands on the right variant. The page tells us; it has nothing to
    // gain by lying and the only consequence of a wrong value is a wrong count on
    // one side of a test the org is running on itself.
    if (req.body.variant === "a" || req.body.variant === "b") metadata.variant = req.body.variant;
  }
  if (formAsks) {
    if (formAsks.tributeType) {
      metadata.tribute_type = formAsks.tributeType;
      metadata.tribute_name = formAsks.tributeName || "";
      if (formAsks.notifyName) metadata.notify_name = formAsks.notifyName;
      if (formAsks.notifyEmail) metadata.notify_email = formAsks.notifyEmail;
    }
    if (formAsks.employer) metadata.employer = formAsks.employer;
    for (const [k, v] of Object.entries(formAsks.answers || {})) {
      metadata["q_" + k] = typeof v === "boolean" ? (v ? "yes" : "no") : String(v).slice(0, 480);
    }
  }
  // BUILD-77 Part 6 — a valid reconnect token stitches the resulting
  // subscription to the EXISTING donor (webhook reads reconnect_donor_id).
  const reconnectDecoded = req.body.reconnectToken ? verifyReconnectToken(req.body.reconnectToken) : null;
  if (reconnectDecoded && reconnectDecoded.orgId === org.id) metadata.reconnect_donor_id = reconnectDecoded.donorId;

  const returnPath = peerFundraiserId
    ? `/give/${req.params.orgSlug}/${givingPageSlug}/${fundraiserSlug}`
    : givingPageId
      ? `/give/${req.params.orgSlug}/${givingPageSlug}`
      : `/give/${req.params.orgSlug}`;

  const sessionParams = {
    payment_method_types: ["card"],
    mode: isRecurring ? "subscription" : "payment",
    customer_email: email,
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: { name: productName },
        unit_amount: amountCents,
        ...(isRecurring && { recurring: { interval: frequency === "annual" ? "year" : "month" } }),
      },
      quantity: 1,
    }],
    metadata,
    success_url: `${frontendUrl}${returnPath}?donated=true`,
    cancel_url: `${frontendUrl}${returnPath}`,
    ...(isRecurring
      ? { subscription_data: { metadata } }
      : {
          payment_intent_data: {
            receipt_email: email,
            metadata,
            statement_descriptor: org.name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 22),
          },
        }
    ),
  };

  const session = await stripe.checkout.sessions.create(sessionParams, {
    stripeAccount: org.stripe_account_id,
  });
  res.json({ url: session.url });
}));

// ── Demo request (no auth — public landing page) ──────────────────────────
app.post("/demo-request", wrap(async (req, res) => {
  const { name, email, orgName, orgSize, challenge } = req.body;
  if (!name || !email) return res.status(400).json({ error: "Name and email required" });

  // Store in DB for reference
  await run(
    `CREATE TABLE IF NOT EXISTS demo_requests (
      id TEXT PRIMARY KEY,
      name TEXT, email TEXT, org_name TEXT,
      org_size TEXT, challenge TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
  await run(
    `INSERT INTO demo_requests (id, name, email, org_name, org_size, challenge)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), name, email, orgName || "", orgSize || "", challenge || ""]
  );

  // Send notification email via Resend HTTP API
  const notifyTo = process.env.DEMO_NOTIFY_EMAIL;
  if (notifyTo && process.env.RESEND_API_KEY) {
    try {
      const from = process.env.DEMO_SMTP_FROM || "onboarding@resend.dev";
      const { error } = await resend.emails.send({
        from,
        to: notifyTo,
        subject: `New Steward demo request — ${name} (${orgName || "unknown org"})`,
        html: `<p><strong>New demo request:</strong></p>
               <p>Name: ${name}<br>Email: ${email}<br>Org: ${orgName}<br>Size: ${orgSize}<br>Challenge: ${challenge}</p>`,
      });
      if (error) throw new Error(error.message);
    } catch (e) {
      console.error("Demo notify email failed:", e.message);
    }
  }

  res.json({ success: true });
}));

// Ops/test hook — same bar as /recurring/process-dunning. {dryRun} composes
// without sending or stamping; {today} pins the month so the window is
// testable without waiting for a calendar.
app.post("/recurring/check-cards", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [org] = await query("SELECT id, name, recurring_dunning_enabled FROM orgs WHERE id=?", [req.user.orgId]);
  if (!org) return res.status(404).json({ error: "Org not found" });
  const refreshed = req.body && req.body.skipRefresh ? null
    : await refreshCardsOnFile({ orgId: req.user.orgId, limit: Math.min(Math.max(parseInt(req.body?.limit, 10) || CARD_CHECK_BUDGET, 1), 2000) });
  const today = req.body && req.body.today ? new Date(req.body.today + "T12:00:00Z") : new Date();
  const out = await notifyExpiringCards(org, { send: !(req.body && req.body.dryRun), today });
  res.json({ refreshed, ...out });
}));

app.post("/recurring/process-dunning", requireAuth, requireAdmin, wrap(async (req, res) => {
  await processDunning();
  res.json({ success: true });
}));

// Public — a donor clicking the "Update my card" button in a dunning email.
// No login: verified via the signed recovery token. Checkout "setup" mode
// chosen over the Stripe Billing Customer Portal because the Portal requires
// its own per-connected-account configuration (branding, enabled features)
// across every one of Steward's connected orgs, which isn't something
// Steward can provision centrally at signup time; a setup-mode Checkout
// Session is fully self-contained per request, so it's the simpler and safer
// choice here even though the Portal is Stripe's more "official" tool for
// letting a customer manage a payment method on file.
app.get("/recurring/update-card", wrap(async (req, res) => {
  if (!stripe) return res.status(503).send("Payments are not configured.");
  const decoded = verifyRecoveryToken(req.query.token);
  if (!decoded) return res.status(400).send("This link is invalid or has expired.");

  const orgRows = await query("SELECT id, name, org_slug, stripe_account_id FROM orgs WHERE id=?", [decoded.orgId]);
  const org = orgRows[0];
  if (!org || !org.stripe_account_id) return res.status(404).send("This organization could not be found.");

  const rsRows = await query(
    "SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id=? AND org_id=?",
    [decoded.subscriptionId, org.id]
  );
  const rs = rsRows[0];
  if (!rs) return res.status(404).send("This subscription could not be found.");

  const frontendUrl = publicAppUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    payment_method_types: ["card"],
    ...(rs.stripe_customer_id ? { customer: rs.stripe_customer_id } : {}),
    setup_intent_data: { metadata: { subscription_id: rs.stripe_subscription_id, org_id: org.id } },
    success_url: `${frontendUrl}/give/${org.org_slug}?card_updated=true`,
    cancel_url: `${frontendUrl}/give/${org.org_slug}`,
  }, { stripeAccount: org.stripe_account_id });

  res.redirect(303, session.url);
}));

// ══ BUILD-57 Part 1 — THE STAFF RECURRING-GIVING SURFACE ═══════════════════
// The page a development office manages the sustainer program from. The
// pre-answered rule: anything that can MOVE MONEY (create / amount /
// frequency / card) is an INVITATION the donor completes; pause / resume /
// cancel / fund-designation are staff-direct. Staff never touch card data —
// no exceptions. Every staff-side change fires an UNSUPPRESSIBLE donor
// notification (sendRecurringDonorEmail above). New org-side donor-identity
// routes here are in the org-blindness battery (tests/org-blindness.test.js).

const monthlyEq = (amount, interval) => {
  const a = parseFloat(amount) || 0;
  return interval === "year" ? a / 12 : a;
};

// Loads an org-owned subscription + its donor, or responds 404 (foreign /
// unknown ids are indistinguishable — standard org-scoping discipline).
async function staffOwnedSub(req, res) {
  const rows = await query(
    `SELECT rs.*, d.name AS donor_name, d.email AS donor_email
       FROM recurring_subscriptions rs
       JOIN donors d ON d.id = rs.donor_id AND d.org_id = rs.org_id
      WHERE rs.id = ? AND rs.org_id = ?`,
    [req.params.subId, req.user.orgId]);
  if (!rows.length) { res.status(404).json({ error: "not_found" }); return null; }
  return rows[0];
}

async function staffActorName(req) {
  const rows = await query("SELECT name FROM users WHERE id = ? AND org_id = ?", [req.user.userId, req.user.orgId]).catch(() => []);
  return rows[0]?.name || req.user.email || "Staff";
}

async function staffRecurringOrg(orgId) {
  const rows = await query("SELECT id, name, org_slug, stripe_account_id FROM orgs WHERE id = ?", [orgId]);
  return rows[0] || null;
}

async function noteRecurringAction(orgId, donorId, text, actorName) {
  const today = new Date().toISOString().slice(0, 10);
  await run(
    "INSERT INTO interactions (id,org_id,donor_id,type,note,date,logged_by_name) VALUES (?,?,?,'note',?,?,?)",
    ["i_" + uuid().slice(0, 8), orgId, donorId, text, today, actorName]).catch(() => {});
}

// The roster — every subscription, plus pending create-invitations. Sorting/
// filtering is client-side; the at-risk-first default order is server-side so
// the failure queue is the first thing every consumer of this payload sees.
app.get("/recurring/roster", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  await expireStaleProposals(orgId);
  const [subs, proposals] = await Promise.all([
    query(
      `SELECT rs.id, rs.donor_id, rs.amount, rs.interval, rs.status, rs.fund_id,
              rs.failure_count, rs.first_failed_at, rs.last_failed_at, rs.dunning_step,
              rs.paused_at, rs.resume_at, rs.canceled_at, rs.recovered_at,
              rs.created_at, rs.current_period_end,
              d.name AS donor_name, d.email AS donor_email,
              f.name AS fund_name,
              COALESCE(g.total, 0) AS total_given, COALESCE(g.cnt, 0)::int AS linked_gift_count
         FROM recurring_subscriptions rs
         JOIN donors d ON d.id = rs.donor_id AND d.org_id = rs.org_id AND d.deleted_at IS NULL
         LEFT JOIN fin_funds f ON f.id = rs.fund_id AND f.org_id = rs.org_id
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS total, COUNT(*) AS cnt FROM gifts
            WHERE org_id = rs.org_id AND recurring_subscription_id = rs.id
         ) g ON true
        WHERE rs.org_id = ?
        ORDER BY (rs.status IN ('past_due','recovering')) DESC, rs.last_failed_at DESC NULLS LAST, rs.created_at DESC`,
      [orgId]),
    query(
      `SELECT p.id, p.donor_id, p.subscription_id, p.kind, p.proposed_amount, p.proposed_interval,
              p.proposed_fund_id, p.status, p.resend_count, p.expires_at, p.created_at, p.created_by_name,
              d.name AS donor_name, f.name AS fund_name
         FROM recurring_proposals p
         JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
         LEFT JOIN fin_funds f ON f.id = p.proposed_fund_id AND f.org_id = p.org_id
        WHERE p.org_id = ? AND p.status = 'pending'
        ORDER BY p.created_at DESC`,
      [orgId]),
  ]);
  const pendingBySub = {};
  for (const p of proposals) if (p.subscription_id) pendingBySub[p.subscription_id] = p;
  const rows = subs.map(s => {
    const pending = pendingBySub[s.id] || null;
    // Display precedence: canceled > past due > paused > pending donor
    // action > active. A failing card outranks a pending proposal — the
    // at-risk queue is the point of the page.
    const displayStatus =
      s.status === "canceled" ? "canceled"
        : ["past_due", "recovering"].includes(s.status) ? "past_due"
        : s.status === "paused" ? "paused"
        : pending ? "pending"
        : "active";
    return {
      id: s.id, donorId: s.donor_id, donorName: s.donor_name, donorEmail: s.donor_email,
      amount: s.amount != null ? parseFloat(s.amount) : null, interval: s.interval || "month",
      status: s.status, displayStatus,
      fundId: s.fund_id || null, fundName: s.fund_name || null,
      nextChargeAt: s.current_period_end || null, startedAt: s.created_at,
      totalGiven: parseFloat(s.total_given) || 0, linkedGiftCount: s.linked_gift_count,
      failureCount: s.failure_count, lastFailedAt: s.last_failed_at, dunningStep: s.dunning_step,
      pausedAt: s.paused_at, resumeAt: s.resume_at, canceledAt: s.canceled_at,
      pendingProposal: pending ? { id: pending.id, kind: pending.kind, expiresAt: pending.expires_at, resendCount: pending.resend_count } : null,
    };
  });
  const invitations = proposals.filter(p => !p.subscription_id).map(p => ({
    id: p.id, donorId: p.donor_id, donorName: p.donor_name, kind: p.kind,
    proposedAmount: p.proposed_amount != null ? parseFloat(p.proposed_amount) : null,
    proposedInterval: p.proposed_interval, fundName: p.fund_name || null,
    expiresAt: p.expires_at, resendCount: p.resend_count, createdAt: p.created_at,
    createdByName: p.created_by_name || null,
  }));
  res.json({ subs: rows, invitations });
}));

// The movement summary — current MRR plus the month-to-date waterfall over
// the append-only recurring_change_log. Involuntary (card failure) and
// voluntary (donor chose) churn are SEPARATE rows by design: one is a
// technical problem you can fix, the other a relationship problem you can't.
app.get("/recurring/movement", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [mrrRows, changeRows, cohortRows] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(CASE WHEN interval='year' THEN amount/12 ELSE amount END),0) AS mrr,
              COUNT(*) FILTER (WHERE status IN ('active','recovered'))::int AS healthy,
              COUNT(*) FILTER (WHERE status IN ('past_due','recovering'))::int AS at_risk
         FROM recurring_subscriptions
        WHERE org_id = ? AND status IN ('active','recovered','past_due','recovering')`,
      [orgId]),
    query(
      `SELECT kind, old_amount, new_amount, sub_interval FROM recurring_change_log
        WHERE org_id = ? AND created_at >= date_trunc('month', NOW())`,
      [orgId]),
    // 12-month sustainer retention: every subscription whose 12-month mark
    // has passed — retained means it was still alive at that mark.
    query(
      `SELECT COUNT(*)::int AS cohort,
              COUNT(*) FILTER (WHERE canceled_at IS NULL OR canceled_at >= created_at + INTERVAL '12 months')::int AS retained
         FROM recurring_subscriptions
        WHERE org_id = ? AND created_at <= NOW() - INTERVAL '12 months'`,
      [orgId]),
  ]);
  const buckets = {
    new: { count: 0, amount: 0 }, upgraded: { count: 0, amount: 0 }, downgraded: { count: 0, amount: 0 },
    paused: { count: 0, amount: 0 }, resumed: { count: 0, amount: 0 },
    involuntaryChurn: { count: 0, amount: 0 }, voluntaryChurn: { count: 0, amount: 0 },
  };
  for (const c of changeRows) {
    const oldEq = monthlyEq(c.old_amount, c.sub_interval);
    const newEq = monthlyEq(c.new_amount, c.sub_interval);
    if (c.kind === "created") { buckets.new.count++; buckets.new.amount += newEq; }
    else if (c.kind === "amount_up") { buckets.upgraded.count++; buckets.upgraded.amount += newEq - oldEq; }
    else if (c.kind === "amount_down") { buckets.downgraded.count++; buckets.downgraded.amount += oldEq - newEq; }
    else if (c.kind === "paused") { buckets.paused.count++; buckets.paused.amount += oldEq; }
    else if (c.kind === "resumed") { buckets.resumed.count++; buckets.resumed.amount += newEq; }
    else if (c.kind === "canceled_involuntary") { buckets.involuntaryChurn.count++; buckets.involuntaryChurn.amount += oldEq; }
    else if (c.kind === "canceled_voluntary") { buckets.voluntaryChurn.count++; buckets.voluntaryChurn.amount += oldEq; }
  }
  const round2 = n => Math.round(n * 100) / 100;
  for (const k of Object.keys(buckets)) buckets[k].amount = round2(buckets[k].amount);
  const net = round2(
    buckets.new.amount + buckets.upgraded.amount + buckets.resumed.amount
    - buckets.downgraded.amount - buckets.paused.amount
    - buckets.involuntaryChurn.amount - buckets.voluntaryChurn.amount);
  const cohort = cohortRows[0]?.cohort || 0;
  const retained = cohortRows[0]?.retained || 0;
  // (2026-09-11) The card that has not failed YET. Counted apart from at-risk
  // on purpose: at-risk is money already broken, expiring is money still
  // savable with one email, and merging them would bury the actionable half.
  const expSoon = await query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS mrr
       FROM recurring_subscriptions
      WHERE org_id = ? AND status IN ('active','past_due','recovering')
        AND card_exp_year IS NOT NULL AND card_exp_month IS NOT NULL
        AND make_date(card_exp_year, card_exp_month, 1)
            BETWEEN date_trunc('month', CURRENT_DATE)::date
                AND (date_trunc('month', CURRENT_DATE) + interval '1 month')::date`, [orgId]);

  res.json({
    mrr: round2(parseFloat(mrrRows[0]?.mrr) || 0),
    healthyCount: mrrRows[0]?.healthy || 0,
    atRiskCount: mrrRows[0]?.at_risk || 0,
    expiringCount: expSoon[0]?.n || 0,
    mrrExpiring: round2(parseFloat(expSoon[0]?.mrr) || 0),
    waterfall: { monthStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), ...buckets, net },
    // No cohort → null, never a fake 0% (the empty-state honesty rule).
    retention12: { rate: cohort ? round2((retained / cohort) * 100) : null, cohortSize: cohort, retained },
    // If the sector benchmark is cited anywhere, it is THIS, sourced:
    benchmark: { value: 71, source: "M+R Benchmarks 2026", label: "sustainer retention at 12 months" },
  });
}));

// The dashboard's exceptions payload — "who needs you today," counts + short
// lists only. Deliberately NOT the roster (the design rule: if the same
// table renders twice, the design is wrong).
app.get("/recurring/exceptions", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  await expireStaleProposals(orgId);
  const [failed, exhausted, proposals, activeSubs] = await Promise.all([
    query(
      `SELECT rs.id, rs.amount, rs.interval, rs.status, rs.last_failed_at, rs.dunning_step, rs.failure_count,
              rs.donor_id, d.name AS donor_name
         FROM recurring_subscriptions rs
         JOIN donors d ON d.id = rs.donor_id AND d.org_id = rs.org_id AND d.deleted_at IS NULL
        WHERE rs.org_id = ? AND rs.status IN ('past_due','recovering')
        ORDER BY rs.last_failed_at DESC NULLS LAST`,
      [orgId]),
    // Dunning cadence exhausted and still unresolved — Stripe's own retries
    // are all that's left before customer.subscription.deleted (churn).
    query(
      `SELECT rs.id, rs.amount, rs.interval, rs.last_failed_at, rs.donor_id, d.name AS donor_name
         FROM recurring_subscriptions rs
         JOIN donors d ON d.id = rs.donor_id AND d.org_id = rs.org_id AND d.deleted_at IS NULL
        WHERE rs.org_id = ? AND rs.status = 'recovering' AND rs.next_dunning_at IS NULL
        ORDER BY rs.last_failed_at ASC NULLS LAST`,
      [orgId]),
    query(
      `SELECT p.id, p.kind, p.expires_at, p.resend_count, p.donor_id, p.subscription_id, d.name AS donor_name
         FROM recurring_proposals p
         JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
        WHERE p.org_id = ? AND p.status = 'pending'
        ORDER BY p.expires_at ASC`,
      [orgId]),
    query(
      `SELECT rs.id, rs.amount, rs.interval, rs.created_at, rs.donor_id, d.name AS donor_name
         FROM recurring_subscriptions rs
         JOIN donors d ON d.id = rs.donor_id AND d.org_id = rs.org_id AND d.deleted_at IS NULL
        WHERE rs.org_id = ? AND rs.status IN ('active','recovered')`,
      [orgId]),
  ]);
  // Sustainer anniversaries worth a note: an active subscription whose start
  // date's month/day lands inside the next 14 days, at least a year in.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const anniversaries = [];
  for (const s of activeSubs) {
    const start = new Date(s.created_at);
    if (Number.isNaN(start.getTime())) continue;
    const anniv = new Date(today.getFullYear(), start.getMonth(), start.getDate());
    if (anniv < today) anniv.setFullYear(anniv.getFullYear() + 1);
    const years = anniv.getFullYear() - start.getFullYear();
    const daysOut = Math.round((anniv - today) / 86400000);
    if (years >= 1 && daysOut <= 14) {
      anniversaries.push({
        subId: s.id, donorId: s.donor_id, donorName: s.donor_name,
        amount: s.amount != null ? parseFloat(s.amount) : null, interval: s.interval || "month",
        years, date: anniv.toISOString().slice(0, 10), daysOut,
      });
    }
  }
  anniversaries.sort((a, b) => a.daysOut - b.daysOut);
  const mapSub = s => ({
    subId: s.id, donorId: s.donor_id, donorName: s.donor_name,
    amount: s.amount != null ? parseFloat(s.amount) : null, interval: s.interval || "month",
    lastFailedAt: s.last_failed_at || null, dunningStep: s.dunning_step, failureCount: s.failure_count,
  });
  // BUILD-83 Part 5.2 — the file's own stopped monthly donors are an exception
  // too. Without them the tab could say "nothing needs you" while 160 people
  // Steward had already detected had stopped giving.
  const stoppedCutoff = orgTime.addDays(orgToday(await orgTz(orgId)), -60);   // ORG_TZ_SEAM_OK — same window as sustainerFileFacts
  const stoppedFile = await query(
    `SELECT id, name, imported_sustainer_amount AS amount, imported_sustainer_last_gift AS last_gift, email
       FROM donors
      WHERE org_id=? AND deleted_at IS NULL AND imported_sustainer IS TRUE
        AND (COALESCE(tags::text,'') LIKE '%card-failed%' OR COALESCE(tags::text,'') LIKE '%stale-frequency%'
             OR (imported_sustainer_last_gift IS NOT NULL AND imported_sustainer_last_gift < ?))
      ORDER BY imported_sustainer_amount DESC NULLS LAST LIMIT 500`, [orgId, stoppedCutoff]);

  res.json({
    counts: {
      failedCards: failed.length, aboutToLapse: exhausted.length,
      pendingProposals: proposals.length, anniversaries: anniversaries.length,
      stoppedFromFile: stoppedFile.length,
    },
    stoppedFromFileList: stoppedFile.slice(0, 8).map(r => ({
      id: r.id, donorId: r.id, donorName: r.name,
      detail: `${r.amount ? "$" + Number(r.amount).toLocaleString() + "/mo" : "monthly giving"}${r.last_gift ? " · nothing since " + r.last_gift : ""}${r.email ? "" : " · no email on file"}`,
    })),
    failedCards: failed.slice(0, 8).map(mapSub),
    aboutToLapse: exhausted.slice(0, 8).map(mapSub),
    pendingProposals: proposals.slice(0, 8).map(p => ({
      id: p.id, kind: p.kind, donorId: p.donor_id, donorName: p.donor_name,
      subscriptionId: p.subscription_id, expiresAt: p.expires_at, resendCount: p.resend_count,
    })),
    anniversaries: anniversaries.slice(0, 8),
  });
}));

// ── BUILD-77 Part 5 — the unlinked sustainer list + the reconnect send ─────
// Imported sustainers: history here, no payment authorization (nobody can
// import a live card). The list tells the true sentence and routes the
// stopped ones out of "lapsed" into their own recovery language; the
// recovery stats come from real reconnect_sends rows.
app.get("/recurring/unlinked", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const today = orgToday(await orgTz(orgId));                 // ORG_TZ_SEAM_OK
  const stopCutoff = orgTime.addDays(today, -60);
  const rows = await query(
    `SELECT d.id, d.name, d.email,
            d.imported_sustainer_amount::float AS amount,
            d.imported_sustainer_last_gift AS last_gift,
            (SELECT MIN(g.date) FROM gifts g WHERE g.donor_id=d.id AND g.org_id=d.org_id) AS first_gift,
            (SELECT COUNT(*)::int FROM gifts g WHERE g.donor_id=d.id AND g.org_id=d.org_id AND g.amount>0) AS gift_count,
            rc.sent_at, rc.reconnected_at
       FROM donors d
       LEFT JOIN reconnect_sends rc ON rc.org_id=d.org_id AND rc.donor_id=d.id
      WHERE d.org_id=? AND d.deleted_at IS NULL AND d.imported_sustainer IS TRUE
      ORDER BY (d.imported_sustainer_last_gift < ?) DESC, d.imported_sustainer_amount DESC NULLS LAST`,
    [orgId, stopCutoff]);
  const monthsBetween = (a, b) => {
    const ca = orgTime.parseCivil(String(a).slice(0, 10)), cb = orgTime.parseCivil(String(b).slice(0, 10));
    if (!ca || !cb) return null;
    return Math.max(1, (cb.y - ca.y) * 12 + (cb.m - ca.m));
  };
  const monthName = d => { const c = orgTime.parseCivil(String(d).slice(0, 10)); return c ? orgTime.formatCivil(`${c.y}-${String(c.m).padStart(2, "0")}-01`).replace(/ \d+,?/, "").split(" ")[0] : ""; };
  const list = rows.map(r => {
    const lastGift = r.last_gift ? String(r.last_gift).slice(0, 10) : null;
    const stopped = lastGift ? lastGift < stopCutoff : false;
    const months = r.first_gift && lastGift ? monthsBetween(r.first_gift, lastGift) : null;
    const amtStr = r.amount != null ? "$" + Number(r.amount).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "their monthly gift";
    // Their own story — never "lapsed" (they didn't choose to leave; their
    // card expired). "Gave $25 a month for 26 months. Nothing since June."
    const reason = stopped
      ? `Gave ${amtStr} a month${months ? ` for ${months} months` : ""}. Nothing since ${lastGift ? monthName(lastGift) : "their last gift"}.`
      : `Giving ${amtStr} a month${months ? ` for ${months} months` : ""} — reconnect before their card would renew.`;
    return {
      donorId: r.id, donorName: r.name, email: r.email || null,
      amount: r.amount != null ? Math.round(r.amount * 100) / 100 : null,
      lastGift, stopped, reason,
      sentAt: r.sent_at || null, reconnectedAt: r.reconnected_at || null,
    };
  });
  const [active] = await query(
    `SELECT COUNT(*)::int n FROM recurring_subscriptions WHERE org_id=? AND status IN ('active','recovered')`, [orgId]);
  const [stats] = await query(
    `SELECT COUNT(*)::int sent,
            COUNT(*) FILTER (WHERE reconnected_at IS NOT NULL)::int reconnected,
            COALESCE(SUM(reconnected_amount) FILTER (WHERE reconnected_at IS NOT NULL),0)::float monthly_back
       FROM reconnect_sends WHERE org_id=?`, [orgId]);
  const facts = await sustainerFileFacts(orgId);
  res.json({
    counts: {
      activeLinked: active.n,
      stopped: facts.stopped,          // BUILD-83 Part 5.1 — the ONE definition
      unlinked: list.filter(u => !u.reconnectedAt).length,
      fromFile: facts.fromFile,
      givingFromFile: facts.giving,
      stoppedFromFile: facts.stopped,
      connectedFromFile: facts.connected,
    },
    stats: { sent: stats.sent, reconnected: stats.reconnected, monthlyBack: Math.round(stats.monthly_back * 100) / 100 },
    // BUILD-96 Part 4 — WHO RETRIES THE CARD. An org taking its monthly gifts
    // through a provider that runs its own dunning must not ALSO be offered
    // Steward's reconnect link: two emails four days apart about the same
    // card, from two systems, is worse than either alone. The screen turns the
    // engine off and says whose job it is.
    dunning: await dunningOwner(orgId),
    list,
  });
}));

// The one place that answers "does Steward retry this org's cards, or does
// somebody else?" Read by the Recurring screen and by the send route, so the
// sentence on screen and the refusal behind the button cannot disagree.
async function dunningOwner(orgId) {
  const { PROVIDERS } = await import("../shared/givingSources.js");
  const rows = await query(
    "SELECT provider FROM giving_sources WHERE org_id=? AND status <> 'disconnected'", [orgId]);
  for (const r of rows) {
    const p = PROVIDERS[r.provider];
    if (p && p.dunning === "provider") {
      return { engine: "provider", provider: p.key, providerLabel: p.label, sentence: p.dunningSentence };
    }
  }
  return { engine: "steward", provider: null, providerLabel: null, sentence: null };
}

app.post("/recurring/unlinked/send-reconnect", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const ids = Array.isArray(req.body.donorIds) ? req.body.donorIds.slice(0, 500) : [];
  if (!ids.length) return res.status(400).json({ error: "donorIds required" });

  // THE ENGINE IS OFF, NOT JUST HIDDEN. A button removed from a screen is a
  // button somebody reaches with a saved link, an old tab or a script. For an
  // org whose provider runs its own dunning, this refuses — which is what
  // makes "zero reconnect emails" a property of the product rather than of the
  // current markup.
  const own = await dunningOwner(orgId);
  if (own.engine === "provider") {
    return res.status(409).json({
      error: "dunning_belongs_to_provider",
      provider: own.provider,
      message: own.sentence,
    });
  }
  const [org] = await query("SELECT id, name, org_slug FROM orgs WHERE id=?", [orgId]);
  const donors = await query(
    `SELECT id, name, email, imported_sustainer_amount::float AS amount, imported_sustainer_last_gift AS last_gift
       FROM donors WHERE org_id=? AND deleted_at IS NULL AND imported_sustainer IS TRUE
        AND id = ANY(?) AND email IS NOT NULL AND email <> ''`,
    [orgId, ids]);
  const dfName = await donorFacingOrgName(orgId, org.name).catch(() => org.name);
  let sent = 0;
  for (const d of donors) {
    const freq = "monthly";
    const token = signReconnectToken(d.id, orgId);
    const params = new URLSearchParams({ reconnect: token, frequency: freq });
    if (d.amount != null) params.set("amount", Number(d.amount).toFixed(2));
    const link = `${publicAppUrl()}/give/${org.org_slug}?${params.toString()}`;
    const amtStr = d.amount != null ? "$" + Number(d.amount).toLocaleString("en-US", { maximumFractionDigits: 0 }) + "/month" : "your monthly gift";
    const html = await brandEmailHeaderHtml(orgId)
      + `<p>Hi ${escapeHtml((d.name || "there").split(" ")[0])},</p>
         <p>Thank you for being a faithful monthly supporter of <strong>${escapeHtml(dfName)}</strong>. We've moved to a new giving system, and because card details can't transfer between systems, we need you to reconnect your ${escapeHtml(amtStr)} gift.</p>
         <p>It takes about a minute — your amount is already filled in:</p>
         <p><a href="${link}" style="display:inline-block;background:#c9a84c;color:#0f1a12;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:8px">Reconnect my monthly gift</a></p>
         <p style="color:#8fa896;font-size:13px">If you'd rather not continue your monthly gift, no action is needed — and thank you for everything you've already given.</p>`;
    const from = await donorFromAddress(orgId).catch(() => undefined);
    const ok = await sendDonorLifecycleEmail("reconnect", d.email, `Reconnect your monthly gift to ${dfName}`, html, from);
    if (ok) {
      await run(
        `INSERT INTO reconnect_sends (id, org_id, donor_id, historical_amount, historical_interval, sent_by)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT (org_id, donor_id) DO UPDATE SET sent_at=NOW(), historical_amount=EXCLUDED.historical_amount, sent_by=EXCLUDED.sent_by`,
        ["rcs_" + uuid().slice(0, 8), orgId, d.id, d.amount, "month", actor(req).id]
      );
      sent++;
    }
  }
  res.json({ sent, requested: donors.length });
}));

// ── Staff-direct actions: pause · resume · cancel · fund designation ───────
// Pause/resume/fund are ordinary gated writes. CANCEL is deliberately NOT
// checkWriteAccess-gated (same reasoning as the DELETE convention): a donor
// asking to stop must never be blocked by the org's own billing state, and
// cancel can never take more money.

app.post("/recurring/subs/:subId/pause", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const sub = await staffOwnedSub(req, res);
  if (!sub) return;
  if (!["active", "recovered"].includes(sub.status)) {
    return res.status(409).json({ error: "not_pausable", message: "Only an active subscription can be paused." });
  }
  const org = await staffRecurringOrg(req.user.orgId);
  if (!stripe || !org?.stripe_account_id) return res.status(503).json({ error: "stripe_unavailable" });
  let resumeAt = null;
  if (req.body?.resumeAt) {
    resumeAt = new Date(req.body.resumeAt);
    if (Number.isNaN(resumeAt.getTime()) || resumeAt <= new Date()) {
      return res.status(400).json({ error: "bad_resume_date", message: "Resume date must be in the future." });
    }
  }
  const actorName = await staffActorName(req);
  await withAdvisoryLock(`portal-sub:${sub.id}`, async () => {
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      pause_collection: { behavior: "void", ...(resumeAt ? { resumes_at: Math.floor(resumeAt.getTime() / 1000) } : {}) },
    }, { stripeAccount: org.stripe_account_id });
    await run(
      `UPDATE recurring_subscriptions SET status='paused', paused_at=NOW(), resume_at=?, next_dunning_at=NULL, updated_at=NOW() WHERE id=?`,
      [resumeAt ? resumeAt.toISOString() : null, sub.id]);
    await logRecurringChange(org.id, sub.id, sub.donor_id, "paused",
      { oldAmount: parseFloat(sub.amount) || null, interval: sub.interval, actor: "staff", actorName });
    await noteRecurringAction(org.id, sub.donor_id,
      `Paused their $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift${resumeAt ? ` until ${resumeAt.toISOString().slice(0, 10)}` : ""}`, actorName);
    await sendRecurringDonorEmail(org, { email: sub.donor_email, name: sub.donor_name },
      "Your recurring gift is paused",
      `${displayNameCase(org.name)} has paused your $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift${resumeAt ? `; it will resume automatically on ${resumeAt.toISOString().slice(0, 10)}` : ""}. No charges will occur while it's paused.`);
    res.json({ ok: true, status: "paused", resumeAt: resumeAt ? resumeAt.toISOString() : null });
  });
}));

app.post("/recurring/subs/:subId/resume", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const sub = await staffOwnedSub(req, res);
  if (!sub) return;
  if (sub.status !== "paused") {
    return res.status(409).json({ error: "not_paused", message: "Only a paused subscription can be resumed." });
  }
  const org = await staffRecurringOrg(req.user.orgId);
  if (!stripe || !org?.stripe_account_id) return res.status(503).json({ error: "stripe_unavailable" });
  const actorName = await staffActorName(req);
  await withAdvisoryLock(`portal-sub:${sub.id}`, async () => {
    await stripe.subscriptions.update(sub.stripe_subscription_id, { pause_collection: "" }, { stripeAccount: org.stripe_account_id });
    await run(`UPDATE recurring_subscriptions SET status='active', paused_at=NULL, resume_at=NULL, updated_at=NOW() WHERE id=?`, [sub.id]);
    await logRecurringChange(org.id, sub.id, sub.donor_id, "resumed",
      { newAmount: parseFloat(sub.amount) || null, interval: sub.interval, actor: "staff", actorName });
    await noteRecurringAction(org.id, sub.donor_id,
      `Resumed their $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift`, actorName);
    await sendRecurringDonorEmail(org, { email: sub.donor_email, name: sub.donor_name },
      "Your recurring gift has resumed",
      `${displayNameCase(org.name)} has resumed your $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift. Your next charge will occur on the normal schedule.`);
    res.json({ ok: true, status: "active" });
  });
}));

app.post("/recurring/subs/:subId/cancel", requireAuth, wrap(async (req, res) => {
  const sub = await staffOwnedSub(req, res);
  if (!sub) return;
  if (sub.status === "canceled") return res.status(409).json({ error: "already_canceled" });
  const org = await staffRecurringOrg(req.user.orgId);
  if (!stripe || !org?.stripe_account_id) return res.status(503).json({ error: "stripe_unavailable" });
  const actorName = await staffActorName(req);
  await withAdvisoryLock(`portal-sub:${sub.id}`, async () => {
    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true }, { stripeAccount: org.stripe_account_id });
    await run(
      `UPDATE recurring_subscriptions SET status='canceled', canceled_at=NOW(), next_dunning_at=NULL, updated_at=NOW() WHERE id=?`,
      [sub.id]);
    await run(`UPDATE donors SET stripe_subscription_status='canceled', updated_at=NOW() WHERE id=? AND org_id=?`, [sub.donor_id, org.id]).catch(() => {});
    await logRecurringChange(org.id, sub.id, sub.donor_id, "canceled_voluntary",
      { oldAmount: parseFloat(sub.amount) || null, interval: sub.interval, actor: "staff", actorName });
    await noteRecurringAction(org.id, sub.donor_id,
      `Canceled their $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift at their request`, actorName);
    await sendRecurringDonorEmail(org, { email: sub.donor_email, name: sub.donor_name },
      "Your recurring gift is canceled",
      `${displayNameCase(org.name)} has canceled your $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift. You won't be charged again. Thank you for everything you've given.`);
    res.json({ ok: true, status: "canceled" });
  });
}));

app.put("/recurring/subs/:subId/fund", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const sub = await staffOwnedSub(req, res);
  if (!sub) return;
  if (sub.status === "canceled") return res.status(409).json({ error: "canceled" });
  const orgId = req.user.orgId;
  let fundId = req.body?.fundId || null;
  let fundName = null;
  if (fundId) {
    const f = await query("SELECT id, name FROM fin_funds WHERE id=? AND org_id=?", [fundId, orgId]);
    if (!f.length) return res.status(404).json({ error: "fund_not_found" });
    fundName = f[0].name;
  }
  const org = await staffRecurringOrg(orgId);
  const actorName = await staffActorName(req);
  await run("UPDATE recurring_subscriptions SET fund_id=?, updated_at=NOW() WHERE id=?", [fundId, sub.id]);
  await logRecurringChange(orgId, sub.id, sub.donor_id, "fund_changed",
    { oldAmount: parseFloat(sub.amount) || null, newAmount: parseFloat(sub.amount) || null, interval: sub.interval, actor: "staff", actorName });
  await noteRecurringAction(orgId, sub.donor_id,
    fundId ? `Changed their recurring gift's designation to ${fundName}` : "Cleared their recurring gift's fund designation", actorName);
  await sendRecurringDonorEmail(org, { email: sub.donor_email, name: sub.donor_name },
    "Your recurring gift's designation changed",
    fundId
      ? `Your $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift to ${displayNameCase(org.name)} now supports ${fundName}. Future charges will be designated there.`
      : `Your $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift to ${displayNameCase(org.name)} is no longer designated to a specific fund; it will support the organization's general work.`);
  res.json({ ok: true, fundId, fundName });
}));

// ── Proposals: the invitation path for anything that can move money ────────
app.post("/recurring/proposals", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const { donorId, kind } = req.body || {};
  if (!PROPOSAL_KIND_LABELS[kind]) return res.status(400).json({ error: "bad_kind" });
  const donorRows = await query(
    "SELECT id, name, email FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [donorId, orgId]);
  if (!donorRows.length) return res.status(404).json({ error: "donor_not_found" });
  const donor = donorRows[0];
  if (!donor.email) return res.status(400).json({ error: "donor_has_no_email", message: "This donor has no email on file — a proposal is completed by the donor from an email." });

  let sub = null;
  if (kind !== "create") {
    const subRows = await query(
      "SELECT * FROM recurring_subscriptions WHERE id=? AND org_id=? AND donor_id=?",
      [req.body?.subId, orgId, donorId]);
    if (!subRows.length) return res.status(404).json({ error: "subscription_not_found" });
    sub = subRows[0];
    if (sub.status === "canceled") return res.status(409).json({ error: "canceled" });
  }

  const psRows = await query("SELECT min_recurring_cents FROM portal_settings WHERE org_id=?", [orgId]).catch(() => []);
  const minCents = Number(psRows[0]?.min_recurring_cents) || 500;
  let proposedAmount = null, proposedInterval = null, proposedFundId = null;
  if (kind === "create" || kind === "amount") {
    const cents = Number(req.body?.amountCents);
    if (!Number.isInteger(cents) || cents < minCents || cents > 10000000) {
      return res.status(400).json({ error: "bad_amount", message: `Amount must be at least $${(minCents / 100).toFixed(2)}.` });
    }
    proposedAmount = cents / 100;
  }
  if (kind === "create" || kind === "frequency") {
    proposedInterval = req.body?.interval;
    if (!["month", "year"].includes(proposedInterval)) return res.status(400).json({ error: "bad_interval" });
  }
  if (kind === "create" && req.body?.fundId) {
    const f = await query("SELECT id FROM fin_funds WHERE id=? AND org_id=?", [req.body.fundId, orgId]);
    if (!f.length) return res.status(404).json({ error: "fund_not_found" });
    proposedFundId = req.body.fundId;
  }

  // One pending proposal per (donor, kind, subscription) at a time — a second
  // identical ask supersedes the first (its token dies with it).
  await run(
    `UPDATE recurring_proposals SET status='canceled', updated_at=NOW()
      WHERE org_id=? AND donor_id=? AND kind=? AND COALESCE(subscription_id,'')=COALESCE(?,'') AND status='pending'`,
    [orgId, donorId, kind, sub?.id || null]).catch(() => {});

  const { token, hash } = mintProposalToken();
  const id = "rprop_" + uuid().slice(0, 8);
  const actorName = await staffActorName(req);
  const expiresAt = new Date(Date.now() + PROPOSAL_EXPIRY_DAYS * 86400000);
  await run(
    `INSERT INTO recurring_proposals (id, org_id, donor_id, subscription_id, kind, proposed_amount, proposed_interval, proposed_fund_id, token_hash, created_by, created_by_name, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, orgId, donorId, sub?.id || null, kind, proposedAmount, proposedInterval, proposedFundId, hash, req.user.userId, actorName, expiresAt.toISOString()]);

  const org = await staffRecurringOrg(orgId);
  const orgName = displayNameCase(org.name);
  const url = `${publicAppUrl()}/recurring/proposal?token=${token}`;
  const detail =
    kind === "create" ? `a ${proposedInterval === "year" ? "yearly" : "monthly"} gift of $${proposedAmount.toLocaleString()}`
      : kind === "amount" ? `changing your recurring gift to $${proposedAmount.toLocaleString()}/${sub.interval || "month"}`
      : kind === "frequency" ? `changing your recurring gift to repeat ${proposedInterval === "year" ? "yearly" : "monthly"}`
      : "updating the card on your recurring gift";
  // W-5: sendRecurringDonorEmail appends "— <org>" to every subject; naming
  // the org here too doubled it ("A request from X — X").
  const proposalDelivered = await sendRecurringDonorEmail(org, donor, "A request about your recurring gift",
    `${actorName} at ${orgName} has proposed ${detail}. Nothing changes unless you complete it — the link below expires in ${PROPOSAL_EXPIRY_DAYS} days.`,
    { actionUrl: url, actionLabel: "Review and complete" });
  // W-4 log honesty: the timeline note claims a send only when one happened.
  await noteRecurringAction(orgId, donorId,
    proposalDelivered
      ? `Sent a recurring-gift proposal (${PROPOSAL_KIND_LABELS[kind]})`
      : `Created a recurring-gift proposal (${PROPOSAL_KIND_LABELS[kind]}) — email delivery FAILED; resend it from the roster`,
    actorName);
  res.status(201).json({
    id, donorId, kind, subscriptionId: sub?.id || null,
    proposedAmount, proposedInterval, proposedFundId,
    status: "pending", expiresAt: expiresAt.toISOString(), resendCount: 0,
  });
}));

app.post("/recurring/proposals/:id/resend", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  await expireStaleProposals(orgId);
  const rows = await query(
    `SELECT p.*, d.name AS donor_name, d.email AS donor_email
       FROM recurring_proposals p JOIN donors d ON d.id=p.donor_id AND d.org_id=p.org_id
      WHERE p.id=? AND p.org_id=?`, [req.params.id, orgId]);
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  const p = rows[0];
  if (p.status !== "pending") return res.status(409).json({ error: "not_pending" });
  if (p.resend_count >= 1) return res.status(409).json({ error: "already_resent", message: "A proposal can be resent once. Create a fresh proposal instead." });
  const { token, hash } = mintProposalToken();
  const expiresAt = new Date(Date.now() + PROPOSAL_EXPIRY_DAYS * 86400000);
  await run(
    `UPDATE recurring_proposals SET token_hash=?, resend_count=1, resent_at=NOW(), expires_at=?, updated_at=NOW() WHERE id=?`,
    [hash, expiresAt.toISOString(), p.id]);
  const org = await staffRecurringOrg(orgId);
  const url = `${publicAppUrl()}/recurring/proposal?token=${token}`;
  await sendRecurringDonorEmail(org, { email: p.donor_email, name: p.donor_name },
    `A reminder from ${displayNameCase(org.name)}`,
    `A reminder about the proposed change to your recurring giving (${PROPOSAL_KIND_LABELS[p.kind]}). Nothing changes unless you complete it — the link below expires in ${PROPOSAL_EXPIRY_DAYS} days.`,
    { actionUrl: url, actionLabel: "Review and complete" });
  res.json({ ok: true, resendCount: 1, expiresAt: expiresAt.toISOString() });
}));

// ── The donor-facing completion pages (public, tokenized, org-branded) ─────
function proposalPageHtml({ orgName, title, bodyHtml, button = null, formAction = null, token = null }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtmlWf(title)} — ${escHtmlWf(orgName)}</title></head>
<body style="margin:0;background:#f0ede6;font-family:Georgia,'Times New Roman',serif;color:#0f1a12;">
  <div style="max-width:520px;margin:48px auto;padding:0 20px;">
    <div style="background:#ffffff;border:1px solid #dce7df;border-radius:14px;padding:36px 32px;">
      <p style="margin:0 0 4px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#6b8f7a;">${escHtmlWf(orgName)}</p>
      <h1 style="margin:0 0 18px;font-size:26px;font-weight:400;">${escHtmlWf(title)}</h1>
      ${bodyHtml}
      ${button && formAction ? `
      <form method="POST" action="${formAction}" style="margin:26px 0 0;">
        <input type="hidden" name="token" value="${escHtmlWf(token)}">
        <button type="submit" style="background:#c9a84c;color:#0f1a12;border:none;border-radius:10px;padding:13px 26px;font-size:15px;font-weight:bold;cursor:pointer;font-family:inherit;">${escHtmlWf(button)}</button>
      </form>` : ""}
      <p style="margin:26px 0 0;font-size:13px;color:#555;">Questions? Reply to the email that brought you here and ${escHtmlWf(orgName)} will help.</p>
    </div>
  </div>
</body></html>`;
}

async function loadLiveProposal(token) {
  if (!token || typeof token !== "string" || token.length > 200) return null;
  await expireStaleProposals(null);
  const rows = await query(
    `SELECT p.*, d.name AS donor_name, d.email AS donor_email,
            o.name AS org_name, o.org_slug, o.stripe_account_id,
            f.name AS fund_name
       FROM recurring_proposals p
       JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
       JOIN orgs o ON o.id = p.org_id
       LEFT JOIN fin_funds f ON f.id = p.proposed_fund_id AND f.org_id = p.org_id
      WHERE p.token_hash = ? AND p.status = 'pending'`,
    [hashProposalToken(token)]);
  return rows[0] || null;
}

app.get("/recurring/proposal", donateLimiter, wrap(async (req, res) => {
  res.set("Content-Type", "text/html");
  const p = await loadLiveProposal(req.query.token);
  if (!p) {
    return res.status(400).send(proposalPageHtml({
      orgName: "Recurring giving", title: "This link is no longer active",
      bodyHtml: `<p>The proposal it pointed to has expired or was already completed. If you still want to make the change, ask the organization to send a fresh one.</p>`,
    }));
  }
  const orgName = displayNameCase(p.org_name);
  const firstName = String(p.donor_name || "").split(" ")[0] || "there";
  let sub = null;
  if (p.subscription_id) {
    const subRows = await query("SELECT amount, interval FROM recurring_subscriptions WHERE id=?", [p.subscription_id]);
    sub = subRows[0] || null;
  }
  const cur = sub ? `$${Number(sub.amount).toLocaleString()}/${sub.interval || "month"}` : null;
  let bodyHtml, button;
  if (p.kind === "create") {
    bodyHtml = `<p>Hi ${escHtmlWf(firstName)} — ${escHtmlWf(orgName)} has invited you to start a recurring gift of
      <strong>$${Number(p.proposed_amount).toLocaleString()}/${p.proposed_interval === "year" ? "year" : "month"}</strong>${p.fund_name ? `, supporting <strong>${escHtmlWf(p.fund_name)}</strong>` : ""}.</p>
      <p style="font-size:14px;color:#555;">You'll enter payment details securely on Stripe — ${escHtmlWf(orgName)} never sees your card.</p>`;
    button = "Continue to Stripe";
  } else if (p.kind === "amount") {
    bodyHtml = `<p>Hi ${escHtmlWf(firstName)} — ${escHtmlWf(orgName)} has proposed changing your recurring gift
      from <strong>${escHtmlWf(cur || "its current amount")}</strong> to <strong>$${Number(p.proposed_amount).toLocaleString()}/${sub?.interval || "month"}</strong>.</p>
      <p style="font-size:14px;color:#555;">Nothing changes unless you confirm. The new amount takes effect on your next scheduled charge.</p>`;
    button = "Confirm the new amount";
  } else if (p.kind === "frequency") {
    bodyHtml = `<p>Hi ${escHtmlWf(firstName)} — ${escHtmlWf(orgName)} has proposed changing your recurring gift
      from <strong>${escHtmlWf(cur || "its current schedule")}</strong> to repeat <strong>${p.proposed_interval === "year" ? "yearly" : "monthly"}</strong>.</p>
      <p style="font-size:14px;color:#555;">Nothing changes unless you confirm.</p>`;
    button = "Confirm the new schedule";
  } else {
    bodyHtml = `<p>Hi ${escHtmlWf(firstName)} — ${escHtmlWf(orgName)} has asked you to update the card on your
      <strong>${escHtmlWf(cur || "recurring")}</strong> gift.</p>
      <p style="font-size:14px;color:#555;">You'll update it securely on Stripe — ${escHtmlWf(orgName)} never sees your card.</p>`;
    button = "Update my card on Stripe";
  }
  res.send(proposalPageHtml({
    orgName, title: PROPOSAL_KIND_LABELS[p.kind].replace(/^./, c => c.toUpperCase()),
    bodyHtml, button, formAction: "/recurring/proposal/confirm", token: req.query.token,
  }));
}));

app.post("/recurring/proposal/confirm", donateLimiter, express.urlencoded({ extended: false }), wrap(async (req, res) => {
  res.set("Content-Type", "text/html");
  const token = req.body?.token || req.query.token;
  const p = await loadLiveProposal(token);
  if (!p) {
    return res.status(400).send(proposalPageHtml({
      orgName: "Recurring giving", title: "This link is no longer active",
      bodyHtml: `<p>The proposal it pointed to has expired or was already completed. If you still want to make the change, ask the organization to send a fresh one.</p>`,
    }));
  }
  const orgName = displayNameCase(p.org_name);
  if (!stripe || !p.stripe_account_id) {
    return res.status(503).send(proposalPageHtml({ orgName, title: "Payments unavailable", bodyHtml: "<p>Payments aren't configured for this organization yet. Please try again later.</p>" }));
  }

  if (p.kind === "create") {
    // The donor completes on Stripe Checkout; our own metadata carries the
    // proposal id so checkout.session.completed marks it completed and the
    // fund designation stamps the subscription row (BUILD-56 chain).
    const cents = toCents(p.proposed_amount);              // BUILD-73: the money seam
    const metadata = {
      donor_email: p.donor_email, org_id: p.org_id, proposal_id: p.id,
      frequency: p.proposed_interval === "year" ? "annual" : "monthly",
      ...(p.proposed_fund_id ? { fund_id: p.proposed_fund_id } : {}),
    };
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: p.donor_email,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: `${orgName} recurring gift` },
          unit_amount: cents,
          recurring: { interval: p.proposed_interval === "year" ? "year" : "month" },
        },
        quantity: 1,
      }],
      metadata,
      subscription_data: { metadata },
      success_url: `${publicAppUrl()}/give/${p.org_slug}?donated=true`,
      cancel_url: `${publicAppUrl()}/give/${p.org_slug}`,
    }, { stripeAccount: p.stripe_account_id });
    return res.redirect(303, session.url);
  }

  if (p.kind === "card_update") {
    const subRows = await query("SELECT * FROM recurring_subscriptions WHERE id=? AND org_id=?", [p.subscription_id, p.org_id]);
    const rs = subRows[0];
    if (!rs) return res.status(404).send(proposalPageHtml({ orgName, title: "Subscription not found", bodyHtml: "<p>This subscription no longer exists.</p>" }));
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      payment_method_types: ["card"],
      ...(rs.stripe_customer_id ? { customer: rs.stripe_customer_id } : {}),
      setup_intent_data: { metadata: { subscription_id: rs.stripe_subscription_id, org_id: p.org_id, proposal_id: p.id } },
      success_url: `${publicAppUrl()}/give/${p.org_slug}?card_updated=true`,
      cancel_url: `${publicAppUrl()}/give/${p.org_slug}`,
    }, { stripeAccount: p.stripe_account_id });
    return res.redirect(303, session.url);
  }

  // amount / frequency — Stripe-FIRST reprice (the mutation fails if Stripe
  // does; we never claim a schedule changed while Stripe keeps charging the
  // old one), serialized per sub like every other subscription mutation.
  const subRows = await query("SELECT * FROM recurring_subscriptions WHERE id=? AND org_id=?", [p.subscription_id, p.org_id]);
  const rs = subRows[0];
  if (!rs || !["active", "recovered", "paused", "past_due", "recovering"].includes(rs.status)) {
    return res.status(409).send(proposalPageHtml({ orgName, title: "This gift can't be changed right now", bodyHtml: "<p>The subscription is no longer in a state that can be changed. Ask the organization for help.</p>" }));
  }
  const newInterval = p.kind === "frequency" ? p.proposed_interval : (rs.interval === "year" ? "year" : "month");
  const newCents = p.kind === "amount" ? toCents(p.proposed_amount) : (toCents(rs.amount) || 0);   // BUILD-73: the money seam
  await withAdvisoryLock(`portal-sub:${rs.id}`, async () => {
    const stripeSub = await stripe.subscriptions.retrieve(rs.stripe_subscription_id, {}, { stripeAccount: p.stripe_account_id });
    const item = stripeSub.items?.data?.[0];
    if (!item) throw new Error("subscription has no items");
    // BUILD-57 §2a (real-Stripe finding): subscription updates take price_data
    // with an existing PRODUCT id — product_data is Checkout-only sugar and
    // real Stripe rejects it (the mock accepted anything). The item's own
    // price already carries the product.
    const productId = await ensureRecurringGiftProduct(p.stripe_account_id, orgName);
    await stripe.subscriptions.update(rs.stripe_subscription_id, {
      items: [{ id: item.id, price_data: {
        currency: item.price?.currency || "usd",
        product: productId,
        recurring: { interval: newInterval },
        unit_amount: newCents,
      } }],
      proration_behavior: "none",
    }, { stripeAccount: p.stripe_account_id });
    const oldAmt = parseFloat(rs.amount) || 0;
    const newAmt = newCents / 100;
    await run("UPDATE recurring_subscriptions SET amount=?, interval=?, updated_at=NOW() WHERE id=?", [newAmt, newInterval, rs.id]);
    await run(`UPDATE recurring_proposals SET status='completed', completed_at=NOW(), updated_at=NOW() WHERE id=?`, [p.id]);
    if (p.kind === "amount" && Math.abs(newAmt - oldAmt) >= 0.005) {
      await logRecurringChange(p.org_id, rs.id, rs.donor_id, newAmt > oldAmt ? "amount_up" : "amount_down",
        { oldAmount: oldAmt, newAmount: newAmt, interval: newInterval, actor: "donor" });
    }
    await noteRecurringAction(p.org_id, rs.donor_id,
      p.kind === "amount"
        ? `Completed the proposed change: recurring gift is now $${newAmt.toLocaleString()}/${newInterval} (was $${oldAmt.toLocaleString()})`
        : `Completed the proposed change: recurring gift now repeats ${newInterval === "year" ? "yearly" : "monthly"}`,
      p.donor_name || "Donor");
    await sendRecurringDonorEmail({ id: p.org_id, name: p.org_name, org_slug: p.org_slug }, { email: p.donor_email, name: p.donor_name },
      "Your recurring gift changed",
      p.kind === "amount"
        ? `Your recurring gift to ${orgName} is now $${newAmt.toLocaleString()}/${newInterval} (was $${oldAmt.toLocaleString()}). The new amount takes effect on your next scheduled charge.`
        : `Your recurring gift to ${orgName} now repeats ${newInterval === "year" ? "yearly" : "monthly"}.`);
    res.send(proposalPageHtml({
      orgName, title: "Done — thank you",
      bodyHtml: p.kind === "amount"
        ? `<p>Your recurring gift is now <strong>$${newAmt.toLocaleString()}/${newInterval}</strong>. The new amount takes effect on your next scheduled charge.</p>`
        : `<p>Your recurring gift now repeats <strong>${newInterval === "year" ? "yearly" : "monthly"}</strong>.</p>`,
    }));
  });
}));

app.get("/recurring/health", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  // BUILD-54 §1 — four independent reads, one parallel batch.
  const [summaryRows, recoveryRateOut, recMonthRows, lostMonthRows] = await Promise.all([
    query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('active','recovering'))::int AS active_count,
         COUNT(*) FILTER (WHERE status IN ('past_due','recovering'))::int AS at_risk_count,
         COALESCE(SUM(amount) FILTER (WHERE status IN ('past_due','recovering')), 0) AS mrr_at_risk
       FROM recurring_subscriptions WHERE org_id=?`,
      [orgId]),
    computeRecoveryRate(orgId),
    query(
      "SELECT COUNT(DISTINCT subscription_id)::int AS c FROM payment_recovery_events WHERE org_id=? AND type='payment_recovered' AND created_at >= ?",
      [orgId, monthStart.toISOString()]),
    query(
      "SELECT COUNT(DISTINCT subscription_id)::int AS c FROM payment_recovery_events WHERE org_id=? AND type='subscription_canceled' AND created_at >= ?",
      [orgId, monthStart.toISOString()]),
  ]);
  const s = summaryRows[0] || {};
  const recoveryRate = recoveryRateOut.rate;
  const recoveredThisMonth = recMonthRows[0]?.c || 0;
  const lostThisMonth = lostMonthRows[0]?.c || 0;

  // ── BUILD-83 Part 5.1 — THREE FACTS, NOT THREE BUCKETS. The tab read
  // "0 giving · 160 whose giving stopped · 600 not yet connected" for a file
  // whose own Recurring sheet says 440 are giving and Steward detected every
  // one of them. Giving and connected-to-a-payment-method-here are SEPARATE
  // axes: `fromFile` is what the org's own records say; `connected` is what
  // Stripe knows. Neither may stand in for the other.
  const facts = await sustainerFileFacts(orgId);

  // (2026-09-11) MONEY THAT HAS NOT FAILED YET IS STILL AT RISK, and it is the
  // half a staff member can still do something cheap about. `atRisk` counts
  // cards that already broke; `expiring` counts cards that are going to, this
  // month or next. They are deliberately separate numbers: collapsing them
  // would hide the one that is still preventable.
  const expRows = await query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS mrr
       FROM recurring_subscriptions
      WHERE org_id = ? AND status IN ('active','past_due','recovering')
        AND card_exp_year IS NOT NULL AND card_exp_month IS NOT NULL
        AND make_date(card_exp_year, card_exp_month, 1)
            BETWEEN date_trunc('month', CURRENT_DATE)::date
                AND (date_trunc('month', CURRENT_DATE) + interval '1 month')::date`, [orgId]);

  res.json({
    activeCount: s.active_count || 0,
    atRiskCount: s.at_risk_count || 0,
    mrrAtRisk: parseFloat(s.mrr_at_risk) || 0,
    // cards expiring this month or next — preventable, not yet lost
    expiringCount: expRows[0]?.n || 0,
    mrrExpiring: parseFloat(expRows[0]?.mrr) || 0,
    recoveredThisMonth,
    lostThisMonth,
    recoveryRate,
    // the org's OWN file — three facts on one line, ONE definition
    fromFile: facts.fromFile,
    givingFromFile: facts.giving,
    stoppedFromFile: facts.stopped,
    connectedFromFile: facts.connected,
    // Part 5.4 — rows with no email are excluded from a reconnect send and said
    // so on screen, never silently dropped from the count.
    stoppedWithoutEmail: facts.stoppedWithoutEmail,
    // ── BUILD-86 — NAMES, not just a count ───────────────────────────────
    // Home's rule is that no row is a number without a name attached, and
    // "3 monthly gifts are failing" was exactly that. These are the same
    // subscriptions atRiskCount already counts, with the donor on them and a
    // cap, so Home can render a person to call instead of a figure to worry
    // about. Not a new metric: a count that finally says who.
    atRisk: await query(
      `SELECT rs.id, rs.donor_id, d.name AS donor_name, d.kind, rs.amount, rs.interval,
              rs.status, rs.first_failed_at
         FROM recurring_subscriptions rs
         JOIN donors d ON d.id = rs.donor_id AND d.org_id = rs.org_id
        WHERE rs.org_id = ? AND d.deleted_at IS NULL
          AND rs.status IN ('past_due','recovering')
        ORDER BY rs.first_failed_at ASC NULLS LAST, rs.amount DESC
        LIMIT 6`, [orgId]),
  });
}));

// Everyday staff action from the home-screen queue — re-sends the CURRENT
// dunning step's email on demand. Not gated by requireAdmin (matches
// POST /note-reminders/:id/send, the other "queue nudge" action any staff
// member can trigger) and doesn't touch dunning_step/next_dunning_at, so it
// never interferes with the automatic cadence.
app.post("/recurring/:donorId/resend", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const donorRows = await query("SELECT id, name, email FROM donors WHERE id=? AND org_id=?", [req.params.donorId, orgId]);
  if (!donorRows.length) return res.status(404).json({ error: "Donor not found" });
  const donor = donorRows[0];
  if (!donor.email) return res.status(400).json({ error: "This donor has no email on file." });

  const rsRows = await query(
    "SELECT * FROM recurring_subscriptions WHERE org_id=? AND donor_id=? AND status IN ('past_due','recovering') ORDER BY last_failed_at DESC LIMIT 1",
    [orgId, donor.id]
  );
  if (!rsRows.length) return res.status(400).json({ error: "This donor has no recurring gift currently at risk." });
  const rs = rsRows[0];

  const orgRows = await query(
    "SELECT id, name, recurring_dunning_subject, recurring_dunning_body FROM orgs WHERE id=?", [orgId]
  );
  // W-4: dunning is transactional — the marketing suppression list no longer
  // blocks a staff resend. dunning_sent is logged ONLY on real delivery.
  const result = await sendDunningEmail(orgRows[0], donor, rs);
  if (result.refused) return res.status(400).json({ error: `Cannot send — ${result.refused === "deceased" ? "this donor is marked deceased" : result.refused}.` });
  if (!result.sent) return res.status(502).json({ sent: false, error: "The email provider rejected the send — nothing was recorded as sent. Try again shortly." });
  await logRecoveryEvent(orgId, donor.id, rs.stripe_subscription_id, "dunning_sent", null, { manual: true });
  res.json({ sent: true });
}));

// ══════════════════════════════════════════════════════════════════════════
// BUILD-45 — DONOR PORTAL (public, money-moving, PII-bearing; §2–§6)
//
// Tenancy is path-based: /portal/:orgSlug (production reaches these routes
// same-origin through the vercel.json /portal-api proxy, so the SameSite=Lax
// HttpOnly session cookie flows; custom CNAME domains are a deferred-
// domains.md). Donors never get passwords — magic link only (P-1). Portal
// sessions are a separate cookie + separate table from staff JWTs (P-4):
// requirePortalSession reads ONLY the cookie (never Authorization), and every
// staff route reads ONLY Authorization (never a cookie), so neither credential
// can cross. Every session-create, link-request, and mutation writes a
// portal_audit_log row (P-7). No donor-facing route ever logs email/token to
// console (S-7).
// ══════════════════════════════════════════════════════════════════════════

const PORTAL_COOKIE = "steward_portal";
const sha256hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

function parsePortalCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setPortalCookie(res, token, maxAgeSec) {
  // HttpOnly + Secure + SameSite=Lax, 30-day max-age (P-4). Path=/ because in
  // production the browser-visible path is /portal-api/* (the proxy prefix).
  // Secure is unconditional: browsers treat the loopback origin as trustworthy,
  // so local dev still works, and production can never downgrade.
  res.append("Set-Cookie",
    [`${PORTAL_COOKIE}=${encodeURIComponent(token)}`, "HttpOnly", "Secure", "SameSite=Lax", "Path=/",
     `Max-Age=${maxAgeSec}`].join("; "));
}

// One org lookup for every portal route: slug → org row + portal settings.
// Returns null for unknown slug OR a disabled portal (indistinguishable).
async function portalOrgBySlug(slug) {
  if (!slug || typeof slug !== "string" || slug.length > 120) return null;
  const rows = await query(
    `SELECT o.*, ps.enabled AS portal_enabled, ps.display_name AS portal_display_name,
            COALESCE(ps.logo_url, ps.logo_data) AS portal_logo, COALESCE(ps.header_image_url, ps.header_image_data) AS portal_header_image,
            ps.primary_color, ps.accent_color, ps.footer_text AS portal_footer,
            ps.contact_email AS portal_contact, ps.ein_line AS portal_ein,
            ps.powered_by, ps.min_recurring_cents, ps.network_listed,
            ps.background_tint, ps.button_color, ps.type_pairing, ps.card_style,
            ps.header_focal_x, ps.header_focal_y, ps.header_crop
     FROM orgs o JOIN portal_settings ps ON ps.org_id = o.id
     WHERE o.org_slug = ? AND ps.enabled = true`, [slug]);
  return rows[0] || null;
}

function portalThemePayload(org) {
  const clean = (v, cap) => (typeof v === "string" ? v.slice(0, cap) : null);
  return {
    orgSlug: org.org_slug,
    displayName: clean(org.portal_display_name, 120) || displayNameCase(org.name),
    logo: org.portal_logo || org.logo_data || null,
    headerImage: org.portal_header_image || null,
    // BUILD-59 — normalized focal point (0..1, center default) honored by the
    // banner render via object-position. Clamped defensively.
    headerFocal: {
      x: Math.min(1, Math.max(0, Number(org.header_focal_x ?? 0.5) || 0.5)),
      y: Math.min(1, Math.max(0, Number(org.header_focal_y ?? 0.5) || 0.5)),
    },
    // BUILD-61 — non-destructive crop rect (or null → focal fallback).
    headerCrop: parseCrop(org.header_crop),
    ...portalCardTheme(org),
    footerText: clean(org.portal_footer, 500),
    contactEmail: clean(org.portal_contact, 200),
    einLine: clean(org.portal_ein, 200),
    poweredBy: org.powered_by === true,
    minRecurringCents: Number(org.min_recurring_cents) || 500,
    giveSlug: org.stripe_account_id ? org.org_slug : null, // R-6: reuse the existing public giving page
  };
}

async function portalAudit(orgId, donorId, email, action, req, meta) {
  await run(
    `INSERT INTO portal_audit_log (id,org_id,donor_id,email,action,ip,meta) VALUES (?,?,?,?,?,?,?)`,
    ["pal_" + uuid().slice(0, 12), orgId, donorId || null, email || null, action,
     (req && req.ip) || null, meta ? JSON.stringify(meta) : null]
  ).catch(e => console.error("[portal] audit write failed:", e.message));
}

// The donor records a portal session may see: exact-email matches in THAT org
// only (P-6). Multiple records for one email all belong to the session.
async function portalDonorsFor(orgId, email) {
  return query(
    `SELECT * FROM donors WHERE org_id = ? AND LOWER(email) = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
    [orgId, String(email).toLowerCase()]);
}

// ── Session middleware (P-4) ───────────────────────────────────────────────
// Cookie-only. A staff JWT in Authorization is IGNORED here, exactly as the
// portal cookie is ignored by requireAuth — proven by the differential sweep.
function requirePortalSession(req, res, next) {
  (async () => {
    const raw = parsePortalCookies(req)[PORTAL_COOKIE];
    if (!raw || raw.length > 300) return res.status(401).json({ error: "portal_auth" });
    const rows = await query(
      `SELECT * FROM portal_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()`,
      [sha256hex(raw)]);
    if (!rows.length) return res.status(401).json({ error: "portal_auth" });
    const sess = rows[0];
    const org = await portalOrgBySlug(req.params.orgSlug);
    if (!org) return res.status(401).json({ error: "portal_auth" });
    if (sess.org_id) {
      // Tenant pinning: an org-scoped session is scoped to ONE org — a valid
      // session used against another org's slug is a 401, never a data leak (S-2).
      if (org.id !== sess.org_id) return res.status(401).json({ error: "portal_auth" });
      req.portal = { session: sess, org, email: sess.email };
    } else if (sess.donor_account_id && DONOR_ACCOUNTS_ENABLED) {
      // BUILD-46: an account-wide session (org_id NULL) opens an org's portal
      // ONLY when (a) the account holds an ACTIVE link to that org and (b) the
      // org is network-listed (an opted-out org keeps its standalone portal —
      // reachable by magic link — but is invisible to dashboard sessions).
      // The link's via_email drives the same donor resolution the org-scoped
      // path uses, so the org portal behaves identically either way.
      const links = await query(
        `SELECT via_email FROM donor_account_links
         WHERE account_id = ? AND org_id = ? AND unlinked_at IS NULL LIMIT 1`,
        [sess.donor_account_id, org.id]);
      if (!links.length || org.network_listed !== true) return res.status(401).json({ error: "portal_auth" });
      req.portal = { session: sess, org, email: links[0].via_email, accountId: sess.donor_account_id };
    } else {
      return res.status(401).json({ error: "portal_auth" });
    }
    run(`UPDATE portal_sessions SET last_seen_at = NOW() WHERE id = ?`, [sess.id]).catch(() => {});
    next();
  })().catch(next);
}

// ── Magic-link email ───────────────────────────────────────────────────────
async function sendPortalMagicLinkEmail(org, email, token) {
  const theme = portalThemePayload(org);
  const link = `${publicAppUrl()}/portal/${org.org_slug}/verify#token=${token}`; // fragment: never sent in Referer (S-4)
  const orgName = escHtmlWf(theme.displayName);
  const html = await brandEmailHeaderHtml(org.id) + `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;padding:24px;color:#0f1a12;">
      <p>Here is your secure sign-in link for your giving history with ${orgName}:</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${link}" style="background:${theme.primary};color:${theme.primaryFg};text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">View my giving</a>
      </p>
      <p style="font-size:13px;color:#555;">This link works once and expires in 15 minutes. If you didn't request it, you can safely ignore this email.</p>
      ${theme.contactEmail ? `<p style="font-size:13px;color:#555;">Questions? Write to <a href="mailto:${escHtmlWf(theme.contactEmail)}">${escHtmlWf(theme.contactEmail)}</a>.</p>` : ""}
    </div>`;
  // BUILD-46 §1.1: magic-link sends ride the queued, failure-visible path
  // (retried on the tick, surfaced on /health) — no more console-only failure.
  // The stored html is final-rendered, so a retry resends it verbatim; a link
  // that expires before a retry lands is harmless (the donor re-requests).
  await sendDonorLifecycleEmail("magic_link", email, `Your sign-in link — ${theme.displayName}`, html, fromWithDisplayName(theme.displayName, DONOR_MAIL_ADDR())); // BUILD-64: org name in the inbox
}

// Donor-facing confirmation for every money mutation (R-8). Transactional —
// sent on the ORG's letterhead, no unsubscribe footer, suppression does not
// block it (a donor must always learn their schedule changed).
async function sendPortalMutationEmail(org, email, subject, bodyText) {
  if (!process.env.RESEND_API_KEY) return;
  const theme = portalThemePayload(org);
  const html = await brandEmailHeaderHtml(org.id) + `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:520px;margin:0 auto;padding:24px;color:#0f1a12;">
      <p>${escHtmlWf(bodyText)}</p>
      <p style="font-size:13px;color:#555;">You can review your giving anytime: <a href="${publicAppUrl()}/portal/${org.org_slug}">${escHtmlWf(theme.displayName)} donor portal</a>.</p>
      ${theme.contactEmail ? `<p style="font-size:13px;color:#555;">Questions? Write to <a href="mailto:${escHtmlWf(theme.contactEmail)}">${escHtmlWf(theme.contactEmail)}</a>.</p>` : ""}
    </div>`;
  try {
    // BUILD-88c C.1 — the org's own identity, resolved once.
    const ident = await orgSendingIdentity(org.id);
    const { error: sendErr } = await resend.emails.send({
      from: ident.from,
      ...(ident.replyTo ? { replyTo: ident.replyTo } : {}),
      to: email, subject: `${subject} — ${theme.displayName}`, html,
    });
    if (sendErr) console.error("[portal] mutation email error:", sendErr.message);
  } catch (e) { console.error("[portal] mutation email failed:", e.message); }
}

// ── §6.3 drift wire — cancel/pause → the org hears about it in minutes ─────
async function portalDriftAlert(org, donor, sub, action, detail) {
  try {
    const officers = await query(
      `SELECT id, name, email FROM users WHERE org_id = ? AND id = ?`, [org.id, donor.assigned_to || ""]);
    let officer = officers[0];
    if (!officer) {
      const admins = await query(
        `SELECT id, name, email FROM users WHERE org_id = ? AND role = 'admin' ORDER BY created_at ASC LIMIT 1`, [org.id]);
      officer = admins[0];
    }
    if (!officer) return;
    const verb = action === "recurring_cancel" ? "canceled" : "paused";
    const amt = sub.amount != null ? `$${Number(sub.amount).toLocaleString()}/${sub.interval || "month"}` : "a recurring gift";
    // High-priority task due TODAY, donor-linked — the "needs you today" item.
    // ORG_TZ_SEAM_OK — "today" here MUST be the ORG's civil date, because
    // /dashboard/today filters tasks with orgToday(org). This used to be
    // localDateKey(new Date()) (the PROCESS zone, UTC in prod), so a cancel
    // between UTC midnight and the org's midnight — 20:00–00:00 EDT — stamped
    // the task with TOMORROW's org date and the officer's day view did not
    // show it on the evening it was created. That is precisely the save window
    // this wire exists to open. Guarded under TZ=UTC in tests/date-seam.js §7.
    await run(
      `INSERT INTO tasks (id,org_id,title,due,priority,type,donor_id,assigned_to,assigned_to_name,created_by,created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ["t_" + uuid().slice(0, 8), org.id,
       `${donor.name} ${verb} their ${amt} recurring gift — reach out today`,
       orgToday(await orgTz(org.id)), "high", "donor", donor.id, officer.id, officer.name || "",
       "system:portal-drift", "Donor portal"]);
    const subj = `${donor.name} ${verb} their recurring gift`;
    const body = `<p><strong>${escHtmlWf(donor.name)}</strong> just ${verb} their ${escHtmlWf(amt)} recurring gift from the donor portal${detail ? " — " + escHtmlWf(detail) : ""}.</p>
      <p>A cancellation the org learns about in minutes is a save opportunity. Suggested next step: a personal call or note today — thank them for their giving, ask nothing, and learn what changed.</p>`;
    await notifyUserOnce({
      org, userId: officer.id, email: officer.email,
      eventKey: `portal:${action}:${sub.id}`, channel: "portal_drift",
      prefKind: "notify_portfolio_gifts", subject: subj, bodyHtml: body,
    });
  } catch (e) { console.error("[portal] drift alert:", e.message); }
}

// ── Public: portal config (the login page's theme) ─────────────────────────
app.get("/portal/:orgSlug/config", wrap(async (req, res) => {
  const org = await portalOrgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).json({ error: "portal_not_found" });
  // BUILD-54 §4 — the PUBLISHED page, resolved for public view. Null when the
  // org never published one (client renders the BUILD-45 fixed layout).
  // Public resolution carries ZERO donor data by construction: the mygiving
  // widget resolves to nothing (client shows a sign-in prompt) and the impact
  // widget resolves org-wide updates only.
  const page = await resolvePortalPagePublic(org);
  res.json({ theme: portalThemePayload(org), page });
}));

// ── P-1/P-2/P-3: request a magic link ──────────────────────────────────────
app.post("/portal/:orgSlug/request-link", portalLinkIpLimiter, portalLinkEmailLimiter, wrap(async (req, res) => {
  const org = await portalOrgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).json({ error: "portal_not_found" });
  const email = String(req.body?.email || "").trim().toLowerCase();
  // P-2 — identical response AND timing for known and unknown emails: respond
  // first, do the lookup + send asynchronously.
  res.json({ received: true, message: "If we have this address on file, a sign-in link is on its way." });
  if (!email || email.length > 320 || !email.includes("@")) return;
  (async () => {
    const donors = await portalDonorsFor(org.id, email);
    await portalAudit(org.id, donors[0]?.id || null, email, "link_requested", req, { matched: donors.length > 0 });
    if (!donors.length) return;
    // Re-request invalidates any live prior link (P-1).
    await run(
      `UPDATE portal_magic_links SET superseded_at = NOW()
       WHERE org_id = ? AND email = ? AND used_at IS NULL AND superseded_at IS NULL`, [org.id, email]);
    const token = crypto.randomBytes(32).toString("base64url"); // 256-bit CSPRNG
    await run(
      `INSERT INTO portal_magic_links (id,org_id,email,token_hash,expires_at,requested_ip)
       VALUES (?,?,?,?, NOW() + INTERVAL '15 minutes', ?)`,
      ["pml_" + uuid().slice(0, 10), org.id, email, sha256hex(token), req.ip || null]);
    await sendPortalMagicLinkEmail(org, email, token);
  })().catch(e => console.error("[portal] link request failed:", e.message));
}));

// ── S-4: token is POST-consumed, atomically single-use ─────────────────────
app.post("/portal/:orgSlug/verify", portalLinkIpLimiter, wrap(async (req, res) => {
  const org = await portalOrgBySlug(req.params.orgSlug);
  if (!org) return res.status(404).json({ error: "portal_not_found" });
  const token = String(req.body?.token || "");
  if (!token || token.length > 300) return res.status(400).json({ error: "invalid_link" });
  // Atomic consume: UPDATE … RETURNING wins exactly once even under a
  // parallel replay of the same link.
  const rows = await query(
    `UPDATE portal_magic_links SET used_at = NOW()
     WHERE token_hash = ? AND org_id = ? AND used_at IS NULL AND superseded_at IS NULL AND expires_at > NOW()
     RETURNING email`,
    [sha256hex(token), org.id]);
  if (!rows.length) return res.status(400).json({ error: "invalid_link", message: "That link has expired or was already used. Request a fresh one." });
  const email = rows[0].email;
  const sessToken = crypto.randomBytes(32).toString("base64url");
  const maxAgeSec = 30 * 24 * 3600;
  // BUILD-46: both auth paths mint the same session — a magic-link sign-in by
  // an email that belongs to a verified donor account (primary or verified
  // alias) carries the account id, so the one cookie also opens the dashboard.
  // Flag-gated; with accounts off this is exactly the BUILD-45 session.
  let sessAccountId = null;
  if (DONOR_ACCOUNTS_ENABLED) {
    const acct = await query(
      `SELECT id FROM donor_accounts WHERE email = ? AND email_verified_at IS NOT NULL
       UNION
       SELECT account_id AS id FROM donor_account_aliases WHERE email = ? AND verified_at IS NOT NULL
       LIMIT 1`, [email, email]);
    sessAccountId = acct[0]?.id || null;
  }
  await run(
    `INSERT INTO portal_sessions (id,org_id,email,token_hash,expires_at,ip,donor_account_id)
     VALUES (?,?,?,?, NOW() + INTERVAL '30 days', ?, ?)`,
    ["psn_" + uuid().slice(0, 10), org.id, email, sha256hex(sessToken), req.ip || null, sessAccountId]);
  setPortalCookie(res, sessToken, maxAgeSec);
  const donors = await portalDonorsFor(org.id, email);
  await portalAudit(org.id, donors[0]?.id || null, email, "session_created", req);
  for (const d of donors) await portalTimeline(org.id, d.id, "Portal: donor signed in", "login");
  res.json({ ok: true });
}));

app.post("/portal/:orgSlug/logout", wrap(async (req, res) => {
  const raw = parsePortalCookies(req)[PORTAL_COOKIE];
  if (raw) await run(`UPDATE portal_sessions SET revoked_at = NOW() WHERE token_hash = ?`, [sha256hex(raw)]).catch(() => {});
  res.append("Set-Cookie", `${PORTAL_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
}));

app.get("/portal/:orgSlug/session", requirePortalSession, wrap(async (req, res) => {
  res.json({ email: req.portal.email });
}));

// BUILD-61 Part 4 — the returning-donor default, done SAFELY. This is
// requirePortalSession-authed: identity is already established (the donor is
// signed in to THEIR OWN portal for THIS org) and the arrangement returned is
// their own. The anonymous /give page never calls a donor-varying endpoint, so
// a public give page is byte-identical whether or not the email behind it has
// ever given (pinned in tests/org-blindness.test.js). Returns the donor's
// current recurring arrangement (frequency + intended base amount) or null.
app.get("/portal/:orgSlug/give-default", requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const donors = await portalDonorsFor(org.id, email);
  if (!donors.length) return res.json({ arrangement: null });
  const rows = await query(
    `SELECT amount, cover_fee_amount, interval FROM recurring_subscriptions
     WHERE org_id = ? AND donor_id = ANY(?) AND status IN ('active','recovered','past_due','recovering')
     ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`,
    [org.id, donors.map(d => d.id)]);
  if (!rows.length) return res.json({ arrangement: null });
  const s = rows[0];
  // BUILD-73 Part 2 — was Math.max(1, Math.round(amount - cover_fee_amount)).
  // This figure is shown to the DONOR as what they currently give, and it seeds
  // the change-my-amount form, so rounding it told a $33.33/mo donor they give
  // $33 and would then have changed their subscription to exactly that. Cents
  // are kept; the floor stays $1.00, expressed in cents.
  const baseCentsNow = Math.max(100, (toCents(s.amount) || 0) - (toCents(s.cover_fee_amount) || 0));
  res.json({ arrangement: { frequency: s.interval === "year" ? "annual" : "monthly", amount: toDollars(baseCentsNow) } });
}));

// ── §3 — the dashboard: every figure from the SAME gifts ledger the CRM
//    reports read (org-scoped, live SUMs; no parallel computation) ──────────
app.get("/portal/:orgSlug/me", requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const donors = await portalDonorsFor(org.id, email);
  if (!donors.length) return res.json({ email, theme: portalThemePayload(org), empty: true });
  const donorIds = donors.map(d => d.id);

  // BUILD-54 §1 — impact matching, the account nudge, and the audit write
  // ride the same parallel batch as the data reads (they only need donorIds/
  // email, all known here). This endpoint is the donor's first paint.
  // ORG_TZ_SEAM_OK — the portal's lookback windows are civil dates in the
  // ORG's calendar, not the Postgres session zone.
  const _portalToday = orgToday(await orgTz(org.id));
  const [byYearRows, totalsRow, gifts, receipts, recurring, pledges, household, impact, accountNudge, , campaignSpotlights, thankYouRows] = await Promise.all([
    query(
      `SELECT LEFT(date, 4) AS year, COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count
       FROM gifts WHERE org_id = ? AND donor_id = ANY(?) GROUP BY LEFT(date, 4) ORDER BY year DESC`,
      [org.id, donorIds]),
    query(
      `SELECT COALESCE(SUM(amount),0) AS lifetime, COUNT(*)::int AS count,
              MIN(date) AS first_gift, MAX(amount) AS largest
       FROM gifts WHERE org_id = ? AND donor_id = ANY(?)`,
      [org.id, donorIds]),
    query(
      `SELECT g.id, g.date, g.amount, g.type, COALESCE(c.donor_facing_name, c.name, g.campaign) AS campaign,
              f.name AS fund, g.stripe_payment_id IS NOT NULL AS online,
              g.recurring_subscription_id IS NOT NULL AS recurring,
              r.id AS receipt_id, r.receipt_number
       FROM gifts g
       LEFT JOIN campaigns c ON c.id = g.campaign_id AND c.org_id = g.org_id
       LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
       LEFT JOIN receipts r ON r.gift_id = g.id AND r.org_id = g.org_id AND r.voided_at IS NULL AND r.type = 'gift'
       WHERE g.org_id = ? AND g.donor_id = ANY(?)
       ORDER BY g.date DESC, g.id DESC LIMIT 500`,
      [org.id, donorIds]),
    query(
      `SELECT id, type, receipt_number, amount, tax_year, created_at, gift_id
       FROM receipts WHERE org_id = ? AND donor_id = ANY(?) AND voided_at IS NULL
       ORDER BY created_at DESC LIMIT 100`,
      [org.id, donorIds]),
    query(
      `SELECT id, donor_id, amount, interval, status, failure_count, paused_at, resume_at,
              canceled_at, stripe_subscription_id, created_at
       FROM recurring_subscriptions WHERE org_id = ? AND donor_id = ANY(?) ORDER BY created_at DESC`,
      [org.id, donorIds]),
    query(
      `SELECT p.id, p.amount, p.due_date, p.status, p.notes,
              COALESCE(pp.paid,0) AS paid_amount, GREATEST(p.amount - COALESCE(pp.paid,0), 0) AS balance
       FROM pledges p
       LEFT JOIN (SELECT pledge_id, SUM(amount) AS paid FROM gifts WHERE org_id = ? AND pledge_id IS NOT NULL GROUP BY pledge_id) pp
         ON pp.pledge_id = p.id
       WHERE p.org_id = ? AND p.donor_id = ANY(?) ORDER BY p.due_date ASC`,
      [org.id, org.id, donorIds]),
    (async () => {
      // P-6 — household/soft-credit renders in a SEPARATE labeled section:
      // the family's combined giving, never mixed into the donor's own totals.
      const hhIds = [...new Set(donors.map(d => d.household_id).filter(Boolean))];
      if (!hhIds.length) return null;
      const [hh] = await query(`SELECT id, name FROM households WHERE id = ? AND org_id = ?`, [hhIds[0], org.id]);
      if (!hh) return null;
      const [sum] = await query(
        `SELECT COALESCE(SUM(g.amount),0) AS combined
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
         WHERE g.org_id = ? AND d.household_id = ? AND d.deleted_at IS NULL`,
        [org.id, hh.id]);
      return { name: hh.name, combined: parseFloat(sum.combined) || 0 };
    })(),
    matchImpactUpdates(org.id, donorIds),
    // BUILD-46 §1.3 — the migration nudge, never a wall: a magic-link donor is
    // PROMPTED to create an account/password; ignoring it forever is fine.
    // null when the flag is off (prod default) so BUILD-45 clients see nothing,
    // AND null when the org hasn't opted into donor-dashboard listing
    // (network_listed) — an unlisted org's portal stays entirely its own page,
    // with no mention of a cross-org account. `email` is the donor's own
    // verified session address, returned so the signup link can carry it.
    DONOR_ACCOUNTS_ENABLED && org.network_listed === true ? (async () => {
      const em = foldEmail(email);
      const acct = await query(
        `SELECT id, password_hash FROM donor_accounts WHERE email = ? AND email_verified_at IS NOT NULL
         UNION SELECT a.id, a.password_hash FROM donor_accounts a JOIN donor_account_aliases al ON al.account_id = a.id
         WHERE al.email = ? AND al.verified_at IS NOT NULL LIMIT 1`, [em, em]);
      return { exists: acct.length > 0, hasPassword: !!acct[0]?.password_hash, email };
    })() : Promise.resolve(null),
    portalAudit(org.id, donorIds[0], email, "dashboard_viewed", req),
    // BUILD-54 §2 — campaign spotlights: campaigns THIS donor gave to (same
    // 24-month window + campaign_id-OR-name attribution rule as the impact
    // matcher — extended, not forked) that carry ORG-AUTHORED donor-facing
    // content. A campaign with no content never appears here (never
    // fabricate); goal figures are computed ONLY when the org opted that
    // campaign's thermometer public, and are goal/raised only — never donor
    // counts, never other donors' gifts.
    query(
      `SELECT c.id, COALESCE(c.donor_facing_name, c.name) AS name, c.donor_description, c.donor_story,
              c.hero_image_url, c.hero_crop, c.hero_focal_x, c.hero_focal_y, c.goal_progress_public, c.goal_amount,
              CASE WHEN c.goal_progress_public THEN
                COALESCE((SELECT SUM(g2.amount - COALESCE(g2.cover_fee_amount,0)) FROM gifts g2
                          WHERE g2.org_id = c.org_id AND (g2.campaign_id = c.id OR g2.campaign = c.name)), 0)
              + COALESCE((SELECT SUM(gr.amount) FROM grants gr
                          WHERE gr.org_id = c.org_id AND gr.campaign_id = c.id AND gr.awarded_at IS NOT NULL), 0)
              END AS raised
       FROM campaigns c
       WHERE c.org_id = ?
         AND (c.donor_description IS NOT NULL OR c.donor_story IS NOT NULL OR c.hero_image_url IS NOT NULL)
         AND EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = c.org_id AND g.donor_id = ANY(?)
                     AND (g.campaign_id = c.id OR g.campaign = c.name)
                     AND g.date >= ?)
       ORDER BY c.created_at DESC LIMIT 6`,
      [org.id, donorIds, orgTime.addDays(_portalToday, -730)]),   // ORG_TZ_SEAM_OK
    // §2 thank-you state — the donor's most recent campaign-attributed gift
    // in the last 30 days, shown ONLY when the campaign carries org-authored
    // copy (no content → the gift shows the campaign name and nothing more).
    query(
      `SELECT g.amount, g.date, COALESCE(c.donor_facing_name, c.name) AS campaign_name, c.donor_description
       FROM gifts g JOIN campaigns c ON c.org_id = g.org_id AND (g.campaign_id = c.id OR g.campaign = c.name)
       WHERE g.org_id = ? AND g.donor_id = ANY(?) AND c.donor_description IS NOT NULL
         AND g.date >= ?
       ORDER BY g.date DESC, g.id DESC LIMIT 1`,
      [org.id, donorIds, orgTime.addDays(_portalToday, -30)]),    // ORG_TZ_SEAM_OK
  ]);

  // Stripe display details (card last-4, next charge) — display-only, and the
  // dashboard degrades gracefully when Stripe is unreachable. One live Stripe
  // API call per active-ish subscription — in PARALLEL (BUILD-54 §1: these
  // were serial, ~300ms each on the donor's first paint).
  const recurringOut = await Promise.all(recurring.map(async (s) => {
    let last4 = null, nextCharge = null;
    if (stripe && org.stripe_account_id && ["active", "past_due", "recovering", "recovered", "paused"].includes(s.status)) {
      try {
        const sub = await stripe.subscriptions.retrieve(s.stripe_subscription_id,
          { expand: ["default_payment_method"] }, { stripeAccount: org.stripe_account_id });
        last4 = sub.default_payment_method?.card?.last4 || null;
        if (sub.current_period_end && !["canceled", "paused"].includes(s.status)) {
          nextCharge = new Date(sub.current_period_end * 1000).toISOString().slice(0, 10);
        }
      } catch { /* display-only — omit */ }
    }
    return {
      id: s.id, amount: parseFloat(s.amount) || 0, interval: s.interval || "month",
      status: s.status, pausedAt: s.paused_at, resumeAt: s.resume_at, canceledAt: s.canceled_at,
      cardLast4: last4, nextChargeDate: nextCharge,
      paymentHistory: gifts.filter(g => g.online).slice(0, 12)
        .map(g => ({ date: g.date, amount: parseFloat(g.amount) || 0 })),
    };
  }));

  const t = totalsRow[0] || {};
  const nowYear = String(new Date().getFullYear());
  const byYear = byYearRows.map(r => ({ year: r.year, total: parseFloat(r.total) || 0, count: r.count }));
  res.json({
    email,
    theme: portalThemePayload(org),
    donorName: displayNameCase(donors[0].name),
    giving: {
      ytd: byYear.find(y => y.year === nowYear)?.total || 0,
      byYear,
      lifetime: parseFloat(t.lifetime) || 0,
      giftCount: t.count || 0,
      firstGiftDate: t.first_gift || null,
      largestGift: parseFloat(t.largest) || 0,
    },
    gifts: gifts.map(g => ({
      id: g.id, date: g.date, amount: parseFloat(g.amount) || 0, type: g.type,
      campaign: g.campaign || null, fund: g.fund || null, online: g.online === true,
      recurring: g.recurring === true, // BUILD-64 Part 4 — mark recurring gifts in the history
      receiptId: g.receipt_id || null, receiptNumber: g.receipt_number || null,
    })),
    receipts: receipts.map(r => ({
      id: r.id, type: r.type, number: r.receipt_number, amount: parseFloat(r.amount) || 0,
      taxYear: r.tax_year, date: r.created_at,
    })),
    recurring: recurringOut,
    pledges: pledges.map(p => ({
      id: p.id, amount: parseFloat(p.amount) || 0, dueDate: p.due_date, status: p.status,
      paid: parseFloat(p.paid_amount) || 0, balance: parseFloat(p.balance) || 0,
    })),
    household,
    impact,
    // §2 — org-authored campaign content only; empty array when none.
    campaigns: campaignSpotlights.map(c => ({
      id: c.id, name: c.name,
      description: c.donor_description || null,
      story: Array.isArray(c.donor_story) ? c.donor_story : null,
      heroImage: c.hero_image_url || null,
      heroCrop: parseCrop(c.hero_crop),
      heroFocal: { x: Math.min(1, Math.max(0, Number(c.hero_focal_x ?? 0.5) || 0.5)), y: Math.min(1, Math.max(0, Number(c.hero_focal_y ?? 0.5) || 0.5)) },
      // Goal figures ONLY when the org opted this campaign public — and only
      // goal/raised/percent, never donor counts.
      goal: c.goal_progress_public === true ? {
        amount: parseFloat(c.goal_amount) || 0,
        raised: parseFloat(c.raised) || 0,
        percent: (parseFloat(c.goal_amount) || 0) > 0
          ? Math.min(100, Math.round(((parseFloat(c.raised) || 0) / parseFloat(c.goal_amount)) * 100)) : null,
      } : null,
    })),
    thankYou: thankYouRows.length ? {
      amount: parseFloat(thankYouRows[0].amount) || 0,
      date: thankYouRows[0].date,
      campaignName: thankYouRows[0].campaign_name,
      description: thankYouRows[0].donor_description,
    } : null,
    account: accountNudge,
  });
}));

// ── §6.2 — deterministic impact matching over EXISTING gift attribution ────
async function matchImpactUpdates(orgId, donorIds) {
  const updates = await query(
    `SELECT id, title, body, photos, photo_crops, targets, org_wide, created_at
     FROM impact_updates WHERE org_id = ? AND status = 'published' ORDER BY created_at DESC LIMIT 50`, [orgId]);
  if (!updates.length) return [];
  const attrib = await query(
    `SELECT DISTINCT fund_id, campaign_id FROM gifts
     WHERE org_id = ? AND donor_id = ANY(?) AND date >= ?`,
    // ORG_TZ_SEAM_OK — a civil-date lookback window in the org's calendar.
    [orgId, donorIds, orgTime.addDays(orgToday(await orgTz(orgId)), -730)]);
  const funds = new Set(attrib.map(a => a.fund_id).filter(Boolean));
  const camps = new Set(attrib.map(a => a.campaign_id).filter(Boolean));
  const targeted = [], orgWide = [];
  for (const u of updates) {
    const targets = Array.isArray(u.targets) ? u.targets : [];
    const hit = targets.some(tg => (tg.kind === "fund" && funds.has(tg.id)) || (tg.kind === "campaign" && camps.has(tg.id)));
    const row = { id: u.id, title: u.title, body: u.body, photos: Array.isArray(u.photos) ? u.photos : [], photoCrops: Array.isArray(u.photo_crops) ? u.photo_crops : [], date: u.created_at, matched: hit };
    if (hit) targeted.push(row);
    else if (u.org_wide) orgWide.push(row);
  }
  return [...targeted, ...orgWide].slice(0, 12);
}

// Engagement signal: viewed an impact update — timeline only, never an alert.
app.post("/portal/:orgSlug/impact/:updateId/viewed", requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const [u] = await query(`SELECT id, title FROM impact_updates WHERE id = ? AND org_id = ?`, [req.params.updateId, org.id]);
  if (!u) return res.status(404).json({ error: "not_found" });
  const donors = await portalDonorsFor(org.id, email);
  for (const d of donors) await portalTimeline(org.id, d.id, `Portal: viewed impact update — ${u.title}`, "impact_view");
  res.json({ ok: true });
}));

// ── S-9 — receipts stream the EXISTING stored PDF, session-scoped ──────────
app.get("/portal/:orgSlug/receipts/:id/pdf", requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const donors = await portalDonorsFor(org.id, email);
  const donorIds = donors.map(d => d.id);
  const [r] = await query(
    `SELECT * FROM receipts WHERE id = ? AND org_id = ? AND donor_id = ANY(?) AND voided_at IS NULL`,
    [req.params.id, org.id, donorIds.length ? donorIds : [""]]);
  if (!r || !r.pdf_data) return res.status(404).json({ error: "not_found" });
  await portalAudit(org.id, r.donor_id, email, "receipt_downloaded", req, { receiptId: r.id });
  const buf = Buffer.from(r.pdf_data, "base64");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="receipt-${r.receipt_number || r.id}.pdf"`);
  res.send(buf);
}));

// ── §4 — recurring self-service. Every mutation is a D-series money path:
//    Stripe-FIRST (if Stripe fails the mutation fails — Steward must never
//    claim a schedule changed while Stripe keeps charging), serialized per
//    subscription (R-7), audit-logged, confirmed by email, mirrored into the
//    CRM timeline, drift-wired to the org (§6.3). ─────────────────────────
async function portalOwnedSub(req) {
  const { org, email } = req.portal;
  const donors = await portalDonorsFor(org.id, email);
  const donorIds = donors.map(d => d.id);
  if (!donorIds.length) return { error: 404 };
  const [sub] = await query(
    `SELECT * FROM recurring_subscriptions WHERE id = ? AND org_id = ? AND donor_id = ANY(?)`,
    [req.params.subId, org.id, donorIds]);
  if (!sub) return { error: 404 }; // foreign/unknown → indistinguishable 404 (S-2)
  const donor = donors.find(d => d.id === sub.donor_id) || donors[0];
  return { sub, donor };
}

// R-2 — pause (optional auto-resume date). Stripe pause_collection produces
// zero charges while paused; dunning already excludes non-past_due statuses.
app.post("/portal/:orgSlug/recurring/:subId/pause", portalMutationLimiter, requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const found = await portalOwnedSub(req);
  if (found.error) return res.status(404).json({ error: "not_found" });
  const { sub, donor } = found;
  let resumeAt = null;
  if (req.body?.resumeDate) {
    const d = new Date(String(req.body.resumeDate));
    if (isNaN(d) || d <= new Date() || d > new Date(Date.now() + 366 * 86400e3)) {
      return res.status(400).json({ error: "bad_resume_date", message: "Resume date must be in the next 12 months." });
    }
    resumeAt = d;
  }
  await withAdvisoryLock(`portal-sub:${sub.id}`, async () => {
    const [cur] = await query(`SELECT status FROM recurring_subscriptions WHERE id = ?`, [sub.id]);
    if (!cur || !["active", "recovered", "past_due", "recovering"].includes(cur.status)) {
      return res.status(409).json({ error: "not_pausable", message: "This gift can't be paused in its current state." });
    }
    if (!stripe || !org.stripe_account_id) return res.status(503).json({ error: "stripe_unavailable" });
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      pause_collection: { behavior: "void", ...(resumeAt ? { resumes_at: Math.floor(resumeAt.getTime() / 1000) } : {}) },
    }, { stripeAccount: org.stripe_account_id });
    await run(
      `UPDATE recurring_subscriptions SET status='paused', paused_at=NOW(), resume_at=?, next_dunning_at=NULL, updated_at=NOW() WHERE id=?`,
      [resumeAt, sub.id]);
    await portalAudit(org.id, donor.id, email, "recurring_pause", req, { subId: sub.id, resumeAt });
    await logRecurringChange(org.id, sub.id, donor.id, "paused",
      { oldAmount: parseFloat(sub.amount) || null, interval: sub.interval, actor: "donor" });
    await portalTimeline(org.id, donor.id, `Portal: paused their $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift${resumeAt ? ` until ${resumeAt.toISOString().slice(0, 10)}` : ""}`, "recurring_pause");
    portalDriftAlert(org, donor, sub, "recurring_pause", resumeAt ? `auto-resumes ${resumeAt.toISOString().slice(0, 10)}` : "no resume date set").catch(() => {});
    sendPortalMutationEmail(org, email, "Your recurring gift is paused",
      `Your $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift is paused${resumeAt ? ` and will resume automatically on ${resumeAt.toISOString().slice(0, 10)}` : ""}. No charges will occur while paused.`).catch(() => {});
    res.json({ ok: true, status: "paused", resumeAt });
  });
}));

// R-3 — resume (explicit; Stripe-side auto-resume also lands here via webhook).
app.post("/portal/:orgSlug/recurring/:subId/resume", portalMutationLimiter, requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const found = await portalOwnedSub(req);
  if (found.error) return res.status(404).json({ error: "not_found" });
  const { sub, donor } = found;
  await withAdvisoryLock(`portal-sub:${sub.id}`, async () => {
    const [cur] = await query(`SELECT status FROM recurring_subscriptions WHERE id = ?`, [sub.id]);
    if (!cur || cur.status !== "paused") return res.status(409).json({ error: "not_paused" });
    if (!stripe || !org.stripe_account_id) return res.status(503).json({ error: "stripe_unavailable" });
    await stripe.subscriptions.update(sub.stripe_subscription_id, { pause_collection: "" }, { stripeAccount: org.stripe_account_id });
    await run(`UPDATE recurring_subscriptions SET status='active', paused_at=NULL, resume_at=NULL, updated_at=NOW() WHERE id=?`, [sub.id]);
    await portalAudit(org.id, donor.id, email, "recurring_resume", req, { subId: sub.id });
    await logRecurringChange(org.id, sub.id, donor.id, "resumed",
      { newAmount: parseFloat(sub.amount) || null, interval: sub.interval, actor: "donor" });
    await portalTimeline(org.id, donor.id, `Portal: resumed their $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift`, "recurring_resume");
    sendPortalMutationEmail(org, email, "Your recurring gift has resumed",
      `Your $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift is active again. Thank you for your continued support.`).catch(() => {});
    res.json({ ok: true, status: "active" });
  });
}));

// R-1 — change amount. Server re-prices authoritatively: integer minor units
// end-to-end, floored at the org's configured minimum; effective next charge
// (proration_behavior none — no proration in v1).
app.post("/portal/:orgSlug/recurring/:subId/amount", portalMutationLimiter, requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const found = await portalOwnedSub(req);
  if (found.error) return res.status(404).json({ error: "not_found" });
  const { sub, donor } = found;
  const cents = Number(req.body?.amountCents);
  const minCents = Number(org.min_recurring_cents) || 500;
  if (!Number.isInteger(cents) || cents < minCents || cents > 10000000) {
    return res.status(400).json({ error: "bad_amount", message: `Amount must be at least $${(minCents / 100).toFixed(2)}.` });
  }
  await withAdvisoryLock(`portal-sub:${sub.id}`, async () => {
    const [cur] = await query(`SELECT status, amount FROM recurring_subscriptions WHERE id = ?`, [sub.id]);
    if (!cur || !["active", "recovered", "paused"].includes(cur.status)) {
      return res.status(409).json({ error: "not_editable", message: "This gift can't be changed in its current state." });
    }
    if (!stripe || !org.stripe_account_id) return res.status(503).json({ error: "stripe_unavailable" });
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id, {}, { stripeAccount: org.stripe_account_id });
    const item = stripeSub.items?.data?.[0];
    if (!item) return res.status(409).json({ error: "not_editable" });
    // BUILD-57 §2a (real-Stripe finding): subscription updates take price_data
    // with an existing PRODUCT id — product_data is Checkout-only sugar and
    // real Stripe rejects it (the local mock accepted anything, so this
    // donor-facing reprice had never actually worked against real Stripe).
    const productId = await ensureRecurringGiftProduct(org.stripe_account_id, displayNameCase(org.name));
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: item.id, price_data: {
        currency: item.price?.currency || "usd",
        product: productId,
        recurring: { interval: (sub.interval === "year" ? "year" : "month") },
        unit_amount: cents,
      } }],
      proration_behavior: "none",
    }, { stripeAccount: org.stripe_account_id });
    const oldAmt = parseFloat(cur.amount) || 0;
    const newAmt = cents / 100;
    await run(`UPDATE recurring_subscriptions SET amount=?, updated_at=NOW() WHERE id=?`, [newAmt, sub.id]);
    await portalAudit(org.id, donor.id, email, "recurring_amount", req, { subId: sub.id, from: oldAmt, to: newAmt });
    if (Math.abs(newAmt - oldAmt) >= 0.005) {
      await logRecurringChange(org.id, sub.id, donor.id, newAmt > oldAmt ? "amount_up" : "amount_down",
        { oldAmount: oldAmt, newAmount: newAmt, interval: sub.interval, actor: "donor" });
    }
    await portalTimeline(org.id, donor.id, `Portal: changed their recurring gift from $${oldAmt.toLocaleString()} to $${newAmt.toLocaleString()}/${sub.interval || "month"}`, "recurring_amount");
    sendPortalMutationEmail(org, email, "Your recurring gift amount changed",
      `Your recurring gift is now $${newAmt.toLocaleString()}/${sub.interval || "month"} (was $${oldAmt.toLocaleString()}). The new amount takes effect on your next scheduled charge.`).catch(() => {});
    res.json({ ok: true, amount: newAmt });
  });
}));

// R-4 — cancel. One optional, skippable reason; NO retention dark patterns.
// The org hears about it in minutes (§6.3) — that is the retention mechanism.
app.post("/portal/:orgSlug/recurring/:subId/cancel", portalMutationLimiter, requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const found = await portalOwnedSub(req);
  if (found.error) return res.status(404).json({ error: "not_found" });
  const { sub, donor } = found;
  const reason = String(req.body?.reason || "").trim().slice(0, 500) || null;
  await withAdvisoryLock(`portal-sub:${sub.id}`, async () => {
    const [cur] = await query(`SELECT status FROM recurring_subscriptions WHERE id = ?`, [sub.id]);
    if (!cur || cur.status === "canceled") return res.status(409).json({ error: "already_canceled" });
    if (!stripe || !org.stripe_account_id) return res.status(503).json({ error: "stripe_unavailable" });
    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true }, { stripeAccount: org.stripe_account_id });
    await run(
      `UPDATE recurring_subscriptions SET status='canceled', canceled_at=NOW(), next_dunning_at=NULL, updated_at=NOW() WHERE id=?`,
      [sub.id]);
    await run(`UPDATE donors SET stripe_subscription_status='canceled', updated_at=NOW() WHERE id=? AND org_id=?`, [donor.id, org.id]).catch(() => {});
    await portalAudit(org.id, donor.id, email, "recurring_cancel", req, { subId: sub.id, reason });
    await logRecurringChange(org.id, sub.id, donor.id, "canceled_voluntary",
      { oldAmount: parseFloat(sub.amount) || null, interval: sub.interval, actor: "donor" });
    await portalTimeline(org.id, donor.id, `Portal: canceled their $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift${reason ? ` — reason: ${reason}` : ""}`, "recurring_cancel");
    portalDriftAlert(org, donor, sub, "recurring_cancel", reason).catch(() => {});
    sendPortalMutationEmail(org, email, "Your recurring gift is canceled",
      `Your $${Number(sub.amount).toLocaleString()}/${sub.interval || "month"} recurring gift is canceled. You won't be charged again. Thank you for everything you've given.`).catch(() => {});
    res.json({ ok: true, status: "canceled" });
  });
}));

// R-5 — update payment method: the EXISTING setup-mode Checkout flow (card
// data never touches Steward). Returns the signed card-update URL.
app.post("/portal/:orgSlug/recurring/:subId/update-card", portalMutationLimiter, requirePortalSession, wrap(async (req, res) => {
  const { org, email } = req.portal;
  const found = await portalOwnedSub(req);
  if (found.error) return res.status(404).json({ error: "not_found" });
  const { sub, donor } = found;
  await portalAudit(org.id, donor.id, email, "card_update_started", req, { subId: sub.id });
  res.json({ url: buildCardUpdateUrl(sub.stripe_subscription_id, org.id) });
}));

// ══ Staff-side portal admin (portal settings + impact updates) ═════════════
// Org admins configure the portal in the existing CRM (staff JWT auth — the
// OTHER side of the P-4 wall).

// BUILD-51 — the public theme-asset URL. Content-addressed ids make these
// immutable: new bytes mint a new id, so aggressive caching can never serve
// a stale image (the Vercel /portal-assets proxy + any CDN honor these
// headers). Carries no donor data — theme imagery is public by definition
// (it renders on the public portal/give pages).
// BUILD-59 — responsive delivery: ?w=<n> serves a width-resized variant so a
// phone gets a ~400–800px banner instead of the 2400px master (srcset/sizes
// on the render). Widths are a fixed whitelist (an open param would be a
// resize-DoS + a cache-cardinality blowout); the id is content-addressed so
// (id,w) is a stable, immutable URL — the CDN caches each width once. SVGs and
// non-raster types pass through untouched (they scale losslessly).
const PORTAL_ASSET_WIDTHS = [400, 800, 1280, 1920, 2560];
app.get("/portal-assets/:id", wrap(async (req, res) => {
  const asset = await getThemeAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "not_found" });
  let buffer = asset.buffer, contentType = asset.contentType, variantTag = "";
  const w = parseInt(req.query.w, 10);
  if (PORTAL_ASSET_WIDTHS.includes(w) && contentType !== "image/svg+xml" && contentType !== "image/gif") {
    try {
      const sharp = require("sharp");
      const meta = await sharp(asset.buffer).metadata();
      // Never UPSCALE — a 900px master asked for 2560 stays 900 (upscaling is
      // the grain complaint). Re-encode as WebP for the resized variants.
      if (meta.width && meta.width > w) {
        buffer = await sharp(asset.buffer).resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        contentType = "image/webp";
        variantTag = `-w${w}`;
      }
    } catch (e) { console.error("[portal-assets] resize failed, serving master:", e.message); }
  }
  res.set("Content-Type", contentType);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.set("ETag", `"${asset.id}${variantTag}"`);
  res.set("Vary", "Accept");
  res.send(buffer);
}));

// BUILD-56 Part 4 — ops/test hook for the retention purge (drives the exact
// sweep path for the caller's org NOW; same bar as /workflows/run-sweeps).
// The scheduled sweep runs org-wide on the 6-hour tick below.
app.post("/assets/run-purge", requireAuth, requireAdmin, wrap(async (req, res) => {
  res.json(await purgeExpiredAssets({ orgId: req.user.orgId }));
}));

app.get("/portal-settings", requireAuth, wrap(async (req, res) => {
  await run(`INSERT INTO portal_settings (org_id) VALUES (?) ON CONFLICT (org_id) DO NOTHING`, [req.user.orgId]);
  const [ps] = await query(`SELECT * FROM portal_settings WHERE org_id = ?`, [req.user.orgId]);
  const [org] = await query(`SELECT org_slug FROM orgs WHERE id = ?`, [req.user.orgId]);
  res.json({ ...ps, org_slug: org?.org_slug || null, portal_url: `${publicAppUrl()}/portal/${org?.org_slug}` });
}));

// BUILD-56 — a legacy IN-ROW base64 image (a pre-BUILD-51 row that never
// re-saved through the asset seam) being replaced or cleared would be
// destroyed with the old row value, outside the retention window entirely.
// Rescue it into the asset store first — it lands unreferenced, so the very
// next prune soft-deletes it into the 90-day window — and record ITS path as
// the history from-value.
async function rescueLegacyImageValue(orgId, kind, dataUri) {
  const m = typeof dataUri === "string" ? dataUri.match(/^data:([^;]+);base64,(.*)$/s) : null;
  if (!m) return null;
  try {
    const asset = await putThemeAsset({ orgId, kind, buffer: Buffer.from(m[2], "base64"), contentType: m[1] });
    return asset.path;
  } catch (e) { console.error("[assets] legacy-image rescue failed:", e.message); return "legacy:unrecoverable"; }
}

// BUILD-51b — impact-update photos ride the same asset seam as theme images.
// Content-photo rules (not the 5:1 banner rule): must parse as an image (or
// be SVG), <=6000px per side, ANY orientation. A stored /portal-assets/ path
// passes through untouched (the Settings edit form echoes existing photos);
// a data URI is validated + stored and becomes a path. Cap: 4 per update.
const MAX_IMPACT_PHOTOS = 4;
// BUILD-65 Part 3 — cropsIn is optional, index-aligned with photosIn. We zip
// them, drop falsy photos (keeping crops aligned), cap at 4, and emit a `crops`
// array aligned with the stored `photos` (each a validated {x,y,w,h} or null →
// center focal fallback). The bytes are never touched.
async function storeImpactPhotos(orgId, photosIn, cropsIn) {
  const pairs = (Array.isArray(photosIn) ? photosIn : [])
    .map((p, i) => ({ p, c: Array.isArray(cropsIn) ? cropsIn[i] : null }))
    .filter(x => x.p).slice(0, MAX_IMPACT_PHOTOS);
  const out = [], crops = [];
  for (const { p, c } of pairs) {
    const crop = (c == null || c === "") ? null : parseCrop(c);
    if (typeof p === "string" && p.startsWith("/portal-assets/")) { out.push(p); crops.push(crop); continue; }
    const uerr = uploadImageError(p);
    if (uerr) return { error: "bad_image", message: uerr };
    const m = String(p).match(/^data:([^;]+);base64,(.*)$/s);
    let buffer;
    try { buffer = Buffer.from(m[2], "base64"); } catch { return { error: "bad_image" }; }
    const dims = checkThemeImageDimensions("impact", m[1], buffer);
    if (!dims.ok) return { error: "bad_image_dimensions", message: dims.message };
    const norm = await normalizeUploadImage("impact", m[1], buffer);
    if (norm.error) return norm;
    const asset = await putThemeAsset({ orgId, kind: "impact", buffer: norm.buffer, contentType: norm.contentType, width: norm.width ?? dims.width, height: norm.height ?? dims.height });
    out.push(asset.path); crops.push(crop);
  }
  return { photos: out, crops };
}
// Keep = every photo id ANY of the org's updates still references (content
// addressing means one photo can legitimately back several updates).
async function pruneImpactAssets(orgId) {
  const rows = await query(`SELECT photos FROM impact_updates WHERE org_id = ?`, [orgId]);
  const keep = [];
  for (const r of rows) {
    for (const p of (Array.isArray(r.photos) ? r.photos : [])) {
      const m = /^\/portal-assets\/(pa_[a-f0-9]{24})$/.exec(String(p));
      if (m) keep.push(m[1]);
    }
  }
  await pruneUnreferencedAssets(orgId, "impact", keep);
}

// Allowlisted video providers, server-side ID parsing ONLY (§4).
function parseVideoRef(url) {
  const s = String(url || "").trim().slice(0, 300);
  let m = /^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{6,20})/.exec(s)
    || /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{6,20})/.exec(s)
    || /^https?:\/\/(?:www\.)?youtube\.com\/embed\/([A-Za-z0-9_-]{6,20})/.exec(s);
  if (m) return { provider: "youtube", videoId: m[1] };
  m = /^https?:\/\/(?:www\.)?vimeo\.com\/(\d{6,12})/.exec(s);
  if (m) return { provider: "vimeo", videoId: m[1] };
  return null;
}

async function storeWidgetImage(orgId, v) {
  if (v == null || v === "") return { url: null };
  if (typeof v === "string" && v.startsWith("/portal-assets/")) return { url: v };
  const uerr = uploadImageError(v);
  if (uerr) return { error: uerr };
  const m = String(v).match(/^data:([^;]+);base64,(.*)$/s);
  let buffer;
  try { buffer = Buffer.from(m[2], "base64"); } catch { return { error: "That image didn't decode." }; }
  const dims = checkThemeImageDimensions("widget", m[1], buffer);
  if (!dims.ok) return { error: dims.message };
  const norm = await normalizeUploadImage("widget", m[1], buffer);
  if (norm.error) return { error: norm.message };
  const asset = await putThemeAsset({ orgId, kind: "widget", buffer: norm.buffer, contentType: norm.contentType, width: norm.width ?? dims.width, height: norm.height ?? dims.height });
  return { url: asset.path };
}

const wStr = (v, cap) => (v == null ? "" : String(v)).trim().slice(0, cap);

// Validates ONE widget's typed fields → { widget } or { error }.
async function validateWidget(raw, orgId) {
  const { WIDGET_TYPES } = await widgetMod();
  if (!raw || typeof raw !== "object" || !WIDGET_TYPES.includes(raw.type)) return { error: "Unknown widget type." };
  const w = { id: /^wid_[a-f0-9]{8}$/.test(raw.id || "") ? raw.id : "wid_" + uuid().slice(0, 8), type: raw.type };
  const img = async (v) => { const r = await storeWidgetImage(orgId, v); if (r.error) throw new Error(r.error); return r.url; };
  try {
    switch (raw.type) {
      case "hero":
        w.heading = wStr(raw.heading, 120); w.sub = wStr(raw.sub, 300);
        w.image = await img(raw.image);
        w.imageCrop = parseCrop(raw.imageCrop);                 // BUILD-65 Part 3 — non-destructive crop
        w.size = raw.size === "tall" ? "tall" : "standard";     // resize-where-sensible
        break;
      case "richtext": {
        const v = validateStoryBlocks(raw.blocks);
        if (v.error) return { error: "Rich text must be paragraphs, headings, and lists — no HTML." };
        w.blocks = v.blocks || [];
        break;
      }
      case "image":
        w.image = await img(raw.image);
        if (!w.image) return { error: "The image widget needs an image." };
        w.imageCrop = parseCrop(raw.imageCrop);                 // BUILD-65 Part 3 — non-destructive crop
        w.caption = wStr(raw.caption, 300);
        break;
      case "gallery": {
        const list = Array.isArray(raw.images) ? raw.images.slice(0, 8) : [];
        w.images = [];
        for (const v of list) { const u = await img(v); if (u) w.images.push(u); }
        if (!w.images.length) return { error: "The gallery needs at least one image." };
        break;
      }
      case "stats": {
        const items = Array.isArray(raw.items) ? raw.items.slice(0, 4) : [];
        w.items = items.map(i => ({ value: wStr(i?.value, 40), label: wStr(i?.label, 80) })).filter(i => i.value && i.label);
        if (!w.items.length) return { error: "Stats need at least one value + label (your own numbers — nothing is computed for you)." };
        break;
      }
      case "funds": {
        w.heading = wStr(raw.heading, 120);
        const ids = Array.isArray(raw.fundIds) ? raw.fundIds.slice(0, 6) : [];
        for (const id of ids) { if (!(await orgOwns("fin_funds", id, orgId))) return { error: "Each fund must be one of your organization's funds." }; }
        w.fundIds = ids;
        break;
      }
      case "campaign":
        if (!raw.campaignId || !(await orgOwns("campaigns", raw.campaignId, orgId))) return { error: "Pick one of your own campaigns." };
        w.campaignId = raw.campaignId;
        break;
      case "impact":
        w.heading = wStr(raw.heading, 120);
        break;
      case "quote":
        w.text = wStr(raw.text, 500);
        if (!w.text) return { error: "The quote needs text." };
        w.attribution = wStr(raw.attribution, 120);
        break;
      case "staff": {
        const members = Array.isArray(raw.members) ? raw.members.slice(0, 6) : [];
        w.members = [];
        for (const m of members) {
          const name = wStr(m?.name, 80); if (!name) continue;
          w.members.push({ name, role: wStr(m?.role, 80), photo: await img(m?.photo) });
        }
        if (!w.members.length) return { error: "Add at least one person." };
        w.contactEmail = wStr(raw.contactEmail, 200);
        break;
      }
      case "faq": {
        const items = Array.isArray(raw.items) ? raw.items.slice(0, 10) : [];
        w.items = items.map(i => ({ q: wStr(i?.q, 200), a: wStr(i?.a, 1000) })).filter(i => i.q && i.a);
        if (!w.items.length) return { error: "Add at least one question and answer." };
        break;
      }
      case "video": {
        // Accept a stored ref back unchanged, or parse a fresh URL.
        if (raw.provider && raw.videoId && parseVideoRef(
          raw.provider === "youtube" ? `https://youtu.be/${raw.videoId}` : `https://vimeo.com/${raw.videoId}`)) {
          w.provider = raw.provider === "vimeo" ? "vimeo" : "youtube"; w.videoId = wStr(raw.videoId, 20);
        } else {
          const ref = parseVideoRef(raw.url);
          if (!ref) return { error: "Videos must be a YouTube or Vimeo link." };
          w.provider = ref.provider; w.videoId = ref.videoId;
        }
        w.caption = wStr(raw.caption, 200);
        break;
      }
      case "give":
        w.heading = wStr(raw.heading, 120);
        w.buttonLabel = wStr(raw.buttonLabel, 40) || "Give";
        break;
      case "mygiving":
        break;      // no fields — renders the signed-in donor's own data,
                    // degrades to a sign-in prompt on a public view
      default:
        return { error: "Unknown widget type." };
    }
  } catch (e) { return { error: e.message }; }
  return { widget: w };
}

async function validateWidgets(rawList, orgId) {
  if (!Array.isArray(rawList) || rawList.length > 30) return { error: "A page is up to 30 widgets." };
  const out = [];
  for (const raw of rawList) {
    const v = await validateWidget(raw, orgId);
    if (v.error) return { error: v.error };
    out.push(v.widget);
  }
  return { widgets: out };
}

// Every asset path a widget list references (BUILD-56: also the pointer-
// history value for portal_pages — the paths, not the whole JSONB, so history
// rows stay tiny while still recording which hashes were on the page).
function extractWidgetAssetPaths(list) {
  const out = [];
  for (const w of (Array.isArray(list) ? list : [])) {
    for (const u of [w.image, ...(w.images || []), ...((w.members || []).map(m => m && m.photo))]) {
      if (/^\/portal-assets\/pa_[a-f0-9]{24}$/.test(String(u || ""))) out.push(u);
    }
  }
  return out;
}
const widgetPathsOrNull = (list) => { const p = extractWidgetAssetPaths(list); return p.length ? p : null; };

// Widget images are reference-counted across BOTH draft and published (one
// photo can back several widgets and both generations).
async function pruneWidgetAssets(orgId) {
  // BUILD-95 §5B — EVERY page of the org, not just the portal's one row.
  // `portal_pages` is org_id-keyed (one page); giving pages are many, and a
  // sweep that only read the portal would destroy a photo a live giving page
  // was still showing. The 90-day soft delete would have hidden it for a
  // quarter and then made it permanent.
  const rows = [
    ...await query(`SELECT draft, published FROM portal_pages WHERE org_id = ?`, [orgId]),
    ...await query(`SELECT draft, published FROM giving_pages WHERE org_id = ?`, [orgId]),
  ];
  const keep = rows
    .flatMap(r => [...extractWidgetAssetPaths(r.draft), ...extractWidgetAssetPaths(r.published)])
    .map(p => p.replace("/portal-assets/", ""));
  await pruneUnreferencedAssets(orgId, "widget", keep);
}

// Starter layouts (§4) — an empty org never faces a blank canvas. Content
// slots are EMPTY or clearly placeholder-labeled; nothing is invented.
const PORTAL_STARTERS = {
  story_first: {
    label: "Story first",
    widgets: [
      { type: "hero", heading: "", sub: "", image: null, size: "tall" },
      { type: "richtext", blocks: [{ type: "p", text: "Tell the story of your work here — in your own words." }] },
      { type: "mygiving" }, { type: "impact", heading: "What your giving made possible" },
      { type: "give", heading: "Make a new gift", buttonLabel: "Give" },
    ],
  },
  giving_first: {
    label: "Giving first",
    widgets: [
      { type: "hero", heading: "", sub: "", image: null, size: "standard" },
      { type: "mygiving" }, { type: "impact", heading: "What your giving made possible" },
      { type: "funds", heading: "Where you can give", fundIds: [] },
      { type: "give", heading: "Make a new gift", buttonLabel: "Give" },
    ],
  },
  campaign_first: {
    label: "Campaign spotlight",
    widgets: [
      { type: "hero", heading: "", sub: "", image: null, size: "standard" },
      { type: "mygiving" },
      { type: "richtext", blocks: [{ type: "p", text: "Introduce your current campaign here, then add the Campaign widget and pick it." }] },
      { type: "impact", heading: "What your giving made possible" },
      { type: "give", heading: "Make a new gift", buttonLabel: "Give" },
    ],
  },
};

// Resolve the PUBLISHED page for donor-facing render. `sessionless` public
// resolution carries no donor data by construction; the signed-in client
// layers its own /me data onto the mygiving/impact widgets.
async function resolvePortalPagePublic(org) {
  const [row] = await query(`SELECT published FROM portal_pages WHERE org_id = ?`, [org.id]);
  const widgets = row && Array.isArray(row.published) ? row.published : null;
  if (!widgets || !widgets.length) return null;
  return { widgets: await resolveWidgetsPublic(org, widgets), giveSlug: org.org_slug };
}

// ── §4 CRM editor routes — admin-only, org-scoped BY the staff session (the
// org id comes from req.user only; no cross-org id exists in this API), and
// they carry ZERO donor data: edit mode renders SAMPLE donor data client-side.
app.get("/portal-page", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [row] = await query(`SELECT * FROM portal_pages WHERE org_id = ?`, [req.user.orgId]);
  res.json({
    draft: row?.draft || null, published: row?.published || null,
    draftUpdatedAt: row?.draft_updated_at || null, publishedAt: row?.published_at || null,
    starters: Object.entries(PORTAL_STARTERS).map(([key, s]) => ({ key, label: s.label })),
  });
}));

// Autosave target — writes the DRAFT only; donors never see it.
app.put("/portal-page/draft", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const v = await validateWidgets(req.body?.widgets, req.user.orgId);
  if (v.error) return res.status(400).json({ error: "bad_widgets", message: v.error });
  const [prev] = await query(`SELECT draft FROM portal_pages WHERE org_id = ?`, [req.user.orgId]);
  await run(
    `INSERT INTO portal_pages (org_id, draft, draft_updated_at) VALUES (?,?,NOW())
     ON CONFLICT (org_id) DO UPDATE SET draft = EXCLUDED.draft, draft_updated_at = NOW()`,
    [req.user.orgId, JSON.stringify(v.widgets)]);
  await pruneWidgetAssets(req.user.orgId);
  await recordAssetPointerHistory(req.user.orgId, "portal_page.draft", req.user.orgId,
    widgetPathsOrNull(prev?.draft), widgetPathsOrNull(v.widgets), req.user);
  res.json({ draft: v.widgets, draftUpdatedAt: new Date().toISOString() });
}));

app.post("/portal-page/publish", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [row] = await query(`SELECT draft, published FROM portal_pages WHERE org_id = ?`, [req.user.orgId]);
  if (!row || !Array.isArray(row.draft)) return res.status(400).json({ error: "nothing_to_publish" });
  await run(`UPDATE portal_pages SET published = draft, published_at = NOW() WHERE org_id = ?`, [req.user.orgId]);
  await recordAssetPointerHistory(req.user.orgId, "portal_page.published", req.user.orgId,
    widgetPathsOrNull(row.published), widgetPathsOrNull(row.draft), req.user);
  res.json({ published: row.draft, publishedAt: new Date().toISOString() });
}));

app.post("/portal-page/revert", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [row] = await query(`SELECT draft, published FROM portal_pages WHERE org_id = ?`, [req.user.orgId]);
  await run(`UPDATE portal_pages SET draft = published, draft_updated_at = NOW() WHERE org_id = ?`, [req.user.orgId]);
  await pruneWidgetAssets(req.user.orgId);
  await recordAssetPointerHistory(req.user.orgId, "portal_page.draft", req.user.orgId,
    widgetPathsOrNull(row?.draft), widgetPathsOrNull(row?.published), req.user);
  res.json({ draft: row?.published || null });
}));

app.post("/portal-page/starter", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const starter = PORTAL_STARTERS[req.body?.key];
  if (!starter) return res.status(400).json({ error: "unknown_starter" });
  const v = await validateWidgets(starter.widgets, req.user.orgId);
  if (v.error) return res.status(400).json({ error: "bad_widgets", message: v.error });
  const [prev] = await query(`SELECT draft FROM portal_pages WHERE org_id = ?`, [req.user.orgId]);
  await run(
    `INSERT INTO portal_pages (org_id, draft, draft_updated_at) VALUES (?,?,NOW())
     ON CONFLICT (org_id) DO UPDATE SET draft = EXCLUDED.draft, draft_updated_at = NOW()`,
    [req.user.orgId, JSON.stringify(v.widgets)]);
  await recordAssetPointerHistory(req.user.orgId, "portal_page.draft", req.user.orgId,
    widgetPathsOrNull(prev?.draft), widgetPathsOrNull(v.widgets), req.user);
  res.json({ draft: v.widgets });
}));

app.put("/portal-settings", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const b = req.body || {};
  await run(`INSERT INTO portal_settings (org_id) VALUES (?) ON CONFLICT (org_id) DO NOTHING`, [req.user.orgId]);
  const updates = [], params = [];
  const setStr = (col, v, cap) => { updates.push(`${col} = ?`); params.push(v == null || v === "" ? null : String(v).slice(0, cap)); };
  let adjusted = false, tintAdjusted = false;
  if (b.enabled !== undefined) { updates.push("enabled = ?"); params.push(b.enabled === true); }
  if (b.poweredBy !== undefined) { updates.push("powered_by = ?"); params.push(b.poweredBy === true); }
  // BUILD-46 §2.2 — "list this organization in donor dashboards". Default OFF
  // for existing CRM orgs (opt-in); the network-approval path flips it on.
  if (b.networkListed !== undefined) { updates.push("network_listed = ?"); params.push(b.networkListed === true); }
  if (b.displayName !== undefined) setStr("display_name", b.displayName, 120);
  // BUILD-47 directory card fields — shown only in the donor-side directory,
  // only while the org is listed.
  if (b.directoryDescription !== undefined) setStr("directory_description", b.directoryDescription, 160);
  if (b.directoryCity !== undefined) setStr("directory_city", b.directoryCity, 80);
  if (b.directoryState !== undefined) setStr("directory_state", b.directoryState, 40);
  if (b.footerText !== undefined) setStr("footer_text", b.footerText, 500);
  if (b.contactEmail !== undefined) setStr("contact_email", b.contactEmail, 200);
  if (b.einLine !== undefined) setStr("ein_line", b.einLine, 200);
  // BUILD-60 Part 2 — per-frequency, org-configurable amount ladders. A valid
  // ladder is 3–6 positive whole-dollar tiers; null/"" clears back to the
  // built-in default. Stored as a JSON array of ints.
  for (const [key, col, dflt] of [["onetimeAmounts", "onetime_amounts", GIVE_ONETIME_DEFAULT], ["monthlyAmounts", "monthly_amounts", GIVE_MONTHLY_DEFAULT]]) {
    if (b[key] === undefined) continue;
    if (b[key] === "" || b[key] == null) { updates.push(`${col} = NULL`); continue; }
    if (!Array.isArray(b[key])) return res.status(400).json({ error: "bad_ladder", message: `${key} must be an array of dollar amounts.` });
    const clean = b[key].map(n => Math.round(Number(n))).filter(n => Number.isFinite(n) && n >= 1 && n <= 1000000);
    if (clean.length < 3 || clean.length > 6 || clean.length !== b[key].length) return res.status(400).json({ error: "bad_ladder", message: `${key} must be 3–6 whole-dollar amounts between $1 and $1,000,000.` });
    updates.push(`${col} = ?`); params.push(JSON.stringify(clean));
    void dflt;
  }
  if (b.minRecurringCents !== undefined) {
    const c = Number(b.minRecurringCents);
    if (!Number.isInteger(c) || c < 100 || c > 1000000) return res.status(400).json({ error: "bad_min" });
    updates.push("min_recurring_cents = ?"); params.push(c);
  }
  // §5 contrast guard — the ONE normalizeAccent implementation (branding.js):
  // an illegible brand color is deepened along its own hue to WCAG AA, and the
  // admin is told why, rather than shipping an unreadable portal.
  for (const [key, col] of [["primaryColor", "primary_color"], ["accentColor", "accent_color"], ["buttonColor", "button_color"]]) {
    if (b[key] !== undefined) {
      if (b[key] === "" || b[key] == null) { updates.push(`${col} = NULL`); continue; }
      const norm = normalizeAccent(String(b[key]));
      if (!norm) return res.status(400).json({ error: "bad_color", message: `${key} is not a valid hex color.` });
      if (norm.adjusted) adjusted = true;
      updates.push(`${col} = ?`); params.push(norm.accent);
    }
  }
  // BUILD-48 — background tint rides the mirror-image guard: a too-dark tint
  // is LIGHTENED (text sits on it) rather than deepened, admin told either way.
  if (b.backgroundTint !== undefined) {
    if (b.backgroundTint === "" || b.backgroundTint == null) { updates.push("background_tint = NULL"); }
    else {
      const norm = normalizeTint(String(b.backgroundTint));
      if (!norm) return res.status(400).json({ error: "bad_color", message: "backgroundTint is not a valid hex color." });
      if (norm.adjusted) { adjusted = true; tintAdjusted = true; }
      updates.push("background_tint = ?"); params.push(norm.tint);
    }
  }
  // Type pairing + card style are ENUMS — a curated set, never free CSS or
  // font URLs (the whole point: Wix-like without a CSS-injection surface).
  for (const [key, col, allowed] of [["typePairing", "type_pairing", PORTAL_TYPE_PAIRINGS], ["cardStyle", "card_style", PORTAL_CARD_STYLES]]) {
    if (b[key] !== undefined) {
      if (b[key] === "" || b[key] == null) { updates.push(`${col} = NULL`); continue; }
      if (!allowed.includes(b[key])) return res.status(400).json({ error: `bad_${col}`, message: `${key} must be one of: ${allowed.join(", ")}.` });
      updates.push(`${col} = ?`); params.push(b[key]);
    }
  }
  // BUILD-51 — theme images are stored as ASSETS, never in the row. A data
  // URI upload is validated (type + size + dimensions), written through
  // assetStore, and the row keeps only the /portal-assets/<id> URL path; the
  // legacy *_data column is nulled. The client may echo back the stored URL
  // on an unrelated save — that's a no-op, not a re-upload. "" clears.
  // BUILD-59 — header focal point (normalized 0..1; the org sets it by clicking
  // the crop preview). Clamped; stored on the header pointer.
  for (const [key, col] of [["headerFocalX", "header_focal_x"], ["headerFocalY", "header_focal_y"]]) {
    if (b[key] === undefined) continue;
    const n = Number(b[key]);
    if (!Number.isFinite(n)) return res.status(400).json({ error: "bad_focal", message: "Focal point must be a number between 0 and 1." });
    updates.push(`${col} = ?`); params.push(Math.min(1, Math.max(0, n)));
  }
  // BUILD-61 — the non-destructive crop rectangle (normalized {x,y,w,h}).
  // null/"" clears it back to the focal fallback. Validated identically to the
  // read side (parseCrop) so a malformed rect can never be stored.
  if (b.headerCrop !== undefined) {
    if (b.headerCrop === "" || b.headerCrop == null) { updates.push("header_crop = NULL"); }
    else {
      const c = parseCrop(b.headerCrop);
      if (!c) return res.status(400).json({ error: "bad_crop", message: "Crop must be a rectangle {x,y,w,h} within the image." });
      updates.push("header_crop = ?"); params.push(JSON.stringify(c));
    }
  }
  const assetOps = []; // deferred until after the row UPDATE
  // BUILD-56 — the current pointers, read up front so every change appends a
  // pointer-history row (the from-half of recovery).
  const [curPtr] = await query(`SELECT logo_url, logo_data, header_image_url, header_image_data FROM portal_settings WHERE org_id = ?`, [req.user.orgId]);
  for (const [key, colBase, kind] of [["logoData", "logo", "logo"], ["headerImageData", "header_image", "header"]]) {
    const v = b[key];
    if (v === undefined) continue;
    if (typeof v === "string" && (v.startsWith("/portal-assets/") || ASSET_ID_RE.test(v.replace("/portal-assets/", "")))) continue; // echo of the stored URL — keep
    // The pointer being replaced: the stored URL, or a legacy in-row base64
    // rescued into the store so the old bytes land in the retention window.
    let fromVal = curPtr?.[`${colBase}_url`] || null;
    if (!fromVal && curPtr?.[`${colBase}_data`]) fromVal = await rescueLegacyImageValue(req.user.orgId, kind, curPtr[`${colBase}_data`]);
    if (v == null || v === "") {
      updates.push(`${colBase}_data = ?`); params.push(null);
      updates.push(`${colBase}_url = ?`); params.push(null);
      assetOps.push({ kind, keepId: null, entity: `portal_settings.${colBase}`, fromVal, toVal: null });
      continue;
    }
    const uerr = uploadImageError(v);
    if (uerr) return res.status(400).json({ error: "bad_image", message: uerr });
    const m = v.match(/^data:([^;]+);base64,(.*)$/s);
    const contentType = m[1];
    let buffer;
    try { buffer = Buffer.from(m[2], "base64"); } catch { return res.status(400).json({ error: "bad_image" }); }
    const dims = checkThemeImageDimensions(kind, contentType, buffer);
    if (!dims.ok) return res.status(400).json({ error: "bad_image_dimensions", message: dims.message });
    const norm = await normalizeUploadImage(kind, contentType, buffer);
    if (norm.error) return res.status(400).json({ error: norm.error, message: norm.message });
    const asset = await putThemeAsset({ orgId: req.user.orgId, kind, buffer: norm.buffer, contentType: norm.contentType, width: norm.width ?? dims.width, height: norm.height ?? dims.height });
    updates.push(`${colBase}_url = ?`); params.push(asset.path);
    updates.push(`${colBase}_data = ?`); params.push(null);
    assetOps.push({ kind, keepId: asset.id, entity: `portal_settings.${colBase}`, fromVal, toVal: asset.path });
  }
  if (updates.length) {
    updates.push("updated_at = NOW()");
    await run(`UPDATE portal_settings SET ${updates.join(", ")} WHERE org_id = ?`, [...params, req.user.orgId]);
  }
  // Prune stale assets only AFTER the row points at the replacement (a serve
  // of the old URL during the window is fine; a dangling row URL is not).
  // BUILD-56: prune = soft delete; the pointer change is history-logged.
  for (const op of assetOps) {
    await pruneThemeAssets(req.user.orgId, op.kind, op.keepId);
    await recordAssetPointerHistory(req.user.orgId, op.entity, req.user.orgId, op.fromVal, op.toVal, req.user);
  }
  const [ps] = await query(`SELECT * FROM portal_settings WHERE org_id = ?`, [req.user.orgId]);
  res.json({ ...ps, adjusted, ...(adjusted ? { message: tintAdjusted
    ? "Your colors were adjusted slightly so text stays readable (WCAG AA) — light accents are deepened, dark backgrounds lightened."
    : "Your color was deepened slightly so text stays readable (WCAG AA)." } : {}) });
}));

// Impact Updates CRUD (§6.1) — same upload validation + org-scoping rules.
app.get("/impact-updates", requireAuth, wrap(async (req, res) => {
  res.json(await query(`SELECT * FROM impact_updates WHERE org_id = ? ORDER BY created_at DESC`, [req.user.orgId]));
}));

async function validImpactTargets(targets, orgId) {
  if (targets === undefined) return [];
  if (!Array.isArray(targets) || targets.length > 20) return null;
  const out = [];
  for (const t of targets) {
    if (!t || typeof t !== "object") return null;
    if (t.kind === "fund") {
      if (!(await orgOwns("fin_funds", t.id, orgId))) return null;
    } else if (t.kind === "campaign") {
      if (!(await orgOwns("campaigns", t.id, orgId))) return null;
    } else return null;
    out.push({ kind: t.kind, id: t.id });
  }
  return out;
}

app.post("/impact-updates", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: "title_required" });
  const body = String(b.body || "").slice(0, 20000);
  const stored = await storeImpactPhotos(req.user.orgId, b.photos, b.photoCrops);
  if (stored.error) return res.status(400).json({ error: stored.error, message: stored.message });
  const photos = stored.photos, photoCrops = stored.crops;
  const targets = await validImpactTargets(b.targets, req.user.orgId);
  if (targets === null) return res.status(404).json({ error: "bad_targets", message: "Each target must be a fund or campaign in your organization." });
  const id = "imp_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO impact_updates (id,org_id,title,body,photos,photo_crops,targets,org_wide,status,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, title, body, JSON.stringify(photos), JSON.stringify(photoCrops), JSON.stringify(targets),
     b.orgWide === true || targets.length === 0, b.status === "draft" ? "draft" : "published", req.user.userId]);
  await recordAssetPointerHistory(req.user.orgId, "impact_update.photos", id, null, photos.length ? photos : null, req.user);
  res.status(201).json((await query(`SELECT * FROM impact_updates WHERE id = ?`, [id]))[0]);
}));

// BUILD-56 — the history from-value for an impact photo list: stored paths
// pass through; a legacy in-row data URI is rescued into the store first so
// the bytes land in the retention window instead of vanishing with the row.
async function impactPhotosHistoryValue(orgId, photosList) {
  const out = [];
  for (const p of (Array.isArray(photosList) ? photosList : [])) {
    if (typeof p === "string" && p.startsWith("data:")) out.push(await rescueLegacyImageValue(orgId, "impact", p) || "legacy:unrecoverable");
    else out.push(p);
  }
  return out.length ? out : null;
}

app.put("/impact-updates/:id", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const [ex] = await query(`SELECT * FROM impact_updates WHERE id = ? AND org_id = ?`, [req.params.id, req.user.orgId]);
  if (!ex) return res.status(404).json({ error: "not_found" });
  const b = req.body || {};
  const title = b.title !== undefined ? String(b.title || "").trim().slice(0, 200) : ex.title;
  if (!title) return res.status(400).json({ error: "title_required" });
  const body = b.body !== undefined ? String(b.body || "").slice(0, 20000) : ex.body;
  let photos = ex.photos, photoCrops = Array.isArray(ex.photo_crops) ? ex.photo_crops : [];
  if (b.photos !== undefined) {
    const stored = await storeImpactPhotos(req.user.orgId, b.photos, b.photoCrops);
    if (stored.error) return res.status(400).json({ error: stored.error, message: stored.message });
    photos = stored.photos; photoCrops = stored.crops;
  }
  let targets = ex.targets;
  if (b.targets !== undefined) {
    targets = await validImpactTargets(b.targets, req.user.orgId);
    if (targets === null) return res.status(404).json({ error: "bad_targets" });
  }
  await run(
    `UPDATE impact_updates SET title=?, body=?, photos=?, photo_crops=?, targets=?, org_wide=?, status=?, updated_at=NOW()
     WHERE id=? AND org_id=?`,
    [title, body, JSON.stringify(photos), JSON.stringify(photoCrops), JSON.stringify(targets),
     b.orgWide !== undefined ? b.orgWide === true : ex.org_wide,
     b.status !== undefined ? (b.status === "draft" ? "draft" : "published") : ex.status,
     req.params.id, req.user.orgId]);
  // Removed/replaced photos leave no orphaned assets (cross-update refs kept).
  await pruneImpactAssets(req.user.orgId);
  if (b.photos !== undefined) {
    await recordAssetPointerHistory(req.user.orgId, "impact_update.photos", req.params.id,
      await impactPhotosHistoryValue(req.user.orgId, ex.photos), photos.length ? photos : null, req.user);
  }
  res.json((await query(`SELECT * FROM impact_updates WHERE id = ?`, [req.params.id]))[0]);
}));

// BUILD-54 §3 — the hub's engagement card: the portal's EXISTING quiet
// signals (portal_audit_log), aggregated org-side. No new tracking. `recent`
// includes only rows resolved to a real donor of THIS org (a bare
// link-request email from a stranger is never surfaced to staff).
app.get("/portal-engagement", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [countRows, recent] = await Promise.all([
    query(
      `SELECT action, COUNT(*)::int AS c FROM portal_audit_log
       WHERE org_id = ? AND created_at > NOW() - INTERVAL '30 days' GROUP BY action`, [orgId]),
    query(
      `SELECT pal.action, pal.created_at, d.name AS donor_name
       FROM portal_audit_log pal
       JOIN donors d ON d.id = pal.donor_id AND d.org_id = pal.org_id AND d.deleted_at IS NULL
       WHERE pal.org_id = ? AND pal.action IN
         ('session_created','dashboard_viewed','impact_view','receipt_downloaded',
          'recurring_cancel','recurring_pause','recurring_amount','recurring_resume')
       ORDER BY pal.created_at DESC LIMIT 12`, [orgId]),
  ]);
  res.json({
    counts: Object.fromEntries(countRows.map(r => [r.action, r.c])),
    recent: recent.map(r => ({ action: r.action, donorName: displayNameCase(r.donor_name), createdAt: r.created_at })),
  });
}));

app.delete("/impact-updates/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [ex] = await query(`SELECT photos FROM impact_updates WHERE id = ? AND org_id = ?`, [req.params.id, req.user.orgId]);
  const result = await run(`DELETE FROM impact_updates WHERE id = ? AND org_id = ?`, [req.params.id, req.user.orgId]);
  if (!result.changes) return res.status(404).json({ error: "not_found" });
  await pruneImpactAssets(req.user.orgId);
  await recordAssetPointerHistory(req.user.orgId, "impact_update.photos", req.params.id,
    await impactPhotosHistoryValue(req.user.orgId, ex?.photos), null, req.user);
  res.json({ ok: true });
}));

// Staff read of the portal audit trail (P-7 visibility).
app.get("/portal-audit", requireAuth, requireAdmin, wrap(async (req, res) => {
  res.json(await query(
    `SELECT * FROM portal_audit_log WHERE org_id = ? ORDER BY created_at DESC LIMIT 200`, [req.user.orgId]));
}));

// Consumer-surface brand string — placeholder pending the founder decision
// (GivingDashboard.jsx's header comment lists every place this lives).
const CONSUMER_BRAND = "Steward"; // consumer surface = plain Steward (go-live decision 2026-08-12; a rename is still one commit — GivingDashboard.jsx lists the places)
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// All of an account's verified emails (primary + verified aliases).
async function accountVerifiedEmails(accountId) {
  const a = await query(`SELECT email, email_verified_at FROM donor_accounts WHERE id = ?`, [accountId]);
  if (!a.length) return [];
  const out = a[0].email_verified_at ? [a[0].email] : [];
  const al = await query(`SELECT email FROM donor_account_aliases WHERE account_id = ? AND verified_at IS NOT NULL`, [accountId]);
  return out.concat(al.map(r => r.email));
}
async function linkDonorAccount(accountId) {
  let n = 0;
  for (const em of await accountVerifiedEmails(accountId)) n += await linkAccountEmail(accountId, em);
  return n;
}

// ── session helpers ────────────────────────────────────────────────────────
async function mintAccountSession(res, accountId, email, req) {
  const sessToken = crypto.randomBytes(32).toString("base64url");
  await run(
    `INSERT INTO portal_sessions (id,org_id,email,token_hash,expires_at,ip,donor_account_id)
     VALUES (?,NULL,?,?, NOW() + INTERVAL '30 days', ?, ?)`,
    ["psn_" + uuid().slice(0, 10), email, sha256hex(sessToken), (req && req.ip) || null, accountId]);
  setPortalCookie(res, sessToken, 30 * 24 * 3600);
}
async function revokeAccountSessions(accountId, exceptTokenHash) {
  await run(
    `UPDATE portal_sessions SET revoked_at = NOW()
     WHERE donor_account_id = ? AND revoked_at IS NULL ${exceptTokenHash ? "AND token_hash <> ?" : ""}`,
    exceptTokenHash ? [accountId, exceptTokenHash] : [accountId]);
}
function requireDonorAccount(req, res, next) {
  (async () => {
    if (!DONOR_ACCOUNTS_ENABLED) return res.status(404).json({ error: "Not found" });
    const raw = parsePortalCookies(req)[PORTAL_COOKIE];
    if (!raw || raw.length > 300) return res.status(401).json({ error: "account_auth" });
    const rows = await query(
      `SELECT * FROM portal_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()`,
      [sha256hex(raw)]);
    if (!rows.length || !rows[0].donor_account_id) return res.status(401).json({ error: "account_auth" });
    const acct = await query(`SELECT * FROM donor_accounts WHERE id = ?`, [rows[0].donor_account_id]);
    if (!acct.length) return res.status(401).json({ error: "account_auth" });
    req.donorAccount = acct[0];
    req.donorSession = rows[0];
    run(`UPDATE portal_sessions SET last_seen_at = NOW() WHERE id = ?`, [rows[0].id]).catch(() => {});
    next();
  })().catch(next);
}

// ── §1.1 signup — no enumeration anywhere (identical response + async work) ─
app.post("/account/signup", requireFlag(DONOR_ACCOUNTS_ENABLED), accountIpLimiter, accountEmailLimiter, wrap(async (req, res) => {
  const email = foldEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!EMAIL_RX.test(email) || email.length > 320) return res.status(400).json({ error: "That email doesn't look right" });
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: "Password must be at least 8 characters" });
  // Interim legal posture (go-live 2026-08-12): explicit consent to the Terms
  // + Privacy Policy is required and audit-recorded. INTERIM pages pending the
  // attorney pass (NEEDS-JONATHAN.md §7).
  if (req.body?.consent !== true) return res.status(400).json({ error: "consent_required", message: "Please agree to the Terms and Privacy Policy." });
  // Identical response whether or not the account exists (P-2 discipline).
  res.json({ received: true, message: "Check your email to verify your account." });
  (async () => {
    const existing = await query(`SELECT id, email_verified_at FROM donor_accounts WHERE email = ?`, [email]);
    if (existing.length) {
      await donorAudit(existing[0].id, email, "signup_existing", req);
      await sendDonorLifecycleEmail("signup_existing", email, `Your ${CONSUMER_BRAND} account`,
        consumerEmailHtml(`<p>Someone (hopefully you) tried to create a ${escHtmlWf(CONSUMER_BRAND)} account with this address — but you already have one.</p>
          <p>You can sign in at <a href="${publicAppUrl()}/giving">${publicAppUrl()}/giving</a>. Forgot your password? Use "Reset password" there. If this wasn't you, you can safely ignore this email.</p>`));
      return;
    }
    const id = "da_" + uuid().slice(0, 10);
    const token = crypto.randomBytes(32).toString("base64url");
    await run(
      `INSERT INTO donor_accounts (id,email,password_hash,verify_token_hash,verify_expires_at)
       VALUES (?,?,?,?, NOW() + INTERVAL '60 minutes')`,
      [id, email, bcrypt.hashSync(password, 12), sha256hex(token)]);
    await donorAudit(id, email, "signup", req, { consent: true, consentAt: new Date().toISOString() });
    const link = `${publicAppUrl()}/giving/verify#token=${token}`;
    await sendDonorLifecycleEmail("verify", email, `Verify your email — ${CONSUMER_BRAND}`,
      consumerEmailHtml(`<p>Welcome. Confirm this email address to see your giving in one place:</p>
        <p style="text-align:center;margin:28px 0;"><a href="${link}" style="background:#c9a84c;color:#0f1a12;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Verify my email</a></p>
        <p style="font-size:13px;color:#555;">This link works once and expires in 60 minutes. Each nonprofit sees only its own relationship with you — we never share your giving at one organization with another.</p>`));
  })().catch(e => console.error("[account] signup async failed:", e.message));
}));

// Verification is proof of email control — linking happens HERE, never before.
app.post("/account/verify", requireFlag(DONOR_ACCOUNTS_ENABLED), accountIpLimiter, wrap(async (req, res) => {
  const token = String(req.body?.token || "");
  if (!token || token.length > 300) return res.status(400).json({ error: "invalid_link" });
  const rows = await query(
    `UPDATE donor_accounts SET email_verified_at = NOW(), verify_token_hash = NULL, verify_expires_at = NULL
     WHERE verify_token_hash = ? AND verify_expires_at > NOW() AND email_verified_at IS NULL
     RETURNING id, email`, [sha256hex(token)]);
  if (!rows.length) return res.status(400).json({ error: "invalid_link", message: "That link has expired or was already used." });
  const acct = rows[0];
  await donorAudit(acct.id, acct.email, "email_verified", req);
  const linked = await linkAccountEmail(acct.id, acct.email);
  await mintAccountSession(res, acct.id, acct.email, req);
  res.json({ ok: true, linkedOrgs: linked });
}));

app.post("/account/login", requireFlag(DONOR_ACCOUNTS_ENABLED), accountIpLimiter, accountEmailLimiter, wrap(async (req, res) => {
  const email = foldEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const fail = () => res.status(401).json({ error: "invalid_credentials", message: "That email and password don't match." });
  if (!EMAIL_RX.test(email) || !password) return fail();
  const rows = await query(`SELECT * FROM donor_accounts WHERE email = ?`, [email]);
  // One generic failure for: unknown email, wrong password, passwordless
  // account, unverified email — never an enumeration oracle. The unverified
  // case quietly re-sends the verification email.
  if (!rows.length || !rows[0].password_hash || !bcrypt.compareSync(password, rows[0].password_hash)) {
    await donorAudit(rows[0]?.id || null, email, "login_failed", req);
    return fail();
  }
  const acct = rows[0];
  if (!acct.email_verified_at) {
    (async () => {
      const token = crypto.randomBytes(32).toString("base64url");
      await run(`UPDATE donor_accounts SET verify_token_hash=?, verify_expires_at=NOW()+INTERVAL '60 minutes' WHERE id=?`, [sha256hex(token), acct.id]);
      await sendDonorLifecycleEmail("verify", email, `Verify your email — ${CONSUMER_BRAND}`,
        consumerEmailHtml(`<p>Confirm this email address to sign in:</p>
          <p style="text-align:center;margin:28px 0;"><a href="${publicAppUrl()}/giving/verify#token=${token}" style="background:#c9a84c;color:#0f1a12;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Verify my email</a></p>`));
    })().catch(() => {});
    return fail();
  }
  await donorAudit(acct.id, email, "login", req);
  await mintAccountSession(res, acct.id, email, req);
  res.json({ ok: true });
}));

app.post("/account/logout", requireFlag(DONOR_ACCOUNTS_ENABLED), wrap(async (req, res) => {
  const raw = parsePortalCookies(req)[PORTAL_COOKIE];
  if (raw) await run(`UPDATE portal_sessions SET revoked_at = NOW() WHERE token_hash = ?`, [sha256hex(raw)]).catch(() => {});
  res.append("Set-Cookie", `${PORTAL_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
}));

// ── BUILD-49 — account sign-in link (the password-free alternate on /giving) ─
// Same discipline as the portal magic link + resets: identical response for
// known/unknown emails (work happens async), supersede-on-re-request, 15-min
// hash-at-rest single-use token, atomic consume. A verified alias signs in to
// the account it belongs to; an UNVERIFIED account quietly gets its
// verification email re-sent instead (mirrors the login route) — a sign-in
// link must never become an email-verification bypass.
app.post("/account/request-link", requireFlag(DONOR_ACCOUNTS_ENABLED), accountIpLimiter, accountEmailLimiter, wrap(async (req, res) => {
  const email = foldEmail(req.body?.email);
  res.json({ received: true, message: "If that address has an account, a sign-in link is on its way." });
  if (!EMAIL_RX.test(email)) return;
  (async () => {
    const accts = await query(
      `SELECT id, email, email_verified_at FROM donor_accounts WHERE email = ?
       UNION
       SELECT a.id, a.email, a.email_verified_at FROM donor_accounts a
         JOIN donor_account_aliases al ON al.account_id = a.id
       WHERE al.email = ? AND al.verified_at IS NOT NULL
       LIMIT 1`, [email, email]);
    if (!accts.length) { await donorAudit(null, email, "signin_link_unknown", req); return; }
    const acct = accts[0];
    if (!acct.email_verified_at) {
      const vtoken = crypto.randomBytes(32).toString("base64url");
      await run(`UPDATE donor_accounts SET verify_token_hash=?, verify_expires_at=NOW()+INTERVAL '60 minutes' WHERE id=?`, [sha256hex(vtoken), acct.id]);
      await sendDonorLifecycleEmail("verify", acct.email, `Verify your email — ${CONSUMER_BRAND}`,
        consumerEmailHtml(`<p>Confirm this email address to sign in:</p>
          <p style="text-align:center;margin:28px 0;"><a href="${publicAppUrl()}/giving/verify#token=${vtoken}" style="background:#c9a84c;color:#0f1a12;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Verify my email</a></p>`));
      return;
    }
    await run(`UPDATE donor_account_signin_links SET superseded_at = NOW() WHERE account_id = ? AND used_at IS NULL AND superseded_at IS NULL`, [acct.id]);
    const token = crypto.randomBytes(32).toString("base64url"); // 256-bit CSPRNG
    await run(
      `INSERT INTO donor_account_signin_links (id,account_id,token_hash,expires_at)
       VALUES (?,?,?, NOW() + INTERVAL '15 minutes')`,
      ["dsl_" + uuid().slice(0, 10), acct.id, sha256hex(token)]);
    await donorAudit(acct.id, email, "signin_link_requested", req);
    const link = `${publicAppUrl()}/giving/signin#token=${token}`; // fragment: never sent in a Referer
    await sendDonorLifecycleEmail("signin_link", email, `Your sign-in link — ${CONSUMER_BRAND}`,
      consumerEmailHtml(`<p>Here is your secure sign-in link for your giving account:</p>
        <p style="text-align:center;margin:28px 0;"><a href="${link}" style="background:#c9a84c;color:#0f1a12;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">See my giving</a></p>
        <p style="font-size:13px;color:#555;">This link works once and expires in 15 minutes. If you didn't request it, you can safely ignore this email.</p>`));
  })().catch(e => console.error("[account] signin-link request failed:", e.message));
}));

app.post("/account/link-verify", requireFlag(DONOR_ACCOUNTS_ENABLED), accountIpLimiter, wrap(async (req, res) => {
  const token = String(req.body?.token || "");
  if (!token || token.length > 300) return res.status(400).json({ error: "invalid_link" });
  // Atomic consume — wins exactly once even under a parallel replay.
  const rows = await query(
    `UPDATE donor_account_signin_links SET used_at = NOW()
     WHERE token_hash = ? AND used_at IS NULL AND superseded_at IS NULL AND expires_at > NOW()
     RETURNING account_id`, [sha256hex(token)]);
  if (!rows.length) return res.status(400).json({ error: "invalid_link", message: "That link has expired or was already used. Request a fresh one." });
  const accountId = rows[0].account_id;
  const [acct] = await query(`SELECT email FROM donor_accounts WHERE id = ?`, [accountId]);
  if (!acct) return res.status(400).json({ error: "invalid_link" });
  await donorAudit(accountId, acct.email, "login_link", req);
  await linkDonorAccount(accountId); // freshness pass, same as reset
  await mintAccountSession(res, accountId, acct.email, req);
  res.json({ ok: true });
}));

// ── §1.1 password reset (BUILD-37 §1 checklist) ────────────────────────────
app.post("/account/request-reset", requireFlag(DONOR_ACCOUNTS_ENABLED), accountIpLimiter, accountEmailLimiter, wrap(async (req, res) => {
  const email = foldEmail(req.body?.email);
  res.json({ received: true, message: "If that address has an account, a reset link is on its way." });
  if (!EMAIL_RX.test(email)) return;
  (async () => {
    const rows = await query(`SELECT id FROM donor_accounts WHERE email = ?`, [email]);
    if (!rows.length) return;
    const acct = rows[0];
    await run(`UPDATE donor_account_resets SET superseded_at = NOW() WHERE account_id = ? AND used_at IS NULL AND superseded_at IS NULL`, [acct.id]);
    const token = crypto.randomBytes(32).toString("base64url"); // 256-bit CSPRNG
    await run(
      `INSERT INTO donor_account_resets (id,account_id,token_hash,expires_at)
       VALUES (?,?,?, NOW() + INTERVAL '60 minutes')`,
      ["dar_" + uuid().slice(0, 10), acct.id, sha256hex(token)]);
    await donorAudit(acct.id, email, "reset_requested", req);
    await sendDonorLifecycleEmail("reset", email, `Reset your password — ${CONSUMER_BRAND}`,
      consumerEmailHtml(`<p>Set a new password for your giving account:</p>
        <p style="text-align:center;margin:28px 0;"><a href="${publicAppUrl()}/giving/reset#token=${token}" style="background:#c9a84c;color:#0f1a12;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Reset password</a></p>
        <p style="font-size:13px;color:#555;">This link works once and expires in 60 minutes. If you didn't request it, you can safely ignore this email.</p>`));
  })().catch(e => console.error("[account] reset request failed:", e.message));
}));

app.post("/account/reset", requireFlag(DONOR_ACCOUNTS_ENABLED), accountIpLimiter, wrap(async (req, res) => {
  const token = String(req.body?.token || "");
  const password = String(req.body?.password || "");
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!token || token.length > 300) return res.status(400).json({ error: "invalid_link" });
  const rows = await query(
    `UPDATE donor_account_resets SET used_at = NOW()
     WHERE token_hash = ? AND used_at IS NULL AND superseded_at IS NULL AND expires_at > NOW()
     RETURNING account_id`, [sha256hex(token)]);
  if (!rows.length) return res.status(400).json({ error: "invalid_link", message: "That link has expired or was already used." });
  const accountId = rows[0].account_id;
  // A reset by email-receipt is ALSO proof of email control — it verifies the
  // account (the BUILD-45 magic-link-only migration path: request a reset,
  // set a password, done).
  await run(
    `UPDATE donor_accounts SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW() WHERE id = ?`,
    [bcrypt.hashSync(password, 12), accountId]);
  // Invalidate every outstanding reset token AND every session (password change).
  await run(`UPDATE donor_account_resets SET superseded_at = NOW() WHERE account_id = ? AND used_at IS NULL AND superseded_at IS NULL`, [accountId]);
  await revokeAccountSessions(accountId, null);
  const [acct] = await query(`SELECT email FROM donor_accounts WHERE id = ?`, [accountId]);
  await donorAudit(accountId, acct?.email, "password_reset", req);
  await linkDonorAccount(accountId);
  await mintAccountSession(res, accountId, acct.email, req);
  res.json({ ok: true });
}));

app.post("/account/change-password", requireDonorAccount, wrap(async (req, res) => {
  const acct = req.donorAccount;
  const current = String(req.body?.current || "");
  const next = String(req.body?.next || "");
  if (next.length < 8 || next.length > 200) return res.status(400).json({ error: "Password must be at least 8 characters" });
  // An account with a password requires it; a passwordless (magic-link-era)
  // account may set one — the session itself is proof of email control.
  if (acct.password_hash && !bcrypt.compareSync(current, acct.password_hash)) {
    return res.status(401).json({ error: "invalid_credentials", message: "Current password is incorrect." });
  }
  await run(`UPDATE donor_accounts SET password_hash = ?, updated_at = NOW() WHERE id = ?`, [bcrypt.hashSync(next, 12), acct.id]);
  await revokeAccountSessions(acct.id, req.donorSession.token_hash); // every OTHER session dies
  await donorAudit(acct.id, acct.email, "password_changed", req);
  res.json({ ok: true });
}));

// ── §1.1 email change — confirmed at the OLD address first, then the new
// address must independently verify before it links anything.
app.post("/account/change-email", requireDonorAccount, accountIpLimiter, wrap(async (req, res) => {
  const acct = req.donorAccount;
  const newEmail = foldEmail(req.body?.email);
  if (!EMAIL_RX.test(newEmail) || newEmail.length > 320) return res.status(400).json({ error: "That email doesn't look right" });
  res.json({ received: true, message: "Check your CURRENT email address to confirm this change." });
  (async () => {
    const token = crypto.randomBytes(32).toString("base64url");
    await run(
      `UPDATE donor_accounts SET pending_email = ?, email_change_token_hash = ?, email_change_expires_at = NOW() + INTERVAL '60 minutes' WHERE id = ?`,
      [newEmail, sha256hex(token), acct.id]);
    await donorAudit(acct.id, acct.email, "email_change_requested", req, { to: newEmail });
    await sendDonorLifecycleEmail("email_change", acct.email, `Confirm your email change — ${CONSUMER_BRAND}`,
      consumerEmailHtml(`<p>You asked to change your account email to <strong>${escHtmlWf(newEmail)}</strong>. To confirm, use this link (sent to your CURRENT address on purpose):</p>
        <p style="text-align:center;margin:28px 0;"><a href="${publicAppUrl()}/giving/confirm-email#token=${token}" style="background:#c9a84c;color:#0f1a12;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Confirm change</a></p>
        <p style="font-size:13px;color:#555;">If this wasn't you, change your password now — this link expires in 60 minutes and works once.</p>`));
  })().catch(e => console.error("[account] email change failed:", e.message));
}));

app.post("/account/change-email/confirm", requireFlag(DONOR_ACCOUNTS_ENABLED), accountIpLimiter, wrap(async (req, res) => {
  const token = String(req.body?.token || "");
  if (!token || token.length > 300) return res.status(400).json({ error: "invalid_link" });
  const rows = await query(
    `SELECT id, email, pending_email FROM donor_accounts
     WHERE email_change_token_hash = ? AND email_change_expires_at > NOW()`, [sha256hex(token)]);
  if (!rows.length || !rows[0].pending_email) return res.status(400).json({ error: "invalid_link", message: "That link has expired or was already used." });
  const acct = rows[0];
  const taken = await query(
    `SELECT id FROM donor_accounts WHERE email = ? UNION SELECT account_id FROM donor_account_aliases WHERE email = ? AND verified_at IS NOT NULL`,
    [acct.pending_email, acct.pending_email]);
  if (taken.length) return res.status(400).json({ error: "email_taken", message: "That address is already in use on another account." });
  const verifyToken = crypto.randomBytes(32).toString("base64url");
  // The new email is NOT verified yet — links only after its own verification.
  await run(
    `UPDATE donor_accounts SET email = ?, pending_email = NULL, email_change_token_hash = NULL, email_change_expires_at = NULL,
       email_verified_at = NULL, verify_token_hash = ?, verify_expires_at = NOW() + INTERVAL '60 minutes', updated_at = NOW()
     WHERE id = ?`,
    [acct.pending_email, sha256hex(verifyToken), acct.id]);
  await revokeAccountSessions(acct.id, null); // email changed → every session dies
  await donorAudit(acct.id, acct.pending_email, "email_changed", req, { from: acct.email });
  await sendDonorLifecycleEmail("verify", acct.pending_email, `Verify your new email — ${CONSUMER_BRAND}`,
    consumerEmailHtml(`<p>Almost done — verify your new address to finish the change:</p>
      <p style="text-align:center;margin:28px 0;"><a href="${publicAppUrl()}/giving/verify#token=${verifyToken}" style="background:#c9a84c;color:#0f1a12;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Verify my email</a></p>`));
  res.json({ ok: true, message: "Confirmed. Now verify the new address from its own inbox." });
}));

// ── §1.2 aliases — proof of control of the ALIAS address, single-use, no
// enumeration, no cross-account claim (S-12).
app.post("/account/aliases", requireDonorAccount, accountIpLimiter, accountEmailLimiter, wrap(async (req, res) => {
  const acct = req.donorAccount;
  const email = foldEmail(req.body?.email);
  if (!EMAIL_RX.test(email) || email.length > 320) return res.status(400).json({ error: "That email doesn't look right" });
  res.json({ received: true, message: "Check that inbox for a confirmation link." });
  (async () => {
    const taken = await query(
      `SELECT id FROM donor_accounts WHERE email = ? UNION SELECT account_id FROM donor_account_aliases WHERE email = ? AND verified_at IS NOT NULL`,
      [email, email]);
    if (taken.length && !(taken.length === 1 && taken[0].id === acct.id)) {
      await donorAudit(acct.id, email, "alias_conflict", req);
      return; // identical outward response — no oracle for "someone else owns this"
    }
    const token = crypto.randomBytes(32).toString("base64url");
    await run(
      `INSERT INTO donor_account_aliases (id,account_id,email,token_hash,token_expires_at)
       VALUES (?,?,?,?, NOW() + INTERVAL '60 minutes')
       ON CONFLICT (account_id,email) DO UPDATE SET token_hash = EXCLUDED.token_hash, token_expires_at = EXCLUDED.token_expires_at`,
      ["dal_" + uuid().slice(0, 10), acct.id, email, sha256hex(token)]);
    await donorAudit(acct.id, email, "alias_requested", req);
    await sendDonorLifecycleEmail("alias", email, `Confirm this email — ${CONSUMER_BRAND}`,
      consumerEmailHtml(`<p>Confirm that this address is yours to see the giving recorded under it in your dashboard:</p>
        <p style="text-align:center;margin:28px 0;"><a href="${publicAppUrl()}/giving/confirm-alias#token=${token}" style="background:#c9a84c;color:#0f1a12;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;display:inline-block;">Yes, this is my email</a></p>
        <p style="font-size:13px;color:#555;">This link works once and expires in 60 minutes. If you didn't request it, ignore this email — nothing will be linked.</p>`));
  })().catch(e => console.error("[account] alias request failed:", e.message));
}));

app.post("/account/aliases/verify", requireFlag(DONOR_ACCOUNTS_ENABLED), accountIpLimiter, wrap(async (req, res) => {
  const token = String(req.body?.token || "");
  if (!token || token.length > 300) return res.status(400).json({ error: "invalid_link" });
  // Atomic single-use consume; the partial-unique index on verified emails is
  // the last line against a cross-account race.
  const rows = await query(
    `UPDATE donor_account_aliases SET verified_at = NOW(), token_hash = NULL, token_expires_at = NULL
     WHERE token_hash = ? AND token_expires_at > NOW() AND verified_at IS NULL
     RETURNING id, account_id, email`, [sha256hex(token)]).catch(() => []);
  if (!rows.length) return res.status(400).json({ error: "invalid_link", message: "That link has expired or was already used." });
  const al = rows[0];
  await donorAudit(al.account_id, al.email, "alias_verified", req);
  const linked = await linkAccountEmail(al.account_id, al.email);
  res.json({ ok: true, linkedOrgs: linked });
}));

app.delete("/account/aliases/:id", requireDonorAccount, wrap(async (req, res) => {
  const r = await run(`DELETE FROM donor_account_aliases WHERE id = ? AND account_id = ?`, [req.params.id, req.donorAccount.id]);
  if (!r.changes) return res.status(404).json({ error: "not_found" });
  await donorAudit(req.donorAccount.id, req.donorAccount.email, "alias_removed", req, { aliasId: req.params.id });
  res.json({ ok: true });
}));

// ── §1.2 unlink / relink — donor-initiated, immediate, audit-rowed ─────────
app.post("/account/links/:id/unlink", requireDonorAccount, wrap(async (req, res) => {
  const r = await query(
    `UPDATE donor_account_links SET unlinked_at = NOW()
     WHERE id = ? AND account_id = ? AND unlinked_at IS NULL RETURNING org_id`, [req.params.id, req.donorAccount.id]);
  if (!r.length) return res.status(404).json({ error: "not_found" });
  await donorAudit(req.donorAccount.id, req.donorAccount.email, "unlinked", req, { orgId: r[0].org_id });
  res.json({ ok: true });
}));
app.post("/account/links/:id/relink", requireDonorAccount, wrap(async (req, res) => {
  const r = await query(
    `UPDATE donor_account_links SET unlinked_at = NULL
     WHERE id = ? AND account_id = ? AND unlinked_at IS NOT NULL RETURNING org_id`, [req.params.id, req.donorAccount.id]);
  if (!r.length) return res.status(404).json({ error: "not_found" });
  await donorAudit(req.donorAccount.id, req.donorAccount.email, "relinked", req, { orgId: r[0].org_id });
  res.json({ ok: true });
}));

// ── account deletion — links + account PII gone; each org's own donor
// records untouched (their data about their donor is theirs).
app.delete("/account", requireDonorAccount, wrap(async (req, res) => {
  const acct = req.donorAccount;
  await revokeAccountSessions(acct.id, null);
  await donorAudit(acct.id, null, "account_deleted", req);
  await run(`UPDATE donor_account_audit SET email = NULL WHERE account_id = ?`, [acct.id]); // PII scrub, trail kept
  await run(`DELETE FROM donor_accounts WHERE id = ?`, [acct.id]); // CASCADE: aliases, links, resets
  res.append("Set-Cookie", `${PORTAL_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
}));

// ── §2 the dashboard — read-time aggregation, donor's eyes only ────────────
// No cross-org rollup is ever stored; every figure is a live SUM over the same
// per-org ledgers the org portal reads. Display filter: linked AND listed.
app.get("/account/me", requireDonorAccount, wrap(async (req, res) => {
  const acct = req.donorAccount;
  await linkDonorAccount(acct.id); // lazy idempotent re-link (freshness)
  const aliases = await query(`SELECT id, email, verified_at FROM donor_account_aliases WHERE account_id = ? ORDER BY created_at`, [acct.id]);
  const links = await query(
    `SELECT l.id, l.org_id, l.donor_id, l.via_email, l.unlinked_at, o.name AS org_name, o.org_slug,
            ps.network_listed, ps.display_name, ps.primary_color, ps.accent_color, COALESCE(ps.logo_url, ps.logo_data) AS logo_data
     FROM donor_account_links l
     JOIN orgs o ON o.id = l.org_id
     JOIN portal_settings ps ON ps.org_id = l.org_id AND ps.enabled = true
     WHERE l.account_id = ?`, [acct.id]);
  // BUILD-47: follows the account manages (an org with any link row renders
  // through the link, so those follows are informational here).
  const follows = await query(
    `SELECT f.id, f.org_id, o.org_slug, COALESCE(ps.display_name, o.name) AS name
     FROM donor_org_follows f
     JOIN orgs o ON o.id = f.org_id
     JOIN portal_settings ps ON ps.org_id = f.org_id AND ps.enabled = true AND ps.network_listed = true
     WHERE f.account_id = ? ORDER BY f.created_at DESC`, [acct.id]);
  const linkedOrgIds = new Set(links.map(l => l.org_id));
  res.json({
    brand: CONSUMER_BRAND,
    email: acct.email,
    verified: !!acct.email_verified_at,
    hasPassword: !!acct.password_hash,
    aliases: aliases.map(a => ({ id: a.id, email: a.email, verified: !!a.verified_at })),
    links: links.map(l => ({
      id: l.id, orgSlug: l.org_slug, orgName: displayNameCase(l.display_name || l.org_name),
      viaEmail: l.via_email, unlinked: !!l.unlinked_at, listed: l.network_listed === true,
      accent: l.accent_color || null, primary: l.primary_color || null, logo: l.logo_data || null,
    })),
    follows: follows.map(f => ({
      id: f.id, orgSlug: f.org_slug, orgName: displayNameCase(f.name), converted: linkedOrgIds.has(f.org_id),
    })),
  });
}));

app.get("/account/dashboard", requireDonorAccount, wrap(async (req, res) => {
  const acct = req.donorAccount;
  await linkDonorAccount(acct.id);
  const links = await query(
    `SELECT l.org_id, l.donor_id, l.via_email, o.name AS org_name, o.org_slug,
            ps.display_name, ps.primary_color, ps.accent_color, COALESCE(ps.logo_url, ps.logo_data) AS logo_data,
            COALESCE(ps.header_image_url, ps.header_image_data) AS header_image_data, ps.background_tint, ps.button_color,
            ps.type_pairing, ps.card_style, ps.footer_text, ps.ein_line, ps.contact_email
     FROM donor_account_links l
     JOIN orgs o ON o.id = l.org_id
     JOIN portal_settings ps ON ps.org_id = l.org_id AND ps.enabled = true AND ps.network_listed = true
     WHERE l.account_id = ? AND l.unlinked_at IS NULL`, [acct.id]);
  const nowYear = String(new Date().getFullYear());
  const byOrg = new Map(); // org_id → { donorIds, meta }
  for (const l of links) {
    if (!byOrg.has(l.org_id)) byOrg.set(l.org_id, { donorIds: [], meta: l });
    byOrg.get(l.org_id).donorIds.push(l.donor_id);
  }
  const orgCards = [];
  let totalYtd = 0, totalLifetime = 0;
  const impactMerged = [];
  // BUILD-54 §1 — this was the FINDINGS-flagged N+1: 4 sequential queries per
  // linked org on every dashboard view. Donor ids are globally unique (one
  // org each), so one GROUP BY org_id over the full donor-id list is exactly
  // the per-org loop's result; impact matching and the follows read join the
  // same parallel batch.
  const allOrgIds = [...byOrg.keys()];
  const allDonorIds = links.map(l => l.donor_id);
  const [aggRows, recRows, impactPerOrg, followRows] = await Promise.all([
    allOrgIds.length ? query(
      `SELECT org_id, COALESCE(SUM(amount),0) AS lifetime,
              COALESCE(SUM(amount) FILTER (WHERE LEFT(date,4) = ?),0) AS ytd,
              MAX(date) AS last_gift
       FROM gifts WHERE org_id = ANY(?) AND donor_id = ANY(?) GROUP BY org_id`,
      [nowYear, allOrgIds, allDonorIds]) : Promise.resolve([]),
    allOrgIds.length ? query(
      `SELECT org_id, COUNT(*)::int n FROM recurring_subscriptions
       WHERE org_id = ANY(?) AND donor_id = ANY(?) AND status IN ('active','past_due','recovering','recovered','paused')
       GROUP BY org_id`,
      [allOrgIds, allDonorIds]) : Promise.resolve([]),
    Promise.all(allOrgIds.map(orgId => matchImpactUpdates(orgId, byOrg.get(orgId).donorIds))),
    query(
      `SELECT f.id, f.org_id, o.org_slug, COALESCE(ps.display_name, o.name) AS name,
              COALESCE(ps.logo_url, ps.logo_data) AS logo_data, ps.primary_color, ps.accent_color, ps.directory_description,
              COALESCE(ps.header_image_url, ps.header_image_data) AS header_image_data, ps.background_tint, ps.button_color,
              ps.type_pairing, ps.card_style, ps.footer_text, ps.ein_line, ps.contact_email
       FROM donor_org_follows f
       JOIN orgs o ON o.id = f.org_id
       JOIN portal_settings ps ON ps.org_id = f.org_id AND ps.enabled = true AND ps.network_listed = true
       WHERE f.account_id = ?
         AND NOT EXISTS (SELECT 1 FROM donor_account_links l WHERE l.account_id = f.account_id AND l.org_id = f.org_id)
       ORDER BY f.created_at DESC`, [acct.id]),
  ]);
  const aggByOrg = new Map(aggRows.map(r => [r.org_id, r]));
  const recByOrg = new Map(recRows.map(r => [r.org_id, r.n]));
  let orgIdx = 0;
  for (const [orgId, { meta }] of byOrg) {
    const t = aggByOrg.get(orgId) || { lifetime: 0, ytd: 0, last_gift: null };
    const card = {
      orgSlug: meta.org_slug,
      orgName: displayNameCase(meta.display_name || meta.org_name),
      primary: meta.primary_color || null, accent: meta.accent_color || null, logo: meta.logo_data || null,
      // BUILD-48 — the full presentation theme, for the single-org TAKEOVER
      // and the multi-org card's own theming (banner, card style, fonts).
      // Same donor-eyes-only surface; nothing here is org-side-visible.
      theme: {
        ...portalCardTheme(meta),
        headerImage: meta.header_image_data || null,
        logo: meta.logo_data || null,
        displayName: displayNameCase(meta.display_name || meta.org_name),
        footerText: meta.footer_text || null,
        einLine: meta.ein_line || null,
        contactEmail: meta.contact_email || null,
      },
      ytd: parseFloat(t.ytd) || 0, lifetime: parseFloat(t.lifetime) || 0,
      lastGiftDate: t.last_gift || null, recurringCount: recByOrg.get(orgId) || 0,
    };
    totalYtd += card.ytd; totalLifetime += card.lifetime;
    orgCards.push(card);
    for (const u of impactPerOrg[orgIdx++]) impactMerged.push({ ...u, orgSlug: meta.org_slug, orgName: card.orgName, logo: card.logo });
  }
  orgCards.sort((a, b) => b.ytd - a.ytd || b.lifetime - a.lifetime);
  // BUILD-47 followed cards — display precedence: an org with ANY link row is
  // excluded here (an active link renders with full history above; an
  // unlinked row means the donor hid the org, and a follow must not
  // resurface it). A followed card carries NO history figures at all — no $0
  // rows pretending to be history — just identity, the give path, and
  // org-wide impact updates.
  const followedCards = [];
  // Org-wide impact updates only — a follow has no gift attribution to match
  // against, and must never borrow anyone else's. Fetched in parallel.
  const followImpact = await Promise.all(followRows.map(f => matchImpactUpdates(f.org_id, [])));
  let followIdx = 0;
  for (const f of followRows) {
    followedCards.push({
      followId: f.id, orgSlug: f.org_slug, orgName: displayNameCase(f.name),
      primary: f.primary_color || null, accent: f.accent_color || null, logo: f.logo_data || null,
      description: f.directory_description || null,
      // BUILD-48 — identity theming only; a follow still carries ZERO history.
      theme: {
        ...portalCardTheme(f),
        headerImage: f.header_image_data || null,
        logo: f.logo_data || null,
        displayName: displayNameCase(f.name),
        footerText: f.footer_text || null,
        einLine: f.ein_line || null,
        contactEmail: f.contact_email || null,
      },
    });
    for (const u of followImpact[followIdx++]) impactMerged.push({ ...u, orgSlug: f.org_slug, orgName: displayNameCase(f.name), logo: f.logo_data || null });
  }
  // BUILD-62 Part 5 — DEDUP the donor's impact feed. An org can publish two
  // updates with the SAME title — e.g. one TARGETED to a fund the donor gave to
  // (which carries a photo) and one ORG-WIDE (photoless) — and matchImpactUpdates
  // returns both, so the same story rendered TWICE on the donor's home surface:
  // once with the photograph, once photoless. Collapse by (org, normalized
  // title), keeping the richest entry — a photo'd one beats a photoless one,
  // then a matched (targeted) one, then the most recent.
  const normImpactTitle = t => String(t || "").trim().toLowerCase().replace(/\s+/g, " ");
  const impactScore = u => ((u.photos && u.photos.length) ? 2 : 0) + (u.matched ? 1 : 0);
  const impactBest = new Map();
  for (const u of impactMerged) {
    const key = `${u.orgSlug}::${normImpactTitle(u.title)}`;
    const prev = impactBest.get(key);
    if (!prev
      || impactScore(u) > impactScore(prev)
      || (impactScore(u) === impactScore(prev) && new Date(u.date) > new Date(prev.date))) {
      impactBest.set(key, u);
    }
  }
  const impactDeduped = [...impactBest.values()];
  // Millisecond-precision newest-first: String(Date) stringifies at SECOND
  // precision, so a string sort tie-broke same-second updates arbitrarily and
  // the deterministic-order assertion caught it on CI (2026-08-12).
  impactDeduped.sort((a, b) => new Date(b.date) - new Date(a.date));
  await donorAudit(acct.id, acct.email, "dashboard_viewed", req);
  res.json({
    brand: CONSUMER_BRAND,
    totals: { ytd: totalYtd, lifetime: totalLifetime, orgCount: orgCards.length },
    orgs: orgCards,
    followed: followedCards,
    impact: impactDeduped.slice(0, 20),
  });
}));

app.get("/account/recurring", requireDonorAccount, wrap(async (req, res) => {
  const acct = req.donorAccount;
  const rows = await query(
    `SELECT rs.id, rs.org_id, rs.amount, rs.interval, rs.status, rs.paused_at, rs.resume_at, rs.canceled_at,
            o.org_slug, COALESCE(ps.display_name, o.name) AS org_name
     FROM recurring_subscriptions rs
     JOIN donor_account_links l ON l.org_id = rs.org_id AND l.donor_id = rs.donor_id
       AND l.account_id = ? AND l.unlinked_at IS NULL
     JOIN orgs o ON o.id = rs.org_id
     JOIN portal_settings ps ON ps.org_id = rs.org_id AND ps.enabled = true AND ps.network_listed = true
     ORDER BY rs.created_at DESC`, [acct.id]);
  res.json({
    recurring: rows.map(r => ({
      id: r.id, orgSlug: r.org_slug, orgName: displayNameCase(r.org_name),
      amount: parseFloat(r.amount) || 0, interval: r.interval || "month", status: r.status,
      pausedAt: r.paused_at, resumeAt: r.resume_at, canceledAt: r.canceled_at,
    })),
  });
}));

// Tax-summary: per-year totals per org + receipt pointers. "For your records —
// consult your tax preparer" — nothing tax-specific beyond ledger totals.
app.get("/account/tax-summary", requireDonorAccount, wrap(async (req, res) => {
  const acct = req.donorAccount;
  const rows = await query(
    `SELECT LEFT(g.date,4) AS year, g.org_id, o.org_slug, COALESCE(ps.display_name, o.name) AS org_name,
            SUM(g.amount) AS total, COUNT(*)::int AS gifts
     FROM gifts g
     JOIN donor_account_links l ON l.org_id = g.org_id AND l.donor_id = g.donor_id
       AND l.account_id = ? AND l.unlinked_at IS NULL
     JOIN orgs o ON o.id = g.org_id
     JOIN portal_settings ps ON ps.org_id = g.org_id AND ps.enabled = true AND ps.network_listed = true
     GROUP BY LEFT(g.date,4), g.org_id, o.org_slug, org_name
     ORDER BY year DESC, total DESC`, [acct.id]);
  const receipts = await query(
    `SELECT r.id, r.org_id, r.type, r.receipt_number, r.amount, r.tax_year, r.created_at, o.org_slug
     FROM receipts r
     JOIN donor_account_links l ON l.org_id = r.org_id AND l.donor_id = r.donor_id
       AND l.account_id = ? AND l.unlinked_at IS NULL
     JOIN orgs o ON o.id = r.org_id
     JOIN portal_settings ps ON ps.org_id = r.org_id AND ps.enabled = true AND ps.network_listed = true
     WHERE r.voided_at IS NULL ORDER BY r.created_at DESC LIMIT 300`, [acct.id]);
  res.json({
    note: "For your records — consult your tax preparer.",
    years: rows.map(r => ({ year: r.year, orgSlug: r.org_slug, orgName: displayNameCase(r.org_name), total: parseFloat(r.total) || 0, gifts: r.gifts })),
    receipts: receipts.map(r => ({ id: r.id, orgSlug: r.org_slug, type: r.type, number: r.receipt_number, amount: parseFloat(r.amount) || 0, taxYear: r.tax_year, date: r.created_at })),
  });
}));

app.get("/network/directory", requireDonorAccount, directorySearchLimiter, wrap(async (req, res) => {
  const qRaw = String(req.query.q || "").trim().slice(0, 120);
  const page = Math.min(200, Math.max(0, parseInt(req.query.page, 10) || 0));
  const pageSize = 20;
  if (qRaw.length < 2) return res.json({ results: [], total: 0, page: 0, pageSize });
  const like = "%" + qRaw.toLowerCase().replace(/[\\%_]/g, "\\$&") + "%";
  const einQ = qRaw.replace(/\D/g, "");
  // EIN search is exact-9-digit only — no prefix probing of the registry.
  const einClause = einQ.length === 9 ? "OR REGEXP_REPLACE(COALESCE(o.ein,''),'\\D','','g') = ?" : "";
  const params = [like, like, like];
  if (einClause) params.push(einQ);
  const rows = await query(
    `SELECT o.org_slug, o.id AS org_id,
            COALESCE(ps.display_name, o.name) AS name,
            ps.directory_description, ps.directory_city, ps.directory_state,
            COALESCE(ps.logo_url, ps.logo_data) AS logo_data, ps.primary_color, ps.accent_color,
            COUNT(*) OVER() AS total
     FROM portal_settings ps
     JOIN orgs o ON o.id = ps.org_id
     WHERE ps.enabled = true AND ps.network_listed = true
       AND (LOWER(COALESCE(ps.display_name, o.name)) LIKE ? ESCAPE '\\'
            OR LOWER(COALESCE(ps.directory_city,'')) LIKE ? ESCAPE '\\'
            OR LOWER(COALESCE(ps.directory_state,'')) LIKE ? ESCAPE '\\'
            ${einClause})
     ORDER BY COALESCE(ps.display_name, o.name), o.org_slug
     LIMIT ${pageSize} OFFSET ${page * pageSize}`, params);
  // Annotate with the CALLER'S OWN state only (their links/follows) so the
  // client can label "In your dashboard" / "Following" — donor's data, no
  // one else's.
  const orgIds = rows.map(r => r.org_id);
  const mine = orgIds.length ? await query(
    `SELECT org_id, 'link' AS kind FROM donor_account_links WHERE account_id = ? AND org_id = ANY(?) AND unlinked_at IS NULL
     UNION SELECT org_id, 'follow' AS kind FROM donor_org_follows WHERE account_id = ? AND org_id = ANY(?)`,
    [req.donorAccount.id, orgIds, req.donorAccount.id, orgIds]) : [];
  const linked = new Set(mine.filter(m => m.kind === "link").map(m => m.org_id));
  const followed = new Set(mine.filter(m => m.kind === "follow").map(m => m.org_id));
  res.json({
    total: rows.length ? parseInt(rows[0].total, 10) : 0, page, pageSize,
    results: rows.map(r => ({
      orgSlug: r.org_slug,
      name: displayNameCase(r.name),
      city: r.directory_city || null, state: r.directory_state || null,
      description: r.directory_description || null,
      logo: r.logo_data || null, primary: r.primary_color || null, accent: r.accent_color || null,
      linked: linked.has(r.org_id), followed: followed.has(r.org_id) && !linked.has(r.org_id),
    })),
  });
}));

// The add flow — exactly three outcomes, decided server-side, ONE code path:
//   1. a verified email matches a donor record there → the existing link job
//      creates the link; the dashboard shows full history.
//   2. no match → the follow row is what remains; the dashboard shows a
//      followed card with zero history.
//   3. (later) any verified email match — alias verify runs the same link
//      job — converts the follow to a link automatically via display
//      precedence.
// Every branch does the same work and returns the same body — no timing or
// shape oracle for "we found a record under another email".
app.post("/account/orgs/add", requireDonorAccount, addOrgLimiter, wrap(async (req, res) => {
  const acct = req.donorAccount;
  const slug = String(req.body?.orgSlug || "").slice(0, 120);
  const [org] = await query(
    `SELECT o.id, o.org_slug FROM orgs o
     JOIN portal_settings ps ON ps.org_id = o.id AND ps.enabled = true AND ps.network_listed = true
     WHERE o.org_slug = ?`, [slug]);
  if (!org) return res.status(404).json({ error: "not_found" });
  await run(
    `INSERT INTO donor_org_follows (id,account_id,org_id) VALUES (?,?,?)
     ON CONFLICT (account_id, org_id) DO NOTHING`,
    ["dof_" + uuid().slice(0, 10), acct.id, org.id]);
  // An explicit re-add of an org the donor previously hid is donor-initiated
  // — the one sanctioned relink outside the /links/:id/relink route.
  const relinked = await query(
    `UPDATE donor_account_links SET unlinked_at = NULL
     WHERE account_id = ? AND org_id = ? AND unlinked_at IS NOT NULL RETURNING id`, [acct.id, org.id]);
  // The existing idempotent link job — the same lazy pass every dashboard
  // read runs; a verified-email match links, no match is a strict no-op.
  await linkDonorAccount(acct.id);
  await donorAudit(acct.id, acct.email, "org_added", req, { orgId: org.id, relinked: relinked.length > 0 });
  res.json({ ok: true });
}));

// Unfollow — remove the card. Audit-rowed, zero org-side effect (the row is
// dashboard-side state; no org table is touched).
app.delete("/account/follows/:id", requireDonorAccount, wrap(async (req, res) => {
  const r = await query(
    `DELETE FROM donor_org_follows WHERE id = ? AND account_id = ? RETURNING org_id`,
    [req.params.id, req.donorAccount.id]);
  if (!r.length) return res.status(404).json({ error: "not_found" });
  await donorAudit(req.donorAccount.id, req.donorAccount.email, "unfollowed", req, { orgId: r[0].org_id });
  res.json({ ok: true });
}));

// ═══ §3 — nonprofit self-serve signup, GATED ═══════════════════════════════
const einDigits = (raw) => String(raw || "").replace(/\D/g, "").slice(0, 9); // registry stores digits-only (distinct from receipts' XX-XXXXXXX normalizeEin)
// Informational name-similarity for the review screen — token overlap only,
// NEVER an auto-approve signal (nothing auto-approves in v1).
function einNameScore(a, b) {
  const toks = s => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2));
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return Math.round((hit / Math.min(A.size, B.size)) * 100);
}

app.get("/network/config", (req, res) => {
  // Non-secret feature-flag booleans for the client surfaces.
  res.json({ donorAccounts: DONOR_ACCOUNTS_ENABLED, networkSignup: NETWORK_SIGNUP_ENABLED });
});

app.post("/network/signup", requireFlag(NETWORK_SIGNUP_ENABLED), networkSignupLimiter, wrap(async (req, res) => {
  const { orgName, ein: rawEin, email, password, website } = req.body || {};
  const name = String(orgName || "").trim().slice(0, 200);
  const ein = einDigits(rawEin);
  const em = foldEmail(email);
  if (!name || !EMAIL_RX.test(em) || String(password || "").length < 8) return res.status(400).json({ error: "Name, email, and a password of 8+ characters are required" });
  if (ein.length !== 9) return res.status(400).json({ error: "EIN must be 9 digits" });
  if (req.body?.consent !== true) return res.status(400).json({ error: "consent_required", message: "Please agree to the Terms and Privacy Policy." });
  const existingUser = await query(`SELECT id FROM users WHERE email = ?`, [em]);
  if (existingUser.length) return res.status(409).json({ error: "email_in_use", message: "That email already has a Steward login." });

  const einResult = await einLookup(ein);
  const emailDomain = em.split("@")[1] || "";
  const siteDomain = String(website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  const domainCheck = {
    emailDomain, websiteDomain: siteDomain || null,
    plausible: !!siteDomain && (emailDomain === siteDomain || emailDomain.endsWith("." + siteDomain) || siteDomain.endsWith("." + emailDomain)),
    freeMail: ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com"].includes(emailDomain),
  };

  // S-15: a second signup on a claimed EIN becomes a DISPUTE row that touches
  // nothing about the existing holder — never a duplicate listing, and the
  // dispute can only ever be resolved by a human in the review queue.
  const einHolder = await query(
    `SELECT id, org_id, status FROM network_applications WHERE ein = ? AND status IN ('pending','approved','held') LIMIT 1`, [ein]);

  const orgId = "org_" + uuid().slice(0, 8);
  const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";
  const orgSlug = `${slugBase}-${uuid().slice(0, 4)}`;
  await run(
    `INSERT INTO orgs (id, name, org_slug, plan, subscription_status, onboarding_complete, ein, emails_enabled)
     VALUES (?,?,?,?,?,1,?,false)`,
    [orgId, name, orgSlug, "portal", "active", ein]);
  // BUILD-58 W-3: /network/signup mints onboarding_complete=1 and never runs
  // the onboarding step that used to (incidentally) provision the chart of
  // accounts — the exact hole the BUILD-57 walk found. Provision at birth.
  await ensureOrgLedger(orgId).catch(e => console.error("[network] ledger provisioning:", e.message));
  const userId = "user_" + uuid().slice(0, 8);
  await run(
    `INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES (?,?,?,?,?,'admin')`,
    [userId, orgId, em, bcrypt.hashSync(String(password), 12), name + " admin"]);
  // Portal row exists but DISABLED + unlisted: an unapproved org is invisible
  // and un-giftable on every route (S-14) until a human approves.
  await run(
    `INSERT INTO portal_settings (org_id, enabled, network_listed, display_name) VALUES (?, false, false, ?)
     ON CONFLICT (org_id) DO NOTHING`, [orgId, name]);
  const appId = "napp_" + uuid().slice(0, 8);
  const status = einHolder.length ? "dispute" : "pending";
  const decision = [{ at: new Date().toISOString(), by: "system", action: "created", consent: true, detail: einHolder.length ? `EIN already claimed by ${einHolder[0].org_id} — routed to dispute queue` : "application created" }];
  await run(
    `INSERT INTO network_applications (id, org_id, ein, status, ein_result, domain_check, website, disputed_org_id, decisions)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [appId, orgId, ein, status, JSON.stringify({ ...einResult, nameScore: einResult.found ? einNameScore(name, einResult.name) : null }),
     JSON.stringify(domainCheck), String(website || "").slice(0, 300) || null,
     einHolder[0]?.org_id || null, JSON.stringify(decision)]);

  // Same staff JWT the normal login mints — the org admin proceeds to Stripe
  // Connect onboarding from Settings; the listing stays gated regardless.
  const token = signToken({ userId, orgId, email: em, role: "admin" });
  res.status(201).json({
    token,
    user: { id: userId, email: em, role: "admin", orgId },
    org: { id: orgId, name, org_slug: orgSlug, plan: "portal" },
    application: { id: appId, status },
    nextSteps: ["Complete Stripe onboarding (Settings → Giving)", "We verify your EIN against the IRS list", "A human reviews and approves your listing"],
  });
}));

// The org's own gate checklist (staff view of where they stand).
app.get("/network/application", requireAuth, wrap(async (req, res) => {
  const [appRow] = await query(`SELECT * FROM network_applications WHERE org_id = ?`, [req.user.orgId]);
  if (!appRow) return res.status(404).json({ error: "not_found" });
  const [org] = await query(`SELECT stripe_account_id, stripe_connected FROM orgs WHERE id = ?`, [req.user.orgId]);
  // W-1: show the org the TRUTH from Stripe (charges_enabled), not the
  // link-created flag; null = Stripe unreachable right now.
  const chk = await stripeChargesEnabled(org?.stripe_account_id);
  res.json({
    status: appRow.status, ein: appRow.ein, einResult: appRow.ein_result, domainCheck: appRow.domain_check,
    stripeConnected: !!(org?.stripe_connected && org?.stripe_account_id),
    chargesEnabled: chk.definitive ? chk.ok : null,
    website: appRow.website,
  });
}));
}

module.exports = { routers, mount };
