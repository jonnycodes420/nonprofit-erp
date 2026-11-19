// ONBOARD-3 · /onboard/totals — "Does this match your old system?"
//
// After a new org's first donor file, before Home: what Steward read, year by
// year (the org's calendar or fiscal years), each figure opening its rows.
// Beside each year an optional box for the old system's figure: within $1 it
// reads Matches; otherwise the difference, with the facts that usually explain
// one, each opening its rows. Looks right sets the data-in gate, with or without
// figures typed, and never waits on a mismatch. Ask Jonathan puts the year on
// his board's "Waiting on".
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { Figure } from "../components/Figure";

const C = { ink: "#0F1A12", white: "#FFFFFF", cream: "#F0EDE6", emerald: "#0D5C3A", brass: "#C9A84C", muted: "#5a554f", line: "#ddd9d0" };
const SERIF = "'DM Serif Display',Georgia,serif";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
const withDays = s => String(s || "").replace(/(\d{4}-\d{2}-\d{2})/g, (_, d) => day(d));
const btn = (primary) => ({ background: primary ? C.emerald : "transparent", color: primary ? C.white : C.ink, border: primary ? 0 : `1px solid ${C.line}`,
  borderRadius: 8, padding: primary ? "12px 20px" : "8px 12px", fontSize: primary ? 15 : 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: 40 });

function Explain({ items }) {
  if (!items.length) return <p style={{ margin: "8px 0 0", fontSize: 13, color: C.muted }}>Steward found nothing in this year that usually explains a difference: no refunds, soft credits or unpaid pledges. Ask Jonathan and he will go through it with you.</p>;
  return <ul data-testid="totals-explain" style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.5 }}>
    {items.map(x => <li key={x.key} data-explain={x.key} style={{ marginBottom: 4 }}>
      {x.source ? <Figure variant="inline" kind="money" value={x.cents / 100} label={x.sentence.split(" (")[0]} definition={x.sentence} source={x.source} why={false} /> : null}
      {x.source ? " · " : ""}{withDays(x.sentence)}
      {x.open && x.open.kind === "import" ? <> <a href={`/imports/${encodeURIComponent(x.open.id)}/verify`} style={{ color: C.emerald, fontWeight: 700 }}>See the rows</a></> : null}
    </li>)}
  </ul>;
}

