/* Steward Give — embed.js
 *
 * BUILD-102 (Steward Give) Part 4. ONE LINE ON THE ORG'S OWN WEBSITE:
 *
 *   <script src="https://www.stewardapp.dev/embed.js" data-form="gp_xxx"></script>
 *
 * It creates a SANDBOXED iframe where the script tag stands, points it at
 * Steward's own origin, and lets it size itself to its content.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
 * It does not read the host page. No cookies, no localStorage, no DOM outside the
 * element it inserts, no analytics, no fingerprint. An org pasting a script tag
 * from a vendor is taking that vendor's word about what it does on every page
 * view, and the only honest version of that promise is a script short enough to
 * read in one sitting. This is that script.
 *
 * ── AND THE FRAME NEVER LISTENS ───────────────────────────────────────────
 * Messages go ONE WAY: the frame posts its height out, and accepts nothing in.
 * "Refuses to be driven by a postMessage from a foreign origin" is therefore true
 * by construction rather than by a check somebody has to keep correct — there is
 * no listener inside the frame to drive. This script's own listener verifies both
 * the origin AND the source window before it believes a height.
 *
 * No card field ever exists on the host page: payment finishes on Stripe's own
 * page, opened from inside the frame.
 */
(function () {
  "use strict";

  // `document.currentScript` is the tag being executed, which is how the frame
  // lands exactly where the org pasted the line rather than at the end of body.
  var tag = document.currentScript;
  if (!tag) {
    // A bundler or a tag manager can strip currentScript. Fall back to the last
    // matching script on the page, which is this one while it is still running.
    var all = document.querySelectorAll("script[data-form]");
    tag = all.length ? all[all.length - 1] : null;
  }
  if (!tag) return;

  var formId = tag.getAttribute("data-form");
  if (!formId || !/^[A-Za-z0-9_-]{1,64}$/.test(formId)) {
    // A malformed id renders nothing at all rather than a broken box on somebody
    // else's page. It is a paste error and the Settings screen is where it is fixed.
    return;
  }

  // Our own origin, taken from this script's src — never hardcoded, so a preview
  // deployment and production both work without an edit.
  var origin;
  try { origin = new URL(tag.src, window.location.href).origin; } catch (e) { return; }

  var frame = document.createElement("iframe");
  frame.src = origin + "/embed/" + encodeURIComponent(formId);
  frame.title = "Donation form";
  frame.loading = "lazy";
  frame.setAttribute("scrolling", "no");
  // THE SANDBOX. `allow-scripts` and `allow-same-origin` are what the form needs
  // to run and talk to Steward's own API; `allow-top-navigation-by-user-activation`
  // is what lets a donor's own click reach Stripe's page. `allow-forms` covers the
  // fallback where a browser treats the submit as a form post. Nothing else is
  // granted — notably not allow-popups or allow-modals.
  frame.setAttribute("sandbox",
    "allow-scripts allow-same-origin allow-forms allow-top-navigation-by-user-activation");
  frame.setAttribute("allow", "payment");
  frame.style.width = "100%";
  frame.style.border = "0";
  frame.style.display = "block";
  // A height before the first measurement arrives, so the host page does not jump.
  frame.style.height = "720px";
  frame.setAttribute("data-steward-form", formId);

  tag.parentNode.insertBefore(frame, tag);

  // THE ONE MESSAGE, AND BOTH CHECKS ON IT. Origin must be ours and the source
  // must be THIS frame's own window — either alone is not enough, because a page
  // can host two Steward forms and another frame on the page could be anybody's.
  function onMessage(e) {
    if (e.origin !== origin) return;
    if (e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || d.steward !== "give-height" || d.formId !== formId) return;
    var h = Number(d.height);
    // A bounded height: a hostile or buggy value must not be able to make a
    // 200,000-pixel element on somebody's homepage.
    if (!isFinite(h) || h < 120 || h > 4000) return;
    frame.style.height = Math.ceil(h) + "px";
  }
  window.addEventListener("message", onMessage, false);
})();
