// tests/lib/screens1Parts.jsx · SCREENS-1. The cases for tests/screens1-parts.test.js:
// every part SCREENS-1 moved out of Settings.jsx, DonorImport.jsx and
// Dashboard.jsx, mounted with fake data. Bundled by esbuild into one page; the
// suite calls window.__case(name) and reads what drew.
//
// A Settings card or an import step is a component, mounted with its props.
// A part of Home is a render function Dashboard calls with what it reads
// (home/HomeLater.js); `ctx` builds that argument: the names a case gives,
// a no-op for every setter and handler, an empty style for every style.
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import * as AddPhotos from "../../client/src/components/settings/AddPhotos.jsx";
import * as AuditLog from "../../client/src/components/settings/AuditLog.jsx";
import * as BccAddressCard from "../../client/src/components/settings/BccAddressCard.jsx";
import * as BoardPackRecipientsCard from "../../client/src/components/settings/BoardPackRecipientsCard.jsx";
import * as BrandingManager from "../../client/src/components/settings/BrandingManager.jsx";
import * as OrgNameCard from "../../client/src/components/settings/OrgNameCard.jsx";
import * as BringInAFile from "../../client/src/components/settings/BringInAFile.jsx";
import * as CoverFeesCard from "../../client/src/components/settings/CoverFeesCard.jsx";
import * as DpaDownload from "../../client/src/components/settings/DpaDownload.jsx";
import * as EmptyTrash from "../../client/src/components/settings/EmptyTrash.jsx";
import * as GivingLevelsCard from "../../client/src/components/settings/GivingLevelsCard.jsx";
import * as GivingPagesManager from "../../client/src/components/settings/GivingPagesManager.jsx";
import * as GivingSourcesManager from "../../client/src/components/settings/GivingSourcesManager.jsx";
import * as ImpactUpdatesManager from "../../client/src/components/settings/ImpactUpdatesManager.jsx";
import * as ImportsDrop from "../../client/src/components/settings/ImportsDrop.jsx";
import * as InvitedList from "../../client/src/components/settings/InvitedList.jsx";   // WALKB-2
import * as ViewerExports from "../../client/src/components/settings/ViewerExports.jsx";   // ACCESS-1
import * as ImportsHistory from "../../client/src/components/settings/ImportsHistory.jsx";
import * as importsWords from "../../client/src/components/settings/importsWords.js";
import * as InboundEmailCard from "../../client/src/components/settings/InboundEmailCard.jsx";
import * as MatchingEmployersCard from "../../client/src/components/settings/MatchingEmployersCard.jsx";
import * as PortalWebsiteSnippet from "../../client/src/components/settings/PortalWebsiteSnippet.jsx";
import * as ProcessingRatesCard from "../../client/src/components/settings/ProcessingRatesCard.jsx";
import * as SavedMappings from "../../client/src/components/settings/SavedMappings.jsx";
import * as settingsTabs from "../../client/src/components/settings/settingsTabs.js";
import * as StaffBoardList from "../../client/src/components/settings/StaffBoardList.jsx";
import * as TaxReceiptsManager from "../../client/src/components/settings/TaxReceiptsManager.jsx";
import * as TimezoneCard from "../../client/src/components/settings/TimezoneCard.jsx";

import * as DateQuestions from "../../client/src/components/import/DateQuestions.jsx";
import * as fields from "../../client/src/components/import/fields.js";
import * as GiftHistoryImport from "../../client/src/components/import/GiftHistoryImport.jsx";
import * as ImportDetection from "../../client/src/components/import/ImportDetection.jsx";
import * as ImportDone from "../../client/src/components/import/ImportDone.jsx";
import * as ImportHeader from "../../client/src/components/import/ImportHeader.jsx";
import * as ImportMapping from "../../client/src/components/import/ImportMapping.jsx";
import * as ImportProgress from "../../client/src/components/import/ImportProgress.jsx";
import * as ImportReader from "../../client/src/components/import/ImportReader.jsx";
import * as ImportReview from "../../client/src/components/import/ImportReview.jsx";
import * as MergeDuplicatesModal from "../../client/src/components/import/MergeDuplicatesModal.jsx";
import * as payload from "../../client/src/components/import/payload.js";
import * as reader from "../../client/src/components/import/reader.js";
import * as ThanksQuestion from "../../client/src/components/import/ThanksQuestion.jsx";
import * as SheetGuesses from "../../client/src/components/import/SheetGuesses.jsx";

