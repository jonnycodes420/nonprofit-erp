// shared/morningEmailState.js · FLOWS-18 item 5 (W-1117-Volunteers-19, a repeat of FLOWS-7 and FLOWS-9's).
// WHAT STEWARD SAYS ABOUT THE MORNING EMAIL, FROM ITS REAL STATE.
//
// The fleet read Tasks promising a morning note at 8am while Settings → Your email said the daily
// email was OFF and "Steward is not sending staff email for your organization yet". Each screen
// that mentions the morning email now reads this one function, given the signed-in person's
// /me `notifications` and `org`, so a sentence can't promise an email the server won't send.
//
//   staff_mail_off  the org's staff mail is off, or it has not finished onboarding (the server's
//            mailPolicy.orgMailDecision): nothing goes, whatever her switch says
//   off      her own switch is off
//   on       it comes at her hour, on her days, in the org's time zone
//
// FLOWS-9 fixed the preview's footer (it reads her real setting) and left every other mention
// written as if the email were on. A sentence that names the email goes through `sentence`.

// The org-wide Staff mail switch and the onboarding wait, read the way the server reads them.
export function staffMailOn(org) {
  if (!org) return true;
  if (org.staff_mail_enabled === false) return false;
  if (org.staff_mail_enabled !== true && org.emails_enabled === false) return false;
  return !!org.onboarded_at;
}

export const hourLabel = h => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

// notifications: /me's { morningEmail, brief: { hour, days } }; org: /me's org.
export function morningEmailState(notifications, org) {
  const n = notifications || null;
  const hour = n && n.brief && Number.isInteger(Number(n.brief.hour)) ? Number(n.brief.hour) : 8;
  const days = n && n.brief && n.brief.days === "every_day" ? "every_day" : "weekdays";
  const state = !staffMailOn(org) ? "staff_mail_off" : !(n && n.morningEmail) ? "off" : "on";
  const when = `${days === "every_day" ? "every morning" : "each weekday morning"} at ${hourLabel(hour)}${org && org.timezone ? ` (${org.timezone})` : ""}`;
  return { state, on: state === "on", hour, days, when };
}

// The one sentence each surface shows. `where`: "tasks" | "home" | "step".
export function morningEmailSentence(st, where = "tasks") {
  const s = st || { state: "off" };
  if (where === "step") {
    return s.on ? "It becomes a task, in your morning email when it's due." : "It becomes a task on your Tasks page when it's due.";
  }
  if (s.state === "staff_mail_off") return "Steward is not sending staff email for your organization yet, so your tasks are here and on Home, not in an email.";
  if (s.state === "off") return "Your morning email is off, so your tasks are here and on Home, not in an email.";
  return where === "home"
    ? `Your morning email lists what needs you ${s.when}.`
    : `Your morning email lists these ${s.when}.`;
}
