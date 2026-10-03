// PARITY-3 Parts 3 and 5 · THE VOLUNTEER LIST, ITS NUMBERS, AND WHO TO ASK.
//
// VolunteerCounts: the four numbers across the top of Volunteers (active,
// pending applications, conflicts and short shifts this week), each opening
// its rows. VolunteerListView: every volunteer, filtered by the list's own
// rules (groups.js), with the columns she chooses, bulk actions on the ones
// she ticks, and "Save as a group" so the same filter becomes a Group. The
// "Which volunteers should we ask to give?" button opens WHY-1's own answer.
// VolunteersGroupView: the default Volunteers group's page (PARITY-1 Groups),
// which is the "volunteers who give" view and says who has never given.
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { displayDate } from "../../../shared/displayDate";
import { WhyPanel } from "./WhyAnswer";
import { GroupPage } from "./Groups";
import { RecordLink } from "./RecordLink";
import { tabHref } from "../lib/appUrls";

const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 12.5, color: T.ink, fontFamily: "inherit", boxSizing: "border-box", maxWidth: "100%" };
// On a phone the filters fold behind one button, so the people come first.
const narrowNow = () => typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 720px)").matches : false;
const btnPrimary = { background: T.green, border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, color: T.white, cursor: "pointer", fontFamily: "inherit" };
const btnQuiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: T.ink, cursor: "pointer", fontFamily: "inherit" };
const btnLink = { background: "transparent", border: "none", padding: 0, color: T.green, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textAlign: "left" };
const card = { background: T.white, border: "1px solid " + T.bg2, borderRadius: 14, padding: "14px 16px" };
const eyebrow = { fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3 };
const COLS_KEY = "steward.volunteerList.cols.v1";
const ALL_COLS = [
  ["email", "Email"], ["phone", "Phone"], ["rangeHours", "Hours in range"], ["lifetimeHours", "Lifetime hours"],
  ["lastServed", "Last served"], ["nextShift", "Next shift"], ["qualifications", "Tags and qualifications"],
  ["lifetimeGiving", "Lifetime giving", true], ["gifts", "Gifts", true], ["lastGiftDate", "Last gift", true],
];
const DEFAULT_COLS = ["rangeHours", "lifetimeHours", "lastServed", "nextShift", "lifetimeGiving"];
const money = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const loadCols = () => { try { const c = JSON.parse(window.localStorage.getItem(COLS_KEY) || "null"); return Array.isArray(c) && c.length ? c : DEFAULT_COLS; } catch { return DEFAULT_COLS; } };

export function VolunteerCounts({ onOpen, refreshKey }) {
  const [c, setC] = useState(null);
  useEffect(() => { apiFetch("/volunteer-hub/counts").then(setC).catch(() => setC(null)); }, [refreshKey]);
  if (!c) return null;
  const items = [["active", "Active volunteers"], ["pending", "Pending applications"], ["conflicts", "Schedule conflicts this week"], ["short", "Shifts short this week"]];
  return (
    <div data-testid="vol-counts" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
      {items.map(([k, label]) => (
        <button key={k} data-count={k} onClick={() => onOpen(k)} title={c[k].sentence} aria-label={`${label}: ${c[k].value}. ${c[k].sentence}`}
          style={{ ...card, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
          <div style={eyebrow}>{label}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: (k === "conflicts" || k === "short") && c[k].value > 0 ? T.gold700 : T.ink }}>{c[k].value}</div>
        </button>))}
    </div>
  );
}

