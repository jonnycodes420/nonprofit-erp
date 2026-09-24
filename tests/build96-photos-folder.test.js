// BUILD-96 Part 5 — A FOLDER OF PHOTOS, AND THE FACES IT REFUSES TO GUESS.
//
// She arrives with a folder of headshots off the old system. One at a time is
// not a feature for two hundred people.
//
// THE RULE THE WHOLE THING IS BUILT AROUND: a photo is attached only when the
// file name identifies EXACTLY ONE person — by email, then by legacy id, then
// by exact full name. Everything else comes back by file name with a picker.
//
// Why that is not over-caution: attaching a face to the wrong record is not an
// error anybody reviews. A photo that "worked" is never looked at again, so it
// stays wrong — on the profile, on the Thread row she reads at 7:40, and
// beside a gift. A photo that did not match costs one click.
//
// THE TEN FILES (the brief's own shape):
//   3 match by the three rules (email, legacy id, exact full name)
//   4 more match — accents, punctuation, a folder path, a second legacy id
//   2 are ambiguous and land in "needs you" — NOT attached to the first hit
//   1 is the wrong type and is refused BY NAME
//
// Plus the partial-name case, which is the one that feels safe and is not.
//
// Standard scratch stack (tests/README.md).

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_b96p", OTHER = "org_b96p2";
const ADMIN = "b96p-admin@example.org";
const OTHER_ADMIN = "b96p2-admin@example.org";

// A real 2×2 PNG — the route resizes with sharp, so the bytes have to decode.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYEJRIAAIhEBvQFrwQAAAABJRU5ErkJggg==";
const NOT_AN_IMAGE = "data:application/pdf;base64,JVBERi0xLjQK";

