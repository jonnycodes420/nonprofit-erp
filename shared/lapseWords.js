// shared/lapseWords.js · TRUTH-5 (W-1108-Fundraising-15). ONE WORD, ONE POPULATION.
//
// "Lapsed" named two populations: Fundraising's 307 (which was LYBUNT) and
// Re-engage's 236. Each word below names exactly one, and every screen that
// shows the word shows its definition on hover (`title`), from here. The
// populations are shared/numbers' own: LYBUNT is bunt.js's rule (a gift in the
// last fiscal year and none yet in this one); Lapsed and Lost are lapseRule.js's
// two windows (last gift 12 to 24 months ago; over 24 months ago).
// ES module: the browser and the server (shared/numbers/lapseWords.js) read it.
export const LAPSE_WORDS = Object.freeze({
  lybunt: Object.freeze({ word: "LYBUNT", label: "LYBUNT: gave last year, not this year",
    definition: "LYBUNT (Last Year But Unfortunately Not This year): gave in the last fiscal year and has given nothing yet in this one." }),
  lapsed: Object.freeze({ word: "Lapsed", label: "Lapsed 12 to 24 months",
    definition: "Lapsed: no gift in 12 to 24 months, after giving before." }),
  lost: Object.freeze({ word: "Lost", label: "Lost: over 24 months",
    definition: "Lost: no gift in over 24 months, after giving before." }),
});
export const lapseWord = key => LAPSE_WORDS[key] || null;
