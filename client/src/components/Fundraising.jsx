import { Figure } from "./Figure";
import { useState, useEffect } from "react";
import { apiFetch, API } from "../api";
import { T, activeMark, fmt, fmtFull, fmtTotal, PageTitle, SectionTabs, EmptyState, GoldMoment, StartHere, interactive, Modal } from "./shared";
import { DepositSheetModal } from "./DepositSheet";
import { RecurringView } from "./RecurringGiving";
import { MembersView } from "./Memberships";
import { EventsDesk } from "./EventsDesk";
import { ProposalsView, PortfolioView, PlansView, MajorGiftsDashboard } from "./MajorGifts";
import { QrCodeBlock, EmbedCodeBlock } from "./ShareBlocks";
import Uploader, { IMAGE_ACCEPT, IMAGE_ACCEPT_LABEL, IMAGE_MAX_BYTES } from "./Uploader";
import { textToStory, storyToText } from "../lib/storyBlocks";
import { resolveAssetUrl } from "../lib/assetUrl";
import { PortalBannerCrop, PORTAL_CAMPAIGN_HERO_RATIO } from "./PortalBanner";
import { errorMessage } from "../lib/domainError";
import { Pipeline } from "./Pipeline";
import { FR_SECTIONS, resolveFr } from "../lib/fundraisingSections";
import { PeerToPeerView } from "./PeerToPeer";
import { AuctionsView } from "./Auctions";
import { StartedNotFinished } from "./StartedNotFinished";
import { CaptureInbox, CAPTURE_CHANGED } from "./CaptureInbox";
import { HowDidItDo } from "./HowDidItDo";
import { displayDate } from "../../../shared/displayDate";
import { DonorLink, RecordLink, useUrlWriter } from "./RecordLink";
import { useLocation } from "react-router-dom";
import { CampaignsView, CategoryBadge, CATEGORY_META, PACE_META, daysLeftText, campaignHref } from "./CampaignsList";
import { tabHref, urlParam, giftHref, editPageHref } from "../lib/appUrls";
import RemoveMenu from "./RemoveMenu";
import { ThankYouDrafts } from "./ThankYouDrafts";   // CHECK-2
import { EventStory } from "./EventRaised";   // FUNDRAISING-2
import { PledgesView } from "./Pledges";   // FUNDRAISING-2
import { countLabel } from "../../../shared/countWords.js";

// FIX-14 Part 5: a campaign is /app/fundraising?fr=campaigns&campaign=<id>:
// the Campaigns part, scrolled to that campaign's card and marked.
// A fund's page is its card in Finance → Funds, opened on its rows.
const fundHref = id => tabHref("finance", { subtab: "funds", fundId: id });

// ── Fundraising (BUILD-11) ──────────────────────────────────────────────────
// The money-moving home. Everything here reads live figures from the backend
// (/fundraising/*) — raised totals are always SUM(gifts), never a stored
// counter, so a thermometer can't drift from reality. Five-color palette:
// gold = on-track/primary, terracotta = behind, greens = neutral/positive.

// The Team plan's padlock, the one the sidebar used for the Pipeline.

