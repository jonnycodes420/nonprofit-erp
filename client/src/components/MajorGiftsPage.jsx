// ASKS-1 item 2 · THE MAJOR GIFTS PAGE (client/src/lib/majorGiftsTab.js).
// Four tabs, each the view Fundraising → Major gifts already drew, with the
// same props: the figures and the server's gates are the ones they were.
import { useEffect, useState } from "react";
import { PageTitle, SectionTabs } from "./shared";
import { PortfolioView, PlansView } from "./MajorGifts";
import { Top100View } from "./majorGifts/Top100";
import { Pipeline } from "./Pipeline";
import { tabHref } from "../lib/appUrls";
import { useUrlWriter } from "./RecordLink";
import { MG_TAB, mgView, mgShownViews, mgViewIn } from "../lib/majorGiftsTab";

// NAV-1 (menu): `views` is the org's "Major Gifts shows" list. With one view on,
// the page is that view with no tab strip; the rail still reads Major Gifts.
export function MajorGiftsPage({ isReadOnly, onNavigate, initialView, initialScope, views }) {
  const shown = mgShownViews(views);
  const [view, setViewRaw] = useState(mgViewIn(mgView(initialView), shown));
  const setView = v => setViewRaw(mgViewIn(v, shown));
  useEffect(() => { if (!shown.some(v => v.id === view)) setViewRaw(shown[0].id); }, [shown.map(v => v.id).join()]);   // eslint-disable-line react-hooks/exhaustive-deps
  const goUrl = useUrlWriter();
  // the tab on screen is in the address bar (replace: a switch is not a step Back undoes)
  useEffect(() => {
    if (!/^\/app\/majorgifts\/?$/.test(window.location.pathname)) return;
    if (new URLSearchParams(window.location.search).get("subtab") === view) return;
    goUrl(tabHref(MG_TAB, { subtab: view }), true);
  }, [view]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fade-in" data-testid="major-gifts-page">
      <PageTitle main="Major" accent="gifts." />
      {shown.length > 1 && <SectionTabs tabs={shown} active={view} onSelect={setView} className="finance-tabbar fr-tabbar" dataKey="mg-view"
        stripProps={{ "aria-label": "Major gifts" }} style={{ marginBottom: 18 }} />}
      <div data-mg-view={view}>
        {view === "top100" && <Top100View isReadOnly={isReadOnly} onNavigate={onNavigate} />}
        {view === "portfolios" && <PortfolioView isReadOnly={isReadOnly} onNavigate={onNavigate} />}
        {view === "pipeline" && <Pipeline embedded isReadOnly={isReadOnly} onNavigate={onNavigate} initialScope={initialScope} />}
        {view === "plans" && <PlansView isReadOnly={isReadOnly} />}
      </div>
    </div>
  );
}
