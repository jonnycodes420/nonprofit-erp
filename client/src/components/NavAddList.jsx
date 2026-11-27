// NAV-2 (27 Nov) · ADD TO YOUR SIDEBAR. The second part of both menu editors
// (Settings → Menu for the org, the sidebar's own Customize for a person):
// every entry that is not on the sidebar, with its icon, one plain sentence of
// what it is for (lib/navPurpose.js) and an Add button. The first
// part, what is on it, is CustomizeNav.jsx's NavLayoutList.
//
// `groups` is the same merged layout the first part reads; this lists its
// entries that are off. Home and Settings are never off, so never here.
import { T } from "./shared";
import { NavIcon } from "./NavIcon";
import { NEVER_HIDDEN } from "../lib/navGroups";
import { NAV_PURPOSE } from "../lib/navPurpose";

export function NavAddList({ groups, labelOf, onAdd, testId = "nav-add-list", empty }) {
  const off = (groups || []).flatMap(g => g.items.filter(i => !i.visible && !NEVER_HIDDEN.has(i.id)));
  return (
    <div data-testid={testId} style={{ margin: "0 0 14px" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, marginBottom: 6 }}>Add to your sidebar</div>
      {off.length === 0
        ? <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>{empty || "Everything is on the sidebar."}</div>
        : off.map(it => {
          const name = labelOf(it.id);
          return (
            <div key={it.id} data-nav-add-row={it.id}
              style={{ display: "flex", alignItems: "center", gap: 10, background: T.white, border: "1px solid " + T.bg3,
                       borderRadius: 10, padding: "8px 10px", marginBottom: 6 }}>
              <span style={{ color: T.ink2, display: "flex" }}><NavIcon id={it.id} size={17} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: T.ink }}>{name}</span>
                {NAV_PURPOSE[it.id] && <span style={{ display: "block", fontSize: 12, color: T.ink3, lineHeight: 1.45 }}>{NAV_PURPOSE[it.id]}</span>}
              </span>
              <button type="button" data-nav-add={it.id} aria-label={`Add ${name} to the sidebar`} onClick={() => onAdd(it.id)}
                style={{ background: T.greenDk, border: "none", borderRadius: 8, padding: "6px 14px", color: T.white,
                         fontSize: 12.5, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                Add
              </button>
            </div>
          );
        })}
    </div>
  );
}
