// home/useHomeLater.js · SCREENS-1. HOME'S LATER HALF LOADS AFTER THE FIRST PAINT.
//
// Home's first look is what draws above the fold on a phone: the greeting, the
// day, Ask and the moves (HomeFirstLook.jsx), and the Today rail. It is
// Dashboard.jsx and ships with the app. Every other section of Home and of the
// Dashboards surface is a render function in this folder, gathered by
// HomeLater.js into one chunk that is fetched once the first look has painted.
// Until it arrives those sections draw nothing; once it has, Dashboard renders
// exactly the tree it rendered when it was one file. JSX-free, like lazyRetry.
import { useState, useEffect, createElement } from "react";
import { retryImport, UpdatedNotice } from "../../lib/lazyRetry";

let later = null;   // once loaded, every later visit to Home has it from the start

// A chunk that will not load twice says so once, where the work column goes,
// rather than one notice per section.
const NOTICE = new Proxy({}, { get: (_, k) => (k === "then" ? undefined : k === "cardsBlock" ? () => createElement(UpdatedNotice) : () => null) });

export function loadHomeLater() {
  return retryImport(() => import("./HomeLater")).then(m => (later = m.cardsBlock === UpdatedNotice ? NOTICE : m));
}

export function useHomeLater() {
  const [mod, setMod] = useState(later);
  useEffect(() => {
    if (mod) return;
    let live = true;
    // after the first paint: the frame that paints it, then the next task
    const raf = requestAnimationFrame(() => setTimeout(() => loadHomeLater().then(m => { if (live) setMod(m); }), 0));
    return () => { live = false; cancelAnimationFrame(raf); };
  }, [mod]);
  return mod;
}
