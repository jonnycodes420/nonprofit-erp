// ONBOARD-5 · Where gifts come in, QuickBooks, Email. One connection per page,
// each at the finish of the mockup's Stripe page: the service's real logo, what
// it takes, one Connect, four things it does, and "Connected as …" with Manage.
// Each connection goes through the route that already owns it: /giving-sources
// (a read key, verified before it is kept), /oauth/:provider/start, and
// /org/sending-domain. No email-marketing step (Jonathan, 24 Nov).
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { C, Card, Connection, Logo, Message, Status, TrustLine, label, side, input, why, btn, link } from "./ui";

const errText = (e, fallback) => (e && e.body && (e.body.message || e.body.sentence || (typeof e.body.error === "string" && e.body.error.includes(" ") ? e.body.error : null))) || fallback;
const LOGO = { stripe: "/logos/stripe.svg", paypal: "/logos/paypal.svg", zeffy: "/logos/zeffy.png", givebutter: "/logos/givebutter.png" };
const BRINGS = { stripe: "Online gifts and monthly donors", paypal: "Gifts and PayPal Giving Fund donations", zeffy: "Donations, events and tickets", givebutter: "Campaigns and peer-to-peer" };
// The order on the page; a provider shows only when its adapter is live (available).
const API_ORDER = ["stripe", "paypal", "zeffy", "givebutter"];
// Before an OAuth sign-in, where to come back to (OAuthCallback.jsx reads it once).
export const RETURN_KEY = "steward.setup.return";
const manage = section => { window.location.href = `/app/settings?section=${section}`; };

async function startOAuth(provider, step, setBusy, setMsg, refusals = {}) {
  setBusy(true); setMsg(null);
  try {
    const r = await apiFetch(`/oauth/${provider}/start`, { method: "POST", body: "{}" });
    try { sessionStorage.setItem(RETURN_KEY, `/onboard/setup?step=${step}`); } catch { /* private window: lands on Connections instead */ }
    window.location.href = r.url;
  } catch (e) {
    const code = e && e.body && e.body.error;
    setMsg({ text: refusals[code] || errText(e, "That didn't open. Try again in a minute."), tone: "bad" });
    setBusy(false);
  }
}

