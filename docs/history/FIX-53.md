## FIX-53 · Mail starts off, and only Jonathan turns it on (2026-10-27)

- **Why.** On 27 Oct a real customer file was loaded on prod, and the only thing between those donors and an automatic email was a switch someone had to remember to check.
- **What changed.** Both org switches default false (schema, every insert, the SCALE-1 load seed, which wrote TRUE). The boot step that wrote `emails_enabled = true` over a NULL is gone. New orgs store Staff mail as `false`, not NULL, so turning Donor mail on no longer carries Staff mail with it. `/email-switch` refuses to turn mail on; `/mail-switches` needs `confirm: true` to turn one on and records who and when. The console confirms with one sentence and labels each switch.
- **Not changed.** No existing org's switch, org_creo included. Billing and sign-in mail.
- **Guard.** `tests/fix53-mail-off.test.js` §4 reads every non-test `.js` file for a write of ON outside the toggle; on main it named six.
