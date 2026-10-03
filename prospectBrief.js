// prospectBrief.js — PROSPECT-1 Part 5. THE RESEARCHER'S ONE-PAGE BRIEF.
//
// Three sources and no others: Steward's own record of the person, the
// screening results a provider returned, and the public filing for an
// organisation with an EIN. Every line names its source. Nothing comes from the
// open web or from a model's memory: the brief is assembled from rows, so there
// is no sentence in it a row did not supply. What none of the three sources
// holds is listed under "Not known", in so many words.
//
// It is saved to the person's files (donor_materials, major gifts staff only)
// and never sent.
"use strict";
const { query } = require("./db");
const P = require("./prospect");

const toC = v => Math.round(Number(v || 0) * 100);

async function build(orgId, donorId) {
  const RT = await P.rtg();
  const $ = RT.dollars;
  const t = await P.today(orgId);
  const [d] = await query(`SELECT id, name, kind, email, phone, city, state, employer, spouse_name, stage, assigned_to_name, funder_ein,
      total_giving::text AS total_giving, created_at FROM donors WHERE id = ? AND org_id = ?`, [donorId, orgId]);
  const [g] = await query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::text AS s, MIN(LEFT(date,10)) AS first, MAX(LEFT(date,10)) AS last,
      MAX(amount)::text AS largest FROM gifts WHERE org_id = ? AND donor_id = ? AND amount > 0`, [orgId, donorId]);
  const contacts = await query(`SELECT type, LEFT(date,10) AS date FROM interactions WHERE org_id = ? AND donor_id = ?
      AND type IN ('call','meeting','email','visit','stewardship','note') ORDER BY date DESC LIMIT 3`, [orgId, donorId]);
  const room = (await P.roomToGive(orgId, [donorId])).get(donorId);
  const [filing] = await query(`SELECT * FROM public_filings WHERE org_id = ? AND donor_id = ? AND found = true AND source_date IS NOT NULL`, [orgId, donorId]);

  const REC = "Steward record";
  const GIFTS = "Steward gifts";
  const lines = [];
  const notKnown = [];
  const line = (section, text, source) => lines.push({ section, text, source });

  // Who
  line("Who", `${d.name}${d.kind === "organisation" ? ", an organisation" : ""}${d.city ? `, ${[d.city, d.state].filter(Boolean).join(", ")}` : ""}.`, REC);
  if (d.assigned_to_name) line("Who", `Relationship owner: ${d.assigned_to_name}.`, REC); else notKnown.push("Relationship owner: nobody is assigned.");
  if (d.stage) line("Who", `Stage: ${d.stage}.`, REC);
  if (d.employer) line("Who", `Employer on file: ${d.employer}.`, REC); else if (d.kind !== "organisation") notKnown.push("Employer: not on file.");
  if (d.spouse_name) line("Who", `Spouse on file: ${d.spouse_name}.`, REC); else if (d.kind !== "organisation") notKnown.push("Spouse: not on file.");

  // Giving
  if (g && g.n > 0) {
    line("Giving", `${g.n} ${g.n === 1 ? "gift" : "gifts"} totalling ${$(toC(g.s))}, from ${g.first} to ${g.last}.`, GIFTS);
    line("Giving", `Largest single gift: ${$(toC(g.largest))}.`, GIFTS);
    line("Giving", `Given in the last twelve months: ${$(room.annualCents)}.`, GIFTS);
  } else notKnown.push("Giving: no gifts on file.");

  // Room to give
  line("Room to give", `${room.label}.`, "Steward record, Room to give");
  for (const r of room.reasons) {
    const src = r.screening && room.screening ? `Screening file, ${room.screening.provider}, ${room.screening.screenedOn}` : REC;
    line("Room to give", `${r.text}.`, src);
  }
  if (!room.screening) notKnown.push("Capacity and real estate: not known; no screening results on file.");
  else {
    if (room.screening.capacityLowCents == null && room.screening.capacityHighCents == null) notKnown.push("Capacity: the screening file did not give a range.");
    if (!room.screening.otherGifts) notKnown.push("Gifts to other charities: not in the screening file.");
  }

  // Public filing
  if (filing) {
    const src = `${P.sourceLine(filing.source_date)}${filing.source_file ? ` (${filing.source_file})` : ""}, ${filing.source_url}`;
    if (filing.total_assets_cents != null) line("Public filing", `Total assets: ${$(Number(filing.total_assets_cents))}.`, src);
    if (filing.revenue_cents != null) line("Public filing", `Revenue: ${$(Number(filing.revenue_cents))}.`, src);
    if (filing.tax_year) line("Public filing", `Last filing year: ${filing.tax_year} (tax period ending ${String(filing.tax_period).slice(4, 6)}/${filing.tax_year}).`, src);
    else notKnown.push("Last filing year: the IRS file gives no tax period for this EIN.");
    notKnown.push("Grants paid: not in the IRS file Steward reads.");
  } else if (d.kind === "organisation") {
    notKnown.push(d.funder_ein ? "Public filing: not looked up yet, or none was found for the EIN on file." : "Public filing: no EIN on file.");
  }

  // Contact
  if (contacts.length) line("Recent contact", contacts.map(c => `${c.type} on ${c.date}`).join("; ") + ".", "Steward conversations");
  else notKnown.push("Contact: no call, meeting or email logged.");

  const fileName = `Prospect brief, ${d.name}, ${t}.txt`;
  return { title: `Prospect brief: ${d.name}`, date: t, fileName, persona: "Researcher",
    sources: ["Steward's own record", "screening results, where a provider returned them", "the IRS public file, where the organisation was looked up"],
    lines, notKnown };
}

function toText(b) {
  const out = [b.title, `Drafted by the Researcher on ${b.date} from ${b.sources.join(", ")}. Nothing from the open web. Never sent.`, ""];
  let sec = null;
  for (const l of b.lines) {
    if (l.section !== sec) { out.push("", l.section.toUpperCase()); sec = l.section; }
    out.push(`- ${l.text} [Source: ${l.source}]`);
  }
  out.push("", "NOT KNOWN");
  for (const n of b.notKnown) out.push(`- ${n}`);
  return out.join("\n") + "\n";
}

module.exports = { build, toText };
