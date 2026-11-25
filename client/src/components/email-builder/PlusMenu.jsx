// email-builder/PlusMenu.jsx · BUILDER-2B item 5. THE FLOATING "+".
//
// Hovering between two blocks shows a "+" (frameDnD.js); clicking it opens
// this list right there: the Elements, then the saved and ready-made blocks.
// A pick lands at that place, as one undo step, like a drop.
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api";
import { T } from "../shared";
import { paneLabel, paneNote } from "./controls";

const item = { display: "block", width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "6px 10px", borderRadius: 6,
  fontSize: 13, color: T.ink, cursor: "pointer", fontFamily: "inherit" };

// at: the place. rect: where the "+" is on the page. tiles: [{ key, name, def, list }].
export function PlusMenu({ rect, tiles, onPickElement, onPickBlock, onClose }) {
  const ref = useRef(null);
  const [saved, setSaved] = useState(null);
  const [ready, setReady] = useState(null);
  useEffect(() => {
    apiFetch("/email-blocks").then(r => setSaved(r.saved || [])).catch(() => setSaved([]));
    apiFetch("/email-blocks/ready").then(r => setReady(r.ready || [])).catch(() => setReady([]));
  }, []);
  useEffect(() => {
    const away = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const esc = e => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => window.addEventListener("mousedown", away), 0);
    window.addEventListener("keydown", esc);
    return () => { clearTimeout(t); window.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [onClose]);
  const W = 260, H = 380;
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, rect.left + (rect.right - rect.left) / 2 - W / 2));
  const top = rect.bottom + 8 + H > window.innerHeight ? Math.max(8, rect.top - H - 8) : rect.bottom + 8;
  return (
    <div ref={ref} role="dialog" aria-label="Add here" data-testid="plus-menu"
      style={{ position: "fixed", left, top, width: W, maxHeight: H, overflowY: "auto", zIndex: 650, background: T.white, borderRadius: 12,
        border: "1px solid " + T.bg2, boxShadow: "0 12px 40px rgba(15,26,18,.18)", padding: 8 }}>
      <div style={{ ...paneLabel, padding: "4px 10px" }}>Elements</div>
      {tiles.map(t => <button key={t.key} type="button" style={item} data-testid={"plus-element-" + t.key} onClick={() => onPickElement(t)}
        onMouseEnter={e => { e.currentTarget.style.background = T.bg; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>{t.name}</button>)}
      <div style={{ ...paneLabel, padding: "10px 10px 4px" }}>Blocks</div>
      {saved == null || ready == null ? <div style={{ ...paneNote, padding: "4px 10px" }}>Reading…</div> : <>
        {saved.map(s => <button key={s.id} type="button" style={item} data-testid={"plus-saved-" + s.id} onClick={() => onPickBlock({ saved: s.id })}>{s.name}</button>)}
        {ready.map(r => <button key={r.key} type="button" style={item} data-testid={"plus-ready-" + r.key} onClick={() => onPickBlock({ ready: r.key })}>{r.name}</button>)}
      </>}
    </div>
  );
}
