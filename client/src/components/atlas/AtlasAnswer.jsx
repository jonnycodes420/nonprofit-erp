// atlas/AtlasAnswer.jsx · ATLAS-3. A LIST IS A LIST; A PERSON IS WHAT WE KNOW.
//
// Under an Atlas line that answered something: the people (each name opens
// their record, with why they matched, and the count), and "Open list", which
// opens the same people in People (filtered to the answer's saved ids, nothing
// made: SENDS-3 item 4), and "Save as group", the one press that keeps them as
// a group (POST /atlas/actions/:id/group; the same group every time after).
// For one person: the About note, the last conversations and the next step,
// each opening where it lives.
import { useState } from "react";
import { T } from "../shared";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";

const link = { background: "none", border: "none", padding: 0, font: "inherit", color: T.ink, textAlign: "left", cursor: "pointer",
  textDecoration: "underline", textDecorationColor: T.bg3, textUnderlineOffset: 3 };
const quiet = { fontSize: 12.5, color: T.ink3, lineHeight: 1.45 };
const usd = c => "$" + (Math.round(Number(c) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: Number(c) % 100 ? 2 : 0, maximumFractionDigits: 2 });   // ATLAS-8

export default function AtlasAnswer({ line, onGo, busy }) {
  const a = line && line.answer;
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState("");
  if (!a) return null;
  if (a.type === "person") return (
    <ul data-testid="atlas-person" style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {a.facts.map((f, i) => <li key={i} data-fact={f.kind} style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink }}>
        <button type="button" style={link} onClick={() => onGo(f.link)}>{f.line}</button></li>)}
    </ul>
  );
  // ATLAS-8: a why answer draws every person behind its total: their reason and what is at stake,
  // and the total of the rows drawn, footing to the cent. A Home figure draws each of its parts.
  if (a.type === "figure") return (
    <dl data-testid="atlas-figure" style={{ margin: "6px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px", fontSize: 13 }}>
      {a.parts.map(p => <div key={p.label} style={{ display: "contents" }}><dt style={quiet}>{p.label}</dt><dd data-testid="atlas-figure-part" style={{ margin: 0, color: T.ink, fontVariantNumeric: "tabular-nums" }}>{usd(p.cents)}</dd></div>)}
    </dl>
  );
  if (a.type !== "list" && a.type !== "why") return null;
  const open = () => onGo({ tab: "people", actionId: line.id });
  const save = async () => {
    setOpening(true); setErr("");
    try { const r = await apiFetch(`/atlas/actions/${line.id}/group`, { method: "POST", body: "{}" }); onGo({ tab: "groups", groupId: r.groupId }); }
    catch (e) { setErr(errorMessage(e, "The group wasn't saved. Try again.")); }
    setOpening(false);
  };
  return (
    <div data-testid="atlas-list" style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
      {a.reason && <div style={quiet}>Each of them: {a.reason}.</div>}
      {a.type === "why" ? <ol data-testid="atlas-why" style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
        {a.people.map(p => <li key={p.donorId} data-testid="atlas-why-person" style={{ fontSize: 13.5, lineHeight: 1.4, color: T.ink }}>
          <button type="button" style={{ ...link, fontWeight: 700 }} onClick={() => onGo({ tab: "donor", donorId: p.donorId })}>{p.name}</button>
          {p.cents > 0 && <span data-testid="atlas-why-stake" style={{ fontVariantNumeric: "tabular-nums" }}> · {p.atStake} {a.stakeWord || "at stake"}</span>}
          <div style={quiet}>{p.reason}</div></li>)}
      </ol> : <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
        {a.people.map(p => <li key={p.donorId} data-testid="atlas-list-person" style={{ fontSize: 13.5, lineHeight: 1.4, color: T.ink }}>
          <button type="button" style={{ ...link, fontWeight: 700 }} onClick={() => onGo({ tab: "donor", donorId: p.donorId })}>{p.name}</button>
          {/* ATLAS-4: what matched the question first; lifetime second, quieter */}
          {p.amount ? <><span data-testid="atlas-list-amount" style={{ fontSize: 13.5, color: T.ink }}> · {p.amount}</span>
            <span style={{ ...quiet, fontSize: 12 }}> · {p.lifetime}</span></> : <span style={quiet}> · {p.reason}</span>}</li>)}
      </ol>}
      {a.type === "why" && a.totalCents > 0 && <div data-testid="atlas-why-total" title={a.definition} style={{ fontSize: 13, color: T.ink, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {a.more > 0 ? `These ${a.people.length}: ${a.total} ${a.stakeWord || "at stake"}` : `Together: ${a.total} ${a.stakeWord || "at stake"}`}</div>}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span data-testid="atlas-list-count" style={{ fontSize: 13, color: T.ink2 }}>{a.count === 1 ? "1 person" : `${a.count.toLocaleString("en-US")} people`}{a.more > 0 ? `, ${a.more.toLocaleString("en-US")} more in the list` : ""}.</span>
        <button type="button" data-testid="atlas-open-list" disabled={busy} onClick={open}
          style={{ background: T.white, color: T.ink, border: "1px solid " + T.greenDk, borderRadius: 8, padding: "4px 12px", minHeight: 32, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          Open list</button>
        <button type="button" data-testid="atlas-save-group" disabled={busy || opening} onClick={save} style={{ ...link, fontSize: 12.5, minHeight: 32 }}>
          {opening ? "Saving…" : "Save as group"}</button>
      </div>
      {err && <div role="alert" style={quiet}>{err}</div>}
    </div>
  );
}
