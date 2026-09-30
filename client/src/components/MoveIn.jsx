// client/src/components/MoveIn.jsx — TRANS-1 Parts 1, 2, 3 and 6.
//
// Three screens and one card, all of them about the same sentence: "Moving
// takes about a day. You keep your old system until you trust us, and there
// is nothing new to learn."
//
//   MoveStart     Part 1 — "Where are your donors today?", asked BEFORE the
//                 file rather than guessed after it, and Part 2's how-to page
//                 behind each tile.
//   MoveHowTo     Part 2 — which report to run, in what order, which columns,
//                 and what will not come across. Printable, so it can be sent
//                 before the onboarding call.
//   MoveReport    Part 3 — every figure Steward holds beside the same figure
//                 from the file. The headline is the proof.
//   MoveCard      Part 6 — the Settings card, and "We've moved".
//
// The tile list and every word of a how-to page come from GET /move/sources,
// which reads shared/movePlan.js, which reads the presets. Nothing here
// carries a vendor's column spellings: one wrong spelling is fixed in one
// place, and this file cannot be the place it rots.
//
// Colours are the four: ink, white/cream, emerald (the one action colour),
// brass. A difference on the Move Report is BRASS, not red — red is only for
// a destructive confirm.

import { useState, useEffect, useMemo } from "react";
import { apiFetch, API } from "../api";
import { T, Modal, Spin } from "./shared";
import { errorMessage } from "../lib/domainError";

