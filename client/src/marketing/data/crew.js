// LANDING-3 · the Agent crew, the reference's CREW table.
//
// EVERY EXAMPLE WAS CHECKED AGAINST shared/agentPersonas.js, because a
// marketing page that promises more than the persona can do is a lie the
// product has to live with. Each persona's `tools` there is a SUBSET of the
// closed tool table, and three of the reference's examples asked for a tool
// its persona does not hold. Those three are corrected here and the change is
// noted on the line it affects:
//
//   Writer   holds find_people, count, draft_note and nothing else, so it
//            cannot flag, tag or open a task. It surfaces the four first-time
//            donors in the plan; it does not act on them.
//   Onboarding cannot build a journey: enrol_sequence is in
//            PERSONA_FORBIDDEN_TOOLS. It opens a thread and creates the tasks,
//            which is what open_thread and create_task actually do.
//   Data     has no tool that edits a donor field. It proposes the address
//            fixes for a person to approve; it does not make them.
//
// Nothing here widens what an agent may do. The engine refuses a plan that
// names a tool the persona does not hold, so an overclaim on this page would
// have become a step that silently never ran.
export const CREW = [
  { n: "Writer", tag: "Your voice, on a deadline", c: "emerald",
    i: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    say: "Draft thank-you letters for everyone who gave over $500 this week.",
    does: ["Finds 23 gifts since Monday", "Reads each donor's history and past letters",
      "Drafts each letter in your voice, signed by Dana",
      // corrected: Writer surfaces them, it cannot flag or task.
      "Shows you 4 first-time donors who deserve a call instead"],
    out: "23 drafts ready to review, edit and print.",
    power: ["Thank-yous within a day, not a week", "Appeals and updates from one story", "Knows who gave what, so no “Dear Friend”"] },

  { n: "Researcher", tag: "Walk in prepared", c: "brass",
    i: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    say: "Brief me on Margaret Chen before coffee tomorrow.",
    does: ["Pulls 9 years of giving and the open ask", "Reads your last meeting note and her last email",
      "Spots the August gift not yet hand-thanked", "Writes a four-line brief and three questions to ask"],
    out: "A brief on your phone the morning of the visit.",
    power: ["Briefs before every visit", "What changed since you last met", "Questions worth asking"] },

  { n: "Analyst", tag: "Answers, not charts", c: "ink",
    i: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    say: "Who gave last year but hasn't given yet this year?",
    does: ["Finds 482 donors from last year with no gift yet", "Totals what they gave last year",
      "Sorts them by amount and relationship owner", "Links every number to the people behind it"],
    out: "A plain answer, every number opening its rows, and who to call first.",
    power: ["Ask in plain words", "Every number opens to the people", "Ends with who to call"] },

  { n: "Recurring", tag: "Keeps monthly gifts alive", c: "emerald",
    i: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
    say: "Which monthly donors need attention?",
    does: ["Finds 6 failed cards and 3 expiring next month", "Spots 2 paused plans",
      "Drafts a personal note for each", "Puts the calls on Home with a name on each"],
    out: "Nine donors, nine drafted notes, before the gifts stop.",
    power: ["Failed and expiring cards", "Paused plans", "A personal note, not a dunning email"] },

  { n: "Onboarding", tag: "A first year that runs on time", c: "brass",
    i: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
    say: "Set up first-year plans for everyone new from the gala.",
    does: ["Finds 31 first-time guests and donors",
      // corrected: it opens a thread and names the steps; it cannot enrol a sequence.
      "Opens a first-year thread for each", "Names who owns every call, letter and visit",
      "Schedules step one for this week"],
    out: "31 first-year threads, every step with an owner.",
    power: ["A plan for every new donor", "A person on every step", "Toward the second gift"] },

  { n: "Data", tag: "A clean file, shown first", c: "ink",
    i: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    say: "Clean up duplicates before the year-end mailing.",
    does: ["Finds 46 likely duplicates",
      // corrected: it proposes the address fixes, it does not make them.
      "Lists 112 addresses missing a piece, with the fix for each",
      "Flags 18 bounced emails", "Shows every change before making it"],
    out: "One list to approve. One click to undo.",
    power: ["Duplicates found, never merged without you", "Addresses proposed, never changed behind you", "Every change reversible"] },
];

// The line that does not move, in the four words the engine enforces.
export const CREW_NEVER = ["sends to a donor", "moves money", "changes a gift behind your back", "acts without a person's yes"];
