import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { T, Modal } from "./shared";
import { apiFetch } from "../api";
import { DonorLink, RecordLink, useUrlWriter } from "./RecordLink";
import { tabHref } from "../lib/appUrls";

// ── FIX-5 · JOURNEYS: YOURS, AND PREMIUM ──────────────────────────────────
//
// THREAD-2b built the spine (Direction A: the journey is one horizontal line
// and the line is time). FIX-5 keeps the idea and fixes the three things that
// stopped it being a screen an org would build its own work on:
//
//   1. YOU CAN MAKE ONE. There was no way to create a journey except pressing
//      a preset, so every org's journeys were five fixed shapes with edited
//      step labels. "Create a journey" names it, picks the trigger and its
//      conditions, and starts with an empty chain.
//   2. NOTHING BLEEDS. The chain used to be absolutely positioned nodes inside
//      a `height: 138` box. A step label that wrapped overflowed the box, and
//      the dark preview panel below it rode up through the names. The chain is
//      now a CSS GRID: one column per node, four shared rows (timing, node,
//      name, date). Every baseline is shared because it is literally the same
//      grid row, a wrapping name grows that row for every column at once, and
//      no date can be pushed down past its neighbours. The card is three flow
//      rows that cannot overlap because none of them is positioned.
//   3. NO RED FOR A QUESTION. Choosing Major donor used to POST, fail
//      validation and print "Set the amount that counts as a big gift" in
//      terracotta: an error for not having answered a question nobody asked.
//      The question is asked first, prefilled from their own gifts, and the
//      rows behind the suggestion are one click away.
//
// NOTHING HERE SENDS. Every sentence on this screen says so, and the engine
// cannot (shared/journeyShape.js, tests/thread2a-no-send.test.js).

const RAIL = { bg: T.ink, panel: T.bgElevated, line: T.green650, text: T.inkInverse, dim: T.sage400 };

// The narrowest CARD a multi-node chain reads at. Below it the chain becomes a
// vertical list, which is the same answer 390 always got, reached earlier.
export const SPINE_BREAKPOINT = 1100;

// ── HOW WIDE EACH COLUMN IS ───────────────────────────────────────────────
// One column per node, and a column's width carries the time since the node
// before it — BOUNDED. Unbounded, "New donor, first year" is day 2, week 1,
// then months 3 to 12: the first two nodes land on top of each other and the
// last gap is a chasm. So the weights are clamped to a narrow band around even:
// the chain reads as evenly spaced, a longer wait is visibly a little wider,
// and nothing is ever cramped. That is the whole compromise, in two numbers.
const MIN_W = 0.85, MAX_W = 1.6;

export function columnWeights(offsets) {
  const list = (offsets || []).map(n => Math.max(0, Number(n) || 0));
  if (list.length <= 1) return list.map(() => 1);
  const gaps = list.slice(1).map((o, i) => Math.max(0, o - list[i]));
  const total = gaps.reduce((a, b) => a + b, 0);
  const mean = total / gaps.length;
  const w = gaps.map(g => (mean > 0 ? Math.min(MAX_W, Math.max(MIN_W, g / mean)) : 1));
  return [1, ...w];   // the first column has no gap behind it
}

// "Day 2", "Week 1", "Month 12" from the trigger; "+2 weeks" from the step
// before. Mirrors shared/journeyShape.timingWord, for a draft the server has
// not seen yet.
export function whenWord(step) {
  const t = (step && step.timing) || null;
  const d = Math.max(0, Math.round(Number(step && step.offsetDays) || 0));
  if (t && t.from === "previous") {
    const v = Math.max(0, Math.round(Number(t.value) || 0));
    if (!v) return "Same day";
    const unit = v === 1 ? String(t.unit || "days").replace(/s$/, "") : String(t.unit || "days");
    return `+${v} ${unit}`;
  }
  if (d === 0) return "Same day";
  if (d < 7) return `Day ${d}`;
  if (d < 45) return `Week ${Math.round(d / 7)}`;
  return `Month ${Math.round(d / 30)}`;
}

const fmtShort = iso => {
  if (!iso) return "";
  const [y, m, dd] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y) return "";
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
const money = cents => "$" + Math.round(Number(cents || 0) / 100).toLocaleString("en-US");

const STEP_TYPES = [
  { type: "thank", label: "Thank them" },
  { type: "follow_up", label: "Visit, invite or check in" },
  { type: "send", label: "Send something" },
  { type: "check_in_ask", label: "Make the ask" },
  { type: "follow_up_no_reply", label: "Follow up if no reply" },
];
const DRAFT_LABEL = {
  impact_report: "The impact report",
  event_invitation: "An invitation",
  the_ask: "The ask",
  thank_you: "A thank you",
};
const NEW_STEP = { type: "follow_up", label: "New step", offsetDays: 7, note: "", draft: null,
                   ownerMode: "relationship_owner", timing: { from: "trigger", value: 7, unit: "days" } };

// ── SHARED STYLE OBJECTS, in one block under the imports (the TDZ rule) ───
const LBL = { display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 5 };
const INP = { width: "100%", padding: "8px 10px", fontSize: 13.5, borderRadius: 8, border: "1.5px solid " + T.bg3, background: T.white, color: T.ink, fontFamily: "inherit" };
const BTN = { font: "inherit", fontSize: 13, fontWeight: 600, borderRadius: 9, padding: "9px 15px", cursor: "pointer", border: "1px solid " + T.bg3, background: "transparent", color: T.ink };
const BTN_GO = { ...BTN, background: T.greenDk, borderColor: T.greenDk, color: T.white, fontWeight: 700 };
const CAP = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };

