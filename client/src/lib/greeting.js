// Time-of-day greeting (BUILD-36 B3, POLISH-8). JSX-free + Node-testable.
// ONE source of truth for Home's greeting.
//
// POLISH-8 (W-1109-Donors-02): the hour is the ORGANISATION'S hour, never the
// browser's, and the night has no "Good ___": Home said "Good evening, Mike"
// at 1:01 AM. Windows (org-local hour, 0–23):
//   morning   5 AM – noon   (5 .. 11)
//   afternoon noon – 5 PM   (12 .. 16)
//   evening   5 PM – 10 PM  (17 .. 21)
//   otherwise (10 PM – 5 AM) just "Hi"
export function greetingForHour(hour) {
  const h = ((Math.floor(hour) % 24) + 24) % 24; // normalize any int into 0..23
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 22) return "Good evening";
  return "Hi";
}

// The hour now in an IANA zone (the org's), 0–23.
export function hourIn(tz, at = new Date()) {
  try {
    const s = new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/New_York", hour: "numeric", hourCycle: "h23" }).format(at);
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n % 24 : at.getHours();
  } catch { return at.getHours(); }
}

// The whole line: "Good evening, Mike", or "Hi Mike" at night (no comma),
// or the bare word when there is no name.
export function greetingLine(hour, firstName) {
  const g = greetingForHour(hour);
  if (!firstName) return g;
  return g === "Hi" ? `Hi ${firstName}` : `${g}, ${firstName}`;
}
