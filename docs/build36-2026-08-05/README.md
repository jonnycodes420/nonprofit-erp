# BUILD-36 Part A — officer notification emails (real captured bytes)

- `officer-gift-email.html` / `officer-gift-email.png` — A1 — the assigned officer hears about a gift to a donor they own, branded, no unsubscribe footer.
- `task-assignment-email.html` / `task-assignment-email.png` — A2 — someone assigned the officer a task (title, donor, due, link).
- `daily-reminder-email.html` / `daily-reminder-email.png` — A3 — the daily due-today + overdue reminder (sent only when non-empty).

All three are INTERNAL staff mail: branded org header band, NO donor unsubscribe footer.
Captured from the local scratch server's Resend sink; behavior is asserted by tests/notifications.test.js.
