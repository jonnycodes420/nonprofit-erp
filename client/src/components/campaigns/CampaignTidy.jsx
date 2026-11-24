// CampaignTidy.jsx · LETTERS-1 item 4. DRAFTS, AND CAMPAIGNS OF ONE NAME.
//
// "...it's not showing up in my campaigns page... if it was there, I'd go in
// and I'd delete it." A campaign made from Add a gift has no goal, so the list
// below this never showed it. Here it is, marked Draft, with the three ways
// out: Finish (give it a goal), Merge into the campaign it meant, or Delete
// (removal.js decides: deleted, or retired when gifts are counted to it).
// Two campaigns that share a name (case and spacing ignored) are offered as
// one merge. Every merge and removal offers Undo.
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { askConfirm } from "../ConfirmDialog";
import { offerUndo } from "../EditHistory";
import { removalPlan, confirmOpts, offerRemovalUndo } from "../../lib/removeThrough";

const small = { background: "transparent", color: T.ink, border: `1px solid ${T.bg3}`, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const giftsWord = n => `${n} ${n === 1 ? "gift" : "gifts"}`;

export default function CampaignTidy({ isReadOnly, isAdmin, onFinish, onChanged }) {
  const [drafts, setDrafts] = useState(null);
  const [dupes, setDupes] = useState([]);
  const [msg, setMsg] = useState("");
  const [into, setInto] = useState({});
  const [live, setLive] = useState([]);
  const load = useCallback(() => {
    apiFetch("/campaign-tidy/drafts").then(setDrafts).catch(() => setDrafts({ drafts: [] }));
    apiFetch("/campaign-tidy/duplicates").then(r => setDupes(r.groups || [])).catch(() => setDupes([]));
    apiFetch("/gift-attribution/campaign?q=").then(r => setLive(r.rows || [])).catch(() => setLive([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  const after = () => { load(); onChanged && onChanged(); };

  const merge = async (keep, others) => {
    const names = others.map(o => `"${o.name}"`).join(", ");
    const moving = others.reduce((n, o) => n + (o.gifts || 0), 0);
    const yes = await askConfirm({ title: `Merge into "${keep.name}"?`,
      body: `${names} ${others.length === 1 ? "is" : "are"} merged into "${keep.name}". ${giftsWord(moving)} ${moving === 1 ? "moves" : "move"} to it, and the merged ${others.length === 1 ? "campaign is" : "campaigns are"} retired: kept on past reports, never offered again. You can undo this.`,
      yes: "Merge" });
    if (!yes) return;
    try {
      const r = await apiFetch("/campaign-tidy/merge", { method: "POST", body: JSON.stringify({ keepId: keep.id, mergeIds: others.map(o => o.id) }) });
      setMsg(r.sentence);
      offerUndo({ message: r.sentence, undoAction: async () => { const x = await apiFetch(r.undo.path, { method: "POST", body: "{}" }); after(); return x || {}; } }, "Undo the merge");
      after();
    } catch (e) { setMsg(errorMessage(e, "Those campaigns could not be merged.")); }
  };
  const remove = async c => {
    try {
      const p = await removalPlan("campaign", c.id);
      if (p.mode === "refuse") { await askConfirm({ title: p.title, body: p.body, yes: "OK" }); return; }
      if (!(await askConfirm(confirmOpts(p)))) return;
      const r = await apiFetch(`/removals/campaign/${encodeURIComponent(c.id)}`, { method: "POST", body: "{}" });
      setMsg(r.sentence || "Done.");
      offerRemovalUndo(r, "Undo", after);
      after();
    } catch (e) { setMsg(errorMessage(e, "That campaign could not be removed.")); }
  };

  const list = (drafts && drafts.drafts) || [];
  if (!list.length && !dupes.length) return msg ? <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div> : null;
  const canAct = !isReadOnly && isAdmin;
  return (
    <section data-testid="campaign-tidy" style={{ background: T.white, border: `1px solid ${T.gold}`, borderRadius: 12, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
      {dupes.map(g => {
        const keep = g.campaigns.find(c => c.id === g.keep) || g.campaigns[0];
        const others = g.campaigns.filter(c => c.id !== keep.id);
        return (
          <div key={keep.id} data-testid="campaign-dupe" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: T.ink }}>
            <span><strong>{g.campaigns.length} campaigns are named "{keep.name}"</strong> ({g.campaigns.map(c => `${c.draft ? "Draft, " : ""}${giftsWord(c.gifts)}`).join("; ")}).</span>
            {canAct && <button type="button" style={small} onClick={() => merge(keep, others)} data-testid="campaign-dupe-merge">Merge into one</button>}
          </div>);
      })}
      {list.length > 0 && <div style={{ fontSize: 13, color: T.ink3 }}>{drafts.sentence}</div>}
      {list.map(c => {
        const targets = live.filter(r => r.id !== c.id && !r.draft);
        return (
          <div key={c.id} data-testid="campaign-draft" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${T.bg2}`, paddingTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.gold700 || T.ink, background: T.gold100 || T.bg, borderRadius: 99, padding: "2px 8px" }}>Draft</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{c.name}</span>
            <span style={{ fontSize: 12, color: T.ink3 }}>{giftsWord(c.gifts)}{c.createdBy ? ` · made by ${c.createdBy}` : ""}</span>
            {canAct && <>
              <button type="button" style={small} onClick={() => onFinish && onFinish({ id: c.id, name: c.name })} data-testid="campaign-draft-finish">Finish</button>
              {targets.length > 0 && (
                <span style={{ display: "inline-flex", gap: 4 }}>
                  <select value={into[c.id] || ""} onChange={e => setInto(m => ({ ...m, [c.id]: e.target.value }))} aria-label={`Merge ${c.name} into`}
                    style={{ border: `1px solid ${T.bg3}`, borderRadius: 6, padding: "3px 6px", fontSize: 12, color: T.ink, background: T.white }}>
                    <option value="">Merge into…</option>
                    {targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button type="button" style={small} disabled={!into[c.id]} onClick={() => merge(targets.find(t => t.id === into[c.id]), [c])} data-testid="campaign-draft-merge">Merge</button>
                </span>)}
              <button type="button" style={small} onClick={() => remove(c)} data-testid="campaign-draft-delete">Delete</button>
            </>}
          </div>);
      })}
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
    </section>
  );
}
