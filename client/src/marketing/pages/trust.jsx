// TRUST-2 · the pages a careful buyer reads before signing: is it up (/status),
// who else touches our data (/subprocessors), how do we answer a donor who asks
// (/your-data), and the data processing agreement (/dpa), which stays a draft
// until an attorney has read it.
import { useEffect, useState } from "react";
import { Hero, FaqS, FinalCta } from "../lib";
import { API } from "../../api";
import { SUBPROCESSORS, WHEN_WORDS } from "../../../../shared/subprocessors.js";

const STATE_WORDS = { up: "Working", degraded: "Slower or partly affected", down: "Not working", unknown: "Not measured yet" };
const STATE_DOT = { up: "var(--emerald, #0D5C3A)", degraded: "#C9A84C", down: "#0F1A12", unknown: "#D4CFC6" };
const fmtDay = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function Status() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch(`${API}/status/summary`).then(r => r.json()).then(setD).catch(() => setErr("The status service did not answer. If this page cannot reach Steward, Steward itself may be down."));
  }, []);
  const days = [];
  for (let i = 89; i >= 0; i--) { const t = new Date(Date.now() - i * 864e5); days.push(t.toISOString().slice(0, 10)); }
  const allUp = d && d.services.every(s => s.state === "up" || s.state === "unknown") && !d.open;
  return <>
    <Hero eyebrow="Status" crumbs={[["Status"]]} h={d ? (allUp ? "Everything is <b>working.</b>" : "Something is <b>affected.</b>") : "Steward <b>status.</b>"}
      lede="Each service is checked every minute. The bars are the last 90 days, and every percentage is counted from those stored checks." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {err && <p>{err}</p>}
      {d && d.incidents.filter(i => !i.resolved_at).map(i => (
        <div key={i.id} className="card" style={{ borderLeft: "3px solid #C9A84C" }}>
          <h4>{i.title}</h4>
          {i.updates.map((u, k) => <p key={k} style={{ margin: "6px 0" }}><b>{new Date(u.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</b> · {u.body}</p>)}
        </div>))}
      {d && d.services.map(s => {
        const byDay = Object.fromEntries(s.days.map(x => [x.day, x]));
        return (
          <div key={s.key} className="card" data-service={s.key}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
              <h4 style={{ margin: 0 }}><span aria-hidden style={{ display: "inline-block", width: 10, height: 10, borderRadius: 99, background: STATE_DOT[s.state], marginRight: 8 }} />{s.label}</h4>
              <span>{STATE_WORDS[s.state]}{s.uptime != null ? ` · ${s.uptime}% since ${new Date(s.since).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}</span>
            </div>
            <p style={{ margin: "6px 0 10px", opacity: 0.8 }}>{s.says}{s.detail ? ` ${s.detail}` : ""}</p>
            <div role="img" aria-label={`${s.label}, last 90 days`} style={{ display: "grid", gridTemplateColumns: "repeat(90, 1fr)", gap: 2 }}>
              {days.map(day => {
                const x = byDay[day];
                const color = !x || !x.measured ? "#E8E4DB" : x.down ? "#0F1A12" : x.up < x.measured ? "#C9A84C" : "#0D5C3A";
                return <span key={day} title={x && x.measured ? `${fmtDay(day)}: ${Math.round((x.up / x.measured) * 1000) / 10}% of ${x.measured} checks working` : `${fmtDay(day)}: no checks stored`} style={{ height: 26, borderRadius: 2, background: color }} />;
              })}
            </div>
          </div>);
      })}
      {d && <p style={{ opacity: 0.8 }}>{d.sentence} This page runs on the same servers as Steward, so if Steward is down this page is too.</p>}
      {d && d.incidents.filter(i => i.resolved_at).length > 0 && <div className="card"><h4>Resolved in the last two weeks</h4>
        {d.incidents.filter(i => i.resolved_at).map(i => <p key={i.id}><b>{i.title}</b> · resolved {new Date(i.resolved_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>)}</div>}
    </div></section>
  </>;
}

export function Subprocessors() {
  return <>
    <Hero eyebrow="Security and trust" crumbs={[["Why Steward"], ["Security and trust", "/security"], ["Subprocessors"]]} h="Who else touches <b>your data.</b>"
      lede="Every company that receives your organisation's or your donors' information when you use Steward, what it gets and why. Built from Steward's own code." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap"><div className="cards">
      {SUBPROCESSORS.map(s => <div className="card" key={s.name}><h4>{s.name}</h4><p>{s.what}</p><p style={{ opacity: 0.8 }}>{s.why} {WHEN_WORDS[s.when]}.</p></div>)}
    </div></div></section>
    <FinalCta />
  </>;
}

export function YourData() {
  return <>
    <Hero eyebrow="Security and trust" crumbs={[["Why Steward"], ["Security and trust", "/security"], ["Your data and donors' data"]]} h="Your data, and <b>your donors' data.</b>"
      lede="How you get everything out, how you answer a donor who asks what you hold or asks to be forgotten, and how to reach us." noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap prose" style={{ maxWidth: 760 }}>
      <h3>Take everything with you</h3>
      <p>An owner or admin can download everything Steward holds for your organisation, every table, in one file, from Settings, Security, Download everything. Passwords and sign-in secrets are left out. Spreadsheets of donors and gifts are under Settings, Your data.</p>
      <h3>When a donor asks what you hold</h3>
      <p>Open their record, choose More, then Export this person's data. You get one file with their profile, gifts, pledges, receipts, notes, the emails and meetings logged with them, events, volunteer hours and their opt-outs. Only owners and admins can do this, and the download is recorded in your audit log.</p>
      <h3>When a donor asks to be forgotten</h3>
      <p>At the bottom of their record, choose Erase this person, then type ERASE to confirm. Their name, contact details, notes, tags, photo and every logged email, meeting and conversation are removed for good, including the copies of their name on ledger lines and receipt records. Their gifts stay as anonymous gifts, so your books, the receipts you already issued and every total still match to the cent.</p>
      <p>Two things stay, on purpose. If they asked not to be emailed, their address stays on your do-not-email list, so they are never emailed again by accident. And your audit log keeps the history of changes made before the erasure; it records that the erasure happened and who did it, never what was erased.</p>
      <h3>Reach us</h3>
      <p>Write to <a href="mailto:jonathan@stewardapp.dev">jonathan@stewardapp.dev</a>. A person reads every message.</p>
      <p>See also: <a href="/subprocessors">who else touches your data</a> and <a href="/security">security and trust</a>.</p>
    </div></section>
    <FaqS items={[["Can we undo an erasure?", "No. It asks twice because it cannot be undone."], ["Do the donor's gifts disappear?", "No. They stay as anonymous gifts so your totals, receipts and books are unchanged."]]} />
    <FinalCta />
  </>;
}

export function Dpa() {
  const [d, setD] = useState(null);
  useEffect(() => {
    const tok = (() => { try { return localStorage.getItem("npe_token"); } catch { return null; } })();
    fetch(`${API}/legal/dpa`, { headers: tok ? { Authorization: "Bearer " + tok } : {} }).then(r => r.json()).then(setD).catch(() => setD({ published: false }));
  }, []);
  const pdf = async () => {
    const tok = (() => { try { return localStorage.getItem("npe_token"); } catch { return null; } })();
    const r = await fetch(`${API}/legal/dpa.pdf`, { headers: tok ? { Authorization: "Bearer " + tok } : {} });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob()), a = document.createElement("a");
    a.href = url; a.download = "steward-data-processing-agreement.pdf"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  return <>
    <Hero eyebrow="Security and trust" crumbs={[["Why Steward"], ["Security and trust", "/security"], ["Data processing agreement"]]} h="Data processing <b>agreement.</b>"
      lede={d && d.sections ? (d.draft ? `${d.label}. Not published.` : "The terms under which Steward processes your organisation's data.") : "The terms under which Steward will process your organisation's data."} noCta />
    <section style={{ paddingTop: 0 }}><div className="wrap prose" style={{ maxWidth: 760 }}>
      {!d && <p>Loading.</p>}
      {d && !d.sections && <p>{d.sentence}</p>}
      {d && d.sections && <>
        {d.draft && <p style={{ borderLeft: "3px solid #C9A84C", paddingLeft: 12 }}><b>{d.label}.</b> Only a super-admin can see this page until it is published.</p>}
        <p><button type="button" className="btn" onClick={pdf}>Download the PDF</button></p>
        {d.sections.map(s => <div key={s.h}><h3>{s.h}</h3>{(s.p || []).map((p, i) => <p key={i}>{p}</p>)}{s.list && <ul>{s.list.map(li => <li key={li}>{li}</li>)}</ul>}</div>)}
      </>}
    </div></section>
  </>;
}
