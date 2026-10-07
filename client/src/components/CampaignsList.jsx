// FIX-27 Part 1 — CAMPAIGNS OPEN. The Campaigns list and the campaign's own
// page, moved out of Fundraising.jsx so the census can hold this file to
// "every number opens" (FIGURE_SOURCE_SCOPE). Every figure here is a <Figure>
// whose source (figureSources.js: goal-raised, campaign-goal, goal-progress,
// campaign-donors, pledges-open, campaign-grants) is attached by the server
// to each goal row, so the list and the page open the same rows.
//
// Before this build "opening" a campaign only scrolled its card into view and
// outlined it: the URL changed and no page ever rendered. A campaign now has
// a page at /app/fundraising?fr=campaigns&campaign=<id>, which Back leaves.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, StartHere, EmptyState } from "./shared";
import { Figure, FigureContext } from "./Figure";
import { HowDidItDo } from "./HowDidItDo";
import { AskBox } from "./AskPanel";
import { RecordLink } from "./RecordLink";
import { tabHref } from "../lib/appUrls";
import { SaveAsGroup } from "./Groups";
import { displayDate } from "../../../shared/displayDate";

export const campaignHref = id => tabHref("fundraising", { frSection: "campaigns", campaignId: id });
const listHref = () => tabHref("fundraising", { frSection: "campaigns" });

// FIX-7 Part 5 — three states, and each one shows the two shares it compared.
export const PACE_META = {
  met:      { label: "Goal reached",  color: T.gold,       bg: T.gold50 },
  ahead:    { label: "Ahead",         color: T.greenDk,    bg: T.bg2 },
  on_track: { label: "On pace",       color: T.ink,        bg: T.bg2 },
  behind:   { label: "Behind",        color: T.gold700,    bg: T.gold100 },   // FIX-2 C: behind is brass, never red
};

export function daysLeftText(dl) {
  if (dl == null) return null;
  if (dl <= 0) return "ended";
  if (dl === 1) return "1 day left";
  return `${dl} days left`;
}

export const CATEGORY_META = {
  annual: { label: "Annual", color: T.greenMid },
  project: { label: "Project", color: T.gold600 },
  capital: { label: "Capital", color: T.greenDk },
};

// An overarching (umbrella) goal is a STRUCTURE, not a category.
export function CategoryBadge({ g, style }) {
  if (g.isOverarching) {
    return <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.ink2, background: T.bg2, borderRadius: 99, padding: "3px 9px", whiteSpace: "nowrap", flexShrink: 0, ...style }}>Overarching</span>;
  }
  const cat = CATEGORY_META[g.goalCategory] || CATEGORY_META.project;
  return <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: cat.color, background: cat.color + "14", borderRadius: 99, padding: "3px 9px", whiteSpace: "nowrap", flexShrink: 0, ...style }}>{cat.label}</span>;
}

const SENT = {
  raised: "Every gift given to this goal, less any processing fee the donor covered, and every grant awarded toward it.",
  goal: "The target set on this goal's record.",
  percent: "What has been raised toward this goal, as a share of its target.",
  donors: "Each person who gave to this campaign, once, with what they gave to it in all.",
  pledged: "Every open pledge to this campaign, at what is still to come on it.",
  grants: "Every grant awarded toward this campaign.",
};

