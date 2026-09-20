# BLOCKED-build89c / 89e — the field names two providers would not show us

Written 20 September 2026.

## WHAT IS CONFIRMED, AND WHAT IS NOT

**Zeffy** (checked 2026-09-20 against Zeffy's published API guide):

| Confirmed | Value |
|---|---|
| Base | `https://api.zeffy.com/api/v1` |
| Auth | `Authorization: Bearer <key>` |
| Resources | payments, contacts, campaigns — **read only** |
| Paging | cursor-based, `has_more` + `next_cursor` |
| Rate limit | 100 requests/minute/key, 429 on exceed |

**TWO CORRECTIONS TO THE BRIEF**, both recorded in `sources/zeffy.js`:

1. The brief said *"Zeffy's API can record and delete payments; Steward must
   not."* **It cannot.** Zeffy's guide is explicit that the public API "gives
   you read access" and documents no create, modify or delete endpoint. The
   GET-only guard still applies and is still asserted — it is Steward's promise
   about Steward, and must not depend on a provider's endpoint list staying as
   it is — but the stated reason was wrong.
2. Paging is `next_cursor`, not `starting_after`.

**NOT confirmed**, because the interactive reference needs an account:

- the exact **field names** on a payment object (the guide names only "line
  items, refund details, buyer info, and a link to the tax receipt");
- the exact **request parameter** that carries a cursor.

**Givebutter**: the same gap, one step wider — no field-level reference was
readable at all.

## WHAT WAS BUILT INSTEAD OF A GUESS

Each adapter declares a **`FIELD_MAP`**: per contract field, the candidate
source paths in priority order. The mapper walks the declaration; it does not
read properties directly. Each suite proves **every declared candidate is
actually read** (`build89s-zeffy` §1, `build89s-stripe-givebutter` §5), so the
table is load-bearing rather than decorative.

The consequence that matters: when a real payload arrives, correcting this is
editing one table, and a wrong guess fails a named assertion rather than
arriving in production as a silently empty donor name. The cursor parameter is
one constant (`CURSOR_PARAM`).

## THE WALK THAT CLOSES IT — JONATHAN'S, BECAUSE IT NEEDS REAL ACCOUNTS

Zeffy is free, so a test organisation costs nothing:

1. Create a Zeffy test org; Settings → Integrations → API; copy the key.
2. `curl -H "Authorization: Bearer <key>" "https://api.zeffy.com/api/v1/payments?limit=2"`
   and paste ONE payment object (scrubbed) into `fixtures/sources/zeffy-payment.json`.
3. If a field name is not in the table, add it at the front of that field's
   list — one line — and the suite will confirm it.
4. Same for Givebutter if a key is available.

Until then both adapters are honest about what they know: they are in the
provider registry, they are offered on the connect screen, and every field
they read is one they were told to look for.
