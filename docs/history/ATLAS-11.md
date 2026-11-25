# ATLAS-11 · Atlas knows every campaign, answers in any phrasing, and keeps the conversation

25 Nov 2026. From Jarvis's mega sweep (root cause C). Each item was reproduced on staging (87433bc) as the walker
(org_stagewalk) with real clicks before it was changed; Harborlight was only read.

- **"No Annual Fund exists" while Home shows it at $1.7M.** Harborlight's goal is "Annual Fund 2026". Atlas sent the
  question to Ask, whose reader matches a campaign only when its whole name is in the question, so "annual fund" was
  left over and said back as "There's no fund, appeal or event called…". Atlas now reads campaign, appeal and fund
  names itself (`server/atlas/campaignAsk.js`) and answers with Home's own goal card (`goalCard`).
- **Lifetime in any phrasing; LYBUNT dollars.** "Rufus Tallgrass total" and "lifetime for Rufus Tallgrass" fell to the
  AI-off refusal: `givingTotal.js` read only "how much has X given". "LYBUNT dollars" and "how many LYBUNT donors … and how
  much did they give" were left-over words to the population reader. Both are read now; LYBUNT answers with the
  report's households and dollars.
- **Tell me more; the follow-up box.** After a number it said there was nothing more; after a brief it repeated the brief.
  The follow-up box only appeared after Tell me more. Now it adds only what is new, and the box is under every answer.
- **Closing erased the conversation.** The thread lived in the dialog's state. Every request was already a row naming the
  one it followed, so the conversation is that chain, read back (7 days, Start over).
- **The limited-mode line.** It rode on answers (`readingOff`) and in the refusal, never the header. It is one header line now.
- **Chips and the "1 in 4,800" rank: OPEN.** Neither label nor the rank exists in the code or git history, nor on staging's
  Atlas dialog, Ask follow-ups or Harborlight's profile (Margaret Chen). Most likely prod's older build; re-walk on prod after Ship.
- Found, not fixed (next brief): the nightly eval's `off-3` ("Add Rosa Delgado to the New donor, first year journey") gets no
  line with AI off on main as well.
