// components/JourneyDateFields.jsx · DATES-1. The journey builder's fields for
// a date on the calendar: "A date every year" (the month and day, who it
// starts for, and "First runs Dec 1, 2026") and how many days before a
// birthday a birthday journey starts.
import { T } from "./shared";
import { firstRunSentence } from "../../../shared/journeyShape.js";

const YEAR_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const YEAR_MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function JourneyDateFields({ trigger, tf, setTf, data, tid, LBL, INP }) {
  return (
    <>
      {trigger && trigger.needsDate && (
        <div data-testid={tid + "-yearly"} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginTop: 12 }}>
          <label style={{ display: "block" }}>
            <span style={LBL}>Month</span>
            <select data-testid={tid + "-yearly-month"} value={tf.month || ""} style={INP} onChange={e => setTf("month", e.target.value ? Number(e.target.value) : "")}>
              <option value="">Pick a month</option>
              {YEAR_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label style={{ display: "block" }}>
            <span style={LBL}>Day</span>
            <select data-testid={tid + "-yearly-day"} value={tf.day || ""} style={INP} onChange={e => setTf("day", e.target.value ? Number(e.target.value) : "")}>
              <option value="">Pick a day</option>
              {Array.from({ length: tf.month ? YEAR_MONTH_DAYS[tf.month - 1] : 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label style={{ display: "block" }}>
            <span style={LBL}>Who it starts for</span>
            <select data-testid={tid + "-yearly-who"} value={tf.who || "everyone"} style={INP} onChange={e => setTf("who", e.target.value)}>
              {(data.yearlyAudiences || []).map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </label>
          {tf.who === "group" && (
            <label style={{ display: "block" }}>
              <span style={LBL}>The group</span>
              <select data-testid={tid + "-yearly-group"} value={tf.groupId || ""} style={INP} onChange={e => setTf("groupId", e.target.value)}>
                <option value="">Pick a group</option>
                {(data.groups || []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          )}
          {tf.who === "stage" && (
            <label style={{ display: "block" }}>
              <span style={LBL}>The stage</span>
              <select data-testid={tid + "-yearly-stage"} value={tf.stage || ""} style={INP} onChange={e => setTf("stage", e.target.value)}>
                <option value="">Pick a stage</option>
                {(data.stages || []).map(st => <option key={st} value={st}>{st}</option>)}
              </select>
            </label>
          )}
          {tf.month && tf.day && data.today && (
            <div data-testid={tid + "-yearly-first"} style={{ gridColumn: "1 / -1", fontSize: 13, color: T.ink, fontWeight: 600 }}>
              {firstRunSentence(tf.month, tf.day, data.today)} The steps count from that date.
              {tf.month === 2 && tf.day === 29 ? " In a year without February 29 it runs on February 28." : ""}
            </div>
          )}
        </div>
      )}
      {trigger && trigger.key === "birthday" && (
        <label style={{ display: "block", marginTop: 12, maxWidth: 260 }}>
          <span style={LBL}>Start this many days before</span>
          <input data-testid={tid + "-birthday-lead"} type="number" min="0" max="60" step="1" style={INP} placeholder="0, on the day"
            value={tf.daysBefore || ""} onChange={e => { const d = parseInt(e.target.value, 10); setTf("daysBefore", Number.isInteger(d) && d > 0 ? Math.min(60, d) : ""); }} />
        </label>
      )}
    </>
  );
}
