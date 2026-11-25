// email-builder/SaveAsBlock.jsx · BUILDER-2B item 3. SAVE A BLOCK TO USE AGAIN.
//
// On the selected block's settings: Save as a block. She names it, and may take
// the parts below it too (a run of blocks). It is saved for everyone in the org
// (POST /email-blocks, which checks it with validateEmailBlocks), with a small
// picture, and shows in the Blocks tab. Merge fields inside stay fields.
import { useState } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { Sec, paneInput, paneBtn, paneNote } from "./controls";

// run(n): the selected block and the n parts after it, as saved blocks (no keys).
// max: how many parts follow it (the footer never counts).
export function SaveAsBlock({ defaultName, run, max, onSaved, say }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [more, setMore] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    const n = name.trim() || defaultName;
    setBusy(true); setErr("");
    try {
      const r = await apiFetch("/email-blocks", { method: "POST", body: JSON.stringify({ name: n, blocks: run(more) }) });
      setOpen(false); setName(""); setMore(0);
      onSaved(r.block);
      say(`Saved as "${n}". It is in the Blocks tab for everyone in your organization.`);
    } catch (e) { setErr(errorMessage(e, "That block did not save.")); }
    setBusy(false);
  };
  if (!open) return <Sec><button type="button" style={paneBtn} data-testid="save-as-block" onClick={() => setOpen(true)}>Save as a block</button>
    <div style={{ ...paneNote, marginTop: 6 }}>Keep this part to use again in any email.</div></Sec>;
  return (
    <Sec title="Save as a block" testid="save-as-block-form">
      <input autoFocus style={paneInput} value={name} placeholder={defaultName} aria-label="Block name" data-testid="save-as-block-name"
        onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setOpen(false); }} />
      {max > 0 && (
        <label style={{ ...paneNote, display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          With the next
          <select value={more} onChange={e => setMore(Number(e.target.value))} data-testid="save-as-block-more" style={{ ...paneInput, width: 64, padding: "3px 6px" }}>
            {Array.from({ length: max + 1 }, (_, k) => <option key={k} value={k}>{k}</option>)}
          </select>
          {more === 1 ? "part" : "parts"} below it
        </label>)}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button type="button" style={paneBtn} disabled={busy} data-testid="save-as-block-save" onClick={save}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" style={paneBtn} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {err && <div role="alert" style={{ ...paneNote, marginTop: 6 }}>{err}</div>}
    </Sec>
  );
}
