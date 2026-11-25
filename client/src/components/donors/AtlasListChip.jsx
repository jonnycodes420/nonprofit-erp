// donors/AtlasListChip.jsx · SENDS-3 item 4. THE PEOPLE ATLAS FOUND, AND NOTHING MADE.
//
// Atlas's "Open list" opens People narrowed to one answer's people
// (/donors?people=everyone&atlas=<action id>; the server reads the ids the
// answer saved). This line above the list says which question they answer,
// offers Save as group (the one press that makes a group) and Show everyone.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { errorMessage } from "../../lib/domainError";
import { useNavigate } from "react-router-dom";
import { tabHref } from "../../lib/appUrls";
import { useAtlasName } from "../../lib/atlas";

const linkBtn = { background: "none", border: "none", padding: 0, color: T.greenDk, fontSize: 13, fontWeight: 700, cursor: "pointer", textDecoration: "underline" };

export default function AtlasListChip({ actionId, onClear }) {
  const navigate = useNavigate();
  const atlas = useAtlasName();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setInfo(null); setErr("");
    apiFetch(`/atlas/actions/${encodeURIComponent(actionId)}/list`, { cache: "no-store" })
      .then(r => { if (live) setInfo(r); })
      .catch(e => { if (live) setErr(errorMessage(e, "Steward could not read which question this list answers.")); });
    return () => { live = false; };
  }, [actionId]);
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const r = await apiFetch(`/atlas/actions/${encodeURIComponent(actionId)}/group`, { method: "POST", body: "{}" });
      setInfo(i => ({ ...(i || {}), group: { id: r.groupId, name: r.name } }));
    } catch (e) { setErr(errorMessage(e, "The group wasn't saved. Nothing was made.")); }
    setBusy(false);
  };
  const n = info ? info.count : null;
  return (
    <div data-testid="dir-from-atlas" style={{ fontSize: 13, color: T.ink, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span>{info
        ? `Showing the ${n === 1 ? "1 person" : `${Number(n).toLocaleString("en-US")} people`} ${atlas} found for "${info.question}". Nothing was made from them.`
        : `Showing the people ${atlas} found.`}</span>
      {info && info.group
        ? <span data-testid="dir-from-atlas-saved">Saved as the group <button type="button" style={linkBtn} onClick={() => navigate(tabHref("groups", { groupId: info.group.id }))}>{info.group.name}</button>.</span>
        : <button type="button" data-testid="dir-from-atlas-save" disabled={busy || !info} onClick={save} style={linkBtn}>{busy ? "Saving…" : "Save as group"}</button>}
      {onClear && <button type="button" onClick={onClear} style={linkBtn}>Show everyone</button>}
      {err && <span role="alert" style={{ color: T.ink3 }}>{err}</span>}
    </div>
  );
}
