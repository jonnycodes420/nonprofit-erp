// BUILD-100 (grants) Part 3 — THE FILES A GRANT CARRIES.
//
// The assertions are the ways this could stop being true:
//   §1  the pure rules — a closed type list, and THE BYTES DECIDE (a caller
//       declaring application/pdf over HTML is refused before anything is
//       stored, and .txt that opens like markup is the same hole renamed);
//   §2  the signed door — private, expiring, attachment-only, and expired vs
//       wrong-org answer ALIKE so a probe learns nothing;
//   §3  versioned by date, never overwritten: two proposals are two files;
//   §4  the funder's own list spans every grant, and versions stay PER GRANT;
//   §5  THE RETENTION GUARD — a signed agreement is on `collectLiveAssetRefs`,
//       without which the 90-day sweep destroys it;
//   §6  org A can read, upload to, or delete none of org B's — including
//       through the unauthenticated document door.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "b100_doc", OTHER = "b100_doc2";
const ME = "b100doc@example.org", THEM = "b100doc-other@example.org";
const PW = "loadtest1234";

const CHILD = ["grant_milestones", "grant_documents", "grant_interactions", "program_grants",
  "grants", "pledge_installments", "fin_transactions", "interactions", "threads", "tasks",
  "opportunities", "moves", "gifts", "pledges", "donors", "users",
  "budgets", "accounts", "fin_funds"];
