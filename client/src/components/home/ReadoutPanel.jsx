// home/ReadoutPanel.jsx · HOME-6. A READOUT ROW OPENS ITS READOUT.
//
// Home's Thread shows an import's readout as a row ("What your history shows"
// after the first import). It opened Recent changes, the undo list, which is
// not what it names. It opens this: that one readout, its lines counted from
// the org's own records, each opening the people behind it (WhatChanged, the
// same component Recent changes shows under "what your imports changed").
// One host on document.body, opened from anywhere, as Recent changes is.
//
// HOTFIX-RHYTHM: on a 6,400-person org, See who and then the count froze the
// tab. This host is its own React root with no router; the count's list drew
// router links, which threw, and the error took the whole root down. The host
// was gone, and openReadout waited for it by polling every 20 ms, for ever, a
// new poll per press. Now a person on the list opens through the app
// (FigureContext, and RecordLink without a router), an error in the panel
// says so in place, and a host that is gone is made again, never waited for.
import { Component, useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "../shared";
import { FigureContext } from "../Figure";
import { retryImport } from "../../lib/lazyRetry";

const WhatChanged = lazy(() => retryImport(() => import("../WhatChanged")).then(m => ({ default: m.WhatChanged })));

class InPlace extends Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { console.warn("[readout] the panel did not draw:", e && e.message); }
  render() {
    return this.state.failed
      ? <div data-testid="readout-failed" style={{ fontSize: 13.5, lineHeight: 1.5 }}>This list did not open. Close this and press See who again; nothing was changed.</div>
      : this.props.children;
  }
}

export function ReadoutPanel({ id, title, onClose }) {
  const go = (t, o) => { onClose(); window.dispatchEvent(new CustomEvent("steward:go", { detail: { tab: t, opts: o } })); };
  const openPerson = donorId => go("donors", { selectDonorId: donorId });
  return (
    <Modal onClose={onClose} title={title || "Readout"} subtitle="What this import told us, each line counted from your own records. Each one opens the people behind it."
      width={640} zIndex={450} ariaLabel="Readout">
      <div data-testid="readout-panel" data-readout={id}>
        <FigureContext.Provider value={{ openPerson, panelZ: 460 }}>
          <InPlace><Suspense fallback={null}><WhatChanged only={id} isReadOnly={false} wide={false} onNavigate={go} /></Suspense></InPlace>
        </FigureContext.Provider>
      </div>
    </Modal>
  );
}

let hostSet = null;
let hostEl = null;
function ReadoutHost() {
  const [open, setOpen] = useState(null);
  useEffect(() => { hostSet = setOpen; return () => { hostSet = null; }; }, []);
  return open ? <ReadoutPanel key={open.at} id={open.id} title={open.title} onClose={() => setOpen(null)} /> : null;
}
export function openReadout(id, title) {
  if (typeof document === "undefined") return;
  // A host that died (or was never made) is made again; it is never polled for.
  if (!hostEl || !hostEl.isConnected || (!hostSet && hostEl.dataset.ready === "1")) {
    if (hostEl) hostEl.remove();
    hostEl = document.createElement("div");
    hostEl.setAttribute("data-readout-host", "");
    document.body.appendChild(hostEl);
    createRoot(hostEl).render(<ReadoutHost />);
  }
  const el = hostEl;
  let tries = 0;
  const go = () => {
    if (hostSet) { el.dataset.ready = "1"; hostSet({ id, title, at: Date.now() }); return; }
    if (++tries < 50 && el === hostEl) setTimeout(go, 20);   // a first mount takes a frame or two; never for ever
  };
  go();
}
