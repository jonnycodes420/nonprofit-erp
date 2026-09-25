import { useState, useEffect } from "react";
import { apiFetch, API } from "../api";
import { T, fmt, fmtFull, PageTitle, SectionTabs, EmptyState, GoldMoment, StartHere, interactive, Modal } from "./shared";
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

// ── Fundraising (BUILD-11) ──────────────────────────────────────────────────
// The money-moving home. Everything here reads live figures from the backend
// (/fundraising/*) — raised totals are always SUM(gifts), never a stored
// counter, so a thermometer can't drift from reality. Five-color palette:
// gold = on-track/primary, terracotta = behind, greens = neutral/positive.

const PACE_META = {
  met:      { label: "Goal reached",  color: T.gold,       bg: "#faf5e6" },
  on_track: { label: "On pace",       color: T.greenMid,   bg: "#e8f3ee" },
  behind:   { label: "Behind pace",   color: T.terracotta, bg: "#f6ece8" },
};

// Horizontal thermometer. Gold fill; the fill goes celebratory (deeper gold)
// at 100%. No goal → caller renders totals instead of this.
function Thermometer({ raised, goal, percent, rawPercent, over, paceState, big }) {
  const pct = percent == null ? 0 : percent;         // bar width — capped at 100
  const shown = rawPercent == null ? pct : rawPercent; // number — true, uncapped
  const met = pct >= 100;
  // An exceeded goal celebrates the overage rather than repeating "Goal reached".
  const paceLabel = paceState === "met" && over > 0 ? `Goal reached · ${fmtFull(over)} over` : PACE_META[paceState]?.label;
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: big ? 8 : 6, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: big ? 30 : 20, color: T.ink, lineHeight: 1 }}>{fmtFull(raised)}</span>
          <span style={{ fontSize: big ? 14 : 12, color: T.ink3 }}>of {fmtFull(goal)}</span>
        </div>
        <span style={{ fontSize: big ? 15 : 13, fontWeight: 800, color: met ? T.gold : T.ink2 }}>{shown}%</span>
      </div>
      <div style={{ height: big ? 14 : 9, background: T.bg3, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, height: "100%", borderRadius: 99, transition: "width 0.5s cubic-bezier(.22,1,.36,1)", background: met ? T.gold500 : T.gold600 }} />
      </div>
      {paceState && PACE_META[paceState] && (
        <div style={{ marginTop: big ? 10 : 8, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: PACE_META[paceState].color, background: PACE_META[paceState].bg, borderRadius: 99, padding: "3px 11px" }}>
          {paceState === "met" ? "✦" : paceState === "on_track" ? "↗" : "↘"} {paceLabel}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, accent, onClick, ariaLabel }) {
  return (
    <div {...interactive(onClick, { label: ariaLabel || label })}
      style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", borderLeft: `3px solid ${accent || T.bg3}`, boxShadow: T.shadow, display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3 }}>{label}</span>
      <span style={{ fontSize: 26, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif", lineHeight: 1.05, letterSpacing: "-0.02em" }}>{value}</span>
      {sub && <span style={{ fontSize: 12, color: T.ink3, lineHeight: 1.4 }}>{sub}</span>}
    </div>
  );
}

const SOURCE_BADGE = {
  online:  { label: "Online", bg: "#e8f3ee", color: T.greenMid },
  offline: { label: "Offline", bg: T.bg2, color: T.ink3 },
};

function daysLeftText(dl) {
  if (dl == null) return null;
  if (dl <= 0) return "ended";
  if (dl === 1) return "1 day left";
  return `${dl} days left`;
}

export function Fundraising({ data, isReadOnly, onNavigate, initialSection }) {
  // BUILD-57 — deep-linkable (Home's Recurring tab lands on the recurring
  // section via navigateTo("fundraising",{frSection:"recurring"})); consumed
  // on mount only, navNonce remounts like the other intent tabs.
  const [subtab, setSubtab] = useState(initialSection || "overview");
  const [overview, setOverview] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // {mode:'new'|'edit', campaign}
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

  const SUBTABS = [
    { id: "overview", label: "Overview" },
    // BUILD-88b B.1 — the deposit sheet. The brief calls this surface "Gifts";
    // no tab of that name exists, and Fundraising is where money-in lives
    // (Overview, Campaigns, Giving Pages, Recurring, Funds), so it lives here.
    { id: "deposits", label: "Deposits" },
    // BUILD-98 (switch) Part 2 — the gifts nobody has thanked, and the letters.
    { id: "acknowledgments", label: "Acknowledgments" },
    // BUILD-98 (switch) Part 4 — the donor side of an event.
    { id: "events", label: "Events" },
    // BUILD-99 Part 5 — five things a development director asks, each with its
    // definition on hover. First of the four because it is the one she opens.
    { id: "majorgifts", label: "Major gifts" },
    // BUILD-99 Part 1 — one ask to one person. The rows are BUILD-15's
    // `opportunities`, so this screen and the pipeline board's ask totals are
    // one set of rows (shared/proposalShape.js says why there is no second table).
    { id: "proposals", label: "Proposals" },
    // BUILD-99 Part 2 — a portfolio is the assignment list she already has
    // (BUILD-30), plus the target and cap she typed.
    { id: "portfolios", label: "Portfolios" },
    // BUILD-99 Part 3 — the plans the organisation keeps. Nothing in one sends.
    { id: "plans", label: "Plans" },
    { id: "campaigns", label: "Campaigns", badge: campaigns.length || undefined },
    { id: "pages", label: "Giving Pages", badge: pages.filter(p => p.status === "active").length || undefined },
    { id: "recurring", label: "Recurring Giving" },
    // BUILD-101 Part 1 — levels and the people on them. A membership payment
    // is a gift, so this screen counts people, never a second money total.
    { id: "members", label: "Members" },
    { id: "funds", label: "Funds" },
  ];

  const roTip = isReadOnly ? "Reactivate your subscription to make changes." : undefined;
  const primaryBtn = (label, onClick, disabled) => (
    <button onClick={onClick} disabled={disabled || isReadOnly} title={roTip}
      style={{ background: T.gold, border: "none", borderRadius: 10, padding: "10px 18px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: (disabled || isReadOnly) ? "not-allowed" : "pointer", opacity: (disabled || isReadOnly) ? 0.5 : 1, whiteSpace: "nowrap" }}>{label}</button>
  );

  return (
    <div className="fade-in">
      <PageTitle main="Your" accent="fundraising." />
      <SectionTabs tabs={SUBTABS} active={subtab} onSelect={setSubtab} className="finance-tabbar" />

      {loading && <div style={{ padding: 48, textAlign: "center", color: T.ink3, fontSize: 13 }}>Loading…</div>}

      {!loading && subtab === "overview" && (
        <OverviewView overview={overview} campaigns={campaigns} isReadOnly={isReadOnly}
          onNewCampaign={() => setSubtab("campaigns")} onGoto={setSubtab} onNavigate={onNavigate} primaryBtn={primaryBtn} />
      )}

      {/* BUILD-88b B.1 — DepositsView is deliberately NOT wired to Fundraising's
          own `load`. Found by the walk: reloading this page's data flips
          `loading` true, which UNMOUNTS the view and takes the "it foots"
          confirmation with it the instant the deposit lands. The list reloads
          itself. */}
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
        <EventsDesk orgSlug={orgSlug} donors={data?.donors || []} isReadOnly={isReadOnly} />
      )}

      {!loading && subtab === "acknowledgments" && (
        <AcknowledgmentsView isReadOnly={isReadOnly} roTip={roTip} />
      )}

      {!loading && subtab === "campaigns" && (
        <CampaignsView goals={overview?.goals || []} isReadOnly={isReadOnly} roTip={roTip}
          onNew={() => !isReadOnly && setModal({ mode: "new" })}
          onEdit={c => !isReadOnly && setModal({ mode: "edit", campaign: c })} />
      )}

      {!loading && subtab === "pages" && (
        <PagesView pages={pages} orgSlug={orgSlug} onNavigate={onNavigate} />
      )}

      {!loading && subtab === "recurring" && (
        <RecurringView onNavigate={onNavigate} isReadOnly={isReadOnly} />
      )}

      {!loading && subtab === "members" && (
        <MembersView isReadOnly={isReadOnly} onNavigate={onNavigate} />
      )}

      {!loading && subtab === "funds" && (
        <FundsView data={data} onNavigate={onNavigate} />
      )}

      {modal && (
        <CampaignModal mode={modal.mode} campaign={modal.campaign} campaigns={campaigns}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }} />
      )}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
// Category metadata for typed goals (BUILD-16 Part 2) — Annual / Project /
// Capital. Colors stay inside the five-color palette.
const CATEGORY_META = {
  annual: { label: "Annual", color: T.greenMid },
  project: { label: "Project", color: T.gold600 },
  capital: { label: "Capital", color: T.greenDk },
};

// An overarching (umbrella) goal is a STRUCTURE, not a category — it rolls up
// its typed children. It gets its own neutral designation everywhere so it
// never reads as a duplicate of one of its children's categories (e.g. an
// umbrella typed "annual" sitting next to a child "Annual Fund").
function CategoryBadge({ g, style }) {
  if (g.isOverarching) {
    return <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.ink2, background: T.bg2, borderRadius: 99, padding: "3px 9px", whiteSpace: "nowrap", flexShrink: 0, ...style }}>Overarching</span>;
  }
  const cat = CATEGORY_META[g.goalCategory] || CATEGORY_META.project;
  return <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: cat.color, background: cat.color + "14", borderRadius: 99, padding: "3px 9px", whiteSpace: "nowrap", flexShrink: 0, ...style }}>{cat.label}</span>;
}

