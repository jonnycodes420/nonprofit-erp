// MAIL-1 (Jonathan, 4 Oct 2026): ONE MAIL POLICY, READ AT THE ONE MAIL GATE.
//
// Every send Steward makes belongs to one of five families, and this file is
// the only place that says which family a kind of mail is in and what each
// family may do. `orgMaySendEmail` (routes/email.js) and the Resend client
// proxy (server.js top) both ask it; nothing else restates these rules.
//
//   staff       Steward to an org's own staff: digests, Week in Review, "Your
//               meetings today", reminders, alerts, task notices.
//   donor       an org to its own donors and volunteers: receipts, campaigns,
//               thank-yous, sequences she turned on, statements, event,
//               auction, volunteer and pledge mail.
//   account     sign-in and security: password reset, magic links, two-factor
//               codes, team invites, email-change confirmation.
//   billing     Steward's own billing to an org: receipts for real charges and
//               the trial-ending heads-up.
//   jonathan    mail to Jonathan: a new signup, a demo request, an ops alert.
//
// And one kind that is in no family because it never sends:
//
//   onboarding  the founder drip / any automated welcome or onboarding series.
//               OFF FOR GOOD. Jonathan writes and sends onboarding himself.
//
// THE RULES
//   1. onboarding: refused, always, with the reason in the log.
//   2. staff and donor: refused until the org has ONBOARDED (its first real
//      donor file is in, or a super-admin marked it by hand), and after that
//      through the existing org switch, suppressions and per-kind rules.
//   3. account and jonathan: always on, onboarded or not.
//   4. billing: on before onboarding too, so nobody is charged by surprise.
//      Jonathan can turn that exception off with MAIL_BILLING_BEFORE_ONBOARDING=0.
//   5. a demo org sends nothing but account mail to its own logins (as before).
//   5a. an org whose kind is set to demo, internal_test or fixture (ADMIN-CLEAN,
//       orgKind.js) gets no billing mail: nobody there is being charged.
//   6. an UNKNOWN kind on an org's send is treated as donor mail: it waits for
//      onboarding and the org switch. Mail fails closed.
//
// THE ONE SETTING. "Nothing until the donor file is in" will change as Steward
// scales. It is MAIL_WAIT_FOR_ONBOARDING: anything but "0" keeps the wait.

// The demonstration orgs by id, the same two twoFactor.js names: Harborlight
// and the CREO boot fixture never send, whatever their switches say.
// FIX-45: and every demo org orgKind.js names (Riverbend, Meadowbrook), and any
// org whose kind somebody set to demo, so the two files cannot disagree.
const DEMO_ORG_IDS = [...new Set(["org_b72demo", "org_creo", ...require("./orgKind").DEMO_ORG_IDS])];
// CHECK-2 (Jonathan, 21 Oct): a demo org's pledges still reached Resend every
// hour, at @example.com people. The flag, the kind and the id list missed an org
// that is a demo only by its name ("Lakeside Arts Center (Demo)"), which
// orgKind.js already counts as one. "(Demo)" in the name, with no kind set by
// hand, is a demo org here too, in JS and in SQL, so the gate and every sweep
// agree. Only the bracketed word: "Demolition Aid" or "Demo Day Fund" is real.
const DEMO_NAME_RE = /\(\s*demo\s*\)/i;
const isDemoOrg = org => !!org && (org.is_demo_org === true || org.org_kind === "demo" || DEMO_ORG_IDS.includes(org.id)
  || (org.org_kind == null && DEMO_NAME_RE.test(String(org.name || ""))));

// FIX-45 (Muse, 19 Oct): THE SAME RULE, AT THE SOURCE. The gate above refused
// twelve pledge reminders a demo org's sweep had already picked, and the sweep
// picked them again every hour, because nothing upstream knew the org was
// fiction. A sweep that chooses donor mail to send reads this in its WHERE
// clause, so a demo org (and a sample person, which the sweep filters itself)
// never becomes a send to refuse. `o` is the alias of the orgs row; it must be
// joined. The ids are constants, never input, so inlining them is safe.
function orgSendsSql(o = "o") {
  return `(COALESCE(${o}.is_demo_org, false) = false AND COALESCE(${o}.org_kind, '') <> 'demo'`
    + ` AND ${o}.id NOT IN (${DEMO_ORG_IDS.map(id => `'${id}'`).join(",")})`
    + ` AND NOT (${o}.org_kind IS NULL AND COALESCE(${o}.name, '') ~* '\\(\\s*demo\\s*\\)'))`;
}

const CATEGORY = {
  STAFF: "staff",
  DONOR: "donor",
  ACCOUNT: "account",
  BILLING: "billing",
  JONATHAN: "jonathan",
  ONBOARDING: "onboarding",
};

