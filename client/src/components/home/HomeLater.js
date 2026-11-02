// home/HomeLater.js · SCREENS-1. Everything on Home after its first look
// (HomeFirstLook.jsx and the Today rail). Each file holds render functions
// moved verbatim out of Dashboard.jsx, which calls them from the place they
// were written, so Home renders exactly the tree it rendered as one file.
//
// It is imported with Dashboard, not loaded as its own chunk after the first
// paint. SCREENS-1 built and measured that (perf-app, Home on a phone, slow 4G):
// the first look was ready 0.16 s sooner on 27 KB less JavaScript, but Home as
// a whole was usable 0.5 s later (3.85 s on main, 4.33 s split; 4.05 s with the
// chunk preloaded), because the later half then costs one more 562 ms round
// trip. docs/history/SCREENS-1.md has the numbers.
export * from "./homeChips";
export * from "./goalSections";
export * from "./retentionSections";
export * from "./driftSection";
export * from "./threadRows";
export * from "./threadSection";
export * from "./moreSections";
export * from "./railViews";
export * from "./sectionStack";
export * from "./homeLower";
