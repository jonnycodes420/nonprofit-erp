// client/src/components/fundraising/ThankClock.jsx · moved out of Fundraising.jsx
// unchanged (TRUTH-5, to make room for the period switch): the average time
// from a gift to its thank-you, last 30 days, on Acknowledgments.
import { useState, useEffect } from "react";
import { Figure } from "../Figure";
import { apiFetch } from "../../api";
import { T } from "../shared";

export function ThankClock() {
  const [c, setC] = useState(null);
  useEffect(() => { apiFetch("/thank-yous/clock").then(setC).catch(() => setC(null)); }, []);
  if (!c) return null;
  return (
    <div data-testid="thank-clock" style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>
      Average time from gift to thank-you, last 30 days{": "}
      {c.days == null ? <span style={{ color: T.ink3 }}>no gifts thanked yet</span> : (
        <strong>
          <Figure variant="inline" kind="count" value={Number(c.days)} suffix={Number(c.days) === 1 ? " day" : " days"}
            label="Average time from gift to thank-you" definition={c.definition} source={{ key: c.source || "gift-to-thanked", params: {} }} figureKey="gift-to-thanked" />
        </strong>
      )}
    </div>
  );
}
