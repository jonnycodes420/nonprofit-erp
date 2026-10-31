// STAFF-MAIL-1 · Settings → My email. The morning email is the only email
// Steward sends a person on its own: here she picks what goes in it, the hour
// it comes and which days. Everything else Steward can email her is listed
// below it, each off until she turns it on. One person's own settings: the
// server reads them (routes/email.js briefSettings, userWantsEmail).
import { useState, useEffect } from "react";
import { T } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";

const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "24px 28px", marginBottom: 20 };
const rowStyle = { display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderTop: "1px solid " + T.bg2 };
const box = { width: 16, height: 16, marginTop: 2, accentColor: T.greenMid, flexShrink: 0 };
const select = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", color: T.ink, fontSize: 13, fontFamily: "inherit" };
const hourLabel = h => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const SECTIONS = [
  { key: "steps", label: "Steps due in the Thread", hint: "Every open step that is due or overdue for the donors you own, oldest first." },
  { key: "tasks", label: "Tasks due and overdue", hint: "Your tasks due today, and any that are late." },
  { key: "meetings", label: "Today's meetings", hint: "Who you are seeing today, with the same brief Home shows." },
  { key: "readouts", label: "Yesterday's readouts", hint: "The headline of each readout written since your last morning email." },
  { key: "team", label: "The team at a glance", hint: "How many steps each officer has open and overdue. Admins only, and only when two or more people own donors.", adminOnly: true },
];

const OTHERS = [
  { key: "portfolioGifts", label: "A gift to one of my donors", hint: "Sent the moment a gift lands for a donor you own, and when one of them changes a monthly gift in the donor portal." },
  { key: "taskAssignments", label: "A task assigned to me", hint: "Sent when someone, or one of your journeys, gives you a task." },
  { key: "stepReminder", label: "A next step at its time", hint: "When you give a next step a time, one email comes at that time. Without this, the step is in your morning email." },
  { key: "meetingBrief", label: "My meetings, as their own email", hint: "Today's meetings in a separate email at your hour. Not sent on a day your morning email already carried them." },
  { key: "weekInReview", label: "Week in Review", hint: "Monday, a summary of last week's gifts, asks and moves." },
  { key: "monthlyReport", label: "My monthly report", hint: "The first of the month, your asks, moves and gifts closed. Team plan." },
  { key: "connectionAlerts", label: "A connection stops working", hint: "When a giving page or bank feed breaks or goes quiet. Sent to the first admin. A task is opened either way.", adminOnly: true },
];

// The org-wide Staff mail switch and the onboarding wait, read the way the
// server reads them (mailPolicy.orgMailDecision), so the page never promises
// an email the server will refuse.
function staffMailOn(org) {
  if (!org) return true;
  if (org.staff_mail_enabled === false) return false;
  if (org.staff_mail_enabled !== true && org.emails_enabled === false) return false;
  return !!org.onboarded_at;
}