// The thermometer, every number on it a figure that opens its rows.
function CampaignThermometer({ g, big }) {
  const over = g.isOverarching;
  const s = g.sources || {};
  const raised = over ? g.rolledRaised : g.raised;
  const pct = (over ? g.rolledPercent : g.percent) ?? 0;
  const shown = over ? g.rolledRawPercent : g.rawPercent;
  const paceState = over ? g.rolledPaceState : g.paceState;
  const paceSentence = over ? g.rolledPaceSentence : g.paceSentence;
  const overBy = over ? g.rolledOver : g.over;
  const met = pct >= 100;
  const barWidth = Math.max(pct, pct > 0 ? 2 : 0) + "%";   // a bar's width, not a figure
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: big ? 8 : 6, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span data-testid="campaign-raised" style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: big ? 30 : 20, color: T.ink, lineHeight: 1 }}>
            <Figure variant="inline" kind="money" value={raised} label={`Raised · ${g.name}`} definition={SENT.raised} source={s.raised} figureKey="campaign-raised" />
          </span>
          <span style={{ fontSize: big ? 14 : 12, color: T.ink3 }}>
            of <Figure variant="inline" kind="money" value={g.goalAmount} label={`Goal · ${g.name}`} definition={SENT.goal} source={s.goal} figureKey="campaign-goal" />
          </span>
        </div>
        <span style={{ fontSize: big ? 15 : 13, fontWeight: 800, color: met ? T.gold : T.ink2 }}>
          <Figure variant="inline" kind="percent" value={shown ?? 0} label={`Progress · ${g.name}`} definition={SENT.percent} source={s.percent} figureKey="campaign-percent" />
        </span>
      </div>
      <div style={{ height: big ? 14 : 9, background: T.bg3, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: barWidth, height: "100%", borderRadius: 99, background: met ? T.gold500 : T.gold600 }} />
      </div>
      {paceState && PACE_META[paceState] && (
        <div data-testid="pace-badge" style={{ marginTop: big ? 10 : 8, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: PACE_META[paceState].color, background: PACE_META[paceState].bg, borderRadius: 99, padding: "3px 11px", flexWrap: "wrap" }}>
          {paceState === "met" ? "✦" : paceState === "behind" ? "↘" : "↗"} {PACE_META[paceState].label}
          {paceState === "met" && overBy > 0 && <span style={{ fontWeight: 400 }}>· past the goal</span>}
          {paceSentence && paceState !== "met" && <span style={{ fontWeight: 400, color: T.ink3 }}>· {paceSentence}</span>}
        </div>
      )}
    </div>
  );
}

// The line under a card: the donors, the close date, what is pledged and
// what came from grants. Each figure opens.
function CampaignFacts({ g }) {
  const s = g.sources || {};
  return (
    <span>
      <Figure variant="inline" kind="count" value={g.donorCount} label={`Donors · ${g.name}`} definition={SENT.donors} source={s.donors} figureKey="campaign-donors"
        suffix={g.donorCount === 1 ? " donor" : " donors"} />
      {g.endDate ? ` · closes ${displayDate(g.endDate)}` : ""}
      {(g.pledged || 0) > 0 && s.pledged && <> · <Figure variant="inline" kind="money" value={g.pledged} label={`Pledged · ${g.name}`} definition={SENT.pledged} source={s.pledged} figureKey="campaign-pledged" /> pledged</>}
      {(g.grantAwarded || 0) > 0 && s.grants && <> · incl. <Figure variant="inline" kind="money" value={g.grantAwarded} label={`Grants · ${g.name}`} definition={SENT.grants} source={s.grants} figureKey="campaign-grants" /> in awarded grants</>}
    </span>
  );
}

export function CampaignsView({ goals, isReadOnly, roTip, onNew, onEdit, openId, onOpenCampaign, onBack, onNavigate, templates, planPanel }) {
  const [tpl, setTpl] = useState(null);
  const loadTpl = () => apiFetch("/campaign-templates").then(setTpl).catch(() => setTpl({ templates: [] }));
  useEffect(() => { loadTpl(); }, []);
  const openPerson = id => { if (id && onNavigate) onNavigate("donors", { selectDonorId: id }); };
  const editBtn = c => !isReadOnly ? (
    <button onClick={() => onEdit(c)} style={{ background: "none", border: "1px solid " + T.bg3, borderRadius: 8, padding: "4px 10px", fontSize: 12, color: T.ink3, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>Edit</button>
  ) : null;

  const open = openId ? goals.find(g => g.id === openId) : null;
  if (openId) {
    return (
      <FigureContext.Provider value={{ openPerson }}>
        <CampaignPage g={open} id={openId} allGoals={goals} editBtn={editBtn} isReadOnly={isReadOnly} onBack={onBack} onOpenCampaign={onOpenCampaign} planPanel={planPanel} />
      </FigureContext.Provider>
    );
  }

  // FIX-22: a campaign started from a template with no goal sits at the top.
  const inList = new Set(goals.map(g => g.id));
  const started = ((tpl && tpl.templates) || []).filter(t => t.existingCampaignId && !inList.has(t.existingCampaignId));
  const topGoals = goals.filter(g => g.isTopLevel);
  return (
    <FigureContext.Provider value={{ openPerson }}>
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <button onClick={onNew} disabled={isReadOnly} title={roTip}
          style={{ background: T.gold, border: "none", borderRadius: 10, padding: "9px 16px", color: T.ink, fontSize: 13, fontWeight: 700, cursor: isReadOnly ? "not-allowed" : "pointer", opacity: isReadOnly ? 0.5 : 1, whiteSpace: "nowrap" }}>+ New campaign</button>
      </div>

      {templates ? templates(tpl, loadTpl) : null}

      {started.map(t => (
        <div key={t.existingCampaignId} data-campaign-id={t.existingCampaignId} data-testid="campaign-started-from-plan"
          style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "18px 22px", marginBottom: 16,
                   display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.ink }}>{t.campaign.name}</div>
            <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 4 }}>
              Started from a plan &middot; {t.campaign.startDate} to {t.campaign.endDate} &middot; no goal set yet
            </div>
          </div>
          {editBtn({ id: t.existingCampaignId, name: t.campaign.name, startDate: t.campaign.startDate, endDate: t.campaign.endDate, goalAmount: null })}
        </div>
      ))}

      {goals.length === 0 && started.length === 0 ? (
        <>
          <StartHere line="A campaign is a specific ask: Spring Appeal, a capital push, a year-end drive. Give it a goal and a deadline, and Steward tracks every attributed gift toward it automatically." actionLabel="+ Start your first campaign" onAction={onNew} dismissKey="fundraising_campaigns_intro" />
          <div style={{ marginTop: 20 }}>
            <EmptyState icon="◎" title="No campaigns yet" message="Your campaigns and their thermometers will live here. Start one to see progress and pace at a glance." />
          </div>
        </>
      ) : (
        <div data-testid="campaign-list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(340px,100%),1fr))", gap: 16 }}>
          {topGoals.map(g => (
            <CampaignCard key={g.id} g={g} allGoals={goals} editBtn={editBtn} onOpenCampaign={onOpenCampaign} />
          ))}
        </div>
      )}
    </div>
    </FigureContext.Provider>
  );
}

