## FIX-40 · Everything in Communications opens, and every email can be read (2026-10-15)

Before: on Audience, Analytics and Your email tool nothing opened, Overview said 0 emails sent while
Analytics said 180 (the hub summed only the six newest campaign rows, all drafts), Audience's "All Donors"
was everyone with an email (volunteers too) and its "Lapsed" read a status nothing sets (0), and Analytics
carried an unsourced "Industry avg ~20%". Now every Communications name links to the profile, every count
opens a figure source (`emails-sent`, `email-tool-gifts`, `officer-portfolio` are new), a campaign, a
sequence step and a journey email each open their page (`routes/emailsSent.js`, `EmailAsSent.jsx`), and a
donor's Emails tab lists every campaign, sequence, journey, thank-you and email-tool email they were sent.
Audience is counted on the server by `filterBySegment` (`GET /communications/audience`), and "Gone quiet" is
the Why rule. Steward does not store the filled copy of a campaign, so its page shows it filled with today's
details for one recipient and says so. The list of what was dead and where it goes is
`docs/fix-40/dead-ends.md`, checked row by row by `tests/fix40-comms-opens.test.js`, whose §guard also
fails on any plain donor name, amount or headline count on Home, Donors, a profile, Fundraising,
Communications, Reports and Finance.
