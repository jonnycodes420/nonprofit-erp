// STAGE-1 · /ops, "Ship to customers". Every merge goes to staging first and is
// walked there; prod moves only when a super-admin presses Ship here. Reads
// GET /ops/ship (every 2 minutes, every 20 s while a ship runs). The confirm
// names the builds going out; the server re-checks everything before it ships.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api";

const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C";
const card = { background: WHITE, borderRadius: 10, padding: "18px 20px", marginBottom: 18, border: "1px solid rgba(15,26,18,0.08)" };
const says = { fontSize: 13, opacity: 0.7, margin: "0 0 12px" };
const cell = { padding: "6px 10px 6px 0", fontSize: 13, verticalAlign: "top", borderTop: `1px solid ${CREAM}` };
const pill = good => ({ display: "inline-block", padding: "1px 8px", borderRadius: 10, fontSize: 12, fontWeight: 600,
  background: good === true ? EMERALD : good === false ? BRASS : CREAM, color: good === true ? WHITE : INK });
const btn = (primary, disabled) => ({ minHeight: 40, padding: "8px 16px", borderRadius: 8, fontSize: 14, fontWeight: 600, fontFamily: "inherit",
  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
  background: primary ? EMERALD : WHITE, color: primary ? WHITE : INK, border: primary ? 0 : `1px solid ${INK}40` });
const short = s => (s ? String(s).slice(0, 7) : "none");
const walkWord = w => (!w || !w.state ? "not walked" : w.state === "success" ? "passed" : w.state === "pending" ? "walking" : "failed");
const walkGood = w => (!w || !w.state || w.state === "pending" ? null : w.state === "success");
const runWord = r => (!r ? "none yet" : r.status !== "completed" ? "running" : r.conclusion === "success" ? "live, smoke passed" : r.conclusion || "stopped");

