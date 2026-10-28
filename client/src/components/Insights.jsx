// INSIGHTS-1 · WHO TO CALL, WHY, AND EXACTLY WHAT TO SAY.
//
// One card component (InsightCard), used on Home, the first look and the
// profile. Every card is What (the facts, with dates and amounts, and the
// people), Why (one sentence), How (who, when, the channel, what to say, the
// ask and its rule) and what Steward can do, each needing her click. Nothing
// here sends anything: a draft opens the person's profile, a task and a group
// are made by her button. The facts and the words come from the server
// (insights.js); this file draws them.
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { DonorLink } from "./RecordLink";

const SERIF = "'DM Serif Display', Georgia, serif";
const money = c => {
  const v = Math.abs(Number(c) || 0) / 100;
  return (c < 0 ? "-$" : "$") + (v % 1 ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toLocaleString("en-US"));
};
const EYEBROW = { fontSize: 11, letterSpacing: "0.1em", fontWeight: 700, textTransform: "uppercase", color: T.ink3 };
const B1 = { background: T.greenDk, color: T.white, border: "none", borderRadius: 9, padding: "9px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" };
const B2 = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 9, padding: "8px 13px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" };
const LNK = { background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 13, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer", fontFamily: "inherit" };
const CARD = { background: T.white, border: "1px solid " + T.bg2, borderRadius: 14, padding: "16px 18px", marginBottom: 12 };
const CHIP = { display: "inline-block", fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "2px 9px", marginRight: 6, border: "1px solid " + T.bg3, color: T.ink, background: T.bg };
const STATUS_CHIP = { slipping: { ...CHIP, background: T.gold, borderColor: T.gold, color: T.ink }, up: { ...CHIP, background: T.greenDk, borderColor: T.greenDk, color: T.white }, steady: CHIP };
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = k => new Date(Date.now() + k * 86400000).toISOString().slice(0, 10);

export function RungChips({ unit }) {
  if (!unit) return null;
  return (
    <span data-testid="ladder-rung">
      <span style={CHIP} title="Where this giver sits on the ladder, from their own giving">{unit.rungLabel}</span>
      <span style={STATUS_CHIP[unit.status] || CHIP}>{unit.statusLabel}</span>
      {unit.planned && <span style={CHIP} title={(unit.plannedWhy || []).join(", ")}>Planned</span>}
    </span>
  );
}

// THE LADDER STRIP: each rung's givers and dollars, and how many are slipping or moving up.
export function LadderStrip({ data, onNavigate }) {
  if (!data || !data.ladder) return null;
  return (
    <section data-testid="ladder-strip" style={{ ...CARD, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div style={EYEBROW}>Your donor ladder</div>
        <div style={{ fontSize: 12, color: T.ink3 }}>{data.coverage && data.coverage.sentence}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 10 }}>
        {data.ladder.map(l => (
          <div key={l.rung} data-rung={l.rung} title={l.sentence} style={{ background: T.bg, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>{l.label}</div>
            <div style={{ fontFamily: SERIF, fontSize: 22, color: T.ink, lineHeight: 1.2 }}>{l.units.toLocaleString("en-US")}</div>
            <div style={{ fontSize: 12, color: T.ink3 }}>{money(l.cents)} last 12 months</div>
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>
              {l.slipping > 0 && <span style={{ color: T.ink, fontWeight: 700, borderBottom: "2px solid " + T.gold }}>{l.slipping} slipping</span>}
              {l.slipping > 0 && l.up > 0 && " · "}
              {l.up > 0 && <span style={{ color: T.greenDk, fontWeight: 700 }}>{l.up} moving up</span>}
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: T.ink3, margin: "8px 0 0" }}>{data.sentences && data.sentences.ladder} {data.centsSentence} {data.majorLine && data.majorLine.rule}</p>
    </section>
  );
}

function When({ how }) {
  if (!how) return null;
  return (
    <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.55 }}>
      <div><b>Who:</b> {how.who}{how.channel ? ` · ${how.channel}` : ""}{how.when ? ` · ${how.when.words}` : ""}</div>
      {how.say && <div style={{ margin: "6px 0", padding: "8px 10px", background: T.bg, borderRadius: 8, fontStyle: "italic" }}>“{how.say}”</div>}
      {how.ask && <div><b>Ask:</b> {how.ask.words} <span style={{ color: T.ink3 }}>({how.ask.rule})</span></div>}
    </div>
  );
}

function OutcomeButtons({ card, items, onChanged, isReadOnly }) {
  const [mode, setMode] = useState(null);
  const [until, setUntil] = useState(plusDays(14));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (isReadOnly) return null;
  const send = async (state) => {
    setBusy(true);
    try {
      await apiFetch("/insights/outcome", { method: "POST", body: JSON.stringify({ kind: card.kind, itemKeys: items.map(i => i.key), donorIds: items.flatMap(i => i.ids), state,
        until: state === "snoozed" ? until : undefined, reason: state === "dismissed" ? reason : undefined }) });
      setMode(null);
      onChanged && onChanged();
    } finally { setBusy(false); }
  };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
      <button type="button" style={B2} disabled={busy} onClick={() => send("done")}>Done</button>
      {mode !== "snooze" ? <button type="button" style={B2} disabled={busy} onClick={() => setMode("snooze")}>Not now</button>
        : <span><input type="date" aria-label="Show again on" value={until} min={today()} onChange={e => setUntil(e.target.value)} style={{ fontSize: 13, padding: 6, border: "1px solid " + T.bg3, borderRadius: 8 }} /> <button type="button" style={B1} disabled={busy} onClick={() => send("snoozed")}>Snooze</button></span>}
      {mode !== "dismiss" ? <button type="button" style={B2} disabled={busy} onClick={() => setMode("dismiss")}>Doesn't fit</button>
        : <span><input aria-label="Why it doesn't fit (optional)" placeholder="Why (optional)" value={reason} onChange={e => setReason(e.target.value)} style={{ fontSize: 13, padding: 6, border: "1px solid " + T.bg3, borderRadius: 8 }} /> <button type="button" style={B1} disabled={busy} onClick={() => send("dismissed")}>Set aside</button></span>}
    </div>
  );
}

// What Steward can do, each by her click. Nothing sends.
function Does({ card, items, onNavigate, isReadOnly, onDone }) {
  const [msg, setMsg] = useState("");
  if (isReadOnly || !card.does || !card.does.length) return null;
  const lead = items[0];
  const run = async (d) => {
    setMsg("");
    try {
      if (d.action === "draft" || d.action === "brief") {
        if (lead && lead.lead && onNavigate) onNavigate("donors", { selectDonorId: lead.lead, ...(d.action === "brief" ? { openBrief: true } : { openCompose: true }) });
        return;
      }
      if (d.action === "task") {
        let n = 0;
        for (const it of items.slice(0, 50)) {
          if (!it.lead) continue;
          const due = (it.how && it.how.when && it.how.when.from) || today();
          await apiFetch("/tasks", { method: "POST", body: JSON.stringify({ title: `${card.title}: ${it.name}${it.how && it.how.ask && it.how.ask.words ? ". " + it.how.ask.words : ""}`.slice(0, 240), due, type: "donor", donorId: it.lead, priority: "medium" }) });
          n++;
        }
        setMsg(`${n} task${n === 1 ? "" : "s"} made, each dated for when to reach out.`);
        return;
      }
      if (d.action === "group" || d.action === "call_list") {
        const name = `${d.action === "call_list" ? "Call list" : "Group"}: ${card.title} (${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})`;
        const g = await apiFetch("/groups", { method: "POST", body: JSON.stringify({ name, kind: "static", description: card.words && card.words.what }) });
        await apiFetch(`/groups/${g.id}/members`, { method: "POST", body: JSON.stringify({ donorIds: [...new Set(items.flatMap(i => i.ids))] }) });
        setMsg(`Made "${name}". Open it from Groups.`);
        onDone && onDone();
      }
    } catch (e) { setMsg(e.message || "That didn't work. Nothing was changed."); }
  };
  return (
    <div style={{ marginTop: 10 }}>
      <div style={EYEBROW}>Steward can</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {card.does.map(d => <button key={d.action} type="button" style={B1} onClick={() => run(d)}>{d.label}</button>)}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: T.ink, marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

const AS_OPTIONS = [["purchase", "A purchase"], ["ticket", "Tickets"], ["reimbursement", "A reimbursement"]];
const suggestedAs = it => /ticket|raffle/i.test(it.reason || "") ? "ticket" : /reimburse|refund/i.test(it.reason || "") ? "reimbursement" : "purchase";
function ReviewRows({ card, onChanged, isReadOnly }) {
  const [undo, setUndo] = useState(null);
  const [err, setErr] = useState("");
  const [as, setAs] = useState({});
  const decide = async (it, decision) => {
    setErr("");
    try {
      const r = await apiFetch(`/insights/review/${encodeURIComponent(it.giftId)}`, { method: "POST", body: JSON.stringify({ decision, as: as[it.giftId] || suggestedAs(it) }) });
      setUndo({ giftId: it.giftId, sentence: r.sentence || (decision === "keep" ? "Kept as a gift." : "") });
      onChanged && onChanged();
    } catch (e) { setErr(e.message || "That didn't work."); }
  };
  const doUndo = async () => {
    await apiFetch(`/insights/review/${encodeURIComponent(undo.giftId)}/undo`, { method: "POST" });
    setUndo(null);
    onChanged && onChanged();
  };
  return (
    <div>
      {undo && <div role="status" style={{ background: T.bg, borderRadius: 8, padding: "8px 10px", fontSize: 13, marginBottom: 8 }}>{undo.sentence} <button type="button" style={LNK} onClick={doUndo}>Undo</button></div>}
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 8, marginBottom: 8 }}>{err}</div>}
      {card.items.map(it => (
        <div key={it.key} data-testid="review-row" style={{ borderTop: "1px solid " + T.bg2, padding: "10px 0" }}>
          <div style={{ fontSize: 14, color: T.ink }}><b>{money(it.cents)}</b> · {it.name} · {it.date || "no date"}</div>
          <div style={{ fontSize: 13, color: T.ink3 }}>“{it.memo}”. {it.reason}.</div>
          {!isReadOnly && <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={B2} onClick={() => decide(it, "keep")}>Keep as gift</button>
            <select aria-label="What it was" value={as[it.giftId] || suggestedAs(it)} onChange={e => setAs({ ...as, [it.giftId]: e.target.value })}
              style={{ fontSize: 13, padding: "7px 8px", border: "1px solid " + T.bg3, borderRadius: 8, background: T.white, color: T.ink, fontFamily: "inherit" }}>
              {AS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" style={B1} onClick={() => decide(it, "not_gift")}>Not a gift</button>
          </div>}
        </div>
      ))}
      {!isReadOnly && <p style={{ fontSize: 12, color: T.ink3, margin: "6px 0 0" }}>Not a gift keeps the row: it leaves every giving total and stays in Finance as revenue.</p>}
    </div>
  );
}

function FamilyRows({ card, onChanged, onNavigate, isReadOnly }) {
  const decide = async (it, decision) => {
    await apiFetch("/insights/link", { method: "POST", body: JSON.stringify({ networkKey: it.key, decision, leadIds: (it.members || []).map(m => m.lead) }) });
    onChanged && onChanged();
  };
  return card.items.slice(0, 8).map(it => (
    <div key={it.key} data-testid="family-row" style={{ borderTop: "1px solid " + T.bg2, padding: "10px 0" }}>
      <div style={{ fontSize: 14, color: T.ink }}>These {(it.members || []).length} records look like one family: {(it.members || []).map((m, i) => (
        <span key={m.lead}>{i ? ", " : ""}<DonorLink id={m.lead} onOpen={() => onNavigate && onNavigate("donors", { selectDonorId: m.lead })} style={LNK}>{m.name}</DonorLink></span>))}.</div>
      <div style={{ fontSize: 13, color: T.ink3 }}>{(it.reasons || []).slice(0, 3).join(". ")}. Together: {money(it.cents)}.</div>
      {!isReadOnly && <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button type="button" style={B1} onClick={() => decide(it, "link")}>Link</button>
        <button type="button" style={B2} onClick={() => decide(it, "not_related")}>Not related</button>
      </div>}
    </div>
  ));
}

// THE ONE CARD.
export function InsightCard({ card, onNavigate, onChanged, isReadOnly, compact }) {
  const [open, setOpen] = useState(false);
  if (!card || !card.items || !card.items.length) return null;
  const special = card.kind === "review" || card.kind === "family";
  return (
    <article data-testid="insight-card" data-kind={card.kind} style={CARD}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={EYEBROW}>{card.rungLabel ? `${card.rungLabel} · ` : ""}{card.title}</div>
        {card.cents > 0 && card.kind !== "pace" && <div style={{ fontSize: 12, color: T.ink3 }}>{money(card.cents)} at stake</div>}
      </div>
      <p style={{ fontFamily: SERIF, fontSize: 19, color: T.ink, margin: "6px 0 4px", lineHeight: 1.3 }}>{card.words.what}</p>
      <p style={{ fontSize: 13, color: T.ink3, margin: "0 0 10px", lineHeight: 1.5 }}><b style={{ color: T.ink }}>Why:</b> {card.words.why}</p>
      {card.kind === "review" ? <ReviewRows card={card} onChanged={onChanged} isReadOnly={isReadOnly} />
        : card.kind === "family" ? <FamilyRows card={card} onChanged={onChanged} onNavigate={onNavigate} isReadOnly={isReadOnly} />
        : card.kind === "pace" ? null
        : <>
          <div style={EYEBROW}>How · {card.items[0].name}</div>
          <When how={card.how} />
          {card.items.length > 1 && (
            <button type="button" style={{ ...LNK, marginTop: 8 }} aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Hide the people" : `Show all ${card.items.length} people`}
            </button>
          )}
          {open && (
            <ul data-testid="insight-people" style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
              {card.items.map(it => (
                <li key={it.key} style={{ borderTop: "1px solid " + T.bg2, padding: "8px 0", fontSize: 13 }}>
                  <DonorLink id={it.lead} onOpen={() => onNavigate && onNavigate("donors", { selectDonorId: it.lead })} style={LNK}>{it.name}</DonorLink>
                  <span style={{ color: T.ink3 }}> · {it.facts.map(f => `${f[0]} ${f[1]}`).join(" · ")}</span>
                  {it.how && it.how.ask && <div style={{ color: T.ink }}>{it.how.ask.words}{it.how.when ? ` ${it.how.when.words}.` : ""}</div>}
                </li>
              ))}
            </ul>
          )}
          {!compact && <Does card={card} items={card.items} onNavigate={onNavigate} isReadOnly={isReadOnly} onDone={onChanged} />}
          <OutcomeButtons card={card} items={card.items} onChanged={onChanged} isReadOnly={isReadOnly} />
        </>}
      {special && <p style={{ fontSize: 12, color: T.ink3, margin: "8px 0 0" }}>Nothing changes until you choose.</p>}
    </article>
  );
}

// The cards she was shown, posted once per load (a GET never writes).
function useSeen(cards) {
  const key = useMemo(() => (cards || []).map(c => c.kind + c.items.length).join("|"), [cards]);
  useEffect(() => {
    if (!cards || !cards.length) return;
    const items = cards.filter(c => c.kind !== "pace").flatMap(c => c.items.slice(0, 50).map(it => ({ kind: c.kind, itemKey: it.key, donorIds: it.ids })));
    if (items.length) apiFetch("/insights/seen", { method: "POST", body: JSON.stringify({ items }) }).catch(() => {});
  }, [key]);
}

export function useInsights(view) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = () => apiFetch(`/insights${view ? "?view=" + view : ""}`).then(r => { setData(r); setErr(""); }).catch(e => setErr(e.message || "Couldn't read the cards."));
  useEffect(() => { load(); }, [view]);
  return [data, load, err];
}