import * as driftSection from "../../client/src/components/home/driftSection.jsx";
import * as goalSections from "../../client/src/components/home/goalSections.jsx";
import * as homeChips from "../../client/src/components/home/homeChips.jsx";
import * as HomeFirstLook from "../../client/src/components/home/HomeFirstLook.jsx";
import * as homeLower from "../../client/src/components/home/homeLower.jsx";
import * as homeParts from "../../client/src/components/home/homeParts.jsx";
import * as moreSections from "../../client/src/components/home/moreSections.jsx";
import * as railViews from "../../client/src/components/home/railViews.jsx";
import * as retentionSections from "../../client/src/components/home/retentionSections.jsx";
import * as sectionStack from "../../client/src/components/home/sectionStack.jsx";
import * as threadRows from "../../client/src/components/home/threadRows.jsx";
import * as threadSection from "../../client/src/components/home/threadSection.jsx";
import * as HomeLater from "../../client/src/components/home/HomeLater.js";
import * as DriftList from "../../client/src/components/home/DriftList.jsx";
import * as ReadoutPanel from "../../client/src/components/home/ReadoutPanel.jsx";
import * as homeGrid from "../../client/src/components/home/homeGrid.js";
import * as Insights from "../../client/src/components/Insights.jsx";

const noop = () => {};
// What Dashboard hands a part of Home: the names given, then a no-op for every
// handler and an empty style for every style; anything else is not there.
const HANDLER = /^(set|on|load|open|close|go|submit|propose|move|toggle|save|enter|cancel|reset|do|start|handle|apply|ty[A-Z]|agentAsk|finishRow|threadClause|railBack|railRow|foldBtn)/;
const STYLE = /^(s[A-Z]\w*|cPad|inp|rowPad)$/;
function ctx(given = {}) {
  return new Proxy(given, { get: (t, k) => (k in t ? t[k] : typeof k !== "string" ? undefined : HANDLER.test(k) ? noop : STYLE.test(k) ? {} : undefined), has: () => true });
}
const wrap = { cardWrap: { background: "#FFFFFF" }, onPanel: true, surface: "home" };
const person = { id: "d_fake1", name: "Marisol Quentin", email: "marisol@example.org" };

