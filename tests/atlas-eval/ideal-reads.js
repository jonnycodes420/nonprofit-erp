// tests/atlas-eval/ideal-reads.js · AGENT-5. WHAT A PERFECT READ OF EACH REQUEST LOOKS LIKE.
//
// For the stand-in model (run.js with ATLAS_EVAL_STANDIN=1): the steps a
// correct read returns, her words only. It proves everything AFTER the read
// (names, places, dates, the two speeds, the notes) without a key; the real
// model is scored in GitHub Actions.
"use strict";
const st = o => ({ kind: "other", who: "", target: "", amount_words: "", when_words: "", how: "", words: "", draft_subject: "", draft_body: "", ...o });
module.exports = {
  1: [st({ kind: "came_to_event", who: "Undine", target: "Harbor Run", words: "Undine went to the Harbor Run event" }),
    st({ kind: "gift", who: "Undine", amount_words: "$10,000", words: "She gave $10,000" }),
    st({ kind: "add_to_journey", who: "Undine", target: "major giving", words: "Let's start the major giving journey" }),
    st({ kind: "draft_email", who: "Undine", when_words: "in the new year", words: "draft an email thanking her and requesting a meeting in the new year",
      draft_subject: "Thank you", draft_body: "Dear Undine,\n\nThank you so much for your generosity. Could we meet in January?\n\nWith gratitude," })],
  2: [st({ kind: "log_conversation", who: "Margaret", how: "lunch", words: "lunch with Margaret went well" }),
    st({ kind: "gift", who: "Margaret", amount_words: "$5000", words: "she gave $5000" }),
    st({ kind: "send_receipt", who: "Margaret", words: "send her the receipt" })],
  3: [st({ kind: "log_conversation", who: "Sam Okafor", how: "coffee", when_words: "this morning", words: "Had coffee with Sam Okafor this morning, he loved the tour of the boathouse." })],
  4: [st({ kind: "came_to_event", who: "the Halvorsens", target: "Harbor Run", when_words: "on Saturday", words: "The Halvorsens came to the Harbor Run on Saturday." })],
  5: [st({ kind: "gift", who: "Peggy", amount_words: "five grand", when_words: "last week", words: "Peggy gave five grand last week!" })],
  6: [st({ kind: "add_to_journey", who: "Tobais Fairwether", target: "new donor", words: "put Tobais Fairwether in the new donor journey" })],
  7: [st({ kind: "add_to_journey", who: "Undine Ashgrove", target: "major donors", words: "Add Undine Ashgrove to the major donors journey" })],
  8: [st({ kind: "undo", words: "undo that" })],
  9: [st({ kind: "reminder", who: "Ingrid Halvorsen", when_words: "after Thanksgiving", words: "call Ingrid Halvorsen" })],
  10: [st({ kind: "reminder", who: "Tobias", when_words: "the first week of January", words: "send Tobias the annual report" })],
  11: [st({ kind: "pledge", who: "Rosa Delgado", amount_words: "ten thousand dollars", when_words: "over two years", words: "Rosa Delgado pledged ten thousand dollars over two years" })],
  12: [st({ kind: "question", who: "Margaret Chen", target: "How much has Margaret Chen given this year?", words: "How much has Margaret Chen given this year?" }),
    st({ kind: "add_to_group", who: "Margaret Chen", target: "Board prospects", words: "add her to the Board prospects group" })],
  13: [st({ kind: "send_now", who: "Undine Ashgrove", words: "Email Undine Ashgrove a quick thank-you for volunteering and just send it, don't show me",
    draft_subject: "Thank you", draft_body: "Dear Undine,\n\nThank you for volunteering with us.\n\nWith gratitude," })],
  14: [st({ kind: "merge", who: "Henrik Halvorsen", target: "Ingrid Halvorsen", words: "Henrik and Ingrid Halvorsen are the same person, merge them" })],
  15: [st({ kind: "recurring_change", who: "Tobias Fairweather", words: "Cancel Tobias Fairweather's monthly gift" })],
  16: [st({ kind: "log_conversation", who: "Dana Whitcombe", how: "lunch", when_words: "today", words: "Lunch with Dana Whitcombe today, she's thinking about a big gift in the spring" })],
  17: [st({ kind: "log_conversation", who: "Rosa Delgado", how: "call", words: "Called Rosa Delgado." }),
    st({ kind: "personal_detail", who: "Rosa Delgado", words: "Her husband is in the hospital so she'll be slow to reply." }),
    st({ kind: "register_for_event", who: "Rosa Delgado", target: "Spring Gala", words: "She still wants to come to the Spring Gala." })],
  18: [st({ kind: "gift", who: "Wanda Whitlock", amount_words: "$250", words: "Wanda Whitlock gave $250" }),
    st({ kind: "came_to_event", who: "Wanda Whitlock", target: "Harbor Run", words: "at the Harbor Run" })],
  19: [st({ kind: "register_for_event", who: "Margaret", target: "spring gala", words: "sign Margaret up for the spring gala" })],
  20: [st({ kind: "log_conversation", who: "Henrik Halvorsen", how: "call", when_words: "Yesterday", words: "Yesterday I had a call with Henrik Halvorsen about the boat program" })],
  21: [st({ kind: "note", who: "Ingrid", words: "prefers texts over email" })],
  22: [st({ kind: "remove_from_journey", who: "Undine Fairweather", target: "major donor", words: "Take Undine Fairweather out of the major donor journey" })],
  23: [st({ kind: "log_conversation", who: "Henrik", how: "visit", when_words: "today", words: "Henrik came by the office today" }),
    st({ kind: "gift", who: "Henrik", amount_words: "$1,200", words: "gave us a check for $1,200" }),
    st({ kind: "add_to_journey", who: "Henrik", target: "new donor", words: "put him in the new donor journey" }),
    st({ kind: "reminder", who: "Henrik", when_words: "next week", words: "thank him" })],
  24: [st({ kind: "find", who: "Tobias Fairweather", words: "pull up Tobias Fairweather" })],
  25: [st({ kind: "draft_email", who: "Margaret Chen", words: "Thank Margaret Chen for her gift", draft_subject: "Thank you", draft_body: "Dear Margaret,\n\nThank you for your generous gift.\n\nWith gratitude," })],
};
