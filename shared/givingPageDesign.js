// shared/givingPageDesign.js — GIVE-3. HOW A GIVING PAGE LOOKS, said once.
//
// The editor's preview and the page a donor opens render the same component
// from the same payload (client/src/pages/Donate.jsx). Everything that turns a
// page's design choices and the org's own facts into words on that page lives
// here, so the preview, the live page and the server cannot say different
// things: the layout, the story's Read more, the impact line per amount, the
// trust panel and the other ways to give.
//
// Pure: no database, no network, no DOM. The server loads it with import()
// like the other shared modules; the client imports it directly.

export const LAYOUTS = [
  { key: "story", label: "Story", hint: "A photo and the story beside the form." },
  { key: "simple", label: "Simple", hint: "The form only, under a band in your colors." },
  { key: "campaign", label: "Campaign", hint: "The goal bar first, then the story and the form." },
];
const LAYOUT_KEYS = LAYOUTS.map(l => l.key);

// The lines of the trust panel, in the order they show.
export const TRUST_KEYS = ["stripe", "legal", "tax", "privacy", "contact"];
export const TRUST_LABELS = {
  stripe: "Secure payment through Stripe",
  legal: "Your legal name and EIN",
  tax: "Tax-deductible as allowed by law",
  privacy: "Privacy link",
  contact: "Contact email or phone",
};
export const WAY_KEYS = ["check", "phone", "daf", "stock"];

// Story paragraphs shown before "Read more".
export const READ_MORE_AFTER = 2;

const str = (v, cap) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, cap);

// The stored shape, cleaned. Anything unknown is dropped; nothing throws.
export function normalizeDesign(raw) {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const impact = {};
  if (d.impact && typeof d.impact === "object") {
    for (const [k, v] of Object.entries(d.impact)) {
      const cents = Math.round(Number(k));
      const line = str(v, 140);
      if (Number.isFinite(cents) && cents > 0 && line) impact[String(cents)] = line;
    }
  }
  const w = d.ways && typeof d.ways === "object" ? d.ways : {};
  return {
    layout: LAYOUT_KEYS.includes(d.layout) ? d.layout : null,
    impact,
    hide: Array.isArray(d.hide) ? TRUST_KEYS.filter(k => d.hide.includes(k)) : [],
    privacyUrl: /^https:\/\/\S{3,500}$/.test(String(d.privacyUrl || "").trim()) ? String(d.privacyUrl).trim() : "",
    phone: str(d.phone, 40),
    ways: { check: w.check === true, phone: w.phone === true, daf: w.daf === true, stock: w.stock === true },
  };
}

// Every bad field is named, as the rest of the page editor does.
export function validateDesign(raw) {
  const errors = [];
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!d) return { ok: false, errors: [{ field: "design", message: "The page design is a set of choices." }], design: null };
  if (d.layout != null && d.layout !== "" && !LAYOUT_KEYS.includes(d.layout))
    errors.push({ field: "design.layout", message: "Choose Story, Simple or Campaign." });
  if (d.privacyUrl && !/^https:\/\/\S{3,500}$/.test(String(d.privacyUrl).trim()))
    errors.push({ field: "design.privacyUrl", message: "A privacy link is a full https:// address." });
  if (d.impact && typeof d.impact === "object") {
    for (const v of Object.values(d.impact)) {
      if (String(v || "").length > 140) { errors.push({ field: "design.impact", message: "Keep each impact line under 140 characters." }); break; }
    }
  }
  if (d.phone && !/^[0-9+().\-\s]{7,40}$/.test(String(d.phone).trim()))
    errors.push({ field: "design.phone", message: "A phone number is digits, spaces and + ( ) - only." });
  return { ok: errors.length === 0, errors, design: errors.length ? null : normalizeDesign(d) };
}

// The layout a page opens with when the org has not picked one: a page that
// counts toward a campaign leads with its number; a page with a picture or a
// story tells it; anything else is just the form.
export function layoutFor(design, page) {
  const d = normalizeDesign(design);
  if (d.layout) return d.layout;
  if (page && page.campaignId) return "campaign";
  if (page && (page.imageUrl || String(page.story || "").trim())) return "story";
  return "simple";
}

export function storyParagraphs(story) {
  return String(story || "").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
}

export function impactFor(design, cents) {
  const d = normalizeDesign(design);
  return d.impact[String(Math.round(Number(cents) || 0))] || "";
}

// THE TRUST PANEL. A line shows only when the org's own record holds the fact
// it states, and the org may hide any of them. There is no badge and no seal:
// a line is a sentence the org can stand behind.
//   facts: { orgName, legalName, ein, contactEmail, stripe } (stripe = the org
//   takes gifts on its own Stripe account)
export function trustLines(facts, design) {
  const f = facts || {};
  const d = normalizeDesign(design);
  const name = str(f.orgName, 200) || "This organization";
  const legal = str(f.legalName, 200);
  const ein = str(f.ein, 20);
  const out = [];
  if (f.stripe) out.push({ key: "stripe", text: `Secure payment through Stripe. ${name} never sees or stores your card number.` });
  if (legal || ein) out.push({ key: "legal", text: [legal, ein ? `EIN ${ein}` : ""].filter(Boolean).join(" · ") });
  if (ein) out.push({ key: "tax", text: "Your gift is tax-deductible as allowed by law." });
  out.push({ key: "privacy", text: "How your information is used", href: d.privacyUrl || "/privacy" });
  const email = str(f.contactEmail, 200);
  if (email || d.phone) out.push({ key: "contact", text: "Questions? " + [email, d.phone].filter(Boolean).join(" · "), href: email ? "mailto:" + email : null });
  return out.filter(l => !d.hide.includes(l.key));
}

// OTHER WAYS TO GIVE, one line each, each only when the org turned it on AND
// its record holds what the line needs (an address to mail a check to, an EIN
// for a donor-advised fund, an email to arrange stock).
//   facts: { orgName, legalName, ein, contactEmail, address }
export function waysLines(facts, design) {
  const f = facts || {};
  const d = normalizeDesign(design);
  const payee = str(f.legalName, 200) || str(f.orgName, 200);
  const ein = str(f.ein, 20);
  const email = str(f.contactEmail, 200);
  const address = str(f.address, 300);
  const out = [];
  if (d.ways.check && address) out.push({ key: "check", text: `Mail a check to ${payee}, ${address}.` });
  if (d.ways.phone && d.phone) out.push({ key: "phone", text: `Give by phone: ${d.phone}.` });
  if (d.ways.daf && ein) out.push({ key: "daf", text: `From a donor-advised fund: recommend a grant to ${payee}, EIN ${ein}.` });
  if (d.ways.stock && email) out.push({ key: "stock", text: `Stock or other securities: write to ${email} for transfer details.` });
  return out;
}

// What a way needs before it can show, for the editor to say so plainly.
export function wayNeeds(facts, design) {
  const f = facts || {};
  const d = normalizeDesign(design);
  return {
    check: str(f.address, 300) ? "" : "Add a mailing address in Settings, under receipts, first.",
    phone: d.phone ? "" : "Add the phone number below first.",
    daf: str(f.ein, 20) ? "" : "Add your EIN in Settings first.",
    stock: str(f.contactEmail, 200) ? "" : "Add a contact email in Design first.",
  };
}
