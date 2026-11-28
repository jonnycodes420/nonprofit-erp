// home/homeWeek.jsx · HOME-7 item 6. HOME, PUT TOGETHER.
//
// The work column under the header: the tabbed panel, then Major gifts and
// Planned giving side by side, then the bottom row (Recent gifts, Drift). The
// rail: setup (mid-way), then Today, Year-end so far, Thank-yous, Retention,
// Your givers and Connections, and SEND-GATE-2's mail line at its foot. One grid
// (homeGrid.js): on a phone the greeting, the five, the panel, the two cards,
// then the rail. Dashboard.jsx calls these from where it drew the old stack.
import { HomePanel, HomeBottomRow } from "./HomePanel";
import { MajorPlanned, RailCards } from "./HomeCards";

// "See all" on the Planned card opens the four-tab deck (home/WeekFive.jsx listens) at its Planned tab.
const openDeck = tab => {
  window.dispatchEvent(new CustomEvent("steward:home-deck", { detail: tab }));
  const el = document.querySelector('[data-testid="home-five"], [data-testid="home-five-all"]');
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
};

export function homeWork({ setPlanFor, auth, today, threadList, threadStat, threadsData, finishRow, setRailView, railReads, weekData, thankYouSection, onNavigate, openProfile, isReadOnly }) {
  const cards = railReads && railReads.cards;
  const drift = weekData ? weekData.drift : null;
  const seeThread = () => {
    setRailView({ kind: "list", key: "open" });
    const el = document.querySelector(".home-rail");
    if (el && el.scrollIntoView && window.innerWidth < 1100) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div data-testid="home-week" style={{ display: "flex", flexDirection: "column", gap: "var(--h-4, 24px)" }}>
      <HomePanel userId={auth && auth.user && auth.user.id} today={today} threads={threadList} threadOpen={threadsData && !threadsData.failed ? (threadStat && threadStat.open) || 0 : null}
        finishRow={finishRow} onSeeThread={seeThread} onPlan={setPlanFor ? () => setPlanFor({ donor: null }) : null} cards={cards} drift={drift} thankYouDrafts={thankYouSection} onNavigate={onNavigate} openProfile={openProfile} isReadOnly={isReadOnly} />
      <MajorPlanned cards={cards} planned={weekData ? weekData.planned : null} onNavigate={onNavigate} openProfile={openProfile} onSeePlanned={() => openDeck("planned")} />
      <HomeBottomRow cards={cards} drift={drift} openProfile={openProfile} onNavigate={onNavigate} />
    </div>
  );
}

export function homeRailMain({ railReads, OwnersCard, onNavigate, openProfile, isAdmin, isReadOnly }) {
  return <RailCards cards={railReads.cards} owners={railReads.owners} OwnersCard={OwnersCard} onNavigate={onNavigate} openProfile={openProfile} isAdmin={isAdmin} isReadOnly={isReadOnly} />;
}
