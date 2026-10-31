// HOME-4 · SET UP STEWARD, WHERE A NEW ORG CAN SEE IT. The checklist (BUILD-35)
// moved here from Dashboard.jsx, with the two places Home now draws it:
//
//   · new (fewer than three steps done, or no donors yet): SetupFirstCard, a
//     real card under Ask, above Your moves, every step with done or not and
//     the next one as a button
//   · in progress (or "I'll finish later"): SetupRailCard, at the top of the
//     right rail, "Set up Steward · 4 of 8 · Next: …" with a bar
//   · done or dismissed: nothing on Home (Settings keeps every step)
import { useState } from "react";
import { apiFetch } from "../api";
import { T, interactive } from "./shared";

// ── BUILD-35: "Set up Steward" activation checklist ──────────────────────────
// Each row's done-state comes computed live from GET /org/setup-status — never
// stored per-step — so an item checks itself off however the underlying thing
// became true (wizard, Settings, a teammate). The server owns the computation;
// this map owns the words and the EXACT deep link per item (a specific screen,
// never a tab root). The `team` key only arrives on Team tier (plan-graceful:
// hidden on Core, not shown-and-locked).
export const SETUP_ITEM_META = {
  donors:     { label: "Import your donors",             why: "bring in the people who already believe in you, and Steward starts noticing who has gone quiet",                                cta: "Import",  nav: ["donors", { openImport: true }] },
  // BUILD-95 §4 — the label names the JOB, not our vendor. The why-line names
  // BOTH halves, because genericising the label while Stripe is the only
  // thing that works would be worse than the vendor's name: somebody picks
  // Square, presses it, and hits a wall.
  onlineGiving: { label: "Set up online giving",         why: "connect a card processor for your Steward giving pages, and connect the places you already take gifts so Steward sees them", cta: "Set up",  nav: ["settings", { section: "connections", focus: "giving" }] },
  address:    { label: "Add your mailing address",       why: "goes in every email footer (CAN-SPAM) and clears the reminder banner",         cta: "Add",     nav: ["settings", { section: "receipts" }] },
  givingPage: { label: "Publish a giving page",          why: "a shareable page your donors can give through today",                          cta: "Publish", nav: ["settings", { section: "giving" }] },
  // BUILD-81 — the automation item is gone (it ticked on a fresh org that had
  // done nothing). Logging a conversation is the real first act: it opens a
  // thread, and the next step comes back to you.
  conversation: { label: "Log your first conversation",  why: "log one call from a donor's record and the next step comes back to you",      cta: "Log",     nav: ["donors", undefined] },
  // INT-BUILD-1 Part 0 — the viewer's OWN inbox, so it ticks per person.
  inbox:      { label: "Connect your inbox",             why: "Gmail or Outlook; your conversations with people on file log themselves",     cta: "Connect", nav: ["settings", { section: "connections", focus: "inbox" }] },
  team:       { label: "Invite your team",               why: "add your fundraisers so everyone sees their own donors",                       cta: "Invite",  nav: ["settings", { section: "team" }] },
  // BUILD-83 Part 5.3 — the closer.
  sustainers: { label: "Move your monthly givers",        why: "your file's sustainers are here; the ones who stopped need a reconnect link", cta: "Open",    nav: ["fundraising", { frSection: "recurring" }] },
};