async function reset() {
  for (const o of [ORG, OTHER]) {
    await q(`DELETE FROM donors WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM users WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM fin_funds WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

const photoOf = async id =>
  ((await q(`SELECT photo_asset_id FROM donors WHERE id=$1`, [id]))[0] || {}).photo_asset_id || null;

(async () => {
  await reset();

  // ── the pure module first ────────────────────────────────────────────────
  console.log("\n— §1 · the matcher, on its own —");
  const pm = await import("../shared/photoMatch.js");

  const idx = pm.buildIndex([
    { id: "p1", name: "Margaret Whitfield", email: "mw@example.org", externalIds: ["00Q5f000004Xy"] },
    { id: "p2", name: "James Thorne", email: "jt1@example.org" },
    { id: "p3", name: "James Thorne", email: "jt2@example.org" },   // the same full name, twice
    { id: "p4", name: "José Peña", email: "jp@example.org" },
  ]);

  ok("email wins", pm.matchOne("mw@example.org.jpg", idx).person?.id === "p1");
  ok("...and it is recorded as the rule that decided", pm.matchOne("mw@example.org.jpg", idx).rule === "email");
  ok("legacy id matches", pm.matchOne("00Q5f000004Xy.png", idx).person?.id === "p1");
  ok("exact full name matches", pm.matchOne("Margaret Whitfield.jpeg", idx).person?.id === "p1");
  ok("a folder path is stripped to the file name",
     pm.matchOne("headshots/2019/mw@example.org.jpg", idx).person?.id === "p1");
  ok("accents and punctuation fold", pm.matchOne("Jose Pena.jpg", idx).person?.id === "p4");

  // THE ONE THAT MUST NOT WORK.
  ok("A PARTIAL NAME IS NOT A MATCH — even when only one person could be meant",
     pm.matchOne("Margaret.jpg", idx).status === "unmatched", pm.matchOne("Margaret.jpg", idx));
  ok("...nor a surname alone", pm.matchOne("Whitfield.jpg", idx).status === "unmatched");
  ok("...nor a name with something extra on it", pm.matchOne("Margaret Whitfield 2019.jpg", idx).status === "unmatched");

  // AMBIGUITY IS NOT A MATCH.
  const amb = pm.matchOne("James Thorne.jpg", idx);
  ok("two people with one name is AMBIGUOUS, not the first one found", amb.status === "ambiguous", amb);
  ok("...and both are offered", amb.candidates?.length === 2, amb.candidates);

  ok("a wrong type is refused by type", pm.matchOne("notes.pdf", idx).status === "bad_type");
  ok("a complete address that is nobody's does not then fall through to a name test",
     pm.matchOne("nobody@example.org.jpg", idx).status === "unmatched");

  ok("the sentence reads the way the brief wrote it",
     pm.photoReport({ attached: 41, needsYou: 6 }) === "41 photos attached, 6 need you.",
     pm.photoReport({ attached: 41, needsYou: 6 }));
  ok("...and says nothing about zero when nothing needs her",
     pm.photoReport({ attached: 41, needsYou: 0 }) === "41 photos attached.",
     pm.photoReport({ attached: 41, needsYou: 0 }));
  ok("...and counts one correctly", pm.photoReport({ attached: 1, needsYou: 1 }) === "1 photo attached, 1 needs you.",
     pm.photoReport({ attached: 1, needsYou: 1 }));

  // ── the route ────────────────────────────────────────────────────────────
  console.log("\n— §2 · ten files through the route —");

  const hash = bcrypt.hashSync("loadtest1234", 10);
  for (const [org, slug, email, uid] of [[ORG, "b96p", ADMIN, "u_b96p"], [OTHER, "b96p2", OTHER_ADMIN, "u_b96p2"]]) {
    await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan)
             VALUES ($1,$2,$3,1,'active','team')`, [org, "Org " + slug, slug]);
    await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
             VALUES ($1,$2,$3,$4,'Admin','admin')`, [uid, org, email, hash]);
  }

  const mk = (id, name, email, extId, extIds) =>
    q(`INSERT INTO donors (id,org_id,name,email,stage,external_donor_id,external_donor_ids)
       VALUES ($1,$2,$3,$4,'prospect',$5,$6)`,
      [id, ORG, name, email, extId || null, JSON.stringify(extIds || [])]);

  await mk("b96p_d1", "Margaret Whitfield", "mw@example.org", "00Q5f000004Xy");
  await mk("b96p_d2", "David Okonkwo",      "do@example.org", null, ["LEGACY-77"]);
  await mk("b96p_d3", "Patricia Hernandez", "ph@example.org");
  await mk("b96p_d4", "José Peña",          "jp@example.org");
  await mk("b96p_d5", "Robert O'Brien-Smith", "ro@example.org");
  await mk("b96p_d6", "James Thorne",       "jt1@example.org");
  await mk("b96p_d7", "James Thorne",       "jt2@example.org");   // ambiguous by name
  await mk("b96p_d8", "Linda Abramowitz",   "la@example.org");
  await mk("b96p_d9", "Linda Abramowitz",   "la2@example.org");   // ambiguous by name
  // A person in ANOTHER org, whose email appears in the folder. Must not match.
  await q(`INSERT INTO donors (id,org_id,name,email,stage)
           VALUES ('b96p_x1',$1,'Outsider Person','outsider@example.org','prospect')`, [OTHER]);

  const tok = await login(ADMIN);

  const files = [
    { fileName: "mw@example.org.jpg",           image: PNG },  // 1 · email
    { fileName: "00Q5f000004Xy.png",            image: PNG },  // 2 · legacy id
    { fileName: "Patricia Hernandez.jpeg",      image: PNG },  // 3 · exact full name
    { fileName: "LEGACY-77.jpg",                image: PNG },  // 4 · legacy id from the array
    { fileName: "Jose Pena.jpg",                image: PNG },  // 5 · accents fold
    { fileName: "Robert OBrien Smith.png",      image: PNG },  // 6 · punctuation folds
    { fileName: "headshots/2019/do@example.org.jpg", image: PNG }, // 7 · folder path
    { fileName: "James Thorne.jpg",             image: PNG },  // 8 · ambiguous
    { fileName: "Linda Abramowitz.png",         image: PNG },  // 9 · ambiguous
    { fileName: "donor list.pdf",               image: NOT_AN_IMAGE }, // 10 · wrong type
  ];

  const r = await api("POST", "/photos/bulk", tok, { files });
  ok("the route answers", r.status === 200, r.body);
  ok("SEVEN ATTACHED", r.body.attached === 7, { attached: r.body.attached, needsYou: r.body.needsYou });
  ok("THREE NEED HER", r.body.needsYou.length === 3, r.body.needsYou.map(n => n.fileName));
  ok("...and the sentence says both numbers",
     r.body.sentence === "7 photos attached, 3 need you.", r.body.sentence);

  for (const [id, why] of [["b96p_d1", "email"], ["b96p_d1", "legacy id"], ["b96p_d3", "full name"],
                           ["b96p_d2", "legacy id in the array / folder path"], ["b96p_d4", "accents"],
                           ["b96p_d5", "punctuation"]]) {
    ok(`${id} has a photo (${why})`, !!(await photoOf(id)));
  }

  const needed = Object.fromEntries(r.body.needsYou.map(n => [n.fileName, n]));
  ok("the two ambiguous names are handed back", !!needed["James Thorne.jpg"] && !!needed["Linda Abramowitz.png"]);
  ok("...marked ambiguous, not 'no match'", needed["James Thorne.jpg"].reason === "ambiguous", needed["James Thorne.jpg"]);
  ok("...with BOTH people offered so she can pick",
     needed["James Thorne.jpg"].candidates.length === 2, needed["James Thorne.jpg"].candidates);
  ok("AND NEITHER OF THEM GOT A FACE",
     !(await photoOf("b96p_d6")) && !(await photoOf("b96p_d7")) &&
     !(await photoOf("b96p_d8")) && !(await photoOf("b96p_d9")));

  ok("the wrong type is refused BY NAME", !!needed["donor list.pdf"], r.body.needsYou);
  ok("...saying which file it was",
     /donor list\.pdf/.test(needed["donor list.pdf"].message), needed["donor list.pdf"].message);
  ok("...as a type problem, not a matching one", needed["donor list.pdf"].reason === "not_a_photo");

  // ── §3 · the picker closes the loop ──────────────────────────────────────
  console.log("\n— §3 · placing one by hand —");

  const placed = await api("POST", "/donors/b96p_d6/photo", tok, { image: PNG });
  ok("she picks one of the two and it attaches", placed.status === 200, placed.body);
  ok("...and only that one", !!(await photoOf("b96p_d6")) && !(await photoOf("b96p_d7")));

  // ── §4 · the boundaries ──────────────────────────────────────────────────
  console.log("\n— §4 · what it will not do —");

  const cross = await api("POST", "/photos/bulk", tok,
    { files: [{ fileName: "outsider@example.org.jpg", image: PNG }] });
  ok("a person in ANOTHER org is not matched", cross.body.attached === 0, cross.body);
  ok("...and their photo is untouched", !(await photoOf("b96p_x1")));

  const partial = await api("POST", "/photos/bulk", tok,
    { files: [{ fileName: "Margaret.jpg", image: PNG }, { fileName: "Whitfield.png", image: PNG }] });
  ok("NOTHING IS GUESSED ON A PARTIAL NAME", partial.body.attached === 0, partial.body);
  ok("...both come back for her", partial.body.needsYou.length === 2, partial.body.needsYou);

  const none = await api("POST", "/photos/bulk", tok, { files: [] });
  ok("an empty request is a 400", none.status === 400, none.status);

  // A REQUEST IS NOT A FOLDER. The first version of this route took 200 files
  // in one body and got a PayloadTooLargeError back, which express surfaces as
  // a bare 500 with nothing useful in it — two hundred headshots is hundreds of
  // megabytes. The route now takes a CHUNK and the screen sends the folder in
  // chunks, adding up the answers.
  const withPhotos = async () =>
    (await q(`SELECT COUNT(*)::int AS c FROM donors WHERE org_id=$1 AND photo_asset_id IS NOT NULL`, [ORG]))[0].c;
  const beforeMany = await withPhotos();
  const many = await api("POST", "/photos/bulk", tok,
    { files: Array.from({ length: 21 }, (_, i) => ({ fileName: `x${i}.jpg`, image: PNG })) });
  ok("more than one chunk's worth in a single request is refused, not attempted",
     many.status === 400, many.status);
  ok("...saying the limit", /at most 20/.test(many.body.message || ""), many.body);
  ok("...and refused BEFORE anything was written",
     (await withPhotos()) === beforeMany, { before: beforeMany, after: await withPhotos() });

  // The size cap and type check are the single-upload path's, not a second set.
  // 8MB of base64 is under this route's 24mb body limit and over the 10MB
  // decoded photo cap, so it reaches the validation rather than the parser.
  const huge = await api("POST", "/photos/bulk", tok,
    { files: [{ fileName: "Patricia Hernandez.jpeg", image: "data:image/png;base64," + "A".repeat(15 * 1024 * 1024) }] });
  ok("an oversized photo is rejected by the SAME cap a single upload uses",
     huge.status === 200 && huge.body.attached === 0 && huge.body.needsYou.length === 1, huge.body);
  ok("...and is reported against its file name rather than failing the batch",
     /Patricia Hernandez\.jpeg/.test(huge.body.needsYou[0].message), huge.body.needsYou[0]);
  ok("...and the request did not fall over — the batch is still a 200",
     huge.status === 200, huge.status);

  await reset();
  await closeDb();
  summary();
})();
