## 8 · Prod super-admin — needs your login

- **Rotate the demo admin password.** `admin@creoarts.org` is an admin of
  `org_creo`, the org both your accounts live in, and `demo1234` is in this
  repo's git history. Sign in → Settings → Account → change password → store it
  in your password manager, not in a file here.
- **Delete three QA throwaway orgs** left by cold-run signup tests, via
  `DELETE /admin/orgs/:id` or the admin org-delete screen: `org_bcc72f98`
  (empty shell), `org_7b58bbe1` (6 imported donors), `org_72b0f60c` (6 donors,
  a $300 gift, one issued receipt, dummy EIN 00-0000000).
- **Delete the duplicate demo user `user_0a9d3327`** (Jonathan Atkinson,
  jonathan.atkinson@asbury.edu, staff) — decided 2026-08-06: keep
  `user_jonathan` (xjca2006@gmail.com, your login), delete the other. The demo
  org's Officer Portfolios legend shows "Jonathan · 0 · $0" twice until you do.
- **Walk the network review queue once** — /admin → Network Review, reject the
  waiting test application, confirm it moves to Rejected and the decision log
  records you, then delete the throwaway org.
