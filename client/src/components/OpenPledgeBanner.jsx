// IMPORT-5 · OPEN PLEDGES UP FRONT. A pledge that is still open sits at the
// top of the profile, under the header, not three tabs down under Gifts &
// pledges: what was promised, what has come in, when the next part is due and
// how many parts are left. Its figure is Fundraising's own open-pledge source
// for this person, so the profile, Fundraising and Home say one number.
// Record a payment opens the gift form on this pledge (the one gift path).
// Send a reminder writes a task with the reminder drafted in it: nothing sends.
import { useState } from "react";
import { apiFetch } from "../api";
import { T } from "./shared";
import { Figure } from "./Figure";
import { errorMessage } from "../lib/domainError";
import { countLabel } from "../../../shared/countWords.js";
import { told } from "../lib/stewardTold";

const money = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const longDate = iso => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const btn = primary => ({ background: primary ? T.greenDk : T.white, color: primary ? T.white : T.ink, border: "1px solid " + (primary ? T.greenDk : T.bg3),
  borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

// what is open on one pledge, in the words the banner says
export function openPledgeWords(pl) {
  const inst = (pl.installments || []).slice().sort((a, b) => a.seq - b.seq);
  const unpaid = inst.filter(i => !i.paid);
  const next = unpaid.find(i => i.dueDate) || null;
  const more = next ? unpaid.filter(i => i !== next).length : Math.max(0, unpaid.length - 1);
  const parts = [`${money(pl.paid)} received`];
  if (next) parts.push(`next due ${longDate(next.dueDate)}`);
  else if (unpaid.length || pl.balance > 0) parts.push("no set due date");
  if (more) parts.push(`${countLabel(more, "more installment")}`);
  return { next, more, unpaid, inst, rest: parts.join(" · ") };
}

export default function OpenPledgeBanner({ pledges, donorName, donorId, isReadOnly, onRecordPayment }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  // SWEEP-4: the drafted reminder, so it can be taken back, and so a second
  // press does not draft a second one
  const [drafted, setDrafted] = useState({});   // pledge id -> task id
  const open = (pledges || []).filter(p => p.status === "open" && Number(p.balance) > 0);
  if (!open.length) return null;
  const remind = async (pl, w) => {
    setBusy(pl.id); setMsg("");
    const first = String(donorName || "").split(/\s+/)[0] || "there";
    const part = w.next ? `${money(w.next.amount)} due ${longDate(w.next.dueDate)}` : `${money(pl.balance)} still to come`;
    const body = `Hi ${first}, thank you again for your pledge of ${money(pl.amount)}. This is a gentle note that ${part}. Is there a way of giving that's easiest for you?`;
    try {
      const t = await apiFetch("/tasks", { method: "POST", body: JSON.stringify({ title: `Send ${donorName} a pledge reminder`.slice(0, 240), due: todayIso(), type: "donor", donorId,
        priority: "medium", kind: "write", notes: `Drafted reminder (nothing was sent):\n\n${body}` }) });
      setDrafted(d => ({ ...d, [pl.id]: (t && t.id) || true }));
      setMsg(`A pledge reminder for ${donorName} is on your tasks, with the note drafted in it. Nothing was sent.`);
      told({ task: true });   // the profile's next step, its Tasks count and Tasks read it at once
    } catch (e) { setMsg(errorMessage(e, "The reminder was not drafted.")); }
    setBusy("");
  };
  const takeBack = async pl => {
    const id = drafted[pl.id];
    if (typeof id !== "string") return;
    setBusy(pl.id);
    try {
      await apiFetch(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
      setDrafted(d => { const n = { ...d }; delete n[pl.id]; return n; });
      setMsg("Taken back. The reminder task is gone.");
      told({ task: true });
    } catch (e) { setMsg(errorMessage(e, "The reminder was not taken back.")); }
    setBusy("");
  };
  return (
    <div data-testid="dp-open-pledges" style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {open.map(pl => {
        const w = openPledgeWords(pl);
        return (
          <div key={pl.id} data-testid="dp-open-pledge" style={{ background: T.white, border: "1px solid " + T.gold500, borderLeft: "4px solid " + T.gold500, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.5 }}>
                <b>Open pledge: <Figure variant="inline" kind="money" value={Number(pl.balance) || 0} label="Open pledge"
                  definition="What is still to come on this person's open pledges. A pledge part-paid counts only the remainder." source={pl.openSource} /></b>
                {Number(pl.balance) !== Number(pl.amount) ? <span style={{ color: T.ink3 }}> of {money(pl.amount)}</span> : null}
                <span data-testid="dp-open-pledge-words"> · {w.rest}</span>
              </div>
              {!isReadOnly && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" data-testid="dp-pledge-record" style={btn(true)} onClick={() => onRecordPayment && onRecordPayment(pl, w.next)}>Record a payment</button>
                  {drafted[pl.id]
                    ? <button type="button" data-testid="dp-pledge-remind-undo" style={btn(false)} disabled={busy === pl.id} onClick={() => takeBack(pl)}>{busy === pl.id ? "Taking it back…" : "Undo the reminder"}</button>
                    : <button type="button" data-testid="dp-pledge-remind" style={btn(false)} disabled={busy === pl.id} onClick={() => remind(pl, w)}>{busy === pl.id ? "Drafting…" : "Send a reminder"}</button>}
                </div>
              )}
            </div>
            {w.inst.length > 1 && (
              <div data-testid="dp-pledge-installments" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {w.inst.map(i => (
                  <span key={i.seq} style={{ fontSize: 12, padding: "3px 9px", borderRadius: 999, background: i.paid ? T.green100 : T.bg, color: T.ink,
                    border: "1px solid " + (i.paid ? T.greenDk : i === w.next ? T.gold500 : T.bg3) }}>
                    {i.dueDate ? longDate(i.dueDate) : "No set date"} · {money(i.amount)} · {i.paid ? "Paid" : i === w.next ? "Next" : "To come"}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink }}>{msg}</div>}
    </div>
  );
}
