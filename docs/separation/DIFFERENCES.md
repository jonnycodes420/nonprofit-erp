# Separation — DIFFERENCES & hard-won lessons

Lessons that must survive the handover. Each is a rule that cost something.

---

## Loopback is not identity

**The rule:** a write script must verify *which application and which database*
is answering before it writes a row — not merely that the host is local.

**Why it exists.** This is the **third** time in this project a data-loss-class
event was caught by something *incidental* rather than by a guard:

1. A demo seed defaulted its target to production and silently overwrote a live
   org's theme asset (the replaced bytes were reference-count pruned — no undo).
   Recovery depended on an **incidental local copy of the bytes**, not any
   backup. (This is what BUILD-55's `prodGuard.js` was built to close.)
2. A sibling finance-fix script carried the same production default — found by
   reading the scripts, not by a guard stopping it.
3. During the Kingdom Builders separation, a demo seed pointed at
   `http://localhost:5601` wrote two demo organizations into **Steward's** scratch
   database, because a **pre-existing Steward server was already answering on that
   port**. `prodGuard`'s loopback check passed — the host *was* loopback. The
   only reason it was caught: `/health` happened to report `softDeleted:20` on a
   database that was supposed to be empty. **The tell was an incidental field, not
   a guard.**

**The flaw.** `prodGuard`'s three layers all reason about the *host* (loopback
default, `--i-know-this-is-prod` for remote, snapshot-before-overwrite). None of
them can tell whether the server on that host is *this* product or a *different*
one that merely shares the port. On one machine running two products of the same
shape — exactly what the two repos are, and exactly what the new owners will run
after handover — loopback is not identity.

**The fix (both repos).**
- `GET /health` now reports **`product`** (a constant baked into the code,
  `product.js` — never an env var) and **`database`** (`current_database()`,
  cached at boot).
- Every write path asserts both before writing:
  - **Steward:** `scripts/lib/prodGuard.js` gained `assertServerIdentity(base)`,
    called inside `writerBase` (synchronous `curl` of `/health`, so all 33
    existing callers inherit it; skipped only under `noExit`, the unit-test
    path). Refuses on wrong product, wrong database, or an unreachable/identityless
    `/health`.
  - **Kingdom Builders:** `scripts/lib/assertTarget.js`, called by `seed-demo.js`
    before the first write.
- Distinct product ids (`"steward"` vs `"kingdom-builders"`) mean a script for
  one product **cannot** write to the other's server even on a shared loopback
  port. Proven both directions: a KB seed pointed at the Steward server is
  refused ("product 'steward', not 'kingdom-builders'"), and a Steward writer
  pointed at the KB server is refused symmetrically.

**The meta-lesson.** When a data-loss-class event is caught three times by
incidentals and never by a guard, the guard is the deliverable — not another
careful habit. A near-miss that only a stray `/health` field revealed is a guard
that does not exist yet.
