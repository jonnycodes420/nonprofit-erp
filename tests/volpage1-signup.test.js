// tests/volpage1-signup.test.js · VOL-PAGE-1's one test. A SIGN-UP THROUGH A
// PUBLISHED VOLUNTEER PAGE, AND ONE BRAND ACROSS THREE SURFACES.
//
//     A sign-up through the published page creates a person once, or matches
//     the one already there (WIRE-1 rule 1: never a second record for the same
//     email), books the shift through VOL-1's one booking path, moves the
//     shift's filled of needed, puts a full shift's next person on the waiting
//     list, lands on the person's timeline, and drafts (never sends) the
//     confirmation. A quote without its volunteer's permission never leaves
//     the server. One brand colour change shows on the volunteer page, a
//     giving page and an email.
//
// Donor data: a page a stranger can post to is the easiest way to fork a
// person into two records, or to let a full shift take one more.
//
// HOW IT WOULD GO RED (proven before it was trusted, see the build report):
//   · the sign-up inserting a person instead of matching → §2 "matched, not a
//     second record";
//   · a booking that skips signUp's capacity check → §3 "waiting list";
//   · the volunteer page reading a brand of its own → §5 "the volunteer page follows".

const { ok, summary, api, q, closeDb } = require("./helpers");

(async () => {
  const stamp = Date.now();
  const reg = await api("POST", "/auth/register-org", null, { orgName: "Volunteer Page Org", userName: "Page Tester", email: `volpage1-${stamp}@example.com`, password: "loadtest1234" });
  if (!reg.body.token) throw new Error("register-org failed: " + reg.text);
  const tok = reg.body.token, orgId = reg.body.org.id;
  await api("POST", "/onboarding/complete", tok);
  const [{ org_slug: slug }] = await q("SELECT org_slug FROM orgs WHERE id=$1", [orgId]);
  await api("PUT", "/portal-settings", tok, { enabled: true, primaryColor: "#2A6F97", primary_color: "#2A6F97" });

  // A public role with one shift of two places, three weeks out.
  const day = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);
  await q(`INSERT INTO volunteer_opportunities (id,org_id,name,slug,description,is_public,requires_waiver,commitment,skills,created_by,created_by_name)
           VALUES ($1,$2,'Food bank sort','food-bank-sort','Sorting donations into boxes.',TRUE,TRUE,'Three hours, once','None',$3,'test')`,
    [`vo_vp1_${stamp}`, orgId, "system:test"]);
  await q(`INSERT INTO volunteer_slots (id,org_id,opportunity_id,date,start_time,end_time,capacity,published,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,'09:00','12:00',2,TRUE,'system:test','test')`, [`vsl_vp1_${stamp}`, orgId, `vo_vp1_${stamp}`, day]);
  const slotId = `vsl_vp1_${stamp}`;
  const known = await api("POST", "/donors", tok, { name: "Ruth Calloway", email: `ruth.${stamp}@example.org` });
  ok("a donor already on file", known.status === 201 || known.status === 200, known.body);
  const knownId = known.body.id || (known.body.donor && known.body.donor.id);

  // ── §1 · the page, published ─────────────────────────────────────────────
  console.log("\n§1 the page");
  const page = await api("POST", "/giving-pages", tok, { title: "Help at the food bank", page_kind: "volunteer", template: "one_day" });
  ok("§1 a volunteer page is made from a template", page.status === 201 && page.body.page_kind === "volunteer" && (page.body.draft || []).some(w => w.type === "volsignup"), page.body);
  const draft = [...page.body.draft.filter(w => w.type !== "volquote"), { type: "volquote", text: "Best Saturday of my month.", name: "Not Yet Asked", permission: false }];
  const put = await api("PUT", `/giving-pages/${page.body.id}/page/draft`, tok, { widgets: draft });
  const pub = await api("POST", `/giving-pages/${page.body.id}/page/publish`, tok);
  ok("§1 saved and published", put.status === 200 && pub.status === 200, [put.body, pub.body]);
  const read = async () => (await api("GET", `/org/${slug}/volunteer-page/${page.body.slug}/public`, null)).body;
  const r0 = await read();
  const shift0 = (r0.data && r0.data.shifts || []).find(s => s.slotId === slotId);
  ok("§1 the public page shows the shift, 0 of 2 filled", shift0 && shift0.filled === 0 && shift0.needed === 2 && !shift0.full, shift0);
  ok("§1 a quote without permission never leaves the server", !JSON.stringify(r0.widgets || []).includes("Best Saturday"), (r0.widgets || []).map(w => w.type));
  const post = body => api("POST", `/org/${slug}/volunteer-page/${page.body.slug}/signup`, null, body);

  // ── §2 · a new person, and a person already on file ──────────────────────
  console.log("\n§2 one record per person");
  const newEmail = `new.helper.${stamp}@example.org`;
  const a = await post({ name: "Nadia Brightwater", email: newEmail, phone: "555-0100", availability: "Saturdays", interests: ["Food bank sort"], slotId });
  ok("§2 a new person is signed up", a.status === 201 && a.body.status === "confirmed", a.body);
  const [newRows] = await q(`SELECT COUNT(*)::int n, MIN(id) id, bool_and(person_types @> '["volunteer"]'::jsonb) vol FROM donors WHERE org_id=$1 AND lower(email)=lower($2)`, [orgId, newEmail]);
  ok("§2 …as exactly one record, carrying the Volunteer role", newRows.n === 1 && newRows.vol === true, newRows);
  const before = (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`, [orgId]))[0].n;
  const b = await post({ name: "Ruth Calloway", email: `RUTH.${stamp}@Example.org`, slotId });
  const after = (await q(`SELECT COUNT(*)::int n FROM donors WHERE org_id=$1`, [orgId]))[0].n;
  const [rb] = await q(`SELECT person_id FROM volunteer_signups WHERE org_id=$1 AND slot_id=$2 AND person_id=$3`, [orgId, slotId, knownId]);
  ok("§2 the donor on file is matched, not a second record", b.status === 201 && after === before && !!rb, { status: b.status, before, after, booked: !!rb });

  // ── §3 · filled of needed, and the waiting list ──────────────────────────
  console.log("\n§3 the shift");
  const shift1 = (await read()).data.shifts.find(s => s.slotId === slotId);
  ok("§3 filled of needed moved to 2 of 2, and the shift reads full", shift1.filled === 2 && shift1.full === true, shift1);
  const c = await post({ name: "Theo Marchetti", email: `theo.${stamp}@example.org`, slotId });
  ok("§3 the next person on a full shift joins the waiting list", c.status === 201 && c.body.status === "waitlisted" && c.body.position === 1, c.body);
  const again = await post({ name: "Nadia Brightwater", email: newEmail, slotId });
  const [{ n: nadiaBookings }] = await q(`SELECT COUNT(*)::int n FROM volunteer_signups WHERE org_id=$1 AND slot_id=$2 AND person_id=$3 AND status <> 'cancelled'`, [orgId, slotId, newRows.id]);
  ok("§3 signing up twice books once", again.body.already === true && nadiaBookings === 1, { again: again.body, nadiaBookings });

  // ── §4 · the timeline, the draft, the figures ────────────────────────────
  console.log("\n§4 where it lands");
  const tl = await q(`SELECT note FROM interactions WHERE org_id=$1 AND donor_id=$2 AND note LIKE 'Signed up on the volunteer page%'`, [orgId, newRows.id]);
  ok("§4 the sign-up is on the person's timeline once, with what they told us", tl.length === 1 && /Help at the food bank/.test(tl[0].note) && /Availability: Saturdays/.test(tl[0].note), tl);
  const [dr] = await q(`SELECT COUNT(*)::int n, bool_and(status='pending_review') pending FROM milestone_drafts WHERE org_id=$1 AND source='volunteer_confirm'`, [orgId]);
  ok("§4 the confirmation is a draft waiting for a person, not a send", dr.n === 2 && dr.pending === true, dr);
  const list = await api("GET", "/giving-pages", tok);
  const row = (list.body || []).find(p => p.id === page.body.id);
  const shifts = await api("GET", `/figures/volpage-shifts/rows?vpage=${page.body.id}`, tok);
  ok("§4 shifts filled from the page = 2, and it opens the same two rows", row && row.vol_shifts_filled === 2 && (shifts.body.rows || []).length === 2, { row: row && row.vol_shifts_filled, rows: (shifts.body.rows || []).length });

  // ── §5 · one brand, three surfaces ───────────────────────────────────────
  console.log("\n§5 one brand");
  const gp = await api("POST", "/giving-pages", tok, { title: "Brand giving page" });
  const tplRes = await api("POST", "/email-templates", tok, { starterKey: "person_volunteer_confirm" });
  const tpl = tplRes.body.template || tplRes.body;
  ok("§5 a giving page and the volunteer confirmation email exist", gp.status === 201 && (tplRes.status === 201 || tplRes.status === 200) && tpl.id, [gp.status, tplRes.status, tplRes.body]);
  await api("PUT", "/portal-settings", tok, { primaryColor: "#7A3B69", primary_color: "#7A3B69" });
  const volPrimary = ((await read()).theme || {}).primary;
  const givePrimary = (((await api("GET", `/org/${slug}/giving-page/${gp.body.slug}/public`, null)).body.org || {}).theme || {}).primary;
  const html = (await api("POST", `/email-templates/${tpl.id}/preview`, tok, { device: "desktop" })).body.html || "";
  ok("§5 after ONE change: the volunteer page follows", /#7a3b69/i.test(volPrimary || ""), volPrimary);
  ok("§5 …the giving page follows", /#7a3b69/i.test(givePrimary || ""), givePrimary);
  ok("§5 …and the email follows", /#7a3b69/i.test(html) && !/#2a6f97/i.test(html), html.slice(0, 200));
  ok("§5 a volunteer page is never a donation form", (await api("GET", `/org/${slug}/giving-page/${page.body.slug}/public`, null)).status === 404);
})().catch(e => ok("suite ran without throwing", false, e.stack))
  .finally(async () => { await closeDb(); summary(); });
