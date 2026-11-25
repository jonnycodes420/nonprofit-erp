// email-builder/Thumbnail.jsx · BUILDER-1. THE WHOLE EMAIL, SMALL.
//
// Above the settings: the same render as the canvas, scaled to fit, with the
// selected block marked. A click on a spot scrolls the email there. It is a
// picture of the email, so it takes no clicks of its own and runs no script.
import { useRef, useState, useEffect } from "react";
import { T } from "../shared";

const W = 640, BOX_W = 268, BOX_H = 190;

export function Thumbnail({ html, selected, frameRef }) {
  const ref = useRef(null);
  const [h, setH] = useState(900);
  const [mark, setMark] = useState(null);
  const measure = () => {
    let doc = null;
    try { doc = ref.current && ref.current.contentDocument; } catch { doc = null; }
    if (!doc || !doc.body) return;
    setH(Math.max(300, doc.documentElement.scrollHeight || doc.body.scrollHeight || 900));
    if (selected == null) { setMark(null); return; }
    const rows = [...doc.querySelectorAll(`tr[data-st-block="${selected}"]`)];
    if (!rows.length) { setMark(null); return; }
    const rs = rows.map(r => r.getBoundingClientRect());
    setMark({ top: Math.min(...rs.map(r => r.top)), bottom: Math.max(...rs.map(r => r.bottom)), left: Math.min(...rs.map(r => r.left)), right: Math.max(...rs.map(r => r.right)) });
  };
  useEffect(measure, [selected]);
  const scale = Math.min(BOX_W / W, BOX_H / h);
  const go = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientY - r.top) / (h * scale)));
    let win = null;
    try { win = frameRef.current && frameRef.current.contentWindow; } catch { win = null; }
    if (!win) return;
    const full = win.document.documentElement.scrollHeight;
    win.scrollTo({ top: Math.max(0, frac * full - win.innerHeight / 3), behavior: "smooth" });
  };
  if (!html) return null;
  return (
    <div data-testid="email-thumbnail" style={{ padding: "12px 16px", borderBottom: "1px solid " + T.bg2, flexShrink: 0 }}>
      <div onClick={go} title="Click a spot to go there" role="button" aria-label="The whole email. Click a spot to go there."
        style={{ position: "relative", width: W * scale, height: h * scale, margin: "0 auto", cursor: "pointer", borderRadius: 6, overflow: "hidden", boxShadow: "0 0 0 1px " + T.bg2, background: T.bg }}>
        <iframe ref={ref} title="The whole email, small" srcDoc={html} sandbox="allow-same-origin" tabIndex={-1} aria-hidden="true" onLoad={measure}
          style={{ width: W, height: h, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none", display: "block" }} />
        {mark && <span data-testid="email-thumbnail-mark" aria-hidden="true" style={{ position: "absolute", top: mark.top * scale, left: mark.left * scale, width: (mark.right - mark.left) * scale,
          height: Math.max(3, (mark.bottom - mark.top) * scale), border: "1.5px solid " + T.green, borderRadius: 2, pointerEvents: "none", boxSizing: "border-box" }} />}
      </div>
    </div>
  );
}