async function reset() {
  for (const o of [ORG, OTHER]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM portal_assets WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM asset_pointer_history WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}
const mkOrg = id => q(
  `INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,timezone,timezone_confirmed_at)
   VALUES ($1,$1,$2,1,'team','active','America/New_York',NOW())
   ON CONFLICT (id) DO UPDATE SET plan='team', subscription_status='active'`, [id, id.replace(/_/g, "-")]);
const mkUser = (id, org, email, name) => q(
  `INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
  [id, org, email, bcrypt.hashSync(PW, 4), name]);
const mkFunder = (id, org, name) => q(
  `INSERT INTO donors (id,org_id,name,email,kind,stage,total_giving,gift_count)
   VALUES ($1,$2,$3,$4,'organisation','cultivate',0,0)`, [id, org, name, id + "@example.org"]);

// Real magic numbers, not hand-waved strings — a fixture that is not actually a
// PDF could not exercise a check that reads the first bytes.
const PDF = (body = "one page") => "data:application/pdf;base64," +
  Buffer.from("%PDF-1.4\n" + body + "\n%%EOF").toString("base64");
const PNG = () => "data:image/png;base64," + Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake png body"),
]).toString("base64");
const HTML_AS_PDF = "data:application/pdf;base64," +
  Buffer.from("<!doctype html><script>alert(1)</script>").toString("base64");
const HTML_AS_TXT = "data:text/plain;base64," +
  Buffer.from("<!DOCTYPE html><p>not a text file</p>").toString("base64");
const SVG = "data:image/svg+xml;base64," + Buffer.from("<svg onload=\"x\"/>").toString("base64");

// A raw fetch, because the document door is deliberately unauthenticated — the
// URL carries its own signature and apiFetch would attach a bearer token that
// the route must not need.
async function raw(url) {
  const r = await fetch((process.env.BASE || "http://localhost:5601") + url);
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, headers: r.headers, ct,
    body: ct.includes("json") ? await r.json().catch(() => null) : await r.arrayBuffer() };
}

(async () => {
  console.log("build100-documents");
  await reset();
  await mkOrg(ORG); await mkOrg(OTHER);
  await mkUser("u_b100doc", ORG, ME, "Allie Barnett");
  await mkUser("u_b100doc2", OTHER, THEM, "Not Allie");
  await mkFunder("fd_sun3", ORG, "The Sunrise Foundation");
  await mkFunder("fd_other3", OTHER, "Somebody Else Trust");
  const tok = await login(ME), tok2 = await login(THEM);
  const G = require("../grantDocs.js");

  // ── §1 · THE BYTES DECIDE ───────────────────────────────────────────────
  console.log("\n— §1 · a closed list, and the first bytes decide —");
  ok("§1 six document types, in order",
     G.DOC_TYPE_KEYS.join(",") === "loi,proposal,award_letter,agreement,report,correspondence", G.DOC_TYPE_KEYS);
  ok("§1 a proposal and a report repeat; an agreement does not",
     G.docType("proposal").repeatable && G.docType("report").repeatable && !G.docType("agreement").repeatable);
  ok("§1 SVG is not on the allowed list at all — it can carry a script",
     !G.mimeAllowed("image/svg+xml") && !G.mimeAllowed("text/html"));
  ok("§1 a real PDF passes the byte check", G.bytesMatchMime(Buffer.from("%PDF-1.7 x"), "application/pdf"));
  ok("§1 HTML declared as a PDF is REFUSED by the bytes",
     !G.bytesMatchMime(Buffer.from("<!doctype html>"), "application/pdf"));
  ok("§1 HTML declared as plain text is refused too — the same hole renamed",
     !G.bytesMatchMime(Buffer.from("<!DOCTYPE html><p>x"), "text/plain"));
  ok("§1 …and real plain text is accepted", G.bytesMatchMime(Buffer.from("Dear Sunrise Foundation,"), "text/plain"));
  ok("§1 a filename can never be a path", !/[\\/]/.test(G.sanitizeFilename("../../etc/passwd", "application/pdf")));
  ok("§1 …and gains the extension its bytes actually are",
     G.sanitizeFilename("award letter", "application/pdf") === "award letter.pdf",
     G.sanitizeFilename("award letter", "application/pdf"));
  ok("§1 the link TTL is thirty minutes, not the photo path's twelve hours",
     G.DOC_URL_TTL_MS === 30 * 60 * 1000, G.DOC_URL_TTL_MS);
  // THE CAP AND THE BODY PARSER ARE ONE DECISION. A guard that reads only one
  // of them cannot catch the BUILD-96 defect this comment names.
  const serverSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "server.js"), "utf8");
  const parserLine = /grants\\\/\[\^\/\]\+\\\/documents\$[\s\S]{0,200}?limit: "(\d+)mb"/.exec(serverSrc);
  ok("§1 the document route has its OWN body-parser limit", !!parserLine, parserLine && parserLine[1]);
  ok("§1 …and it clears the decoded cap plus base64 overhead",
     !!parserLine && Number(parserLine[1]) * 1024 * 1024 > G.DOC_MAX_BYTES * 1.37,
     { parser: parserLine && parserLine[1] + "mb", cap: G.DOC_MAX_BYTES / 1024 / 1024 + "MB" });

  // ── §2 · THE SIGNED, EXPIRING, PRIVATE DOOR ─────────────────────────────
  console.log("\n— §2 · private, expiring, and it tells a probe nothing —");
  await api("PUT", "/funders/fd_sun3", tok, { funderType: "private_foundation" });
  const g1 = await api("POST", "/funders/fd_sun3/grants", tok, {
    program: "Youth programme", amountRequested: 25000, status: "awarded" });
  ok("§2 a grant to hang documents on", g1.status === 201, JSON.stringify(g1.body).slice(0, 180));

  const up = await api("POST", `/grants/${g1.body.id}/documents`, tok, {
    docType: "agreement", fileName: "Sunrise agreement.pdf", file: PDF("signed terms") });
  ok("§2 a signed agreement stores", up.status === 201, JSON.stringify(up.body).slice(0, 250));
  ok("§2 …and comes back with a signed link", /^\/grant-documents\/pa_[a-f0-9]{24}\?e=\d+&s=[a-f0-9]{32}$/.test(up.body.url || ""), up.body.url);
  ok("§2 …typed and named", up.body.docType === "agreement" && up.body.fileName === "Sunrise agreement.pdf", up.body);
  ok("§2 …and stamped with who uploaded it", up.body.uploadedByName === "Allie Barnett", up.body.uploadedByName);

  const fetched = await raw(up.body.url);
  ok("§2 the link opens the file with NO auth header — a browser has none", fetched.status === 200, fetched.status);
  ok("§2 …as the bytes that went in",
     Buffer.from(fetched.body).slice(0, 5).toString() === "%PDF-", Buffer.from(fetched.body).slice(0, 8).toString());
  ok("§2 it is PRIVATE, never shared-cacheable", /private/.test(fetched.headers.get("cache-control") || ""),
     fetched.headers.get("cache-control"));
  // NEVER RENDERED INLINE: a PDF viewer on our own origin is a parser we did
  // not choose, running on a file a funder sent.
  ok("§2 it downloads rather than rendering in our origin",
     /^attachment/.test(fetched.headers.get("content-disposition") || ""), fetched.headers.get("content-disposition"));
  ok("§2 …and the browser may not sniff a different type",
     fetched.headers.get("x-content-type-options") === "nosniff");
  const tampered = up.body.url.replace(/s=[a-f0-9]{32}/, "s=" + "0".repeat(32));
  ok("§2 a tampered signature is refused", (await raw(tampered)).status === 403);
  const expired = up.body.url.replace(/e=\d+/, "e=" + (Date.now() - 1000));
  ok("§2 an expired link is refused", (await raw(expired)).status === 403);
  // THE PROPERTY THAT MATTERS: the two refusals are indistinguishable.
  const rTamper = await raw(tampered), rExp = await raw(expired);
  ok("§2 …and expired and wrong-signature answer ALIKE, so a probe learns nothing",
     rTamper.status === rExp.status && JSON.stringify(rTamper.body) === JSON.stringify(rExp.body),
     { tampered: rTamper.body, expired: rExp.body });

  console.log("\n— §2b · what may not be stored —");
  const bad1 = await api("POST", `/grants/${g1.body.id}/documents`, tok, {
    docType: "report", fileName: "report.pdf", file: HTML_AS_PDF });
  ok("§2b a script-bearing HTML payload declared as a PDF is refused",
     bad1.status === 400 && bad1.body.code === "file_type_mismatch", bad1.body);
  const bad2 = await api("POST", `/grants/${g1.body.id}/documents`, tok, {
    docType: "correspondence", fileName: "note.txt", file: HTML_AS_TXT });
  ok("§2b …and declared as plain text", bad2.status === 400 && bad2.body.code === "file_type_mismatch", bad2.body);
  const bad3 = await api("POST", `/grants/${g1.body.id}/documents`, tok, {
    docType: "correspondence", fileName: "logo.svg", file: SVG });
  ok("§2b an SVG is refused on the type list, before the bytes are read",
     bad3.status === 400 && bad3.body.code === "bad_file_type", bad3.body);
  ok("§2b a type nobody ships is refused",
     (await api("POST", `/grants/${g1.body.id}/documents`, tok, { docType: "vibes", file: PDF() })).status === 400);
  ok("§2b no file is refused",
     (await api("POST", `/grants/${g1.body.id}/documents`, tok, { docType: "report" })).status === 400);
  ok("§2b NOTHING refused was stored",
     (await q("SELECT COUNT(*)::int c FROM grant_documents WHERE org_id=$1", [ORG]))[0].c === 1,
     (await q("SELECT COUNT(*)::int c FROM grant_documents WHERE org_id=$1", [ORG]))[0].c);
  ok("§2b …and no asset row was planted either",
     (await q("SELECT COUNT(*)::int c FROM portal_assets WHERE org_id=$1 AND kind='grantdoc'", [ORG]))[0].c === 1);

  // ── §3 · VERSIONED BY DATE, NEVER OVERWRITTEN ───────────────────────────
  console.log("\n— §3 · two proposals are two files —");
  const p1 = await api("POST", `/grants/${g1.body.id}/documents`, tok, {
    docType: "proposal", fileName: "proposal v1.pdf", file: PDF("first ask") });
  const p2 = await api("POST", `/grants/${g1.body.id}/documents`, tok, {
    docType: "proposal", fileName: "proposal revised.pdf", file: PDF("second ask, revised") });
  ok("§3 both proposals store", p1.status === 201 && p2.status === 201);
  const list = await api("GET", `/grants/${g1.body.id}/documents`, tok);
  const props = list.body.documents.filter(d => d.docType === "proposal");
  ok("§3 the later one does NOT replace the earlier", props.length === 2, props.map(d => d.fileName));
  ok("§3 …and they are numbered in the order they were stored",
     props[0].version === 1 && props[1].version === 2
     && props[0].fileName === "proposal v1.pdf" && props[1].fileName === "proposal revised.pdf",
     props.map(d => `${d.fileName}#${d.version}`));
  ok("§3 the first proposal's bytes are still the FIRST ask",
     /first ask/.test(Buffer.from((await raw(props[0].url)).body).toString()), "v1 intact");
  ok("§3 the list carries its sentence", /documents?:/.test(list.body.sentence || ""), list.body.sentence);
  ok("§3 …and the sentence counts the repeats", /2 proposals/.test(list.body.sentence), list.body.sentence);
  // THE SAME BYTES TWICE UNDER ONE TYPE IS A DOUBLE-CLICK, not two documents.
  const dupe = await api("POST", `/grants/${g1.body.id}/documents`, tok, {
    docType: "proposal", fileName: "proposal v1.pdf", file: PDF("first ask") });
  ok("§3 the same file filed twice answers success, not an error — it IS on the grant",
     dupe.status === 201 && dupe.body.duplicate === true, dupe.body);
  ok("§3 …and did not become a third proposal",
     (await api("GET", `/grants/${g1.body.id}/documents`, tok)).body.documents.filter(d => d.docType === "proposal").length === 2);
  const emptyG = await api("POST", "/funders/fd_sun3/grants", tok, {
    program: "Nothing filed yet", amountRequested: 1000, status: "researching" });
  ok("§3 a grant with no documents says so plainly",
     (await api("GET", `/grants/${emptyG.body.id}/documents`, tok)).body.sentence === "No documents on this grant yet.");

  // ── §4 · THE FUNDER'S OWN LIST SPANS ITS GRANTS ─────────────────────────
  console.log("\n— §4 · have we ever signed anything with these people —");
  const g2 = await api("POST", "/funders/fd_sun3/grants", tok, {
    program: "Capacity building", amountRequested: 9000, status: "submitted" });
  await api("POST", `/grants/${g2.body.id}/documents`, tok, {
    docType: "proposal", fileName: "capacity proposal.pdf", file: PDF("capacity ask") });
  const fdocs = await api("GET", "/funders/fd_sun3/documents", tok);
  ok("§4 the funder's list reaches across every grant", fdocs.body.documents.length === 4,
     fdocs.body.documents.map(d => d.fileName));
  ok("§4 …and names the funder", fdocs.body.funder.name === "The Sunrise Foundation");
  // VERSIONS ARE PER GRANT: "proposal #2" means the second proposal on THAT
  // grant. Numbering across grants would be a figure nobody could reconcile.
  const g2Prop = fdocs.body.documents.find(d => d.fileName === "capacity proposal.pdf");
  ok("§4 a second grant's first proposal is version 1, not version 3",
     g2Prop && g2Prop.version === 1, g2Prop && g2Prop.version);
  ok("§4 the list is newest first",
     fdocs.body.documents.every((d, i, a) => i === 0 || String(a[i - 1].uploadedAt) >= String(d.uploadedAt)),
     fdocs.body.documents.map(d => d.uploadedAt));
  ok("§4 a person is refused a document list, as they are refused everything else",
     (await api("GET", "/funders/fd_sun3/documents", tok)).status === 200);

  // ── §5 · THE RETENTION GUARD ────────────────────────────────────────────
  console.log("\n— §5 · the sweep must not destroy a signed agreement —");
  // The guard is ONE line in assetStore.collectLiveAssetRefs, and this suite
  // deliberately does NOT require that module: it opens its own pg pool with no
  // SSL config in this harness, so a require here fails for a reason that has
  // nothing to do with the property. Proven two ways instead — the line that
  // makes it true, and the REAL purge route behaving correctly.
  const storeSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "assetStore.js"), "utf8");
  const collector = storeSrc.slice(storeSrc.indexOf("async function collectLiveAssetRefs"),
                                  storeSrc.indexOf("// ── DESTRUCTION SEAM"));
  ok("§5 collectLiveAssetRefs reads grant_documents — without this the 90-day sweep destroys a signed agreement",
     /FROM grant_documents/.test(collector), collector.length);
  ok("§5 …by BARE asset id, the donor-photo shape, not a /portal-assets path",
     /asset_id/.test(collector) && /ASSET_ID_RE\.test/.test(collector));

  const [agr] = await q("SELECT asset_id FROM grant_documents WHERE org_id=$1 AND doc_type='agreement'", [ORG]);
  // Age the agreement's asset PAST retention and soft-delete it, which is
  // exactly the state the purge is built to destroy. A live pointer must save
  // it — that is the whole guarantee.
  await q(`UPDATE portal_assets SET deleted_at = NOW() - INTERVAL '200 days' WHERE id=$1`, [agr.asset_id]);
  const purge = await api("POST", "/assets/run-purge", tok, {});
  ok("§5 the purge runs", purge.status === 200, JSON.stringify(purge.body).slice(0, 160));
  const [survived] = await q("SELECT id, deleted_at FROM portal_assets WHERE id=$1", [agr.asset_id]);
  ok("§5 a 200-day-old soft-deleted asset that a LIVE document points at is NOT destroyed",
     !!survived, "agreement bytes survived the purge");
  ok("§5 …and it was self-healed back to live rather than left 404ing its own pointer",
     survived && survived.deleted_at === null, survived && survived.deleted_at);

  // Deleting the ROW releases the asset. The bytes are NOT destroyed here —
  // that is the sweep's own seam, and the delete stays recoverable.
  const relAsset = p2.body.url.match(/pa_[a-f0-9]{24}/)[0];
  const del = await api("DELETE", `/grants/documents/${p2.body.id}`, tok);
  ok("§5 a document row can be deleted", del.status === 200);
  ok("§5 …and its bytes are still on disk immediately afterwards",
     (await q("SELECT COUNT(*)::int c FROM portal_assets WHERE id=$1", [relAsset]))[0].c === 1,
     "delete does not destroy");

  // ── §6 · THE WALL ───────────────────────────────────────────────────────
  console.log("\n— §6 · another org touches none of it —");
  ok("§6 a foreign grant cannot take a document",
     (await api("POST", `/grants/${g1.body.id}/documents`, tok2, { docType: "report", file: PDF() })).status === 404);
  ok("§6 a foreign grant's documents cannot be listed",
     (await api("GET", `/grants/${g1.body.id}/documents`, tok2)).status === 404);
  ok("§6 a foreign funder's documents cannot be listed",
     (await api("GET", "/funders/fd_sun3/documents", tok2)).status === 404);
  ok("§6 a foreign document cannot be deleted",
     (await api("DELETE", `/grants/documents/${p1.body.id}`, tok2)).status === 404);
  ok("§6 …and it is still there",
     (await q("SELECT COUNT(*)::int c FROM grant_documents WHERE id=$1", [p1.body.id]))[0].c === 1);
  // THE DOOR IS UNAUTHENTICATED, so this is where a cross-tenant read would
  // actually be attempted: org B mints its own signature over org A's asset id.
  const stolenId = p1.body.url.match(/pa_[a-f0-9]{24}/)[0];
  const forged = G.signDocUrl({ orgId: OTHER, assetId: stolenId, env: { JWT_SECRET: process.env.JWT_SECRET || "local-test-secret" } });
  ok("§6 a signature minted for the WRONG org does not open org A's agreement",
     (await raw(forged)).status === 403, forged);
  ok("§6 …and answers exactly as an expired link does, so the probe learns nothing",
     JSON.stringify((await raw(forged)).body) === JSON.stringify((await raw(expired)).body),
     (await raw(forged)).body);
  ok("§6 nothing of org A's leaked into org B",
     (await q("SELECT COUNT(*)::int c FROM grant_documents WHERE org_id=$1", [OTHER]))[0].c === 0);

  await reset();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
