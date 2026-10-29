// lib/lazyRetry.js · FIX-56. A TAB'S CODE THAT WILL NOT LOAD SAYS SO.
//
// HARDEN-2 made every tab but Home its own chunk. A tab left open across a
// deploy still names the old chunk files, which the new deploy no longer
// serves, so opening a tab or a panel asked for a file that is gone. This asks
// once more (a network blip is the other way it fails), and if the second ask
// fails too, the screen says "Steward was updated" with a Reload button,
// instead of drawing nothing. JSX-free, so it can sit under any lazy().
import { createElement } from "react";

const wait = ms => new Promise(r => setTimeout(r, ms));

export function UpdatedNotice() {
  return createElement("div", { role: "alert", "data-testid": "steward-updated",
    style: { background: "#FFFFFF", border: "1px solid #C9A84C", borderRadius: 12, padding: "16px 18px", margin: "12px 0", color: "#0F1A12", fontSize: 14, lineHeight: 1.5 } },
    createElement("strong", null, "Steward was updated. "),
    "Reload to open this with the new version. Nothing you saved is lost.",
    createElement("div", { style: { marginTop: 10 } },
      createElement("button", { type: "button", onClick: () => window.location.reload(),
        style: { background: "#0D5C3A", color: "#FFFFFF", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" } }, "Reload")));
}

// load: () => import("./X"). Resolves to the module, or to a module whose
// default (and every named export asked for) is the notice above.
export function retryImport(load, { delayMs = 600 } = {}) {
  return load().catch(() => wait(delayMs).then(load)).catch(err => {
    if (typeof console !== "undefined") console.warn("[lazy] a chunk did not load twice; showing the reload notice", err && err.message);
    return new Proxy({}, { get: (_, k) => (k === "then" ? undefined : UpdatedNotice) });
  });
}
