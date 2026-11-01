## 6 · Things only a real customer can give you

| Ask | Who | Exactly what |
|---|---|---|
| A read-only API key | **Laura** (Hooves of Hope, Zeffy) | Zeffy → Settings → Integrations → API → create a key |
| A production access token **and** which locations or item names count as donations | **Allie** (Justin's Place, Square) | Square is a point of sale; the same row shape carries a lesson fee and a gift, so nothing imports until she says which is which |
| Her real Salesforce/NPSP export | **Allie** | also answers the open NPSP question: does her org use standard soft-credit reports, or the household roll-up |
| Three real cheque photographs | anyone who consents | on a desk, ordinary light, at an angle, **one of them badly handwritten** — not scans, not three easy ones. Then `ANTHROPIC_API_KEY=… node scripts/ops/build95-cheque-drill.js a.jpg b.jpg c.jpg` and record what came back beside what was written. Until this runs, `claude/BUILD-95.md` says "reading unproven". |
| One scrubbed month each of PayPal, Venmo and Cash App activity | you | drop in `fixtures/sources/`, run `node tests/build89s-presets.test.js`; unknown headers show up as unmatched columns. Also answers whether Cash App exports CSV at all, or only PDF. |
| A real restricted Stripe key and a Givebutter key | a real org | confirms the minimum permission set, so the connect screen can stop asking for more than it needs |
| A real customer's DNS records | a founding partner | per-org sending domains (SPF/DKIM) cannot be proven without one |
| One real export each from Wranglr and VolunteerHub | any org using them | their column presets were written from published docs and have never seen a real file — same shape as the three statement exports above (BUILD-98 Part 5) |