// `_stewardKind` on a send -> its family. A kind missing here is donor mail
// (rule 6). DONOR_MAIL_POLICY's kinds are all donor mail and need no entry.
const KIND_CATEGORY = {
  // staff
  digest: "staff", week_in_review: "staff", officer_report: "staff",
  meeting_brief: "staff", staff_notice: "staff", staff_alert: "staff",
  task_notice: "staff", gift_alert: "staff", workflow_staff: "staff", board_pack: "staff",
  campaign_test: "staff",
  // account and security
  password_reset: "account", magic_link: "account", two_factor: "account",
  team_invite: "account", email_change: "account", account: "account",
  mail_test: "account",   // super-admin's test of an org's identity, to their own address only
  // billing
  billing_receipt: "billing", trial_ending: "billing", billing: "billing", tier_notice: "billing",
  // to Jonathan
  founder_signup: "jonathan", demo_request: "jonathan", ops_alert: "jonathan",
  // never
  onboarding_drip: "onboarding", onboarding: "onboarding",
};

function categoryOf(kind) {
  return KIND_CATEGORY[String(kind || "")] || CATEGORY.DONOR;
}

// ADMIN-CLEAN: kinds Steward never bills (orgKind.js names all five).
const NOT_BILLED_KINDS = new Set(["demo", "internal_test", "fixture"]);

const waitsForOnboarding = () => process.env.MAIL_WAIT_FOR_ONBOARDING !== "0";
const billingBeforeOnboarding = () => process.env.MAIL_BILLING_BEFORE_ONBOARDING !== "0";

// The decision for one org and one family. `org` is the orgs row (or null
// when it could not be read: refuse). Pure, so the suite can prove each arm.
// FIX-48 · THE THREE SWITCHES (super-admin, per org). Donor mail is
// `emails_enabled`. Staff mail is `staff_mail_enabled`: false refuses every
// automatic staff send, true sends whatever the donor switch says, and NULL
// (never set) follows emails_enabled as staff mail always did. Billing mail is
// `billing_mail_enabled`. Account (sign-in) mail has no switch. `kind` lets a
// staff send a person asked for just now (STAFF_ON_REQUEST, "Send me a test")
// go with automatic staff mail off: the switch is about what Steward sends on
// its own.
const STAFF_ON_REQUEST = new Set(["campaign_test"]);
function orgMailDecision(org, category, kind = null) {
  if (category === CATEGORY.ONBOARDING) return { send: false, reason: "onboarding_sequence_off" };
  if (category === CATEGORY.JONATHAN) return { send: true, reason: null };
  if (!org) return { send: false, reason: "org_not_found" };
  if (category === CATEGORY.ACCOUNT) return { send: true, reason: null };
  if (isDemoOrg(org)) return { send: false, reason: "demo_org" };
  if (category === CATEGORY.BILLING) {
    if (org.billing_mail_enabled === false) return { send: false, reason: "billing_mail_off" };
    if (NOT_BILLED_KINDS.has(org.org_kind)) return { send: false, reason: "not_a_customer" };
    if (billingBeforeOnboarding() || org.onboarded_at) return { send: true, reason: null };
    return { send: false, reason: "not_onboarded" };
  }
  if (category === CATEGORY.STAFF) {
    if (org.staff_mail_enabled === false && !STAFF_ON_REQUEST.has(kind)) return { send: false, reason: "staff_mail_off" };
    if (org.staff_mail_enabled !== true && org.emails_enabled === false) return { send: false, reason: "org_emails_disabled" };
  } else if (org.emails_enabled === false) return { send: false, reason: "org_emails_disabled" };
  if (waitsForOnboarding() && !org.onboarded_at) return { send: false, reason: "not_onboarded" };
  return { send: true, reason: null };
}
// What each switch reads as right now: staff's NULL is shown as what it does.
function mailSwitches(org) {
  const donor = !!org && org.emails_enabled !== false;
  return {
    staff: !!org && (org.staff_mail_enabled == null ? donor : org.staff_mail_enabled === true),
    donor,
    billing: !!org && org.billing_mail_enabled !== false,
  };
}

// The one sentence a person reads for each refusal. No raw flags reach a screen.
const REASON_SENTENCE = {
  onboarding_sequence_off: "Steward does not send an automated onboarding series.",
  not_onboarded: "Email turns on once your donor file is in.",
  org_emails_disabled: "Email is switched off for this organization.",
  demo_org: "This is a demonstration organization, so it never sends email.",
  not_a_customer: "This organization is a demo, an internal test or a fixture, so Steward sends it no billing mail.",
  org_not_found: "This organization could not be found, so nothing was sent.",
  org_gate_unreadable: "Steward could not check this organization's email setting, so nothing was sent.",
  staff_mail_off: "Staff mail is switched off for this organization, so Steward sends its staff nothing automatic.",
  billing_mail_off: "Billing mail is switched off for this organization.",
};

module.exports = { CATEGORY, KIND_CATEGORY, categoryOf, orgMailDecision, mailSwitches, STAFF_ON_REQUEST, waitsForOnboarding, isDemoOrg, orgSendsSql, DEMO_ORG_IDS,
  billingBeforeOnboarding, REASON_SENTENCE, NOT_BILLED_KINDS };