// ── Where gifts come in ───────────────────────────────────────────────────
function SourceRow({ p, connected, onDone }) {
  const [open, setOpen] = useState(false);
  const [cred, setCred] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const connect = async () => {
    setBusy(true); setMsg(null);
    try {
      await apiFetch("/giving-sources", { method: "POST", body: JSON.stringify({ provider: p.key, credentials: cred }) });
      setOpen(false); setCred({}); onDone();
    } catch (e) { setMsg({ text: errText(e, `${p.label} didn't accept that. Check it and try again.`), tone: "bad" }); }
    setBusy(false);
  };
  return <div data-testid={`setup-source-${p.key}`} style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 20px", marginBottom: 12 }}>
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <Logo name={p.label} src={LOGO[p.key]} />
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <h3 style={{ margin: 0, fontSize: 17, color: C.ink }}>{p.label}</h3>
        <p style={{ margin: "2px 0 0", color: C.dim, fontSize: 14 }}>{connected ? <Status>Connected as {connected.as}</Status> : BRINGS[p.key]}</p>
      </div>
      <div className="setup-act">{connected ? <button type="button" style={btn("quiet")} onClick={() => manage("connections")}>Manage</button>
        : <button type="button" data-testid={`setup-source-${p.key}-connect`} style={btn("primary")} aria-expanded={open} onClick={() => setOpen(o => !o)}>Connect {p.label}</button>}</div>
    </div>
    {open && !connected && <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
      {p.waitNote ? <p style={{ ...side, margin: "0 0 8px" }}>{p.waitNote}</p> : null}
      {p.steps ? <ol style={{ margin: "0 0 10px", paddingLeft: 20, fontSize: 14, lineHeight: 1.6 }}>{p.steps.map(s => <li key={s}>{s}</li>)}</ol> : <p style={side}>{p.help}</p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        {p.credentialFields.map(f => <label key={f.name} style={{ ...side, fontWeight: 600, flex: "1 1 220px" }}>{f.label}
          <input type={f.secret ? "password" : "text"} autoComplete="off" value={cred[f.name] || ""} onChange={e => setCred({ ...cred, [f.name]: e.target.value })} style={input} /></label>)}
        <button type="button" style={btn("primary")} disabled={busy || p.credentialFields.some(f => !String(cred[f.name] || "").trim())} onClick={connect}>{busy ? `Checking with ${p.label}…` : "Connect"}</button>
      </div>
      <p style={{ ...side, marginTop: 8 }}>Steward asks {p.label} to confirm it works before keeping it, and the key only reads.</p>
      <Message {...(msg || {})} />
    </div>}
  </div>;
}

export function WhereGiftsComeIn({ reload }) {
  const [providers, setProviders] = useState(null);
  const [mine, setMine] = useState({ connected: {} });
  const load = () => Promise.all([
    apiFetch("/giving-sources/providers").catch(() => ({ providers: [] })),
    apiFetch("/onboarding/setup/gifts").catch(() => ({ connected: {} })),
  ]).then(([p, m]) => { setProviders(p); setMine(m); });
  useEffect(() => { load(); }, []);
  if (!providers) return <Card><p style={side}>Reading what you can connect…</p></Card>;
  const live = API_ORDER.map(k => (providers.providers || []).find(p => p.key === k && p.mode === "api" && p.available)).filter(Boolean);
  const statements = (providers.providers || []).filter(p => p.mode === "file").map(p => p.label);
  return <>
    {providers.credentialsReady === false && <Card><p style={{ ...side, margin: 0 }}>Connections are switched off on this server for now. Jonathan sets this up with you.</p></Card>}
    {live.map(p => <SourceRow key={p.key} p={p} connected={mine.connected[p.key] || (p.key === "stripe" && mine.stripeConnect ? { as: "your Stripe account" } : null)} onDone={() => { load(); reload(); }} />)}
    <div data-testid="setup-source-statement" style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 20px", marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}><Logo name="Cash App" src="/logos/cashapp.svg" size={40} /><Logo name="Venmo" src="/logos/venmo.svg" size={40} /></div>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 17, color: C.ink }}>Cash App, Venmo and others</h3>
          <p style={{ margin: "2px 0 0", color: C.dim, fontSize: 14 }}>Upload a statement each month and we match it to donors{statements.length ? ` (${statements.join(", ")})` : ""}.</p>
        </div>
        <div className="setup-act"><a href="/donors?import=1" style={{ ...btn("quiet"), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Upload a statement</a></div>
      </div>
    </div>
    <div style={{ ...why, background: C.white, border: `1px solid ${C.line}` }}>Connect as many as you use. New gifts land on the right donor without anyone typing them, monthly donors and failed cards are flagged, and fees match Finance. Steward never moves money.</div>
  </>;
}

// ── QuickBooks ────────────────────────────────────────────────────────────
export function QuickBooks({ status }) {
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { apiFetch("/onboarding/setup/connections").then(setC).catch(() => setC({ quickbooks: {}, email: { mine: [] } })); }, []);
  const qb = (c && c.quickbooks) || {};
  const scopes = status && status.providers && status.providers.intuit ? status.providers.intuit.scopes : null;
  return <Connection testid="setup-qb" name="QuickBooks" logo="/logos/quickbooks.svg" minutes={2} busy={busy}
    connectedAs={qb.connected ? qb.connected.as : null} onManage={() => manage("connections")}
    onConnect={() => startOAuth("intuit", "quickbooks", setBusy, setMsg, {
      qbo_not_enabled: "QuickBooks opens for your organization once Jonathan switches it on for you. Book 30 minutes below, or skip this for now.",
      not_configured: "QuickBooks can't be connected from this server yet. Skip it for now; it waits on Home." })}
    gets={["Gifts post as deposits by fund", "Checks entered in QuickBooks flow in", "One monthly match report", "You choose which accounts"]}
    scopes={scopes} note={<Message {...(msg || {})} />} />;
}

// ── Email ─────────────────────────────────────────────────────────────────
function SendingDomain() {
  const [d, setD] = useState(null);
  const [from, setFrom] = useState("");
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(false);
  const load = () => apiFetch("/org/sending-domain").then(setD).catch(() => setD({ status: "none", records: [] }));
  useEffect(() => { load(); }, []);
  if (!d) return null;
  const add = async () => {
    setMsg(null);
    try { setD(await apiFetch("/org/sending-domain", { method: "POST", body: JSON.stringify({ fromEmail: from.trim() }) })); }
    catch (e) { setMsg({ text: errText(e, "That address didn't work. Use one at your own domain."), tone: "bad" }); }
  };
  const check = async () => { try { setD(await apiFetch("/org/sending-domain/check", { method: "POST", body: "{}" })); } catch (e) { setMsg({ text: errText(e, "Couldn't check just now. Try again in a minute."), tone: "bad" }); } };
  const text = (d.records || []).map(r => `${r.type || r.record || ""}\t${r.name || ""}\t${r.value || ""}`).join("\n");
  const copy = () => { try { navigator.clipboard.writeText(`Please add these DNS records for ${d.domain}:\n\n${text}`); setCopied(true); } catch { setCopied(false); } };
  return <div data-testid="setup-domain" style={{ ...why, background: C.white, border: `1px solid ${C.line}` }}>
    <b>Send from your own address.</b> {d.sentence}
    {!d.domain ? <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
      <input aria-label="Your address" placeholder="you@yourcharity.org" value={from} onChange={e => setFrom(e.target.value)} style={{ ...input, marginTop: 0, flex: "1 1 240px" }} />
      <button type="button" style={btn("quiet")} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from.trim())} onClick={add}>Set it up</button></div>
      : !d.verified && <>
        <p style={{ margin: "10px 0 6px" }}>Add these records to {d.domain}, or send them to whoever runs your website:</p>
        <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}><tbody>
          {(d.records || []).map((r, i) => <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
            <td style={{ padding: "6px 8px 6px 0", fontWeight: 700 }}>{r.type || r.record}</td><td style={{ padding: "6px 8px", wordBreak: "break-all" }}><code>{r.name}</code></td>
            <td style={{ padding: "6px 0 6px 8px", wordBreak: "break-all" }}><code>{r.value}</code></td></tr>)}
        </tbody></table></div>
        <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" style={link} onClick={copy}>{copied ? "Copied. Paste it into an email to them" : "Copy them to send"}</button>
          <button type="button" style={link} onClick={check}>Check again</button></div>
      </>}
    <Message {...(msg || {})} />
  </div>;
}

