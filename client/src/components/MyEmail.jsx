// STAFF-MAIL-1 · Settings → My email. The morning email: here she picks
// what goes in it, the hour it comes and which days. Everything else Steward
// can email her is listed below it. STAFF-MAIL-2: a new person starts with
// the weekly email on and everything else off; turning the daily email on
// turns the weekly one off (the server does it and says so, and Undo puts
// both back). One person's own settings: the server reads them
// (routes/email.js briefSettings, userWantsEmail).
import { useState, useEffect } from "react";
import { T } from "./shared";
import { apiFetch } from "../api";
import { errorMessage } from "../lib/domainError";
import { MorningEmailPreview } from "./MorningEmailPreview";   // TIDY-1

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
  const [undo, setUndo] = useState(false);
  // The weekly email's "Turn on the daily email" link lands here with ?daily=1.
  const [fromLink] = useState(() => { try { return new URLSearchParams(window.location.search).get("daily") === "1"; } catch { return false; } });
  useEffect(() => {
    apiFetch("/me").then(r => { setP(r?.notifications || null); setOrg(r?.org || null); }).catch(e => setErr(errorMessage(e, "Your email settings did not load.")));
  }, []);

  async function save(key, body, optimistic) {
    const before = p;
    setP(optimistic); setSaving(key); setErr(""); setUndo(false);
    try {
      const r = await apiFetch("/me/notification-prefs", { method: "PUT", body: JSON.stringify(body) });
      if (r?.notifications) setP(r.notifications);
      if (r?.weeklyTurnedOff) setUndo(true);
    }
    catch (e) { setP(before); setErr(errorMessage(e, "That setting was not saved.")); }
    finally { setSaving(""); }
  }
  // Turning the daily email on turns the weekly one off (server-side); Undo sends both back.
  const turnOnDaily = () => save("on", { morningEmail: true }, { ...p, morningEmail: true, weekly: false });
  const undoDaily = () => save("undo", { morningEmail: false, weekly: true }, { ...p, morningEmail: false, weekly: true });
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

      <div style={card} data-testid="weekly-card">
        <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 20, color: T.ink }}>Your weekly email</div>
        <div style={{ fontSize: 13, color: T.ink3, marginTop: 4, marginBottom: 14, lineHeight: 1.55, maxWidth: 620 }}>
          Monday at 7 AM: the week ahead (next steps, follow-ups, pledge payments and events) and last week in a few lines. A quiet week still gets one line saying so.
        </div>
        <label style={{ ...rowStyle, cursor: "pointer" }}>
          <input type="checkbox" data-testid="notify-weekly" checked={!!p.weekly} disabled={saving === "weekly"}
            onChange={() => save("weekly", { weekly: !p.weekly }, { ...p, weekly: !p.weekly })} style={box} />
          <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>Send me the weekly email</div>
        </label>
        {!p.morningEmail && (
          <div data-testid="daily-prompt" style={{ ...rowStyle, alignItems: "center", flexWrap: "wrap", ...(fromLink ? { background: T.bg, borderRadius: 10, padding: "12px 14px", borderTop: "none", marginTop: 6 } : {}) }}>
            <div style={{ fontSize: 13.5, color: T.ink, flex: "1 1 240px" }}>Want this every morning instead?</div>
            <button type="button" data-testid="turn-on-daily" onClick={turnOnDaily} disabled={saving === "on"}
              style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Turn on the daily email</button>
          </div>
        )}
        {undo && (
          <div data-testid="daily-undo" role="status" style={{ ...rowStyle, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 13.5, color: T.ink, flex: "1 1 240px" }}>The daily email is on, and the weekly email is off.</div>
            <button type="button" data-testid="undo-daily" onClick={undoDaily} disabled={saving === "undo"}
              style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 10, padding: "8px 14px", fontSize: 13.5, fontWeight: 700, color: T.greenDk, cursor: "pointer", fontFamily: "inherit" }}>
              Undo</button>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 20, color: T.ink }}>Your daily email</div>
        <div style={{ fontSize: 13, color: T.ink3, marginTop: 4, marginBottom: 14, lineHeight: 1.55, maxWidth: 620 }}>
          What needs you today, in one email. It comes once a day at the hour you pick, and not at all on a morning with nothing in it.
        </div>
        <label style={{ ...rowStyle, cursor: "pointer" }}>
          <input type="checkbox" data-testid="brief-on" checked={p.morningEmail} disabled={saving === "on"}
            onChange={() => p.morningEmail ? save("on", { morningEmail: false }, { ...p, morningEmail: false }) : turnOnDaily()} style={box} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>Send me the daily email every morning</div>
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 1 }}>Turning it on turns the weekly email off. Tick both if you want both.</div>
          </div>
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
          {noneIn && <div data-testid="brief-empty" style={{ fontSize: 12.5, color: T.gold700, marginTop: 4 }}>Nothing is ticked, so no daily email will come.</div>}
        </>}
        <MorningEmailPreview isOn={!!p.morningEmail} onTurnOn={turnOnDaily} />
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