// ── THE CHAIN ─────────────────────────────────────────────────────────────
// One line, edge to edge, through the node centres. Four grid rows shared by
// every column, so the timing labels sit on one baseline, the names on
// another and the dates on a third, and a name that wraps grows its row for
// all of them rather than shoving its own date down.
function Chain({ steps, sel, onSelect, editable, dragFrom, onDragStart, onDrop, onAdd, preview }) {
  const weights = useMemo(() => columnWeights((steps || []).map(s => s.offsetDays)), [steps]);
  const cols = weights.map(w => `${w}fr`).join(" ") + (editable ? " 54px" : "");
  const stateOf = i => (preview && preview.steps && preview.steps[i] && preview.steps[i].state) || "upcoming";

  return (
    <div className="jb-chain-wrap" data-testid="jb-spine" style={{ padding: "26px 18px 20px", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gridTemplateRows: "auto 26px auto auto",
                    columnGap: 8, position: "relative" }}>
        {/* THE ONE LINE. It is IN the node row and centred on it, so it passes
            through the node centres instead of floating above them, and the
            negative margins carry it to both edges of the card. */}
        <div data-testid="jb-chain" aria-hidden="true"
          style={{ gridRow: 2, gridColumn: "1 / -1", alignSelf: "center", height: 2,
                   background: T.bg3, marginLeft: -18, marginRight: -18 }} />
        {(steps || []).map((s, i) => {
          const on = i === sel;
          const st = stateOf(i);
          const done = st === "past" || st === "done";
          const today = st === "today";
          return (
            <Fragment key={i}>
              <div style={{ gridRow: 1, gridColumn: i + 1, ...CAP, textAlign: "center",
                            color: today ? T.greenDk : T.ink3, paddingBottom: 8 }}>
                {whenWord(s)}
              </div>
              <button type="button"
                className={"jb-node" + (on ? " sel" : "") + (dragFrom === i ? " dragging" : "")}
                draggable={editable}
                onDragStart={() => onDragStart(i)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => onDrop(i)}
                onClick={() => onSelect(i)}
                data-testid={"jb-node-" + i}
                data-state={on ? "selected" : st}
                aria-label={`Step ${i + 1}, ${s.label}, ${whenWord(s)}`}
                aria-current={on ? "step" : undefined}
                style={{ gridRow: 2, gridColumn: i + 1, justifySelf: "center", alignSelf: "center",
                         width: 20, height: 20, padding: 0, borderRadius: "50%", zIndex: 2,
                         cursor: editable ? "grab" : "pointer",
                         background: done ? T.ink : T.white,
                         border: "2px solid " + (on ? T.ink : today ? T.greenDk : done ? T.ink : T.bg3),
                         boxShadow: on ? "0 6px 16px rgba(15,26,18,0.22)"
                                   : today ? "0 0 0 4px rgba(13,92,58,0.16)" : "none" }} />
              <div onClick={() => onSelect(i)} data-testid={"jb-node-label-" + i}
                style={{ gridRow: 3, gridColumn: i + 1, textAlign: "center", cursor: "pointer",
                         fontSize: 11.5, fontWeight: 600, lineHeight: 1.35, paddingTop: 10,
                         color: on ? T.greenDk : T.ink, overflowWrap: "anywhere" }}>
                {s.label}
              </div>
              <div style={{ gridRow: 4, gridColumn: i + 1, textAlign: "center", fontSize: 11,
                            color: T.ink3, paddingTop: 3 }}>
                {preview && preview.steps && preview.steps[i] ? fmtShort(preview.steps[i].dueDate) : " "}
              </div>
            </Fragment>
          );
        })}
        {editable && (
          <button type="button" onClick={() => onAdd((steps || []).length)} data-testid="jb-chain-add"
            title="Add a step at the end"
            style={{ gridRow: 2, gridColumn: (steps || []).length + 1, justifySelf: "center", alignSelf: "center",
                     width: 22, height: 22, borderRadius: "50%", padding: 0, zIndex: 2, cursor: "pointer",
                     background: T.white, border: "1.5px dashed " + T.bg3, color: T.ink3,
                     fontSize: 14, fontWeight: 700, lineHeight: 1, fontFamily: "inherit" }}>+</button>
        )}
      </div>
    </div>
  );
}

