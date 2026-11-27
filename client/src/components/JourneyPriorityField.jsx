// POLISH-15 item 4 (W-1127-Settings-02) · A JOURNEY'S PRIORITY, ONE RANGE.
//
// "Birthday Priority 35" was marked invalid on screen and saved anyway: the
// box had step="10", so the browser called any number off a multiple of ten
// invalid, while the server (shared/journeyShape.js validateJourney) takes
// any whole number from PRIORITY_MIN to PRIORITY_MAX. Now the box reads the
// same two constants, steps by one, and says the range under it.
import { T } from "./shared";
import { PRIORITY_MIN, PRIORITY_MAX } from "../../../shared/journeyShape.js";

export function JourneyPriorityField({ value, onChange, testid, labelStyle, inputStyle }) {
  return (
    <label style={{ display: "block" }}>
      <span style={labelStyle}>Priority against other journeys</span>
      <input data-testid={testid} type="number" min={PRIORITY_MIN} max={PRIORITY_MAX} step="1" style={inputStyle}
        value={value === undefined || value === null ? "" : value}
        onChange={e => {
          const d = parseInt(e.target.value, 10);
          onChange(Number.isInteger(d) ? Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, d)) : null);
        }} />
      <div data-testid={testid + "-range"} style={{ fontSize: 11.5, color: T.ink3, marginTop: 5, lineHeight: 1.5 }}>
        A whole number from {PRIORITY_MIN} to {PRIORITY_MAX}. The higher number goes first when somebody is in two.
      </div>
    </label>
  );
}
