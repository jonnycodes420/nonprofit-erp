## SURVEY-1 · ask donors and volunteers, keep the answers (2026-10-02)

- **Surveys** live in Communications → Surveys. `shared/surveyShape.js` is the one definition of a
  question type, the answer validation and the privacy sentence the page prints at the top.
- **The public page** is `/survey/:orgSlug/:slug`, server-rendered in the shared public shell
  (`shared/publicPage.js`), framable, proxied by vercel.json like `/e/` and `/volunteer/`.
- **Anonymous means anonymous**, held in four places: the anonymous path never reads the personal
  link, `survey_responses` has no IP column, a CHECK refuses a person, name or email on an anonymous
  row, and the audit row is written without the IP (`req.audit.withoutIp()`, new). The test sends an
  anonymous answer carrying a valid personal link and the donor's own name and email.
- **Named answers** reach a person by a signed personal link (`surveyLinks.js`) or a matched email,
  write a `survey` line on the timeline, and count as an engagement touch (ENGAGE-1 already read them).
- **Send this survey** writes `milestone_drafts` (Drafts to review), at most 200, one per person.
- **Volunteer follow-up:** there is no per-shift thank-you that staff send. The one that exists is
  the hours-milestone thank-you draft, so the chosen volunteer survey's link rides on that.
