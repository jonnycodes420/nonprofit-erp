// BUILD-86 Part B — YOUR WORDS. The five-question vocabulary screen.
//
// It appears ONCE, after the first import commits, and lives in Settings
// afterwards. Every question is one sentence, and where her own file already
// answered one, her answer is shown beside it — nothing is asked that the
// import has already told us.
//
// SKIPPING IS A DECISION, not a deferral: it stamps `vocabulary_set_at` so the
// first run is offered once and never nags. The defaults are today's strings,
// so a skip leaves the product exactly as it was.
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { errorMessage } from "../lib/domainError";
import { VOCAB_DEFAULTS, MONTH_NAMES } from "../../../shared/vocabulary";

export function YourWords({ mode = "settings", onDone, onClose }) {
  const firstRun = mode === "first-run";
  const [data, setData] = useState(null);
  const [v, setV] = useState({ ...VOCAB_DEFAULTS });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch("/org/vocabulary").then(r => { setData(r); setV({ ...VOCAB_DEFAULTS, ...r.vocabulary }); }).catch(() => {});
  }, []);

  const set = (k, val) => { setV(p => ({ ...p, [k]: val })); setSaved(false); };
  const pair = (sk, pk, one, many) => { setV(p => ({ ...p, [sk]: one, [pk]: many })); setSaved(false); };

  async function save(skip = false) {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const body = skip ? { skip: true } : v;
      const r = await apiFetch("/org/vocabulary", { method: "PUT", body: JSON.stringify(body) });
      setSaved(true);
      onDone?.(r.vocabulary);
      if (firstRun) onClose?.();
    } catch (e) { setErr(errorMessage(e, "Could not save your words.")); }
    finally { setBusy(false); }
  }

  const fld = { padding: "9px 11px", border: "1px solid " + T.bg3, borderRadius: 8, fontSize: 14, color: T.ink, background: "#fff", boxSizing: "border-box", width: "100%" };
  const q = { fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 3 };
  const help = { fontSize: 12.5, color: T.ink3, marginBottom: 9, lineHeight: 1.5 };
  const chip = on => ({ background: on ? T.greenDk : "transparent", color: on ? "#fff" : T.ink3, border: "1px solid " + (on ? T.greenDk : T.bg3), borderRadius: 99, padding: "4px 11px", fontSize: 12, cursor: "pointer" });

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {/* 1 + 2 — the people. */}
      {[
        { id: "giver", sk: "giver_singular", pk: "giver_plural",
          question: "What do you call the people who give to you?",
          help: "Used everywhere Steward talks about them to you. Never on a receipt.",
          opts: [["donor", "donors"], ["sponsor", "sponsors"], ["partner", "partners"], ["supporter", "supporters"]] },
        { id: "monthly", sk: "monthly_giver_singular", pk: "monthly_giver_plural",
          question: "What do you call someone who gives every month?",
          help: "Steward watches these gifts and tells you when a card fails.",
          opts: [["monthly donor", "monthly donors"], ["sponsor", "sponsors"], ["partner", "partners"], ["sustainer", "sustainers"]] },
        { id: "fund", sk: "fund_singular", pk: "fund_plural",
          question: "What do you call your funds or programs?",
          help: "The names themselves came from your file. This is the word for the category.",
          opts: [["fund", "funds"], ["designation", "designations"], ["program", "programs"], ["project", "projects"]] },
      ].map(row => (
        <div key={row.id}>
          <div style={q}>{row.question}</div>
          <div style={help}>{row.help}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 9 }}>
            {row.opts.map(([one, many]) => (
              <button key={one} onClick={() => pair(row.sk, row.pk, one, many)} style={chip(v[row.sk] === one && v[row.pk] === many)}>{many}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ flex: 1, minWidth: 150 }}>
              <span style={{ fontSize: 11, color: T.ink3, display: "block", marginBottom: 3 }}>One of them</span>
              <input style={fld} value={v[row.sk] || ""} onChange={e => set(row.sk, e.target.value)} />
            </label>
            <label style={{ flex: 1, minWidth: 150 }}>
              {/* THE PLURAL IS STORED, NEVER COMPUTED — somebody's word will be
                  "clergy" or "familias" and no rule gets those right. */}
              <span style={{ fontSize: 11, color: T.ink3, display: "block", marginBottom: 3 }}>More than one</span>
              <input style={fld} value={v[row.pk] || ""} onChange={e => set(row.pk, e.target.value)} />
            </label>
          </div>
          {row.id === "fund" && data?.evidence?.funds?.length > 0 && (
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 8, lineHeight: 1.6 }}>
              Already in your file: {data.evidence.funds.slice(0, 6).join(" · ")}
              {data.evidence.funds.length > 6 ? ` and ${data.evidence.funds.length - 6} more` : ""}
            </div>
          )}
        </div>
      ))}

      {/* 4 — the fiscal year. Not a word, a real boundary. */}
      <div>
        <div style={q}>When does your year start?</div>
        <div style={help}>Drives every “this year” figure on your dashboards.</div>
        <select style={{ ...fld, maxWidth: 220 }} value={v.fiscal_year_start_month || 7}
          onChange={e => set("fiscal_year_start_month", parseInt(e.target.value, 10))}>
          {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      </div>

      {/* 5 — optional, and said to be. */}
      <div>
        <div style={q}>What is your one big event or season?</div>
        <div style={help}>Steward mentions it on your morning screen as the date approaches. Leave it blank if there isn’t one.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={{ ...fld, flex: 1, minWidth: 180 }} placeholder="Spring Campaign" value={v.season_name || ""} onChange={e => set("season_name", e.target.value)} />
          <input type="date" style={{ ...fld, maxWidth: 190 }} value={v.season_date || ""} onChange={e => set("season_date", e.target.value)} />
        </div>
      </div>

      {err && <div style={{ fontSize: 12.5, color: T.terra700, background: T.terra100, border: "1px solid " + T.terra200, borderRadius: 8, padding: "9px 11px" }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => save(false)} disabled={busy}
          style={{ background: T.gold500, border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13.5, fontWeight: 700, color: T.ink, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Saving…" : firstRun ? "Use these words" : "Save"}
        </button>
        {firstRun && (
          <button onClick={() => save(true)} disabled={busy}
            style={{ background: "transparent", border: "none", color: T.ink3, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
            Keep Steward’s words
          </button>
        )}
        {saved && !firstRun && <span style={{ fontSize: 12.5, color: T.greenDk, fontWeight: 600 }}>Saved.</span>}
      </div>
    </div>
  );

  if (!firstRun) return body;

  return (
    <Modal onClose={onClose} title="Your words" width={560}
      subtitle={"Five questions, once. Steward will use your words on your screens and in the emails it sends you. It never changes the words on a receipt or a year‑end statement, because those are legal documents."}
      dialogStyle={{ background: T.bg, borderRadius: 14 }}>
      {body}
    </Modal>
  );
}
