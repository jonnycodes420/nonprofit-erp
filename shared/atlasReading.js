// shared/atlasReading.js · ATLAS-9 item 5. THE ONE LINE THAT SAYS READING IS OFF.
//
// Jarvis (23 Nov): ATLAS-8's line was in the Atlas dialog and nowhere else:
// "still absent from the Home Thread answer and from Settings > Atlas". The
// words live here, once. The dialog (server/atlas/rowsSteps.js readingOffLine,
// drawn by TellSteward.jsx), the Home Thread's answers (AskRail.jsx) and
// Settings > Atlas (AtlasSettings.jsx, from GET /atlas/status) all read this.
// ES module: the browser imports it and the server requires it.
export const READING_OFF = "My reading is off for this organization, so I answered from Steward's own counts only. A question they don't cover, I'll say I can't answer.";
