// VOL-PAGE-1 · THE VOLUNTEER BLOCKS.
//
// The renderers for the blocks only a volunteer page carries (shared/
// pageWidgets.js, surface "volunteer"). PortalWidgets' one WidgetView hands
// each of them here, so a volunteer page is drawn by the same renderer as a
// giving page and the portal.
//
// Every role, shift, spot, hour and roster count comes from `data`, which the
// server reads from the volunteer programme when the page is opened (the
// public read, or /giving-pages/:id/volunteer-data in the editor). Nothing on
// these blocks is typed in, so the page cannot contradict Volunteers.
//
// The blocks share one small piece of state: picking a role on an opportunity
// card narrows the shift picker and the form to that role's shifts, and
// picking a shift fills the form's shift. That lives in VolunteerProvider; a
// block rendered without one still draws, it just cannot hand a choice on.
import { createContext, useContext, useState } from "react";
import { API } from "../api";

const PAL = {
  hair: "#e8e4db",
  wash: "#f0ede6",
  bodyDark: "#2d2d2d",
  muted: "#6b6b64",
  white: "#ffffff",
  errBg: "#f6e3dd",
  errInk: "#8a3a24",
};
const muted = { fontSize: 13, color: PAL.muted, lineHeight: 1.6 };
const h2 = { fontFamily: "var(--pt-serif, 'DM Serif Display',Georgia,serif)", fontWeight: 400, fontSize: 22, margin: "0 0 12px" };
const cardStyle = { background: PAL.white, border: "var(--pt-card-border, 1px solid "+PAL.hair+")", borderRadius: "var(--pt-card-radius, 14px)", boxShadow: "var(--pt-card-shadow, none)", padding: "20px 22px", marginBottom: 18 };
const btn = { background: "var(--pt-button, var(--pt-primary))", color: "var(--pt-button-fg, "+PAL.white+")", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnQuiet = { background: "none", color: "var(--pt-button, var(--pt-primary))", border: "1px solid var(--pt-button, var(--pt-primary))", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const inp = { width: "100%", boxSizing: "border-box", padding: "11px 12px", fontSize: 15, border: "1px solid "+PAL.hair, borderRadius: 10, fontFamily: "inherit", background: PAL.white, marginBottom: 10 };
const lbl = { display: "block", fontSize: 13, fontWeight: 700, color: PAL.bodyDark, margin: "4px 0 5px" };
const chip = on => ({ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, padding: "7px 12px", borderRadius: 20, cursor: "pointer", marginRight: 6, marginBottom: 6,
  border: "1px solid " + (on ? "var(--pt-primary)" : PAL.hair), background: on ? "var(--pt-primary)" : PAL.white, color: on ? "var(--pt-primary-fg, "+PAL.white+")" : PAL.bodyDark });

const AVAILABILITY = ["Weekday mornings", "Weekday afternoons", "Weekday evenings", "Weekends", "Whenever you need me"];
const GROUP_KINDS = [["church", "A church or faith group"], ["school", "A school or student group"], ["company", "A company or team"], ["other", "Another kind of group"]];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VolCtx = createContext(null);

// `preview` = the editor: the form draws but never submits.
export function VolunteerProvider({ data, orgSlug, pageSlug, preview = false, hasGroup = false, children }) {
  const [pickOpp, setPickOpp] = useState(null);
  const [pickSlot, setPickSlot] = useState("");
  const [groupMode, setGroupMode] = useState(false);
  const value = { data: data || {}, orgSlug, pageSlug, preview, hasGroup, pickOpp, setPickOpp, pickSlot, setPickSlot, groupMode, setGroupMode };
  return <VolCtx.Provider value={value}>{children}</VolCtx.Provider>;
}

const NOOP = () => {};
function useVol(ctx) {
  const v = useContext(VolCtx);
  if (v) return v;
  return { data: (ctx && ctx.volData) || {}, orgSlug: ctx && ctx.orgSlug, pageSlug: null, preview: true, hasGroup: false,
    pickOpp: null, setPickOpp: NOOP, pickSlot: "", setPickSlot: NOOP, groupMode: false, setGroupMode: NOOP };
}

function scrollToId(id) {
  const el = typeof document !== "undefined" ? document.getElementById(id) : null;
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

const inList = (ids, id) => !Array.isArray(ids) || !ids.length || ids.includes(id);

// "3 of 8 filled", or "3 signed up" when the shift has no limit.
function filledLine(x) {
  if (x.needed == null) return `${x.filled} signed up, no limit`;
  return `${x.filled} of ${x.needed} filled`;
}
function openLine(x) {
  if (x.needed == null) return "Room for everyone";
  const open = Math.max(0, x.needed - x.filled);
  if (x.full) return x.waitlisted ? `Full, ${x.waitlisted} on the waiting list` : "Full";
  return open === 1 ? "1 spot open" : `${open} spots open`;
}
function shiftLabel(s) {
  if (s.label) return s.label;
  return [s.date, s.start && s.end ? `${s.start} to ${s.end}` : s.start].filter(Boolean).join(", ");
}
function hoursText(h) {
  const n = Number(h) || 0;
  return n.toLocaleString("en-US", { maximumFractionDigits: n % 1 ? 1 : 0 });
}

// ── Opportunities ───────────────────────────────────────────────────────────
function Opportunities({ w, ctx }) {
  const v = useVol(ctx);
  const opps = (v.data.opportunities || []).filter(o => inList(w.opportunityIds, o.id));
  if (!opps.length) return v.preview ? <div style={{ ...cardStyle, ...muted }}>Your public volunteer roles show here. Add one in Volunteers.</div> : null;
  const signUp = id => {
    v.setPickOpp(id); v.setPickSlot("");
    scrollToId((v.data.shifts || []).some(s => s.opportunityId === id) ? "vp-shifts" : "vp-signup");
  };
  return (
    <div className="vp-opportunities" style={{ marginBottom: 18 }}>
      {w.heading ? <h2 style={h2}>{w.heading}</h2> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 14 }}>
        {opps.map(o => (
          <div key={o.id} style={{ ...cardStyle, marginBottom: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{o.name}</div>
            {o.description && <div style={{ fontSize: 14, lineHeight: 1.6, color: PAL.bodyDark, marginBottom: 10 }}>{o.description}</div>}
            <dl style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.5 }}>
              {o.commitment && <><dt style={{ fontWeight: 700 }}>Time</dt><dd style={{ margin: "0 0 6px", color: PAL.bodyDark }}>{o.commitment}</dd></>}
              {o.skills && <><dt style={{ fontWeight: 700 }}>Skills</dt><dd style={{ margin: "0 0 6px", color: PAL.bodyDark }}>{o.skills}</dd></>}
              {o.location && <><dt style={{ fontWeight: 700 }}>Where</dt><dd style={{ margin: 0, color: PAL.bodyDark }}>{o.location}</dd></>}
            </dl>
            <button type="button" style={{ ...btn, marginTop: "auto", alignSelf: "flex-start" }} onClick={() => signUp(o.id)}>Sign up</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Shift picker ────────────────────────────────────────────────────────────
function ShiftPicker({ w, ctx }) {
  const v = useVol(ctx);
  const all = (v.data.shifts || []).filter(s => inList(w.opportunityIds, s.opportunityId));
  const shifts = v.pickOpp ? all.filter(s => s.opportunityId === v.pickOpp) : all;
  const oppName = v.pickOpp && (v.data.opportunities || []).find(o => o.id === v.pickOpp)?.name;
  const choose = id => { v.setPickSlot(id); scrollToId("vp-signup"); };
  return (
    <div id="vp-shifts" className="vp-shifts" style={cardStyle}>
      {w.heading ? <h2 style={h2}>{w.heading}</h2> : null}
      {oppName && (
        <div style={{ ...muted, marginBottom: 10 }}>
          Showing shifts for {oppName}. <button type="button" onClick={() => v.setPickOpp(null)} style={{ background: "none", border: "none", padding: 0, color: "var(--pt-button, var(--pt-primary))", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontSize: 13 }}>Show every shift</button>
        </div>
      )}
      {!shifts.length && <div style={muted}>No upcoming shifts right now. Sign up below and we will be in touch when the next ones are set.</div>}
      {shifts.map((s, i) => (
        <div key={s.slotId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 0", borderTop: i ? "1px solid "+PAL.wash : "none" }}>
          <div style={{ minWidth: 0, flex: "1 1 200px" }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{shiftLabel(s)}</div>
            <div style={{ fontSize: 13, color: PAL.bodyDark }}>{s.oppName}</div>
            {Array.isArray(s.roles) && s.roles.length > 0 ? (
              <div style={{ ...muted, fontSize: 12.5 }}>
                {s.roles.map(r => `${r.name}: ${filledLine(r)}${r.full ? " (full)" : ""}`).join(" · ")}
              </div>
            ) : (
              <div style={{ ...muted, fontSize: 12.5 }}>{filledLine(s)} · {openLine(s)}</div>
            )}
          </div>
          <button type="button" onClick={() => choose(s.slotId)}
            style={s.full ? btnQuiet : { ...btn, padding: "8px 16px", fontSize: 13 }}>
            {s.full ? "Join the waiting list" : v.pickSlot === s.slotId ? "Chosen" : "Choose"}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Sign-up form ────────────────────────────────────────────────────────────
function SignupForm({ w, ctx }) {
  const v = useVol(ctx);
  const [f, setF] = useState({ name: "", email: "", phone: "", availability: [], interests: [], answers: {}, website: "", roleId: "",
                               group: { name: "", kind: "church", size: "", leaderPhone: "" } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const set = (k, val) => setF(x => ({ ...x, [k]: val }));
  const toggle = (k, val) => setF(x => ({ ...x, [k]: x[k].includes(val) ? x[k].filter(y => y !== val) : [...x[k], val] }));
  const opps = v.data.opportunities || [];
  const shifts = (v.data.shifts || []).filter(s => !v.pickOpp || s.opportunityId === v.pickOpp);
  const slot = (v.data.shifts || []).find(s => s.slotId === v.pickSlot) || null;
  const roles = slot && Array.isArray(slot.roles) ? slot.roles : [];
  const questions = (Array.isArray(w.questions) && w.questions.length ? w.questions : (v.data.questions || []))
    .map(q => (typeof q === "string" ? q : q && (q.label || q.q))).filter(Boolean).slice(0, 5);
  const group = v.hasGroup && v.groupMode;

  const submit = async e => {
    e.preventDefault();
    if (v.preview || busy) return;
    setErr("");
    if (!f.name.trim() || !EMAIL_RE.test(f.email.trim())) { setErr("Please give your name and an email address."); return; }
    if (group && !f.group.name.trim()) { setErr("Please give your group's name."); return; }
    setBusy(true);
    try {
      const body = {
        name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(),
        availability: f.availability.join(", "), interests: f.interests,
        answers: questions.map(q => ({ q, a: String(f.answers[q] || "").trim() })).filter(x => x.a),
        slotId: v.pickSlot || "", roleId: f.roleId || undefined, website: f.website,
        ...(group ? { group: { name: f.group.name.trim(), kind: f.group.kind, size: Math.max(1, parseInt(f.group.size, 10) || 1), leaderPhone: f.group.leaderPhone.trim() || undefined } } : {}),
      };
      const r = await fetch(`${API}/org/${encodeURIComponent(v.orgSlug)}/volunteer-page/${encodeURIComponent(v.pageSlug)}/signup`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.message || (r.status === 409 ? "That shift just closed. Please pick another." : "Something went wrong. Please try again.")); setBusy(false); return; }
      setDone(j);
    } catch {
      setErr("We could not reach the sign-up. Please check your connection and try again.");
    }
    setBusy(false);
  };

  if (done) {
    return (
      <div id="vp-signup" className="vp-signup-done" style={cardStyle}>
        <h2 style={h2}>Thank you.</h2>
        <p style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 10px" }}>{done.message || "You are signed up."}</p>
        {done.link && <p style={{ ...muted, margin: 0 }}>Your shifts, in one place: <a href={done.link} style={{ color: "var(--pt-button, var(--pt-primary))", fontWeight: 700 }}>open your volunteer page</a>. Keep the link; it works for thirty days.</p>}
      </div>
    );
  }
  return (
    <form id="vp-signup" className="vp-signup" style={cardStyle} onSubmit={submit} noValidate>
      {w.heading ? <h2 style={h2}>{w.heading}</h2> : null}
      {v.preview && <div style={{ ...muted, fontSize: 12, marginBottom: 10 }}>This is a preview. The form takes sign-ups once the page is published.</div>}
      {v.hasGroup && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={v.groupMode} onChange={e => v.setGroupMode(e.target.checked)} /> I am signing up a group
        </label>
      )}
      {group && (
        <div style={{ background: PAL.wash, borderRadius: 10, padding: "12px 12px 2px", marginBottom: 12 }}>
          <label style={lbl} htmlFor="vp-gname">Group name</label>
          <input id="vp-gname" style={inp} value={f.group.name} onChange={e => set("group", { ...f.group, name: e.target.value })} placeholder="Grace Church youth group" />
          <label style={lbl} htmlFor="vp-gkind">What kind of group</label>
          <select id="vp-gkind" style={inp} value={f.group.kind} onChange={e => set("group", { ...f.group, kind: e.target.value })}>
            {GROUP_KINDS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <label style={lbl} htmlFor="vp-gsize">How many people are coming</label>
          <input id="vp-gsize" style={inp} inputMode="numeric" value={f.group.size} onChange={e => set("group", { ...f.group, size: e.target.value.replace(/[^0-9]/g, "") })} placeholder="12" />
          <label style={lbl} htmlFor="vp-gphone">Group leader's phone</label>
          <input id="vp-gphone" style={inp} type="tel" value={f.group.leaderPhone} onChange={e => set("group", { ...f.group, leaderPhone: e.target.value })} />
        </div>
      )}
      <label style={lbl} htmlFor="vp-name">{group ? "Your name (the group leader)" : "Your name"}</label>
      <input id="vp-name" style={inp} autoComplete="name" value={f.name} onChange={e => set("name", e.target.value)} />
      <label style={lbl} htmlFor="vp-email">Email</label>
      <input id="vp-email" style={inp} type="email" autoComplete="email" value={f.email} onChange={e => set("email", e.target.value)} />
      {w.askPhone !== false && <>
        <label style={lbl} htmlFor="vp-phone">Phone <span style={{ fontWeight: 400, color: PAL.muted }}>(optional)</span></label>
        <input id="vp-phone" style={inp} type="tel" autoComplete="tel" value={f.phone} onChange={e => set("phone", e.target.value)} />
      </>}
      <label style={lbl} htmlFor="vp-shift">Shift</label>
      <select id="vp-shift" style={inp} value={v.pickSlot} onChange={e => { v.setPickSlot(e.target.value); set("roleId", ""); }}>
        <option value="">No particular shift yet, keep me posted</option>
        {shifts.map(s => <option key={s.slotId} value={s.slotId}>{shiftLabel(s)}, {s.oppName}{s.full ? " (waiting list)" : ""}</option>)}
      </select>
      {roles.length > 1 && <>
        <label style={lbl} htmlFor="vp-role">Role on this shift</label>
        <select id="vp-role" style={inp} value={f.roleId} onChange={e => set("roleId", e.target.value)}>
          <option value="">Wherever you need me</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.name}{r.full ? " (waiting list)" : ""}</option>)}
        </select>
      </>}
      {w.askAvailability !== false && <>
        <div style={lbl}>When can you usually help?</div>
        <div style={{ marginBottom: 8 }}>
          {AVAILABILITY.map(a => (
            <label key={a} style={chip(f.availability.includes(a))}>
              <input type="checkbox" checked={f.availability.includes(a)} onChange={() => toggle("availability", a)} style={{ position: "absolute", opacity: 0, width: 1, height: 1 }} />{a}
            </label>
          ))}
        </div>
      </>}
      {w.askInterests !== false && opps.length > 0 && <>
        <div style={lbl}>What would you like to help with?</div>
        <div style={{ marginBottom: 8 }}>
          {opps.map(o => (
            <label key={o.id} style={chip(f.interests.includes(o.name))}>
              <input type="checkbox" checked={f.interests.includes(o.name)} onChange={() => toggle("interests", o.name)} style={{ position: "absolute", opacity: 0, width: 1, height: 1 }} />{o.name}
            </label>
          ))}
        </div>
      </>}
      {questions.map((q, i) => (
        <div key={i}>
          <label style={lbl} htmlFor={`vp-q${i}`}>{q}</label>
          <input id={`vp-q${i}`} style={inp} value={f.answers[q] || ""} onChange={e => set("answers", { ...f.answers, [q]: e.target.value })} />
        </div>
      ))}
      {/* The honeypot: hidden from people, filled by bots, thanked and dropped. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website}
        onChange={e => set("website", e.target.value)} style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />
      {err && <div role="alert" style={{ background: PAL.errBg, color: PAL.errInk, borderRadius: 10, padding: "10px 12px", fontSize: 14, marginBottom: 10 }}>{err}</div>}
      <button type="submit" disabled={busy || v.preview} style={{ ...btn, width: "100%", padding: "13px", fontSize: 16, opacity: v.preview ? 0.7 : 1, cursor: v.preview ? "default" : busy ? "wait" : "pointer" }}>
        {busy ? "Signing you up…" : slot && slot.full ? "Join the waiting list" : group ? "Sign up our group" : "Sign me up"}
      </button>
    </form>
  );
}

// ── Waiver and background check ─────────────────────────────────────────────
function Waiver({ w, ctx }) {
  const v = useVol(ctx);
  const opps = (v.data.opportunities || []).filter(o => o.requiresWaiver || o.requiresBackgroundCheck);
  if (!opps.length) return v.preview ? <div style={{ ...cardStyle, ...muted }}>None of your public roles asks for a waiver or a background check, so this block shows nothing on the page.</div> : null;
  return (
    <div className="vp-waiver" style={cardStyle}>
      {w.heading ? <h2 style={h2}>{w.heading}</h2> : null}
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
        {opps.map(o => (
          <li key={o.id}><strong>{o.name}</strong>: {[o.requiresWaiver && "a signed waiver", o.requiresBackgroundCheck && "a background check"].filter(Boolean).join(" and ")} before the first shift.</li>
        ))}
      </ul>
      <div style={{ ...muted, marginTop: 8 }}>After you sign up, your own volunteer page has the waiver to sign. We will be in touch about a background check.</div>
    </div>
  );
}

// ── Impact numbers ──────────────────────────────────────────────────────────
function Impact({ w, ctx }) {
  const v = useVol(ctx);
  const im = v.data.impact;
  if (!im) return null;
  const year = im.year || new Date().getFullYear();
  return (
    <div className="vp-impact" style={cardStyle}>
      {w.heading ? <h2 style={h2}>{w.heading}</h2> : null}
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 160px" }}>
          <div style={{ fontSize: 30, fontWeight: 700, fontFamily: "var(--pt-serif, Georgia,serif)" }}>{hoursText(im.hours)}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Hours served in {year}</div>
          <div style={{ ...muted, fontSize: 12, marginTop: 4 }}>Every volunteer shift logged from January 1 to today, added up.</div>
        </div>
        <div style={{ flex: "1 1 160px" }}>
          <div style={{ fontSize: 30, fontWeight: 700, fontFamily: "var(--pt-serif, Georgia,serif)" }}>{Number(im.roster || 0).toLocaleString("en-US")}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Volunteers</div>
          <div style={{ ...muted, fontSize: 12, marginTop: 4 }}>Everyone on the volunteer roster today.</div>
        </div>
      </div>
    </div>
  );
}

// ── Volunteer quote ─────────────────────────────────────────────────────────
// Shown only with the volunteer's permission. The editor says what is missing;
// the public page shows nothing until both the words and the permission are in.
function VolQuote({ w, ctx }) {
  const v = useVol(ctx);
  const ready = w.permission === true && String(w.text || "").trim();
  if (!ready) {
    if (!v.preview) return null;
    return (
      <div style={{ ...cardStyle, ...muted, borderStyle: "dashed" }}>
        {String(w.text || "").trim() ? "Tick the permission box and this quote shows on the page." : "Add a quote from one of your volunteers"}
      </div>
    );
  }
  return (
    <blockquote className="vp-quote" style={{ ...cardStyle, margin: "0 0 18px", borderLeft: "4px solid var(--pt-accent)" }}>
      <div style={{ fontFamily: "var(--pt-serif, Georgia,serif)", fontSize: 18, lineHeight: 1.6 }}>“{w.text}”</div>
      {w.name && <div style={{ ...muted, marginTop: 8 }}>{w.name}</div>}
    </blockquote>
  );
}

// ── Group sign-up ───────────────────────────────────────────────────────────
function GroupSignup({ w, ctx }) {
  const v = useVol(ctx);
  return (
    <div className="vp-group" style={{ ...cardStyle, background: PAL.wash }}>
      {w.heading ? <h2 style={{ ...h2, fontSize: 20 }}>{w.heading}</h2> : null}
      {w.text && <p style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 12px", color: PAL.bodyDark }}>{w.text}</p>}
      <button type="button" style={btnQuiet} onClick={() => { v.setGroupMode(true); scrollToId("vp-signup"); }}>Sign up a group</button>
    </div>
  );
}

const BLOCKS = {
  opportunities: Opportunities, shiftpicker: ShiftPicker, volsignup: SignupForm, volwaiver: Waiver,
  volimpact: Impact, volquote: VolQuote, groupsignup: GroupSignup,
};
export const VOLUNTEER_BLOCK_TYPES = Object.keys(BLOCKS);

export function VolunteerBlock({ w, ctx }) {
  const C = BLOCKS[w.type];
  return C ? <C w={w} ctx={ctx} /> : null;
}