function Year({ y, always, typed, onType, result, onBlur, onAsk, asked }) {
  return <div data-testid="totals-year" data-year={y.key} style={{ borderTop: `1px solid ${C.line}`, padding: "16px 0", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
    <div style={{ flex: "1 1 300px", minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>{y.label}{y.current ? " (so far)" : ""}</div>
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "baseline", marginTop: 4 }}>
        <span data-testid="totals-year-total" style={{ fontFamily: SERIF, fontSize: 28 }}>
          <Figure variant="inline" kind="money" value={y.cents / 100} label={`Given, ${y.label}`} definition={withDays(y.sentence)} source={y.sources.total} why={false} />
        </span>
        <span style={{ fontSize: 14 }}><Figure variant="inline" kind="count" value={y.giftCount} label={`Gifts, ${y.label}`} definition={withDays(y.sentence)} source={y.sources.giftCount} why={false} /> {y.giftCount === 1 ? "gift" : "gifts"}</span>
      </div>
      <p style={{ margin: "4px 0 0", fontSize: 12.5, color: C.muted }}>{withDays(y.sentence)}</p>
    </div>
    <div style={{ flex: "1 1 240px", minWidth: 0 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
        What does your old system say? <span style={{ fontWeight: 400, color: C.muted }}>Optional</span>
        <input data-testid="totals-typed" inputMode="decimal" value={typed || ""} onChange={e => onType(e.target.value)} onBlur={onBlur}
          placeholder="$0" aria-label={`What your old system says for ${y.label}`}
          style={{ padding: "9px 11px", border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 15, fontFamily: "inherit", maxWidth: 220 }} />
      </label>
      {result ? (result.matches
        ? <div data-testid="totals-result" data-matches="1" style={{ marginTop: 8, fontWeight: 700, color: C.emerald }}>Matches ✓</div>
        : <div data-testid="totals-result" data-matches="0" style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 700, color: C.ink, borderLeft: `3px solid ${C.brass}`, paddingLeft: 8 }}>{result.words}</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>What usually explains a difference:</div>
            <Explain items={[...y.explain, ...always]} />
            {asked ? <div style={{ marginTop: 8, fontSize: 13 }} data-testid="totals-asked">{asked}</div>
              : <button type="button" data-testid="totals-ask" onClick={onAsk} style={{ ...btn(false), marginTop: 8 }}>Ask Jonathan</button>}
          </div>) : null}
    </div>
  </div>;
}

export default function TotalsCheck() {
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [typed, setTyped] = useState({});
  const [results, setResults] = useState({});
  const [asked, setAsked] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiFetch("/onboard/totals").then(setD).catch(e => setErr((e && e.message) || "Your totals could not be read. Try again in a minute.")); }, []);

  const compare = async () => {
    try {
      const r = await apiFetch("/onboard/totals/compare", { method: "POST", body: JSON.stringify({ typed }) });
      setResults(Object.fromEntries(r.rows.map(x => [x.key, x.result])));
      setErr(r.bad || "");
    } catch (e) { setErr((e && e.message) || "That figure could not be checked."); }
  };
  const ask = async key => {
    try { const r = await apiFetch("/onboard/totals/ask-jonathan", { method: "POST", body: JSON.stringify({ key, typed: typed[key] || "" }) }); setAsked(a => ({ ...a, [key]: r.sentence })); }
    catch (e) { setErr((e && e.message) || "That did not reach Jonathan. Try again."); }
  };
  const looksRight = async () => {
    setBusy(true); setErr("");
    try {
      await apiFetch("/onboard/totals/looks-right", { method: "POST", body: JSON.stringify({ typed }) });
      window.location.href = "/dashboard";
    } catch (e) { setErr((e && e.message) || "That did not save. Try again."); setBusy(false); }
  };

  const shell = children => (
    <div style={{ minHeight: "100vh", background: C.cream, color: C.ink, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px 16px 64px" }}>
        <div style={{ fontFamily: SERIF, fontSize: 22, marginBottom: 18 }}>Steward</div>
        {children}
      </div>
    </div>
  );
  if (!d) return shell(<div style={{ background: C.white, borderRadius: 12, padding: 20 }}>{err || "Reading your years…"}</div>);
  return shell(<>
    <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 32, margin: "0 0 6px" }}>Does this match your old system?</h1>
    <p style={{ margin: "0 0 4px", fontSize: 15 }}>Here is what Steward read from your file, year by year. If you have your old system's totals to hand, type one in to check it. You can skip this.</p>
    <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>{d.sentence} Click any figure to see the gifts behind it.</p>
    <div data-testid="totals-check" style={{ background: C.white, borderRadius: 12, padding: "4px 20px", marginTop: 16 }}>
      {d.years.map(y => <Year key={y.key} y={y} always={d.always} typed={typed[y.key]} result={results[y.key]} asked={asked[y.key]}
        onType={v => setTyped(t => ({ ...t, [y.key]: v }))} onBlur={compare} onAsk={() => ask(y.key)} />)}
      {!d.years.length && <p style={{ padding: "16px 0", margin: 0 }}>Steward found no dated gifts in your file yet.</p>}
    </div>
    {err ? <div role="alert" style={{ marginTop: 12, fontSize: 13.5, fontWeight: 600 }}>{err}</div> : null}
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 18 }}>
      <button type="button" data-testid="totals-looks-right" disabled={busy} onClick={looksRight} style={{ ...btn(true), opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Looks right"}</button>
      <span style={{ fontSize: 12.5, color: C.muted }}>A difference never holds you up. Press Looks right and Jonathan can look at it with you later.</span>
    </div>
    {d.lastCheck ? <p style={{ fontSize: 12.5, color: C.muted, marginTop: 14 }}>{d.lastCheck.by} said these look right on {day(String(d.lastCheck.at).slice(0, 10))}.</p> : null}
    {!d.due ? <button type="button" onClick={() => nav("/dashboard")} style={{ ...btn(false), border: 0, color: C.emerald, padding: 0, marginTop: 14, display: "block" }}>Back to Home</button> : null}
  </>);
}
