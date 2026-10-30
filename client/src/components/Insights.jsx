// INSIGHTS-1 · WHO TO CALL, WHY, AND EXACTLY WHAT TO SAY.
//
// One card component (InsightCard), used on Home, the first look and the
// profile. Every card is What (the facts, with dates and amounts, and the
// people), Why (one sentence), How (who, when, the channel, what to say, the
// ask and its rule) and what Steward can do, each needing her click. Nothing
// here sends anything: a draft opens the person's profile, a task and a group
// are made by her button. The facts and the words come from the server
// (insights.js); this file draws them.
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { DonorLink } from "./RecordLink";
import EventRaised from "./EventRaised";   // HOME-3: the first look's events
import { countLabel } from "../../../shared/countWords.js";

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
// FIX-59: showCoverage is false where the page above already says the coverage line (the first look)
export function LadderStrip({ data, onNavigate, showCoverage = true }) {
  if (!data || !data.ladder) return null;
  return (
    <section data-testid="ladder-strip" style={{ ...CARD, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div style={EYEBROW}>Your donor ladder</div>
        {showCoverage && <div style={{ fontSize: 12, color: T.ink3 }}>{data.coverage && data.coverage.sentence}</div>}
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
        setMsg(`${countLabel(n, "task")} made, each dated for when to reach out.`);
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
  const [partlyOpen, setPartlyOpen] = useState(null);   // the row whose value received is being entered
  const [value, setValue] = useState("");
  const decide = async (it, decision) => {
    setErr("");
    if (decision === "partly") {
      // HOME-3: the value received, in dollars, more than $0 and less than the row
      const v = Number(String(value).replace(/[$,\s]/g, ""));
      if (!(v > 0) || Math.round(v * 100) >= it.cents) { setErr(`Enter the value they received: more than $0 and less than ${money(it.cents)}.`); return; }
    }
    try {
      const r = await apiFetch(`/insights/review/${encodeURIComponent(it.giftId)}`, { method: "POST",
        body: JSON.stringify({ decision, as: as[it.giftId] || suggestedAs(it), ...(decision === "partly" ? { value: String(value).replace(/[$,\s]/g, "") } : {}) }) });
      if (decision === "partly") { setPartlyOpen(null); setValue(""); }
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
            {it.partly !== false && partlyOpen !== it.giftId && <button type="button" style={B2} onClick={() => { setPartlyOpen(it.giftId); setValue(""); setErr(""); }}>Partly a gift</button>}
            <button type="button" style={B1} onClick={() => decide(it, "not_gift")}>Not a gift</button>
          </div>}
          {!isReadOnly && it.partly !== false && partlyOpen === it.giftId && (
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ fontSize: 13, color: T.ink }}>Value they received $
                <input aria-label="Value they received" inputMode="decimal" autoFocus value={value} onChange={e => setValue(e.target.value)} placeholder="0.00"
                  style={{ width: 96, marginLeft: 4, fontSize: 13, padding: "7px 8px", border: "1px solid " + T.bg3, borderRadius: 8, background: T.white, color: T.ink, fontFamily: "inherit" }} />
              </label>
              <button type="button" style={B1} onClick={() => decide(it, "partly")}>Save: partly a gift</button>
              <button type="button" style={LNK} onClick={() => setPartlyOpen(null)}>Cancel</button>
            </div>
          )}
        </div>
      ))}
      {!isReadOnly && <p style={{ fontSize: 12, color: T.ink3, margin: "6px 0 0" }}>Not a gift keeps the row: it leaves every giving total and stays in Finance as revenue. Partly a gift moves only the value they received (two tickets, a dinner, an item's worth) to Finance; the rest stays a gift, and its receipt says what they received. Raffle tickets are never a gift, not even in part.</p>}
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

export function useInsights(view, skip) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = () => apiFetch(`/insights${view ? "?view=" + view : ""}`).then(r => { setData(r); setErr(""); }).catch(e => setErr(e.message || "Couldn't read the cards."));
  useEffect(() => { if (!skip) load(); }, [view, skip]);
  return [data, load, err];
}

// THE FULL LADDER: the ladder, then every card in rank order. Home keeps it
// one click away ("See your ladder"); the deck is what Home leads with.
export function HomeInsights({ onNavigate, isReadOnly, data: given, onChanged, only }) {
  const [own, load, err] = useInsights("", !!given);
  const data = given || own;
  // HOME-4: a panel over Home reads its own cards; an action re-reads them and tells Home's deck.
  const reload = () => { if (!given) load(); if (onChanged) onChanged(); };
  const [look, setLook] = useState(false);
  useSeen(data && data.cards);
  if (err && !given) return null;
  if (!data) return <div style={{ ...CARD, color: T.ink3, fontSize: 13 }}>Reading your donors…</div>;
  const cards = (data.cards || []).filter(c => !only || c.kind === only);
  return (
    <section data-testid="home-insights" style={{ marginBottom: 18 }}>
      {!only && data.coverage && data.coverage.stale && (
        <div role="note" style={{ ...CARD, borderLeft: "4px solid " + T.gold, fontSize: 14, color: T.ink }}>{data.coverage.sentence}</div>
      )}
      {look && <div role="dialog" aria-modal="true" aria-label="What your data says" onClick={e => { if (e.target === e.currentTarget) setLook(false); }}
        style={{ position: "fixed", inset: 0, background: "rgba(15,26,18,0.45)", zIndex: 60, overflowY: "auto", padding: "24px 16px" }}>
        <FirstLook onNavigate={(...a) => { setLook(false); onNavigate && onNavigate(...a); }} isReadOnly={isReadOnly} onClose={() => { setLook(false); reload(); }} />
      </div>}
      {!only && <LadderStrip data={data} onNavigate={onNavigate} showCoverage={!(data.coverage && data.coverage.stale)} />}
      {!only && <div style={{ margin: "-4px 0 10px" }}><button type="button" style={LNK} onClick={() => setLook(true)}>What your data says</button></div>}
      {cards.map(c => <InsightCard key={c.kind} card={c} onNavigate={onNavigate} onChanged={reload} isReadOnly={isReadOnly} />)}
      <p style={{ fontSize: 12, color: T.ink3 }}>{data.sentences && data.sentences.never}</p>
    </section>
  );
}

// ── HOME-3 · YOUR MOVES ─────────────────────────────────────────────────────
// The ladder as tabs over one card. Each card is one person or organisation
// (GET /insights deck, insights.js buildDeck): the kind, the name, what is
// happening, why it matters, the line to say, who, when and the ask with its
// rule. One button does the card's thing (it makes a task dated for when to
// reach out; nothing sends), and Done, Not now and Doesn't fit are recorded as
// outcomes. Every move in a tab is reachable by the buttons; the arrow keys
// work while the deck has focus, and a phone swipes. All the moves arrive in
// one read, so the next card is already here when she advances.
const DECK_CSS = `
.moves-tabs { display: flex; gap: 10px; flex-wrap: wrap; }
.moves-tab { text-align: left; border-radius: 14px; padding: 11px 16px; min-width: 132px; min-height: 44px; cursor: pointer; font-family: inherit;
  background: ${T.white}; color: ${T.ink}; border: 1px solid ${T.bg3}; }
.moves-tab[aria-selected="true"] { background: ${T.greenDk}; color: ${T.white}; border-color: ${T.greenDk}; }
.moves-tab:focus-visible, .moves-deck:focus-visible, .moves-btn:focus-visible { outline: 2px solid ${T.greenDk}; outline-offset: 2px; }
.moves-card { background: ${T.bg}; border-radius: 18px; padding: 28px 30px; display: flex; flex-direction: column; gap: 14px; touch-action: pan-y; }
.moves-card[data-slide="next"] { animation: movesInNext 180ms ease-out; }
.moves-card[data-slide="prev"] { animation: movesInPrev 180ms ease-out; }
@keyframes movesInNext { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes movesInPrev { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .moves-card[data-slide] { animation: none; } }
.moves-swipe { display: none; }
.moves-facts { display: flex; gap: 28px; flex-wrap: wrap; font-size: 14.5px; }
.moves-btn { border-radius: 12px; padding: 12px 20px; font-size: 14.5px; font-weight: 700; cursor: pointer; font-family: inherit; min-height: 44px; }
.moves-round { width: 44px; height: 44px; border-radius: 999px; border: 1px solid ${T.bg3}; background: ${T.white}; color: ${T.ink}; font-size: 20px; cursor: pointer; line-height: 1; }
@media (max-width: 640px) {
  .moves-tabs { flex-wrap: nowrap; overflow-x: auto; margin: 0 -2px; padding-bottom: 2px; }
  .moves-tab { min-width: 0; flex: none; padding: 9px 14px; border-radius: 999px; }
  .moves-tab .moves-stake { display: none !important; }
  .moves-acts { display: grid !important; grid-template-columns: 1fr 1fr; }
  .moves-acts .moves-spacer { display: none; }
  .moves-swipe { display: inline !important; }
  .moves-nav { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; }
  .moves-card { padding: 20px 18px; border-radius: 16px; }
  .moves-name { font-size: 26px !important; }
}
`;
const BTN_PRIMARY = { background: T.greenDk, color: T.white, border: "1px solid " + T.greenDk };
const BTN_QUIET = { background: T.white, color: T.ink, border: "1px solid " + T.bg3 };
const TASK_TITLE = {
  draft: m => `Note to ${m.name}`, calls: m => `Call ${m.name}`, visit: m => `Visit ${m.name}`,
  brief: m => `Visit ${m.name}: the briefing`, coffee: m => `Coffee with ${m.name}`, collect: m => `Collect from ${m.name}`,
};
// "between Dec 17, 2026 and Dec 31, 2026" reads "Dec 17 – Dec 31, 2026"
const whenWords = w => {
  const b = /^between (\w+ \d+), (\d{4}) and (\w+ \d+, (\d{4}))$/.exec(w || "");
  if (b) return b[2] === b[4] ? `${b[1]} – ${b[3]}` : `${b[1]}, ${b[2]} – ${b[3]}`;
  return String(w || "").replace(/^between /, "").replace(/ and /, " – ").replace(/^on /, "");
};
const shortDay = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// HOME-4 · under the deck, one row of small even chips, each opening its
// screen and hidden at zero: rows to review, possible families, the ladder,
// and Drift (its people are moves in the deck; the chip opens its list).
const MOVE_CHIP = { display: "inline-flex", alignItems: "center", gap: 6, background: T.white, border: "1px solid " + T.bg3, borderRadius: 999, padding: "7px 14px",
  fontSize: 13, fontWeight: 600, color: T.ink, cursor: "pointer", fontFamily: "inherit", minHeight: 36 };
// FIX-59: Grow's count says its split ("85 second gifts · 112 more"), less
// any move she has finished here.
function tabCountWords(t, gone) {
  const n = t.left.length + Math.max(0, t.count - t.moves.length);
  if (!t.split) return n.toLocaleString("en-US");
  const second = Math.max(0, t.split.secondGifts - t.moves.filter(m => m.kind === "second_gift" && gone.has(m.id)).length);
  return `${second.toLocaleString("en-US")} second ${second === 1 ? "gift" : "gifts"} · ${Math.max(0, n - second).toLocaleString("en-US")} more`;
}
function MoveChips({ deck, anyMoves, setPanel, onDrift }) {
  const n = x => x.toLocaleString("en-US");
  const d = deck.drift || {};
  const chips = [
    deck.review && deck.review.count > 0 && { key: "review", text: `${n(deck.review.count)} ${deck.review.count === 1 ? "row" : "rows"} to review`, title: "Rows that may not be gifts: Keep as gift, Partly a gift or Not a gift.", on: () => setPanel("review") },
    deck.family && deck.family.count > 0 && { key: "family", text: `${n(deck.family.count)} possible ${deck.family.count === 1 ? "family" : "families"}`, title: "Groups of records that look like one family or network. Steward links nothing until you say so.", on: () => setPanel("family") },
    anyMoves && { key: "ladder", text: "Your ladder", title: "Every giving unit on its rung, and every card in rank order.", on: () => setPanel("ladder") },
    onDrift && (d.medium > 0 || d.high > 0) && { key: "drift", text: d.medium > 0 ? `Drift · ${n(d.medium)} early ${d.medium === 1 ? "sign" : "signs"}` : `Drift · ${n(d.high)} past their pattern`,
      title: "Drift watches each donor's own giving rhythm. The people past it are in your moves; this opens the whole list, early signs too.", on: onDrift },
  ].filter(Boolean);
  if (!chips.length) return null;
  return (
    <div data-testid="moves-chips" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {chips.map(c => <button key={c.key} type="button" data-testid={"moves-chip-" + c.key} title={c.title} style={MOVE_CHIP} onClick={c.on}>{c.text}</button>)}
    </div>
  );
}

// HOME-4 · an org with no donors yet: one friendly card, never empty tabs.
function NoDonorsCard({ onNavigate, sample }) {
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { await apiFetch("/org/load-sample-data", { method: "POST" }); window.location.reload(); } catch { setBusy(false); }
  };
  return (
    <div data-testid="moves-no-donors" style={{ background: T.bg, borderRadius: 18, padding: "26px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 17, lineHeight: 1.5, color: T.ink }}>Bring in your donors and Steward will show you who to call first.</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="moves-btn" data-testid="moves-import" style={BTN_PRIMARY} onClick={() => onNavigate && onNavigate("donors", { openImport: true })}>Import a spreadsheet</button>
        {sample && <button type="button" className="moves-btn" data-testid="moves-sample" style={BTN_QUIET} disabled={busy} onClick={load}>{busy ? "Loading sample data…" : "Explore with sample data"}</button>}
      </div>
    </div>
  );
}

export function HomeMoves({ onNavigate, isReadOnly, noDonors = false, sample = false, drift = null }) {
  // HOME-4: the deck alone; the ladder and "See all" panels read the cards when they open.
  const [data, load, err] = useInsights("deck");
  const [tab, setTab] = useState(null);
  const [pos, setPos] = useState({});            // tab -> index
  const [gone, setGone] = useState(() => new Set());   // move ids acted on here
  const [slide, setSlide] = useState(null);
  const [mode, setMode] = useState(null);
  const [until, setUntil] = useState(plusDays(14));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [panel, setPanel] = useState(null);      // null | "ladder" | a card kind
  const touch = useRef(null);
  const deck = data && data.deck;
  // posted once per load: the moves she was shown (a GET writes nothing)
  const seenKey = deck ? deck.tabs.map(t => t.key + t.count).join("|") : "";
  useEffect(() => {
    if (!deck) return;
    const items = deck.tabs.flatMap(t => t.moves.slice(0, 50).map(m => ({ kind: m.kind, itemKey: m.itemKey, donorIds: m.ids })));
    if (items.length) apiFetch("/insights/seen", { method: "POST", body: JSON.stringify({ items }) }).catch(() => {});
  }, [seenKey]);
  if (err) return null;
  if (!deck) return <section aria-label="Your moves" data-testid="home-moves" style={{ ...CARD, color: T.ink3, fontSize: 14 }}>Reading your donors…</section>;

  const live = t => t.moves.filter(m => !gone.has(m.id));
  const tabs = deck.tabs.map(t => ({ ...t, left: live(t) }));
  const cur = tabs.find(t => t.key === (tab || deck.open)) || tabs[0];
  const moves = cur.left;
  const i = Math.min(pos[cur.key] || 0, Math.max(moves.length - 1, 0));
  const m = moves[i] || null;
  const total = moves.length + Math.max(0, cur.count - cur.moves.length);
  const go = step => {
    if (moves.length < 2) return;
    setMode(null); setMsg(null);
    setSlide(step > 0 ? "next" : "prev");
    setPos({ ...pos, [cur.key]: (i + step + moves.length) % moves.length });
  };
  // the move leaves this deck; the next one takes its place
  const advance = () => {
    setGone(new Set([...gone, m.id]));
    setSlide("next");
    setPos({ ...pos, [cur.key]: moves.length - 1 > i ? i : 0 });
    setMode(null); setReason("");
  };
  const outcome = async (state, extra) => {
    await apiFetch("/insights/outcome", { method: "POST", body: JSON.stringify({ kind: m.kind, itemKeys: [m.itemKey], donorIds: m.ids, state, ...extra }) });
  };
  const act = async (state, extra, said) => {
    if (!m || busy) return;
    setBusy(true); setMsg(null);
    try { await outcome(state, extra); advance(); setMsg(said ? { text: said } : null); }
    catch (e) { setMsg({ text: e.message || "That didn't work. Nothing was changed.", err: true }); }
    finally { setBusy(false); }
  };
  const doAction = async () => {
    if (!m || busy) return;
    setBusy(true); setMsg(null);
    try {
      const due = m.whenFrom && m.whenFrom > today() ? m.whenFrom : today();
      const notes = [m.what, m.say ? `Say: "${m.say}"` : null, m.ask ? `Ask: ${m.ask.words} (${m.ask.rule})` : null, m.why ? `Why: ${m.why}` : null].filter(Boolean).join("\n\n");
      await apiFetch("/tasks", { method: "POST", body: JSON.stringify({ title: TASK_TITLE[m.action.key](m).slice(0, 240), due, type: "donor", donorId: m.lead, priority: "medium", kind: m.action.taskKind, notes }) });
      await outcome("done");
      advance();
      setMsg({ text: `${TASK_TITLE[m.action.key](m)} is on your tasks for ${shortDay(due)}${m.action.key === "draft" ? ", with the note drafted in it" : ""}. Nothing was sent.`, tasks: true });
    } catch (e) { setMsg({ text: e.message || "That didn't work. Nothing was changed.", err: true }); }
    finally { setBusy(false); }
  };
  const onKey = e => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  };
  const onTouchStart = e => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = e => {
    const s = touch.current; touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };
  const pick = k => { setTab(k); setMode(null); setMsg(null); setSlide(null); };
  const anyMoves = tabs.some(t => t.count > 0);

  return (
    <section aria-label="Your moves" data-testid="home-moves" className="moves-deck" tabIndex={0} onKeyDown={onKey}
      style={{ display: "flex", flexDirection: "column", gap: 18, borderRadius: 12 }}>
      <style>{DECK_CSS}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: SERIF, fontSize: 28, fontWeight: 400, color: T.ink }}>Your moves</h2>
        {/* HOME-4: said only above a card that has a note to say */}
        {m && m.say && !noDonors && <div data-testid="moves-never" style={{ fontSize: 13, color: T.ink3 }}>{data.sentences && data.sentences.never}</div>}
      </div>
      {data.coverage && data.coverage.stale && <div role="note" style={{ fontSize: 13.5, color: T.ink, borderLeft: "3px solid " + T.gold, paddingLeft: 10 }}>{data.coverage.sentence}</div>}
      {noDonors && !anyMoves ? <NoDonorsCard onNavigate={onNavigate} sample={sample} /> : !anyMoves ? (
        <div data-testid="moves-empty" style={{ background: T.bg, borderRadius: 16, padding: "26px 24px", fontSize: 15, color: T.ink, lineHeight: 1.55 }}>
          No moves yet. Once gifts are in Steward, the people to reach out to, and what to say, show here one at a time.
        </div>
      ) : <>
        <div role="tablist" aria-label="Your moves by rung" className="moves-tabs">
          {/* HOME-4: a tab with no moves is not drawn (no zeros as headlines) */}
          {tabs.filter(t => t.count > 0 || t.key === cur.key).map(t => (
            <button key={t.key} type="button" role="tab" className="moves-tab" data-testid={`moves-tab-${t.key}`} data-count={t.left.length + Math.max(0, t.count - t.moves.length)}
              aria-selected={t.key === cur.key} onClick={() => pick(t.key)} title={deck.sentence}>
              <span style={{ display: "block", fontSize: 14.5, fontWeight: 700 }}>{t.label} · {tabCountWords(t, gone)}</span>
              <span className="moves-stake" style={{ display: "block", fontSize: 12.5, marginTop: 2, opacity: 0.85 }}>
                {t.key === "planned" ? `${(t.left.length).toLocaleString("en-US")} ${t.left.length === 1 ? "person" : "people"}` : `${money(t.left.reduce((n, x) => n + (x.cents || 0), 0))} at stake`}</span>
            </button>
          ))}
        </div>
        {m ? (
          <article key={m.id} className="moves-card" data-testid="move-card" data-move={m.id} data-slide={slide || undefined}
            onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-roledescription="move" aria-label={`${m.name}, ${i + 1} of ${total}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ ...EYEBROW, color: T.gold700 }}>{m.label}</div>
              <div data-testid="move-pos" style={{ fontSize: 13, color: T.ink3 }}>{i + 1} of {total}</div>
            </div>
            <h3 className="moves-name" style={{ margin: 0, fontFamily: SERIF, fontSize: 34, fontWeight: 400, lineHeight: 1.12, color: T.ink }}>
              <DonorLink id={m.lead} onOpen={() => onNavigate && onNavigate("donors", { selectDonorId: m.lead })} style={{ color: T.ink, textDecoration: "none" }}>{m.name}</DonorLink>
            </h3>
            <p data-testid="move-what" style={{ margin: 0, fontSize: 16.5, lineHeight: 1.55, color: T.ink }}>{m.what}</p>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: T.ink3 }}><b style={{ color: T.ink }}>Why:</b> {m.why}</p>
            {m.say && <blockquote style={{ margin: 0, background: T.white, borderRadius: 12, padding: "14px 16px", fontSize: 15.5, lineHeight: 1.55, fontStyle: "italic", color: T.ink }}>“{m.say}”</blockquote>}
            <div className="moves-facts">
              {m.who && <div><span style={{ color: T.ink3 }}>Who</span><br /><b>{m.who}{m.channel ? ` · ${m.channel.toLowerCase()}` : ""}</b></div>}
              {m.when && <div><span style={{ color: T.ink3 }}>When</span><br /><b>{whenWords(m.when)}</b></div>}
              {m.ask && <div style={{ flex: "1 1 260px" }}><span style={{ color: T.ink3 }}>Ask</span><br /><b data-testid="move-ask">{m.ask.words}</b><div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>{m.ask.rule}</div></div>}
            </div>
            {(m.also || []).length > 0 && (
              <div data-testid="move-also" style={{ fontSize: 13.5, color: T.ink3, lineHeight: 1.5 }}>
                {m.also.map(a => <div key={a.kind}><b style={{ color: T.ink }}>Also {a.label.toLowerCase()}:</b> {a.line}</div>)}
              </div>
            )}
            {mode === "snooze" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 14 }}>
                <label htmlFor="move-until">Show again on</label>
                <input id="move-until" type="date" value={until} min={today()} onChange={e => setUntil(e.target.value)} style={{ fontSize: 14, padding: 8, border: "1px solid " + T.bg3, borderRadius: 10 }} />
                <button type="button" className="moves-btn" style={BTN_PRIMARY} disabled={busy} onClick={() => act("snoozed", { until }, `${m.name} comes back on ${shortDay(until)}.`)}>Snooze</button>
                <button type="button" className="moves-btn" style={BTN_QUIET} onClick={() => setMode(null)}>Cancel</button>
              </div>
            )}
            {mode === "dismiss" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 14 }}>
                <input aria-label="Why it doesn't fit (optional)" placeholder="Why (optional)" value={reason} onChange={e => setReason(e.target.value)} style={{ fontSize: 14, padding: 9, border: "1px solid " + T.bg3, borderRadius: 10, flex: "1 1 200px" }} />
                <button type="button" className="moves-btn" style={BTN_PRIMARY} disabled={busy} onClick={() => act("dismissed", { reason }, `Set aside. ${m.name} won't show here again.`)}>Set aside</button>
                <button type="button" className="moves-btn" style={BTN_QUIET} onClick={() => setMode(null)}>Cancel</button>
              </div>
            )}
            <div className="moves-acts" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
              {!isReadOnly && <button type="button" className="moves-btn" data-testid="move-action" style={BTN_PRIMARY} disabled={busy} onClick={doAction}>{m.action.label}</button>}
              {!isReadOnly && <button type="button" className="moves-btn" data-testid="move-not-now" style={BTN_QUIET} disabled={busy} onClick={() => setMode(mode === "snooze" ? null : "snooze")}>Not now</button>}
              {!isReadOnly && <button type="button" className="moves-btn" data-testid="move-not-fit" style={BTN_QUIET} disabled={busy} onClick={() => setMode(mode === "dismiss" ? null : "dismiss")}>Doesn't fit</button>}
              {!isReadOnly && <button type="button" data-testid="move-done" style={LNK} disabled={busy} onClick={() => act("done", {}, `Done. ${m.name} is off your moves.`)}>Done</button>}
              <div className="moves-spacer" style={{ flex: 1 }} />
              <div className="moves-nav" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button type="button" className="moves-round" data-testid="move-prev" aria-label="Previous move" disabled={moves.length < 2} onClick={() => go(-1)}>‹</button>
                <span className="moves-swipe" style={{ fontSize: 12, color: T.ink3 }}>{moves.length > 1 ? "Swipe for the next move" : ""}</span>
                <button type="button" className="moves-round" data-testid="move-next" aria-label="Next move" disabled={moves.length < 2} onClick={() => go(1)}>›</button>
              </div>
            </div>
            {m.group && m.group.count > 1 && (
              <div style={{ fontSize: 13, color: T.ink3 }}>
                One of {m.group.count} in {m.group.title.toLowerCase()} · <button type="button" style={LNK} data-testid="move-see-all"
                  onClick={() => (m.group.eventId && onNavigate ? onNavigate("events", { eventId: m.group.eventId }) : setPanel(m.kind))}>See all {m.group.count}</button>
              </div>
            )}
          </article>
        ) : (
          <div data-testid="moves-caught-up" style={{ background: T.bg, borderRadius: 18, padding: "36px 28px", textAlign: "center", fontSize: 16, color: T.ink }}>All caught up on this one.</div>
        )}
        {msg && <div role="status" style={{ fontSize: 13.5, color: T.ink, ...(msg.err ? { borderLeft: "3px solid " + T.gold, paddingLeft: 8 } : {}) }}>
          {msg.text}{msg.tasks && onNavigate && <> <button type="button" style={LNK} onClick={() => onNavigate("tasks")}>Open Tasks</button></>}</div>}
      </>}
      {!noDonors && <MoveChips deck={deck} anyMoves={anyMoves} setPanel={setPanel} onDrift={drift} />}
      {panel && (
        <div role="dialog" aria-modal="true" aria-label={panel === "ladder" ? "Your donor ladder" : "Every move of this kind"} onClick={e => { if (e.target === e.currentTarget) setPanel(null); }}
          onKeyDown={e => { if (e.key === "Escape") setPanel(null); e.stopPropagation(); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,26,18,0.45)", zIndex: 60, overflowY: "auto", padding: "24px 16px" }}>
          <div style={{ background: T.ground || T.bg, borderRadius: 16, padding: "18px 18px 8px", maxWidth: 880, margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" className="moves-btn" style={BTN_QUIET} onClick={() => { setPanel(null); load(); setGone(new Set()); }}>Close</button></div>
            <HomeInsights onChanged={() => { load(); setGone(new Set()); }} onNavigate={(...a) => { setPanel(null); onNavigate && onNavigate(...a); }} isReadOnly={isReadOnly} only={panel === "ladder" ? null : panel} />
          </div>
        </div>
      )}
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
        {/* HOME-3: what each recent event raised, the way she says it. */}
        {(data.events || []).length > 0 && <div data-testid="first-look-events" style={{ margin: "0 0 12px" }}>
          {data.events.map(e => <EventRaised key={e.id} e={e} />)}
        </div>}
        <LadderStrip data={data} onNavigate={onNavigate} showCoverage={false} />
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
  upgraded: "Upgraded on their own", major_slipping: "Major donor slipping", pledges: "Open pledges to collect", planned: "Planned-gift signals", family: "Family or network to link",
  lapsing: "Lapsing donors" };
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

// PROFILE-2 · THE NEXT MOVE, AS ONE CARD. A brass eyebrow (the kind of move),
// the move as one plain sentence in the serif, Why in a sentence, the words in
// the person's own voice in a quiet box, then the one emerald button, Done,
// Not now and Doesn't fit, and the ask on the right. No field labels and no
// rung chips: the profile's one tag set is the header's. With no move it is
// one quiet line, so the timeline moves up.
export function ProfileNextMove({ donorId, firstName, isReadOnly, onDraft, aiOn }) {
  const [d, setD] = useState(undefined);
  const [copied, setCopied] = useState(false);
  const load = () => apiFetch(`/insights/donor/${encodeURIComponent(donorId)}`).then(setD).catch(() => setD(null));
  useEffect(() => { if (donorId) { setD(undefined); load(); } }, [donorId]);
  if (d === undefined) return <div data-testid="dp-next-move-loading" style={{ height: 22 }} />;
  const m = d && d.move;
  if (!m || !m.item) {
    return <div data-testid="dp-next-move-none" style={{ fontSize: 14, color: T.ink3, padding: "2px 2px" }}>
      {firstName ? `Nothing due for ${firstName} right now.` : "Nothing due right now."}</div>;
  }
  const how = m.item.how || {};
  const sentence = [how.channel, how.when && how.when.words].filter(Boolean).length
    ? `${m.title}: ${String(how.channel || "reach out").toLowerCase()}${how.when && how.when.words ? `, ${how.when.words}` : ""}.`
    : `${m.title}.`;
  const copy = () => { try { navigator.clipboard.writeText(how.say || ""); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard refused */ } };
  return (
    <section data-testid="profile-next-move" style={{ background: T.white, border: "1px solid " + T.bg3, borderRadius: 14, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: T.gold700 }}>Next move · {m.title}</div>
      <div data-testid="dp-next-move-sentence" style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 21, lineHeight: 1.3, color: T.ink }}>{sentence}</div>
      {m.why && <div data-testid="dp-next-move-why" style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}><b>Why:</b> {m.why}</div>}
      {how.say && <div data-testid="dp-next-move-draft" style={{ background: T.bg, borderRadius: 10, padding: "10px 14px", fontSize: 14, lineHeight: 1.55, color: T.ink }}>“{how.say}”</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {!isReadOnly && (aiOn && onDraft
            ? <button type="button" data-testid="dp-next-move-draft-btn" onClick={onDraft} style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", minHeight: 40 }}>Draft the note</button>
            : how.say ? <button type="button" data-testid="dp-next-move-copy" onClick={copy} style={{ background: T.greenDk, color: T.white, border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", minHeight: 40 }}>{copied ? "Copied" : "Copy the words"}</button> : null)}
          <OutcomeButtons card={{ kind: m.kind }} items={[m.item]} onChanged={load} isReadOnly={isReadOnly} />
        </div>
        {how.ask && <div data-testid="dp-next-move-ask" style={{ fontSize: 13.5, color: T.ink, fontWeight: 700 }} title={how.ask.rule}>Ask: {how.ask.words}</div>}
      </div>
    </section>
  );
}
