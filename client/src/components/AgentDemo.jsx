import { useState } from "react";
import { Link } from "react-router-dom";

// ── THE AGENT · INTERACTIVE NATIVE DEMO ────────────────────────────────
// A three-beat approval queue that runs entirely on React state. No
// backend, no real data, nothing written anywhere. Every number in it is
// Harborlight demo data and is labeled as such.
//
// The beats mirror the real product's approval pattern: the agent drafts,
// recommends, and explains; the visitor reviews, approves, and connects.

const CAL = "https://calendly.com/xjca2006/new-meeting";

const BEATS = [
  {
    key: "match",
    kind: "Possible donor match",
    title: "Match this $125 gift to Marisol Reed?",
    context: "The donor name is shortened on the gift record.",
    why: "A first gift sets the tone for everything after it. Getting the record right matters.",
    changed: "Matched the gift to Marisol's record and drafted the thank-you.",
    acceptLabel: "Accept",
    doneTitle: "Matched",
    doneAccepted: "The $125 gift is on Marisol's record, and the thank-you is drafted.",
    doneSkipped: "No change made. The gift stays in the review queue.",
  },
  {
    key: "drift",
    kind: "Drifting donors",
    title: "83 lapsed donors represent $286,454",
    context: "Harborlight demo data. These donors gave last year and have gone quiet.",
    why: "Lapsed donors are the cheapest dollars to win back. They already trust you.",
    changed: "Ranked every lapsed donor by what is at stake and built your call list.",
    acceptLabel: "Add to my call list",
    doneTitle: "Call list ready",
    doneAccepted: "83 donors, ranked by what is at stake. Monday morning writes itself.",
    doneSkipped: "No change made. The list stays in the review queue.",
  },
  {
    key: "draft",
    kind: "Drafted follow-up",
    title: "Thank Marisol for her first gift?",
    context: "Drafted after the gift was matched. Nothing sends without your word.",
    draft: "Dear Marisol, thank you for your first gift of $125. It is a real help, and we are grateful you thought of us. With gratitude, Dana",
    why: "The first note is the moment that decides whether there is a second gift.",
    changed: "Wrote the note in your voice and queued it for approval.",
    acceptLabel: "Approve",
    doneTitle: "Approved",
    doneAccepted: "The note goes out as approved. You said the word, the agent did the work.",
    doneSkipped: "No change made. The draft stays in the review queue.",
  },
];