// [name, () => element]. Each draws one part with fake data; `text` is what it must show.
export const CASES = [
  // ── Settings' cards ───────────────────────────────────────────────────
  ["settings/AddPhotos", () => <AddPhotos.AddPhotos isReadOnly={false}/>, /Add photos[\s\S]*headshots/],
  ["settings/AuditLog", () => <AuditLog.AuditRowDetail row={{ id: "a1", action: "update", entity: "donor", changes: { name: { from: "Marisol Q", to: "Marisol Quentin" } }, created_at: "2026-10-30T15:00:00Z", actor_name: "Allie Test" }}/>, /name:[\s\S]*Marisol Quentin/],
  ["settings/BccAddressCard", () => <BccAddressCard.BccAddressCard/>, /Logging email by BCC/],
  ["settings/BoardPackRecipientsCard", () => <BoardPackRecipientsCard.BoardPackRecipientsCard orgId="org_fake" isAdmin isReadOnly={false} onNavigate={noop}/>, /Who gets the board pack/],
  ["settings/OrgNameCard", () => <OrgNameCard.OrgNameCard org={{ id: "org_fake", name: "Larkspur Tide Alliance" }} isAdmin isReadOnly={false} onSaved={noop}/>, /Larkspur Tide Alliance[\s\S]*Edit name/],
  ["settings/BrandingManager", () => <BrandingManager.BrandingManager orgId="org_fake" isAdmin isReadOnly={false} onSaved={noop}/>, /Brand Identity/],
  ["settings/BringInAFile", () => <BringInAFile.BringInAFile onNavigate={noop} isReadOnly={false}/>, /Bring in a file/],
  ["settings/CoverFeesCard", () => <CoverFeesCard.CoverFeesCard orgId="org_fake" isAdmin/>, /Let Donors Cover Processing Costs/],
  ["settings/DpaDownload", () => <DpaDownload.DpaDownload/>, /Download the DPA/],
  ["settings/EmptyTrash", () => <EmptyTrash.EmptyTrash isAdmin isReadOnly={false}/>, /Empty trash/],
  ["settings/GivingLevelsCard", () => <GivingLevelsCard.GivingLevelsCard isAdmin isReadOnly={false}/>, /level/i],
  ["settings/GivingPagesManager", () => <GivingPagesManager.GivingPagesManager orgSlug="fake-org" isAdmin isReadOnly={false}/>, /Giving Pages[\s\S]*New Giving Page/],
  ["settings/GivingSourcesManager", () => <GivingSourcesManager.GivingSourcesManager isReadOnly={false} isAdmin onChanged={noop}/>, /Where giving comes in/],
  ["settings/ImpactUpdatesManager", () => <ImpactUpdatesManager.ImpactUpdatesManager isAdmin isReadOnly={false}/>, /Impact Updates/],
  ["settings/InvitedList", () => <InvitedList.InvitedList isAdmin/>, /Invited[\s\S]*wren\.halloway@example\.org[\s\S]*Revoke/],
  ["settings/ViewerExports", () => <ViewerExports.ViewerExports/>, /Viewers can export/],
  ["settings/ImportsDrop", () => <ImportsDrop.ImportsDrop isReadOnly={false}><div>Bring in a spreadsheet</div></ImportsDrop.ImportsDrop>, /Bring in a spreadsheet/],
  ["settings/ImportsHistory", () => <ImportsHistory.ImportsHistory/>, /Every file you have loaded, newest first/],
  ["settings/importsWords", () => <div>{importsWords.fmtMoney(1234.5)} · {importsWords.fmtCount(1200)}</div>, /\$1,234\.50 · 1,200/],
  ["settings/InboundEmailCard", () => <InboundEmailCard.InboundEmailCard isReadOnly={false}/>, /Log an email by BCC[\s\S]*log-wrenfield@/],
  ["settings/MatchingEmployersCard", () => <MatchingEmployersCard.MatchingEmployersCard isAdmin isReadOnly={false}/>, /Employers Who Match Gifts/],
  ["settings/PortalWebsiteSnippet", () => <PortalWebsiteSnippet.PortalWebsiteSnippetCard ps={{ enabled: true, network_listed: true, org_slug: "wrenfield", display_name: "Wrenfield Commons Trust", portal_url: "https://www.stewardapp.dev/portal/wrenfield" }}/>, /See your giving with Wrenfield Commons Trust/],
  ["settings/ProcessingRatesCard", () => <ProcessingRatesCard.ProcessingRatesCard orgId="org_fake" isAdmin isReadOnly={false}/>, /How Donors Can Pay/],
  ["settings/SavedMappings", () => <SavedMappings.SavedMappings isReadOnly={false}/>, /Saved mappings[\s\S]*Gift Date/],
  ["settings/settingsTabs", () => <div>{settingsTabs.SETTINGS_TABS.map(t => t.label).join(", ")}</div>, /Organization, Team/],
  ["settings/StaffBoardList", () => <StaffBoardList.StaffBoardList onNavigate={noop}/>, /Staff and board/],
  ["settings/TaxReceiptsManager", () => <TaxReceiptsManager.TaxReceiptsManager orgId="org_fake" isAdmin isReadOnly={false}/>, /Tax Receipts/],
  ["settings/TimezoneCard", () => <TimezoneCard.TimezoneCard orgId="org_fake" isAdmin isReadOnly={false}/>, /time zone/i],

  // ── the import wizard's steps ─────────────────────────────────────────
  ["import/DateQuestions", () => <DateQuestions.MixedDatesQuestion dateConvEvidence={{ convention: "mixed", dayFirstEvidence: 12, monthFirstEvidence: 9, dayFirstExamples: ["25/03/2024"], monthFirstExamples: ["03/25/2024"], slashCells: 40 }} dateConventionChoice={null} setDateConventionChoice={noop}/>, /mixes conventions/],
  ["import/fields", () => <div>{fields.plainFieldLabel("email")}</div>, /mail/i],
  ["import/GiftHistoryImport", () => <GiftHistoryImport.GiftHistoryImport donors={[person]} onClose={noop} onImported={noop}/>, /Import Giving History/],
  ["import/ImportDetection", () => <ImportDetection.ImportDetection parsed={{ headers: ["Name", "Amount", "Date"], rows: [["Marisol Quentin", "50", "2026-10-01"]] }} effectiveShape="transaction" shapeDetail={{ shape: "transaction", confidence: "high", reasons: [] }} parseReport={null} setShapeOverride={noop}/>, /We detected: individual gifts/],
  ["import/ImportDone", () => <ImportDone.ImportDone result={{ batchErrors: [], created: 3, updated: 1, gifts: 4 }} hasBatchErrors={false} onClose={noop} onImported={noop} setResult={noop} setErr={noop} setFlaggedPage={noop} setUndoBusy={noop} flaggedPage={0} undoBusy={false}/>, /Import complete\.[\s\S]*3 donors added/],
  ["import/ImportHeader", () => <ImportHeader.ImportHeader onClose={noop}/>, /Import Donors/],
  ["import/ImportMapping", () => <ImportMapping.ImportMapping effectiveShape="transaction" TX_ROLES={[["date", "Gift date"], ["amount", "Amount"]]} txMap={{ date: "Date", amount: "Amount" }} parsed={{ headers: ["Date", "Amount"], rows: [["2026-10-01", "50"]] }} setTxMap={noop}/>, /Map gift columns/],
  ["import/ImportProgress", () => <ImportProgress.ImportReadout readout={{ headline: "312 people came in, 4 need a look.", lines: [] }}/>, /312 people came in/],
  ["import/ImportReader", () => <ImportReader.ImportReader parsed={null} xlsxSheets={null} workbook={null} bothMode={false} csvText="" setCsvText={noop} handleFile={noop} doParse={noop} err="" loading={false} moveAsked={true} setMoveAsked={noop}/>, /Choose your spreadsheet, or drag it here/],
  ["import/ImportReview", () => <ImportReview.ImportReview donorCount={3} giftCount={4} effectiveShape="transaction" err="" loading={false} cfUndecided={0} payload={{ donors: [], gifts: [] }} valueQuestions={[]} cfDecisions={{}} cfDefs={{}} valueAnswers={{}} stagePreview={{}} txMap={{}}/>, /3 donors ready · 4 gifts/],
  ["import/MergeDuplicatesModal", () => <MergeDuplicatesModal.MergeDuplicatesModal onClose={noop} onMerged={noop} isReadOnly={false}/>, /Merge Duplicates/],
  ["import/payload", () => <div>{payload.buildAutoMapping(["Email", "First Name"]).Email || "unmapped"}</div>, /^email$/],
  ["import/reader", () => <div>{typeof reader.parseFileToSheets}</div>, /function/],
  ["import/SheetGuesses", () => <><SheetGuesses.DateOrderQuestions questions={[{ id: "dateOrder:s|2", key: "s|2", sheet: "Gifts", header: "Date", text: "3/4/25: March 4 or 3 April?", hint: "1 date in Date could be read either way.", examples: [{ line: 2, raw: "3/4/25", month: "March 4, 2025", day: "3 April 2025" }], options: [{ key: "month", label: "Month first (March 4, 2025)" }, { key: "day", label: "Day first (3 April 2025)" }] }]} answers={{}} onAnswer={noop}/><SheetGuesses.GuessNotes u={{ dateGuesses: [], tidiedAmounts: { count: 1, rows: [{ sheet: "Gifts", line: 2, raw: "$75.5", shown: "$75.50" }] } }}/></>, /3\/4\/25: March 4 or 3 April\?[\s\S]*We tidied 1 amount/],
  ["import/ThanksQuestion", () => <ThanksQuestion.ThanksQuestion preview={{ ask: true, thankYous: 4, defaultAnswer: "yes", defaultSentence: "We will draft 4 thank-yous." }} answer={null} onChange={noop}/>, /already been thanked\?[\s\S]*We will draft 4 thank-yous/],

  // ── Home's parts ───────────────────────────────────────────────────────
  ["home/HomeFirstLook", () => HomeFirstLook.homeHead(ctx({ surface: "home", data: { org: { name: "Wrenfield Commons Trust" } }, greeting: "Good morning", firstName: "Allie", todayLongStr: "Monday, November 2", editMode: false, layout: [] })), /Good morning, Allie/],
  ["home/homeParts", () => <homeParts.OneLineEmpty line="No donors drifting." detail="Checked every donor with two or more gifts."/>, /No donors drifting/],
  ["home/homeChips", () => { const GoalStat = homeChips.GoalStat(); return <GoalStat label="This FY" value="$12,400"/>; }, /This FY[\s\S]*\$12,400/],
  ["home/goalSections", () => goalSections.scopeToggle(ctx({ scope: "mine", homeData: { multiOfficer: true } })), /Showing:[\s\S]*My donors[\s\S]*Whole org/],
  ["home/retentionSections", () => retentionSections.retentionPipelineSection(ctx({ ...wrap, countsByStage: { prospect: 3, active: 12, lapsed: 4 }, driftData: null, recurringHealth: null })), /Pipeline[\s\S]*Prospect/],
  ["home/driftSection", () => { const e = driftSection.driftEmptyState(ctx({ driftData: { counts: { driftingHigh: 0, lapsed: 3 }, evaluated: 40, giftedDonorCount: 40, onPattern: 37, excluded: 0 }, driftRows: [], driftHighRows: [] })); return <div>{e.head}{e.body}</div>; }, /No donors drifting[\s\S]*Checked 40 donors/],
  ["home/threadRows", () => <ul>{threadRows.threadReadoutRow(ctx({ ro: { id: "r1", title: "Your file brought in 312 people.", forDate: "2026-11-01", lines: [] } }))}</ul>, /312 people/],
  ["home/threadSection", () => threadSection.homeCrossoverCard(ctx({ surface: "home", crossover: { nextStep: { label: "Ask 6 volunteers for a first gift", why: "They already give their time." } }, onNavigate: noop })), /Ask 6 volunteers/],
  ["home/moreSections", () => moreSections.sequencesSection(ctx({ ...wrap, seqLines: [{ id: "s1", line: "Welcome series: 3 people this week" }] })), /Sequences/],
  ["home/railViews", () => railViews.railListView(ctx({ L: { title: "Follow-ups", rows: [], empty: "Nothing planned." }, railBack: () => null, railRow: () => null })), /Follow-ups[\s\S]*Nothing planned/],
  ["home/sectionStack", () => { const s = sectionStack.sectionStack(ctx({ ...wrap, layout: [{ id: "thread", visible: true }], editMode: false, threadSection: <div>The thread</div>, t: x => x })); return <div>{s && s.top}{s && s.lower}</div>; }, /The thread/],
  ["home/homeLower", () => homeLower.homeLower(ctx({ surface: "home", editMode: false, wordsOffer: true, sectionStack: null, homeCrossoverCard: null })), /What do you call them/],
  // HOME-6 hotfix: Home's moves deck while the org's Insights are still being built (deck.tabs is empty) says so, never the error screen.
  ["Insights/HomeMoves preparing", () => <Insights.HomeMoves onNavigate={noop} isReadOnly={false}/>, /Your moves[\s\S]*Insights are being prepared/],
  // HOME-6: the drifting list, the readout panel and Home's grid.
  ["home/DriftList", () => <DriftList.DriftList drift={{ count: 6, people: [{ id: "d1", name: "Odessa Penwright", short: "Gave Dec 2025, nothing since", reason: "Past their usual time.", stakeCents: 50000, lastCents: 25000, lastDate: "2025-12-03" }] }} onNavigate={noop}/>, /Drifting · 6[\s\S]*Odessa Penwright[\s\S]*\$500[\s\S]*Last \$250[\s\S]*Show all 6/],
  ["home/ReadoutPanel", () => <ReadoutPanel.ReadoutPanel id="ro1" title="What your history shows" onClose={noop}/>, /What your history shows/],
  ["home/homeGrid", () => <div>{/grid-template-columns: minmax\(0, 7fr\) minmax\(300px, 3fr\)/.test(homeGrid.HOME_GRID_CSS) ? "seven to three" : "no grid"}</div>, /seven to three/],
  ["home/HomeLater", () => <div>{["threadSection", "driftSection", "sectionStack", "homeOverlays", "cardsBlock"].filter(k => typeof HomeLater[k] === "function").join(" ")}</div>, /threadSection driftSection sectionStack homeOverlays cardsBlock/],
];

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? <div data-render-error>RENDER ERROR: {String(this.state.error && this.state.error.message)}</div> : this.props.children; }
}
function Draw({ make }) { return make(); }

window.__names = CASES.map(c => c[0]);
window.__case = async name => {
  const c = CASES.find(x => x[0] === name);
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  root.render(<MemoryRouter><Boundary><Draw make={c[1]}/></Boundary></MemoryRouter>);
  await new Promise(r => setTimeout(r, 250));
  const text = document.body.innerText;   // a modal draws into the body, beside el
  const error = el.querySelector("[data-render-error]") ? text : null;
  root.unmount(); el.remove();
  return { text, error, pattern: c[2].source, flags: c[2].flags };
};
