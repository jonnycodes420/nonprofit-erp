// ONBOARD-5 · Bring your donors; Funds, campaigns and events; How you talk.
// Bring your donors is ONBOARD-4's three ways side by side, with the status
// track under the chosen one and ONBOARD-3's "Does this match your old system?"
// before anything is relied on. Funds and How you talk open prefilled from what
// the import found (setupData.js); every choice row ends with Custom.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { C, MONTHS, Card, Choices, Message, label, side, input, why, btn, link, usd, count } from "./ui";

const errText = (e, fallback) => (e && e.body && (e.body.message || e.body.sentence)) || (e && e.message) || fallback;
const TRACK = ["Received", "Matched", "Ready for you to check", "Loaded"];

function Track({ reached }) {
  return <div data-testid="setup-track" data-reached={reached} style={{ display: "flex", marginTop: 14, fontSize: 13 }}>
    {TRACK.map((t, i) => <div key={t} data-done={i < reached ? "1" : "0"} style={{ flex: 1, textAlign: "center", padding: "8px 4px", borderTop: `3px solid ${i < reached ? C.emerald : C.line}`,
      color: i < reached ? C.ink : C.dim, fontWeight: i < reached ? 600 : 400 }}>{t}</div>)}
  </div>;
}

function Opt({ id, on, title, words, onPick, logo }) {
  return <button type="button" data-testid={`setup-way-${id}`} aria-pressed={on} onClick={onPick}
    style={{ textAlign: "left", border: `1.5px solid ${on ? C.emerald : C.line2}`, boxShadow: on ? "0 0 0 3px rgba(13,92,58,.12)" : "none", borderRadius: 12, padding: 16, background: C.white, cursor: "pointer", font: "inherit", color: C.ink, display: "flex", flexDirection: "column", gap: 6 }}>
    {logo ? <img src={logo} alt="" width={22} height={22} /> : null}
    <b style={{ fontSize: 15 }}>{title}</b><span style={{ fontSize: 13, color: C.dim, lineHeight: 1.45 }}>{words}</span>
  </button>;
}