export default function AgentDemo() {
  const [beat, setBeat] = useState(0);
  const [decision, setDecision] = useState(null); // "accepted" | "skipped" | null
  const [finished, setFinished] = useState(false);
  const current = BEATS[beat];

  const choose = d => setDecision(d);
  const next = () => {
    setDecision(null);
    if (beat + 1 < BEATS.length) setBeat(beat + 1);
    else setFinished(true);
  };
  const restart = () => { setBeat(0); setDecision(null); setFinished(false); };

  return (
    <div className="ad-shell" aria-label="Interactive Steward demo. Harborlight demo data.">
      <style>{`
        .ad-shell {
          overflow: hidden;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--cream);
          box-shadow: 0 20px 50px rgba(15,26,18,.09);
        }
        .ad-grid { display: grid; grid-template-columns: 205px 1fr; min-height: 560px; }
        .ad-nav { padding: 25px 18px; background: var(--ink); color: var(--cream); }
        .ad-org { margin: 0 0 27px; font-family: var(--serif); font-size: 24px; }
        .ad-nav ul { list-style: none; padding: 0; margin: 0; }
        .ad-nav li { margin-bottom: 5px; padding: 9px 11px; border-radius: 4px; color: rgba(240,237,230,.72); font-size: 13px; }
        .ad-nav li.active { background: rgba(240,237,230,.12); color: var(--white); }
        .ad-main { display: grid; grid-template-rows: auto 1fr; padding: 34px 38px 42px; }
        .ad-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
        .ad-top h3 { margin: 0 0 6px; font-family: var(--serif); font-size: 36px; }
        .ad-top p { margin: 0; color: var(--grey); font-size: 14px; }
        .ad-you { padding: 6px 9px; border: 1px solid rgba(201,168,76,.7); border-radius: 999px; color: var(--ink); font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
        .ad-progress { display: flex; gap: 6px; margin-top: 14px; }
        .ad-progress i { width: 34px; height: 4px; border-radius: 2px; background: var(--line); }
        .ad-progress i.on { background: var(--brass); }
        .ad-card {
          align-self: center;
          width: min(625px, 100%);
          margin: 30px auto 0;
          border: 1px solid var(--cream-deep);
          border-radius: 8px;
          background: var(--white);
          box-shadow: 8px 8px 0 var(--cream-deep);
        }
        .ad-head { display: flex; justify-content: space-between; gap: 14px; padding: 18px 20px; border-bottom: 1px solid var(--line); color: var(--grey); font-size: 12px; }
        .ad-body { padding: 24px 24px 18px; }
        .ad-body h4 { margin: 0 0 8px; font-size: 18px; line-height: 1.35; }
        .ad-body > p { margin-bottom: 16px; color: var(--grey); font-size: 14px; line-height: 1.55; }
        .ad-draft { margin: 0 0 16px; padding: 14px 16px; border-left: 3px solid var(--emerald); background: var(--cream); font-size: 14px; line-height: 1.6; font-style: italic; }
        .ad-explain { padding: 12px 14px; border-left: 3px solid var(--brass); background: var(--cream); font-size: 13px; line-height: 1.6; margin-bottom: 10px; }
        .ad-explain:last-of-type { margin-bottom: 0; }
        .ad-actions { display: flex; justify-content: flex-end; gap: 9px; padding: 18px 24px 22px; }
        .ad-actions button { min-width: 90px; min-height: 44px; padding: 10px 18px; border: 1px solid rgba(15,26,18,.4); border-radius: 5px; background: var(--white); font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit; }
        .ad-actions .accept { border-color: var(--emerald); background: var(--emerald); color: var(--white); }
        .ad-actions .next { border-color: var(--emerald); background: var(--emerald); color: var(--white); }
        .ad-result { display: grid; min-height: 280px; place-items: center; padding: 32px 24px; text-align: center; }
        .ad-result strong { display: block; margin-bottom: 6px; font-family: var(--serif); font-size: 26px; }
        .ad-result p { margin: 0 0 20px; color: var(--grey); font-size: 14px; line-height: 1.55; max-width: 380px; }
        .ad-demo-tag { display: inline-block; margin-top: 18px; padding: 5px 10px; border: 1px solid var(--line); border-radius: 999px; color: var(--grey); font-size: 11px; letter-spacing: .04em; }
        .ad-finish { display: grid; min-height: 340px; place-items: center; padding: 40px 24px; text-align: center; }
        .ad-finish h4 { margin: 0 0 10px; font-family: var(--serif); font-size: 30px; }
        .ad-finish > p { margin: 0 0 24px; color: var(--grey); font-size: 15px; line-height: 1.55; max-width: 420px; }
        .ad-ctas { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
        .ad-ctas a { display: inline-block; min-height: 48px; line-height: 48px; padding: 0 26px; border-radius: 8px; font-weight: 700; font-size: 15px; text-decoration: none; }
        .ad-ctas .go { background: var(--emerald); color: var(--white); }
        .ad-ctas .call { border: 1px solid rgba(15,26,18,.4); color: var(--ink); background: var(--white); }
        .ad-again { margin-top: 18px; border: 0; background: transparent; color: var(--emerald); font-weight: 700; font-size: 14px; cursor: pointer; font-family: inherit; }
        @media (max-width: 640px) {
          .ad-grid { grid-template-columns: 1fr; min-height: 0; }
          .ad-nav { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; }
          .ad-org { margin: 0; font-size: 20px; }
          .ad-nav ul { display: flex; gap: 4px; }
          .ad-nav li { margin: 0; padding: 8px 10px; }
          .ad-nav li:not(.active) { display: none; }
          .ad-main { padding: 24px 18px 30px; }
          .ad-top h3 { font-size: 28px; }
          .ad-actions { flex-direction: column; }
          .ad-actions button { width: 100%; min-height: 48px; }
        }
      `}</style>
      <div className="ad-grid">
        <aside className="ad-nav" aria-hidden="true">
          <p className="ad-org">Harborlight</p>
          <ul>
            <li>Home</li>
            <li>Donors</li>
            <li className="active">The Agent</li>
            <li>Reports</li>
          </ul>
        </aside>
        <div className="ad-main">
          <div className="ad-top">
            <div>
              <h3>Waiting for you</h3>
              <p>{finished ? "All caught up. Nice work." : `${BEATS.length - beat} item${BEATS.length - beat === 1 ? "" : "s"} need${BEATS.length - beat === 1 ? "s" : ""} your review.`}</p>
              <div className="ad-progress" aria-hidden="true">
                {BEATS.map((b, i) => <i key={b.key} className={i <= beat && (finished || decision || i < beat) ? "on" : (i === beat && !finished ? "on" : "")} />)}
              </div>
            </div>
            <span className="ad-you">You approve</span>
          </div>

          {!finished && !decision && (
            <article className="ad-card" key={current.key}>
              <div className="ad-head"><span>{current.kind}</span><span>Needs approval</span></div>
              <div className="ad-body">
                <h4>{current.title}</h4>
                <p>{current.context}</p>
                {current.draft && <p className="ad-draft">"{current.draft}"</p>}
                <p className="ad-explain"><strong>Why this matters:</strong> {current.why}</p>
                <p className="ad-explain"><strong>What Steward changed:</strong> {current.changed}</p>
              </div>
              <div className="ad-actions">
                <button type="button" onClick={() => choose("skipped")}>Skip</button>
                <button type="button" className="accept" onClick={() => choose("accepted")}>{current.acceptLabel}</button>
              </div>
            </article>
          )}

          {!finished && decision && (
            <div className="ad-card" aria-live="polite">
              <div className="ad-result">
                <div>
                  <strong>{decision === "accepted" ? current.doneTitle : "Skipped"}</strong>
                  <p>{decision === "accepted" ? current.doneAccepted : current.doneSkipped}</p>
                  <div className="ad-actions" style={{ justifyContent: "center", padding: 0 }}>
                    <button type="button" className="next" onClick={next}>
                      {beat + 1 < BEATS.length ? `Next: ${BEATS[beat + 1].kind}` : "Finish"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {finished && (
            <div className="ad-card" aria-live="polite">
              <div className="ad-finish">
                <div>
                  <h4>Want this watching your donor file?</h4>
                  <p>You just did the whole job: reviewed three items, made three calls, and the agent handled the rest.</p>
                  <div className="ad-ctas">
                    <Link className="go" to="/signup">Start now</Link>
                    <a className="call" href={CAL} target="_blank" rel="noreferrer">Book a call</a>
                  </div>
                  <button type="button" className="ad-again" onClick={restart}>Run the demo again</button>
                </div>
              </div>
            </div>
          )}

          <p style={{ textAlign: "center", margin: "18px 0 0" }}>
            <span className="ad-demo-tag">Interactive demo. Harborlight demo data. Nothing here is real.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