export function ShipView({ data, error, busy, onShip, onRollback, result }) {
  const [confirm, setConfirm] = useState(null);   // "ship" | "rollback"
  if (error) return <section style={card} data-testid="ops-ship"><h2 style={{ fontSize: 17, margin: "0 0 4px" }}>Ship to customers</h2><p style={says}>{error}</p></section>;
  if (!data) return <section style={card} data-testid="ops-ship"><h2 style={{ fontSize: 17, margin: "0 0 4px" }}>Ship to customers</h2><p style={says}>Loading…</p></section>;
  const st = data.staging || {};
  const builds = data.pending || [];
  const names = builds.map(b => b.build || b.title);
  return <section style={card} data-testid="ops-ship">
    <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>Ship to customers</h2>
    <p style={says}>Every merge goes to staging and is walked there. Customers get it only when you press Ship, which deploys exactly staging's commit to prod and runs the prod smoke.</p>
    <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 12 }}><tbody>
      <tr><td style={{ ...cell, width: 150, fontWeight: 600 }}>Prod</td><td style={cell}>{short(data.prodSha)}{data.previousSha ? <span style={{ opacity: 0.7 }}> · before it {short(data.previousSha)}</span> : null}</td></tr>
      <tr><td style={{ ...cell, fontWeight: 600 }}>Staging</td><td style={cell}>{!st.configured ? "not set up yet" : st.error ? st.error
        : <>web {short(st.web)} · worker {short(st.worker)} · frontend {short(st.frontend)} · walk <span style={pill(walkGood(data.walk))}>{walkWord(data.walk)}</span>
          {data.walk && data.walk.url ? <> <a href={data.walk.url} style={{ color: EMERALD }}>the run</a></> : null}</>}</td></tr>
      <tr><td style={{ ...cell, fontWeight: 600 }}>Muse on staging</td><td style={cell}>{data.muse ? `${data.muse.date}: ${data.muse.fail} fail · ${data.muse.pass} pass · ${data.muse.skip} skip` : "no staging walk imported yet"}</td></tr>
      <tr><td style={{ ...cell, fontWeight: 600 }}>Last ship</td><td style={cell}>{data.lastShip ? <><span style={pill(data.lastShip.status !== "completed" ? null : data.lastShip.conclusion === "success")}>{runWord(data.lastShip)}</span> {data.lastShip.title} · <a href={data.lastShip.url} style={{ color: EMERALD }}>the run</a></> : "none yet"}</td></tr>
    </tbody></table>
    <div style={{ fontWeight: 600, fontSize: 14, margin: "0 0 6px" }}>On staging, not yet with customers{builds.length ? ` (${builds.length})` : ""}</div>
    {builds.length === 0 ? <p style={says}>Nothing waiting.</p> :
      <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 12 }}><tbody>
        {builds.map(b => <tr key={b.sha}><td style={{ ...cell, width: 150, fontWeight: 600 }}>{b.build || short(b.sha)}</td>
          <td style={cell}>{b.title}</td>
          <td style={{ ...cell, width: 110 }}><span style={pill(walkGood(b.walk))}>{walkWord(b.walk)}</span></td></tr>)}
      </tbody></table>}
    {data.errors && data.errors.length ? <p style={says}>Could not read: {data.errors.join(" ")}</p> : null}
    {confirm ? <div role="dialog" aria-label="Confirm" style={{ background: CREAM, borderRadius: 8, padding: "12px 14px", margin: "0 0 10px" }}>
      <p style={{ margin: "0 0 10px", fontSize: 14 }}>{confirm === "ship"
        ? <>Ship {short(st.web)} to customers? Going out: <b>{names.join(", ") || "one commit"}</b>.</>
        : <>Roll prod back from {short(data.prodSha)} to {short(data.previousSha)}? Customers lose what shipped since.</>}</p>
      <button type="button" disabled={busy} style={btn(true, busy)} onClick={() => { setConfirm(null); (confirm === "ship" ? onShip : onRollback)(); }}>
        {confirm === "ship" ? `Ship ${names.length || 1} to customers` : "Roll back"}</button>{" "}
      <button type="button" style={btn(false, false)} onClick={() => setConfirm(null)}>Cancel</button>
    </div> : null}
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <button type="button" data-testid="ship-button" disabled={!data.canShip || busy} title={data.shipReason || ""} style={btn(true, !data.canShip || busy)} onClick={() => setConfirm("ship")}>Ship to customers</button>
      <button type="button" data-testid="rollback-button" disabled={!data.canRollback || busy} title={data.rollbackReason || ""} style={btn(false, !data.canRollback || busy)} onClick={() => setConfirm("rollback")}>Roll back</button>
    </div>
    {!data.canShip && data.shipReason ? <p style={{ ...says, margin: "8px 0 0" }}>Ship is off: {data.shipReason}</p> : null}
    {result ? <p style={{ fontSize: 13, margin: "8px 0 0" }}>{result}</p> : null}
  </section>;
}

export default function ShipCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const load = useCallback(() => apiFetch("/ops/ship").then(d => { setData(d); setError(null); })
    .catch(e => setError(e && e.status === 404 ? "This card is for Steward's super-admins." : "The ship card could not be read. Try again in a minute.")), []);
  const running = !!(data && data.lastShip && data.lastShip.status !== "completed");
  useEffect(() => { load(); const t = setInterval(load, running ? 20000 : 120000); return () => clearInterval(t); }, [load, running]);
  const send = async (path, sha) => {
    setBusy(true); setResult(null);
    try { const r = await apiFetch(path, { method: "POST", body: JSON.stringify({ sha }) }); setResult(r.message); }
    catch (e) { setResult((e && e.body && e.body.message) || (e && e.message) || "That did not start."); }
    finally { setBusy(false); load(); }
  };
  return <ShipView data={data} error={error} busy={busy} result={result}
    onShip={() => send("/ops/ship", data.staging.web)} onRollback={() => send("/ops/rollback", data.previousSha)} />;
}
