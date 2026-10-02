// The reference's TEAM list. Names and titles exactly as the reference has
// them; the portraits are the real ones the previous landing page used, never
// stock photographs.
export const TEAM = [
  ["Jonathan Atkinson", "Founder, Steward", "/landing/jonathan-atkinson.png"],
  ["Winfield Bevins", "Advisor · Executive Director, Creo Arts", "/landing/winfield-bevins.jpg"],
  ["Ross Jenkins", "Advisor · Founder, Kingdom Legacy Collective", "/landing/ross-jenkins.png"],
  ["Brad Atkinson", "Advisor · Development Director, Asbury University", "/landing/brad-atkinson.jpg"],
];

// FIX-13 · WHO THE SITE SHOWS. Jonathan is deciding between the founder
// alone and all four. The Leadership page (People in lib.jsx) renders this
// list and nothing else, so the decision is this one line:
//   all four:      export const LEADERSHIP_SHOWN = TEAM;
//   founder only:  export const LEADERSHIP_SHOWN = TEAM.slice(0, 1);
// (Founder only would also want the "advisors" sentence on /leadership, the
// homepage Leadership band and the /leadership route description reworded.)
export const LEADERSHIP_SHOWN = TEAM;