// ── THE CHAIN AS A LIST (390) ─────────────────────────────────────────────
function ChainList({ steps, sel, onSelect, preview }) {
  return (
    <div className="jb-list" style={{ display: "none" }}>
      {(steps || []).map((s, i) => {
        const st = (preview && preview.steps && preview.steps[i] && preview.steps[i].state) || "upcoming";
        const done = st === "past" || st === "done";
        return (
          <div key={i} onClick={() => onSelect(i)} data-testid={"jb-item-" + i}
            style={{ display: "flex", gap: 10, padding: "11px 2px", borderTop: i ? "1px solid " + T.bg3 : "none",
                     cursor: "pointer", background: i === sel ? T.bg2 : "transparent" }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                           background: i === sel || done ? T.ink : T.bg2,
                           border: st === "today" ? "2px solid " + T.greenDk : "none",
                           color: i === sel || done ? T.white : T.ink3,
                           fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 11.5, color: T.ink3 }}>
                {whenWord(s)}
                {preview && preview.steps && preview.steps[i] && preview.steps[i].dueDate
                  ? ` · ${fmtShort(preview.steps[i].dueDate)}` : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── THE TRIGGER AND ITS CONDITIONS ────────────────────────────────────────
// One block, used by the create dialog AND by the open card, so what you set
// when you make a journey is edited in exactly the same controls afterwards.
function TriggerFields({ data, value, onChange, onAskAmount, amountSuggestion, tid = "jb" }) {
  const trigger = (data.triggers || []).find(t => t.key === value.trigger) || null;
  const aud = value.audience || {};
  const setAud = (key, v) => {
    const next = { ...aud };
    if (v === undefined || v === null || v === "" || v === false) delete next[key];
    else next[key] = v;
    onChange({ audience: next });
  };
  const gift = aud.giftSize || {};
  const tf = value.triggerFilters || {};
  const setTf = (key, v) => {
    const next = { ...tf };
    if (!v) delete next[key]; else next[key] = v;
    onChange({ triggerFilters: next });
  };
  return (
    <div data-testid={tid + "-trigger-fields"}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
        <label style={{ display: "block" }}>
          <span style={LBL}>When it starts</span>
          <select data-testid={tid + "-trigger"} value={value.trigger || ""} style={INP}
            onChange={e => onChange({ trigger: e.target.value })}>
            <option value="">Pick a trigger</option>
            {(data.triggers || []).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        {trigger && trigger.needsAmount && (
          <label style={{ display: "block" }}>
            <span style={LBL}>A big gift for us is</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 14, color: T.ink3 }}>$</span>
              <input data-testid={tid + "-amount"} type="number" min="1" step="1" style={INP}
                value={value.amountCents ? Math.round(value.amountCents / 100) : ""}
                onChange={e => {
                  const d = parseInt(e.target.value, 10);
                  onChange({ amountCents: Number.isInteger(d) && d > 0 ? d * 100 : null });
                }} />
            </div>
            {amountSuggestion && (
              <div style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.5, marginTop: 5 }}>
                {amountSuggestion.sentence}{" "}
                {amountSuggestion.rows && amountSuggestion.rows.length > 0 && (
                  <button type="button" onClick={onAskAmount} data-testid={tid + "-amount-rows"}
                    style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 11.5,
                             fontWeight: 600, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>
                    show the gifts behind it
                  </button>
                )}
              </div>
            )}
          </label>
        )}
        <label style={{ display: "block" }}>
          <span style={LBL}>Priority against other journeys</span>
          <input data-testid={tid + "-priority"} type="number" min="0" max="1000" step="10" style={INP}
            value={value.priority === undefined || value.priority === null ? "" : value.priority}
            onChange={e => {
              const d = parseInt(e.target.value, 10);
              onChange({ priority: Number.isInteger(d) ? Math.min(1000, Math.max(0, d)) : null });
            }} />
          <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 5, lineHeight: 1.5 }}>
            The higher number wins when somebody qualifies for two.
          </div>
        </label>
      </div>

      {/* PARITY-1 Part D — what narrows the trigger: a floor on any gift
          trigger, a fund or a campaign, and the group "joins a group" watches. */}
      {trigger && (trigger.gift || trigger.needsGroup) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginTop: 12 }}>
          {trigger.gift && !trigger.needsAmount && (
            <label style={{ display: "block" }}>
              <span style={LBL}>Only gifts of at least</span>
              <input data-testid={tid + "-min-amount"} type="number" min="0" step="1" placeholder="$ (optional)" style={INP}
                value={value.amountCents ? Math.round(value.amountCents / 100) : ""}
                onChange={e => {
                  const d = parseInt(e.target.value, 10);
                  onChange({ amountCents: Number.isInteger(d) && d > 0 ? d * 100 : null });
                }} />
            </label>
          )}
          {trigger.gift && (
            <label style={{ display: "block" }}>
              <span style={LBL}>To the fund</span>
              <select data-testid={tid + "-fund"} value={tf.fundId || ""} style={INP} onChange={e => setTf("fundId", e.target.value)}>
                <option value="">Any fund</option>
                {(data.funds || []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          )}
          {trigger.gift && (
            <label style={{ display: "block" }}>
              <span style={LBL}>In the campaign or appeal</span>
              <select data-testid={tid + "-campaign"} value={tf.campaignId || ""} style={INP} onChange={e => setTf("campaignId", e.target.value)}>
                <option value="">Any campaign</option>
                {(data.campaigns || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {trigger.needsGroup && (
            <label style={{ display: "block" }}>
              <span style={LBL}>The group</span>
              <select data-testid={tid + "-trigger-group"} value={tf.groupId || ""} style={INP} onChange={e => setTf("groupId", e.target.value)}>
                <option value="">Pick a group</option>
                {(data.groups || []).map(g => <option key={g.id} value={g.id}>{g.name}{g.kind === "dynamic" ? " (by rule)" : ""}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {trigger && (
        <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.55, marginTop: 10 }}>{trigger.sentence}</div>
      )}

      <div style={{ borderTop: "1px solid " + T.bg3, marginTop: 14, paddingTop: 12 }}>
        <div style={{ ...CAP, marginBottom: 9 }}>Who it is for</div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
          {(data.audienceFilters || []).filter(f => f.kind === "flag").map(f => (
            <button key={f.key} type="button" data-testid={tid + "-cond-" + f.key} title={f.sentence}
              aria-pressed={!!aud[f.key]} onClick={() => setAud(f.key, !aud[f.key])}
              style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 7, cursor: "pointer",
                       fontFamily: "inherit", background: aud[f.key] ? T.bg2 : T.white, color: T.ink,
                       border: "1px solid " + (aud[f.key] ? T.greenDk : T.bg3) }}>
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <label style={{ display: "block" }}>
            <span style={LBL}>Stage</span>
            <select data-testid={tid + "-cond-stage"} value={aud.stage || ""} style={INP}
              onChange={e => setAud("stage", e.target.value)}>
              <option value="">Any stage</option>
              {(data.stages || []).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {(data.groups || []).length > 0 && (
            <label style={{ display: "block" }}>
              <span style={LBL}>Group</span>
              <select data-testid={tid + "-cond-group"} value={aud.groupId || ""} style={INP}
                onChange={e => setAud("groupId", e.target.value)}>
                <option value="">Any group</option>
                {(data.groups || []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          )}
          <label style={{ display: "block" }}>
            <span style={LBL}>Tag</span>
            <select data-testid={tid + "-cond-tag"} value={aud.tag || ""} style={INP}
              onChange={e => setAud("tag", e.target.value)}>
              <option value="">Any tag</option>
              {(data.tags || []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={{ display: "block" }}>
            <span style={LBL}>Largest gift at least</span>
            <input data-testid={tid + "-cond-gift-min"} type="number" min="0" step="1" placeholder="$" style={INP}
              value={gift.minCents ? Math.round(gift.minCents / 100) : ""}
              onChange={e => {
                const d = parseInt(e.target.value, 10);
                const next = { ...gift };
                if (Number.isInteger(d) && d > 0) next.minCents = d * 100; else delete next.minCents;
                setAud("giftSize", Object.keys(next).length ? next : undefined);
              }} />
          </label>
          <label style={{ display: "block" }}>
            <span style={LBL}>Largest gift at most</span>
            <input data-testid={tid + "-cond-gift-max"} type="number" min="0" step="1" placeholder="$" style={INP}
              value={gift.maxCents ? Math.round(gift.maxCents / 100) : ""}
              onChange={e => {
                const d = parseInt(e.target.value, 10);
                const next = { ...gift };
                if (Number.isInteger(d) && d > 0) next.maxCents = d * 100; else delete next.maxCents;
                setAud("giftSize", Object.keys(next).length ? next : undefined);
              }} />
          </label>
        </div>
      </div>
    </div>
  );
}

// ── ONE STEP, EVERY PART OF IT ────────────────────────────────────────────
function StepEditor({ step, index, total, data, editable, onSet, onAdd, onDuplicate, onRemove }) {
  if (!step) return null;
  const timing = step.timing || { from: "trigger", value: Number(step.offsetDays) || 0, unit: "days" };
  const setTiming = patch => onSet({ timing: { ...timing, ...patch } });
  return (
    <div data-testid="jb-step-editor"
      style={{ border: "1px solid " + T.bg3, background: T.bg, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ ...CAP, marginBottom: 10 }}>Editing step {index + 1} of {total}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
        <label style={{ display: "block" }}>
          <span style={LBL}>What happens</span>
          <input data-testid="jb-label" value={step.label} disabled={!editable}
            onChange={e => onSet({ label: e.target.value })} style={INP} />
        </label>
        <label style={{ display: "block" }}>
          <span style={LBL}>What kind of step</span>
          <select data-testid="jb-type" value={step.type} disabled={!editable}
            onChange={e => onSet({ type: e.target.value })} style={INP}>
            {STEP_TYPES.map(t => <option key={t.type + t.label} value={t.type}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1.4fr", gap: 10, marginTop: 12 }}>
        <label style={{ display: "block" }}>
          <span style={LBL}>When</span>
          <input data-testid="jb-timing-value" type="number" min="0" max="730" disabled={!editable}
            value={timing.value} style={INP}
            onChange={e => setTiming({ value: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
        </label>
        <label style={{ display: "block" }}>
          <span style={LBL}>Unit</span>
          <select data-testid="jb-timing-unit" value={timing.unit || "days"} disabled={!editable} style={INP}
            onChange={e => setTiming({ unit: e.target.value })}>
            {(data.timingUnits || []).map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
          </select>
        </label>
        <label style={{ display: "block" }}>
          <span style={LBL}>Counted from</span>
          <select data-testid="jb-timing-from" value={index === 0 ? "trigger" : (timing.from || "trigger")}
            disabled={!editable || index === 0} style={INP}
            onChange={e => setTiming({ from: e.target.value })}>
            {(data.timingFrom || []).map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
      </div>
      {index === 0 && (
        <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 6, lineHeight: 1.5 }}>
          The first step is counted from the trigger. There is no step before it to follow.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <label style={{ display: "block" }}>
          <span style={LBL}>Whose step it is</span>
          <select data-testid="jb-owner" disabled={!editable} style={INP}
            value={step.ownerMode === "specific" ? (step.ownerId || "") : ""}
            onChange={e => {
              const id = e.target.value;
              const person = (data.team || []).find(u => u.id === id);
              onSet(id
                ? { ownerMode: "specific", ownerId: id, ownerName: person ? person.name : "" }
                : { ownerMode: "relationship_owner", ownerId: null, ownerName: "" });
            }}>
            <option value="">Whoever owns the relationship</option>
            {(data.team || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label style={{ display: "block" }}>
          <span style={LBL}>Draft in your voice</span>
          <select data-testid="jb-draft" disabled={!editable} style={INP}
            value={step.draft || ""} onChange={e => onSet({ draft: e.target.value || null })}>
            <option value="">No draft, you write it</option>
            {(data.draftKinds || []).map(k => <option key={k} value={k}>{DRAFT_LABEL[k] || k}</option>)}
          </select>
        </label>
      </div>
      {step.draft && (
        <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 6, lineHeight: 1.5 }}>
          Steward writes it for you to read. It is still yours to send.
        </div>
      )}

      <label style={{ display: "block", marginTop: 12 }}>
        <span style={LBL}>A note for whoever does it</span>
        <input data-testid="jb-note" value={step.note || ""} disabled={!editable} style={INP}
          placeholder="Anything they should know before they pick up the phone"
          onChange={e => onSet({ note: e.target.value })} />
      </label>

      {editable && (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => onAdd(index)} style={BTN} data-testid="jb-add-before">Add a step before</button>
          <button onClick={() => onAdd(index + 1)} style={BTN} data-testid="jb-add-after">Add one after</button>
          <button onClick={() => onDuplicate(index)} style={BTN} data-testid="jb-duplicate-step">Duplicate this step</button>
          <button onClick={() => onRemove(index)} style={BTN} data-testid="jb-remove">Remove</button>
          <span style={{ fontSize: 11.5, color: T.ink3, marginLeft: "auto" }}>Drag a node to reorder it.</span>
        </div>
      )}
    </div>
  );
}

export default function JourneyBuilder({ isAdmin = true, isReadOnly = false, initialJourneyId = null }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(null);      // which journey is expanded
  const [sel, setSel] = useState(0);               // selected step index
  const [draft, setDraft] = useState(null);        // the steps being edited
  const [meta, setMeta] = useState(null);          // name, description, trigger, conditions, priority
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [stats, setStats] = useState(null);
  const [rowsPanel, setRowsPanel] = useState(null);
  const [applyPanel, setApplyPanel] = useState(null);
  const [audience, setAudience] = useState({});
  const [counting, setCounting] = useState(false);
  const [dragFrom, setDragFrom] = useState(null);
  // FIX-5 — the new dialogs.
  const [createDraft, setCreateDraft] = useState(null);   // the "Create a journey" panel
  const [presetAsk, setPresetAsk] = useState(null);       // "you already have one of these"
  const [suggestion, setSuggestion] = useState(null);     // what a big gift is here
  const [affects, setAffects] = useState(null);           // who a save reaches
  const [undo, setUndo] = useState(null);                 // the deleted journey, restorable
  // FIX-14 Part 5: a journey is /app/journeys?journey=<id>. On the Journeys
  // tab the address bar names the one that is open (replaced, not pushed:
  // opening a row is choosing, not going somewhere).
  const goUrl = useUrlWriter();
  const onJourneysTab = () => /^\/app\/journeys\/?$/.test(window.location.pathname);
  useEffect(() => {
    if (openId && onJourneysTab()) goUrl(tabHref("journeys", { journeyId: openId }), true);
  }, [openId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (keepOpen = true) => {
    try {
      const d = await apiFetch("/journeys");
      setData(d);
      if (!keepOpen) setOpenId(null);
      return d;
    } catch (e) { setErr(e?.message || "Could not load journeys."); return null; }
  };
  useEffect(() => { load(); }, []);

  const current = useMemo(
    () => (data?.journeys || []).find(j => j.id === openId) || null, [data, openId]);
  const editable = isAdmin && !isReadOnly;

  // Open one: copy it into a draft, and fetch the live preview + stats.
  async function openJourney(j) {
    setOpenId(j.id); setSel(0);
    setDraft((j.steps || []).map(s => ({ ...s })));
    setMeta({ name: j.name || "", description: j.description || "", trigger: j.trigger || "",
              amountCents: j.amountCents ?? null, priority: j.priority ?? 50,
              audience: j.audience || {}, triggerFilters: j.triggerFilters || {}, enabled: !!j.enabled });
    setPreview(null); setStats(null); setErr("");
    try { setPreview(await apiFetch(`/journeys/${j.id}/preview`)); } catch { setPreview({ unavailable: true }); }
    try { setStats(await apiFetch(`/journeys/${j.id}/stats`)); } catch { setStats(null); }
  }

  // ── FIX-5 item 2 · LANDING ON JOURNEYS OPENS ONE ────────────────────────
  // The most recently edited, or the first one that is On. A page whose whole
  // job is a chain should not open as a list of closed rows: the first thing
  // she sees is the journey she was last working on, with its chain drawn.
  const openedInitial = useRef(false);
  useEffect(() => {
    if (openedInitial.current || !data) return;
    openedInitial.current = true;
    const list = data.journeys || [];
    if (!list.length) return;
    if (initialJourneyId) {
      const named = list.find(x => x.id === initialJourneyId);
      if (named) { openJourney(named); return; }
    }
    const edited = list.slice().sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
    const on = list.find(j => j.enabled);
    openJourney(edited && edited.updatedAt ? edited : (on || list[0]));
  }, [data, initialJourneyId]);   // eslint-disable-line react-hooks/exhaustive-deps

  // What a big gift is here, read from their own gifts. Fetched once, lazily,
  // the first time a trigger that needs a number is chosen.
  async function loadSuggestion() {
    if (suggestion) return suggestion;
    try {
      const s = await apiFetch("/journeys/suggest-big-gift");
      setSuggestion(s);
      return s;
    } catch { return null; }
  }

  async function save(retimeExisting = false) {
    if (!current || !draft || !meta) return;
    setSaving(true); setErr("");
    try {
      const r = await apiFetch(`/journeys/${current.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: meta.name, description: meta.description, trigger: meta.trigger,
                               amountCents: meta.amountCents, priority: meta.priority,
                               audience: meta.audience, triggerFilters: meta.triggerFilters || {}, enabled: meta.enabled, steps: draft, retimeExisting }),
      });
      setAffects(null);
      await load();
      try { setPreview(await apiFetch(`/journeys/${current.id}/preview`)); } catch { /* preview is a nicety */ }
      if (retimeExisting && r.movedPeople) setUndo(null);
    } catch (e) { setErr(e?.message || "Could not save."); }
    setSaving(false);
  }

  // Saving an ON journey shows who it reaches first. An OFF one reaches
  // nobody, so it saves straight away rather than asking about nothing.
  async function askThenSave() {
    if (!current) return;
    if (!current.enabled) return save(false);
    try { setAffects(await apiFetch(`/journeys/${current.id}/affects`)); }
    catch { save(false); }
  }

  // ── FIX-5 item 1 · A PRESET THAT IS ALREADY HERE ────────────────────────
  // Never a silent duplicate. The old button POSTed whatever you pressed, so
  // pressing "New donor, first year" twice left an org with two of them and no
  // way to tell which one was armed.
  async function pressPreset(p) {
    setErr("");
    const already = (data.journeys || []).filter(j =>
      j.presetKey === p.key || String(j.name || "").toLowerCase() === String(p.name || "").toLowerCase());
    if (already.length) { setPresetAsk({ preset: p, existing: already }); return; }
    // Major donor carries a number, and the number is theirs. Ask before
    // creating, prefilled from their own gifts, instead of creating and
    // failing validation in terracotta.
    const trig = (data.triggers || []).find(t => t.key === p.trigger);
    if (trig && trig.needsAmount) {
      const s = await loadSuggestion();
      setCreateDraft({ fromPreset: p.key, name: p.name, description: p.blurb || "", trigger: p.trigger,
                       amountCents: s ? s.cents : 100000, priority: p.priority ?? 50, audience: {},
                       steps: (p.steps || []).map(s2 => ({ ...s2 })) });
      return;
    }
    await createJourney({ presetKey: p.key });
  }

  async function createJourney(body) {
    setErr("");
    try {
      const made = await apiFetch("/journeys", { method: "POST", body: JSON.stringify(body) });
      setCreateDraft(null); setPresetAsk(null);
      const d = await load();
      const fresh = (d?.journeys || []).find(j => j.id === made.id);
      await openJourney(fresh || { id: made.id, steps: made.steps, name: made.name });
      return made;
    } catch (e) { setErr(e?.message || "Could not create that journey."); return null; }
  }

  async function duplicateJourney(id) {
    setErr("");
    try {
      const made = await apiFetch(`/journeys/${id}/duplicate`, { method: "POST", body: "{}" });
      const d = await load();
      const fresh = (d?.journeys || []).find(j => j.id === made.id);
      if (fresh) await openJourney(fresh);
    } catch (e) { setErr(e?.message || "Could not duplicate it."); }
  }

  async function deleteJourney(j) {
    setErr("");
    try {
      const r = await apiFetch(`/journeys/${j.id}`, { method: "DELETE" });
      setOpenId(null); setDraft(null); setMeta(null);
      await load();
      setUndo({ id: j.id, name: j.name, sentence: r.sentence });
    } catch (e) { setErr(e?.message || "Could not remove it."); }
  }

  async function restoreJourney() {
    if (!undo) return;
    const id = undo.id;
    setUndo(null);
    try { await apiFetch(`/journeys/${id}/restore`, { method: "POST", body: "{}" }); const d = await load();
          const fresh = (d?.journeys || []).find(j => j.id === id); if (fresh) await openJourney(fresh); }
    catch (e) { setErr(e?.message || "Could not put it back."); }
  }

  // ── the step edits ──────────────────────────────────────────────────────
  const setStep = (i, patch) => setDraft(d => d.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const removeStep = i => { setDraft(d => d.filter((_, n) => n !== i)); setSel(x => Math.max(0, Math.min(x, (draft || []).length - 2))); };
  const duplicateStep = i => setDraft(d => {
    const next = [...d];
    const copy = { ...d[i], label: d[i].label };
    next.splice(i + 1, 0, copy);
    return next;
  });
  // ADD A STEP BETWEEN ANY TWO, and the new one lands halfway between their
  // offsets, which is what "between" means on a chain.
  const addAt = i => setDraft(d => {
    const before = d[i - 1], after = d[i];
    const off = before && after
      ? Math.round((Number(before.offsetDays) + Number(after.offsetDays)) / 2)
      : after ? Math.max(0, Number(after.offsetDays) - 7)
      : (before ? Number(before.offsetDays) + 30 : 7);
    const next = [...d];
    next.splice(i, 0, { ...NEW_STEP, offsetDays: off, timing: { from: "trigger", value: off, unit: "days" } });
    setSel(i);
    return next;
  });
  // DRAG TO REORDER, AND THE DROP RETIMES. A chain where order and time
  // disagree is a chain that lies, and planShape refuses a step due before the
  // one it follows — so the draft is kept valid by construction.
  function drop(to) {
    const from = dragFrom;
    setDragFrom(null);
    if (from == null || from === to) return;
    setDraft(d => {
      const next = [...d];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      const i = next.indexOf(moved);
      const before = next[i - 1], after = next[i + 1];
      let off = Number(moved.offsetDays) || 0;
      if (before && after) off = Math.round((Number(before.offsetDays) + Number(after.offsetDays)) / 2);
      else if (before) off = Number(before.offsetDays) + 30;
      else if (after) off = Math.max(0, Number(after.offsetDays) - 7);
      next[i] = { ...moved, offsetDays: off, timing: { from: "trigger", value: off, unit: "days" } };
      return next;
    });
    setSel(to);
  }

  // ONE PLACE THE APPLY COUNT COMES FROM, so the number on the button is never
  // a stale one from a previous set of filters.
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

  const maxOffset = draft && draft.length ? Math.max(...draft.map(s => Number(s.offsetDays) || 0)) : 0;
  const touches = draft && draft.length
    ? `${draft.length} touch${draft.length === 1 ? "" : "es"} over ${
        maxOffset < 45 ? `${Math.max(1, Math.round(maxOffset / 7))} week${Math.round(maxOffset / 7) === 1 ? "" : "s"}`
                       : `${Math.round(maxOffset / 30)} month${Math.round(maxOffset / 30) === 1 ? "" : "s"}`}. `
      + "Nothing is sent without you."
    : "";

  if (err && !data) return <div style={{ fontSize: 13, color: T.terracotta }}>{err}</div>;
  if (!data) return <div style={{ fontSize: 13, color: T.ink3 }}>Loading…</div>;

  const needsAmount = !!(data.triggers || []).find(t => t.key === (meta?.trigger || "") && t.needsAmount);

  return (
    <div data-testid="journey-builder">
      <style>{`
        /* SUBTLE MOTION, and none of it for anybody who asked for none. */
        .jb-node{ transition: transform .18s cubic-bezier(.2,.7,.3,1), box-shadow .18s ease,
                              background .18s ease, border-color .18s ease; }
        .jb-node:hover{ transform: translateY(-1px); }
        .jb-node.sel{ transform: translateY(-3px) scale(1.15); }
        .jb-node.dragging{ opacity:.4; }
        .jb-card{ transition: border-color .18s ease, box-shadow .18s ease; }
        @media (prefers-reduced-motion: reduce){
          .jb-node, .jb-card{ transition:none !important; }
          .jb-node:hover, .jb-node.sel{ transform:none; }
        }
        @media (max-width: ${SPINE_BREAKPOINT}px){
          /* THE CHAIN BECOMES A LIST. Seven nodes in 342px is a smudge, not a
             timeline: the idea is that time is a line you can see, and on a
             phone that line is vertical. Everything else stacks with it. */
          .jb-grid{ grid-template-columns: 1fr !important; }
          .jb-chain-wrap{ display:none !important; }
          .jb-list{ display:block !important; }
          .jb-actions{ flex-direction: column !important; align-items: stretch !important; }
          .jb-actions > *{ width: 100%; }
          .jb-head{ flex-direction: column !important; align-items: stretch !important; }
        }
      `}</style>

      <div style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.6, marginBottom: 16, maxWidth: 680 }}>
        A journey is a set of steps that starts on its own when something happens, like somebody giving
        for the first time or a lapsed donor coming back, and then reminds you one step at a time.
        <strong style={{ color: T.ink }}> It never sends anything.</strong> Every step waits for you.
      </div>

      {/* ── FIX-5 item 1 · THE ONE ACTION, AT THE TOP ───────────────────── */}
      {editable && (
        <div className="jb-head" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <button data-testid="jb-create-open" style={BTN_GO}
            onClick={() => setCreateDraft({ name: "", description: "", trigger: "", amountCents: null,
                                            priority: 50, audience: {}, steps: [{ ...NEW_STEP, label: "Say thank you", type: "thank", offsetDays: 2,
                                                                                  timing: { from: "trigger", value: 2, unit: "days" } }] })}>
            Create a journey
          </button>
          <span style={{ fontSize: 12.5, color: T.ink3 }}>
            Name it, choose what starts it, then build the steps.
          </span>
        </div>
      )}

      {err && <div style={{ fontSize: 13, color: T.terra700, background: T.terra100, border: "1px solid " + T.terra200,
                            borderRadius: 9, padding: "9px 12px", marginBottom: 12 }}>{err}</div>}

      {/* ── FIX-5 item 5 · DELETE WITH AN UNDO ──────────────────────────── */}
      {undo && (
        <div data-testid="jb-undo" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
              background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: T.ink }}>{undo.sentence}</span>
          <button onClick={restoreJourney} data-testid="jb-undo-restore"
            style={{ ...BTN, marginLeft: "auto", borderColor: T.greenDk, color: T.greenDk, fontWeight: 700 }}>
            Put it back
          </button>
          <button onClick={() => setUndo(null)} style={{ ...BTN, border: "none", color: T.ink3 }}>Dismiss</button>
        </div>
      )}

      {/* ── the journeys this org has ─────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {(data.journeys || []).length === 0 && (
          <div style={{ fontSize: 13, color: T.ink3 }}>
            No journeys yet. A journey makes sure a new donor never slips away unnoticed. Start from one of the shapes below, or create your own.
          </div>
        )}
        {(data.journeys || []).map(j => (
          <div key={j.id} data-testid="journey-row" className="jb-card"
            style={{ background: T.white, border: "1px solid " + (j.id === openId ? T.greenDk : T.bg3), borderRadius: 12,
                     boxShadow: j.id === openId ? "0 6px 26px rgba(15,26,18,0.08)" : "none" }}>
            <RecordLink to={tabHref("journeys", { journeyId: j.id })} onOpen={() => (j.id === openId ? setOpenId(null) : openJourney(j))}
              data-testid={"journey-open-" + j.id} data-record-link="journey" aria-expanded={j.id === openId}
              style={{ width: "100%", boxSizing: "border-box", textAlign: "left", background: "none", border: "none", padding: "14px 16px",
                       cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: T.ink, display: "block" }}>{j.name}</span>
                {j.description
                  ? <span style={{ fontSize: 12.5, color: T.ink3, display: "block", marginTop: 2 }}>{j.description}</span>
                  : null}
              </span>
              <span style={{ fontSize: 12, color: T.ink3 }}>{j.touches}</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                {/* PARITY-1 Part D — Running, Paused, Draft (Archived ones are
                    not in this list), and entered, in it, exited, completed. */}
                <span data-testid="jb-state" title={((data.states || []).find(x => x.key === j.state) || {}).sentence || ""}
                  style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 99, padding: "2px 9px",
                               background: j.enabled ? T.green100 : T.bg2, color: j.enabled ? T.greenDk : T.ink3 }}>
                  {((data.states || []).find(x => x.key === j.state) || {}).label || (j.enabled ? "Running" : "Paused")}
                </span>
                <span style={{ fontSize: 12, color: T.ink3 }} title="Entered: everyone who has gone in. In it: still running. Exited: left early. Completed: reached the end.">
                  {j.everIn} entered · {j.inIt} in it · {j.exited || 0} exited · {j.completed || 0} completed
                </span>
              </span>
            </RecordLink>

            {j.id === openId && draft && meta && (
              <div style={{ borderTop: "1px solid " + T.bg3 }}>
                {/* ── ROW 1 · THE CHAIN, THE FULL WIDTH OF THE CARD ───── */}
                <Chain steps={draft} sel={sel} onSelect={setSel} editable={editable}
                  dragFrom={dragFrom} onDragStart={setDragFrom} onDrop={drop} onAdd={addAt} preview={preview} />

                {/* ── ROW 2 · THE EDITOR, THEN THE LIVE PREVIEW ───────── */}
                <div className="jb-grid" style={{ display: "grid", gridTemplateColumns: "1.85fr 1fr", gap: 18,
                                                  padding: "0 16px 16px", alignItems: "start" }}>
                  <div style={{ minWidth: 0 }}>
                    <ChainList steps={draft} sel={sel} onSelect={setSel} preview={preview} />

                    {/* EVERY PART OF THE JOURNEY, EDITED IN PLACE. */}
                    <div style={{ border: "1px solid " + T.bg3, borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                        <label style={{ display: "block" }}>
                          <span style={LBL}>What it is called</span>
                          <input data-testid="jb-name" value={meta.name} disabled={!editable} style={INP}
                            onChange={e => setMeta(m => ({ ...m, name: e.target.value }))} />
                        </label>
                        <label style={{ display: "block" }}>
                          <span style={LBL}>One line about it</span>
                          <input data-testid="jb-description" value={meta.description} disabled={!editable} style={INP}
                            placeholder="Thank them properly, show them what it did, then ask again."
                            onChange={e => setMeta(m => ({ ...m, description: e.target.value }))} />
                        </label>
                      </div>
                      <div style={{ borderTop: "1px solid " + T.bg3, marginTop: 14, paddingTop: 12 }}>
                        <TriggerFields data={data} value={meta}
                          onChange={patch => setMeta(m => ({ ...m, ...patch }))}
                          amountSuggestion={needsAmount ? suggestion : null}
                          onAskAmount={() => setRowsPanel({
                            label: "Gifts that size or larger", count: (suggestion?.rows || []).length,
                            sentence: suggestion?.sentence || "", donors: suggestion?.rows || [] })} />
                      </div>
                    </div>

                    <StepEditor step={draft[sel]} index={sel} total={draft.length} data={data} editable={editable}
                      onSet={patch => setStep(sel, patch)} onAdd={addAt}
                      onDuplicate={duplicateStep} onRemove={removeStep} />

                    <p style={{ fontSize: 13.5, lineHeight: 1.6, color: T.ink3, margin: "14px 2px 0" }}>
                      <strong style={{ color: T.ink }} data-testid="jb-touches">{touches}</strong><br />
                      Every step becomes a next step on your Thread on the day it is due. You mark it done, or you skip it and say why.
                    </p>
                  </div>

                  {/* ── THE LIVE PREVIEW, on the profile's ink rail ───── */}
                  <div style={{ background: RAIL.bg, borderRadius: 14, padding: "16px 16px 18px", color: RAIL.text, minWidth: 0 }}>
                    <div style={{ ...CAP, color: RAIL.dim, letterSpacing: "0.1em", marginBottom: 10 }}>Live preview, a real donor</div>
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
                                <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 6, flexShrink: 0,
                                               background: s.state === "today" ? T.green500 : RAIL.dim,
                                               opacity: s.state === "upcoming" ? 0.55 : 1 }} />
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</div>
                                  <div style={{ fontSize: 11, color: RAIL.dim }}>{fmtShort(s.dueDate)}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div style={{ fontSize: 11, color: RAIL.dim, marginTop: 12, lineHeight: 1.5 }}>
                            {preview.legend || "Real dates on a real record, in your timezone. Change a step and these move."}
                          </div>
                        </>
                      )}
                  </div>
                </div>

                {/* ── ROW 3 · THE ACTIONS ────────────────────────────── */}
                {editable && (
                  <div className="jb-actions" style={{ borderTop: "1px solid " + T.bg3, padding: "14px 16px",
                        display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <button onClick={askThenSave} disabled={saving} data-testid="jb-save" style={BTN_GO}>
                      {saving ? "Saving…" : "Save the journey"}
                    </button>
                    <button data-testid="jb-toggle" style={BTN}
                      onClick={async () => {
                        await apiFetch(`/journeys/${current.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !current.enabled }) });
                        const d = await load();
                        const fresh = (d?.journeys || []).find(x => x.id === current.id);
                        if (fresh) setMeta(m => ({ ...m, enabled: !!fresh.enabled }));
                      }}>
                      {current.enabled ? "Turn it off" : "Turn it on"}
                    </button>
                    <button data-testid="jb-apply-open" style={BTN}
                      onClick={async () => { setAudience(meta.audience || {}); await recount(current.id, meta.audience || {}); }}>
                      Apply to people who already qualify
                    </button>
                    <button data-testid="jb-duplicate" style={BTN} onClick={() => duplicateJourney(current.id)}>
                      Duplicate this journey
                    </button>
                    <button data-testid="jb-delete" style={{ ...BTN, marginLeft: "auto", color: T.ink3 }}
                      onClick={() => deleteJourney(current)}>
                      Remove it
                    </button>
                  </div>
                )}

                {/* ── HOW IT IS GOING ────────────────────────────────── */}
                {stats && (
                  <div style={{ borderTop: "1px solid " + T.bg3, padding: "14px 16px" }}>
                    <div style={{ ...CAP, marginBottom: 10 }}>How it is going</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {stats.figures.map(f => (
                        <button key={f.key} data-testid={"jb-fig-" + f.key} title={f.sentence}
                          onClick={async () => {
                            try { setRowsPanel({ ...(await apiFetch(`/journeys/${current.id}/rows?rows=${f.rows}`)), label: f.label, sentence: f.sentence }); }
                            catch (e) { setErr(e?.message || "Could not open those rows."); }
                          }}
                          style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 11, padding: "10px 13px",
                                   cursor: "pointer", fontFamily: "inherit", textAlign: "left", minWidth: 128 }}>
                          <div style={{ ...CAP, fontSize: 9.5 }}>{f.label}</div>
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
          <div style={{ ...CAP, marginBottom: 10 }}>Start from one of these</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(data.presets || []).map(p => (
              <button key={p.key} onClick={() => pressPreset(p)} data-testid={"jb-preset-" + p.key}
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

      {/* ── FIX-5 item 1 · YOU ALREADY HAVE THIS ONE ──────────────────── */}
      {presetAsk && (
        <Modal onClose={() => setPresetAsk(null)} title="You already have this one">
          <p style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, marginTop: 0 }}>
            You already have {presetAsk.existing.map(e => `"${e.name}"`).join(" and ")}. Open it, or make a copy?
          </p>
          <p style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.55 }}>
            A copy arrives off, with its own name, so nothing starts firing while you change it.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button data-testid="jb-preset-open-existing" style={BTN_GO}
              onClick={async () => { const j = presetAsk.existing[0]; setPresetAsk(null); await openJourney(j); }}>
              Open {`"${presetAsk.existing[0].name}"`}
            </button>
            <button data-testid="jb-preset-copy" style={BTN}
              onClick={async () => { const j = presetAsk.existing[0]; setPresetAsk(null); await duplicateJourney(j.id); }}>
              Make a copy
            </button>
            <button style={{ ...BTN, border: "none", color: T.ink3 }} onClick={() => setPresetAsk(null)}>Never mind</button>
          </div>
        </Modal>
      )}

      {/* ── FIX-5 item 1 · CREATE ONE FROM SCRATCH ────────────────────── */}
      {createDraft && (
        <Modal onClose={() => setCreateDraft(null)}
          title={createDraft.fromPreset ? `Start "${createDraft.name}"` : "Create a journey"}>
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "block" }}>
              <span style={LBL}>What it is called</span>
              <input data-testid="jb-new-name" value={createDraft.name} style={INP} autoFocus
                placeholder="Second gift, within ninety days"
                onChange={e => setCreateDraft(c => ({ ...c, name: e.target.value }))} />
            </label>
            <label style={{ display: "block" }}>
              <span style={LBL}>One line about it</span>
              <input data-testid="jb-new-description" value={createDraft.description} style={INP}
                placeholder="What this journey is for, in a sentence."
                onChange={e => setCreateDraft(c => ({ ...c, description: e.target.value }))} />
            </label>
          </div>
          <div style={{ borderTop: "1px solid " + T.bg3, marginTop: 14, paddingTop: 12 }}>
            <TriggerFields data={data} value={createDraft} tid="jb-new"
              onChange={async patch => {
                setCreateDraft(c => ({ ...c, ...patch }));
                // Choosing a trigger that carries a number asks for the number
                // right here, prefilled from their own gifts. No refusal, no red.
                if (patch.trigger) {
                  const t = (data.triggers || []).find(x => x.key === patch.trigger);
                  if (t && t.needsAmount) {
                    const s = await loadSuggestion();
                    setCreateDraft(c => ({ ...c, amountCents: c.amountCents || (s ? s.cents : 100000) }));
                  }
                }
              }}
              amountSuggestion={(data.triggers || []).find(t => t.key === createDraft.trigger && t.needsAmount) ? suggestion : null}
              onAskAmount={() => setRowsPanel({
                label: "Gifts that size or larger", count: (suggestion?.rows || []).length,
                sentence: suggestion?.sentence || "", donors: suggestion?.rows || [] })} />
          </div>
          <p style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.55, marginTop: 14 }}>
            It arrives off, with {createDraft.steps.length === 1 ? "one step" : `${createDraft.steps.length} steps`} you can
            change, add to and reorder. Nothing starts until you turn it on.
          </p>
          {err && <div style={{ fontSize: 12.5, color: T.terra700, marginTop: 8 }}>{err}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button data-testid="jb-new-create" style={BTN_GO}
              disabled={!createDraft.name.trim() || !createDraft.trigger}
              onClick={() => createJourney({
                presetKey: createDraft.fromPreset || undefined,
                name: createDraft.name, description: createDraft.description, trigger: createDraft.trigger,
                amountCents: createDraft.amountCents, priority: createDraft.priority,
                audience: createDraft.audience, steps: createDraft.steps })}>
              Create it
            </button>
            <button style={BTN} onClick={() => setCreateDraft(null)}>Not now</button>
          </div>
        </Modal>
      )}

      {/* ── FIX-5 item 5 · WHO A SAVE REACHES ─────────────────────────── */}
      {affects && (
        <Modal onClose={() => setAffects(null)} title="Before you save">
          <p style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, marginTop: 0 }}>{affects.sentence}</p>
          {affects.movable > 0 && (
            <>
              <p style={{ fontSize: 13, color: T.ink, lineHeight: 1.6 }}>
                <strong data-testid="jb-affects-move">{affects.moveSentence}</strong>{" "}
                <button type="button" data-testid="jb-affects-rows"
                  onClick={() => setRowsPanel({ label: "Still to come", count: affects.donors.length,
                                                sentence: affects.moveSentence, donors: affects.donors })}
                  style={{ background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 13,
                           fontWeight: 600, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>
                  see who
                </button>
              </p>
              <p style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.55 }}>
                Steps somebody has already done, skipped or is working on now are never touched.
              </p>
            </>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button data-testid="jb-save-only-new" style={BTN_GO} disabled={saving} onClick={() => save(false)}>
              Save for people who enter from now on
            </button>
            {affects.movable > 0 && (
              <button data-testid="jb-save-and-move" style={BTN} disabled={saving} onClick={() => save(true)}>
                Save and move the {affects.movable} already in it
              </button>
            )}
            <button style={{ ...BTN, border: "none", color: T.ink3 }} onClick={() => setAffects(null)}>Keep editing</button>
          </div>
        </Modal>
      )}

      {/* THE DRILL-THROUGH. Every number opens its rows. */}
      {rowsPanel && (
        <Modal onClose={() => setRowsPanel(null)} title={`${rowsPanel.label} · ${rowsPanel.count}`}>
          <p style={{ fontSize: 13, color: T.ink3, lineHeight: 1.55, marginTop: 0 }}>{rowsPanel.sentence}</p>
          <div style={{ maxHeight: 340, overflowY: "auto" }}>
            {(rowsPanel.donors || []).map((d, i) => (
              <div key={(d.id || "") + i} style={{ padding: "8px 0", borderBottom: "1px solid " + T.bg3, fontSize: 13.5 }}>
                <DonorLink id={d.id} style={{ color: T.ink, fontWeight: 600 }}>{d.name}</DonorLink>
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

          {/* Every filter narrows and none of them widens, so the number on the
              button can only come down as you add one. It re-counts on every
              change: a confirm that names a number from a previous set of
              filters is a confirm to the wrong thing. */}
          <div data-testid="jb-audience" style={{ borderTop: "1px solid " + T.bg3, borderBottom: "1px solid " + T.bg3,
                                                  padding: "12px 0", margin: "12px 0" }}>
            <div style={{ ...CAP, marginBottom: 9 }}>Who it is for</div>
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
            Each of them gets the journey&apos;s steps from today. Nothing is sent, and every step waits for you.
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
