// components/profile/columns.js (PROFILE-3) · THE PROFILE'S COLUMNS SCROLL ON THEIR OWN.
//
// Jonathan, 1 Nov: "The right rail needs to scroll on its own and the big left
// window on its own." Like HubSpot's record page: the profile fills the screen
// under the top bar, the page itself never scrolls, and the main column and the
// rail are each a scroll box (wheel, trackpad, touch, and Space / Page Down /
// arrows when focused). The header band and tabs stay pinned at the top of the
// main column. At 768 and under it is one column that scrolls as a page
// (PROFILE-2's phone order). Every other page still scrolls as one page
// (docs/decisions/people-and-records.md, "The profile's columns").
//
// The frame's height is the window under the frame's own top, measured, so a
// banner above it (support access, billing) never pushes the last item off.
import { useLayoutEffect } from "react";

export function useFrameHeight(ref, on) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!on) { el.style.removeProperty("--dp-h"); return undefined; }
    const set = () => {
      const top = el.getBoundingClientRect().top + (window.scrollY || 0);
      el.style.setProperty("--dp-h", Math.max(360, Math.round(window.innerHeight - top)) + "px");
    };
    set();
    window.addEventListener("resize", set);
    // a banner that appears or goes away above the profile moves its top
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
    const shell = el.closest(".app-main") || document.body;
    if (ro) for (const c of shell.children) if (!c.contains(el)) ro.observe(c);
    const t = setTimeout(set, 600);
    return () => { window.removeEventListener("resize", set); if (ro) ro.disconnect(); clearTimeout(t); };
  }, [ref, on]);
}
