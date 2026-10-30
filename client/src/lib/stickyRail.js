// PROFILE-2 Part 1 · a rail that sticks without a scrollbar of its own.
// The rail is plain CSS position:sticky under the top bar; nothing is measured
// while the page loads. After the first paint the rail is measured once, and
// only a rail taller than the window gets a different top: it scrolls with the
// page until its last card is in view and sticks there, so it never needs a
// scroll box inside the page (which is what made the wheel stop over it).
// Returns the `top` for a position:sticky element.
import { useEffect, useState } from "react";

export function useStickyTop(ref, under = 52) {
  const [top, setTop] = useState(under);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let ro = null, f1 = 0, f2 = 0;
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      const tall = el.offsetHeight > window.innerHeight - under;
      const next = tall ? window.innerHeight - el.offsetHeight : under;
      setTop(t => (t === next ? t : next));
    };
    // two frames: the first paint has happened before anything is measured
    f1 = requestAnimationFrame(() => {
      f2 = requestAnimationFrame(() => {
        fit();
        if (typeof ResizeObserver !== "undefined" && ref.current) { ro = new ResizeObserver(fit); ro.observe(ref.current); }
        window.addEventListener("resize", fit);
      });
    });
    return () => { cancelAnimationFrame(f1); cancelAnimationFrame(f2); if (ro) ro.disconnect(); window.removeEventListener("resize", fit); };
  }, [ref, under]);
  return top;
}

// PROFILE-2 Part 3 · true at phone width (the app's 768px breakpoint), so a
// page can put the same node in a different place rather than draw it twice.
export function useIsPhone(max = 768) {
  const q = `(max-width:${max}px)`;
  const [on, setOn] = useState(() => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(q).matches);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(q);
    const fn = () => setOn(mq.matches);
    fn();
    if (mq.addEventListener) mq.addEventListener("change", fn); else mq.addListener(fn);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", fn); else mq.removeListener(fn); };
  }, [q]);
  return on;
}