export function Email({ status }) {
  const [c, setC] = useState(null);
  const [mail, setMail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    apiFetch("/onboarding/setup/connections").then(setC).catch(() => setC({ email: { mine: [] } }));
    apiFetch("/mail-types/status").then(setMail).catch(() => setMail(null));
  }, []);
  const mine = (c && c.email && c.email.mine) || [];
  const linked = mine[0] || null;
  const scopes = p => (status && status.providers && status.providers[p] ? status.providers[p].scopes : null);
  const name = linked && linked.provider === "google" ? "Google" : "Outlook";
  const refusals = { demo_org: "This is a demo organization, so no mailbox connects here.", not_configured: "Email can't be connected from this server yet. Skip it for now; it waits on Home." };
  return <Connection testid="setup-email" name={name} logo={name === "Google" ? "/logos/google.svg" : "/logos/outlook.svg"} minutes={1} busy={busy}
    connectedAs={linked ? linked.as : null} onManage={() => manage("connections")}
    onConnect={() => startOAuth("microsoft", "email", setBusy, setMsg, refusals)}
    gets={["Mail with your donors lands on their page", "Meetings go on your calendar", "Thank-yous send from your own address", "Steward never sends from your mailbox"]}
    scopes={scopes(linked ? linked.provider : "microsoft")} note={<Message {...(msg || {})} />}>
    {!linked && <p style={{ ...side, marginTop: 14 }}>Using Gmail? <button type="button" data-testid="setup-google" style={link} onClick={() => startOAuth("google", "email", setBusy, setMsg, refusals)}>Connect Google instead</button></p>}
    <SendingDomain />
    <div data-testid="setup-automatic" style={why}><b>{mail && mail.state === "on" ? `${mail.count} automatic email${mail.count === 1 ? " is" : "s are"} on.` : "Automatic emails are off."}</b>{" "}
      {mail && mail.state === "on" ? "Change them any time in Settings." : "Receipts and reminders stay off until you turn them on in Settings, so nothing reaches a donor until you choose."}{" "}
      <button type="button" style={link} onClick={() => manage("automatic")}>Automatic emails</button></div>
  </Connection>;
}

export { TrustLine };
