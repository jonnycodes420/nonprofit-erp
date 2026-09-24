// shared/ackLetter.js — BUILD-98 (switch) Part 2. LETTERS THAT PRINT.
//
// A Bloomerang user's week has a stack in it: the gifts that came in, a letter
// for each, folded into a window envelope. Steward had the drafted thank-you
// queue (88b), which is the right thing for one gift and the wrong thing for
// forty. This is the batch: one template in the org's own words, merged per
// donor, one page each, the address block exactly where a #10 window is.
//
// THREE RULES, and each is a way a batch goes wrong without anyone noticing:
//   1. AN UNKNOWN MERGE FIELD IS REFUSED AT SAVE. "Dear {{frist}}," printed
//      forty times is the failure this exists to prevent — the BUILD-94
//      sequence rule, applied to paper.
//   2. A FIELD WITH NO VALUE IS NAMED, NEVER BLANK. A letter that reads
//      "Thank you for your gift to the  fund" goes out looking careless. A
//      render that is missing a value says which, and the batch reports the
//      donors whose letter could not be finished rather than printing them.
//   3. THE AMOUNT IS THE GIFT ROW'S, TO THE CENT. A donor with three gifts in
//      the batch gets ONE letter listing three amounts and their total; the
//      total is summed in integer cents, never re-read off a float.
//
// Pure: no DB, no network, no clock, no JSX.

export const ACK_MERGE_FIELDS = [
  { key: "salutation", label: "Salutation", hint: "Dear Margaret — their salutation if set, otherwise their first name" },
  { key: "first", label: "First name" },
  { key: "name", label: "Full name" },
  { key: "gift_amount", label: "Gift amount", hint: "one gift, or the total when a donor has several in the batch" },
  { key: "gift_date", label: "Gift date", hint: "one date, or the dates of several gifts" },
  { key: "gift_word", label: "gift / gifts", hint: "\"gift\" for one, \"gifts\" for several" },
  { key: "gift_list", label: "Gift list", hint: "every gift in the batch for this donor, one per line" },
  { key: "fund", label: "Fund" },
  { key: "tribute", label: "Tribute", hint: "\"in memory of Ann Lee\", or nothing" },
  { key: "org_name", label: "Organisation name" },
  { key: "signer", label: "Signer" },
  { key: "signer_title", label: "Signer's title" },
  { key: "year", label: "Year of the gift" },
];
export const ACK_MERGE_KEYS = ACK_MERGE_FIELDS.map(f => f.key);

// Fields a template may use that are allowed to be empty without making the
// letter unfinished — a gift with no tribute simply has none.
const MAY_BE_EMPTY = new Set(["tribute", "signer_title"]);

export const DEFAULT_ACK_TEMPLATE = [
  "Dear {{salutation}},",
  "",
  "Thank you for your {{gift_word}} of {{gift_amount}} to {{org_name}}, received on {{gift_date}}{{tribute}}.",
  "",
  "Gifts like yours are how this work keeps going, and I wanted you to hear that from us directly.",
  "",
  "With gratitude,",
  "",
  "{{signer}}",
  "{{signer_title}}",
].join("\n");

const TOKEN_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

export function templateTokens(body) {
  const out = [];
  let m;
  const re = new RegExp(TOKEN_RE.source, "g");
  while ((m = re.exec(String(body || "")))) out.push(m[1]);
  return out;
}

// Refused at save, with every bad token named.
export function validateTemplate(body) {
  const b = String(body || "");
  const errors = [];
  if (b.trim().length < 20) errors.push("a letter needs more than a line");
  if (b.length > 8000) errors.push("keep a letter to one page");
  const unknown = [...new Set(templateTokens(b).filter(t => !ACK_MERGE_KEYS.includes(t)))];
  if (unknown.length) errors.push(`Steward does not know ${unknown.map(u => `{{${u}}}`).join(", ")}. The fields it knows are ${ACK_MERGE_KEYS.map(k => `{{${k}}}`).join(", ")}.`);
  // Braces that are not a token ("{{ }}", "{first}") print as braces.
  if (/\{\{(?!\s*[a-zA-Z_]+\s*\}\})/.test(b)) errors.push("an opening {{ that is not a field");
  return { ok: errors.length === 0, errors };
}

const toCents = v => Math.round(Number(v) * 100);
export function formatCents(c) {
  const n = Math.abs(c);
  return (c < 0 ? "-" : "") + "$" + Math.floor(n / 100).toLocaleString("en-US") + "." + String(n % 100).padStart(2, "0");
}
export function formatLetterDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function firstNameOf(name) {
  const n = String(name || "").trim();
  if (!n) return "";
  return n.split(/\s+/)[0];
}

