// Item 1 (2026-08-08) — the follow-up task badge rendered "Overdue" on a FUTURE
// due date. Root cause: the badge used daysDiff (now - due) and checked < 0, an
// inverted comparison that flags future dates as overdue (+ a UTC-midnight
// off-by-one). Pure lib test of client/src/lib/taskDue.js (dynamic-imported like
// greeting.js / money.js). No server/DB needed.
//
// THE ASSERTION THAT WOULD HAVE CAUGHT IT: a task created now with a future due
// date can NEVER render overdue. Plus the boundary cases at exactly today and
// at yesterday.

const { ok, summary } = require("./helpers");

(async () => {
  const { dueBadge, daysToDue, parseDueLocal } = await import("../client/src/lib/taskDue.js");

  // Pin "today" = Aug 8, 2026 (local midnight), the reported scenario's today.
  const TODAY = new Date(2026, 7, 8);

  // ── The exact reported bug ────────────────────────────────────────────────
  // Due Aug 14 (six days out), today Aug 8 → must be a future badge, never overdue.
  const b = dueBadge("2026-08-14", TODAY);
  ok("six-days-out due date is state=future (NOT overdue)", b.state === "future", b);
  ok("six-days-out label is 'Due Aug 14'", b.label === "Due Aug 14", b.label);
  ok("six-days-out is never state=overdue", b.state !== "overdue", b);

  // ── The would-have-caught-it invariant: a fresh task with a future due date ─
  // can NEVER render overdue, for any positive offset.
  let anyFutureOverdue = false, allFutureLabelled = true;
  for (let off = 1; off <= 400; off++) {
    const due = new Date(2026, 7, 8 + off); // Aug 8 + off days, local
    const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
    const bb = dueBadge(iso, TODAY);
    if (bb.state === "overdue") anyFutureOverdue = true;
    if (!bb.label.startsWith("Due ")) allFutureLabelled = false;
  }
  ok("NO future due date (1..400 days out) is ever overdue", anyFutureOverdue === false);
  ok("every future due date reads 'Due …'", allFutureLabelled === true);

  // ── Boundary: exactly today ───────────────────────────────────────────────
  const today = dueBadge("2026-08-08", TODAY);
  ok("due == today → state=today", today.state === "today", today);
  ok("due == today → label 'Due today'", today.label === "Due today", today.label);
  ok("due == today is NOT overdue", today.state !== "overdue");

  // ── Boundary: yesterday (strictly before today) → overdue ─────────────────
  const yest = dueBadge("2026-08-07", TODAY);
  ok("due == yesterday → state=overdue", yest.state === "overdue", yest);
  ok("due == yesterday → label 'Overdue · was due Aug 7'", yest.label === "Overdue · was due Aug 7", yest.label);

  // A week ago → overdue with the right date.
  const wk = dueBadge("2026-08-01", TODAY);
  ok("a week ago → overdue, 'Overdue · was due Aug 1'", wk.state === "overdue" && wk.label === "Overdue · was due Aug 1", wk);

  // ── Calendar-day math (not raw ms) ────────────────────────────────────────
  ok("daysToDue future = +6", daysToDue("2026-08-14", TODAY) === 6, daysToDue("2026-08-14", TODAY));
  ok("daysToDue today = 0", daysToDue("2026-08-08", TODAY) === 0);
  ok("daysToDue yesterday = -1", daysToDue("2026-08-07", TODAY) === -1);

  // ── UTC-midnight off-by-one guard: a date-only string keeps its own calendar
  // date regardless of the runner's timezone (Aug 14 stays Aug 14, not Aug 13).
  const p = parseDueLocal("2026-08-14");
  ok("parseDueLocal('2026-08-14') keeps month=Aug", p.getMonth() === 7, p.getMonth());
  ok("parseDueLocal('2026-08-14') keeps day=14 (no UTC shift)", p.getDate() === 14, p.getDate());

  // ── Empty / junk ──────────────────────────────────────────────────────────
  ok("no due → state=none, empty label", dueBadge("", TODAY).state === "none" && dueBadge(null, TODAY).state === "none");
  ok("junk due → state=none", dueBadge("not-a-date", TODAY).state === "none");

  summary();
})();
