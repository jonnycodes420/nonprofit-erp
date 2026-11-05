## POLISH-5 · Every sentence reads like a person wrote it (2026-11-05)

From Muse's walks (4–5 Nov) and our own checks: "emails withMarlowe", "worth$500", "$165this 12 mo.",
"$16,000.From a few donors", and a list of rough lines. One suite, `tests/polish5-sentences.test.js`, red on
main for every item (22 checks, plus 25 glued spots on the walk).

- **1 The shared cause.** The source never drops a space; the reader does. JSX `text {value}` renders two
  sibling DOM text nodes, and a reader that takes each text node on its own and trims it (the walk's page
  reader; some screen readers and translation tools work the same way) drops the space at their seam:
  `worth {money(x)}` read "worth$500", `Emails sent to {firstName}` read "toMarlowe". Two more shapes:
  a space that is a text node by itself (`{"."}{" "}`, `.{" "}` before an element, `{a} <span>`), and a
  space supplied only by CSS margin (the LYBUNT chip). `PageTitle` (`{main}{" "}`) carried it to every page.
  The fix keeps a sentence's words and their spaces in one text node (a template literal), and the sweep
  rewrote every `.{" "}` / `,{" "}` / `:{" "}` / `;{" "}` at a line end to `{". "}` (23 sites).
  The check reads each block twice, as rendered and as a node-by-node reader, and fails on a glue that only
  the second reading has: a letter or digit against `$`, a capital after a lowercase word, a period against
  the next word. Product names (iPhone, VolunteerHub, …) are allow-listed. `<strong>A.</strong> B` is not
  flagged: the space is inside a word's own node.
- **2 Money.** `wholeDollars` (shared/smartAmounts.js) for an average in the ask sentence ("last 3 averaged
  $10,833"); one gift keeps its cents. Insights' sentences use `wholeMoney` for a total inside words
  (December dollars, "less the $25,578 given since Jul 1"), with a matching fact so the number check agrees.
  The award step's amount box is `client/src/lib/amountInput.js` ("10,000.00" in, "10000.00" sent).
  The empty ledger's sentence reads whole dollars.
- **3 Dates.** `client/src/lib/orgDay.js`: a moment is read in the org's zone (`civilDayOf`); a civil date or
  a DATE column (midnight UTC) keeps its day. 27 displayed moments moved to it (Undone, sent, created,
  submitted, connected…), the timeline's meeting fallback, and a running import's `committedOn` on the
  server. Pick-a-date defaults (`toISOString()` for an input's initial value) were not displays and were
  left alone. Fiscal-year labels are LEDGER-2's.
- **4 Copy.** The profile's next move is `moveSentence` ("Visit Marlowe between …"); the closeness
  period is held to its last fact (nowrap span, the fact itself still wraps); the merge list says
  "Nothing else points…" when only hidden tables move; "That makes 7 gifts from you"; Two-factor shows
  "Checking…" until its status is read; the Tax receipts badge reads the two switches (`receiptBadge`);
  impact metrics show an example sentence (`impactExample`), not the template; P2P drops "in cents";
  "demo-file" tags and "From the demo file (BUILD-89)." notes are hidden on the profile, not deleted
  (`internalLabels.js`; Finance still reads the tag); no "about undefined" in Atlas; organisations' near
  duplicates say "the two names are a letter apart" (words only; the match is HOTFIX-RHYTHM's); the Grants
  banner is a "Log emails" link with a popover; the upgraded card thanks the header's last gift.

Found and not done (next brief): the ask sentence's "Largest gift" keeps cents when it has them (it is one
gift, so by the rule it may); other `toISOString()` date defaults for inputs (Insights, Finance, Deposit
sheet) are the UTC day after 8 PM Eastern.
