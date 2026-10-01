// NAV-1 §4 — CUSTOMIZE THE SIDEBAR, PER PERSON.
//
// Groups make the rail scannable for everybody; this makes it hers. Each item
// can be hidden, and moved within its group — never OUT of its group, because
// the groups are the thing that made the rail readable and a per-person
// shuffle across them would undo it for the one person it was meant to help.
//
// Three ways to move a row, because one of them is always the wrong one:
// the up/down buttons (a phone, a trackpad, a keyboard), and dragging (a mouse,
// at desktop width, constrained to the row's own group). "Reset to default"
// puts back the groups in NAV_GROUPS.
//
// Stored PER USER (users.nav_layout, through /me/nav-layout) and not per org:
// two people share an organisation and not a job, and the volunteer
// coordinator's rail is not the finance manager's.
import { useState } from "react";
import { T, Modal } from "./shared";
import { NavIcon } from "./NavIcon";
import { NEVER_HIDDEN } from "../lib/navGroups";

const rowStyle = (visible, dragOver) => ({
  display: "flex", alignItems: "center", gap: 10,
  background: dragOver ? T.bg2 : T.white,
  border: `1px solid ${dragOver ? T.greenDk : T.bg3}`,
  borderRadius: 10, padding: "8px 10px", marginBottom: 6,
  opacity: visible ? 1 : 0.55,
});

const miniBtn = disabled => ({
  background: T.white, border: `1px solid ${T.bg3}`, borderRadius: 7,
  width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
  color: disabled ? T.bg3 : T.ink2, fontSize: 12, lineHeight: 1,
  cursor: disabled ? "default" : "pointer", flexShrink: 0, padding: 0,
});

export function CustomizeNav({ groups, labelOf, onMove, onToggle, onReset, onClose, error }) {
  const [drag, setDrag] = useState(null);       // { groupId, id }
  const [over, setOver] = useState(null);       // id currently dragged onto

  const drop = (groupId, id) => {
    if (!drag || drag.groupId !== groupId || drag.id === id) { setDrag(null); setOver(null); return; }
    const g = groups.find(x => x.id === groupId);
    const from = g.items.findIndex(i => i.id === drag.id);
    const to = g.items.findIndex(i => i.id === id);
    onMove(groupId, drag.id, to - from);
    setDrag(null); setOver(null);
  };

  return <Modal onClose={onClose} title="Customize the sidebar" width={460}
    subtitle="Hide what you don't use, and put what you do use where you want it. This is yours alone: nobody else in your organisation sees these changes."
    footer={<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button type="button" data-testid="nav-reset" onClick={onReset}
        style={{ background: T.white, border: `1.5px solid ${T.bg3}`, borderRadius: 10, padding: "8px 14px",
                 color: T.ink2, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
        Reset to default
      </button>
      <div style={{ flex: 1 }} />
      <button type="button" onClick={onClose}
        style={{ background: T.greenDk, border: "none", borderRadius: 10, padding: "9px 20px",
                 color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
        Done
      </button>
    </div>}>
    {error && <div role="status" style={{ background: T.gold700, color: T.gold50, borderRadius: 10, padding: "8px 12px",
      fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
    <div data-testid="customize-nav">
      {groups.map(g => g.items.length === 0 ? null : <div key={g.id} style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.11em", textTransform: "uppercase",
          color: T.ink3, marginBottom: 6 }}>{g.label || (g.bottom ? "Bottom of the sidebar" : "Top of the sidebar")}</div>
        {g.items.map((it, idx) => {
          const pinned = NEVER_HIDDEN.has(it.id);
          const name = labelOf(it.id);
          return <div key={it.id} data-nav-row={it.id} draggable
            onDragStart={() => setDrag({ groupId: g.id, id: it.id })}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onDragOver={e => { if (drag && drag.groupId === g.id) { e.preventDefault(); setOver(it.id); } }}
            onDragLeave={() => setOver(o => o === it.id ? null : o)}
            onDrop={e => { e.preventDefault(); drop(g.id, it.id); }}
            style={rowStyle(it.visible, over === it.id && drag && drag.groupId === g.id)}>
            <span aria-hidden="true" style={{ color: T.ink3, fontSize: 13, cursor: "grab", letterSpacing: "0.1em" }}>⋮⋮</span>
            <span style={{ color: it.visible ? T.ink : T.ink3, display: "flex" }}><NavIcon id={it.id} size={17} /></span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: it.visible ? T.ink : T.ink3 }}>{name}</span>
            <button type="button" aria-label={`Move ${name} up`} disabled={idx === 0}
              onClick={() => onMove(g.id, it.id, -1)} style={miniBtn(idx === 0)}>↑</button>
            <button type="button" aria-label={`Move ${name} down`} disabled={idx === g.items.length - 1}
              onClick={() => onMove(g.id, it.id, 1)} style={miniBtn(idx === g.items.length - 1)}>↓</button>
            {pinned
              ? <span style={{ fontSize: 11, color: T.ink3, fontWeight: 600, width: 62, textAlign: "right" }}>Always on</span>
              : <button type="button" data-nav-toggle={it.id} aria-pressed={!it.visible}
                  onClick={() => onToggle(it.id, !it.visible)}
                  style={{ background: "none", border: "none", color: T.greenDk, fontSize: 12, fontWeight: 700,
                           cursor: "pointer", width: 62, textAlign: "right", padding: 0 }}>
                  {it.visible ? "Hide" : "Show"}
                </button>}
          </div>;
        })}
      </div>)}
    </div>
    <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.6 }}>
      Home and Settings stay on the rail: one is where every link lands, and the other is where
      you undo a mistake. An item you hide is still reachable from search and from every link to it.
    </div>
  </Modal>;
}