// HOME: the ladder first, then the cards in rank order.
export function HomeInsights({ onNavigate, isReadOnly }) {
  const [data, load, err] = useInsights("");
  const [showAll, setShowAll] = useState(false);
  const [look, setLook] = useState(false);
  useSeen(data && data.cards);
  if (err) return null;
  if (!data) return <div style={{ ...CARD, color: T.ink3, fontSize: 13 }}>Reading your donors…</div>;
  const cards = data.cards || [];
  return (
    <section data-testid="home-insights" style={{ marginBottom: 18 }}>
      {data.coverage && data.coverage.stale && (
        <div role="note" style={{ ...CARD, borderLeft: "4px solid " + T.gold, fontSize: 14, color: T.ink }}>{data.coverage.sentence}</div>
      )}
      {look && <div role="dialog" aria-modal="true" aria-label="What your data says" onClick={e => { if (e.target === e.currentTarget) setLook(false); }}
        style={{ position: "fixed", inset: 0, background: "rgba(15,26,18,0.45)", zIndex: 60, overflowY: "auto", padding: "24px 16px" }}>
        <FirstLook onNavigate={(...a) => { setLook(false); onNavigate && onNavigate(...a); }} isReadOnly={isReadOnly} onClose={() => { setLook(false); load(); }} />
      </div>}
      <LadderStrip data={data} onNavigate={onNavigate} />
      <div style={{ margin: "-4px 0 10px" }}><button type="button" style={LNK} onClick={() => setLook(true)}>What your data says</button></div>
      {(showAll ? cards : cards.slice(0, 4)).map(c => <InsightCard key={c.kind} card={c} onNavigate={onNavigate} onChanged={load} isReadOnly={isReadOnly} />)}
      {cards.length > 4 && <button type="button" style={LNK} onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${cards.length} suggestions`}</button>}
      <p style={{ fontSize: 12, color: T.ink3 }}>{data.sentences && data.sentences.never}</p>
    </section>
  );
}

// THE FIRST LOOK: "What your file says", after an import and on demand from Home.
export function FirstLook({ onNavigate, isReadOnly, onClose }) {
  const [data, load, err] = useInsights("first");
  useSeen(data && data.cards);
  return (
    <section data-testid="first-look" aria-label="What your file says" style={{ background: T.ground || T.bg, borderRadius: 16, padding: "18px 18px 8px", maxWidth: 880, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h2 style={{ fontFamily: SERIF, fontSize: 26, color: T.ink, margin: 0, fontWeight: 400 }}>What your file says</h2>
        {onClose && <button type="button" style={B2} onClick={onClose}>Go to Home</button>}
      </div>
      {err && <p style={{ fontSize: 14, color: T.ink }}>{err}</p>}
      {!data && !err && <p style={{ fontSize: 14, color: T.ink3 }}>Reading the file…</p>}
      {data && <>
        <p data-testid="first-look-coverage" style={{ fontSize: 14, color: T.ink, margin: "6px 0 12px" }}>{data.coverage.sentence}</p>
        <LadderStrip data={data} onNavigate={onNavigate} />
        {data.cards.map(c => <InsightCard key={c.kind} card={c} onNavigate={onNavigate} onChanged={load} isReadOnly={isReadOnly} />)}
        <p style={{ fontSize: 12, color: T.ink3 }}>{data.sentences.never}</p>
      </>}
    </section>
  );
}

// THE PROFILE: rung, status, the signals, and the one next move.
export function ProfileLadder({ donorId, onNavigate, isReadOnly }) {
  const [d, setD] = useState(null);
  const load = () => apiFetch(`/insights/donor/${encodeURIComponent(donorId)}`).then(setD).catch(() => setD(null));
  useEffect(() => { if (donorId) load(); }, [donorId]);
  if (!d || !d.unit) return null;
  const u = d.unit, m = d.move;
  return (
    <div data-testid="profile-ladder" style={{ marginTop: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        <RungChips unit={u} />
        {(u.signals || []).slice(0, 5).map(s => <span key={s} style={{ fontSize: 12, color: T.ink3, marginRight: 8 }}>{s}</span>)}
      </div>
      {u.undatedNote && <div style={{ fontSize: 13, color: T.ink, marginTop: 4, borderLeft: "3px solid " + T.gold, paddingLeft: 8 }}>{u.undatedNote}</div>}
      {(d.notGifts || []).length > 0 && <div data-testid="profile-not-gifts" style={{ fontSize: 13, color: T.ink3, marginTop: 4 }} title="Marked Not a gift in Review: in Finance as revenue, not in their giving.">
        Also paid, not gifts: {d.notGifts.map(x => `${x.label} ${money(x.cents)}${x.date ? ` (${x.date})` : ""}`).join(", ")}.</div>}
      {d.combined && <div style={{ fontSize: 13, color: T.ink, marginTop: 4 }} title={d.combined.sentence}>With {d.combined.names.join(", ")}: {money(d.combined.cents)} together.</div>}
      {m && m.item && (
        <div data-testid="profile-next-move" style={{ background: T.bg, borderRadius: 10, padding: "10px 12px", marginTop: 8 }}>
          <div style={EYEBROW}>Next move · {m.title}</div>
          <div style={{ fontSize: 13, color: T.ink, margin: "4px 0" }}>{m.item.facts.map(f => `${f[0]} ${f[1]}`).join(" · ")}</div>
          <When how={m.item.how} />
          <OutcomeButtons card={{ kind: m.kind }} items={[m.item]} onChanged={load} isReadOnly={isReadOnly} />
        </div>
      )}
    </div>
  );
}

// REPORTS: what happened after each kind of card.
const KIND_LABEL = { review: "Rows that may not be gifts", year_end: "Year-end givers due", sponsors: "Sponsors to renew", second_gift: "First gift, no second yet",
  upgraded: "Upgraded on their own", major_slipping: "Major donor slipping", pledges: "Open pledges to collect", planned: "Planned-gift signals", family: "Family or network to link" };
export function WhatWorked() {
  const [d, setD] = useState(null);
  useEffect(() => { apiFetch("/insights/worked").then(setD).catch(() => setD(null)); }, []);
  if (!d) return null;
  return (
    <section data-testid="what-worked" style={CARD}>
      <div style={EYEBROW}>What worked</div>
      <p style={{ fontSize: 13, color: T.ink3, margin: "4px 0 10px" }}>{d.sentence}</p>
      {!d.rows.length ? <p style={{ fontSize: 14, color: T.ink }}>No suggestions shown yet. They start counting the first time Home shows them.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", color: T.ink3 }}><th style={{ padding: 6 }}>Suggestion</th><th style={{ padding: 6 }}>Shown</th><th style={{ padding: 6 }}>Done</th><th style={{ padding: 6 }}>Gave within {d.days} days</th><th style={{ padding: 6 }}>Dollars</th></tr></thead>
            <tbody>{d.rows.map(r => (
              <tr key={r.kind} style={{ borderTop: "1px solid " + T.bg2 }}>
                <td style={{ padding: 6 }}>{KIND_LABEL[r.kind] || r.kind}</td><td style={{ padding: 6 }}>{r.shown}</td><td style={{ padding: 6 }}>{r.acted}</td><td style={{ padding: 6 }}>{r.followed}</td><td style={{ padding: 6 }}>{money(r.cents)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
