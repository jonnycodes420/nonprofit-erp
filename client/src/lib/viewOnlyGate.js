// lib/viewOnlyGate.js · ACCESS-1. Disables, for a viewer, the buttons that would
// change something, with the tooltip "View-only access". Loaded only for a
// viewer (lib/viewOnly.js), so nobody else downloads it.
import { VIEW_ONLY_TIP } from "../../../shared/viewOnly.js";
import { isViewer } from "./viewOnly.js";

// The words a button that changes something starts with. A button inside an
// element marked data-viewer-ok (her own account, Atlas's question box, the
// switcher) is hers to press.
const WRITE_WORDS = /^\s*(\+|add\b|new\b|save\b|record\b|delete\b|remove\b|import\b|send\b|create\b|edit\b|merge\b|approve\b|archive\b|invite\b|upload\b|connect\b|disconnect\b|assign\b|mark\b|schedule\b|draft\b|enable\b|disable\b|restore\b|resend\b|revoke\b|update\b|undo\b|turn (on|off)\b|log (a|the|gift|call|conversation|hours|it|this)\b|set up\b|move\b|change\b|apply\b|start\b|stop\b|pause\b|resume\b|cancel (the|this|subscription|plan)\b|thank\b|write\b|duplicate\b|rename\b|tag\b|attach\b|link\b|confirm\b)/i;

// Words that only change what she is looking at: never gated ("+ Add filter").
const LOOKING_WORDS = /\b(filter|filters|sort|search|view|views|columns?|zoom|show|hide|expand|collapse)\b/i;

function gate(root) {
  const buttons = root.querySelectorAll ? root.querySelectorAll("button, [role=button], input[type=submit]") : [];
  for (const b of buttons) {
    if (b.dataset.viewOnly === "1" || b.closest("[data-viewer-ok]")) continue;
    const words = (b.getAttribute("aria-label") || b.textContent || b.value || "").trim();
    if (!WRITE_WORDS.test(words) || LOOKING_WORDS.test(words)) continue;
    b.dataset.viewOnly = "1";
    b.setAttribute("aria-disabled", "true");
    b.setAttribute("title", VIEW_ONLY_TIP);
    if ("disabled" in b) b.disabled = true;
    b.style.opacity = "0.5";
    b.style.cursor = "not-allowed";
  }
}

// Called once at boot. Does nothing for anyone but a viewer.
let observer = null;
export function installViewOnlyGate() {
  if (observer || typeof document === "undefined" || !isViewer()) return;
  document.documentElement.dataset.viewOnly = "1";
  gate(document.body);
  observer = new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) gate(n.parentElement || n); });
  observer.observe(document.body, { childList: true, subtree: true });
}
