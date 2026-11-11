// client/src/components/settings/OrgMenuEditor.jsx · NAV-1 (menu, 10 Nov).
// THE ORG'S SIDEBAR, AND WHICH MAJOR GIFTS TABS IT SHOWS.
//
// One editor, two doors: Settings → Menu and Settings → Major gifts (an
// admin, for their own org, PUT /org/menu) and super-admin → Organizations
// (Jonathan, for any org, POST /admin/orgs/:id/menu). The caller passes `load`
// and `save`; everything else is the same.
//
// The sidebar: every entry, Show / Hide and moved within its group (drag, or
// the arrows). Every entry starts on for every org (Jonathan, 10 Nov), and
// each org hides what it doesn't use. Hiding is the menu only: every link and
// route still works and nothing is deleted. Each person can still hide more
// for themselves (the sidebar's own Customize).
import { useEffect, useState } from "react";
import { T } from "../shared";
import { apiFetch } from "../../api";
import { NavLayoutList } from "../CustomizeNav";
import { orgNavLayout, flattenNav, moveNavItem, setNavVisible } from "../../lib/navGroups";
import { TABS, CRM_HIDDEN_TABS } from "../../lib/tabRegistry";
import { MG_VIEWS } from "../../lib/majorGiftsTab";

const labelOf = id => (TABS.find(t => t.id === id) || {}).label || id;
const box = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "22px 26px", marginBottom: 16 };
const note = { fontSize: 12.5, color: T.ink3, lineHeight: 1.6, margin: "6px 0 14px", maxWidth: 560 };

function useOrgMenu(load, save, announce) {
  const [m, setM] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { load().then(setM).catch(() => setMsg("The menu settings did not load.")); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const put = async body => {
    setMsg("");
    try {
      const next = await save(body);
      setM(next); setMsg("Saved.");
      // the sidebar on this screen follows at once (App.jsx listens) — only for one's own org
      if (announce && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("steward:org-menu", { detail: next }));
    }
    catch (e) { setMsg((e && e.message) || "That did not save."); }
  };
  return { m, msg, put };
}

export function OrgMenuCard({ load, save, canEdit = true, who = "Everyone in your organization", announce = false }) {
  const { m, msg, put } = useOrgMenu(load, save, announce);
  if (!m) return <div style={box} data-testid="org-menu"><div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Menu</div><p style={note}>{msg || "Loading…"}</p></div>;
  const groups = orgNavLayout(m.layout).map(g => ({ ...g, items: g.items.filter(i => !CRM_HIDDEN_TABS.has(i.id)) }));
  const write = next => put({ layout: flattenNav(next) });
  return (
    <div style={box} data-testid="org-menu">
      <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Menu</div>
      <p style={note}>{who} sees the sidebar this way. Hiding an entry takes it off the menu only: its pages and links still work,
        and nothing is deleted. Each person can still hide more for themselves.</p>
      <div style={{ opacity: canEdit ? 1 : 0.6, pointerEvents: canEdit ? "auto" : "none" }}>
        <NavLayoutList groups={groups} labelOf={labelOf} testId="org-menu-list"
          onMove={(gid, id, d) => write(moveNavItem(groups, gid, id, d))}
          onToggle={(id, v) => write(setNavVisible(groups, id, v))} />
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" data-testid="org-menu-reset" disabled={!canEdit} onClick={() => put({ layout: null })}
          style={{ background: T.white, border: "1.5px solid " + T.bg3, borderRadius: 10, padding: "8px 14px", color: T.ink2, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          Back to the defaults</button>
        <span style={{ fontSize: 12, color: T.ink3 }}>The defaults show every entry.</span>
      </div>
      {msg && <div role="status" data-testid="org-menu-msg" style={{ fontSize: 12.5, color: T.ink, marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

export function MajorGiftsTabsCard({ load, save, canEdit = true, announce = false }) {
  const { m, msg, put } = useOrgMenu(load, save, announce);
  if (!m) return <div style={box} data-testid="org-mg-views"><div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Major Gifts shows</div><p style={note}>{msg || "Loading…"}</p></div>;
  const on = new Set(m.mgViews || MG_VIEWS.map(v => v.id));
  const flip = (id, want) => {
    const next = MG_VIEWS.map(v => v.id).filter(v => (v === id ? want : on.has(v)));
    if (!next.length) return;   // at least one: the server refuses none too
    put({ mgViews: next });
  };
  return (
    <div style={box} data-testid="org-mg-views">
      <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Major Gifts shows</div>
      <p style={note}>The tabs on the Major Gifts page. With one on, the page is just that view, with no tabs. The sidebar still says Major Gifts.</p>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        {MG_VIEWS.map(v => (
          <label key={v.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, color: T.ink, minHeight: 36 }}>
            <input type="checkbox" data-mg-view-toggle={v.id} checked={on.has(v.id)} disabled={!canEdit || (on.has(v.id) && on.size === 1)}
              onChange={e => flip(v.id, e.target.checked)} />
            {v.label}
          </label>))}
      </div>
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink, marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

// Settings → Menu and Settings → Major gifts: this org, through /org/menu.
export function MenuSection({ section, isReadOnly }) {
  const load = () => apiFetch("/org/menu");
  const save = body => apiFetch("/org/menu", { method: "PUT", body: JSON.stringify(body) });
  return section === "majorgifts"
    ? <MajorGiftsTabsCard load={load} save={save} canEdit={!isReadOnly} announce />
    : <OrgMenuCard load={load} save={save} canEdit={!isReadOnly} announce />;
}
