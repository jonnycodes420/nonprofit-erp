import { useEffect, useMemo, useRef, useState } from "react";
import { T, Modal } from "./shared";
import { apiFetch } from "../api";

// ── THREAD-2b · THE JOURNEY BUILDER, IN DIRECTION A ("the spine") ─────────
//
// Jonathan picked A. The journey is ONE horizontal line and the line is TIME:
// a node's position is its offset as a fraction of the whole journey, so the
// gap between month 3 and month 4 is visibly bigger than the gap between day
// 2 and week 1. "Seven touches over seven months" is a thing you see before
// it is a thing you read.
//
// WHAT THAT BUYS, AND WHY IT IS WORTH THE LAYOUT COST: the shape of the whole
// journey stays on screen while you edit one step of it. Editing opens a
// DRAWER UNDER the spine rather than a modal over it, so you never lose the
// answer to "and what happens after this?" while deciding what this one is.
//
// At 390 the spine cannot be a line — seven nodes in 342px is not a timeline,
// it is a smudge — so it becomes a vertical list that keeps the same order,
// the same dates and the same drawer. Direction A's IDEA is "time is a line
// you can see"; on a phone the line is vertical.
//
// NOTHING HERE SENDS. Every sentence on this screen says so, and the engine
// cannot (shared/journeyShape.js, tests/thread2a-no-send.test.js).

const RAIL = { bg: T.ink, panel: T.bgElevated, line: T.green650, text: T.inkInverse, dim: T.sage400 };

// ── WHERE THE NODES SIT, AND THE ONE COMPROMISE IN DIRECTION A ──────────
// Position is the offset as a fraction of the whole journey, which is the
// point of the spine: the gap between month 3 and month 4 is visibly bigger
// than the gap between day 2 and week 1.
//
// Taken literally that breaks. "New donor, first year" is day 2, week 1, then
// months 3-7: the first two land at 6.8% and 8.9% of the width and their
// labels overlap into "DAWEEK 1" — the first thing the 1440 walk caught, and
// a timeline you cannot read is worse than a list.
//
// So the positions are proportional AND spaced: a left-to-right pass pushes
// any node closer than MIN_GAP to its neighbour, and the whole run is scaled
// back inside the track if that pushed the last one past the end. The unequal
// gaps survive — months 3 to 7 are still visibly wider apart than day 2 to
// week 1 — and nothing collides. The alternative was making every gap equal,
// which would have thrown away the only idea Direction A has.
//
// FIX-4 1b — THE SPINE FITS THE CARD NOW. It used to live inside the 1.85fr
// left column with `minWidth: 900` and `overflowX: auto`, which at 1440 gave
// that column about 680px and put a SECOND horizontal scrollbar inside the
// card: seven steps existed, four of them were visible, and you had to know
// to drag. The spine has moved out of the grid and spans the whole card, the
// minimum width is gone, and the chain runs the full width of the card from
// the first node to the last. Below SPINE_BREAKPOINT the card is too narrow
// for seven labels at any width, so it becomes the vertical list — which is
// the same answer 390 always got, reached earlier.
const MIN_GAP = 11.5;   // percent
const LEFT = 6, RIGHT = 94;
// The narrowest CARD a seven-node spine reads at. 11.5% of the card must
// clear NODE_W (88px), so the card needs ~765px; a 1100px viewport leaves
// about 816px after the 220px rail and the page's gutters.
export const SPINE_BREAKPOINT = 1100;

export function nodePositions(offsets) {
  const list = offsets.map(n => Math.max(0, Number(n) || 0));
  const max = list.length ? Math.max(...list) : 0;
  const span = RIGHT - LEFT;
  let pos = list.map(o => (max ? LEFT + (o / max) * span : LEFT));
  // Push right so nothing overlaps.
  for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + MIN_GAP);
  // If that ran past the end, squeeze the whole run back in proportionally.
  const over = pos.length ? pos[pos.length - 1] - RIGHT : 0;
  if (over > 0) {
    const first = pos[0], width = pos[pos.length - 1] - first;
    const scale = width > 0 ? (RIGHT - LEFT) / width : 1;
    pos = pos.map(x => LEFT + (x - first) * scale);
  }
  return pos;
}

