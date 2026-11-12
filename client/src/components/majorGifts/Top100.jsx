// components/majorGifts/Top100.jsx · TOP100-1. MAJOR GIFTS → TOP 100.
//
// Her Excel sheet, inside Steward: one row per person with rank, Wealth Score,
// giving, owner, stage, the ask, the next step and the last contact, and the
// plan of care one press away. Rank is 1 to N: drag a row, or type a number
// and the others shift. Sort by any column (rank is the default) and filter by
// owner, score and stage; the CSV and the printout are what is on screen.
//
// Every figure here is the server's (GET /top100). Nothing is computed here.
import { useCallback, useEffect, useMemo, useState } from "react";
import { API, apiFetch, getToken } from "../../api";
import { T, fmtFull, EmptyState, Modal, Spin, stageName } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { DonorLink } from "../RecordLink";
import { Figure } from "../Figure";
import { CarePlanPanel, HealthChip, dayLabel } from "./CarePlan";
import { useCanMajorGifts } from "../../lib/majorGifts";
import { InlineCell } from "./InlineCell";   // TOUCH-1: click a cell to edit it
import { TOUCH_TYPES as CARE_TYPES, addDays } from "../../../../shared/careShape.js";
import { LogConversationModal } from "../LogConversation";
import { StartFromTopDonors } from "./StartFromTopDonors";   // FLOWS-8

// Sized to fit the page at 1440 wide; narrower, the table scrolls inside its own box.
const COLS = [
  { key: "rank", label: "Rank", w: "58px" }, { key: "name", label: "Name", w: "minmax(104px,1.3fr)" }, { key: "wealth", label: "Wealth Score", w: "58px" },
  { key: "lifetime", label: "Lifetime", w: "84px" }, { key: "lastGift", label: "Last gift", w: "88px" }, { key: "owner", label: "Owner", w: "86px" },
  { key: "stage", label: "Stage", w: "76px" }, { key: "ask", label: "Ask", w: "80px" }, { key: "askBy", label: "Ask by", w: "88px" },
  { key: "next", label: "Next step", w: "minmax(90px,1fr)" }, { key: "lastContact", label: "Last contact", w: "84px" }, { key: "health", label: "Plan", w: "84px" },
];
const GRID = COLS.map(c => c.w).join(" ") + " 64px";
const STAGES = ["prospect", "qualify", "cultivate", "solicit", "steward", "lapsed"];
const sel = { padding: "7px 10px", border: "1px solid " + T.bg3, borderRadius: 9, fontSize: 12, background: T.white, color: T.ink };
const btn = { background: T.green, border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, color: T.white, cursor: "pointer" };
const quiet = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, padding: "7px 12px", fontSize: 12, color: T.ink2, cursor: "pointer" };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function contactWords(lc) {
  if (!lc) return "Never";
  if (lc.days === 0) return "Today";
  return lc.days === 1 ? "1 day ago" : `${lc.days} days ago`;
}

