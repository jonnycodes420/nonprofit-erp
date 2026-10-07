// tests/email1-brand-render.test.js · EMAIL-1's one test. ONE BRAND, AND A REAL EMAIL.
//
//     Changing the brand colour ONCE (PUT /portal-settings) changes it on a
//     giving page (its public payload) and on an email template (its
//     preview), because both read the one brand at render time. A campaign
//     started from that template and sent through the real send path reaches
//     the provider with the org's address footer, exactly one unsubscribe
//     link, no footer slot left behind, and alt text on every image; a
//     template with a photo that has no alt text refuses the whole send and
//     nothing reaches the provider.
//
// Email: a donor email with no unsubscribe link or no postal address breaks
// the law the footer exists for, and an image with no alt text is a message
// that says nothing to a screen reader or a blocked-images inbox.
//
// It stands in for Resend on SINK_PORT, as email-footer does.
//
// HOW IT WOULD GO RED (proven before it was trusted, see the build report):
//   · the send path skipping the footer slot → §2 "address footer" / "one unsubscribe";
//   · renderEmail letting a missing alt through → §3 "nothing was sent".

const http = require("http");
const { ok, summary, api, SINK_PORT, q, closeDb } = require("./helpers");

const captured = [];
const mock = http.createServer((req, res) => {
  let body = ""; req.on("data", c => (body += c));
  req.on("end", () => {
    try { captured.push({ path: req.url, body: body ? JSON.parse(body) : null }); } catch { /* not JSON */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});
const JPEG = "data:image/jpeg;base64," + require("fs").readFileSync(require("path").join(__dirname, "..", "scripts", "demo-assets", "demo-impact-studio.jpg")).toString("base64");

async function sendAndWait(tok, id) {
  const r = await api("POST", `/campaigns/${id}/send`, tok);
  for (let i = 0; i < 30 && r.status < 300; i++) {
    await new Promise(res => setTimeout(res, 500));
    const rows = await api("GET", "/campaigns", tok);
    if ((rows.body.find?.(x => x.id === id) || {}).status === "sent") break;
  }
  return r;
}

(async () => {
  await new Promise((res, rej) => { mock.on("error", rej); mock.listen(SINK_PORT, res); });
  const stamp = Date.now();
  const reg = await api("POST", "/auth/register-org", null, { orgName: "Email One Brand Org", userName: "Brand Tester", email: `email1-${stamp}@example.com`, password: "loadtest1234" });
  if (!reg.body.token) throw new Error("register-org failed: " + reg.text);
  const tok = reg.body.token, orgId = reg.body.org.id;
  await q("UPDATE orgs SET emails_enabled=true, onboarded_at=NOW() WHERE id=$1", [orgId]);
  await new Promise(res => setTimeout(res, 5100));   // the 5s mail-gate cache the signup filled
  await api("POST", "/onboarding/complete", tok);
  await api("PATCH", `/orgs/${orgId}`, tok, { legalName: "Email One Brand Org Inc.", receiptAddress: "9 Quay Street\nSalem, MA 01970" });
  const [{ org_slug: slug }] = await q("SELECT org_slug FROM orgs WHERE id=$1", [orgId]);

  // ── §1 · one brand change, two surfaces ─────────────────────────────────
  console.log("\n§1 one brand");
  await api("PUT", "/portal-settings", tok, { enabled: true, primaryColor: "#2A6F97", primary_color: "#2A6F97" });
  const gp = await api("POST", "/giving-pages", tok, { title: "Brand page" });
  const tplRes = await api("POST", "/email-templates", tok, { starterKey: "thank_you" });
  const tpl = { status: tplRes.status, body: tplRes.body.template || tplRes.body };
  ok("§1 a giving page and an email template exist", gp.status === 201 && (tpl.status === 201 || tpl.status === 200) && tpl.body.id, [gp.status, tpl.status, tpl.body]);
  const pagePrimary = async () => (((await api("GET", `/org/${slug}/giving-page/${gp.body.slug}/public`, null)).body.org || {}).theme || {}).primary;
  const emailHtml = async () => (await api("POST", `/email-templates/${tpl.body.id}/preview`, tok, { device: "desktop" })).body.html || "";
  ok("§1 before: both carry the first colour", /#2a6f97/i.test(await pagePrimary()) && /#2a6f97/i.test(await emailHtml()), await pagePrimary());
  await api("PUT", "/portal-settings", tok, { primaryColor: "#7A3B69", primary_color: "#7A3B69" });
  const after = await emailHtml();
  ok("§1 after ONE change: the giving page follows", /#7a3b69/i.test(await pagePrimary()), await pagePrimary());
  ok("§1 after ONE change: the email follows", /#7a3b69/i.test(after) && !/#2a6f97/i.test(after), after.slice(0, 300));

  // ── §2 · a real send: footer, one unsubscribe, alt on every image ──────
  console.log("\n§2 a real send");
  const photo = await api("POST", "/media/photos", tok, { file: JPEG, title: "A photo", alt: "Students on the dock at sunset" });
  ok("§2 a photo with alt text is in the library", photo.status === 201 || photo.status === 200, photo.body);
  const purl = photo.body.url || (photo.body.item && photo.body.item.url);
  const mine = tpl.body;
  const withPhoto = [...(mine.blocks || []).map(b => (b.type === "hero" || b.type === "image") ? { ...b, image: purl, alt: "Students on the dock at sunset" } : b),
    { type: "image", image: purl, alt: "Students on the dock at sunset", caption: "" }];
  const put = await api("PUT", `/email-templates/${tpl.body.id}`, tok, { blocks: withPhoto });
  ok("§2 the template saved with its photos", put.status === 200, put.body);
  const donorEmail = `email1-donor-${stamp}@example.com`;
  await api("POST", "/donors", tok, { name: "Rosa Delgado", email: donorEmail });
  const camp = await api("POST", "/campaigns/from-template", tok, { templateId: tpl.body.id, name: "Brand send" });
  ok("§2 a campaign started from the template", (camp.status === 201 || camp.status === 200) && camp.body.id, camp.body);
  await api("PUT", `/campaigns/${camp.body.id}`, tok, { name: "Brand send", subject: camp.body.subject || "Thank you", segment: { mode: "all" } });
  await sendAndWait(tok, camp.body.id);
  const sent = captured.find(e => e.path === "/emails" && (e.body?.to === donorEmail || e.body?.to?.includes?.(donorEmail)));
  const html = (sent && sent.body.html) || "";
  ok("§2 the email reached the provider", !!sent, captured.map(c => c.path));
  ok("§2 it carries the address footer", /Email One Brand Org Inc\. · 9 Quay Street, Salem, MA 01970/.test(html), html.slice(-500));
  ok("§2 exactly one unsubscribe link, and no footer slot left behind", (html.match(/Unsubscribe<\/a>/g) || []).length === 1 && !html.includes("<!--steward:footer-->"));
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  ok("§2 every image has alt text (the open pixel may be empty, nothing else)", imgs.length >= 2 && imgs.every(t => /\balt="[^"]*"/i.test(t))
    && imgs.filter(t => !/\/track\//.test(t)).every(t => /\balt="[^"]+"/i.test(t)), imgs);
  ok("§2 it is in the brand colour", /#7a3b69/i.test(html));

  // ── §3 · a missing alt refuses the whole send ────────────────────────────
  console.log("\n§3 refused");
  const tpl2r = await api("POST", "/email-templates", tok, { copyOf: tpl.body.id });
  const tpl2 = { body: tpl2r.body.template || tpl2r.body };
  await api("PUT", `/email-templates/${tpl2.body.id}`, tok, { blocks: [...withPhoto, { type: "image", image: purl, alt: "", caption: "" }] });
  const camp2 = await api("POST", "/campaigns/from-template", tok, { templateId: tpl2.body.id, name: "No alt send" });
  await api("PUT", `/campaigns/${camp2.body.id}`, tok, { name: "No alt send", subject: "Thank you", segment: { mode: "all" } });
  const before = captured.length;
  const refused = await api("POST", `/campaigns/${camp2.body.id}/send`, tok);
  await new Promise(res => setTimeout(res, 3000));
  ok("§3 a photo without alt text refuses the send, in words", refused.status === 400 && /alt|describe|not ready/i.test(JSON.stringify(refused.body)), refused.body);
  ok("§3 nothing was sent", captured.length === before, captured.slice(before).map(c => c.path));

  // ── §4 · FIX-30: the one-person emails and campaign starters open here ───
  // A receipt opened in this editor carries its tax lines as a locked block a
  // save cannot drop or change; its saved words go back to the store every
  // draft reads, so the draft made after the save holds them; a campaign
  // starter opens as blocks in the org's own name.
  // How it goes red: drop the write-back in PUT /email-templates/:id → "the
  // draft holds the words"; drop missingLocked → "refused without its tax lines".
  console.log("\n§4 the bridge");
  const rc = await api("POST", "/email-templates", tok, { starterKey: "person_receipt" });
  const receipt = rc.body.template || {};
  ok("§4 the receipt opens as an email template", rc.status === 201 && receipt.personKind === "receipt", rc.body);
  ok("§4 its tax lines are a locked block", (receipt.blocks || []).some(b => b.locked && JSON.stringify(b.blocks).includes("{{tax_language}}")), receipt.blocks);
  ok("§4 its fields are the one-person fields", (receipt.mergeFields || []).some(f => f.token === "{{gift_amount}}"), receipt.mergeFields);
  const again = await api("POST", "/email-templates", tok, { starterKey: "person_receipt" });
  ok("§4 opening it again opens the same one", again.status === 200 && again.body.template.id === receipt.id, again.body);
  const pv = await api("POST", `/email-templates/${receipt.id}/preview`, tok, { device: "desktop" });
  ok("§4 the preview fills the tax lines and knows every field", /tax-exempt|Email One Brand Org Inc/i.test(pv.body.html || "") && !(pv.body.problems || []).some(p => /not a field/.test(p)), pv.body.problems);
  const noTax = (receipt.blocks || []).filter(b => !b.locked);
  const r1 = await api("PUT", `/email-templates/${receipt.id}`, tok, { blocks: noTax });
  ok("§4 a save without its tax lines is refused", r1.status === 400 && r1.body.error === "locked_block", r1.body);
  const changedTax = (receipt.blocks || []).map(b => (b.locked ? { ...b, blocks: [{ type: "p", text: "No tax lines here." }] } : b));
  const r2 = await api("PUT", `/email-templates/${receipt.id}`, tok, { blocks: changedTax });
  ok("§4 a save that rewrites the tax lines is refused", r2.status === 400 && r2.body.error === "locked_block", r2.body);
  const r3 = await api("PUT", `/email-templates/${receipt.id}`, tok, { blocks: (receipt.blocks || []).map(b => (b.type === "richtext" && !b.locked && /Dear/.test(JSON.stringify(b)) ? { ...b, blocks: [{ type: "p", text: "Hello {{first_name}}, the bridge words for {{gift_amount}}." }] } : b)) });
  ok("§4 a save with its tax lines goes through", r3.status === 200, r3.body);
  const r4 = await api("PUT", `/email-templates/${receipt.id}`, tok, { subject: "Your receipt", blocks: [...(r3.body.template || receipt).blocks, { type: "richtext", blocks: [{ type: "p", text: "{{last_gift_date}}" }] }] });
  ok("§4 a field a draft cannot fill is refused", r4.status === 400 && r4.body.error === "unknown_fields", r4.body);
  const [mt] = await q("SELECT subject, body, reviewed_at FROM message_templates WHERE org_id=$1 AND kind='receipt'", [orgId]);
  ok("§4 the saved words are the receipt's words, reviewed", mt && /the bridge words/.test(mt.body) && mt.body.includes("{{tax_language}}") && mt.reviewed_at, mt);
  const lib = await api("GET", "/templates", tok);
  ok("§4 the old library reads it as reviewed", (lib.body.templates || []).find(t => t.kind === "receipt").reviewed === true);
  const [rosa] = await q("SELECT id FROM donors WHERE org_id=$1 AND email=$2", [orgId, donorEmail]);
  await api("POST", `/donors/${rosa.id}/gifts`, tok, { amount: 120, date: "2026-09-01", type: "one-time" });
  await api("PUT", "/brand-kit", tok, { signatureName: "Brand Tester" });
  const dr = await api("POST", "/templates/receipt/draft", tok, { donorId: rosa.id });
  const [draft] = await q("SELECT body FROM milestone_drafts WHERE id=$1", [dr.body.draftId || ""]);
  ok("§4 the draft holds the words saved in this editor", dr.status === 201 && draft && /the bridge words for \$120/.test(draft.body), [dr.status, dr.body, draft]);
  const cp = await api("POST", "/email-templates", tok, { copyOf: receipt.id });
  ok("§4 a one-person email is not copied", cp.status === 409, cp.body);
  const asCampaign = await api("POST", "/campaigns/from-template", tok, { templateId: receipt.id, name: "Receipt to all" });
  ok("§4 a one-person email cannot become a campaign", asCampaign.status === 404, asCampaign.body);
  const ap = await api("POST", "/email-templates", tok, { starterKey: "campaign_appeal" });
  const appeal = ap.body.template || {};
  ok("§4 a campaign starter opens as blocks in the org's name", ap.status === 201 && (appeal.blocks || []).some(b => b.type === "richtext" && /Email One Brand Org/.test(JSON.stringify(b))) && (appeal.blocks || []).some(b => b.type === "button"), appeal.blocks);
  const ac = await api("POST", "/campaigns/from-template", tok, { templateId: appeal.id, name: "Bridged appeal" });
  ok("§4 and starts a campaign", ac.status === 201, ac.body);

  for (const t of ["campaign_recipients", "campaigns", "email_templates", "media_items", "giving_pages", "interactions", "milestone_drafts", "message_templates"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [orgId]).catch(() => {});
  mock.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); ok("the suite ran to the end", false, e.message); mock.close(); await closeDb().catch(() => {}); summary(); });