// The PDF is fetched, not linked: it rides the same Authorization header as
// every other read, so a board's copy of the proof is never a URL somebody
// can pass around without a session.
async function downloadMovePdf(importId) {
  const r = await fetch(`${API}/imports/${importId}/move-report/pdf`, {
    headers: { Authorization: "Bearer " + localStorage.getItem("npe_token") },
  });
  if (!r.ok) return;
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `move-report-${importId}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
}

// ── shared bits ────────────────────────────────────────────────────────────

const centsStr = (c) => {
  const n = Math.trunc(Number(c) || 0);
  const s = (Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "-$" : "$") + s;
};
const numStr = (n) => (Math.trunc(Number(n) || 0)).toLocaleString("en-US");

const card = {
  background: T.bgCard, border: `1px solid ${T.bg3}`, borderRadius: 12, padding: 16,
};

// ── PART 1 · WHERE ARE YOUR DONORS TODAY? ──────────────────────────────────

export function MoveStart({ onPicked, onSkip, initialSource = null }) {
  const [sources, setSources] = useState(null);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState(initialSource);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch("/move/sources")
      .then(r => { if (live) setSources(r); })
      .catch(e => { if (live) setErr(errorMessage(e)); });
    return () => { live = false; };
  }, []);

  const choose = async (key) => {
    setSaving(true); setErr("");
    try {
      // Picking a tile starts the move: it is the only place the move's start
      // date comes from, and it is idempotent, so changing your mind later
      // corrects the source without rewriting the day you began.
      await apiFetch("/move/start", { method: "POST", body: JSON.stringify({ source: key }) });
      setPicked(key);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setSaving(false); }
  };

  if (err && !sources) return <div style={{ ...card, color: T.ink2, fontSize: 13 }}>{err}</div>;
  if (!sources) return <div style={{ padding: 20, textAlign: "center" }}><Spin /></div>;

  const howTo = picked ? sources.howTo[picked] : null;
  if (howTo) {
    return (
      <div>
        <MoveHowTo howTo={howTo} />
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button data-testid="move-have-file" onClick={() => onPicked && onPicked(picked, howTo)}
            style={{ background: T.greenDk, color: "#fff", border: "none", borderRadius: 9,
                     padding: "11px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            I have my file — continue
          </button>
          <button data-testid="move-change-source" onClick={() => setPicked(null)}
            style={{ background: T.bg2, color: T.ink2, border: "none", borderRadius: 9,
                     padding: "11px 16px", fontSize: 13.5, cursor: "pointer" }}>
            Not my system
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="move-tiles">
      <div style={{ fontSize: 17, fontWeight: 800, color: T.ink, marginBottom: 4 }}>
        Where are your donors today?
      </div>
      <div style={{ fontSize: 13, color: T.ink3, marginBottom: 14, lineHeight: 1.5 }}>
        Pick the system you are coming from and Steward fills in the mapping for you, so your
        file opens already matched up. Keep your old system running as long as you like.
      </div>
      {err && <div style={{ color: T.ink2, fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))", gap: 10 }}>
        {sources.tiles.map(t => (
          <button key={t.key} data-testid={`move-tile-${t.key}`} disabled={saving}
            onClick={() => choose(t.key)}
            style={{ textAlign: "left", background: T.bgCard, border: `1px solid ${T.bg3}`,
                     borderRadius: 11, padding: "13px 14px", cursor: saving ? "wait" : "pointer" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{t.label}</div>
            {t.sub && <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 3, lineHeight: 1.45 }}>{t.sub}</div>}
          </button>
        ))}
      </div>
      {onSkip && (
        <button data-testid="move-skip" onClick={onSkip}
          style={{ marginTop: 14, background: "none", border: "none", color: T.ink3,
                   fontSize: 12.5, textDecoration: "underline", cursor: "pointer", padding: 0 }}>
          Skip this — I already have my file ready
        </button>
      )}
    </div>
  );
}

// ── PART 2 · HOW TO GET YOUR FILE OUT ──────────────────────────────────────
//
// One screen, printable. `@media print` is not enough on its own inside a
// modal, so the printable copy opens in its own window with the same content.

export function MoveHowTo({ howTo, printable = true }) {
  if (!howTo) return null;
  const print = () => {
    const w = window.open("", "_blank", "width=780,height=900");
    if (!w) return;
    const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>Getting your file out of ${esc(howTo.label)}</title>
      <style>
        body{font:14px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0f1a12;max-width:640px;margin:40px auto;padding:0 20px}
        h1{font-size:20px;margin:0 0 4px} .sub{color:#5a554f;font-size:13px;margin-bottom:22px}
        h2{font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:#5a554f;margin:24px 0 8px}
        ol,ul{padding-left:22px;margin:0} li{margin-bottom:7px}
        .cols{font-size:13px;color:#2d2d2d} .note{border-left:3px solid #c9a84c;padding:8px 12px;background:#f6eccf;font-size:13px}
      </style></head><body>
      <h1>Getting your file out of ${esc(howTo.label)}</h1>
      <div class="sub">${howTo.files === 2 ? "This takes two files, exported one after the other." : "One file is all it takes."}</div>
      <h2>What to do</h2><ol>${howTo.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
      ${(howTo.columnGroups || []).length
        ? (howTo.columnGroups || []).map(g => `<h2>Columns to include — ${esc(g.file)}</h2><div class="cols">${g.columns.map(esc).join(" · ")}</div>`).join("")
        : (howTo.includeColumns || []).length
          ? `<h2>Columns to include</h2><div class="cols">${howTo.includeColumns.map(esc).join(" · ")}</div>` : ""}
      <h2>What will not come across</h2><ul>${(howTo.loses || []).map(s => `<li>${esc(s)}</li>`).join("")}</ul>
      ${howTo.note ? `<h2>One more thing</h2><div class="note">${esc(howTo.note)}</div>` : ""}
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div data-testid="move-howto">
      <div style={{ fontSize: 17, fontWeight: 800, color: T.ink, marginBottom: 2 }}>
        Getting your file out of {howTo.label}
      </div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 14 }}>
        {howTo.files === 2
          ? "This takes two files, exported one after the other. Bring both."
          : "One file is all it takes."}
      </div>

      <Section label="What to do">
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, color: T.ink2, lineHeight: 1.6 }}>
          {howTo.steps.map((s, i) => <li key={i} style={{ marginBottom: 6 }}>{s}</li>)}
        </ol>
      </Section>

      {(howTo.columnGroups || []).length > 0
        ? (howTo.columnGroups || []).map(g => (
            <Section key={g.file} label={`Columns to include — ${g.file}`}>
              <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.7 }}>{g.columns.join(" · ")}</div>
            </Section>
          ))
        : (howTo.includeColumns || []).length > 0 && (
            <Section label="Columns to include">
              <div style={{ fontSize: 13, color: T.ink2, lineHeight: 1.7 }}>{howTo.includeColumns.join(" · ")}</div>
            </Section>
          )}

      <Section label="What will not come across">
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, color: T.ink2, lineHeight: 1.6 }}>
          {(howTo.loses || []).map((s, i) => <li key={i} style={{ marginBottom: 5 }}>{s}</li>)}
        </ul>
      </Section>

      {howTo.note && (
        <div data-testid="move-howto-note"
          style={{ borderLeft: `3px solid ${T.gold500}`, background: T.bg, borderRadius: "0 8px 8px 0",
                   padding: "9px 13px", fontSize: 12.5, color: T.ink2, lineHeight: 1.55, marginTop: 12 }}>
          {howTo.note}
        </div>
      )}

      {printable && (
        <button data-testid="move-howto-print" onClick={print}
          style={{ marginTop: 14, background: "none", border: `1px solid ${T.bg3}`, borderRadius: 8,
                   padding: "7px 12px", fontSize: 12.5, color: T.ink2, cursor: "pointer" }}>
          Print or save as PDF
        </button>
      )}
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase",
                    letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

// ── PART 3 · THE MOVE REPORT ───────────────────────────────────────────────

export function MoveReport({ importId, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [typedGifts, setTypedGifts] = useState("");
  const [typedDollars, setTypedDollars] = useState("");
  const [savingTyped, setSavingTyped] = useState(false);

  const load = () => apiFetch(`/imports/${importId}/move-report`)
    .then(setData).catch(e => setErr(errorMessage(e)));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [importId]);

  const saveTyped = async () => {
    setSavingTyped(true); setErr("");
    try {
      const cents = typedDollars === "" ? null : Math.round(Number(String(typedDollars).replace(/[$,]/g, "")) * 100);
      await apiFetch(`/imports/${importId}/old-system-totals`, {
        method: "POST",
        body: JSON.stringify({ gifts: typedGifts === "" ? null : Number(typedGifts), cents }),
      });
      await load();
    } catch (e) { setErr(errorMessage(e)); }
    finally { setSavingTyped(false); }
  };

  const body = (() => {
    if (err) return <div style={{ fontSize: 13, color: T.ink2 }}>{err}</div>;
    if (!data) return <div style={{ padding: 24, textAlign: "center" }}><Spin /></div>;
    if (!data.moveReport) {
      return <div data-testid="move-report-unavailable" style={{ ...card, fontSize: 13, color: T.ink2, lineHeight: 1.6 }}>
        {data.unavailable}
      </div>;
    }
    const r = data.moveReport;
    return (
      <div>
        {/* THE HEADLINE. It is the proof, so it leads, before any table. */}
        <div data-testid="move-report-headline"
          style={{ background: r.clean ? T.green100 : T.gold100,
                   border: `1px solid ${r.clean ? T.greenDk : T.gold300}`,
                   borderRadius: 12, padding: "15px 17px", marginBottom: 16 }}>
          <div style={{ fontSize: 16.5, fontWeight: 800, color: T.ink, lineHeight: 1.45 }}>{r.headline}</div>
          {data.vendor && (
            <div style={{ fontSize: 12, color: T.ink3, marginTop: 5 }}>
              From your {data.vendor} export{data.import?.name ? ` · ${data.import.name}` : ""}
            </div>
          )}
        </div>

        {data.since && (
          <div data-testid="move-report-since" style={{ fontSize: 13, color: T.ink2, marginBottom: 16 }}>
            {data.since.sentence}
          </div>
        )}

        <CompareTable title="Your file, and what Steward holds" rows={r.lines} />
        {r.byYear.length > 0 && <CompareTable title="Dollars by year" rows={r.byYear} />}

        {r.topDonors.length > 0 && (
          <Section label={`Top ${r.topDonors.length} donors by what this move brought`}>
            <table data-testid="move-report-top" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {r.topDonors.map((d, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.bg2}` }}>
                    <td style={{ padding: "6px 8px 6px 0", color: T.ink2 }}>{d.name}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: T.ink3, whiteSpace: "nowrap" }}>{centsStr(d.file)}</td>
                    <td style={{ padding: "6px 0 6px 8px", textAlign: "right", whiteSpace: "nowrap",
                                 color: d.matches ? T.ink : T.gold700, fontWeight: d.matches ? 600 : 800 }}>
                      {centsStr(d.held)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* Any difference lists the exact rows. */}
        {(r.differences.length > 0 || r.mismatchedDonors.length > 0) && (
          <div data-testid="move-report-differences"
            style={{ ...card, borderColor: T.gold300, background: T.gold100, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, marginBottom: 7 }}>
              What differs, exactly
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: T.ink2, lineHeight: 1.7 }}>
              {r.differences.map((d, i) => (
                <li key={`l${i}`}>
                  {d.label}: your file says {d.money ? centsStr(d.file) : numStr(d.file)}, Steward holds{" "}
                  {d.money ? centsStr(d.held) : numStr(d.held)}.
                </li>
              ))}
              {r.mismatchedDonors.map((d, i) => (
                <li key={`d${i}`}>
                  {d.name}: your file says {centsStr(d.file)}, Steward holds {centsStr(d.held)}.
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* The org's own figures, from the system they are leaving. */}
        <Section label="Compare against your old system">
          {r.typed ? (
            <table data-testid="move-report-typed" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {r.typed.map((t, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.bg2}` }}>
                    <td style={{ padding: "6px 8px 6px 0", color: T.ink2 }}>{t.label}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: T.ink3, whiteSpace: "nowrap" }}>
                      {t.money ? centsStr(t.typedValue) : numStr(t.typedValue)}
                    </td>
                    <td style={{ padding: "6px 0 6px 8px", textAlign: "right", whiteSpace: "nowrap",
                                 color: t.matches ? T.ink : T.gold700, fontWeight: t.matches ? 600 : 800 }}>
                      {t.money ? centsStr(t.held) : numStr(t.held)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: T.ink3 }}>
                Gifts<br />
                <input data-testid="move-typed-gifts" value={typedGifts} onChange={e => setTypedGifts(e.target.value)}
                  inputMode="numeric" placeholder="3412"
                  style={{ width: 110, padding: "8px 10px", border: `1px solid ${T.bg3}`, borderRadius: 8, fontSize: 13 }} />
              </label>
              <label style={{ fontSize: 12, color: T.ink3 }}>
                Total<br />
                <input data-testid="move-typed-dollars" value={typedDollars} onChange={e => setTypedDollars(e.target.value)}
                  inputMode="decimal" placeholder="1,204,118.22"
                  style={{ width: 150, padding: "8px 10px", border: `1px solid ${T.bg3}`, borderRadius: 8, fontSize: 13 }} />
              </label>
              <button data-testid="move-typed-save" onClick={saveTyped}
                disabled={savingTyped || (typedGifts === "" && typedDollars === "")}
                style={{ background: T.greenDk, color: "#fff", border: "none", borderRadius: 8,
                         padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                Compare
              </button>
            </div>
          )}
        </Section>

        <div style={{ fontSize: 11.5, color: T.ink3, lineHeight: 1.6, marginTop: 4 }}>
          Every figure on the left is your file's own, recorded when you imported it. Every figure on
          the right is read from Steward now. Nothing here was typed by us.
        </div>
      </div>
    );
  })();

  if (!onClose) return body;
  return (
    <Modal onClose={onClose} width={720} zIndex={320} padding={26}
      ariaLabel="Move Report" dialogStyle={{ borderRadius: 18, border: `1px solid ${T.bg3}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.ink }}>Move Report</div>
          <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>Proof that nothing was lost</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button data-testid="move-report-pdf" onClick={() => downloadMovePdf(importId)}
            style={{ background: "none", border: `1px solid ${T.bg3}`, borderRadius: 8,
                     padding: "6px 12px", fontSize: 12.5, color: T.ink2, cursor: "pointer" }}>
            PDF for the board
          </button>
          <button onClick={onClose}
            style={{ background: T.bg3, border: "none", borderRadius: 8, padding: "6px 12px",
                     color: T.ink3, cursor: "pointer", fontSize: 13 }}>✕ Close</button>
        </div>
      </div>
      {body}
    </Modal>
  );
}

function CompareTable({ title, rows }) {
  if (!rows || !rows.length) return null;
  return (
    <Section label={title}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "0 8px 6px 0", fontSize: 11, color: T.ink3, fontWeight: 700 }}></th>
            <th style={{ textAlign: "right", padding: "0 8px 6px", fontSize: 11, color: T.ink3, fontWeight: 700 }}>YOUR FILE</th>
            <th style={{ textAlign: "right", padding: "0 0 6px 8px", fontSize: 11, color: T.ink3, fontWeight: 700 }}>IN STEWARD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${T.bg2}` }} title={l.sentence || ""}>
              <td style={{ padding: "7px 8px 7px 0", color: T.ink2 }}>{l.label}</td>
              <td style={{ padding: "7px 8px", textAlign: "right", color: T.ink3, whiteSpace: "nowrap" }}>
                {l.money ? centsStr(l.file) : numStr(l.file)}
              </td>
              <td style={{ padding: "7px 0 7px 8px", textAlign: "right", whiteSpace: "nowrap",
                           color: l.matches ? T.ink : T.gold700, fontWeight: l.matches ? 600 : 800 }}>
                {l.money ? centsStr(l.held) : numStr(l.held)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

// ── PART 6 · WE'VE MOVED ───────────────────────────────────────────────────

export function MoveCard({ isReadOnly = false }) {
  const [move, setMove] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = () => apiFetch("/move").then(r => setMove(r.move)).catch(e => setErr(errorMessage(e)));
  useEffect(() => { load(); }, []);

  const act = async (path) => {
    setBusy(true); setErr("");
    try { const r = await apiFetch(path, { method: "POST", body: "{}" }); setMove(r.move); setConfirming(false); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const when = useMemo(() => (d) => {
    if (!d) return "";
    try {
      return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch { return ""; }
  }, []);

  // No move on file is not a card. A Settings screen does not need a tile
  // telling an org that has always been here that it has not moved.
  if (!move || !move.source) return null;

  const sentence = [
    move.completedAt ? `Moved from ${move.label}` : `Moving from ${move.label}`,
    move.startedAt ? `started ${when(move.startedAt)}` : null,
    move.imports ? `${move.imports} import${move.imports === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div data-testid="move-card" style={{ ...card, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }} data-testid="move-card-sentence">{sentence}</div>
      <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 5, lineHeight: 1.55 }}>
        {move.completedAt
          ? `Finished ${when(move.completedAt)}${move.completedByName ? ` by ${move.completedByName}` : ""}. Your Move Reports are all still on file.`
          : "Re-import an updated export from the same source as often as you like. A second file adds only what is new, and never duplicates a gift."}
      </div>
      {err && <div style={{ fontSize: 12.5, color: T.ink2, marginTop: 8 }}>{err}</div>}

      {!move.completedAt && !isReadOnly && (
        confirming ? (
          <div style={{ marginTop: 11 }}>
            <div style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.6, marginBottom: 9 }}>
              This ends the move: Steward stops prompting you to re-import, and turns on journeys and
              receipts if they were held back. Nothing is deleted, and you can undo this for {move.undoDays} days.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button data-testid="move-complete-confirm" onClick={() => act("/move/complete")} disabled={busy}
                style={{ background: T.greenDk, color: "#fff", border: "none", borderRadius: 8,
                         padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                Yes, we've moved
              </button>
              <button onClick={() => setConfirming(false)} disabled={busy}
                style={{ background: T.bg2, color: T.ink2, border: "none", borderRadius: 8,
                         padding: "9px 14px", fontSize: 13, cursor: "pointer" }}>Not yet</button>
            </div>
          </div>
        ) : (
          <button data-testid="move-complete" onClick={() => setConfirming(true)}
            style={{ marginTop: 11, background: T.greenDk, color: "#fff", border: "none", borderRadius: 8,
                     padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            We've moved
          </button>
        )
      )}

      {move.completedAt && move.undoOpen && !isReadOnly && (
        <button data-testid="move-undo" onClick={() => act("/move/undo")} disabled={busy}
          style={{ marginTop: 11, background: "none", border: `1px solid ${T.bg3}`, borderRadius: 8,
                   padding: "8px 13px", fontSize: 12.5, color: T.ink2, cursor: "pointer" }}>
          Undo — we are still moving
        </button>
      )}
    </div>
  );
}
