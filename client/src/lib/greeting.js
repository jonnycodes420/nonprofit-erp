// Time-of-day greeting windows (BUILD-36 B3). JSX-free + Node-testable, like
// money.js / homeLayout.js. ONE source of truth for the greeting so a
// "Good morning" can never render at 12:23 AM again.
//
// Windows (local hour, 0–23):
//   evening   5 PM – 4 AM   (>= 17 OR < 4)
//   morning   4 AM – noon    (4 .. 11)
//   afternoon noon – 5 PM    (12 .. 16)
export function greetingForHour(hour) {
  const h = ((Math.floor(hour) % 24) + 24) % 24; // normalize any int into 0..23
  if (h >= 4 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  return "Good evening";
}
