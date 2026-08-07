// Invitation pivot (2026-08-06) — POST /invitation-request contract.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// The public "Request an invitation" form (landing + /invitation). What must
// hold:
//   - a real submission stores a row (trimmed, capped) and returns {received}
//   - the two bot signals — honeypot filled, sub-3s fill time — return the
//     SAME success response but store NOTHING (never tip a bot off)
//   - missing name/email/organization → 400; malformed email → 400
//   - oversized fields are capped, not rejected (a long heartfelt answer to
//     "hardest part" must never bounce)
// The founder-notify email is fire-and-forget and not asserted here (no
// RESEND_API_KEY in the scratch stack — the stored row is the source of truth).

const { ok, summary, api, q } = require("./helpers");

const TAG = "invtest";
const mail = s => `${TAG}+${s}@example.org`;

async function reset() {
  await q(`DELETE FROM invitation_requests WHERE email LIKE $1`, [`${TAG}+%`]);
}
const rows = email => q(`SELECT * FROM invitation_requests WHERE email = $1`, [email]);

const base = {
  name: "Eleanor Fitzgerald",
  organization: "Creo Arts Collective",
  role: "Development Director",
  donorBand: "500–2,500",
  hardestPart: "Knowing who to call.",
  elapsedMs: 45000,
};

(async () => {
  await reset();

  // ── 1. A real submission stores a row and succeeds ──
  {
    const email = mail("real");
    const r = await api("POST", "/invitation-request", null, { ...base, email });
    ok("valid request → 200", r.status === 200, r);
    ok("valid request → {received:true}", r.body && r.body.received === true, r.body);
    const [row] = await rows(email);
    ok("row stored", !!row);
    ok("row carries name/org/role/band/hardest-part", row &&
      row.name === base.name && row.organization === base.organization &&
      row.role === base.role && row.donor_band === base.donorBand &&
      row.hardest_part === base.hardestPart, row);
  }

  // ── 2. Honeypot filled → same success shape, NOTHING stored ──
  {
    const email = mail("honeypot");
    const r = await api("POST", "/invitation-request", null, { ...base, email, website: "https://spam.example" });
    ok("honeypot request → 200 (indistinguishable from success)", r.status === 200 && r.body.received === true, r);
    ok("honeypot request stores NO row", (await rows(email)).length === 0);
  }

  // ── 3. Sub-3s fill → same success shape, NOTHING stored ──
  {
    const email = mail("toofast");
    const r = await api("POST", "/invitation-request", null, { ...base, email, elapsedMs: 850 });
    ok("sub-3s request → 200 (indistinguishable from success)", r.status === 200 && r.body.received === true, r);
    ok("sub-3s request stores NO row", (await rows(email)).length === 0);
  }

  // ── 4. Missing required fields → 400 ──
  for (const missing of ["name", "email", "organization"]) {
    const body = { ...base, email: mail("missing-" + missing) };
    delete body[missing];
    if (missing === "email") delete body.email;
    const r = await api("POST", "/invitation-request", null, body);
    ok(`missing ${missing} → 400`, r.status === 400, r);
  }

  // ── 5. Malformed email → 400, nothing stored ──
  {
    const r = await api("POST", "/invitation-request", null, { ...base, email: "not-an-email" });
    ok("malformed email → 400", r.status === 400, r);
  }

  // ── 6. Oversized optional field is capped, never rejected ──
  {
    const email = mail("long");
    const long = "x".repeat(5000);
    const r = await api("POST", "/invitation-request", null, { ...base, email, hardestPart: long });
    ok("oversized hardest-part → still 200", r.status === 200, r);
    const [row] = await rows(email);
    ok("hardest-part capped at 2000 chars", row && row.hardest_part.length === 2000, row && row.hardest_part.length);
  }

  // ── 7. Whitespace is trimmed ──
  {
    const email = mail("trim");
    const r = await api("POST", "/invitation-request", null, { ...base, name: "  Padded Name  ", email: `  ${email}  `, organization: "  Org  " });
    ok("padded request → 200", r.status === 200, r);
    const [row] = await rows(email);
    ok("name/email/org stored trimmed", row && row.name === "Padded Name" && row.organization === "Org", row);
  }

  // ── 8. Optional fields may be absent ──
  {
    const email = mail("minimal");
    const r = await api("POST", "/invitation-request", null, { name: "Min", email, organization: "Org", elapsedMs: 9000 });
    ok("minimal (name/email/org only) → 200", r.status === 200, r);
    const [row] = await rows(email);
    ok("optional fields stored NULL", row && row.role === null && row.donor_band === null && row.hardest_part === null, row);
  }

  await reset();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
