// NUMBERS-6 · /ops, "The nightly number check". Reads GET /ops/numbers: per org,
// its problems by rule and the last 7 nights, real orgs first and orgs marked
// as a test below them. A super-admin may mark an org as a test (one flag; it
// changes no data). Orgs that share a name are grouped with what tells them
// apart. Counts only: never a person, an amount or an id beyond the org's own.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { countLabel } from "../../../../shared/countWords.js";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
const card = { background: WHITE, borderRadius: 10, padding: "18px 20px", marginBottom: 18, border: "1px solid rgba(15,26,18,0.08)" };
const says = { fontSize: 13, opacity: 0.7, margin: "0 0 12px" };
const cell = { padding: "6px 10px 6px 0", fontSize: 13, verticalAlign: "top", borderTop: `1px solid ${CREAM}` };
const head = { ...cell, fontWeight: 600, borderTop: 0 };
const link = { background: "none", border: 0, padding: 0, color: EMERALD, fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "inherit", minHeight: 24 };
const SHORT = { "donor-stored": "stored totals", "donor-first-largest-last": "First/Largest/Last", lapse: "lapsed tag", quiet: "segment",
  removed: "points at a removed gift", "giving-level": "giving level", "donor-lifetime": "Lifetime", "donor-count-average": "Average",
  "donor-this-year": "This year", "could-not-run": "the check could not run" };
const n = v => Number(v || 0).toLocaleString("en-US");

function Rules({ byRule, units }) {
  const e = Object.entries(byRule || {}).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  if (!e.length) return <span style={{ opacity: 0.6 }}>none</span>;
  return <span>{e.map(([r, c], i) => <span key={r}>{i ? " · " : ""}{n(c)} {SHORT[r] || (units && units[r]) || r}</span>)}</span>;
}

function Trend({ trend, nights }) {
  return <span title={nights.join(", ")} style={{ fontVariantNumeric: "tabular-nums" }}>
    {trend.map((v, i) => <span key={i} style={{ fontWeight: i === trend.length - 1 ? 700 : 400, opacity: v == null ? 0.4 : 1 }}>{i ? " · " : ""}{v == null ? "–" : n(v)}</span>)}
  </span>;
}

