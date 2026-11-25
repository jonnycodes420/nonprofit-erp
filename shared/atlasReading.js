// shared/atlasReading.js · ATLAS-9 item 5. THE ONE LINE THAT SAYS READING IS OFF.
//
// Jarvis (23 Nov): ATLAS-8's line was in the Atlas dialog and nowhere else:
// "still absent from the Home Thread answer and from Settings > Atlas". The
// words live here, once. The dialog (server/atlas/rowsSteps.js readingOffLine,
// drawn by TellSteward.jsx), the Home Thread's answers (AskRail.jsx, from GET /ask/guided) and
// Settings > Atlas (AtlasSettings.jsx, a lazy chunk, imports it) all read this.
// ES module: the browser imports it and the server requires it.
// ATLAS-10 item 7 (W-1125-Atlas-T6): said in the present, so it reads true on Settings > Atlas
// (where nothing was asked) as well as over an answer; the dialog's refusal opens with it too.
export const READING_OFF = "My reading is off for this organization, so I answer from Steward's own counts only. A question they don't cover, I'll say I can't answer.";

// ATLAS-11 item 5 (Jarvis, 25 Nov: "the limited-mode disclosure appears intermittently in answers and
// is absent from the dialog header"): with AI off or unavailable, the Atlas dialog's header says this,
// one steady line, and no answer repeats it. Settings > Atlas keeps READING_OFF, the longer line.
export const LIMITED_HEADER = "Answers use templates while AI is off";
