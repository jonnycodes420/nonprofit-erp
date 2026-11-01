// client/src/components/MailboxBanner.jsx · PERF-2. The reconnect banner and
// the one /mailbox read, out of InboxConnect.jsx so Home draws its rail without
// downloading the inbox's connect panels. InboxConnect.jsx imports both from
// here and still exports them. Moved verbatim.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";

const quiet = { background: "transparent", border: "none", fontSize: 12, color: T.ink3, cursor: "pointer",
  fontWeight: 600, padding: "6px 4px", fontFamily: "inherit", textDecoration: "underline" };

// The reconnect banner: shown wherever it is mounted (Home, and the top of the
// Connections card) when a connection has not read in two hours or its
// permission was refused.
export function MailboxBanner({ onNavigate }) {
  const [d] = useMailbox();
  if (!d || !d.banner) return null;
  const go = () => onNavigate && onNavigate("settings", { section: "connections", focus: "inbox" });
  return (
    <div data-testid="mailbox-banner" role="status" style={{ background: T.white, border: "1px solid " + T.gold, borderLeft: "4px solid " + T.gold, borderRadius: 10, padding: "10px 14px", fontSize: 14, color: T.ink, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span>{d.banner.replace(/\. Reconnect$/, ".")}</span>
      {onNavigate && <button type="button" onClick={go} style={{ ...quiet, color: T.greenDk, fontSize: 14, fontWeight: 700 }}>Reconnect</button>}
    </div>
  );
}

// One read of /mailbox, shared by every door.
export function useMailbox() {
  const [d, setD] = useState(null);
  const load = () => apiFetch("/mailbox").then(setD).catch(() => setD({ providers: [], team: [], failed: true }));
  useEffect(() => { load(); }, []);
  return [d, load];
}