export function MyEmailPanel({ isAdmin }) {
  const [p, setP] = useState(null);
  const [org, setOrg] = useState(null);
  const [saving, setSaving] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    apiFetch("/me").then(r => { setP(r?.notifications || null); setOrg(r?.org || null); }).catch(e => setErr(errorMessage(e, "Your email settings did not load.")));
  }, []);

  async function save(key, body, optimistic) {
    const before = p;
    setP(optimistic); setSaving(key); setErr("");
    try { const r = await apiFetch("/me/notification-prefs", { method: "PUT", body: JSON.stringify(body) }); if (r?.notifications) setP(r.notifications); }
    catch (e) { setP(before); setErr(errorMessage(e, "That setting was not saved.")); }
    finally { setSaving(""); }
  }
  const setBrief = (key, patch) => save(key, { brief: patch }, { ...p, brief: { ...p.brief, ...patch, sections: { ...p.brief.sections, ...(patch.sections || {}) } } });

  if (!p) return <div style={card}>{err || <span style={{ fontSize: 13, color: T.ink3 }}>Loading your email settings…</span>}</div>;
  const b = p.brief;
  const sections = SECTIONS.filter(s => !s.adminOnly || isAdmin);
  const noneIn = sections.every(s => !b.sections[s.key]);
  const off = !staffMailOn(org);

  return (
    <div data-testid="my-email">
      {off && (
        <div data-testid="my-email-org-off" style={{ ...card, background: T.bg, fontSize: 13, color: T.ink, lineHeight: 1.55 }}>
          Steward is not sending staff email for your organization yet, so nothing on this page goes out until that is turned on. Your choices here are kept for then.
        </div>
      )}

      <div style={card}>
        <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 20, color: T.ink }}>Your morning email</div>
        <div style={{ fontSize: 13, color: T.ink3, marginTop: 4, marginBottom: 14, lineHeight: 1.55, maxWidth: 620 }}>
          The one email Steward sends you without being asked. It comes once a day at the hour you pick, and not at all on a morning with nothing in it.
        </div>
        <label style={{ ...rowStyle, cursor: "pointer" }}>
          <input type="checkbox" data-testid="brief-on" checked={p.morningEmail} disabled={saving === "on"}
            onChange={() => save("on", { morningEmail: !p.morningEmail }, { ...p, morningEmail: !p.morningEmail })} style={box} />
          <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>Send me the morning email</div>
        </label>

        {p.morningEmail && <>
          <div style={{ ...rowStyle, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, minWidth: 120 }}>When</div>
            <select data-testid="brief-hour" aria-label="The hour it comes" value={b.hour} disabled={saving === "hour"}
              onChange={e => setBrief("hour", { hour: Number(e.target.value) })} style={select}>
              {HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <select data-testid="brief-days" aria-label="Which days" value={b.days} disabled={saving === "days"}
              onChange={e => setBrief("days", { days: e.target.value })} style={select}>
              <option value="weekdays">Weekdays</option>
              <option value="every_day">Every day</option>
            </select>
            <div style={{ fontSize: 12, color: T.ink3, flexBasis: "100%", marginTop: 2 }}>Your organization's time zone{org?.timezone ? `, ${org.timezone}` : ""}.</div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, padding: "12px 0 2px", borderTop: "1px solid " + T.bg2 }}>What goes in it</div>
          {sections.map(s => (
            <label key={s.key} style={{ ...rowStyle, borderTop: "none", cursor: "pointer" }}>
              <input type="checkbox" data-testid={"brief-" + s.key} checked={!!b.sections[s.key]} disabled={saving === s.key}
                onChange={() => setBrief(s.key, { sections: { [s.key]: !b.sections[s.key] } })} style={box} />
              <div>
                <div style={{ fontSize: 14, color: T.ink }}>{s.label}</div>
                <div style={{ fontSize: 12, color: T.ink3, marginTop: 1 }}>{s.hint}</div>
              </div>
            </label>
          ))}
          {noneIn && <div data-testid="brief-empty" style={{ fontSize: 12.5, color: T.gold700, marginTop: 4 }}>Nothing is ticked, so no morning email will come.</div>}
        </>}
      </div>

      <div style={card}>
        <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 20, color: T.ink }}>Anything else, only if you ask</div>
        <div style={{ fontSize: 13, color: T.ink3, marginTop: 4, marginBottom: 14, lineHeight: 1.55, maxWidth: 620 }}>
          Steward sends you none of these until you tick it. Each one is yours alone and changes nothing for anyone else.
        </div>
        {OTHERS.filter(o => !o.adminOnly || isAdmin).map(o => (
          <label key={o.key} style={{ ...rowStyle, cursor: "pointer" }}>
            <input type="checkbox" data-testid={"notify-" + o.key} checked={!!p[o.key]} disabled={saving === o.key}
              onChange={() => save(o.key, { [o.key]: !p[o.key] }, { ...p, [o.key]: !p[o.key] })} style={box} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{o.label}</div>
              <div style={{ fontSize: 12, color: T.ink3, marginTop: 1 }}>{o.hint}</div>
            </div>
          </label>
        ))}
      </div>
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.ink, marginTop: -8 }}>{err}</div>}
    </div>
  );
}
