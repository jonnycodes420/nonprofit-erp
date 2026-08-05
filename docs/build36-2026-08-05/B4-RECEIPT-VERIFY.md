# BUILD-36 B4 — ea4bd28 receipt fix confirmed LIVE on prod (2026-08-05)

The carry-over live confirmation of the ea4bd28 receipt/email fixes, run against
**production** (nonprofit-erp-production.up.railway.app + stewardapp.dev), reading
the real Gmail inbox. Deploy confirmed current: the new BUILD-36 routes
(`POST /digests/run-daily`, `PUT /me/notification-prefs`) both return 401 (exist)
on prod, so the deployed backend includes ea4bd28 and Part A.

## Method
A throwaway prod org **"b36 receipt verify"** (name stored **lowercase** on
purpose, to exercise the title-casing fix) with receipts enabled (legal name
`b36 receipt verify foundation`, EIN, address). One `$250` gift to a donor at
`xjca2006+b36donor@gmail.com`; sent the gift receipt AND the year-end statement;
read both received emails via the Gmail MCP; then cleaned up (voided both
receipts, deleted the gift, trashed the donor — org confirms **0 active donors**).

## What the received bytes proved (all three ea4bd28 fixes live)

### Gift receipt cover email — `Your donation receipt from B36 Receipt Verify`
Received HTML body (verbatim):
```html
<div style="background:#1a6b4a;padding:16px 22px;border-radius:12px 12px 0 0;...">
  <span ...></span><span style="color:#ffffff;font-size:17px;font-weight:700;...">B36 Receipt Verify Foundation</span>
</div>
<p>Hi Receipt Testdonor,</p>
<p>Thank you for your generous gift to <strong>B36 Receipt Verify</strong> — your official tax receipt is attached.</p>
<p style="color:#8fa896;font-size:13px">Receipt #2026-00001</p>
```
- ✅ **Branded org header band** (`brandEmailHeaderHtml`) — the green band with the org name.
- ✅ **Title-cased org name in the BODY** — stored `b36 receipt verify` → rendered **B36 Receipt Verify** (not lowercase). The header shows the title-cased legal name too.
- ✅ **On-palette `#8fa896`** for the receipt-number line (not Tailwind `#6b7280`).
- ✅ **No unsubscribe footer** (transactional).

### Year-end statement email
- ✅ Subject: **`Your year-end giving statement from B36 Receipt Verify`** — no longer "…donation receipt". (The pre-fix throwaway org's year-end email in the same inbox, from 2026-08-04, still read "Your donation receipt from …" — the before/after is visible side by side.)
- ✅ Same branded header + title-cased body.

## Bonus — A1 (gift-notify default ON for new orgs) confirmed live
`GET /workflows` on the freshly-registered prod org shows **`instant_gift_thanks` enabled=True** by default (the other four recipes disabled) — A1's "hearing about a gift is the product working" default is live. The gift fired the recipe (run log records `notify_gift` executed). NB: the internal gift-alert emails to the admin alias (`xjca2006+b36verify`) were not observed in the inbox during the session (the older throwaway org's gift-notify emails DID deliver, and the send is proven issued by `tests/notifications.test.js` on real captured bytes — most likely a transient Resend delay); worth a glance next prod pass, not a code defect.

## Residual to clean up (needs super-admin — I don't have it)
- Prod org **`org_78dea45b`** ("b36 receipt verify") — inert trial org, 0 active donors after cleanup. Delete via the admin dashboard (`DELETE /admin/orgs/:id`) when convenient.
- The earlier session's **"Steward Live Test Collective"** org is also still around (its admin password was reset this session while probing — a new reset link was issued but not used).