export function NumbersView({ data, error, busy, onMark, onCheck, result }) {
  if (error || !data) return <section style={card} data-testid="ops-numbers"><h2 style={{ fontSize: 17, margin: "0 0 4px" }}>The nightly number check</h2><p style={says}>{error || "Loading…"}</p></section>;
  const real = data.orgs.filter(o => !o.isTest), test = data.orgs.filter(o => o.isTest);
  const row = o => <tr key={o.id} data-testid={`ops-numbers-org-${o.id}`}>
    <td style={{ ...cell, fontWeight: 600 }}>{o.name || o.id}{o.isTest ? <span style={{ marginLeft: 6, fontSize: 11, padding: "1px 6px", borderRadius: 8, background: CREAM }}>test</span> : null}
      {o.isTest && o.checkedOn ? <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.7 }}>checked {o.checkedOn}</div> : null}</td>
    <td style={{ ...cell, textAlign: "right", fontWeight: o.problems ? 700 : 400, color: o.problems && !o.isTest ? INK : undefined }}>{o.problems == null ? "not checked yet" : n(o.problems)}</td>
    <td style={cell}><Rules byRule={o.byRule} units={data.units} /></td>
    <td style={{ ...cell, whiteSpace: "nowrap" }}><Trend trend={o.trend} nights={data.nights} /></td>
    <td style={cell}><button type="button" disabled={busy} style={link} onClick={() => onMark(o.id, !o.isTest)}>{o.isTest ? "Mark as real" : "Mark as test"}</button>
      {o.isTest && onCheck ? <button type="button" disabled={busy} style={{ ...link, marginLeft: 10 }} data-testid={`ops-numbers-check-${o.id}`} onClick={() => onCheck(o.id)}>Check now</button> : null}</td>
  </tr>;
  const withProblems = list => list.filter(o => o.problems > 0);
  const cleanReal = real.length - withProblems(real).length;
  return <section style={card} data-testid="ops-numbers">
    <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>The nightly number check</h2>
    <p data-testid="ops-numbers-sentence" style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>{data.latest ? `${data.latest}: ${data.digest}.` : data.sentence}</p>
    <p style={says}>A problem is one place where a number Steward shows or keeps disagrees with the gifts it comes from (scripts/ci/check-numbers.js, the rule for each in its words). The last {data.nights.length} nights read left to right, the latest in bold. Marking an org as a test moves it below the real ones and out of the nightly run (Check now checks it on demand); it changes no data.</p>
    {data.orgs.length ? <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}><tbody>
      <tr><td style={head}>Org</td><td style={{ ...head, textAlign: "right" }}>Problems</td><td style={head}>By rule</td><td style={head}>Last {data.nights.length} nights</td><td style={head} /></tr>
      {withProblems(real).map(row)}
      {cleanReal ? <tr><td colSpan={5} style={{ ...cell, opacity: 0.7 }}>{countLabel(cleanReal, "real org")} with no problems.</td></tr> : null}
      {test.length ? <tr><td colSpan={5} style={{ ...cell, fontWeight: 600, paddingTop: 14 }}>Test orgs ({n(test.length)})</td></tr> : null}
      {test.map(row)}
    </tbody></table></div> : null}
    {real.filter(o => o.problems === 0).length ? <details style={{ margin: "8px 0 0" }}><summary style={{ fontSize: 13, cursor: "pointer" }}>The real orgs with no problems</summary>
      <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>{real.filter(o => o.problems === 0).map(row)}</tbody></table></details> : null}
    {data.sameName.length ? <div data-testid="ops-numbers-same-name" style={{ background: CREAM, borderRadius: 8, padding: "10px 14px", margin: "14px 0 0" }}>
      <div style={{ fontWeight: 600, fontSize: 14, margin: "0 0 4px" }}>Orgs that share a name ({n(data.sameName.length)})</div>
      <p style={{ ...says, margin: "0 0 6px" }}>What tells each one apart. Nothing here merges or deletes an org; which one is real is Jonathan's call (docs/needs-jonathan/NUMBERS-6.md).</p>
      <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}><tbody>
        <tr><td style={head}>Org</td><td style={head}>Made</td><td style={{ ...head, textAlign: "right" }}>Users</td><td style={head}>Last sign-in</td><td style={{ ...head, textAlign: "right" }}>People</td><td style={{ ...head, textAlign: "right" }}>Gifts</td><td style={{ ...head, textAlign: "right" }}>Problems</td></tr>
        {data.sameName.flatMap(g => g.orgs.map((o, i) => <tr key={o.id}>
          <td style={{ ...cell, fontWeight: i ? 400 : 600 }}>{o.name} <span style={{ opacity: 0.6, fontSize: 12 }}>{o.id}</span>{o.isTest ? <span style={{ marginLeft: 6, fontSize: 11, padding: "1px 6px", borderRadius: 8, background: WHITE }}>test</span> : null}</td>
          <td style={cell}>{o.created || "–"}</td><td style={{ ...cell, textAlign: "right" }}>{n(o.users)}</td><td style={cell}>{o.lastSignIn || "never"}</td>
          <td style={{ ...cell, textAlign: "right" }}>{n(o.people)}</td><td style={{ ...cell, textAlign: "right" }}>{n(o.gifts)}</td>
          <td style={{ ...cell, textAlign: "right" }}>{o.problems == null ? "–" : n(o.problems)}</td></tr>))}
      </tbody></table></div>
    </div> : null}
    {result ? <p style={{ fontSize: 13, margin: "8px 0 0", color: result.ok ? EMERALD : INK, borderLeft: result.ok ? 0 : `3px solid ${BRASS}`, paddingLeft: result.ok ? 0 : 8 }}>{result.text}</p> : null}
  </section>;
}

export default function NumbersCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const load = useCallback(() => apiFetch("/ops/numbers").then(d => { setData(d); setError(null); })
    .catch(e => setError(e && e.status === 404 ? "This card is for Steward's super-admins." : "The nightly check could not be read. Try again in a minute.")), []);
  useEffect(() => { load(); }, [load]);
  const onMark = async (orgId, isTest) => {
    setBusy(true); setResult(null);
    try { const r = await apiFetch("/ops/numbers/test-org", { method: "POST", body: JSON.stringify({ orgId, isTest }) }); setResult({ ok: true, text: r.sentence }); }
    catch (e) { setResult({ ok: false, text: (e && e.body && e.body.message) || "That did not save." }); }
    finally { setBusy(false); load(); }
  };
  const onCheck = async (orgId) => {   // SCALE-4: a test org's check, on demand (queued on the worker)
    setBusy(true); setResult(null);
    try { const r = await apiFetch("/ops/numbers/check-org", { method: "POST", body: JSON.stringify({ orgId }) }); setResult({ ok: true, text: r.sentence }); }
    catch (e) { setResult({ ok: false, text: (e && e.body && e.body.message) || "That did not start." }); }
    finally { setBusy(false); }
  };
  return <NumbersView data={data} error={error} busy={busy} onMark={onMark} onCheck={onCheck} result={result} />;
}
