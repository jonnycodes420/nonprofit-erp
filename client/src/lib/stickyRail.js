// PROFILE-2 Part 1 · a rail that sticks without a scrollbar of its own.
// A rail shorter than the window sticks under the top bar. A taller one scrolls
// with the page until its last card is in view and sticks there, so it never
// needs a scroll box inside the page (which is what made the wheel stop over
// it). Returns the `top` for a position:sticky element.
import { useEffect, useState } from "react";

export function useStickyTop(ref, under = 52) {
  const [top, setTop] = useState(under);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return undefined;
    const fit = () => setTop(Math.min(under, window.innerHeight - el.offsetHeight));
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", fit);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", fit); };
  }, [ref, under]);
  return top;
}