// The fields for ONE donor's letter. `gifts` are this donor's gifts in the
// batch, oldest first.
export function letterFields({ donor, gifts, org }) {
  const list = (gifts || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const totalCents = list.reduce((t, g) => t + toCents(g.amount), 0);
  const one = list.length === 1 ? list[0] : null;
  const funds = [...new Set(list.map(g => g.fund).filter(Boolean))];
  const tributes = list.filter(g => g.tributeType && g.tributeName);
  const tribute = tributes.length === 1
    ? `, ${tributes[0].tributeType === "memory" ? "in memory of" : "in honour of"} ${tributes[0].tributeName}` : "";
  const isOrg = donor.kind === "organisation";
  return {
    salutation: String(donor.salutation || "").trim() || (isOrg ? `Friends at ${donor.name}` : firstNameOf(donor.name)),
    first: isOrg ? "" : firstNameOf(donor.name),
    name: donor.name || "",
    gift_amount: list.length ? formatCents(totalCents) : "",
    gift_date: one ? formatLetterDate(one.date)
      : list.length === 2 ? `${formatLetterDate(list[0].date)} and ${formatLetterDate(list[1].date)}`
      : list.length > 2 ? `${list.length} dates between ${formatLetterDate(list[0].date)} and ${formatLetterDate(list[list.length - 1].date)}` : "",
    gift_word: list.length > 1 ? "gifts" : "gift",
    gift_list: list.map(g => `${formatLetterDate(g.date)}  ${formatCents(toCents(g.amount))}${g.fund ? `  (${g.fund})` : ""}`).join("\n"),
    fund: funds.length === 1 ? funds[0] : "",
    tribute,
    org_name: org.name || "",
    signer: org.signer || "",
    signer_title: org.signerTitle || "",
    year: list.length ? String(list[list.length - 1].date).slice(0, 4) : "",
    _totalCents: totalCents,
  };
}

// Render one letter. Returns the text and the fields that were needed and
// empty — a non-empty `missing` means this letter is not printed.
export function renderLetter(body, fields) {
  const missing = new Set();
  const text = String(body || "").replace(new RegExp(TOKEN_RE.source, "g"), (_, k) => {
    const v = fields[k];
    if ((v === undefined || v === null || String(v) === "") && !MAY_BE_EMPTY.has(k)) missing.add(k);
    return v == null ? "" : String(v);
  });
  // A signer_title line that came out empty leaves no blank line behind.
  return { text: text.replace(/\n[ \t]*\n(?=[ \t]*$)/g, "\n").replace(/[ \t]+$/gm, "").trimEnd(), missing: [...missing] };
}

// The address block a window envelope shows, or null when there is not one
// good enough to post to (a letter with no address is not printed).
export function addressLines(d) {
  const name = String(d.name || "").trim();
  const street = String(d.address || "").trim();
  const street2 = String(d.address2 || "").trim();
  const city = String(d.city || "").trim(), state = String(d.state || "").trim(), zip = String(d.zip || "").trim();
  if (!name || !street || !city || !(state || zip)) return null;
  const last = `${city}${state ? `, ${state}` : ""}${zip ? ` ${zip}` : ""}`;
  const country = String(d.country || "").trim();
  const lines = [name, street];
  if (street2) lines.push(street2);
  lines.push(last);
  if (country && !/^(us|usa|united states( of america)?)$/i.test(country)) lines.push(country);
  return lines;
}

// ── GEOMETRY, IN POINTS (72 per inch) ──────────────────────────────────────
// A standard #10 double-window envelope with a letter tri-folded: the
// recipient window is 4½" × 1⅛", its left edge ⅞" in and its top 2" down the
// sheet once folded. The block is set a little inside that so a letter that
// slides in the envelope still shows the whole address.
export const WINDOW = { x: 0.875 * 72 + 6, y: 2.0 * 72 + 6, w: 4.5 * 72 - 12, h: 1.125 * 72 - 8 };

// Avery 5160 / 8160: 30 labels, 3 across, 10 down, 2⅝" × 1", ½" top margin,
// 3/16" side margin, ⅛" gutter between columns.
export const LABELS_5160 = { cols: 3, rows: 10, w: 2.625 * 72, h: 72, top: 0.5 * 72, left: 0.1875 * 72, gutter: 0.125 * 72 };
export function labelOrigin(i) {
  const L = LABELS_5160;
  const k = i % (L.cols * L.rows);
  const col = k % L.cols, row = Math.floor(k / L.cols);
  return { page: Math.floor(i / (L.cols * L.rows)), x: L.left + col * (L.w + L.gutter), y: L.top + row * L.h };
}

// How late a gift is before it counts as a backlog, per org. Seven is a week
// and a real default; the org sets its own.
export const DEFAULT_ACK_BACKLOG_DAYS = 7;
export const ACK_VIA = ["letter", "email", "phone", "in_person", "receipt"];