// The campaign's name opens its page; a click anywhere else on the card that
// is not a figure or a button opens it too.
function CampaignCard({ g, allGoals, editBtn, onOpenCampaign }) {
  const over = g.isOverarching;
  const children = over ? allGoals.filter(x => g.childIds.includes(x.id)) : [];
  const name = (c, body) => <RecordLink to={campaignHref(c.id)} onOpen={onOpenCampaign ? () => onOpenCampaign(c.id) : undefined} data-record-link="campaign" data-testid="campaign-title">{body}</RecordLink>;
  return (
    <div data-campaign-id={g.id} data-testid="campaign-card"
      style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 22px", boxShadow: T.shadow, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 18, color: T.ink, lineHeight: 1.25 }}>{name(g, g.name)}</div>
            <CategoryBadge g={g} />
          </div>
          <div style={{ fontSize: 11, color: T.ink3, marginTop: 3 }}>
            {over ? `Rolls up ${children.length === 1 ? "one goal" : "its goals"}` : (g.lifecycle === "upcoming" ? "Upcoming" : g.lifecycle === "ended" ? "Ended" : "Active")}
            {!over && daysLeftText(g.daysLeft) && g.lifecycle === "active" ? ` · ${daysLeftText(g.daysLeft)}` : ""}
          </div>
        </div>
        {editBtn(g)}
      </div>
      <CampaignThermometer g={g} />
      {over ? (
        <div style={{ borderTop: "1px solid " + T.bg2, paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {children.map(c => {
            const cat = CATEGORY_META[c.goalCategory] || CATEGORY_META.project;
            const cs = c.sources || {};
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: cat.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name(c, c.name)}</span>
                  </div>
                  <span style={{ fontSize: 11.5, color: T.ink3 }}>
                    <Figure variant="inline" kind="money" value={c.raised} label={`Raised · ${c.name}`} definition={SENT.raised} source={cs.raised} figureKey="campaign-raised" /> of{" "}
                    <Figure variant="inline" kind="money" value={c.goalAmount} label={`Goal · ${c.name}`} definition={SENT.goal} source={cs.goal} figureKey="campaign-goal" /> ·{" "}
                    <Figure variant="inline" kind="percent" value={c.rawPercent ?? 0} label={`Progress · ${c.name}`} definition={SENT.percent} source={cs.percent} figureKey="campaign-percent" />
                  </span>
                </div>
                {editBtn(c)}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: T.ink3, borderTop: "1px solid " + T.bg2, paddingTop: 12 }}>
          <CampaignFacts g={g} />
        </div>
      )}
    </div>
  );
}

// The campaign's own page: the thermometer, who gave, how it did against the
// one a year earlier (Ask why), and its plan. Edit opens the same form.
function CampaignPage({ g, id, allGoals, editBtn, isReadOnly, onBack, onOpenCampaign, planPanel }) {
  const back = (
    <RecordLink to={listHref()} onOpen={onBack} data-testid="campaign-back" style={{ fontSize: 13, color: T.greenDk, fontWeight: 600 }}>← All campaigns</RecordLink>
  );
  if (!g) {
    return (
      <div data-testid="campaign-page" data-campaign-missing="">
        {back}
        <div style={{ marginTop: 16, fontSize: 14, color: T.ink3 }}>
          This campaign has no goal set, so it has no page of figures yet. Use Edit on the list to give it one.
        </div>
      </div>
    );
  }
  const parent = g.parentGoalId ? allGoals.find(x => x.id === g.parentGoalId) : null;
  const children = g.isOverarching ? allGoals.filter(x => g.childIds.includes(x.id)) : [];
  const s = g.sources || {};
  const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 16, padding: "20px 22px", boxShadow: T.shadow, minWidth: 0 };
  const h = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3, marginBottom: 10 };
  return (
    <div data-testid="campaign-page" data-campaign-id={g.id} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>{back}</div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 data-testid="campaign-page-title" style={{ margin: 0, fontFamily: "'DM Serif Display',serif", fontWeight: 400, fontSize: 28, color: T.ink, lineHeight: 1.15 }}>{g.name}</h2>
            <CategoryBadge g={g} />
          </div>
          <div style={{ fontSize: 13, color: T.ink3, marginTop: 6 }}>
            {g.lifecycle === "upcoming" ? "Upcoming" : g.lifecycle === "ended" ? "Ended" : "Active"}
            {g.startDate ? ` · ${displayDate(g.startDate)}` : ""}{g.endDate ? ` to ${displayDate(g.endDate)}` : ""}
            {g.lifecycle === "active" && daysLeftText(g.daysLeft) ? ` · ${daysLeftText(g.daysLeft)}` : ""}
            {parent ? <> · part of <RecordLink to={campaignHref(parent.id)} onOpen={() => onOpenCampaign(parent.id)} style={{ color: T.greenDk }}>{parent.name}</RecordLink></> : null}
          </div>
        </div>
        {editBtn(g)}
      </div>

      <div style={card}>
        <CampaignThermometer g={g} big />
        {!g.isOverarching && (
          <div style={{ marginTop: 14, fontSize: 13.5, color: T.ink2 }}><CampaignFacts g={g} /></div>
        )}
        <div style={{ marginTop: 10, fontSize: 12.5, color: T.ink3 }}>
          Click the amount raised to see every gift behind it, or the donors to see who gave.
        </div>
        {/* WIRE-1: this campaign's donors as a group by rule, kept up to date. */}
        {!isReadOnly && !g.isOverarching && (
          <div style={{ marginTop: 10 }}>
            <SaveAsGroup name={`${g.name} donors`} rules={{ gaveCampaign: g.id }} label="Save these donors as a group" testid="campaign-save-group" />
          </div>
        )}
      </div>

      {/* ASK-2: the box, scoped to this campaign. */}
      <div style={card}>
        <AskBox scope={{ campaign: g.id }} isReadOnly={isReadOnly} testid="campaign-ask" label="Ask about this campaign"
          starters={["How much has it raised?", "Who gave?", "How many people gave this year?", "Why did it come in where it did?"]} />
      </div>

      {children.length > 0 && (
        <div style={card}>
          <div style={h}>The goals it rolls up</div>
          {children.map(c => (
            <div key={c.id} style={{ padding: "10px 0", borderTop: "1px solid " + T.bg2 }}>
              <RecordLink to={campaignHref(c.id)} onOpen={() => onOpenCampaign(c.id)} style={{ fontWeight: 600, color: T.ink }}>{c.name}</RecordLink>
              <div style={{ marginTop: 6 }}><CampaignThermometer g={c} /></div>
            </div>
          ))}
        </div>
      )}

      {!g.isOverarching && (
        <div style={card}>
          <HowDidItDo campaignId={g.id} isReadOnly={isReadOnly} />
        </div>
      )}

      {planPanel && !isReadOnly && (
        <div style={card}>
          <div style={h}>The plan</div>
          {planPanel(g.id || id)}
        </div>
      )}
    </div>
  );
}
