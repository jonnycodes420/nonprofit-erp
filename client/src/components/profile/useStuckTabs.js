// components/profile/useStuckTabs.js (PROFILE-4) · THE TABS STICK, WITH THE NAME.
//
// The middle column (dp-main-column) is the one scroller for the header, the
// numbers, the tabs and the tab's content (PROFILE-3's columns, shared.jsx).
// Only the tab row is position:sticky. This hook says when it is stuck (the
// header has scrolled out of view), so the row can show the small face and
// the name at its left and a light shadow; scrolling back up returns it.
//
// Switching tabs while stuck keeps the tab row where it is and puts the new
// tab's top just under it: the column scrolls to the row's natural place (the
// sentinel just above it). The tab panes have a minimum height of the column
// less the row (shared.jsx, .dp4-panes), so a short tab can still be scrolled
// that far and the row does not drop back down.
//
// On a phone the window scrolls and the row is not sticky, so nothing here runs.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const mainOf = el => el && el.closest("[data-testid=dp-main-column]");

export function useStuckTabs({ isPhone, dpTab }) {
  const sentinelRef = useRef(null);
  const [stuck, setStuck] = useState(false);
  const stuckRef = useRef(false);

  useEffect(() => {
    if (isPhone) { setStuck(false); stuckRef.current = false; return undefined; }
    const s = sentinelRef.current, main = mainOf(s);
    if (!s || !main) return undefined;
    const check = () => {
      const on = main.scrollTop > 0 && s.getBoundingClientRect().top <= main.getBoundingClientRect().top + 1;
      if (on !== stuckRef.current) { stuckRef.current = on; setStuck(on); }
    };
    check();
    main.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => { main.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, [isPhone]);

  // A new tab while stuck: its top goes just under the row.
  const lastTab = useRef(dpTab);
  useLayoutEffect(() => {
    if (lastTab.current === dpTab) return;
    lastTab.current = dpTab;
    if (isPhone || !stuckRef.current) return;
    const s = sentinelRef.current, main = mainOf(s);
    if (!s || !main) return;
    main.scrollTop = Math.ceil(main.scrollTop + (s.getBoundingClientRect().top - main.getBoundingClientRect().top));
  }, [dpTab, isPhone]);

  return { sentinelRef, stuck };
}