export function SetupChecklist({ status, onNavigate, isAdmin, onSetCardState, bare = false }) {
  const { items, doneCount, totalCount, cardState } = status;

  if (cardState === "collapsed") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button onClick={() => onSetCardState(null)}
          aria-label={`Finish setting up Steward: ${doneCount} of ${totalCount} done`}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, background: T.white, border: "1px solid " + T.bg3, borderRadius: 99, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, color: T.ink2, cursor: "pointer" }}>
          <span aria-hidden style={{ color: T.gold500 }}>◈</span>
          Finish setup · {doneCount}/{totalCount}
        </button>
        {isAdmin && (
          <button onClick={() => onSetCardState("hidden")} aria-label="Don't show the setup checklist again"
            title="Don't show this again"
            style={{ background: "none", border: "none", color: T.ink3, fontSize: 15, cursor: "pointer", padding: 4, lineHeight: 1 }}>×</button>
        )}
      </div>
    );
  }

  // HOME-4: the two Home cards draw their own heading and bar, then the steps (bare).
  const head = bare ? null : (<>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, color: T.ink3 }}>Set up Steward</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.ink2 }}>{doneCount} of {totalCount}</div>
        <div style={{ flex: 1 }} />
        {isAdmin && (
          <button onClick={() => onSetCardState("collapsed")}
            style={{ background: "none", border: "none", color: T.ink3, fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 2 }}>
            I'll finish later
          </button>
        )}
      </div>
      {/* solid gold fill — bar LENGTH carries the meaning (no gradients) */}
      <div aria-hidden style={{ height: 4, borderRadius: 2, background: T.bg3, overflow: "hidden", marginBottom: 10 }}>
        <div style={{ height: "100%", width: `${totalCount ? Math.round((doneCount / totalCount) * 100) : 0}%`, background: T.gold500, borderRadius: 2 }} />
      </div>
  </>);
  return (
    <div data-testid="setup-steps" style={bare ? {} : { background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px" }}>
      {head}
      {items.map(item => {
        const meta = SETUP_ITEM_META[item.key];
        const detailLine = item.key === "sustainers" && item.detail
          ? `${item.detail.total} in your file · ${item.detail.stopped} stopped`
          : null;
        if (!meta) return null;
        if (item.done) {
          return (
            <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderTop: "1px solid " + T.bg2 }}>
              <span aria-hidden style={{ width: 20, height: 20, borderRadius: "50%", background: T.green600, color: T.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>✓</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.ink3 }}>{meta.label}</span>
            </div>
          );
        }
        // BUILD-79 Part 6 — donors on file with $0 of giving is NOT a done
        // import: say so, offer the re-import path, and let an admin confirm
        // the file genuinely had no gifts.
        const giftGap = item.key === "donors" && item.needsGiftConfirm;
        return (
          <div key={item.key}>
            <div {...interactive(() => onNavigate(meta.nav[0], meta.nav[1]), { label: `${meta.label}: ${meta.why}` })}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderTop: "1px solid " + T.bg2, borderRadius: 8 }}>
              <span aria-hidden style={{ width: 20, height: 20, borderRadius: "50%", border: "1.5px solid " + T.bg3, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{meta.label}</span>
                <span style={{ display: "block", fontSize: 11.5, color: T.ink3, lineHeight: 1.45 }}>
                  {giftGap ? `${(item.count||0).toLocaleString()} donors are on file with $0 of giving: an import that dropped every dollar isn't done. Re-import with the gift columns mapped.` : (detailLine ? `${detailLine}. ${meta.why}` : meta.why)}
                </span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.green600, whiteSpace: "nowrap" }}>{giftGap ? "Re-import" : meta.cta} →</span>
            </div>
            {giftGap && isAdmin && (
              <button onClick={() => { apiFetch("/org/setup-confirm-no-gifts", { method: "POST", body: "{}" }).then(() => window.location.reload()).catch(() => {}); }}
                style={{ background: "transparent", border: "none", padding: "0 0 6px 30px", color: T.ink3, fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>
                My file genuinely had no gifts, mark this done
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}


// Where the checklist goes on Home, from GET /org/setup-status: "first",
// "rail" or null (done, or dismissed with the ×).
export function setupStage(status) {
  if (!status || status.complete || status.cardState === "hidden") return null;
  const donors = (status.items || []).find(i => i.key === "donors");
  const isNew = status.doneCount < 3 || (donors && !donors.done && !(donors.count > 0));
  return isNew && status.cardState !== "collapsed" ? "first" : "rail";
}
const nextStep = status => (status.items || []).find(i => !i.done && SETUP_ITEM_META[i.key]);
const nextLabel = item => {
  const meta = SETUP_ITEM_META[item.key];
  return meta.label.charAt(0).toLowerCase() + meta.label.slice(1);
};
const bar = (done, total) => (
  <div aria-hidden style={{ height: 4, borderRadius: 2, background: T.bg3, overflow: "hidden" }}>
    <div style={{ height: "100%", width: `${total ? Math.round((done / total) * 100) : 0}%`, background: T.gold500, borderRadius: 2 }} />
  </div>
);
const go = (onNavigate, item) => { const m = SETUP_ITEM_META[item.key]; onNavigate && onNavigate(m.nav[0], m.nav[1]); };

// The new org's card: every step, and the next one as the button.
export function SetupFirstCard({ status, onNavigate, isAdmin, onSetCardState }) {
  const next = nextStep(status);
  return (
    <section data-testid="home-setup-first" aria-label="Set up Steward"
      style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 24, fontWeight: 400, color: T.ink }}>Set up Steward</h2>
        <span style={{ fontSize: 13, color: T.ink3 }}>{status.doneCount} of {status.totalCount} done</span>
        <span style={{ flex: 1 }} />
        {isAdmin && <button type="button" data-testid="setup-later" onClick={() => onSetCardState("collapsed")}
          style={{ background: "none", border: "none", color: T.ink3, fontSize: 12.5, fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 2, fontFamily: "inherit" }}>
          I'll finish later</button>}
      </div>
      {bar(status.doneCount, status.totalCount)}
      {next && <button type="button" data-testid="setup-next" onClick={() => go(onNavigate, next)}
        style={{ alignSelf: "flex-start", background: T.greenDk, color: T.white, border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        Next: {nextLabel(next)}</button>}
      <SetupChecklist status={{ ...status, cardState: null }} onNavigate={onNavigate} isAdmin={false} onSetCardState={onSetCardState} bare />
    </section>
  );
}

// The rail's card: the count, the next step, a bar, and every step in place.
export function SetupRailCard({ status, onNavigate, isAdmin, onSetCardState }) {
  const [open, setOpen] = useState(false);
  const next = nextStep(status);
  return (
    <div data-testid="home-setup-rail" style={{ border: "1px solid " + T.bg3, borderRadius: 14, padding: "12px 14px", background: T.white, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: T.ink, lineHeight: 1.45 }}>
          <b>Set up Steward</b> · {status.doneCount} of {status.totalCount}
          {next && <> · Next: <button type="button" data-testid="setup-rail-next" onClick={() => go(onNavigate, next)}
            style={{ background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13.5, color: T.greenDk, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
            {SETUP_ITEM_META[next.key].label}</button></>}
        </span>
        {isAdmin && <button type="button" onClick={() => onSetCardState("hidden")} aria-label="Don't show the setup checklist on Home again" title="Don't show this on Home again"
          style={{ background: "none", border: "none", color: T.ink3, fontSize: 15, cursor: "pointer", padding: 2, lineHeight: 1 }}>×</button>}
      </div>
      {bar(status.doneCount, status.totalCount)}
      <button type="button" data-testid="setup-rail-all" aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 12.5, color: T.greenDk, fontWeight: 700, cursor: "pointer" }}>
        {open ? "Hide the steps" : "Show all steps"}</button>
      {open && <SetupChecklist status={{ ...status, cardState: null }} onNavigate={onNavigate} isAdmin={false} onSetCardState={onSetCardState} bare />}
    </div>
  );
}