// Horizontal thermometer. Gold fill; the fill goes celebratory (deeper gold)
// at 100%. No goal → caller renders totals instead of this.
function Thermometer({ raised, goal, percent, rawPercent, over, paceState, paceSentence, big, raisedSource, raisedLabel }) {
  const pct = percent == null ? 0 : percent;         // bar width — capped at 100
  const shown = rawPercent == null ? pct : rawPercent; // number — true, uncapped
  const met = pct >= 100;
  // An exceeded goal celebrates the overage rather than repeating "Goal reached".
  const paceLabel = paceState === "met" && over > 0 ? `Goal reached · ${fmtTotal(over)} over` : PACE_META[paceState]?.label;
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: big ? 8 : 6, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          {/* REPORTS-4: the raised figure opens the gifts behind it when the
              caller names its source. */}
          <span style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: big ? 30 : 20, color: T.ink, lineHeight: 1 }}>{raisedSource
            ? <Figure variant="inline" kind="money" whole value={raised} label={raisedLabel || "Raised"} source={raisedSource} />
            : fmtTotal(raised)}</span>
          <span style={{ fontSize: big ? 14 : 12, color: T.ink3 }}>of {fmtTotal(goal)}</span>
        </div>
        <span style={{ fontSize: big ? 15 : 13, fontWeight: 800, color: met ? T.gold : T.ink2 }}>{shown}%</span>
      </div>
      <div style={{ height: big ? 14 : 9, background: T.bg3, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, height: "100%", borderRadius: 99, transition: "width 0.5s cubic-bezier(.22,1,.36,1)", background: met ? T.gold500 : T.gold600 }} />
      </div>
      {paceState && PACE_META[paceState] && (
        <div data-testid="pace-badge" style={{ marginTop: big ? 10 : 8, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: PACE_META[paceState].color, background: PACE_META[paceState].bg, borderRadius: 99, padding: "3px 11px" }}>
          {paceState === "met" ? "✦" : paceState === "behind" ? "↘" : "↗"} {paceLabel}
          {paceSentence && paceState !== "met" && <span style={{ fontWeight: 400, color: T.ink3 }}>· {paceSentence}</span>}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, accent, onClick, ariaLabel }) {
  return (
    <div {...interactive(onClick, { label: ariaLabel || label })}
      style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", borderLeft: `3px solid ${accent || T.bg3}`, boxShadow: T.shadow, display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: T.ink3 }}>{label}</span>
      <span style={{ fontSize: 26, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif", lineHeight: 1.05, letterSpacing: "-0.02em" }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: T.ink3, lineHeight: 1.4 }}>{sub}</span>}
    </div>
  );
}



export function Fundraising({ data, isReadOnly, isAdmin = false, onNavigate, initialSection, initialScope }) {
  // BUILD-57 — deep-linkable (Home's Recurring tab lands on the recurring
  // section via navigateTo("fundraising",{frSection:"recurring"})); consumed
  // on mount only, navNonce remounts like the other intent tabs.
  // FIX-1 §B — the id may be any OLD sub-tab id, the sidebar's `pipeline`, or
  // one of the four section ids; resolveFr() turns it into the section and the
  // part inside it (lib/fundraisingSections.js holds the one map).
  const start = resolveFr(initialSection);
  const [section, setSection] = useState(start.section);
  // The part each section last had open, so switching tabs and back returns
  // you to where you were rather than to the top of the section.
  const [partOf, setPartOf] = useState({ [start.section]: start.part });
  const [overview, setOverview] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // {mode:'new'|'edit', campaign}
  // FIX-7 Part 4 — a campaign created WITH peer-to-peer lands on its own
  // Peer-to-peer tab, on its own page, with Add a team and the public link
  // already there. Nobody has to go looking for the switch they just set.
  const [p2pOpenPageId, setP2pOpenPageId] = useState("");
  // FIX-27 Part 1: the campaign on screen is the one the address names, so a
  // campaign link renders its page and Back returns to the list.
  const loc = useLocation();
  const openCampaignId = /^\/app\/fundraising\/?$/.test(loc.pathname) ? new URLSearchParams(loc.search).get("campaign") : null;
  const goUrl = useUrlWriter();
  const orgSlug = data?.org?.org_slug || "";

  const load = () => {
    setLoading(true);
    Promise.all([
      apiFetch("/fundraising/overview"),
      apiFetch("/fundraising/campaigns"),
      apiFetch("/giving-pages").catch(() => []),
    ]).then(([o, c, p]) => {
      setOverview(o); setCampaigns(c); setPages(p || []); setLoading(false);
    }).catch(e => { console.error(e); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  // Any id, old or new, opens its section on its part.
  const goto = id => { const r = resolveFr(id); setSection(r.section); setPartOf(m => ({ ...m, [r.section]: r.part })); };
  const sec = FR_SECTIONS.find(s => s.id === section) || FR_SECTIONS[0];
  const subtab = partOf[sec.id] || sec.parts[0].id;   // the old view that is open
  const setSubtab = goto;
  const openCampaign = id => { goUrl(campaignHref(id)); goto("campaigns"); };
  const closeCampaign = () => goUrl(tabHref("fundraising", { frSection: "campaigns" }));

  // FIX-14 Part 5: the part on screen is in the address bar. A switch
  // replaces the entry (it is not a step Back should undo); a record opened
  // inside the part pushes its own URL, which this leaves alone.
  useEffect(() => {
    if (!/^\/app\/fundraising\/?$/.test(window.location.pathname)) return;
    const fr = new URLSearchParams(window.location.search).get("fr");
    if (fr === subtab || (!fr && subtab === "overview")) return;
    goUrl(tabHref("fundraising", { frSection: subtab }), true);
  }, [subtab]);   // eslint-disable-line react-hooks/exhaustive-deps

  // CAPTURE-1: how many cards wait in To confirm, refreshed whenever a card
  // is confirmed, skipped or read (the inbox announces CAPTURE_CHANGED).
  const [toConfirm, setToConfirm] = useState(0);
  useEffect(() => {
    const read = () => apiFetch("/capture/count").then(r => setToConfirm(Number(r && r.waiting) || 0)).catch(() => {});
    read();
    window.addEventListener(CAPTURE_CHANGED, read);
    return () => window.removeEventListener(CAPTURE_CHANGED, read);
  }, []);

  // Counts on a part (never money — the figures live on the parts themselves).
  const PART_BADGE = {
    campaigns: campaigns.length || undefined,
    pages: (overview?.givingPages?.takesGifts !== false && pages.filter(p => p.status === "active").length) || undefined,
    toconfirm: toConfirm || undefined,
  };


  const roTip = isReadOnly ? "Reactivate your subscription to make changes." : undefined;
  const primaryBtn = (label, onClick, disabled) => (
    <button onClick={onClick} disabled={disabled || isReadOnly} title={roTip}
      style={{ background: T.gold, border: "none", borderRadius: 10, padding: "10px 18px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: (disabled || isReadOnly) ? "not-allowed" : "pointer", opacity: (disabled || isReadOnly) ? 0.5 : 1, whiteSpace: "nowrap" }}>{label}</button>
  );

  return (
    <div className="fade-in">
      <PageTitle main="Your" accent="fundraising." />
      {/* FIX-1 §B — four tabs, each a question. The strip FITS at 1440 and
          at 390 (.fr-tabbar tightens it on a phone); nothing scrolls sideways. */}
      <SectionTabs tabs={FR_SECTIONS.map(s => ({ id: s.id, label: s.label }))} active={sec.id}
        onSelect={id => setSection(id)} className="finance-tabbar fr-tabbar" dataKey="fr-section"
        stripProps={{ "data-fr-strip": "", "aria-label": "Fundraising" }} style={{ marginBottom: sec.parts.length > 1 ? 12 : 18 }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", margin: sec.parts.length > 1 ? "0 0 10px" : "-8px 0 16px" }}>
        <div style={{ fontSize: 13, color: T.ink3 }}>{sec.question}</div>
        {/* THREAD-2b 3 — the builder LIVES in Settings, because a journey is a
            rule the organisation keeps rather than a thing you do to one
            donor. But Fundraising is where somebody is when they think about
            it, so it is reachable from here. */}
        <button data-testid="fr-journeys-link" onClick={() => onNavigate && onNavigate("settings", { section: "journeys" })}
          style={{ marginLeft: "auto", background: "none", border: "1px solid " + T.bg3, borderRadius: 9,
                   padding: "6px 13px", color: T.ink2, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          Journeys →
        </button>
      </div>
      {sec.parts.length > 1 && (
        <div data-fr-parts="" role="navigation" aria-label={sec.label}
          style={{ display: "flex", flexWrap: "wrap", gap: 2, marginBottom: 18, borderBottom: "1px solid " + T.bg2, width: "fit-content", maxWidth: "100%" }}>
          {sec.parts.map(p => {
            const on = subtab === p.id;
            return (
              <button key={p.id} data-fr-part={p.id} aria-current={on ? "true" : undefined}
                onClick={() => setPartOf(m => ({ ...m, [sec.id]: p.id }))}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: T.ink3, border: "none", borderRadius: "6px 6px 0 0", padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", ...activeMark(on, "bottom") }}>
                {p.label}
                {PART_BADGE[p.id] != null && (p.id === "toconfirm"
                  ? <span data-testid="toconfirm-badge" style={{ fontSize: 10.5, fontWeight: 800, background: T.gold, color: T.ink, borderRadius: 99, padding: "1px 7px", lineHeight: "15px" }}>{PART_BADGE[p.id]}</span>
                  : <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.75 }}>{PART_BADGE[p.id]}</span>)}
              </button>
            );
          })}
        </div>
      )}

      {loading && <div style={{ padding: 48, textAlign: "center", color: T.ink3, fontSize: 13 }}>Loading…</div>}

      {/* The parts. Each is the component its old sub-tab rendered, with the
          same props, so every figure is the one it was (tests/fix1-fundraising
          §5 compares them in cents). BUILD-88b B.1 deposits · BUILD-98 Part 2
          acknowledgments · BUILD-98 Part 4 events · BUILD-99 Parts 1/2/3/5
          proposals, portfolios, plans, the major-gifts dashboard · BUILD-101
          Part 1 members (a membership payment is a gift, so that screen counts
          people, never a second money total). */}
      <div data-fr-view={subtab}>
      {!loading && subtab === "overview" && (
        <>
          <OverviewView overview={overview} campaigns={campaigns} isReadOnly={isReadOnly}
            onNewCampaign={() => setSubtab("campaigns")} onGoto={setSubtab} onNavigate={onNavigate} primaryBtn={primaryBtn} onOpenCampaign={openCampaign} />
        </>
      )}

      {/* FIX-1 §B — the sidebar's Pipeline, folded into Major gifts. The SAME
          board (one GET /pipeline, one Team gate server-side, the Core locked
          preview); `embedded` only drops its own page title under this one. */}
      {!loading && subtab === "pipeline" && (
        <Pipeline embedded isReadOnly={isReadOnly} onNavigate={onNavigate} initialScope={initialScope} />
      )}

      {/* BUILD-88b B.1 — DepositsView is deliberately NOT wired to Fundraising's
          own `load`. Found by the walk: reloading this page's data flips
          `loading` true, which UNMOUNTS the view and takes the "it foots"
          confirmation with it the instant the deposit lands. The list reloads
          itself. */}
      {/* CAPTURE-1: reloads itself, for the deposit sheet's reason below. */}
      {!loading && subtab === "toconfirm" && (
        <CaptureInbox isReadOnly={isReadOnly} onOpenThanks={onNavigate ? id => onNavigate("communications", { subtab: "milestones", highlightDraftId: id }) : null} />
      )}

      {!loading && subtab === "pledges" && (
        <PledgesView onNavigate={onNavigate} />
      )}

      {!loading && subtab === "deposits" && (
        <DepositsView isReadOnly={isReadOnly} roTip={roTip} />
      )}

      {/* BUILD-99 Part 1 — deliberately NOT wired to Fundraising's own `load`,
          for the reason the deposit sheet is not (above): a parent reload
          unmounts the view and takes the confirmation with it. It reloads itself. */}
      {!loading && subtab === "majorgifts" && (
        <MajorGiftsDashboard onNavigate={onNavigate} />
      )}

      {!loading && subtab === "proposals" && (
        <ProposalsView isReadOnly={isReadOnly} onNavigate={onNavigate} />
      )}

      {!loading && subtab === "portfolios" && (
        <PortfolioView isReadOnly={isReadOnly} onNavigate={onNavigate} />
      )}

      {!loading && subtab === "plans" && (
        <PlansView isReadOnly={isReadOnly} />
      )}

      {!loading && subtab === "events" && (
        <EventsDesk orgSlug={orgSlug} isReadOnly={isReadOnly} />
      )}

      {!loading && subtab === "acknowledgments" && (
        <AcknowledgmentsView isReadOnly={isReadOnly} roTip={roTip} onNavigate={onNavigate} />
      )}

      {!loading && subtab === "campaigns" && (
        <CampaignsView goals={overview?.goals || []} isReadOnly={isReadOnly} roTip={roTip} openId={openCampaignId}
          onOpenCampaign={openCampaign} onBack={closeCampaign} onNavigate={onNavigate}
          onNew={() => !isReadOnly && setModal({ mode: "new" })}
          templates={(tpl, reload) => <CampaignTemplates data={tpl} reload={reload} isReadOnly={isReadOnly} onCreated={out => { load(); if (out && out.campaignId) openCampaign(out.campaignId); }} onOpenCampaign={openCampaign} />}
          planPanel={id => <CampaignPlanPanel campaignId={id} isReadOnly={isReadOnly} />}
          onEdit={c => !isReadOnly && setModal({ mode: "edit", campaign: c })} onRemoved={load} />
      )}

      {!loading && subtab === "pages" && (
        <PagesView pages={pages} orgSlug={orgSlug} onNavigate={onNavigate} isReadOnly={isReadOnly} takesGifts={overview?.givingPages?.takesGifts !== false}
          onChanged={() => apiFetch("/giving-pages").then(p => setPages(p || [])).catch(() => {})} />
      )}

      {/* PARITY-2 Part 4: auctions: items, bids, winners, pay links. */}
      {!loading && subtab === "auctions" && (
        <AuctionsView isReadOnly={isReadOnly} onNavigate={onNavigate} />
      )}

      {/* BUILD-103 Part 6 — the screen an org runs a walk from. */}
      {!loading && subtab === "p2p" && (
        <PeerToPeerView isReadOnly={isReadOnly} orgSlug={orgSlug} onNavigate={onNavigate} openPageId={p2pOpenPageId} />
      )}

      {!loading && subtab === "unfinished" && (
        <StartedNotFinished isReadOnly={isReadOnly} isAdmin={isAdmin} onNavigate={onNavigate} />
      )}

      {!loading && subtab === "recurring" && (
        <RecurringView onNavigate={onNavigate} isReadOnly={isReadOnly} />
      )}

      {!loading && subtab === "members" && (
        <MembersView isReadOnly={isReadOnly} isAdmin={isAdmin} onNavigate={onNavigate} orgSlug={orgSlug} />
      )}

      {!loading && subtab === "funds" && (
        <FundsView data={data} onNavigate={onNavigate} />
      )}

      </div>

      {modal && (
        <CampaignModal mode={modal.mode} campaign={modal.campaign} campaigns={campaigns}
          onClose={() => setModal(null)}
          onSaved={(r) => {
            setModal(null); load();
            if (r?.openP2pPageId) { setP2pOpenPageId(r.openP2pPageId); goto("p2p"); }
          }} />
      )}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
// FUNDRAISING-2: one idea per figure. The roll-up counts only goals running
// today and says how many; a goal that has not started says when it starts;
// ended goals sit under Past, folded, with their result. Pledges are three
// figures (open, due this fiscal year, overdue), the ones Home and Pledges
// read. "Everything in Fundraising" is gone: it repeated the tabs above it.
function OverviewView({ overview, campaigns, onNavigate, primaryBtn, onNewCampaign, onGoto, onOpenCampaign }) {
  if (!overview) return <EmptyState title="Nothing to show yet" message="Set a goal and start a campaign to see your fundraising momentum here." />;
  const { period, givingPages, rollup, goals = [], last12, goal: orgGoal, emptyYearWithHistory, pledges, leadEvent } = overview;
  const gp = givingPages;
  const topGoals = goals.filter(g => g.isTopLevel);
  const running = topGoals.filter(g => g.lifecycle === "active");
  const upcoming = topGoals.filter(g => g.lifecycle === "upcoming");
  const past = topGoals.filter(g => g.lifecycle === "ended");
  const periodWords = overview.periodWords || "this period";
  // FIX-10 Part B — both figures open their OWN rows, in Reports, filtered to
  // exactly the window each was summed over. A figure that lands on a page
  // showing a different total is not a figure that opens.
  const openRows = (from, to) => () => onNavigate && onNavigate("reports", { report: "giving-summary", from, to });
  const top = overview.campaigns.top && overview.campaigns.top.lifecycle === "active" ? overview.campaigns.top : null;
  const label = { fontSize: 10, fontWeight: 800, color: T.ink3 };
  const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 22px", boxShadow: T.shadow };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* FIX-10 Part B — "$0 RAISED · FY 2026–27" over a file that had just
          imported $19,750 was true and useless. The empty year says so in one
          sentence and puts the last twelve months beside it, the way Finance
          already handles the same situation. Both figures open their rows. */}
      {emptyYearWithHistory && last12 && (
        <div style={{ background: T.gold100, border: "1px solid " + T.gold300, borderRadius: 12, padding: "14px 16px", display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 320px", minWidth: 260 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 3 }}>
              Nothing yet in {overview.periodLabel}.
            </div>
            <div style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5 }}>
              Your last 12 months:{" "}
              <button onClick={openRows(last12.start, last12.end)}
                style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: T.greenDk, textDecoration: "underline", cursor: "pointer" }}>
                {fmtTotal(last12.raised)} across {countLabel(last12.giftCount, "gift")}
              </button>
              . A gift dated inside {overview.periodLabel} lands in the figure below the moment it is logged.
            </div>
          </div>
          <button onClick={openRows(period.start, period.end)}
            style={{ background: T.white, color: T.ink, border: "1.5px solid " + T.ink, borderRadius: 8, padding: "9px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            Open {overview.periodLabel} →
          </button>
        </div>
      )}
      {/* FIX-10 Part B — THE ORG GOAL: raised, goal and the pace sentence,
          all from the one pace function (shared/pace.js). */}
      {orgGoal && (
        <div style={{ background: T.white, border: "1px solid " + T.bg2, borderLeft: "4px solid " + T.greenDk, borderRadius: 18, padding: "22px 26px" }}>
          <div style={{ ...label, letterSpacing: "0.14em", marginBottom: 10 }}>Your goal</div>
          {orgGoal.label && <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink, marginBottom: 12 }}>{orgGoal.label}</div>}
          <Thermometer raised={orgGoal.currentAmount} goal={orgGoal.goalAmount} percent={orgGoal.percent}
            rawPercent={orgGoal.rawPercent} over={orgGoal.over}
            paceState={orgGoal.paceState} paceSentence={orgGoal.paceSentence} big />
          {orgGoal.sourceNote && (
            <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 10, lineHeight: 1.5 }}>{orgGoal.sourceNote}</div>
          )}
        </div>
      )}
      {/* Goal-reached celebration — fires once per goal reaching 100% */}
      {running.filter(g => (g.rolledPercent ?? g.percent) >= 100).slice(0, 1).map(g => (
        <GoldMoment key={g.id} moment={`fundraising_goal_${g.id}`} title="You reached a goal."
          line={`${g.name}: ${fmtTotal(g.isOverarching ? g.rolledRaised : g.raised)} raised.`} />
      ))}

      {/* The roll-up counts the goals running today, and the cards under it
          are exactly those goals. One "Start a campaign" on the page. */}
      {rollup ? (
        <div data-testid="fr-rollup" data-active-count={rollup.activeGoalCount} {...interactive(() => onGoto && onGoto("campaigns"), { label: "View campaigns" })} style={{ background: T.white, borderRadius: 18, padding: "26px 28px", color: T.ink, position: "relative", overflow: "hidden", border: "1px solid " + T.bg2, borderLeft: "4px solid " + T.gold500 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.gold700, marginBottom: 10 }}>
            {rollup.activeGoalCount === 1 ? "Active goal" : `Active goals · ${rollup.activeGoalCount}`}
          </div>
          <RollupThermometer rollup={rollup} />
          {rollup.activeGoalCount > 1 && (
            <div style={{ marginTop: 14, fontSize: 13, color: T.ink3 }}>
              Raised across the {rollup.activeGoalCount} goals running today, against their goals combined. Goals not started yet and goals that have ended are not in it.
            </div>
          )}
        </div>
      ) : !leadEvent && !upcoming.length ? (
        <StartHere line="Start a campaign with a goal to light up a live thermometer here. Annual funds, a Project push, a Capital campaign: each tracks every gift automatically, and they roll up into one number." actionLabel="+ Start a campaign" onAction={onNewCampaign} />
      ) : null}

      {running.length > 0 && (
        <div data-testid="fr-goals-active">
          <div style={{ ...label, marginBottom: 10 }}>Running now · {running.length}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16 }}>
            {running.map(g => (
              <GoalCard key={g.id} g={g} allGoals={goals} onClick={() => onOpenCampaign ? onOpenCampaign(g.id) : onGoto && onGoto("campaigns")} />
            ))}
          </div>
        </div>
      )}
      {upcoming.length > 0 && (
        <div data-testid="fr-goals-upcoming">
          <div style={{ ...label, marginBottom: 10 }}>Starting soon · {upcoming.length}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16 }}>
            {upcoming.map(g => (
              <GoalCard key={g.id} g={g} allGoals={goals} onClick={() => onOpenCampaign ? onOpenCampaign(g.id) : onGoto && onGoto("campaigns")} />
            ))}
          </div>
        </div>
      )}

      {/* Momentum: the period's money and gifts, pledges, live pages. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
        <StatTile label={`Raised · ${overview.periodLabel}`} value={fmtTotal(period.raised)}
          accent={T.gold}
          onClick={period.start && period.end ? openRows(period.start, period.end) : () => onNavigate && onNavigate("reports")}
          ariaLabel={`View the gifts behind ${overview.periodLabel} raised`}
          sub={period.priorRaised > 0
            ? <span data-testid="fr-vs-last-year" onClick={e => e.stopPropagation()} title={period.compare ? period.compare.sentence : undefined}>{period.delta >= 0 ? "↑" : "↓"}{" "}
                {period.compare && period.compare.source
                  ? <Figure variant="inline" kind="money" whole abs value={period.delta} label="Against the same days last year" definition={period.compare.sentence} source={period.compare.source} figureKey="fundraising.vsLastYear" why={false} />
                  : fmtTotal(Math.abs(period.delta))} vs the same days last year</span>
            : `${countLabel(period.donorCount, "donor")}`} />
        <StatTile label={`Gifts ${periodWords}`} value={period.giftCount.toLocaleString()} accent={T.bg3}
          onClick={period.start && period.end ? openRows(period.start, period.end) : () => onNavigate && onNavigate("reports")}
          ariaLabel={`View the gifts ${periodWords}`}
          sub={`${countLabel(period.donorCount, "donor")}`} />
        {pledges && <PledgeTile p={pledges} onOpen={() => onGoto && onGoto("pledges")} />}
        <StatTile label="Live giving pages" value={gp.count} accent={T.bg3}
          onClick={() => onGoto && onGoto("pages")}
          ariaLabel="View giving pages"
          sub={gp.count > 0 ? `${fmtTotal(gp.raised)} raised` : "None can take a gift yet"} />
      </div>
      {/* IMPORT-4: the period's figures leave out gifts with no date, and say so. */}
      {overview.undated && overview.undated.count > 0 && (
        <div data-testid="fr-undated" style={{ fontSize: 12, color: T.ink3, marginTop: -4 }}>
          <Figure variant="inline" kind="count" value={overview.undated.count} suffix={overview.undated.count === 1 ? " gift" : " gifts"} label="Gifts with no date"
            definition="Gifts that came in with no date. They count in Lifetime and the campaign or event they were given to, and in no figure for a span of time, because their year is not known."
            source={overview.undated.source} figureKey="fundraising.undated" /> with no date not counted {periodWords}
        </div>
      )}

      {/* The leading campaign, or with none running the event that raised
          most this year, beside the recent gifts. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16, alignItems: "start" }}>
        {top ? <LeadCampaign top={top} onOpen={() => onOpenCampaign ? onOpenCampaign(top.id) : onGoto && onGoto("campaigns")} onNavigate={onNavigate} card={card} label={label} />
          : leadEvent ? <LeadEvent e={leadEvent} onNavigate={onNavigate} card={card} label={label} />
          : (
          <div style={card}>
            <div style={{ ...label, marginBottom: 12 }}>Leading campaign</div>
            <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>
              No campaign is running. A campaign gives a specific appeal its own thermometer and pace.
              {(rollup || upcoming.length) ? <div style={{ marginTop: 12 }}>{primaryBtn("+ Start a campaign", onNewCampaign)}</div> : null}
            </div>
          </div>
        )}

        <div style={card}>
          <div style={{ ...label, marginBottom: 14 }}>Recent gifts</div>
          {overview.recentGifts.length === 0 ? (
            <div style={{ fontSize: 13, color: T.ink3, padding: "12px 0" }}>Gifts will appear here as they come in, from your giving pages, campaigns, and offline entries.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {overview.recentGifts.map((g, i) => {
                const go = g.donorId ? () => onNavigate && onNavigate("donors", { selectDonorId: g.donorId }) : null;
                return (
                  <div key={g.id} {...interactive(go, { label: `View ${g.donorName}` })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", margin: "0 -10px", borderRadius: 8, borderTop: i === 0 ? "none" : "1px solid " + T.bg2 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.donorId ? <DonorLink id={g.donorId} onOpen={go}>{g.donorName}</DonorLink> : g.donorName}</div>
                      <div data-testid="fr-recent-for" style={{ fontSize: 11, color: T.ink3 }}>{[g.campaign, g.date ? displayDate(g.date) : "No date", g.method].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif" }}>{fmtFull(g.amount)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {past.length > 0 && (
        <details data-testid="fr-goals-past" style={{ ...card, padding: "14px 22px" }}>
          <summary style={{ ...label, cursor: "pointer" }}>Past · {past.length}</summary>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
            {past.map((g, i) => {
              const raised = g.isOverarching ? g.rolledRaised : g.raised;
              const pct = g.isOverarching ? g.rolledRawPercent : g.rawPercent;
              return (
                <div key={g.id} {...interactive(() => onOpenCampaign && onOpenCampaign(g.id), { label: `View ${g.name}` })}
                  style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderTop: i ? "1px solid " + T.bg2 : "none", fontSize: 13, color: T.ink }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}{g.endDate ? <span style={{ color: T.ink3 }}> · ended {displayDate(String(g.endDate).slice(0, 10))}</span> : null}</span>
                  <span style={{ flexShrink: 0, color: T.ink2 }}>{fmtTotal(raised)} of {fmtTotal(g.goalAmount)} · {pct ?? 0}%</span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

// FUNDRAISING-2: open pledges, with what is due this fiscal year and what is
// overdue, each opening its rows; the tile opens Pledges.
function PledgeTile({ p, onOpen }) {
  const fig = (k, label) => <Figure variant="inline" kind="money" whole value={p[k]} label={label} definition={p.definitions[k]} source={p.sources[k]} figureKey={"fundraising.pledges." + k} why={false} />;
  return (
    <div data-testid="fr-pledges" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", borderLeft: "3px solid " + T.bg3, boxShadow: T.shadow, display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: T.ink3 }}>Pledged, still to come</span>
      <span style={{ fontSize: 26, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif", lineHeight: 1.05, letterSpacing: "-0.02em" }}>{fig("open", "Pledged, still to come")}</span>
      <span style={{ fontSize: 12, color: T.ink3, lineHeight: 1.4 }}>
        {fig("dueThisYear", "Pledged, due this fiscal year")} due this fiscal year · {fig("overdue", "Pledged, overdue")} overdue
      </span>
      <button onClick={onOpen} style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, fontSize: 12, fontWeight: 700, color: T.greenDk, cursor: "pointer", fontFamily: "inherit" }}>Every pledge →</button>
    </div>
  );
}

// FUNDRAISING-2: the leading campaign says what is left, how long, the pace
// it needs, and who gave most to it this month.
function LeadCampaign({ top, onOpen, onNavigate, card, label }) {
  const l = top.lead || {};
  return (
    <div data-testid="fr-lead-campaign" {...interactive(onOpen, { label: `View campaign ${top.name}` })} style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={label}>Leading campaign</span>
        <button onClick={onOpen} style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: T.greenDk, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Open →</button>
      </div>
      <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink, marginBottom: 12 }}>{top.name}</div>
      <Thermometer raised={top.raised} goal={top.goalAmount} percent={top.percent} rawPercent={top.rawPercent} over={top.over} paceState={top.paceState} paceSentence={top.paceSentence} />
      <div style={{ marginTop: 12, fontSize: 13, color: T.ink2, lineHeight: 1.6 }}>
        {l.left > 0
          ? <>{fmtTotal(l.left)} to go{daysLeftText(top.daysLeft) ? `, ${daysLeftText(top.daysLeft)}` : ""}{l.perWeek ? `: about ${fmtTotal(l.perWeek)} a week to finish on time.` : "."}</>
          : <>The goal is met{daysLeftText(top.daysLeft) ? `, ${daysLeftText(top.daysLeft)}` : ""}.</>}
      </div>
      {(l.topGivers || []).length > 0 && (
        <div style={{ marginTop: 12, borderTop: "1px solid " + T.bg2, paddingTop: 10 }}>
          <div style={{ ...label, marginBottom: 6 }}>Gave most this month</div>
          {l.topGivers.map(x => (
            <div key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "3px 0" }}>
              <DonorLink id={x.id} onOpen={() => onNavigate && onNavigate("donors", { selectDonorId: x.id })}>{x.name}</DonorLink>
              <span style={{ color: T.ink2 }}>{fmtFull(x.total)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// FUNDRAISING-2: no campaign running, so the event that raised most in the
// last twelve months leads, told the way its own page tells it.
function LeadEvent({ e, onNavigate, card, label }) {
  const open = () => onNavigate && onNavigate("events", { eventId: e.id });
  return (
    <div data-testid="fr-lead-event" style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={label}>Your biggest event this year</span>
        <button onClick={open} style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: T.greenDk, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Open the event →</button>
      </div>
      <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink, marginBottom: 4 }}>
        <RecordLink to={tabHref("events", { eventId: e.id })} onOpen={open} data-record-link="event">{e.name}</RecordLink>
      </div>
      <div style={{ fontSize: 12, color: T.ink3, marginBottom: 12 }}>{e.date ? displayDate(e.date) : "Date not known"}</div>
      <EventStory s={e} />
    </div>
  );
}

// Roll-up thermometer — total raised across active goals vs total goal. FIX-2 C:
// it sits on a white card now (it was the dark pine hero), brass for progress.
function RollupThermometer({ rollup }) {
  const pct = rollup.percent == null ? 0 : rollup.percent;
  const shown = rollup.rawPercent == null ? rollup.percent : rollup.rawPercent;
  const met = pct >= 100;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 30, color: T.ink, lineHeight: 1 }}>{fmtTotal(rollup.totalRaised)}</span>
          <span style={{ fontSize: 14, color: T.ink3 }}>of {fmtTotal(rollup.totalGoal)}{rollup.over > 0 ? ` · ${fmtTotal(rollup.over)} over` : ""}</span>
        </div>
        {shown != null && <span style={{ fontSize: 16, fontWeight: 800, color: T.gold700 }}>{shown}%</span>}
      </div>
      <div style={{ height: 14, background: T.bg2, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, height: "100%", borderRadius: 99, transition: "width 0.6s cubic-bezier(.22,1,.36,1)", background: met ? T.gold500 : T.gold600 }} />
      </div>
    </div>
  );
}

// One goal card in the portfolio. Overarching goals show their rolled-up child
// progress and list their children; leaf goals show their own SUM(gifts).
// Committed-but-not-yet-raised money beside a campaign's raised figure:
// open pledges + (already inside raised) awarded grants. "raised = payments
// received + awarded grants"; "$X pledged" is SEPARATE, never summed in —
// summing a pledge and its payments into one number double-counts.
function committedText(g) {
  const parts = [];
  if ((g.pledged || 0) > 0) parts.push(`${fmtTotal(g.pledged)} pledged`);
  if ((g.grantAwarded || 0) > 0) parts.push(`incl. ${fmtTotal(g.grantAwarded)} in awarded grants`);
  return parts.join(" · ");
}

function GoalCard({ g, allGoals, onClick }) {
  const cat = CATEGORY_META[g.goalCategory] || CATEGORY_META.project;
  const accent = g.isOverarching ? T.gold600 : cat.color;
  const raised = g.isOverarching ? g.rolledRaised : g.raised;
  const percent = g.isOverarching ? g.rolledPercent : g.percent;
  const rawPercent = g.isOverarching ? g.rolledRawPercent : g.rawPercent;
  const over = g.isOverarching ? g.rolledOver : g.over;
  const paceState = g.isOverarching ? g.rolledPaceState : g.paceState;
  const paceSentence = g.isOverarching ? g.rolledPaceSentence : g.paceSentence;
  const children = g.isOverarching ? allGoals.filter(x => g.childIds.includes(x.id)) : [];
  return (
    <div {...interactive(onClick, { label: `View ${g.name}` })}
      style={{ background: T.white, border: "1px solid " + T.bg3, borderLeft: `3px solid ${accent}`, borderRadius: 16, padding: "18px 20px", boxShadow: T.shadow, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 17, color: T.ink, lineHeight: 1.25, minWidth: 0 }}>
          <RecordLink to={campaignHref(g.id)} onOpen={onClick} data-record-link="campaign">{g.name}</RecordLink>
        </div>
        <CategoryBadge g={g} />
      </div>
      {g.lifecycle === "upcoming" ? (
        // FUNDRAISING-2: not started, so no bar and no pace: when it starts,
        // its goal, and what came in early.
        <div data-testid="goal-starts" style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6 }}>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 20, color: T.ink, lineHeight: 1.2 }}>Starts {displayDate(g.startsOn)}</div>
          <div>Goal {fmtTotal(g.goalAmount)}{g.endDate ? `, through ${displayDate(String(g.endDate).slice(0, 10))}` : ""}.</div>
          <div style={{ color: T.ink3 }}>{(g.pledged || 0) > 0 || (g.earlyGiven || 0) > 0
            ? [(g.pledged || 0) > 0 ? `${fmtTotal(g.pledged)} already pledged` : null, (g.earlyGiven || 0) > 0 ? `${fmtTotal(g.earlyGiven)} given early` : null].filter(Boolean).join(" · ") + "."
            : "Nothing pledged or given to it yet."}</div>
        </div>
      ) : (
        <Thermometer raised={raised} goal={g.goalAmount} percent={percent} rawPercent={rawPercent} over={over} paceState={paceState} paceSentence={paceSentence} />
      )}
      {g.lifecycle === "upcoming" ? null : g.isOverarching ? (
        <div style={{ borderTop: "1px solid " + T.bg2, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>Rolls up {countLabel(g.childCount, "goal")}</div>
          {children.map(c => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: T.ink2 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
              <span style={{ color: T.ink3, flexShrink: 0 }}>{fmtTotal(c.raised)} · {c.rawPercent ?? c.percent ?? 0}%</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: T.ink3, borderTop: "1px solid " + T.bg2, paddingTop: 10 }}>
          {countLabel(g.donorCount, "donor")}
          {daysLeftText(g.daysLeft) && g.lifecycle === "active" ? ` · ${daysLeftText(g.daysLeft)}` : g.lifecycle === "upcoming" ? " · upcoming" : g.lifecycle === "ended" ? " · ended" : ""}
          {committedText(g) ? ` · ${committedText(g)}` : ""}
        </div>
      )}
    </div>
  );
}

function GoalThermometerDark({ goal }) {
  const met = goal.percent >= 100;
  const shown = goal.rawPercent == null ? goal.percent : goal.rawPercent;
  const over = goal.over || 0;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 30, color: T.ink, lineHeight: 1 }}>{fmtFull(goal.currentAmount)}</span>
          <span style={{ fontSize: 14, color: T.ink3 }}>of {fmtFull(goal.goalAmount)}{over > 0 ? ` · ${fmtFull(over)} over` : ""}</span>
        </div>
        <span style={{ fontSize: 16, fontWeight: 800, color: T.gold700 }}>{shown}%</span>
      </div>
      <div style={{ height: 14, background: T.bg2, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(goal.percent, goal.percent > 0 ? 2 : 0)}%`, height: "100%", borderRadius: 99, transition: "width 0.6s cubic-bezier(.22,1,.36,1)", background: met ? T.gold500 : T.gold600 }} />
      </div>
    </div>
  );
}

// ── Campaigns ───────────────────────────────────────────────────────────────
// Renders the same enriched goal portfolio the Overview reads (top-level goals,
// children nested under their umbrella) — NOT the flat campaign rows — so an
// umbrella shows its roll-up here too, never "$0 · Behind pace" while its
// children fund it. Top-level count == cards shown.
// ── CAMPAIGN-2 · A CAMPAIGN IN TEN MINUTES ─────────────────────────────────
// Two templates, their real dates computed from this year's calendar, and what
// pressing the button actually creates. It says so BEFORE the press rather than
// after: a button that silently makes a campaign, a public page and seven tasks
// is a button nobody presses twice.
function CampaignTemplates({ data, reload, isReadOnly, onCreated, onOpenCampaign }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);     // the key whose detail is showing
  const [goal, setGoal] = useState("");

  async function create(key) {
    if (busy) return;
    setBusy(key); setErr("");
    try {
      const out = await apiFetch("/campaigns/from-template", {
        method: "POST",
        body: JSON.stringify({ template: key, goalAmount: goal === "" ? null : Number(goal) }),
      });
      setGoal(""); setOpen(null);
      if (reload) await reload();
      if (onCreated) onCreated(out);
    } catch (e) { setErr(errorMessage(e, "That did not start.")); }
    setBusy("");
  }

  if (!data || !data.templates.length) return null;

  return (
    <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 22px", marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: T.ink3, marginBottom: 6 }}>
        Start from a plan
      </div>
      <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginBottom: 14 }}>{data.definition}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
        {data.templates.map(t => (
          <div key={t.key} className={`camp-tpl camp-tpl-${t.key}`}
            style={{ border: "1px solid " + (open === t.key ? T.ink : T.bg3), borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{t.label} {t.year}</div>
            <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.6, margin: "4px 0 8px" }}>{t.blurb}</div>
            <div style={{ fontSize: 12, color: T.ink2 }}>
              {t.campaign.startDate} to {t.campaign.endDate} &middot; {t.steps.length} dated reminders
            </div>
            {t.existingCampaignId ? (
              <div className="camp-tpl-done" style={{ fontSize: 12.5, color: T.ink2, marginTop: 8 }}>
                You started {t.campaign.name}.{" "}
                <a href={campaignHref(t.existingCampaignId)} data-testid="camp-tpl-open"
                  onClick={e => { if (onOpenCampaign && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onOpenCampaign(t.existingCampaignId); } }}
                  style={{ color: T.greenDk, fontWeight: 700 }}>Open it</a>
              </div>
            ) : !isReadOnly ? (
              <>
                <button onClick={() => setOpen(open === t.key ? null : t.key)}
                  style={{ background: "none", border: "none", padding: 0, marginTop: 8, color: T.greenDk,
                           fontSize: 12.5, fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}>
                  {open === t.key ? "Hide the plan" : "See the plan"}
                </button>
                {open === t.key ? (
                  <>
                    <ol className="camp-tpl-steps" style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                      {t.steps.map(s => (
                        <li key={s.due + s.title} style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.6, marginBottom: 6 }}>
                          <strong style={{ color: T.ink }}>{s.due}</strong> &middot; {s.title}
                          <span style={{ display: "block", color: T.ink3 }}>{s.detail}</span>
                        </li>
                      ))}
                    </ol>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                      <input className="camp-tpl-goal" placeholder="Goal (optional)" value={goal} inputMode="decimal"
                        onChange={e => setGoal(e.target.value.replace(/[^0-9.]/g, ""))}
                        style={{ background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px",
                                 color: T.ink, fontSize: 13, fontFamily: "inherit", width: 140 }} />
                      <button className="camp-tpl-go" onClick={() => create(t.key)} disabled={!!busy}
                        style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 8,
                                 padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
                        {busy === t.key ? "Starting…" : `Start ${t.label} ${t.year}`}
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        ))}
      </div>
      {err ? <div style={{ fontSize: 12, color: T.gold, marginTop: 10 }}>{err}</div> : null}
    </div>
  );
}

// ── CAMPAIGN-2 · THE PLAN, AND THE MATCH ───────────────────────────────────
// Both on the campaign they belong to. The plan is the template's dated steps
// read back as a plan rather than scattered through everybody's task list, and
// the match is the one number a campaign page may not invent.
function CampaignPlanPanel({ campaignId, isReadOnly }) {
  const [plan, setPlan] = useState(null);
  const [match, setMatch] = useState({ amount: "", sponsor: "" });
  const [matchMsg, setMatchMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!campaignId) return;
    apiFetch(`/campaigns/${campaignId}/plan`).then(setPlan).catch(() => setPlan({ steps: [] }));
  }, [campaignId]);

  async function saveMatch(clear) {
    if (busy) return;
    setBusy(true); setErr(""); setMatchMsg("");
    try {
      const cents = clear ? null : Math.round(Number(match.amount || 0) * 100);
      const out = await apiFetch(`/campaigns/${campaignId}/match`, {
        method: "PUT", body: JSON.stringify({ matchCents: cents, sponsor: match.sponsor || undefined }),
      });
      setMatchMsg(out.sentence || "");
      if (clear) setMatch({ amount: "", sponsor: "" });
    } catch (e) { setErr(errorMessage(e, "That did not save.")); }
    setBusy(false);
  }

  if (!plan) return null;
  const inp = { background: T.bg, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px",
                color: T.ink, fontSize: 13, fontFamily: "inherit" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {plan.steps.length ? (
        <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 22px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: T.ink3, marginBottom: 8 }}>
            The plan
          </div>
          <ul className="camp-plan" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {plan.steps.map(s => (
              <li key={s.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0",
                                      borderTop: "1px solid " + T.bg2, fontSize: 13 }}>
                {/* Brass for late, never red: red is only for a destructive confirm. */}
                <span style={{ minWidth: 92, color: s.late ? T.gold700 : T.ink3, fontWeight: s.late ? 700 : 400 }}>{s.due}</span>
                <span style={{ flex: 1, color: T.ink, textDecoration: s.done ? "line-through" : "none", opacity: s.done ? 0.55 : 1 }}>
                  {s.title}
                </span>
                {s.owner ? <span style={{ color: T.ink3, fontSize: 12 }}>{s.owner}</span> : null}
              </li>
            ))}
          </ul>
          <div style={{ fontSize: 12, color: T.ink3, marginTop: 10, lineHeight: 1.55 }}>{plan.definition}</div>
        </div>
      ) : null}

      <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 22px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: T.ink3, marginBottom: 8 }}>
          Matching challenge
        </div>
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, marginBottom: 12 }}>
          Enter it only once somebody has actually promised it. The page says nothing about a match until you do, and it stops
          claiming one when the whole amount has been claimed.
        </div>
        {!isReadOnly ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input className="camp-match-amount" placeholder="Amount" value={match.amount} inputMode="decimal"
              onChange={e => setMatch({ ...match, amount: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...inp, width: 120 }} />
            <input className="camp-match-sponsor" placeholder="Who is matching (optional)" value={match.sponsor}
              onChange={e => setMatch({ ...match, sponsor: e.target.value })} style={{ ...inp, minWidth: 220, flex: 1 }} />
            <button className="camp-match-save" onClick={() => saveMatch(false)} disabled={busy || !match.amount}
              style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "9px 16px",
                       fontSize: 13, fontWeight: 700, cursor: busy || !match.amount ? "default" : "pointer",
                       opacity: match.amount ? 1 : 0.5 }}>Save</button>
            <button onClick={() => saveMatch(true)} disabled={busy}
              style={{ background: "none", border: "none", padding: 0, color: T.ink3, fontSize: 12,
                       textDecoration: "underline", cursor: busy ? "default" : "pointer" }}>Turn it off</button>
          </div>
        ) : null}
        {matchMsg ? <div className="camp-match-msg" style={{ fontSize: 12.5, color: T.ink2, marginTop: 10, lineHeight: 1.55 }}>{matchMsg}</div> : null}
        {err ? <div style={{ fontSize: 12, color: T.gold, marginTop: 8 }}>{err}</div> : null}
      </div>
    </div>
  );
}