// "Day 2", "Week 1", "Month 3" — the words the preset is written in, derived
// from the number so a retimed step relabels itself.
export function whenWord(days) {
  const d = Math.max(0, Math.round(Number(days) || 0));
  if (d === 0) return "Same day";
  if (d < 7) return `Day ${d}`;
  if (d < 45) { const w = Math.round(d / 7); return `Week ${w}`; }
  const m = Math.round(d / 30);
  return `Month ${m}`;
}

const fmtShort = iso => {
  if (!iso) return "";
  const [y, m, dd] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y) return "";
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

const STEP_TYPES = [
  { type: "thank", label: "Thank them" },
  { type: "follow_up", label: "Visit, invite or check in" },
  { type: "send", label: "Send something" },
  { type: "check_in_ask", label: "Make the ask" },
  { type: "follow_up_no_reply", label: "Follow up if no reply" },
];

export default function JourneyBuilder({ isAdmin = true, isReadOnly = false, initialJourneyId = null }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(null);      // which journey is expanded
  const [sel, setSel] = useState(0);               // selected step index
  const [draft, setDraft] = useState(null);        // the steps being edited
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [stats, setStats] = useState(null);
  const [rowsPanel, setRowsPanel] = useState(null);
  const [applyPanel, setApplyPanel] = useState(null);
  // FIX-4 1c — who the journey is for. Held beside the panel rather than in
  // it, so changing a filter can re-ask the server for the count without
  // closing and reopening the offer.
  const [audience, setAudience] = useState({});
  const [counting, setCounting] = useState(false);
  const dragFrom = useRef(null);

  const load = async () => {
    try { setData(await apiFetch("/journeys")); }
    catch (e) { setErr(e?.message || "Could not load journeys."); }
  };
  useEffect(() => { load(); }, []);

  // FIX-4 2 — arriving from the profile's chip opens THAT journey, once.
  // Guarded on `data` so it runs after the catalogue is in hand, and on
  // `openId` so re-rendering does not keep reopening one somebody closed.
  const openedInitial = useRef(false);
  useEffect(() => {
    if (openedInitial.current || !initialJourneyId || !data) return;
    const j = (data.journeys || []).find(x => x.id === initialJourneyId);
    if (!j) { openedInitial.current = true; return; }
    openedInitial.current = true;
    openJourney(j);
  }, [data, initialJourneyId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const current = useMemo(
    () => (data?.journeys || []).find(j => j.id === openId) || null, [data, openId]);

  // Open one: copy its steps into a draft, and fetch the live preview + stats.
  async function openJourney(j) {
    setOpenId(j.id); setSel(0); setDraft((j.steps || []).map(s => ({ ...s })));
    setPreview(null); setStats(null);
    try { setPreview(await apiFetch(`/journeys/${j.id}/preview`)); } catch { setPreview({ unavailable: true }); }
    try { setStats(await apiFetch(`/journeys/${j.id}/stats`)); } catch { setStats(null); }
  }

  async function save() {
    if (!current || !draft) return;
    setSaving(true); setErr("");
    try {
      await apiFetch(`/journeys/${current.id}`, { method: "PATCH", body: JSON.stringify({ steps: draft }) });
      await load();
      try { setPreview(await apiFetch(`/journeys/${current.id}/preview`)); } catch { /* preview is a nicety */ }
    } catch (e) { setErr(e?.message || "Could not save."); }
    setSaving(false);
  }

  async function addFromPreset(p) {
    setErr("");
    try {
      const made = await apiFetch("/journeys", { method: "POST", body: JSON.stringify({ presetKey: p.key }) });
      await load();
      openJourney({ id: made.id, steps: made.steps });
    } catch (e) { setErr(e?.message || "Could not add that one."); }
  }

  const maxOffset = draft && draft.length ? Math.max(...draft.map(s => Number(s.offsetDays) || 0)) : 0;
  const positions = useMemo(() => nodePositions((draft || []).map(s => s.offsetDays)), [draft]);
  const editable = isAdmin && !isReadOnly;

  // ── the drawer's edits ──────────────────────────────────────────────────
  const setStep = (i, patch) => setDraft(d => d.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const removeStep = i => { setDraft(d => d.filter((_, n) => n !== i)); setSel(x => Math.max(0, x - 1)); };
  // ADD A STEP BETWEEN ANY TWO, and the new one lands halfway between their
  // offsets — which is what "between" means on a spine, and saves the person
  // typing a number to express a thing they expressed by pointing.
  const addAt = i => setDraft(d => {
    const before = d[i - 1], after = d[i];
    const off = before && after
      ? Math.round((Number(before.offsetDays) + Number(after.offsetDays)) / 2)
      : after ? Math.max(0, Number(after.offsetDays) - 7)
      : (before ? Number(before.offsetDays) + 30 : 7);
    const next = [...d];
    next.splice(i, 0, { type: "follow_up", label: "New step", offsetDays: off, draft: null });
    return next;
  });
  // DRAG TO REORDER. Dropping a step also RETIMES it to sit between its new
  // neighbours, because a spine where order and time disagree is a spine that
  // lies — planShape refuses a step due before the one it follows, and this
  // keeps the draft valid by construction rather than by a later error.
  function drop(to) {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from == null || from === to) return;
    setDraft(d => {
      const next = [...d];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      const i = next.indexOf(moved);
      const before = next[i - 1], after = next[i + 1];
      if (before && after) moved.offsetDays = Math.round((Number(before.offsetDays) + Number(after.offsetDays)) / 2);
      else if (before) moved.offsetDays = Number(before.offsetDays) + 30;
      else if (after) moved.offsetDays = Math.max(0, Number(after.offsetDays) - 7);
      return next;
    });
    setSel(to);
  }

  // FIX-4 1c — ONE PLACE THE COUNT COMES FROM. Opening the offer and
  // changing a filter both land here, so the number on the button is always
  // the number the server would apply to, never a stale one from the last
  // set of filters.
  async function recount(journeyId, next) {
    setCounting(true);
    try {
      const q = Object.keys(next).length ? `&audience=${encodeURIComponent(JSON.stringify(next))}` : "";
      setApplyPanel(await apiFetch(`/journeys/${journeyId}/qualifying?days=90${q}`));
      setErr("");
    } catch (e) { setErr(e?.message || "Could not count who qualifies."); setApplyPanel(null); }
    setCounting(false);
  }
  function setFilter(key, value) {
    const next = { ...audience };
    if (value === undefined || value === null || value === "" || value === false) delete next[key];
    else next[key] = value;
    setAudience(next);
    if (current) recount(current.id, next);
  }

  const touches = draft && draft.length
    ? `${draft.length} touch${draft.length === 1 ? "" : "es"} over ${
        maxOffset < 45 ? `${Math.max(1, Math.round(maxOffset / 7))} week${Math.round(maxOffset / 7) === 1 ? "" : "s"}`
                       : `${Math.round(maxOffset / 30)} month${Math.round(maxOffset / 30) === 1 ? "" : "s"}`}. `
      + "Nothing is sent without you."
    : "";

  if (err && !data) return <div style={{ fontSize: 13, color: T.terracotta }}>{err}</div>;
  if (!data) return <div style={{ fontSize: 13, color: T.ink3 }}>Loading…</div>;

  return (
    <div data-testid="journey-builder">
      <style>{`
        @media (max-width: ${SPINE_BREAKPOINT}px){
          .jb-grid{ grid-template-columns: 1fr !important; }
          /* THE SPINE BECOMES A LIST. Seven nodes in 342px is a smudge, not a
             timeline — Direction A's idea is that time is a line you can see,
             and on a phone that line is vertical. FIX-4 1b raised the point it
             changes from 900 to ${SPINE_BREAKPOINT}: between the two the card was
             wide enough to draw a spine and too narrow to read one, so it grew
             a scrollbar instead of becoming a list. */
          .jb-spine{ display:none !important; }
          .jb-list{ display:block !important; }
        }
      `}</style>

      <div style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.6, marginBottom: 16, maxWidth: 680 }}>
        A journey is a set of steps that starts on its own when something happens — someone gives
        for the first time, a lapsed donor comes back — and then reminds you, one step at a time.
        <strong style={{ color: T.ink }}> It never sends anything.</strong> Every step waits for you.
      </div>

      {err && <div style={{ fontSize: 13, color: T.terracotta, marginBottom: 12 }}>{err}</div>}

      {/* ── the journeys this org has ─────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {(data.journeys || []).length === 0 && (
          <div style={{ fontSize: 13, color: T.ink3 }}>No journeys yet. Start from one below.</div>
        )}
        {(data.journeys || []).map(j => (
          <div key={j.id} data-testid="journey-row"
            style={{ background: T.white, border: "1px solid " + (j.id === openId ? T.greenDk : T.bg3), borderRadius: 12 }}>
            <button onClick={() => (j.id === openId ? setOpenId(null) : openJourney(j))}
              data-testid={"journey-open-" + j.id}
              style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "14px 16px",
                       cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{j.name}</span>
              <span style={{ fontSize: 12, color: T.ink3 }}>{j.touches}</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 99, padding: "2px 9px",
                               background: j.enabled ? T.green100 : T.bg2, color: j.enabled ? T.greenDk : T.ink3 }}>
                  {j.enabled ? "On" : "Off"}
                </span>
                <span style={{ fontSize: 12, color: T.ink3 }}>{j.inIt} in it</span>
              </span>
            </button>

            {j.id === openId && draft && (
              <div style={{ borderTop: "1px solid " + T.bg3 }}>
                {/* ── THE SPINE (FIX-4 1b) ─────────────────────────────
                    ACROSS THE WHOLE CARD, not inside a column of it. The
                    chain is the first thing on the card and it runs edge to
                    edge, first node to last; every step is on screen at 1440
                    and nothing inside the card scrolls sideways. */}
                <div className="jb-spine" data-testid="jb-spine" style={{ position: "relative", padding: "30px 16px 8px" }}>
                  {/* A node is 88px wide and centred on its position, so two
                      adjacent nodes clear each other when MIN_GAP% of the
                      card is wider than 88px. Below SPINE_BREAKPOINT it is
                      not, and this whole block is display:none. */}
                  <div style={{ position: "relative", height: 138 }}>
                    <div data-testid="jb-chain" style={{ position: "absolute", left: 0, right: 0, top: 52, height: 2, background: T.bg3 }} />
                        {draft.map((s, i) => {
                          const on = i === sel;
                          return (
                            <div key={i}
                              draggable={editable}
                              onDragStart={() => { dragFrom.current = i; }}
                              onDragOver={e => e.preventDefault()}
                              onDrop={() => drop(i)}
                              onClick={() => setSel(i)}
                              data-testid={"jb-node-" + i}
                              style={{ position: "absolute", top: 0, left: (positions[i] ?? 6) + "%",
                                       transform: "translateX(-50%)", width: 88, textAlign: "center",
                                       cursor: editable ? "grab" : "pointer" }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                                            color: T.ink3, height: 30 }}>{whenWord(s.offsetDays)}</div>
                              <div style={{ width: 20, height: 20, borderRadius: "50%", margin: "42px auto 0",
                                            background: on ? T.ink : T.white, border: "2px solid " + (on ? T.ink : T.bg3),
                                            position: "relative", zIndex: 2,
                                            boxShadow: on ? "0 0 0 5px rgba(15,26,18,0.10)" : "none" }} />
                              <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 8, lineHeight: 1.3,
                                            color: on ? T.greenDk : T.ink }}>{s.label}</div>
                              {preview?.steps?.[i]?.dueDate && (
                                <div style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>{fmtShort(preview.steps[i].dueDate)}</div>
                              )}
                            </div>
                          );
                        })}
                  </div>
                </div>

                <div className="jb-grid" style={{ display: "grid", gridTemplateColumns: "1.85fr 1fr", gap: 18, padding: "0 16px 16px" }}>
                  <div style={{ minWidth: 0 }}>
                    {/* ── THE SAME JOURNEY AS A LIST (390) ───────────── */}
                    <div className="jb-list" style={{ display: "none" }}>
                      {draft.map((s, i) => (
                        <div key={i} onClick={() => setSel(i)} data-testid={"jb-item-" + i}
                          style={{ display: "flex", gap: 10, padding: "11px 2px", borderTop: i ? "1px solid " + T.bg3 : "none",
                                   cursor: "pointer", background: i === sel ? T.bg2 : "transparent" }}>
                          <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                                         background: i === sel ? T.ink : T.bg2, color: i === sel ? T.white : T.ink3,
                                         fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.label}</div>
                            <div style={{ fontSize: 11.5, color: T.ink3 }}>
                              {whenWord(s.offsetDays)}
                              {preview?.steps?.[i]?.dueDate ? ` · ${fmtShort(preview.steps[i].dueDate)}` : ""}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* ── THE DRAWER, UNDER THE SPINE ────────────────── */}
                    {draft[sel] && (
                      <div style={{ borderTop: "1px solid " + T.bg3, background: T.bg, borderRadius: "0 0 10px 10px", padding: "14px 16px" }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                                      color: T.ink3, marginBottom: 10 }}>
                          Editing · step {sel + 1} of {draft.length}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 12 }}>
                          <label style={{ display: "block" }}>
                            <span style={LBL}>What happens</span>
                            <input data-testid="jb-label" value={draft[sel].label} disabled={!editable}
                              onChange={e => setStep(sel, { label: e.target.value })} style={INP} />
                          </label>
                          <label style={{ display: "block" }}>
                            <span style={LBL}>Days after the trigger</span>
                            <input data-testid="jb-offset" type="number" min="0" max="730" disabled={!editable}
                              value={draft[sel].offsetDays}
                              onChange={e => setStep(sel, { offsetDays: Math.max(0, parseInt(e.target.value, 10) || 0) })} style={INP} />
                          </label>
                          <label style={{ display: "block" }}>
                            <span style={LBL}>What kind of step</span>
                            <select data-testid="jb-type" value={draft[sel].type} disabled={!editable}
                              onChange={e => setStep(sel, { type: e.target.value })} style={INP}>
                              {STEP_TYPES.map(t => <option key={t.type + t.label} value={t.type}>{t.label}</option>)}
                            </select>
                          </label>
                        </div>
                        {editable && (
                          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                            <button onClick={() => addAt(sel)} style={BTN} data-testid="jb-add-before">Add a step before this</button>
                            <button onClick={() => addAt(sel + 1)} style={BTN} data-testid="jb-add-after">Add one after</button>
                            <button onClick={() => removeStep(sel)} style={BTN} data-testid="jb-remove">Remove</button>
                            <span style={{ fontSize: 11.5, color: T.ink3, marginLeft: "auto" }}>Drag a node to reorder it.</span>
                          </div>
                        )}
                      </div>
                    )}

                    <p style={{ fontSize: 13.5, lineHeight: 1.6, color: T.ink3, margin: "14px 2px 0" }}>
                      <strong style={{ color: T.ink }} data-testid="jb-touches">{touches}</strong><br />
                      Every step becomes a next step on your Thread on the day it is due. You mark it done, or you skip it and say why.
                    </p>

                    {editable && (
                      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                        <button onClick={save} disabled={saving} data-testid="jb-save"
                          style={{ ...BTN, background: T.greenDk, borderColor: T.greenDk, color: T.white, fontWeight: 700 }}>
                          {saving ? "Saving…" : "Save the journey"}
                        </button>
                        <button data-testid="jb-toggle" style={BTN}
                          onClick={async () => {
                            await apiFetch(`/journeys/${current.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !current.enabled }) });
                            load();
                          }}>
                          {current.enabled ? "Turn it off" : "Turn it on"}
                        </button>
                        <button data-testid="jb-apply-open" style={BTN}
                          onClick={async () => { setAudience({}); await recount(current.id, {}); }}>
                          Apply to people who already qualify
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ── THE LIVE PREVIEW, on the profile's ink rail ─── */}
                  <div style={{ background: RAIL.bg, borderRadius: 14, padding: "16px 16px 18px", color: RAIL.text, minWidth: 0 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                                  color: RAIL.dim, marginBottom: 10 }}>Live preview · a real donor</div>
                    {!preview ? <div style={{ fontSize: 12.5, color: RAIL.dim }}>Loading…</div>
                      : preview.unavailable || !preview.donor ? (
                        <div style={{ fontSize: 12.5, color: RAIL.dim, lineHeight: 1.55 }}>
                          There is nobody on file yet to preview this on. Import your donors and the real dates appear here.
                        </div>
                      ) : (
                        <>
                          <div style={{ background: RAIL.panel, border: "1px solid " + RAIL.line, borderRadius: 10, padding: "11px 12px" }}>
                            <div style={{ fontSize: 14.5, fontWeight: 700 }}>{preview.donor.name}</div>
                            <div style={{ fontSize: 11.5, color: RAIL.dim, marginTop: 2 }}>{preview.donor.basis}</div>
                          </div>
                          <div style={{ marginTop: 10 }}>
                            {(preview.steps || []).map((s, i) => (
                              <div key={i} style={{ display: "flex", gap: 9, padding: "9px 0",
                                                    borderBottom: i < preview.steps.length - 1 ? "1px solid " + RAIL.line : "none" }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 6, flexShrink: 0, background: RAIL.dim }} />
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</div>
                                  <div style={{ fontSize: 11, color: RAIL.dim }}>{fmtShort(s.dueDate)}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div style={{ fontSize: 11, color: RAIL.dim, marginTop: 12, lineHeight: 1.5 }}>
                            Real dates on a real record, in your timezone. Change a step and these move.
                          </div>
                        </>
                      )}
                  </div>
                </div>

                {/* ── HOW IT IS GOING (item 6) ─────────────────────── */}
                {stats && (
                  <div style={{ borderTop: "1px solid " + T.bg3, padding: "14px 16px" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                                  color: T.ink3, marginBottom: 10 }}>How it is going</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {stats.figures.map(f => (
                        <button key={f.key} data-testid={"jb-fig-" + f.key} title={f.sentence}
                          onClick={async () => {
                            try { setRowsPanel({ ...(await apiFetch(`/journeys/${current.id}/rows?rows=${f.rows}`)), label: f.label, sentence: f.sentence }); }
                            catch (e) { setErr(e?.message || "Could not open those rows."); }
                          }}
                          style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 11, padding: "10px 13px",
                                   cursor: "pointer", fontFamily: "inherit", textAlign: "left", minWidth: 128 }}>
                          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 }}>{f.label}</div>
                          <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 22, color: T.ink, lineHeight: 1.15 }}>{f.value}</div>
                        </button>
                      ))}
                    </div>
                    <p data-testid="jb-caveat" style={{ fontSize: 12, color: T.ink3, lineHeight: 1.55, margin: "11px 0 0", maxWidth: 640 }}>
                      {stats.caveat}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── start from a preset ───────────────────────────────────────── */}
      {editable && (
        <>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                        color: T.ink3, marginBottom: 10 }}>Start from one of these</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(data.presets || []).map(p => (
              <button key={p.key} onClick={() => addFromPreset(p)} data-testid={"jb-preset-" + p.key}
                style={{ background: T.white, border: "1.5px solid " + T.bg3, borderRadius: 12, padding: "12px 15px",
                         cursor: "pointer", fontFamily: "inherit", textAlign: "left", maxWidth: 260 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{p.name}</div>
                <div style={{ fontSize: 12, color: T.ink3, marginTop: 3, lineHeight: 1.45 }}>{p.blurb}</div>
                <div style={{ fontSize: 11.5, color: T.greenDk, fontWeight: 700, marginTop: 6 }}>{p.touches}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* THE DRILL-THROUGH. Every number opens its donors. */}
      {rowsPanel && (
        <Modal onClose={() => setRowsPanel(null)} title={`${rowsPanel.label} · ${rowsPanel.count}`}>
          <p style={{ fontSize: 13, color: T.ink3, lineHeight: 1.55, marginTop: 0 }}>{rowsPanel.sentence}</p>
          <div style={{ maxHeight: 340, overflowY: "auto" }}>
            {(rowsPanel.donors || []).map(d => (
              <div key={d.id} style={{ padding: "8px 0", borderBottom: "1px solid " + T.bg3, fontSize: 13.5 }}>
                <a href={`/donors/${d.id}`} style={{ color: T.ink, fontWeight: 600 }}>{d.name}</a>
                {d.reason && <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>{d.reason}</div>}
              </div>
            ))}
            {!(rowsPanel.donors || []).length && <div style={{ fontSize: 13, color: T.ink3 }}>Nobody yet.</div>}
          </div>
        </Modal>
      )}

      {/* ONE CONFIRM, with the count, before anybody is put in a journey. */}
      {applyPanel && (
        <Modal onClose={() => setApplyPanel(null)} title="Apply to people who already qualify">
          <p style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, marginTop: 0 }}>{applyPanel.sentence}</p>

          {/* ── FIX-4 1c · WHO IT IS FOR ───────────────────────────────
              Every filter narrows and none of them widens, so the number on
              the button can only come down as you add one. It re-counts on
              every change, because a confirm that names a number from a
              previous set of filters is a confirm to the wrong thing. */}
          <div data-testid="jb-audience" style={{ borderTop: "1px solid " + T.bg3, borderBottom: "1px solid " + T.bg3,
                                                  padding: "12px 0", margin: "12px 0" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                          color: T.ink3, marginBottom: 9 }}>Who it is for</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
              {(data.audienceFilters || []).filter(f => f.kind === "flag").map(f => (
                <button key={f.key} type="button" data-testid={"jb-aud-" + f.key} title={f.sentence}
                  aria-pressed={!!audience[f.key]} disabled={counting}
                  onClick={() => setFilter(f.key, !audience[f.key])}
                  style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 7, cursor: "pointer",
                           fontFamily: "inherit",
                           background: audience[f.key] ? T.bg2 : T.white, color: T.ink,
                           border: "1px solid " + (audience[f.key] ? T.greenDk : T.bg3) }}>
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
              <label style={{ display: "block" }}>
                <span style={LBL}>Stage</span>
                <select data-testid="jb-aud-stage" value={audience.stage || ""} disabled={counting}
                  onChange={e => setFilter("stage", e.target.value)} style={INP}>
                  <option value="">Any stage</option>
                  {(data.stages || []).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label style={{ display: "block" }}>
                <span style={LBL}>Tag</span>
                <select data-testid="jb-aud-tag" value={audience.tag || ""} disabled={counting}
                  onChange={e => setFilter("tag", e.target.value)} style={INP}>
                  <option value="">Any tag</option>
                  {(data.tags || []).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label style={{ display: "block" }}>
                <span style={LBL}>Largest gift at least</span>
                <input data-testid="jb-aud-gift-min" type="number" min="0" step="1" disabled={counting}
                  value={audience.giftSize?.minCents ? Math.round(audience.giftSize.minCents / 100) : ""}
                  onChange={e => {
                    const d = parseInt(e.target.value, 10);
                    const next = { ...(audience.giftSize || {}) };
                    if (Number.isInteger(d) && d > 0) next.minCents = d * 100; else delete next.minCents;
                    setFilter("giftSize", Object.keys(next).length ? next : undefined);
                  }} placeholder="$" style={INP} />
              </label>
              <label style={{ display: "block" }}>
                <span style={LBL}>Largest gift at most</span>
                <input data-testid="jb-aud-gift-max" type="number" min="0" step="1" disabled={counting}
                  value={audience.giftSize?.maxCents ? Math.round(audience.giftSize.maxCents / 100) : ""}
                  onChange={e => {
                    const d = parseInt(e.target.value, 10);
                    const next = { ...(audience.giftSize || {}) };
                    if (Number.isInteger(d) && d > 0) next.maxCents = d * 100; else delete next.maxCents;
                    setFilter("giftSize", Object.keys(next).length ? next : undefined);
                  }} placeholder="$" style={INP} />
              </label>
            </div>
            <p data-testid="jb-audience-sentence" style={{ fontSize: 12, color: T.ink3, lineHeight: 1.55, margin: "10px 0 0" }}>
              {counting ? "Counting…" : applyPanel.audienceSentence}
            </p>
          </div>

          <p style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.55 }}>
            Each of them gets the journey&apos;s steps from today. Nothing is sent — every step waits for you.
            Anyone already in a journey that outranks this one is left where they are.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button data-testid="jb-apply-confirm" disabled={!applyPanel.count || counting}
              onClick={async () => {
                try {
                  const r = await apiFetch(`/journeys/${current.id}/apply`,
                    { method: "POST", body: JSON.stringify({ allQualifying: true, days: applyPanel.days, audience }) });
                  setApplyPanel(null); setErr("");
                  await load();
                  setStats(await apiFetch(`/journeys/${current.id}/stats`).catch(() => null));
                  window.alert(`${r.started} put into ${r.name}. ${r.skipped} left where they were.`);
                } catch (e) { setErr(e?.message || "Could not apply it."); setApplyPanel(null); }
              }}
              style={{ ...BTN, background: applyPanel.count ? T.greenDk : T.bg3, borderColor: applyPanel.count ? T.greenDk : T.bg3,
                       color: applyPanel.count ? T.white : T.ink3, fontWeight: 700 }}>
              Put {applyPanel.count} {applyPanel.count === 1 ? "person" : "people"} in it
            </button>
            <button onClick={() => setApplyPanel(null)} style={BTN}>Not now</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const LBL = { display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 5 };
const INP = { width: "100%", padding: "8px 10px", fontSize: 13.5, borderRadius: 8, border: "1.5px solid " + T.bg3, background: T.white, color: T.ink, fontFamily: "inherit" };
const BTN = { font: "inherit", fontSize: 13, fontWeight: 600, borderRadius: 9, padding: "9px 15px", cursor: "pointer", border: "1px solid " + T.bg3, background: "transparent", color: T.ink };