function OverviewView({ overview, campaigns, onNavigate, primaryBtn, onNewCampaign, onGoto }) {
  if (!overview) return <EmptyState title="Nothing to show yet" message="Set a goal and start a campaign to see your fundraising momentum here." />;
  const { period, givingPages, rollup, goals = [] } = overview;
  const gp = givingPages;
  const topGoals = goals.filter(g => g.isTopLevel);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Goal-reached celebration — fires once per goal reaching 100% */}
      {topGoals.filter(g => (g.rolledPercent ?? g.percent) >= 100).slice(0, 1).map(g => (
        <GoldMoment key={g.id} moment={`fundraising_goal_${g.id}`} title="You reached a goal."
          line={`${g.name} — ${fmtFull(g.isOverarching ? g.rolledRaised : g.raised)} raised.`} />
      ))}

      {/* Roll-up header: total raised across active goals + combined pace.
          Degrades gracefully — no goals → a start-here signpost; one goal →
          that single goal reads as the hero via the portfolio below. */}
      {rollup ? (
        <div {...interactive(() => onGoto && onGoto("campaigns"), { label: "View campaigns", dark: true })} style={{ background: `linear-gradient(135deg,${T.green950},${T.green800})`, borderRadius: 18, padding: "26px 28px", color: T.inkInverse, position: "relative", overflow: "hidden", border: "1px solid transparent" }}>
          <div style={{ position: "absolute", right: -30, top: -30, width: 160, height: 160, borderRadius: "50%", background: "radial-gradient(circle,#c9a84c22,transparent 70%)" }} />
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#c9a84c", marginBottom: 10 }}>
            {rollup.activeGoalCount === 1 ? "Active goal" : `All active goals · ${rollup.activeGoalCount}`}
          </div>
          <RollupThermometer rollup={rollup} />
          {rollup.activeGoalCount > 1 && (
            <div style={{ marginTop: 14, fontSize: 13, color: "#a9c3b2" }}>
              Combined progress across {rollup.activeGoalCount} goals — each tracks its own gifts automatically.
            </div>
          )}
        </div>
      ) : (
        <StartHere line="Start a campaign with a goal to light up a live thermometer here — Annual funds, a Project push, a Capital campaign — each tracks every gift automatically, and they roll up into one number." actionLabel="+ Start a campaign" onAction={onNewCampaign} />
      )}

      {/* The typed goal portfolio — one card per goal, its own thermometer + pace */}
      {topGoals.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3, marginBottom: 10 }}>Your goals</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16 }}>
            {topGoals.map(g => (
              <GoalCard key={g.id} g={g} allGoals={goals} onClick={() => onGoto && onGoto("campaigns")} />
            ))}
          </div>
        </div>
      )}

      {/* Momentum stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <StatTile label={`Raised · ${overview.periodLabel}`} value={fmtFull(period.raised)}
          accent={T.gold}
          onClick={() => onNavigate && onNavigate("reports")}
          ariaLabel="View giving summary report"
          sub={period.priorRaised > 0
            ? `${period.delta >= 0 ? "↑" : "↓"} ${fmtFull(Math.abs(period.delta))} vs last period`
            : `${period.donorCount} donor${period.donorCount === 1 ? "" : "s"}`} />
        <StatTile label="Gifts this period" value={period.giftCount} accent={T.greenMid}
          onClick={() => onNavigate && onNavigate("reports")}
          ariaLabel="View gifts in reports"
          sub={`${period.donorCount} donor${period.donorCount === 1 ? "" : "s"}`} />
        <StatTile label="Active campaigns" value={overview.campaigns.activeCount} accent={T.greenDk}
          onClick={() => onGoto && onGoto("campaigns")}
          ariaLabel="View campaigns"
          sub={overview.campaigns.count > 0 ? `${fmtFull(overview.campaigns.raised)} raised across all` : "No campaigns yet"} />
        <StatTile label="Live giving pages" value={gp.count} accent={T.greenMid}
          onClick={() => onGoto && onGoto("pages")}
          ariaLabel="View giving pages"
          sub={gp.count > 0 ? `${fmtFull(gp.raised)} raised` : "None published"} />
      </div>

      {/* Two-column: top campaign + recent gifts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
        <div {...(overview.campaigns.top ? interactive(() => onGoto && onGoto("campaigns"), { label: `View campaign ${overview.campaigns.top.name}` }) : {})}
          style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 22px", boxShadow: T.shadow }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3 }}>Leading campaign</span>
            {overview.campaigns.top && <span style={{ fontSize: 12, color: T.gold600, fontWeight: 700 }}>View →</span>}
          </div>
          {overview.campaigns.top ? (
            <div>
              <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink, marginBottom: 14 }}>{overview.campaigns.top.name}</div>
              <Thermometer raised={overview.campaigns.top.raised} goal={overview.campaigns.top.goalAmount} percent={overview.campaigns.top.percent} rawPercent={overview.campaigns.top.rawPercent} over={overview.campaigns.top.over} paceState={overview.campaigns.top.paceState} />
              <div style={{ marginTop: 12, fontSize: 12, color: T.ink3 }}>
                {overview.campaigns.top.donorCount} donor{overview.campaigns.top.donorCount === 1 ? "" : "s"}
                {daysLeftText(overview.campaigns.top.daysLeft) ? ` · ${daysLeftText(overview.campaigns.top.daysLeft)}` : ""}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: T.ink3, lineHeight: 1.6, padding: "12px 0" }}>
              No campaign with a goal yet. A campaign gives a specific appeal its own thermometer and pace.
              <div style={{ marginTop: 12 }}>{primaryBtn("+ Start a campaign", onNewCampaign)}</div>
            </div>
          )}
        </div>

        <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 22px", boxShadow: T.shadow }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink3, marginBottom: 14 }}>Recent gifts</div>
          {overview.recentGifts.length === 0 ? (
            <div style={{ fontSize: 13, color: T.ink3, padding: "12px 0" }}>Gifts will appear here as they come in — from your giving pages, campaigns, and offline entries.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {overview.recentGifts.map((g, i) => {
                const b = SOURCE_BADGE[g.source] || SOURCE_BADGE.offline;
                const go = g.donorId ? () => onNavigate && onNavigate("donors", { selectDonorId: g.donorId }) : null;
                return (
                  <div key={g.id} {...interactive(go, { label: `View ${g.donorName}` })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", margin: "0 -10px", borderRadius: 8, borderTop: i === 0 ? "none" : "1px solid " + T.bg2 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.donorName}</div>
                      <div style={{ fontSize: 11, color: T.ink3 }}>{g.campaign || "General"} · {g.date}</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, background: b.bg, color: b.color, borderRadius: 99, padding: "2px 8px" }}>{b.label}</span>
                    <div style={{ fontSize: 14, fontWeight: 800, color: T.greenMid, fontFamily: "'DM Serif Display',serif" }}>{fmtFull(g.amount)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Dark roll-up thermometer — total raised across active goals vs total goal.
function RollupThermometer({ rollup }) {
  const pct = rollup.percent == null ? 0 : rollup.percent;
  const shown = rollup.rawPercent == null ? rollup.percent : rollup.rawPercent;
  const met = pct >= 100;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 30, color: T.inkInverse, lineHeight: 1 }}>{fmtFull(rollup.totalRaised)}</span>
          <span style={{ fontSize: 14, color: "#a9c3b2" }}>of {fmtFull(rollup.totalGoal)}{rollup.over > 0 ? ` · ${fmtFull(rollup.over)} over` : ""}</span>
        </div>
        {shown != null && <span style={{ fontSize: 16, fontWeight: 800, color: T.gold }}>{shown}%</span>}
      </div>
      <div style={{ height: 14, background: "#1a2e1f", borderRadius: 99, overflow: "hidden" }}>
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
  if ((g.pledged || 0) > 0) parts.push(`${fmtFull(g.pledged)} pledged`);
  if ((g.grantAwarded || 0) > 0) parts.push(`incl. ${fmtFull(g.grantAwarded)} in awarded grants`);
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
  const children = g.isOverarching ? allGoals.filter(x => g.childIds.includes(x.id)) : [];
  return (
    <div {...interactive(onClick, { label: `View ${g.name}` })}
      style={{ background: T.white, border: "1px solid " + T.bg3, borderLeft: `3px solid ${accent}`, borderRadius: 16, padding: "18px 20px", boxShadow: T.shadow, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 17, color: T.ink, lineHeight: 1.25, minWidth: 0 }}>{g.name}</div>
        <CategoryBadge g={g} />
      </div>
      <Thermometer raised={raised} goal={g.goalAmount} percent={percent} rawPercent={rawPercent} over={over} paceState={paceState} />
      {g.isOverarching ? (
        <div style={{ borderTop: "1px solid " + T.bg2, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Rolls up {g.childCount} goal{g.childCount === 1 ? "" : "s"}</div>
          {children.map(c => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: T.ink2 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
              <span style={{ color: T.ink3, flexShrink: 0 }}>{fmtFull(c.raised)} · {c.rawPercent ?? c.percent ?? 0}%</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: T.ink3, borderTop: "1px solid " + T.bg2, paddingTop: 10 }}>
          {g.donorCount} donor{g.donorCount === 1 ? "" : "s"}
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
          <span style={{ fontFamily: "'DM Serif Display',serif", fontSize: 30, color: T.inkInverse, lineHeight: 1 }}>{fmtFull(goal.currentAmount)}</span>
          <span style={{ fontSize: 14, color: "#a9c3b2" }}>of {fmtFull(goal.goalAmount)}{over > 0 ? ` · ${fmtFull(over)} over` : ""}</span>
        </div>
        <span style={{ fontSize: 16, fontWeight: 800, color: T.gold }}>{shown}%</span>
      </div>
      <div style={{ height: 14, background: "#1a2e1f", borderRadius: 99, overflow: "hidden" }}>
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
function CampaignsView({ goals, isReadOnly, roTip, onNew, onEdit }) {
  const editBtn = c => !isReadOnly ? (
    <button onClick={() => onEdit(c)} style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 10px", fontSize: 12, color: T.ink3, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>Edit</button>
  ) : null;
  const topGoals = goals.filter(g => g.isTopLevel);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <button onClick={onNew} disabled={isReadOnly} title={roTip}
          style={{ background: T.gold, border: "none", borderRadius: 10, padding: "9px 16px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: isReadOnly ? "not-allowed" : "pointer", opacity: isReadOnly ? 0.5 : 1, whiteSpace: "nowrap" }}>+ New campaign</button>
      </div>

      {goals.length === 0 ? (
        <>
          <StartHere line="A campaign is a specific ask — Spring Appeal, a capital push, a year-end drive. Give it a goal and a deadline, and Steward tracks every attributed gift toward it automatically." actionLabel="+ Start your first campaign" onAction={onNew} dismissKey="fundraising_campaigns_intro" />
          <div style={{ marginTop: 20 }}>
            <EmptyState icon="◎" title="No campaigns yet" message="Your campaigns and their thermometers will live here. Start one to see progress and pace at a glance." />
          </div>
        </>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 16 }}>
          {topGoals.map(g => (
            <CampaignCard key={g.id} g={g} allGoals={goals} editBtn={editBtn} />
          ))}
        </div>
      )}
    </div>
  );
}

// One top-level campaign card. An umbrella shows its ROLL-UP thermometer (raised
// = Σ children, pace off that total) + its children nested beneath, each still
// editable. A standalone goal shows its own SUM(gifts).
function CampaignCard({ g, allGoals, editBtn }) {
  const over = g.isOverarching;
  const children = over ? allGoals.filter(x => g.childIds.includes(x.id)) : [];
  return (
    <div style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 22px", boxShadow: T.shadow, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink, lineHeight: 1.25 }}>{g.name}</div>
            <CategoryBadge g={g} />
          </div>
          <div style={{ fontSize: 11, color: T.ink3, marginTop: 3 }}>
            {over ? `Rolls up ${g.childCount} goal${g.childCount === 1 ? "" : "s"}` : (g.lifecycle === "upcoming" ? "Upcoming" : g.lifecycle === "ended" ? "Ended" : "Active")}
            {!over && daysLeftText(g.daysLeft) && g.lifecycle === "active" ? ` · ${daysLeftText(g.daysLeft)}` : ""}
          </div>
        </div>
        {editBtn(g)}
      </div>
      {over ? (
        <Thermometer raised={g.rolledRaised} goal={g.goalAmount} percent={g.rolledPercent} rawPercent={g.rolledRawPercent} over={g.rolledOver} paceState={g.rolledPaceState} />
      ) : (
        <Thermometer raised={g.raised} goal={g.goalAmount} percent={g.percent} rawPercent={g.rawPercent} over={g.over} paceState={g.paceState} />
      )}
      {over ? (
        <div style={{ borderTop: "1px solid " + T.bg2, paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {children.map(c => {
            const cat = CATEGORY_META[c.goalCategory] || CATEGORY_META.project;
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: cat.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  </div>
                  <span style={{ fontSize: 11.5, color: T.ink3 }}>{fmtFull(c.raised)} of {fmtFull(c.goalAmount)} · {c.rawPercent ?? c.percent ?? 0}%</span>
                </div>
                {editBtn(c)}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: T.ink3, borderTop: "1px solid " + T.bg2, paddingTop: 12 }}>
          {g.donorCount} donor{g.donorCount === 1 ? "" : "s"}
          {g.endDate ? ` · closes ${String(g.endDate).slice(0, 10)}` : ""}
          {committedText(g) ? ` · ${committedText(g)}` : ""}
        </div>
      )}
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
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [dirty, setDirty] = useState(false);
  const close = () => {
    if (dirty && !window.confirm("You have unsaved changes — discard them?")) return;
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
        goalProgressPublic: goalPublic,
      };
      if (mode === "edit") await apiFetch(`/fundraising/campaigns/${campaign.id}`, { method: "PUT", body: JSON.stringify(body) });
      else await apiFetch("/fundraising/campaigns", { method: "POST", body: JSON.stringify(body) });
      onSaved();
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
              <option value="">— None (stands alone) —</option>
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
            <label style={lbl}>Donor-facing name <span style={{ color: T.ink3, fontWeight: 400 }}>(optional — defaults to the campaign name)</span></label>
            <input value={dfName} onChange={e => setDfName(e.target.value)} placeholder={name.trim() || "e.g. Steeples and Studios Campaign"} style={field} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Short description <span style={{ color: T.ink3, fontWeight: 400 }}>(shown on gifts, receipts, and the donor page)</span></label>
            <textarea value={dfDesc} onChange={e => setDfDesc(e.target.value)} rows={2} maxLength={600}
              placeholder="One or two sentences, in your own words, on what this campaign is doing." style={{ ...field, resize: "vertical" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Story <span style={{ color: T.ink3, fontWeight: 400 }}>(optional — blank line = new paragraph, "## " = heading, "- " = list)</span></label>
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
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: T.ink, cursor: "pointer" }}>
            <input type="checkbox" checked={goalPublic} onChange={e => setGoalPublic(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              <strong>Show goal progress to donors</strong>
              <span style={{ display: "block", fontSize: 12, color: T.ink3, marginTop: 2 }}>
                Off by default. When on, donors who gave to this campaign see the goal, amount raised, and percent —
                never donor counts and never anyone else's gifts.
              </span>
            </span>
          </label>
        </div>
        {err && <div style={{ fontSize: 13, color: T.terracotta, marginTop: 14 }}>{err}</div>}
      </div>
    </Modal>
  );
}

// ── Giving Pages ────────────────────────────────────────────────────────────
function PagesView({ pages, orgSlug, onNavigate }) {
  const [shareId, setShareId] = useState(null);
  const active = pages.filter(p => p.status === "active");
  if (active.length === 0) {
    return (
      <>
        <StartHere line="Giving pages are your public, shareable donate pages — one per campaign, each with its own link, QR code, and embed. Create and design them in Settings; their live progress shows up here." actionLabel="Create a giving page →" onAction={() => onNavigate && onNavigate("settings", { section: "giving" })} dismissKey="fundraising_pages_intro" />
        <div style={{ marginTop: 20 }}>
          <EmptyState title="No live giving pages" message="Publish a giving page in Settings and it will appear here with its own thermometer and share tools." />
        </div>
      </>
    );
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <button onClick={() => onNavigate && onNavigate("settings", { section: "giving" })} style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 10, padding: "9px 16px", color: T.ink2, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Manage in Settings →</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16 }}>
        {active.map(p => {
          // One goal concept: a page linked to a campaign tracks toward THAT
          // campaign — its thermometer shows the campaign's live figures, not a
          // separate page-local goal. An unlinked page keeps its own goal.
          const linked = !!p.campaign_id;
          const raised = linked ? (parseFloat(p.campaign_raised) || 0) : (parseFloat(p.raised_amount) || 0);
          const goal = linked ? (p.campaign_goal != null ? parseFloat(p.campaign_goal) : null) : (p.goal_amount != null ? parseFloat(p.goal_amount) : null);
          const pct = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : null;
          const url = orgSlug ? `${window.location.origin}/give/${orgSlug}/${p.slug}` : "";
          return (
            <div key={p.id} style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 22px", boxShadow: T.shadow, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink, lineHeight: 1.25 }}>{p.title}</div>
                {linked && p.campaign_name && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: T.gold100, color: T.gold700, border: "1px solid " + T.gold300 }}>Counts toward {p.campaign_name}</span>}
              </div>
              {goal > 0 ? (
                <Thermometer raised={raised} goal={goal} percent={pct} />
              ) : (
                <div style={{ fontSize: 15, fontWeight: 700, color: T.greenMid }}>{fmtFull(raised)} raised <span style={{ fontSize: 12, color: T.ink3, fontWeight: 400 }}>· no goal set</span></div>
              )}
              {url && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: T.greenMid, fontWeight: 700, textDecoration: "none", border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px" }}>Open ↗</a>
                  <button onClick={() => { navigator.clipboard?.writeText(url); }} style={{ fontSize: 12, color: T.ink2, fontWeight: 600, background: "none", border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>Copy link</button>
                  <button onClick={() => setShareId(shareId === p.id ? null : p.id)} style={{ fontSize: 12, color: T.ink2, fontWeight: 600, background: "none", border: "1px solid " + T.bg3, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>{shareId === p.id ? "Hide share" : "QR / embed"}</button>
                </div>
              )}
              {shareId === p.id && url && (
                <div style={{ borderTop: "1px solid " + T.bg2, paddingTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
                  <QrCodeBlock url={url} filenameBase={`giving-page-${p.slug}`} />
                  <EmbedCodeBlock url={url} />
                </div>
              )}
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
      <div style={{ background: "#fdfaf2", border: "1px solid #c9a84c55", borderLeft: "4px solid " + T.gold, borderRadius: 12, padding: "16px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <div style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.6 }}>Funds live in <strong>Finance</strong> — they're the accounting home for restricted and unrestricted money. Manage balances, targets, and restrictions there so there's one source of truth.</div>
        </div>
        <button onClick={() => onNavigate && onNavigate("finance")} style={{ background: T.gold, border: "none", borderRadius: 10, padding: "9px 16px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Open Finance → Funds</button>
      </div>
      {funds.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
          {funds.map(f => (
            <div key={f.id || f.name} style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "16px 18px", boxShadow: T.shadow, borderLeft: `3px solid ${f.restricted ? T.gold : T.greenMid}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 4 }}>{f.name}</div>
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
  const th = { fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: T.ink3, textAlign: "left", padding: "0 12px 8px 0" };
  const td = { fontSize: 13, color: T.ink, padding: "10px 12px 10px 0", borderTop: "1px solid " + T.bg3 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 560, fontSize: 13, color: T.ink3, lineHeight: 1.6 }}>
          A bank slip, in one pass. Paste its lines and Steward places what it can stand behind, asks about the
          rest, and refuses to record the deposit until the cents add up. Nothing is sent.
        </div>
        <button onClick={() => !isReadOnly && setOpen(true)} disabled={isReadOnly} title={roTip} data-testid="add-a-deposit"
          style={{ background: isReadOnly ? T.bg2 : T.greenDk, border: "none", borderRadius: 10, padding: "10px 18px", color: "#fff", fontSize: 13, fontWeight: 700, cursor: isReadOnly ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
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
                  <td style={td}>{r.name}{r.reconciled === false && <div style={{ fontSize: 11.5, color: T.terra700, marginTop: 2 }}>Does not reconcile — open it on the Imports page.</div>}</td>
                  <td style={td}>{r.committedOn || ""}</td>
                  <td style={td}>{r.by || "—"}</td>
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
// The gifts nobody has thanked, older than the org's own N days. Pick them,
// print one letter per donor (window-envelope address block), print labels,
// then mark them sent. Printing changes nothing; marking is its own press,
// because a printed letter still in the tray has not been sent.
function AcknowledgmentsView({ isReadOnly, roTip }) {
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
              <span style={{ fontWeight: 700, minWidth: 160 }}>{g.name}</span>
              <span style={{ color: T.ink3, minWidth: 90 }}>{g.date}</span>
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
