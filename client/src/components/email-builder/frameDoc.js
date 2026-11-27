// email-builder/frameDoc.js · POLISH-15 item 2. THE EDITING FRAME ANSWERS IN EVERY BROWSER.
//
// The email is edited in an iframe whose page the server draws; the editor's
// own code (EmailFrame, frameDnD) wires it from outside: typing, selecting, the
// ⠿ grip, the "+" between blocks. The frame was sandboxed with
// "allow-same-origin" only, and WebKit (Safari) runs no event listener in a
// sandboxed page without "allow-scripts", not even the parent's: a click
// selected nothing, typing never reached the list (so Undo stayed disabled),
// the grip did not move and the "+" never showed (W-1127-Fundraising-02,
// W-1126-Fundraising-02). Chromium ran them, which is why every check passed.
//
// So the frame allows scripts, and its page forbids every script of its own:
// a Content-Security-Policy of script-src 'none' as the page's first element
// stops a <script>, an onclick="" and a javascript: link that a Code block
// might carry. The sandbox still stops the frame navigating the app, opening
// windows or sending forms.
export const FRAME_SANDBOX = "allow-same-origin allow-scripts";
const CSP = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;

// The page with the policy first in its <head> (after the doctype, so the page
// keeps its standards mode).
export function framedHtml(html) {
  const s = String(html || "");
  if (!s) return s;
  if (/<head[^>]*>/i.test(s)) return s.replace(/<head[^>]*>/i, m => m + CSP);
  const dt = s.match(/^\s*<!doctype[^>]*>/i);
  return dt ? dt[0] + CSP + s.slice(dt[0].length) : CSP + s;
}