export function Top100View({ isReadOnly, onNavigate }) {
  const can = useCanMajorGifts();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [sort, setSort] = useState({ key: "rank", dir: "asc" });
  const [filt, setFilt] = useState({ owner: "", minScore: "", stage: "", health: "" });
  const [open, setOpen] = useState(null);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [rankEdit, setRankEdit] = useState({});
  const [renaming, setRenaming] = useState(null);
  const [find, setFind] = useState("");
  const [found, setFound] = useState([]);
  const [sheet, setSheet] = useState(null);   // { text, preview }
  const [logFor, setLogFor] = useState(null);   // TOUCH-1: "Log a touch" from a row

  const qs = useMemo(() => {
    const p = new URLSearchParams({ sort: sort.key, dir: sort.dir });
    for (const [k, v] of Object.entries(filt)) if (v) p.set(k, v);
    return p.toString();
  }, [sort, filt]);
  const load = useCallback(() => apiFetch(`/top100?${qs}`).then(r => { setD(r); setRankEdit({}); }).catch(e => setErr(errorMessage(e, "The Top 100 did not load."))), [qs]);
  useEffect(() => { if (can) load(); }, [can, load]);
  useEffect(() => {
    if (find.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => apiFetch(`/search?q=${encodeURIComponent(find.trim())}`)
      .then(r => setFound((r.results || []).filter(x => x.kind === "person").slice(0, 6))).catch(() => setFound([])), 250);
    return () => clearTimeout(t);
  }, [find]);

  if (!can) return <EmptyState title="The Top 100 is for major gifts" message="Admins and staff with the major gifts permission see the Top 100. An admin can give the permission in Settings → Team." />;
  if (!d) return <div style={{ padding: 48, textAlign: "center", color: T.ink3, fontSize: 13 }}>{err || <Spin />}</div>;

  const act = async (fn, fallback) => { setErr(""); setMsg(""); try { await fn(); } catch (e) { setErr(errorMessage(e, fallback)); } };
  const canDrag = !isReadOnly && sort.key === "rank" && sort.dir === "asc" && !Object.values(filt).some(Boolean);
  const moveTo = (donorId, rank) => act(async () => {
    await apiFetch(`/top100/members/${encodeURIComponent(donorId)}/rank`, { method: "POST", body: JSON.stringify({ rank }) });
    await load();
  }, "That move did not save.");
  const remove = r => act(async () => {
    await apiFetch(`/top100/members/${encodeURIComponent(r.donorId)}`, { method: "DELETE" });
    setMsg(`Took ${r.name} off. Everyone below moved up one.`); await load();
  }, "That person could not be taken off.");
  const add = p => act(async () => {
    const r = await apiFetch("/top100/members", { method: "POST", body: JSON.stringify({ donorIds: [p.id] }) });
    setFind(""); setFound([]); setMsg(r.sentence); await load();
  }, "That person could not be added.");
  const rename = () => act(async () => {
    await apiFetch("/top100", { method: "PATCH", body: JSON.stringify({ name: renaming }) });
    setRenaming(null); await load();
  }, "The name did not save.");
  const download = () => act(async () => {
    const res = await fetch(`${API}/top100/export.csv?${qs}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error("The file did not download.");
    const cd = res.headers.get("Content-Disposition") || "";
    const m = /filename="?([^";]+)"?/i.exec(cd);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = (m && m[1]) || "Top-100.csv";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, "The file did not download.");
  // The printout is the rows on screen, as a plain table, for a board or coaching meeting.
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) { setErr("Your browser blocked the print window. Allow pop-ups for Steward and try again."); return; }
    const head = ["Rank", "Name", "Wealth Score", "Lifetime", "Last gift", "Owner", "Stage", "Ask", "Ask by", "Next step", "Last contact", "Plan"];
    const rows = d.rows.map(r => [r.rank, r.name, r.wealthScore ?? "", fmtFull(r.lifetimeCents / 100), r.lastGift ? `${fmtFull(r.lastGift.cents / 100)} · ${dayLabel(r.lastGift.date)}` : "",
      r.owner ? r.owner.name : "", r.stage ? stageName(r.stage) : "", r.askCents != null ? fmtFull(r.askCents / 100) : "", r.askBy ? dayLabel(r.askBy) : "",
      r.next ? `${r.next.label} · ${dayLabel(r.next.due)}` : "", contactWords(r.lastContact), r.health.label]);
    w.document.write(`<!doctype html><html><head><title>${esc(d.list.name)}</title><style>body{font-family:Helvetica,Arial,sans-serif;color:${T.ink};margin:24px}h1{font-size:20px;margin:0 0 4px}p{font-size:11px;color:${T.ink3};margin:0 0 14px}table{border-collapse:collapse;width:100%;font-size:10.5px}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid ${T.bg3};vertical-align:top}th{background:${T.bg2}}</style></head><body><h1>${esc(d.list.name)}</h1><p>${esc(d.rows.length)} people · as of ${esc(dayLabel(d.today))}</p><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`);
    w.document.close(); w.focus(); w.print();
  };
  const sheetGo = apply => act(async () => {
    const r = await apiFetch("/top100/ranks", { method: "POST", body: JSON.stringify({ text: sheet.text, apply }) });
    if (apply) { setSheet(null); setMsg(r.sentence); await load(); } else setSheet(s => ({ ...s, preview: r }));
  }, "Those ranks could not be read.");
  const head = k => setSort(s => ({ key: k, dir: s.key === k && s.dir === "asc" ? "desc" : "asc" }));
  // TOUCH-1 · each cell saves one field and reloads the rows (the server's numbers, never a guess here).
  const saveField = (r, path, method, body) => async () => { await apiFetch(path, { method, body: JSON.stringify(body) }); await load(); };
  const enc = encodeURIComponent;
  const saveAsk = r => v => saveField(r, `/donors/${enc(r.donorId)}/care-plan`, "PATCH", { askCents: v })();
  const saveAskBy = r => v => saveField(r, `/donors/${enc(r.donorId)}/care-plan`, "PATCH", { askBy: v })();
  const saveStage = r => v => saveField(r, `/donors/${enc(r.donorId)}/stage`, "PATCH", { stage: v, prevStage: r.stage || undefined })();
  const saveOwner = r => v => saveField(r, `/donors/${enc(r.donorId)}/assign`, "PATCH", { assignedTo: v || null })();
  const saveNextType = r => v => r.next && r.next.kind === "touch"
    ? saveField(r, `/donors/${enc(r.donorId)}/care-plan/touches/${enc(r.next.taskId)}`, "PATCH", { type: v })()
    : saveField(r, `/donors/${enc(r.donorId)}/care-plan/touches`, "POST", { type: v, due: addDays(d.today, 14) })();
  const saveNextDue = r => v => saveField(r, `/donors/${enc(r.donorId)}/care-plan/touches/${enc(r.next.taskId)}`, "PATCH", { due: v })();
  const typeOpts = CARE_TYPES.map(t => ({ value: t.key, label: t.label }));

  return (
    <div data-testid="top100-view">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        {renaming == null
          ? <h2 style={{ margin: 0, fontSize: 22, fontFamily: "'DM Serif Display',serif", color: T.ink }}>{d.list.name}</h2>
          : <><input aria-label="List name" value={renaming} onChange={e => setRenaming(e.target.value)} style={{ ...sel, fontSize: 15, width: 220 }} />
              <button onClick={rename} style={btn}>Save</button><button onClick={() => setRenaming(null)} style={quiet}>Cancel</button></>}
        {renaming == null && !isReadOnly && <button onClick={() => setRenaming(d.list.name)} style={{ ...quiet, padding: "4px 10px", fontSize: 11 }}>Rename</button>}
        <span style={{ fontSize: 12.5, color: T.ink3 }}>{d.count} {d.count === 1 ? "person" : "people"}, ranked by you.</span>
        <span style={{ flex: 1 }} />
        {!isReadOnly && <button data-testid="top100-bring-ranks" onClick={() => setSheet({ text: "", preview: null })} style={quiet}>Bring in ranks</button>}
        <button data-testid="top100-export" onClick={download} style={quiet}>Export CSV</button>
        <button data-testid="top100-print" onClick={print} style={quiet}>Print</button>
      </div>
      <div style={{ fontSize: 12, color: T.ink3, marginBottom: 14 }}>{d.sentences.rank}</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        {!isReadOnly && (
          <div style={{ position: "relative" }}>
            <input data-testid="top100-find" value={find} onChange={e => setFind(e.target.value)} placeholder="Add someone: type a name" style={{ ...sel, width: 230 }} />
            {found.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, background: T.white, border: "1px solid " + T.bg3, borderRadius: 9, marginTop: 4, overflow: "hidden" }}>
                {found.map(p => <button key={p.id} onClick={() => add(p)} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 10px", fontSize: 12.5, color: T.ink, cursor: "pointer" }}>{p.name || p.title}</button>)}
              </div>
            )}
          </div>
        )}
        <select aria-label="Owner" style={sel} value={filt.owner} onChange={e => setFilt(f => ({ ...f, owner: e.target.value }))}>
          <option value="">Every owner</option><option value="none">No owner</option>
          {d.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select aria-label="Wealth Score" style={sel} value={filt.minScore} onChange={e => setFilt(f => ({ ...f, minScore: e.target.value }))}>
          <option value="">Any Wealth Score</option>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n === 5 ? "5" : `${n} or more`}</option>)}
        </select>
        <select aria-label="Stage" style={sel} value={filt.stage} onChange={e => setFilt(f => ({ ...f, stage: e.target.value }))}>
          <option value="">Every stage</option>{STAGES.map(s => <option key={s} value={s}>{stageName(s)}</option>)}<option value="none">Not placed</option>
        </select>
        <select aria-label="Plan" style={sel} value={filt.health} onChange={e => setFilt(f => ({ ...f, health: e.target.value }))}>
          <option value="">Any plan</option><option value="behind">Behind</option><option value="on_track">On track</option><option value="no_plan">No plan</option><option value="no_next">All done</option>
        </select>
        {!canDrag && !isReadOnly && <span style={{ fontSize: 11.5, color: T.ink3 }}>Drag works when the list is in rank order with no filter; typing a rank always works.</span>}
      </div>
      {msg && <div style={{ fontSize: 12.5, color: T.greenDk, marginBottom: 8 }}>{msg}</div>}
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.gold700, marginBottom: 8 }}>{err}</div>}

      {d.count === 0 ? (
        <StartFromTopDonors listName={d.list.name} isReadOnly={isReadOnly} onAdded={async s => { setMsg(s); await load(); }} />
      ) : (
        <div style={{ overflowX: "auto", background: T.white, border: "1px solid " + T.bg3, borderRadius: 14 }}>
          <div data-testid="top100-table" style={{ minWidth: 1140 }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, padding: "10px 12px", background: T.bg2, fontSize: 10.5, fontWeight: 800, color: T.ink3 }}>
              {COLS.map(c => (
                <button key={c.key} onClick={() => head(c.key)} title={d.sentences[c.key] || `Sort by ${c.label}`} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  style={{ background: "none", border: "none", padding: 0, font: "inherit", color: sort.key === c.key ? T.ink : T.ink3, textAlign: "left", cursor: "pointer" }}>
                  {c.label}{sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </button>
              ))}<span />
            </div>
            {d.rows.length === 0 && <div style={{ padding: 18, fontSize: 12.5, color: T.ink3 }}>Nobody matches these filters.</div>}
            {d.rows.map(r => (
              <div key={r.donorId} data-testid="top100-row" data-rank={r.rank}
                draggable={canDrag} onDragStart={() => setDrag(r.donorId)} onDragEnd={() => { setDrag(null); setOver(null); }}
                onDragOver={e => { if (canDrag && drag) { e.preventDefault(); setOver(r.donorId); } }}
                onDrop={e => { e.preventDefault(); if (drag && drag !== r.donorId) moveTo(drag, r.rank); setDrag(null); setOver(null); }}
                style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "center", padding: "10px 12px", borderTop: "1px solid " + T.bg3,
                         background: over === r.donorId ? T.gold100 : drag === r.donorId ? T.bg2 : T.white, fontSize: 12.5, color: T.ink }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {canDrag && <span aria-hidden="true" title="Drag to reorder" style={{ cursor: "grab", color: T.ink3, fontSize: 14 }}>⋮⋮</span>}
                  {isReadOnly ? <strong>{r.rank}</strong> : (
                    <input aria-label={`Rank of ${r.name}`} data-testid="top100-rank-input" inputMode="numeric"
                      value={rankEdit[r.donorId] ?? String(r.rank)}
                      onChange={e => setRankEdit(x => ({ ...x, [r.donorId]: e.target.value.replace(/[^\d]/g, "") }))}
                      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      onBlur={() => { const v = Number(rankEdit[r.donorId]); if (rankEdit[r.donorId] != null && v >= 1 && v !== r.rank) moveTo(r.donorId, v); else setRankEdit(x => { const y = { ...x }; delete y[r.donorId]; return y; }); }}
                      style={{ width: 38, padding: "4px 5px", border: "1px solid " + T.bg3, borderRadius: 7, fontSize: 13, fontWeight: 800, textAlign: "center" }} />
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <DonorLink id={r.donorId} onOpen={onNavigate ? () => onNavigate("donors", { selectDonorId: r.donorId }) : undefined}
                    style={{ fontWeight: 700, color: T.ink, textDecoration: "none", overflowWrap: "anywhere" }}>{r.name}</DonorLink>
                  {r.goal && <div title={r.goal} style={{ fontSize: 11, color: T.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.goal}</div>}
                </div>
                <div style={{ fontWeight: 700 }}>{r.wealthScore ?? <span style={{ color: T.ink3, fontWeight: 400 }}>Not set</span>}</div>
                <div><Figure variant="cell" kind="money" value={r.lifetimeCents / 100} label={`${r.name}'s lifetime giving`} source={{ key: "donor-lifetime", params: { donor: r.donorId } }} /></div>
                <div>{r.lastGift
                  ? <><Figure variant="cell" kind="money" value={r.lastGift.cents / 100} label={`${r.name}'s last gift`} source={{ key: "donor-last-gift", params: { donor: r.donorId } }} />
                      <div style={{ fontSize: 11, color: T.ink3 }}>{dayLabel(r.lastGift.date)}</div></>
                  : <span style={{ color: T.ink3 }}>None</span>}</div>
                <InlineCell kind="select" label={`${r.name}'s owner`} testid="top100-owner" disabled={isReadOnly} value={r.owner ? r.owner.id : ""}
                  options={[{ value: "", label: "Nobody" }, ...d.owners.map(o => ({ value: o.id, label: o.name }))]} onSave={saveOwner(r)}
                  display={r.owner ? r.owner.name : <span style={{ color: T.ink3 }}>Nobody</span>} />
                <InlineCell kind="select" label={`${r.name}'s stage`} testid="top100-stage" disabled={isReadOnly} value={r.stage || ""}
                  options={[...(r.stage ? [] : [{ value: "", label: "Not placed" }]), ...STAGES.map(s => ({ value: s, label: stageName(s) }))]} onSave={saveStage(r)}
                  display={r.stage ? stageName(r.stage) : <span style={{ color: T.ink3 }}>Not placed</span>} />
                <InlineCell kind="money" label={`${r.name}'s ask`} testid="top100-ask" disabled={isReadOnly} value={r.askCents} placeholder="50,000" onSave={saveAsk(r)}
                  display={r.askCents != null ? <strong>{fmtFull(r.askCents / 100)}</strong> : <span style={{ color: T.ink3 }}>Not set</span>} />
                <InlineCell kind="date" label={`${r.name}'s ask-by day`} testid="top100-askby" disabled={isReadOnly} value={r.askBy} onSave={saveAskBy(r)}
                  display={r.askBy ? dayLabel(r.askBy) : <span style={{ color: T.ink3 }}>Not set</span>} />
                <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  <InlineCell kind="select" label={`${r.name}'s next step`} testid="top100-next" disabled={isReadOnly || (r.next && r.next.kind === "step")}
                    value={r.next && r.next.kind === "touch" ? r.next.type : ""} options={[...(r.next && r.next.kind === "touch" ? [] : [{ value: "", label: "Plan a touch…" }]), ...typeOpts]} onSave={saveNextType(r)}
                    display={r.next ? r.next.label : <span style={{ color: T.ink3 }}>No next step</span>} />
                  {r.next && (r.next.kind === "touch"
                    ? <InlineCell kind="date" label={`${r.name}'s next step day`} testid="top100-next-due" disabled={isReadOnly} value={r.next.due} onSave={saveNextDue(r)}
                        display={<span style={{ fontSize: 11, color: r.next.due && r.next.due < d.today ? T.gold700 : T.ink3, fontWeight: r.next.due && r.next.due < d.today ? 700 : 400 }}>{r.next.due && r.next.due < d.today ? "Overdue · " : ""}{dayLabel(r.next.due)}</span>} />
                    : <div style={{ fontSize: 11, color: r.next.due && r.next.due < d.today ? T.gold700 : T.ink3, fontWeight: r.next.due && r.next.due < d.today ? 700 : 400 }}>{r.next.due && r.next.due < d.today ? "Overdue · " : ""}{dayLabel(r.next.due)}</div>)}
                </div>
                <div style={{ color: !r.lastContact || r.lastContact.days > 60 ? T.gold700 : T.ink2 }}>{contactWords(r.lastContact)}</div>
                <div><button data-testid="top100-open-plan" onClick={() => setOpen(r)} title={r.health.sentence}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}><HealthChip health={r.health} /></button></div>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>{!isReadOnly && <>
                  <button data-testid="top100-log" aria-label={`Log a touch with ${r.name}`} title="Log a touch" onClick={() => setLogFor(r)}
                    style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 7, color: T.greenDk, cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "3px 6px", whiteSpace: "nowrap" }}>Log</button>
                  <button aria-label={`Take ${r.name} off the list`} title="Take off the list" onClick={() => remove(r)}
                    style={{ background: "none", border: "none", color: T.ink3, cursor: "pointer", fontSize: 15 }}>×</button></>}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sheet && (
        <Modal onClose={() => setSheet(null)} title="Bring in ranks from a spreadsheet" width={560} align="top">
          <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 8 }}>Copy the columns from Excel, header row included, and paste them here. Steward needs a Rank column and a Name, Email or Steward ID column. Nothing changes until you press Apply.</div>
          <textarea data-testid="top100-sheet" value={sheet.text} onChange={e => setSheet({ text: e.target.value, preview: null })} rows={8}
            placeholder={"Rank\tName\n1\tHollis Brandt\n2\tRuth Okafor"} style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 12, padding: 8, border: "1px solid " + T.bg3, borderRadius: 8 }} />
          {sheet.preview && (
            <div data-testid="top100-sheet-preview" style={{ fontSize: 12.5, margin: "10px 0" }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{sheet.preview.sentence}</div>
              {sheet.preview.matched.slice(0, 12).map(m => <div key={m.donorId}>#{m.rank} {m.name}</div>)}
              {sheet.preview.matched.length > 12 && <div style={{ color: T.ink3 }}>and {sheet.preview.matched.length - 12} more</div>}
              {sheet.preview.unmatched.map(u => <div key={u.line} style={{ color: T.gold700 }}>Line {u.line}: {u.said || "(blank)"}, {u.why}</div>)}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {!sheet.preview
              ? <button onClick={() => sheetGo(false)} disabled={!sheet.text.trim()} style={btn}>Check the matches</button>
              : <button data-testid="top100-sheet-apply" onClick={() => sheetGo(true)} disabled={!sheet.preview.matched.length} style={btn}>Apply {sheet.preview.matched.length} {sheet.preview.matched.length === 1 ? "rank" : "ranks"}</button>}
            <button onClick={() => setSheet(null)} style={quiet}>Cancel</button>
          </div>
          {err && <div role="alert" style={{ fontSize: 12.5, color: T.gold700, marginTop: 8 }}>{err}</div>}
        </Modal>
      )}

      {logFor && <LogConversationModal donor={{ id: logFor.donorId, name: logFor.name }} onNavigate={onNavigate}
        onClose={() => setLogFor(null)} onSaved={() => { setMsg(`Logged a touch with ${logFor.name}.`); load(); }} />}
      {open && (
        <Modal onClose={() => { setOpen(null); load(); }} title={`#${open.rank} ${open.name}`} subtitle="Plan of care" width={620} align="top">
          <CarePlanPanel donorId={open.donorId} isReadOnly={isReadOnly} onChanged={load} onNavigate={onNavigate} />
        </Modal>
      )}
    </div>
  );
}
