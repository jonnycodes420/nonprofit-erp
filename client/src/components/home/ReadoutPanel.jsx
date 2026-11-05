// home/ReadoutPanel.jsx · HOME-6. A READOUT ROW OPENS ITS READOUT.
//
// Home's Thread shows an import's readout as a row ("What your history shows"
// after the first import). It opened Recent changes, the undo list, which is
// not what it names. It opens this: that one readout, its lines counted from
// the org's own records, each opening the people behind it (WhatChanged, the
// same component Recent changes shows under "what your imports changed").
// One host on document.body, opened from anywhere, as Recent changes is.
import { useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "../shared";
import { retryImport } from "../../lib/lazyRetry";

const WhatChanged = lazy(() => retryImport(() => import("../WhatChanged")).then(m => ({ default: m.WhatChanged })));

export function ReadoutPanel({ id, title, onClose }) {
  const go = (t, o) => { onClose(); window.dispatchEvent(new CustomEvent("steward:go", { detail: { tab: t, opts: o } })); };
  return (
    <Modal onClose={onClose} title={title || "Readout"} subtitle="What this import told us, each line counted from your own records. Each one opens the people behind it."
      width={640} zIndex={450} ariaLabel="Readout">
      <div data-testid="readout-panel" data-readout={id}>
        <Suspense fallback={null}><WhatChanged only={id} isReadOnly={false} wide={false} onNavigate={go} /></Suspense>
      </div>
    </Modal>
  );
}

let hostSet = null;
function ReadoutHost() {
  const [open, setOpen] = useState(null);
  useEffect(() => { hostSet = setOpen; return () => { hostSet = null; }; }, []);
  return open ? <ReadoutPanel key={open.at} id={open.id} title={open.title} onClose={() => setOpen(null)} /> : null;
}
let mounted = false;
export function openReadout(id, title) {
  if (typeof document === "undefined") return;
  if (!mounted) {
    mounted = true;
    const el = document.createElement("div");
    el.setAttribute("data-readout-host", "");
    document.body.appendChild(el);
    createRoot(el).render(<ReadoutHost />);
  }
  const go = () => (hostSet ? hostSet({ id, title, at: Date.now() }) : setTimeout(go, 20));
  go();
}
