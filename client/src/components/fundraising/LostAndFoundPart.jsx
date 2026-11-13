// client/src/components/fundraising/LostAndFoundPart.jsx · FLOWS-2 item 1.
// Fundraising → Overview → Lost & Found: Donors → Re-engage's own list
// (ReEngageView, the same people lapse.js lostSql names for the report "Lost:
// over 24 months"), opened on its "over 24 months" window. One list, drawn by
// one component, read from the one whole-org read Re-engage uses.
import { useEffect, useState } from "react";
import { allPeople } from "../../lib/people";
import { isAbort } from "../../lib/leaving";
import { ReEngageView } from "../DonorDirectory";
import { Spin, T } from "../shared";

export function LostAndFoundPart({ org, onNavigate }) {
  const [people, setPeople] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    const ctl = new AbortController();   // COMMS-SPEED-1: the read stops when this part closes
    allPeople({ force: true, signal: ctl.signal }).then(rows => { if (live) setPeople(rows || []); })
      .catch(e => { if (live && !isAbort(e)) setErr("The list didn't load. Try again in a moment."); });
    return () => { live = false; ctl.abort(); };
  }, []);
  if (err) return <div role="alert" style={{ fontSize: 13, color: T.ink2 }}>{err}</div>;
  if (!people) return <div style={{ padding: 32, textAlign: "center" }}><Spin /></div>;
  const open = d => onNavigate && onNavigate("donors", { selectDonorId: d.id });
  return (
    <div data-testid="fr-lostfound">
      <ReEngageView donors={people} org={org} initialWin="lost" onSelectDonor={open}
        onLogTouchpoint={d => onNavigate && onNavigate("donors", { logDonorId: d.id })} />
    </div>
  );
}

export default LostAndFoundPart;