export function BringDonors({ step, reload, go }) {
  const w = step.ways;
  const stripe = w.giving.find(g => g.key === "stripe") || {};
  const job = w.send.jobs[0] || null;
  const initial = job || w.send.waiting.length ? "send" : stripe.connected ? "stripe" : "file";
  const [way, setWay] = useState(initial);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const loaded = !!step.dataInAt;
  const reachedFile = loaded ? 4 : step.peopleIn ? 3 : 0;
  const reachedJob = j => !j ? 0 : j.undone ? 1 : (j.steps || []).filter(s => s.at).length;
  const post = async (path, body) => {
    setBusy(true); setMsg(null);
    try { await apiFetch(path, { method: "POST", body: JSON.stringify(body || {}) }); setFile(null); setMsg({ text: "Received. Jonathan maps it and you check it before anything loads." }); reload(); }
    catch (e) { setMsg({ text: errText(e, "That didn't go through. Try again in a minute."), tone: "bad" }); }
    setBusy(false);
  };
  const send = () => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => post("/onboarding/concierge", { fileName: file.name, fileType: file.type, data: String(r.result || "") });
    r.readAsDataURL(file);
  };
  return <>
    <div className="setup-three" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
      <Opt id="file" on={way === "file"} onPick={() => setWay("file")} title="Upload a file" words="An export from Salesforce, Excel or anything else. We match the columns for you." />
      <Opt id="stripe" on={way === "stripe"} onPick={() => setWay("stripe")} title="Start from Stripe" logo="/logos/stripe.svg" words="We build your donor list from every gift already in Stripe." />
      <Opt id="send" on={way === "send"} onPick={() => setWay("send")} title="Send it to us" words="Email us whatever you have. Jonathan maps it and you check it before anything loads." />
    </div>
    <Card style={{ marginTop: 12 }} testid={`setup-way-body-${way}`}>
      {way === "file" && <>
        <span style={label}>Your file</span>
        <p style={{ ...side, margin: "4px 0 0" }}>{w.file.words}</p>
        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {step.peopleIn && !loaded ? <a href="/onboard/totals" style={{ ...btn("primary"), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Does this match your old system?</a>
            : <a href="/donors?import=1" style={{ ...btn(step.peopleIn ? "quiet" : "primary"), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>{step.peopleIn ? "Import another file" : "Choose your file"}</a>}
        </div>
        <Track reached={reachedFile} />
      </>}
      {way === "stripe" && <>
        <span style={label}>From Stripe</span>
        <p style={{ ...side, margin: "4px 0 0" }}>{stripe.words}</p>
        {!stripe.connected && <div style={{ marginTop: 12 }}><button type="button" style={btn("primary")} onClick={() => go("gifts")}>Connect Stripe</button></div>}
        <Track reached={loaded ? 4 : stripe.connected ? (step.peopleIn ? 3 : 1) : 0} />
        {stripe.connected && step.peopleIn && !loaded ? <p style={{ marginTop: 12 }}><a href="/onboard/totals" style={{ color: C.emerald, fontWeight: 700 }}>Does this match your old system?</a></p> : null}
      </>}
      {way === "send" && <>
        {w.send.waiting.map(b => <div key={b.bookingId} data-testid="setup-booking-file" style={{ background: C.cream, borderRadius: 10, padding: "12px 14px", fontSize: 14, marginBottom: 12 }}>
          The file you sent when you booked the call is already here: <b>{b.fileName}</b>.
          <div style={{ marginTop: 8 }}><button type="button" disabled={busy} style={btn("primary")} onClick={() => post(`/onboarding/concierge/booking/${encodeURIComponent(b.bookingId)}`)}>Use this file</button></div>
        </div>)}
        {job ? <><span style={label}>{job.fileName}</span><Track reached={reachedJob(job)} />
          {job.key === "ready" && <p style={{ marginTop: 12 }}><a href="/onboard/totals" style={{ color: C.emerald, fontWeight: 700 }}>Does this match your old system?</a></p>}</> : null}
        <label style={{ ...label, marginTop: job || w.send.waiting.length ? 16 : 0 }}>{job ? "Send another file" : "Your donor file"}
          <input type="file" data-testid="setup-send-file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods" onChange={e => setFile(e.target.files && e.target.files[0])} style={{ display: "block", marginTop: 8, fontSize: 14, maxWidth: "100%" }} /></label>
        <div style={{ marginTop: 10 }}><button type="button" disabled={!file || busy} style={btn(file ? "primary" : "quiet")} onClick={send}>{busy ? "Sending…" : "Send it to us"}</button></div>
        {!job && <Track reached={0} />}
      </>}
      <div style={why}>Before anything loads you'll see <b>"Does this match your old system?"</b> with your totals side by side, and every import has Undo.</div>
      <Message {...(msg || {})} />
    </Card>
  </>;
}

// ── Funds, campaigns and events ───────────────────────────────────────────
export function FundsCampaigns({ reload }) {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState(null);
  const [rename, setRename] = useState(null);
  const [ev, setEv] = useState({ name: "", month: "", letters: "", custom: false });
  const load = () => apiFetch("/onboarding/setup/funds").then(setD).catch(() => setD({ funds: [], campaigns: [], events: [] }));
  useEffect(() => { load(); }, []);
  if (!d) return <Card><p style={side}>Reading what we found…</p></Card>;
  const act = async (fn, ok) => { setMsg(null); try { await fn(); setMsg({ text: ok }); await load(); reload(); } catch (e) { setMsg({ text: errText(e, "That didn't save. Try again."), tone: "bad" }); } };
  const restrict = f => act(() => apiFetch(`/finance/funds/${encodeURIComponent(f.id)}`, { method: "PUT", body: JSON.stringify({ name: f.name, description: f.description, restricted: !f.restricted }) }),
    f.restricted ? `${f.name} is unrestricted now.` : `${f.name} is restricted now. Reports keep its money apart.`);
  const merge = c => act(() => apiFetch("/campaign-tidy/merge", { method: "POST", body: JSON.stringify({ keepId: c.duplicateOf, mergeIds: [c.id] }) }),
    "Merged. Its gifts are on the one kept, and the merge has an Undo on Campaigns.");
  const saveName = c => act(() => apiFetch(`/fundraising/campaigns/${encodeURIComponent(c.id)}`, { method: "PUT", body: JSON.stringify({ name: rename.name.trim() }) }).then(() => setRename(null)), "Renamed.");
  const addEvent = () => act(() => apiFetch("/onboarding/setup/events", { method: "POST", body: JSON.stringify({ name: ev.name, month: Number(ev.month), lettersMonth: ev.letters ? Number(ev.letters) : null }) })
    .then(() => setEv({ name: "", month: "", letters: "", custom: false })), "Added.");
  const removeEvent = e => act(() => apiFetch("/onboarding/setup/events/remove", { method: "POST", body: JSON.stringify({ id: e.id }) }), "Removed.");
  const row = { display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 0", borderTop: `1px solid ${C.line}`, fontSize: 14.5, flexWrap: "wrap", alignItems: "center" };
  const quiet = { color: C.dim, fontSize: 13.5 };
  const keptName = id => (d.campaigns.find(c => c.id === id) || {}).name;
  const EVENT_NAMES = ["Spring gala", "June fundraiser", "Year-end appeal"];
  return <Card testid="setup-funds">
    <span style={label}>Funds</span>
    <div>{d.funds.length ? d.funds.map(f => <div key={f.id} style={row} data-fund={f.id}>
      <span>{f.name}</span>
      <span style={quiet}>{count(f.gifts, "gift")} · {f.restricted ? "restricted" : "unrestricted"} · <button type="button" style={link} onClick={() => restrict(f)}>{f.restricted ? "mark unrestricted" : "mark restricted"}</button></span>
    </div>) : <p style={side}>No funds yet. Gifts go to your general fund until you add one.</p>}</div>
    <span style={{ ...label, marginTop: 20 }}>Campaigns</span>
    <div>{d.campaigns.length ? d.campaigns.map(c => <div key={c.id} data-campaign={c.id} style={{ ...row, ...(c.duplicateOf ? { background: "rgba(201,168,76,.15)", padding: "11px 10px", borderRadius: 8 } : {}) }}>
      {rename && rename.id === c.id
        ? <span style={{ display: "flex", gap: 8, flex: "1 1 100%", flexWrap: "wrap" }}><input aria-label="New name" value={rename.name} onChange={e => setRename({ ...rename, name: e.target.value })} style={{ ...input, marginTop: 0, flex: "1 1 200px" }} />
          <button type="button" style={btn("primary")} disabled={!rename.name.trim()} onClick={() => saveName(c)}>Save</button><button type="button" style={link} onClick={() => setRename(null)}>Cancel</button></span>
        : <><span>{c.name}{c.duplicateOf ? <span style={quiet}> (a second one)</span> : null}</span>
          <span style={quiet}>{count(c.gifts, "gift")} · {c.duplicateOf
            ? <button type="button" data-testid="setup-merge" style={link} onClick={() => merge(c)}>Merge into {keptName(c.duplicateOf)}</button>
            : <button type="button" style={link} onClick={() => setRename({ id: c.id, name: c.name })}>rename</button>}</span></>}
    </div>) : <p style={side}>No campaigns yet. They appear here once gifts name one.</p>}</div>
    <span style={{ ...label, marginTop: 20 }}>Your events each year</span>
    <div>{d.events.map(e => <div key={e.id} style={row} data-event={e.id}><span>{e.name}</span>
      <span style={quiet}>{MONTHS[e.month - 1]}{e.lettersMonth ? ` · tax letters in ${MONTHS[e.lettersMonth - 1]}` : ""} · <button type="button" style={link} onClick={() => removeEvent(e)}>remove</button></span></div>)}</div>
    <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
      <Choices name="Event" testid="setup-event-name" value={ev.custom ? { custom: true } : EVENT_NAMES.includes(ev.name) ? { key: ev.name } : null}
        options={EVENT_NAMES.map(n => ({ key: n, label: n }))} onPick={v => setEv(x => v.custom ? { ...x, name: "", custom: true } : { ...x, name: v.key, custom: false })} />
      {ev.custom && <input aria-label="Event name" placeholder="Its name, like Barn Bash" value={ev.name} onChange={e => setEv({ ...ev, name: e.target.value })} style={{ ...input, maxWidth: 360 }} />}
      {ev.name.trim().length >= 2 && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
        <label style={{ ...side, fontWeight: 600 }}>It happens in<select value={ev.month} onChange={e => setEv({ ...ev, month: e.target.value })} style={{ ...input, width: 180 }}>
          <option value="">Choose the month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <label style={{ ...side, fontWeight: 600 }}>Tax letters go in<select value={ev.letters} onChange={e => setEv({ ...ev, letters: e.target.value })} style={{ ...input, width: 180 }}>
          <option value="">No letters</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <button type="button" data-testid="setup-event-add" style={btn("quiet")} disabled={!ev.month} onClick={addEvent}>Add the event</button>
      </div>}
      {ev.name.trim().length >= 2 && ev.month ? <p style={{ ...side, marginTop: 8 }}>Steward will say: "{ev.name.trim()} is in {MONTHS[Number(ev.month) - 1]}{ev.letters ? `, and its tax letters go out in ${MONTHS[Number(ev.letters) - 1]}` : ""}."</p> : null}
    </div>
    <Message {...(msg || {})} />
  </Card>;
}

// ── How you talk ──────────────────────────────────────────────────────────
// Saved when she presses Continue (registerSave), then the step is confirmed.
export function HowYouTalk({ registerSave }) {
  const [d, setD] = useState(null);
  const [major, setMajor] = useState(null);
  const [majorTyped, setMajorTyped] = useState("");
  const [word, setWord] = useState(null);
  const [wordTyped, setWordTyped] = useState({ one: "", many: "" });
  const [addr, setAddr] = useState(null);
  const [addrTyped, setAddrTyped] = useState("");
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    apiFetch("/onboarding/setup/voice").then(v => {
      setD(v);
      setMajor(v.majorChoices.includes(v.majorCents) ? { key: String(v.majorCents) } : { custom: true });
      setMajorTyped(String(Math.round(v.majorCents / 100)));
      const known = v.wordChoices.find(([one]) => one === v.giverSingular);
      setWord(known ? { key: known[0] } : { custom: true });
      setWordTyped({ one: v.giverSingular, many: v.giverPlural });
      const p = v.addresseeChoices.find(c => (c.pattern || null) === (v.addresseePattern || null));
      setAddr(p ? { key: p.key } : { custom: true });
      setAddrTyped(v.addresseePattern || "{first1} and {first2} {last}");
    }).catch(() => setD(false));
  }, []);
  // What will be saved, from the choices.
  const majorCents = major && !major.custom ? Number(major.key) : Math.round(Number(String(majorTyped).replace(/[$,\s]/g, "")) * 100);
  const majorOk = Number.isFinite(majorCents) && majorCents >= 100;
  const pair = word && !word.custom ? (d ? d.wordChoices.find(([one]) => one === word.key) : null) : [wordTyped.one.trim().toLowerCase(), wordTyped.many.trim().toLowerCase()];
  const okWord = s => /^[a-z][a-z' -]{1,29}$/.test(s || "");
  const wordOk = !!pair && okWord(pair[0]) && okWord(pair[1]);
  const pattern = addr && !addr.custom ? (d ? (d.addresseeChoices.find(c => c.key === addr.key) || {}).pattern || null : null) : addrTyped.trim();
  const patternOk = !(addr && addr.custom) || /\{(first1|first2|last)\}/.test(pattern || "") && !(String(pattern).match(/\{[^}]*\}/g) || []).some(t => !["{first1}", "{first2}", "{last}"].includes(t));
  const couple = d ? d.couple : ["Debbie Vogel", "Jeff Vogel"];
  const split = n => { const w = String(n).trim().split(/\s+/); return { first: w.length > 1 ? w.slice(0, -1).join(" ") : w[0], last: w.length > 1 ? w[w.length - 1] : "" }; };
  const a = split(couple[0]), b = split(couple[1] || couple[0]);
  const addressed = pattern ? String(pattern).replace(/\{first1\}/g, a.first).replace(/\{first2\}/g, b.first).replace(/\{last\}/g, a.last) : `${a.first} and ${b.first} ${a.last}`;
  useEffect(() => {
    registerSave(async () => {
      if (!d) return true;
      if (!majorOk) { setMsg({ text: "A major gift is a dollar amount, like 2500.", tone: "bad" }); return false; }
      if (!wordOk) { setMsg({ text: "Your word needs a singular and a plural, 2 to 30 letters each, like partner and partners.", tone: "bad" }); return false; }
      if (!patternOk) { setMsg({ text: "Use {first1}, {first2} and {last} for the names, like Dear {first1} and {first2}.", tone: "bad" }); return false; }
      try {
        const r = await apiFetch("/onboarding/setup/voice", { method: "POST", body: JSON.stringify({ majorCents, giverSingular: pair[0], giverPlural: pair[1], addresseePattern: pattern }) });
        if (r.midMoved) setMsg({ text: r.midMoved });
        return true;
      } catch (e) { setMsg({ text: errText(e, "That didn't save. Try again."), tone: "bad" }); return false; }
    });
  });
  if (d === null) return <Card><p style={side}>Reading your settings…</p></Card>;
  if (d === false) return <Card><p style={side}>These settings could not be read. Try again in a minute.</p></Card>;
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  return <Card testid="setup-voice">
    <span style={label}>A major gift here is</span>
    <Choices name="Major gift amount" testid="setup-major" value={major} options={d.majorChoices.map(c => ({ key: String(c), label: `${usd(c)}+` }))} onPick={setMajor} />
    {major && major.custom && <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
      <input aria-label="Major gift amount in dollars" inputMode="decimal" value={majorTyped} onChange={e => setMajorTyped(e.target.value)} style={{ ...input, width: 160, marginTop: 0 }} />
    </div>}
    <p style={{ ...side, marginTop: 8 }} data-testid="setup-major-sentence">{majorOk ? `Someone who gives ${usd(majorCents)} or more in a year is a major ${pair && wordOk ? pair[0] : "donor"}, everywhere in Steward.` : "Type a dollar amount, like 2500."}</p>
    <span style={{ ...label, marginTop: 20 }}>You call the people who give</span>
    <Choices name="Your word for donors" testid="setup-word" value={word} options={d.wordChoices.map(([one, many]) => ({ key: one, label: cap(many) }))} onPick={setWord} />
    {word && word.custom && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
      <label style={{ ...side, fontWeight: 600 }}>One person<input value={wordTyped.one} onChange={e => setWordTyped({ ...wordTyped, one: e.target.value })} placeholder="supporter" style={{ ...input, width: 200 }} /></label>
      <label style={{ ...side, fontWeight: 600 }}>Several<input value={wordTyped.many} onChange={e => setWordTyped({ ...wordTyped, many: e.target.value })} placeholder="supporters" style={{ ...input, width: 200 }} /></label>
    </div>}
    <p style={{ ...side, marginTop: 8 }} data-testid="setup-word-sentence">{wordOk ? `Steward says "${pair[0]}" for one person and "${pair[1]}" for several, on every screen.` : "Type the word for one person and for several."}</p>
    <span style={{ ...label, marginTop: 20 }}>A couple is addressed as</span>
    <Choices name="How a couple is addressed" testid="setup-addressee" value={addr} options={d.addresseeChoices.map(c => ({ key: c.key, label: c.says }))} onPick={setAddr} />
    {addr && addr.custom && <input aria-label="Your pattern" value={addrTyped} onChange={e => setAddrTyped(e.target.value)} style={{ ...input, maxWidth: 420 }} />}
    {addr && addr.custom && <p style={{ ...side, marginTop: 6 }}>Use {"{first1}"}, {"{first2}"} and {"{last}"} for the names.</p>}
    <p style={{ ...side, marginTop: 8 }} data-testid="setup-addressee-sentence">{patternOk ? <>Envelopes read: <b>{addressed}</b></> : "That pattern needs {first1}, {first2} or {last}."}</p>
    <Message {...(msg || {})} />
  </Card>;
}