function CampaignModal({ mode, campaign, campaigns = [], onClose, onSaved }) {
  const [name, setName] = useState(campaign?.name || "");
  const [goal, setGoal] = useState(campaign?.goalAmount ? String(campaign.goalAmount) : "");
  const [category, setCategory] = useState(campaign?.goalCategory || "project");
  const [parentId, setParentId] = useState(campaign?.parentGoalId || "");
  const [start, setStart] = useState(campaign?.startDate ? String(campaign.startDate).slice(0, 10) : "");
  const [end, setEnd] = useState(campaign?.endDate ? String(campaign.endDate).slice(0, 10) : "");
  // BUILD-54 §2 — donor-facing content lives on the SAME form the campaign is
  // created/edited in (no separate configuration screen to forget).
  const [dfName, setDfName] = useState(campaign?.donorFacingName || "");
  const [dfDesc, setDfDesc] = useState(campaign?.donorDescription || "");
  const [dfStory, setDfStory] = useState(storyToText(campaign?.donorStory));
  const [dfHero, setDfHero] = useState(campaign?.heroImageUrl || "");   // stored path OR fresh data URI
  const [dfHeroCrop, setDfHeroCrop] = useState(campaign?.heroCrop || null); // BUILD-65 Part 3 — non-destructive crop
  const [goalPublic, setGoalPublic] = useState(campaign?.goalProgressPublic === true);
  const [grantsOff, setGrantsOff] = useState(campaign?.grantsOffPublicBar === true);   // FIX-49
  // FIX-7 Part 4 — peer-to-peer lives on a giving page, and until now the only
  // way to find that out was to make a campaign, then go and make a page, then
  // find the switch. On a NEW campaign it is one line here.
  const [p2p, setP2p] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [dirty, setDirty] = useState(false);
  const close = () => {
    if (dirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    onClose();
  };

  // Eligible parents: any other goal in this org that isn't itself a child
  // (keep the roll-up one level deep for a legible portfolio).
  const parentOptions = campaigns.filter(c => c.id !== campaign?.id && !c.parentGoalId);

  const save = async () => {
    setErr("");
    if (!name.trim()) { setErr("Give your goal a name."); return; }
    const g = parseFloat(goal);
    if (!Number.isFinite(g) || g <= 0) { setErr("Enter a positive goal amount."); return; }
    setSaving(true);
    try {
      const body = {
        name: name.trim(), goalAmount: g, goalCategory: category, parentGoalId: parentId || null, startDate: start || null, endDate: end || null,
        donorFacingName: dfName.trim(), donorDescription: dfDesc.trim(),
        donorStory: textToStory(dfStory), heroImageData: dfHero || "", heroCrop: dfHero ? dfHeroCrop : "",
        goalProgressPublic: goalPublic, grantsOffPublicBar: grantsOff,
      };
      if (mode === "edit") { await apiFetch(`/fundraising/campaigns/${campaign.id}`, { method: "PUT", body: JSON.stringify(body) }); onSaved(); return; }
      const made = await apiFetch("/fundraising/campaigns", { method: "POST", body: JSON.stringify(body) });
      // The giving page, through the ONE page-creation path (POST
      // /giving-pages) — the same route Giving pages & forms posts to. Its
      // name, goal, description and photo are the campaign's, so nobody types
      // them twice. Off: nothing below this line happens at all.
      let page = null;
      if (p2p) {
        page = await apiFetch("/giving-pages", { method: "POST", body: JSON.stringify({
          title: (dfName.trim() || name.trim()), goalAmount: g, story: dfDesc.trim(),
          imageUrl: made?.heroImageUrl || "", campaignId: made?.id, p2pEnabled: true,
        }) });
      }
      onSaved(page ? { openP2pPageId: page.id } : undefined);
    } catch (e) { setErr(errorMessage(e, "Could not save")); setSaving(false); }
  };

  const field = { width: "100%", padding: "10px 12px", border: "1px solid " + T.bg3, borderRadius: 10, fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" };
  const lbl = { fontSize: 12, fontWeight: 700, color: T.ink2, marginBottom: 6, display: "block" };

  return (
    // BUILD-87 F.1 — THE DIALOG THIS FIX WAS WRITTEN FOR. It was clipped below
    // "Start date" on a tall Campaigns page, under a backdrop that stopped
    // partway down. It is the shared Modal now: portalled to document.body, so
    // no transformed ancestor can claim it, capped at 90vh with its own body
    // scrolling, and its Save button lives in a sticky footer where a long form
    // cannot push it out of reach.
    <Modal onClose={close} title={mode === "edit" ? "Edit campaign" : "New campaign"}
      subtitle="Raised is tracked automatically from gifts attributed to this campaign."
      width={460}
      footer={<>
        {dirty && !saving && <span style={{ fontSize: 12, color: T.ink3, marginRight: "auto" }}>Unsaved changes</span>}
        <button onClick={close} style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, color: T.ink2, cursor: "pointer" }}>Cancel</button>
        <button onClick={save} disabled={saving} style={{ background: T.gold, border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 700, color: T.ink, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : mode === "edit" ? "Save changes" : "Create campaign"}</button>
      </>}>
      <div onChangeCapture={() => setDirty(true)}>
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Campaign name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Spring Studio Scholarships" style={field} autoFocus />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Goal amount</label>
          <input value={goal} onChange={e => setGoal(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="15000" inputMode="decimal" style={field} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Type</label>
          <div style={{ display: "flex", gap: 8 }}>
            {[["annual", "Annual"], ["project", "Project"], ["capital", "Capital"]].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setCategory(v)}
                style={{ flex: 1, background: category === v ? (CATEGORY_META[v].color + "18") : T.bg, border: `1px solid ${category === v ? CATEGORY_META[v].color : T.bg3}`, borderRadius: 10, padding: "9px", fontSize: 13, fontWeight: 700, color: category === v ? CATEGORY_META[v].color : T.ink3, cursor: "pointer" }}>{l}</button>
            ))}
          </div>
        </div>
        {parentOptions.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Rolls up under <span style={{ color: T.ink3, fontWeight: 400 }}>(optional overarching goal)</span></label>
            <select value={parentId} onChange={e => setParentId(e.target.value)} style={field}>
              <option value="">None (stands alone)</option>
              {parentOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Start date <span style={{ color: T.ink3, fontWeight: 400 }}>(optional)</span></label>
            <input type="date" value={start} onChange={e => setStart(e.target.value)} style={field} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Deadline <span style={{ color: T.ink3, fontWeight: 400 }}>(optional)</span></label>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={field} />
          </div>
        </div>
        {/* BUILD-54 §2 — donor-facing content, org-authored only. Honest empty
            state: no filler is ever generated for the donor side. */}
        <div style={{ borderTop: "1px solid " + T.bg3, margin: "4px 0 16px", paddingTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 4 }}>What donors see</div>
          <div style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5, marginBottom: 12 }}>
            Donors will see this campaign by name on their gifts. Add a description and photo so their gift means something.
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Donor-facing name <span style={{ color: T.ink3, fontWeight: 400 }}>(optional, defaults to the campaign name)</span></label>
            <input value={dfName} onChange={e => setDfName(e.target.value)} placeholder={name.trim() || "e.g. Steeples and Studios Campaign"} style={field} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Short description <span style={{ color: T.ink3, fontWeight: 400 }}>(shown on gifts, receipts, and the donor page)</span></label>
            <textarea value={dfDesc} onChange={e => setDfDesc(e.target.value)} rows={2} maxLength={600}
              placeholder="One or two sentences, in your own words, on what this campaign is doing." style={{ ...field, resize: "vertical" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Story <span style={{ color: T.ink3, fontWeight: 400 }}>(optional: blank line = new paragraph, "## " = heading, "- " = list)</span></label>
            <textarea value={dfStory} onChange={e => setDfStory(e.target.value)} rows={5}
              placeholder="The longer story donors read on their giving page." style={{ ...field, resize: "vertical" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Campaign photo</label>
            <Uploader accept={IMAGE_ACCEPT} acceptLabel={IMAGE_ACCEPT_LABEL} maxBytes={IMAGE_MAX_BYTES} compact
              shape="wide" preview={dfHero ? (dfHero.startsWith("data:") ? dfHero : resolveAssetUrl(dfHero)) : null}
              label={dfHero ? "Replace photo" : "Drag a photo here, or browse"}
              onFile={({ dataUrl }) => { setDfHero(dataUrl); setDfHeroCrop(null); setDirty(true); }}
              onRemove={() => { setDfHero(""); setDfHeroCrop(null); setDirty(true); }} />
            {/* BUILD-65 Part 3 — non-destructive crop; this preview IS the render
                (same cropImgStyle + ratio the donor's campaign card uses). */}
            {dfHero && (
              <div style={{ marginTop: 10 }}>
                <PortalBannerCrop
                  url={dfHero.startsWith("data:") ? dfHero : resolveAssetUrl(dfHero)}
                  crop={dfHeroCrop} focal={campaign?.heroFocal}
                  ratio={PORTAL_CAMPAIGN_HERO_RATIO}
                  onChange={(c) => { setDfHeroCrop(c); setDirty(true); }} />
              </div>
            )}
          </div>
          {mode !== "edit" && (
            <label data-testid="campaign-p2p" style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: T.ink, cursor: "pointer", marginBottom: 14 }}>
              <input type="checkbox" checked={p2p} onChange={e => setP2p(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                <strong>Let supporters fundraise for this (peer-to-peer)</strong>
                <span style={{ display: "block", fontSize: 12, color: T.ink3, marginTop: 2 }}>
                  Creates this campaign's giving page with fundraising turned on, using the name, goal, description and
                  photo above. Supporters get their own page under it, and every gift counts on this campaign.
                </span>
              </span>
            </label>
          )}
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: T.ink, cursor: "pointer" }}>
            <input type="checkbox" checked={goalPublic} onChange={e => setGoalPublic(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              <strong>Show goal progress to donors</strong>
              <span style={{ display: "block", fontSize: 12, color: T.ink3, marginTop: 2 }}>
                Off by default. When on, donors who gave to this campaign see the goal, amount raised, and percent,
                never donor counts and never anyone else's gifts.
              </span>
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: T.ink, cursor: "pointer" }}>
            <input type="checkbox" checked={grantsOff} onChange={e => setGrantsOff(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              <strong>Leave grants off the public bar</strong>
              <span style={{ display: "block", fontSize: 12, color: T.ink3, marginTop: 2 }}>
                Off by default, so a grant awarded toward this campaign counts on its public bar as it does here.
                Turn it on to show donors only what people gave.
              </span>
            </span>
          </label>
        </div>
        {/* CAMPAIGN-2 — the plan and the matching challenge, INSIDE the panel
            where a campaign is already edited rather than on a screen of their
            own. An unedited campaign has neither, and the panel renders
            nothing for it. */}
        {mode === "edit" && campaign?.id ? (
          <div style={{ marginTop: 18, borderTop: "1px solid " + T.bg2, paddingTop: 16 }}>
            <CampaignPlanPanel campaignId={campaign.id} isReadOnly={false} />
          </div>
        ) : null}
        {/* ENGAGE-1 §4 — "How did it do?", in the same panel. */}
        {mode === "edit" && campaign?.id ? (
          <div style={{ marginTop: 18, borderTop: "1px solid " + T.bg2, paddingTop: 16 }}>
            <HowDidItDo campaignId={campaign.id} isReadOnly={false} />
          </div>
        ) : null}
        {err && <div style={{ fontSize: 13, color: T.terracotta, marginTop: 14 }}>{err}</div>}
      </div>
    </Modal>
  );
}

// ── GIVE-EDIT-1 · One row of actions on every page card ──────────────────
// The volunteer card's row, now on every giving page and on the org's own
// donation form: Edit in editor, Open page, Copy link, QR and embed. One set
// of labels everywhere (FIX-39: "Edit in editor" is the one label for opening
// any email or page in its editor, with a Back to this screen).
const pageActionPrimary = { fontSize: 12, color: T.white, background: T.green, fontWeight: 700, textDecoration: "none", border: "1px solid " + T.green, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" };
const pageActionQuiet = { fontSize: 12, color: T.ink2, fontWeight: 600, textDecoration: "none", background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" };

function PageActions({ editHref, url, live = true, shareOpen, onToggleShare }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try { navigator.clipboard?.writeText(url); } catch { /* the link is on screen to copy by hand */ }
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <a data-testid="page-action" data-edit-in-editor="1" href={editHref} style={pageActionPrimary}>Edit in editor</a>
      {url && live && <a data-testid="page-action" href={url} target="_blank" rel="noreferrer" style={pageActionQuiet}>Open page</a>}
      {url && <button data-testid="page-action" type="button" onClick={copy} style={pageActionQuiet}>{copied ? "Copied" : "Copy link"}</button>}
      {url && <button data-testid="page-action" type="button" aria-expanded={!!shareOpen} onClick={onToggleShare} style={pageActionQuiet}>QR and embed</button>}
    </div>
  );
}

function SharePanel({ url, embedUrl, filenameBase }) {
  return (
    <div style={{ borderTop: "1px solid " + T.bg2, paddingTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
      <QrCodeBlock url={url} filenameBase={filenameBase} />
      <EmbedCodeBlock url={embedUrl || url} />
      <div style={{ fontSize: 11.5, color: T.ink3 }}>Width and height are yours to change. A height of 700 shows the whole form without scrolling.</div>
    </div>
  );
}

// ── FIX-13 Part 5 · The organisation's own donation form ─────────────────
// Moved here from Settings, Integrations: the QR code and the embed code are
// not connections, they are the org-wide giving page's share tools, and they
// belong beside the giving pages and forms. Same blocks, same URL.
function OrgDonationShare({ orgSlug, orgName }) {
  const [open, setOpen] = useState(false);
  if (!orgSlug) return null;
  const url = `${window.location.origin}/give/${orgSlug}`;
  return (
    <div data-testid="org-donation-share" style={{ background: T.white, border: "1px solid " + T.bg2, borderRadius: 12, padding: "16px 18px", marginBottom: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>Your donation form</div>
        <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, marginTop: 2, overflowWrap: "anywhere" }}>{url.replace(/^https?:\/\//, "")}: the page every gift link points to when it names no campaign.</div>
      </div>
      <PageActions editHref={editPageHref("form=org")} url={url} shareOpen={open} onToggleShare={() => setOpen(o => !o)} />
      {open && <SharePanel url={url} filenameBase={(orgName || "donate").toLowerCase().replace(/[^a-z0-9]+/g, "-")} />}
    </div>
  );
}

// GIVE-EDIT-1 · A new giving page starts from a template written in plain,
// warm words, and opens straight in the editor.
function NewGivingPage({ onClose }) {
  const [templates, setTemplates] = useState(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    apiFetch("/giving-page-templates").then(r => setTemplates(Array.isArray(r?.templates) ? r.templates : []))
      .catch(e => { setTemplates([]); setErr(errorMessage(e, "Could not load the templates.")); });
  }, []);
  const choose = async (key) => {
    if (busy) return;
    setBusy(key); setErr("");
    try {
      const row = await apiFetch("/giving-pages", { method: "POST", body: JSON.stringify({ template: key, ...(title.trim() ? { title: title.trim() } : {}) }) });
      window.location.href = `/portal-editor?page=${encodeURIComponent(row.id)}`;
    } catch (e) { setErr(errorMessage(e, "Could not start the page.")); setBusy(""); }
  };
  return (
    <Modal onClose={onClose} title="New giving page" subtitle="Pick a starting point. Every word stays yours to change, and nothing changes for donors until you publish." width={520}
      footer={<button type="button" onClick={onClose} style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, color: T.ink2, cursor: "pointer" }}>Cancel</button>}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: T.ink2, marginBottom: 6 }}>Name it (optional)</label>
      <input data-testid="new-page-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="The template's own name is used if you leave this blank"
        style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14, border: "1px solid " + T.bg3, borderRadius: 10, fontFamily: "inherit", marginBottom: 16 }} />
      {templates === null ? <div style={{ fontSize: 13, color: T.ink3 }}>Loading the templates…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {templates.map(t => (
            <button key={t.key} type="button" data-testid="page-template" data-template={t.key} disabled={!!busy} onClick={() => choose(t.key)}
              style={{ textAlign: "left", background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "12px 14px", cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{busy === t.key ? "Starting…" : t.label}</div>
              <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5, marginTop: 2 }}>{t.blurb}</div>
            </button>
          ))}
        </div>
      )}
      {err && <div style={{ fontSize: 13, color: T.ink, marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

const draftBadge = <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: T.gold100, color: T.gold700, border: "1px solid " + T.gold300 }}>Draft waiting</span>;

// ── Giving Pages ────────────────────────────────────────────────────────────
function PagesView({ pages, orgSlug, onNavigate, isReadOnly = false, onChanged, takesGifts = true }) {
  const [shareId, setShareId] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const active = pages.filter(p => p.status === "active");
  const toggleShare = id => setShareId(s => s === id ? null : id);
  const newButton = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
      <button type="button" data-testid="new-giving-page" onClick={() => setNewOpen(true)} style={{ background: T.green, border: "none", borderRadius: 10, padding: "9px 16px", color: T.white, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>New giving page</button>
    </div>
  );
  if (active.length === 0) {
    return (
      <>
        <OrgDonationShare orgSlug={orgSlug} />
        {newButton}
        <StartHere line="Giving pages are your public, shareable donate pages, one per campaign, each with its own link, QR code and embed. Start one from a template with New giving page; its live progress shows up here." actionLabel="New giving page" onAction={() => setNewOpen(true)} dismissKey="fundraising_pages_intro" />
        <div style={{ marginTop: 20 }}>
          <EmptyState title="No live giving pages" message="Start one with New giving page and it will appear here with its own numbers and share tools." />
        </div>
        {newOpen && <NewGivingPage onClose={() => setNewOpen(false)} />}
      </>
    );
  }
  return (
    <div>
      <OrgDonationShare orgSlug={orgSlug} />
      {newButton}
      {newOpen && <NewGivingPage onClose={() => setNewOpen(false)} />}
      {!takesGifts && (
        <div data-testid="pages-connect-payments" style={{ background: T.gold100, border: "1px solid " + T.gold300, borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: T.ink, lineHeight: 1.5, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 320px" }}>Your pages are drafts until payments are connected. Until then each address shows a friendly "not open yet" page, and none of them counts as live.</span>
          <button onClick={() => onNavigate && onNavigate("settings", { section: "connections" })} style={{ background: T.green, border: "none", borderRadius: 9, padding: "8px 14px", color: T.white, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Connect payments</button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16 }}>
        {active.map(p => {
          // One goal concept: a page linked to a campaign tracks toward THAT
          // campaign — its thermometer shows the campaign's live figures, not a
          // separate page-local goal. An unlinked page keeps its own goal.
          const linked = !!p.campaign_id;
          const raised = linked ? (parseFloat(p.campaign_raised) || 0) : (parseFloat(p.raised_amount) || 0);
          const raisedSource = linked ? p.campaign_raised_source : p.raised_source;   // REPORTS-4
          const goal = linked ? (p.campaign_goal != null ? parseFloat(p.campaign_goal) : null) : (p.goal_amount != null ? parseFloat(p.goal_amount) : null);
          const pct = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : null;
          const isVol = p.page_kind === "volunteer";
          const url = isVol ? (p.public_url ? `${window.location.origin}${p.public_url}` : "")
            : p.public_url ? `${window.location.origin}${p.public_url}`
            : (orgSlug ? `${window.location.origin}/give/${orgSlug}/${p.slug}` : "");
          // VOL-PAGE-1 — a volunteer page sits in the same list, and its three
          // numbers open the rows behind them like every other figure here.
          if (isVol) return (
            <div key={p.id} data-testid="volunteer-page-card" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 22px", boxShadow: T.shadow, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink, lineHeight: 1.25 }}>{p.title}</div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: T.bg, color: T.ink2, border: "1px solid " + T.bg3 }}>Volunteer page</span>
                {!p.published_at && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: T.gold100, color: T.gold700, border: "1px solid " + T.gold300 }}>Not published yet</span>}
                {p.published_at && p.has_draft && draftBadge}
                {/* FIX-45: a page can be removed. The server decides: archived when
                    sign-ups or gifts came through it, deleted when nothing did. */}
                <span style={{ marginLeft: "auto" }}><RemoveMenu kind="volunteer_page" id={p.id} disabled={isReadOnly} onDone={onChanged} /></span>
              </div>
              <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                {[["vol_signups", "vol_signups_source", "Sign-ups"], ["vol_shifts_filled", "vol_shifts_filled_source", "Shifts filled"], ["vol_views", "vol_views_source", "Views"]].map(([k, sk, label]) => (
                  <div key={k}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: T.ink }}>
                      {p[sk] ? <Figure variant="inline" kind="count" value={Number(p[k] || 0)} label={`${label} · ${p.title}`} source={p[sk]} /> : Number(p[k] || 0).toLocaleString("en-US")}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>{label}</div>
                  </div>
                ))}
              </div>
              <PageActions editHref={editPageHref(`page=${encodeURIComponent(p.id)}`)} url={url} live={!!p.published_at} shareOpen={shareId === p.id} onToggleShare={() => toggleShare(p.id)} />
              {shareId === p.id && url && <SharePanel url={url} embedUrl={url + "?embed=1"} filenameBase={`volunteer-page-${p.slug}`} />}
            </div>
          );
          // GIVE-EDIT-1 — a giving page shows how it is doing the way the
          // volunteer card does: raised, gifts and views, each opening its rows.
          const stats = [
            ["Raised", raisedSource ? <Figure variant="inline" kind="money" value={raised} label={linked ? `Raised toward ${p.campaign_name || "the campaign"}` : `Raised on ${p.title}`} source={raisedSource} /> : fmtFull(raised)],
            ["Gifts", p.gifts_source ? <Figure variant="inline" kind="count" value={Number(p.gifts_count || 0)} label={`Gifts · ${p.title}`} source={p.gifts_source} /> : Number(p.gifts_count || 0).toLocaleString("en-US")],
            ["Views", p.views_source ? <Figure variant="inline" kind="count" value={Number(p.views || 0)} label={`Views · ${p.title}`} source={p.views_source} /> : Number(p.views || 0).toLocaleString("en-US")],
          ];
          return (
            <div key={p.id} data-testid="page-card" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 22px", boxShadow: T.shadow, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink, lineHeight: 1.25 }}>{p.title}</div>
                {linked && p.campaign_name && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: T.bg, color: T.ink2, border: "1px solid " + T.bg3 }}>Counts toward {p.campaign_name}</span>}
                {p.has_draft && draftBadge}
                {/* FUNDRAISING-2: never "live" before it can take money. */}
                {!takesGifts && <span data-testid="page-not-live" style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: T.gold100, color: T.gold700, border: "1px solid " + T.gold300 }}>Draft · connect payments to go live</span>}
                <span style={{ marginLeft: "auto" }}><RemoveMenu kind="giving_page" id={p.id} disabled={isReadOnly} onDone={onChanged} /></span>
              </div>
              {goal > 0 && p.show_goal !== false && (
                <Thermometer raised={raised} goal={goal} percent={pct} raisedSource={raisedSource} raisedLabel={linked ? `Raised toward ${p.campaign_name || "the campaign"}` : `Raised on ${p.title}`} />
              )}
              <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                {stats.map(([label, node]) => (
                  <div key={label}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: T.ink }}>{node}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3 }}>{label}</div>
                  </div>
                ))}
              </div>
              <PageActions editHref={editPageHref(`page=${encodeURIComponent(p.id)}`)} url={url} live={takesGifts} shareOpen={shareId === p.id} onToggleShare={() => toggleShare(p.id)} />
              {shareId === p.id && url && <SharePanel url={url} filenameBase={`giving-page-${p.slug}`} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Funds (cross-link, one source of truth is Finance) ──────────────────────
function FundsView({ data, onNavigate }) {
  const funds = data?.funds || [];
  return (
    <div>
      <div style={{ background: T.gold50, border: "1px solid "+T.gold500+"55", borderLeft: "4px solid " + T.gold, borderRadius: 12, padding: "16px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <div style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.6 }}>Funds live in <strong>Finance</strong> they're the accounting home for restricted and unrestricted money. Manage balances, targets, and restrictions there so there's one source of truth.</div>
        </div>
        <button onClick={() => onNavigate && onNavigate("finance")} style={{ background: T.gold, border: "none", borderRadius: 10, padding: "9px 16px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Open Finance → Funds</button>
      </div>
      {funds.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
          {funds.map(f => (
            <div key={f.id || f.name} {...interactive(f.id && onNavigate ? () => onNavigate("finance", { subtab: "funds", fundId: f.id }) : null, { href: f.id ? fundHref(f.id) : undefined, role: "link" })}
              style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", boxShadow: T.shadow, borderLeft: `3px solid ${f.restricted ? T.gold : T.bg3}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 4 }}>
                {f.id ? <RecordLink to={fundHref(f.id)} onOpen={onNavigate ? () => onNavigate("finance", { subtab: "funds", fundId: f.id }) : undefined} data-record-link="fund">{f.name}</RecordLink> : f.name}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif" }}>{fmt(parseFloat(f.balance) || 0)}</div>
              <div style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>{f.restricted ? "Restricted" : "Unrestricted"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── BUILD-88b B.1 — DEPOSITS ───────────────────────────────────────────────
// The weekly slip, and the record of the ones already recorded. A deposit is
// ONE act — a slip that footed — so it is one row here, and one thing to undo.
function DepositsView({ isReadOnly, roTip }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [today, setToday] = useState("");
  const [err, setErr] = useState("");
  const load = () => {
    apiFetch("/imports").then(r => setRows((r.imports || []).filter(i => i.shape === "deposit")))
      .catch(e => { setRows([]); setErr(errorMessage(e, "Could not load your deposits.")); });
    apiFetch("/dashboard/home?scope=mine").then(r => setToday(r?.today || "")).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const th = { fontSize: 10.5, fontWeight: 700, color: T.ink3, textAlign: "left", padding: "0 12px 8px 0" };
  const td = { fontSize: 13, color: T.ink, padding: "10px 12px 10px 0", borderTop: "1px solid " + T.bg3 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 560, fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>
          A bank slip, in one pass. Paste its lines and Steward places what it can stand behind, asks about the
          rest, and refuses to record the deposit until the cents add up. Nothing is sent.
        </div>
        <button onClick={() => !isReadOnly && setOpen(true)} disabled={isReadOnly} title={roTip} data-testid="add-a-deposit"
          style={{ background: isReadOnly ? T.bg2 : T.greenDk, border: "none", borderRadius: 10, padding: "10px 18px", color: T.white, fontSize: 13, fontWeight: 700, cursor: isReadOnly ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
          Add a deposit
        </button>
      </div>
      {err && <div role="alert" style={{ fontSize: 12.5, color: T.terra700 }}>{err}</div>}
      {rows === null && <div style={{ fontSize: 13, color: T.ink3 }}>Loading…</div>}
      {rows && rows.length === 0 && (
        <EmptyState title="No deposits yet" message="The first slip you record appears here, with its own total and what it placed." />
      )}
      {rows && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table data-testid="deposits-table" style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
            <thead><tr>
              <th style={th}>Deposit</th><th style={th}>Date</th><th style={th}>Who</th>
              <th style={{ ...th, textAlign: "right" }}>Lines</th>
              <th style={{ ...th, textAlign: "right" }}>Gifts</th>
              <th style={{ ...th, textAlign: "right" }}>Total</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} data-testid="deposit-row">
                  <td style={td}>{r.name}{r.reconciled === false && <div style={{ fontSize: 11.5, color: T.terra700, marginTop: 2 }}>Does not reconcile, open it on the Imports page.</div>}</td>
                  <td style={td}>{r.committedOn || ""}</td>
                  <td style={td}>{r.by || "Not set"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.rowsIn}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.giftsCreated}</td>
                  <td style={{ ...td, textAlign: "right" }}>{fmtFull(r.dollarsCreated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <DepositSheetModal today={today} onClose={() => { setOpen(false); load(); }} />}
    </div>
  );
}

// ── BUILD-98 (switch) Part 2 — ACKNOWLEDGMENTS ─────────────────────────────
// CAPTURE-1 · THE GIFT-TO-THANKED CLOCK. One line: how long, on average, a
// gift waited between arriving and being thanked over the last 30 days. The
// number opens its gifts, slowest first.
function ThankClock() {
  const [c, setC] = useState(null);
  useEffect(() => { apiFetch("/thank-yous/clock").then(setC).catch(() => setC(null)); }, []);
  if (!c) return null;
  return (
    <div data-testid="thank-clock" style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>
      Average time from gift to thank-you, last 30 days:{" "}
      {c.days == null ? <span style={{ color: T.ink3 }}>no gifts thanked yet</span> : (
        <strong>
          <Figure variant="inline" kind="count" value={Number(c.days)} suffix={Number(c.days) === 1 ? " day" : " days"}
            label="Average time from gift to thank-you" definition={c.definition} source={{ key: c.source || "gift-to-thanked", params: {} }} figureKey="gift-to-thanked" />
        </strong>
      )}
    </div>
  );
}

// The gifts nobody has thanked, older than the org's own N days. Pick them,
// print one letter per donor (window-envelope address block), print labels,
// then mark them sent. Printing changes nothing; marking is its own press,
// because a printed letter still in the tray has not been sent.
function AcknowledgmentsView({ isReadOnly, roTip, onNavigate }) {
  const [data, setData] = useState(null);
  const [tpls, setTpls] = useState([]);
  const [tplId, setTplId] = useState("");
  const [sel, setSel] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => {
    apiFetch("/acknowledgments/backlog").then(r => { setData(r); setSel(new Set((r.gifts || []).filter(g => g.hasAddress && !g.deceased).map(g => g.id))); })
      .catch(e => setMsg(errorMessage(e, "Could not load the gifts waiting for a thank-you.")));
    apiFetch("/acknowledgments/templates").then(r => setTpls(r.templates || [])).catch(() => setTpls([]));
  };
  useEffect(() => { load(); }, []);
  const ids = [...sel];
  const body = () => JSON.stringify({ giftIds: ids, templateId: tplId || null });
  const download = async (path, name) => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch(API + path, { method: "POST", headers: { Authorization: "Bearer " + localStorage.getItem("npe_token"), "Content-Type": "application/json" }, body: body() });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || j.error || "Could not make the PDF."); }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      const skipped = Number(r.headers.get("X-Letters-Skipped") || 0);
      if (skipped) setMsg(`${skipped} could not be printed. Check the list below for why.`);
    } catch (e) { setMsg(errorMessage(e, "Could not make the PDF.")); }
    setBusy(false);
  };
  const doPreview = async () => {
    setBusy(true); setMsg("");
    try { setPreview(await apiFetch("/acknowledgments/letters/preview", { method: "POST", body: body() })); }
    catch (e) { setMsg(errorMessage(e, "Could not preview the letters.")); }
    setBusy(false);
  };
  const mark = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await apiFetch("/acknowledgments/mark", { method: "POST", body: JSON.stringify({ giftIds: ids, via: "letter" }) });
      setMsg(`${r.marked} marked as thanked by letter.`); setPreview(null); load();
    } catch (e) { setMsg(errorMessage(e, "Could not mark them.")); }
    setBusy(false);
  };
  const gifts = data?.gifts || [];
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const btn = (label, onClick, primary, testId) => (
    <button onClick={onClick} disabled={busy || !ids.length || (isReadOnly && primary)} title={isReadOnly && primary ? roTip : undefined} data-testid={testId}
      style={{ background: primary ? T.gold : T.white, border: primary ? "none" : "1px solid " + T.bg3, borderRadius: 10, padding: "9px 16px",
        color: T.ink, fontSize: 13, fontWeight: 700, cursor: busy || !ids.length ? "not-allowed" : "pointer", opacity: busy || !ids.length ? 0.55 : 1 }}>{label}</button>
  );
  if (!data) return <div style={{ padding: 32, color: T.ink3, fontSize: 13 }}>{msg || "Loading…"}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="ack-view">
      <ThankClock />
      <ThankYouDrafts testid="ack-ty-drafts" onNavigate={onNavigate} />
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, maxWidth: 620 }}>{data.sentence}</div>
        <label style={{ fontSize: 12, color: T.ink3, display: "flex", alignItems: "center", gap: 6 }}>
          Days
          <input type="number" min={0} max={365} defaultValue={data.days} data-testid="ack-days" disabled={isReadOnly}
            onBlur={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== data.days)
              apiFetch("/acknowledgments/settings", { method: "PUT", body: JSON.stringify({ backlogDays: n }) }).then(load)
                .catch(err => setMsg(errorMessage(err, "Only an administrator can change this."))); }}
            style={{ width: 60, background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 8px", fontSize: 13, color: T.ink }} />
        </label>
      </div>
      {gifts.length === 0 ? (
        <div style={{ fontSize: 13, color: T.ink }}>Every gift older than {data.days === 1 ? "a day" : `${data.days} days`} has been thanked.</div>
      ) : (<>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={tplId} onChange={e => setTplId(e.target.value)} data-testid="ack-template"
            style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: T.ink }}>
            {tpls.map(t => <option key={t.id || "builtin"} value={t.id || ""}>{t.name}</option>)}
          </select>
          {btn("Preview", doPreview, false, "ack-preview")}
          {btn("Print letters", () => download("/acknowledgments/letters/pdf", "thank-you-letters.pdf"), false, "ack-print")}
          {btn("Mailing labels", () => download("/acknowledgments/labels/pdf", "mailing-labels.pdf"), false, "ack-labels")}
          {btn("Mark as sent", mark, true, "ack-mark")}
          <span style={{ fontSize: 12, color: T.ink3 }}>{ids.length} of {gifts.length} chosen</span>
        </div>
        {msg && <div role="status" style={{ fontSize: 13, color: T.ink }}>{msg}</div>}
        <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, overflow: "hidden" }}>
          {gifts.map(g => (
            <label key={g.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", borderTop: "1px solid " + T.bg3, fontSize: 13, color: T.ink, cursor: "pointer" }}>
              <input type="checkbox" checked={sel.has(g.id)} onChange={() => toggle(g.id)} style={{ accentColor: T.greenDk }} />
              <span style={{ fontWeight: 700, minWidth: 160 }}>{g.donorId
                ? <RecordLink to={giftHref(g.donorId, g.id)} data-record-link="gift" title={`Open ${g.name}`}>{g.name}</RecordLink>
                : g.name}</span>
              <span style={{ color: T.ink3, minWidth: 90 }}>{displayDate(g.date)}</span>
              <span>{fmtFull(g.amount)}</span>
              {g.fund && <span style={{ color: T.ink3 }}>{g.fund}</span>}
              <span style={{ marginLeft: "auto", color: T.ink3, fontSize: 12 }}>
                {g.deceased ? "Marked deceased: thank the family by hand" : !g.hasAddress ? "No postal address, so no letter" : ""}
              </span>
            </label>
          ))}
        </div>
      </>)}
      {preview && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="ack-preview-list">
          {preview.skipped?.length > 0 && (
            <div style={{ fontSize: 13, color: T.ink }}>
              Not printed: {preview.skipped.map(s => `${s.name} (${s.why})`).join("; ")}.
            </div>
          )}
          {(preview.letters || []).slice(0, 3).map(l => (
            <pre key={l.donorId} style={{ whiteSpace: "pre-wrap", fontFamily: "Georgia, serif", fontSize: 13, background: T.white, border: "1px solid " + T.bg3, borderRadius: 10, padding: 16, margin: 0, color: T.ink }}>
              {l.address.join("\n") + "\n\n" + l.text}
            </pre>
          ))}
          {(preview.letters || []).length > 3 && <div style={{ fontSize: 12, color: T.ink3 }}>and {preview.letters.length - 3} more in the PDF.</div>}
        </div>
      )}
    </div>
  );
}
