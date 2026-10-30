// InlineText.jsx · EDITOR-1. WORDS TYPED WHERE THEY SHOW.
//
// A heading or a paragraph in an editor's preview that is typed into in
// place. Plain text only (a paste brings no markup with it), and React never
// writes into it while it has the caret, so typing is never interrupted by
// the re-render its own keystroke causes. A new value from outside (a Revert,
// a restore, an AI proposal) is put in only while it is not being typed in.
import { useRef, useEffect, createElement } from "react";

export default function InlineText({ value, onChange, as = "span", multiline = false, placeholder = "", className, style, testid, field, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el === document.activeElement) return;
    const next = String(value || "");
    if (el.innerText !== next) el.innerText = next;
  }, [value]);
  const read = () => {
    const el = ref.current;
    if (!el) return;
    let t = el.innerText.replace(/ /g, " ");
    if (!multiline) t = t.replace(/\s*\n+\s*/g, " ");
    else t = t.replace(/\n{3,}/g, "\n\n");
    onChange(t);
  };
  return createElement(as, {
    ref, className, "data-testid": testid, "data-inline": field || "", "data-placeholder": placeholder,
    "aria-label": label || placeholder || "Type here", role: "textbox", "aria-multiline": multiline ? "true" : "false",
    contentEditable: "plaintext-only", suppressContentEditableWarning: true, spellCheck: true,
    onInput: read, onBlur: read,
    onKeyDown: e => { if (!multiline && e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } },
    style: { outline: "none", cursor: "text", whiteSpace: multiline ? "pre-wrap" : undefined, minWidth: 20, ...style },
  });
}

// The look an editable word has: a soft dashed line on hover, a firm one
// while typing, and the placeholder when it is empty. One <style>, so every
// editor's preview reads the same.
export const INLINE_CSS = `
[data-inline]{border-radius:4px;transition:box-shadow .12s}
[data-inline]:hover{box-shadow:0 0 0 1px rgba(13,92,58,.45)}
[data-inline]:focus{box-shadow:0 0 0 2px #0d5c3a}
[data-inline]:empty:before{content:attr(data-placeholder);color:#5a554f;opacity:.7}
`;