export function VolunteerListView({ isReadOnly, coordinator, onOpenPerson, initialFilter }) {
  const [f, setF] = useState(() => ({ search: "", volActive: "", volOpp: "", volShiftFrom: "", volShiftTo: "", hoursOp: "min", hoursN: "", volHoursFrom: "", volHoursTo: "",
    giving: "", gaveFrom: "", gaveTo: "", volQual: "", volAnswer: "", volAvail: "", ...(initialFilter || {}) }));
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [cols, setCols] = useState(loadCols);
  const [pickCols, setPickCols] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [opps, setOpps] = useState([]);
  const [apply, setApply] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [msg, setMsg] = useState("");
  const [why, setWhy] = useState(false);
  const [showFilters, setShowFilters] = useState(() => !narrowNow());
  useEffect(() => { apiFetch("/volunteer-hub/opportunities").then(d => setOpps(d.opportunities || [])).catch(() => {}); }, []);
  useEffect(() => { apiFetch("/volunteer-hub/recruitment").then(setApply).catch(() => setApply(null)); }, []);
  // The filter as the rules the server reads; the same object becomes a Group.
  const rules = useMemo(() => {
    const r = {};
    for (const k of ["search", "volActive", "volOpp", "volShiftFrom", "volShiftTo", "volHoursFrom", "volHoursTo", "volQual", "volAnswer", "volAvail"]) if (f[k]) r[k] = f[k];
    if (f.hoursN !== "") r[f.hoursOp === "min" ? "volHoursMin" : "volHoursMax"] = f.hoursN;
    if (!coordinator) {
      if (f.giving === "ever" || f.giving === "never") r.given = f.giving;
      if (f.giving === "range") { if (f.gaveFrom) r.gaveFrom = f.gaveFrom; if (f.gaveTo) r.gaveTo = f.gaveTo; if (!f.gaveFrom && !f.gaveTo) r.given = "ever"; }
    }
    return r;
  }, [f, coordinator]);
  // FIX-24 2e: ONE hours filter. Its dates are also the dates the "Hours in
  // range" column counts, so there is no second pair of dates for the column.
  const qs = new URLSearchParams({ ...rules, ...(f.volHoursFrom ? { hoursFrom: f.volHoursFrom } : {}), ...(f.volHoursTo ? { hoursTo: f.volHoursTo } : {}) }).toString();
  const load = useCallback(() => {
    apiFetch(`/volunteer-hub/list${qs ? "?" + qs : ""}`).then(d => { setData(d); setErr(""); setSel(new Set()); }).catch(e => setErr(errorMessage(e, "The list did not load.")));
  }, [qs]);
  // The first read is immediate; typing in a filter waits a quarter second.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; load(); return undefined; }
    const t = setTimeout(load, 250); return () => clearTimeout(t);
  }, [load]);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  const shownCols = ALL_COLS.filter(([k, , giving]) => cols.includes(k) && !(giving && coordinator));
  const rows = data ? data.rows : [];
  const chosen = rows.filter(r => sel.has(r.id));
  const fileQs = (apply && apply.questions || []).filter(q => q.type !== "file");
  const exportCsv = () => {
    const list = chosen.length ? chosen : rows;
    const head = ["Name", ...shownCols.map(c => c[1])];
    const cell = v => { const t = v == null ? "" : String(v); const g = /^[=+\-@]/.test(t) ? "'" + t : t; return /[",\n\r]/.test(g) || g !== t ? `"${g.replace(/"/g, '""')}"` : g; };
    const lines = [head.map(cell).join(","), ...list.map(r => [r.name, ...shownCols.map(([k]) => r[k] ?? "")].map(cell).join(","))];
    const b = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv" });
    const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "volunteers.csv"; a.click(); URL.revokeObjectURL(u);
  };
  const saveCols = next => { setCols(next); try { window.localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* no storage */ } };
  const cellOf = (r, k) => {
    const v = r[k];
    if (k === "lastServed" || k === "nextShift" || k === "lastGiftDate") return v ? displayDate(String(v).slice(0, 10)) : "";
    if (k === "lifetimeGiving") return v ? money(v) : "Never given";
    return v ?? "";
  };
  return (
    <div data-testid="vol-list" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!coordinator && <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button style={btnQuiet} data-testid="vol-ask-to-give" onClick={() => setWhy(true)}>Which volunteers should we ask to give?</button>
        <span style={{ fontSize: 12.5, color: T.ink3 }}>Steward answers from your own records: who has served and never given, and who to ask first.</span>
      </div>}
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
        <button style={{ ...btnLink, alignSelf: "flex-start" }} aria-expanded={showFilters} onClick={() => setShowFilters(v => !v)}>
          {showFilters ? "Hide filters" : `Filters${Object.keys(rules).length ? ` (${Object.keys(rules).length} on)` : ""}`}
        </button>
        {showFilters && <>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input aria-label="Search volunteers" placeholder="Search by name or email" value={f.search} onChange={set("search")} style={{ ...inp, flex: "1 1 200px" }} />
          <select aria-label="Active" value={f.volActive} onChange={set("volActive")} style={inp}><option value="">Everyone</option><option value="1">Active only</option></select>
          <select aria-label="Opportunity" value={f.volOpp} onChange={set("volOpp")} style={inp}><option value="">Any opportunity</option>{opps.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <select aria-label="Availability" value={f.volAvail} onChange={set("volAvail")} style={inp}><option value="">Any availability</option>{(apply && apply.availability || []).map(a => <option key={a}>{a}</option>)}</select>
          <input aria-label="Tag or qualification" placeholder="Tag or qualification" value={f.volQual} onChange={set("volQual")} list="vol-quals" style={inp} />
          <datalist id="vol-quals"><option value="background_check">Current background check</option><option value="waiver">Current waiver</option></datalist>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: T.ink3 }}>
          <span>On a shift from</span><input aria-label="On a shift from" type="date" value={f.volShiftFrom} onChange={set("volShiftFrom")} style={inp} />
          <span>to</span><input aria-label="On a shift to" type="date" value={f.volShiftTo} onChange={set("volShiftTo")} style={inp} />
          <span style={{ marginLeft: 8 }}>Hours</span>
          <select aria-label="More or less" value={f.hoursOp} onChange={set("hoursOp")} style={inp}><option value="min">at least</option><option value="max">fewer than</option></select>
          <input aria-label="Hours" inputMode="numeric" value={f.hoursN} onChange={set("hoursN")} style={{ ...inp, width: 60 }} />
          <span>between</span><input aria-label="Hours from" type="date" value={f.volHoursFrom} onChange={set("volHoursFrom")} style={inp} />
          <span>and</span><input aria-label="Hours to" type="date" value={f.volHoursTo} onChange={set("volHoursTo")} style={inp} />
          <span style={{ fontSize: 11.5 }}>(the Hours in range column counts the same dates; this year when blank)</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: T.ink3 }}>
          {!coordinator && <>
            <select aria-label="Giving" value={f.giving} onChange={set("giving")} style={inp}>
              <option value="">Giving: any</option><option value="ever">Has given</option><option value="never">Never given</option><option value="range">Gave between…</option>
            </select>
            {f.giving === "range" && <><input aria-label="Gave from" type="date" value={f.gaveFrom} onChange={set("gaveFrom")} style={inp} /><span>and</span><input aria-label="Gave to" type="date" value={f.gaveTo} onChange={set("gaveTo")} style={inp} /></>}
          </>}
          {fileQs.length > 0 && <select aria-label="Application answer" value={f.volAnswer} onChange={set("volAnswer")} style={inp}>
            <option value="">Any application answer</option>
            {fileQs.flatMap(q => (q.type === "yesno" ? ["Yes", "No"] : q.type === "choice" ? q.options : []).map(o => <option key={q.id + o} value={`${q.id}=${o}`}>{q.label}: {o}</option>))}
          </select>}
        </div>
        </>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{data ? data.sentence : "…"}</span>
          <button style={btnLink} onClick={() => setPickCols(v => !v)}>Columns</button>
          {!coordinator && !isReadOnly && <button style={btnLink} onClick={() => setBulk({ kind: "group" })}>Save as a group</button>}
          <button style={btnLink} onClick={() => setF(p => ({ ...p, search: "", volActive: "", volOpp: "", volShiftFrom: "", volShiftTo: "", hoursN: "", volHoursFrom: "", volHoursTo: "", giving: "", gaveFrom: "", gaveTo: "", volQual: "", volAnswer: "", volAvail: "" }))}>Clear filters</button>
        </div>
        {pickCols && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {ALL_COLS.filter(([, , giving]) => !(giving && coordinator)).map(([k, l]) => (
            <label key={k} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12.5 }}>
              <input type="checkbox" checked={cols.includes(k)} onChange={e => saveCols(e.target.checked ? [...cols, k] : cols.filter(c => c !== k))} /> {l}
            </label>))}
        </div>}
      </div>
      {err && <div role="alert" style={{ fontSize: 13 }}>{err}</div>}
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink2 }}>{msg}</div>}
      {sel.size > 0 && !isReadOnly && (
        <div data-testid="vol-bulk" style={{ ...card, background: T.ground, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <strong style={{ fontSize: 13 }}>{sel.size} selected</strong>
          <button style={btnQuiet} onClick={exportCsv}>Export CSV</button>
          <button style={btnQuiet} onClick={() => setBulk({ kind: "email" })}>Draft an email</button>
          <button style={btnQuiet} onClick={() => setBulk({ kind: "shift" })}>Add to a shift</button>
          <button style={btnQuiet} onClick={() => setBulk({ kind: "tag" })}>Add or remove a tag</button>
          {!coordinator && <button style={btnQuiet} onClick={() => setBulk({ kind: "addgroup" })}>Add to a group</button>}
          <button style={btnLink} onClick={() => setSel(new Set())}>Clear</button>
        </div>)}
      {sel.size === 0 && rows.length > 0 && <div><button style={btnLink} onClick={exportCsv}>Export these {rows.length} as CSV</button></div>}
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 520 }}>
          <thead><tr style={{ textAlign: "left", color: T.ink3, fontSize: 11.5 }}>
            <th style={{ padding: "10px 12px", width: 30 }}><input type="checkbox" aria-label="Select everyone shown" checked={rows.length > 0 && rows.every(r => sel.has(r.id))} onChange={e => setSel(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} /></th>
            <th>Name</th>
            {shownCols.map(([k, l]) => <th key={k} title={data && data.definitions[k]} style={{ padding: "0 10px", textAlign: ["rangeHours", "lifetimeHours", "lifetimeGiving", "gifts"].includes(k) ? "right" : "left" }}>{l}</th>)}
          </tr></thead>
          <tbody>
            {rows.slice(0, 500).map(r => (
              <tr key={r.id} data-person={r.id} style={{ borderTop: "1px solid " + T.bg2 }}>
                <td style={{ padding: "8px 12px" }}><input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.has(r.id)} onChange={e => setSel(p => { const n = new Set(p); e.target.checked ? n.add(r.id) : n.delete(r.id); return n; })} /></td>
                <td><RecordLink to={tabHref("volunteers", { volunteerId: r.id })} onOpen={() => onOpenPerson({ id: r.id, name: r.name })} data-record-link="volunteer"
                  style={{ color: T.ink, fontWeight: 600 }}>{r.name}</RecordLink></td>
                {shownCols.map(([k]) => <td key={k} style={{ padding: "0 10px", whiteSpace: "nowrap", textAlign: ["rangeHours", "lifetimeHours", "lifetimeGiving", "gifts"].includes(k) ? "right" : "left", color: k === "lifetimeGiving" && !r[k] ? T.ink3 : T.ink }}>{cellOf(r, k)}</td>)}
              </tr>))}
          </tbody>
        </table>
        {data && !rows.length && <div style={{ padding: 16, fontSize: 13, color: T.ink3 }}>Nobody matches these filters.</div>}
      </div>
      {bulk && <BulkModal kind={bulk.kind} people={chosen} rules={rules} opps={opps} onClose={() => setBulk(null)} onDone={m => { setBulk(null); setMsg(m); load(); }} />}
      {why && <WhyPanel payload={{ key: "volunteers" }} isReadOnly={isReadOnly} onClose={() => setWhy(false)} />}
    </div>
  );
}

function BulkModal({ kind, people, rules, opps, onClose, onDone }) {
  const [v, setV] = useState({ subject: "", body: "Dear {{first_name}},\n\n", tag: "", remove: false, slotId: "", roleId: "", groupId: "", name: "", opp: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState([]);
  const [shifts, setShifts] = useState([]);
  useEffect(() => { if (kind === "addgroup") apiFetch("/groups").then(d => setGroups((d.groups || []).filter(g => g.kind === "static"))).catch(() => {}); }, [kind]);
  useEffect(() => {
    if (kind !== "shift" || !v.opp) return;
    const t = new Date().toISOString().slice(0, 10);
    apiFetch(`/volunteer-hub/schedule?from=${t}&to=${new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)}&opportunityId=${v.opp}`).then(d => setShifts(d.shifts || [])).catch(() => setShifts([]));
  }, [kind, v.opp]);
  const set = k => e => setV(p => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const ids = people.map(p => p.id);
  const go = async () => {
    setBusy(true); setErr("");
    try {
      let m = "";
      if (kind === "email") m = (await apiFetch("/volunteer-hub/bulk/draft", { method: "POST", body: JSON.stringify({ personIds: ids, subject: v.subject, body: v.body }) })).message;
      if (kind === "tag") m = (await apiFetch("/volunteer-hub/bulk/tag", { method: "POST", body: JSON.stringify({ personIds: ids, name: v.tag, remove: v.remove }) })).message;
      if (kind === "addgroup") { const r = await apiFetch(`/groups/${v.groupId}/members`, { method: "POST", body: JSON.stringify({ donorIds: ids }) }); m = r.sentence || r.message || "Added to the group."; }
      if (kind === "group") { const g = await apiFetch("/groups", { method: "POST", body: JSON.stringify({ name: v.name, kind: "dynamic", rules: { role: "volunteer", ...rules } }) }); m = `Saved as the group "${g.name}". It is worked out fresh every time it is read.`; }
      if (kind === "shift") {
        let ok = 0, wait = 0; const notes = [];
        for (const id of ids) {
          try { const r = await apiFetch("/volunteer-hub/signups", { method: "POST", body: JSON.stringify({ slotId: v.slotId, personId: id, ...(v.roleId ? { roleId: v.roleId } : {}) }) });
            if (r.status === "waitlisted") wait++; else ok++; }
          catch (e) { notes.push(errorMessage(e, "not added")); }
        }
        m = `${ok} on the shift${wait ? `, ${wait} on its waiting list` : ""}${notes.length ? `; ${notes.length} not added (${notes[0]})` : ""}.`;
      }
      onDone(m);
    } catch (e) { setErr(errorMessage(e, "That did not work.")); }
    setBusy(false);
  };
  const shift = shifts.find(s => s.id === v.slotId);
  const title = { email: "Draft an email", tag: "Add or remove a tag", addgroup: "Add to a group", group: "Save as a group", shift: "Add to a shift" }[kind];
  return (
    <Modal onClose={onClose} width={500} ariaLabel={title}>
      <div style={{ fontSize: 16, fontWeight: 800, color: T.ink, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 10 }}>{kind === "group" ? "Everyone this filter finds, now and whenever the group is read." : `${people.length} ${people.length === 1 ? "person" : "people"} selected.`}</div>
      {kind === "email" && <>
        <input aria-label="Subject" placeholder="Subject" value={v.subject} onChange={set("subject")} style={{ ...inp, width: "100%", marginBottom: 6 }} />
        <textarea aria-label="Message" rows={6} value={v.body} onChange={set("body")} style={{ ...inp, width: "100%" }} />
        <div style={{ fontSize: 12, color: T.ink3, marginTop: 4 }}>One draft each, in Schedule, To send. Nothing goes until you press Send.</div>
      </>}
      {kind === "tag" && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input aria-label="Tag" placeholder="Saturday regular" value={v.tag} onChange={set("tag")} style={{ ...inp, flex: 1 }} />
        <label style={{ fontSize: 12.5, display: "inline-flex", gap: 5 }}><input type="checkbox" checked={v.remove} onChange={set("remove")} /> Take it off instead</label>
      </div>}
      {kind === "addgroup" && <select aria-label="Group" value={v.groupId} onChange={set("groupId")} style={{ ...inp, width: "100%" }}>
        <option value="">Choose a group kept by hand</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>}
      {kind === "group" && <input aria-label="Group name" placeholder="Saturday regulars who have never given" value={v.name} onChange={set("name")} style={{ ...inp, width: "100%" }} />}
      {kind === "shift" && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <select aria-label="Opportunity" value={v.opp} onChange={e => setV(p => ({ ...p, opp: e.target.value, slotId: "", roleId: "" }))} style={inp}><option value="">Choose an opportunity</option>{opps.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        {v.opp && <select aria-label="Shift" value={v.slotId} onChange={e => setV(p => ({ ...p, slotId: e.target.value, roleId: "" }))} style={inp}><option value="">Choose a shift</option>{shifts.map(s => <option key={s.id} value={s.id}>{s.name}, {s.when}{s.footer.short ? `, ${s.footer.short} short` : ""}</option>)}</select>}
        {shift && shift.roles.length > 0 && <select aria-label="Role" value={v.roleId} onChange={set("roleId")} style={inp}><option value="">First role with room</option>{shift.roles.map(r => <option key={r.id} value={r.id}>{r.name} ({r.scheduled} of {r.needed})</option>)}</select>}
      </div>}
      {err && <div role="alert" style={{ fontSize: 13, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button style={btnPrimary} disabled={busy || (kind === "shift" && !v.slotId) || (kind === "addgroup" && !v.groupId) || (kind === "group" && !v.name.trim()) || (kind === "tag" && !v.tag.trim())} onClick={go}>{kind === "email" ? "Write the drafts" : "Do it"}</button>
        <button style={btnQuiet} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

// The default Volunteers group's page: everyone with a logged hour or an
// approved application, and what they give. Made on first open, once.
export function VolunteersGroupView({ isReadOnly, onOpenRecord }) {
  const [id, setId] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { apiFetch("/volunteer-hub/volunteers-group", { method: "POST" }).then(r => { if (r.id) setId(r.id); else setErr("The Volunteers group is not there yet; an admin opening this page makes it."); })
    .catch(e => setErr(errorMessage(e, "The group did not load."))); }, []);
  if (err) return <div style={{ ...card, fontSize: 13 }}>{err}</div>;
  if (!id) return <div style={{ fontSize: 13, color: T.ink3, padding: 20 }}>Loading…</div>;
  return <div data-testid="vol-group-page"><GroupPage groupId={id} isReadOnly={isReadOnly} onBack={null} onOpenPerson={p => onOpenRecord && onOpenRecord(p.id || p)} /></div>;
}
