import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { API } from "../api";
import {
  money, benchmarkPayload, REPORT_FOOTER, PRIVACY_LINE, TOP_AT_RISK,
} from "../../../shared/lostAndFound.js";

// ── LOST & FOUND · A $1,500 DONOR AUDIT, FREE ─────────────────────────────
//
// Steward's best salesperson. A development director uploads the export her
// database already makes, and two minutes later she knows which donors are
// slipping away and what that is worth. No account, no email, no catch.
//
// ── THE PROMISE THIS PAGE MAKES, AND HOW IT KEEPS IT ─────────────────────
// "Your donor file never leaves your computer." That is not a policy, it is
// an architecture: the file is read into an ArrayBuffer, handed to a Web
// Worker, and the worker returns an audit. Nothing in this component ever
// puts a donor's name, email or amount into a fetch, a URL, a form field or
// a link, and `tests/lf1-no-donor-data-leaves.test.js` proves it by running
// a fixture through the real code path with the network stubbed and failing
// on any call at all.
//
// TWO THINGS DO REACH A SERVER, both of them by an explicit hand:
//   1. the three fields she types to download the PDF (name, email, org)
//   2. the four aggregate numbers, if she ticks the benchmark box
// Both are built here, by name, in one place each, so what leaves is
// provable by reading this file.
//
// THE FUNNEL IS HONEST. The results are free and complete with no email at
// all. The form is only on the PDF, and the page says so before she uploads.

const INK = "#0f1a12", CREAM = "#f0ede6", GROUND = "#f7f5f0";
const WHITE = "#ffffff", EDGE = "#e8e4db", GREY = "#5a554f";
const EMERALD = "#0d5c3a", BRASS = "#c9a84c";
const WASH = "#f3e9cc", WASH_INK = "#5c4710";
const SERIF = "'DM Serif Display',Georgia,serif";
const CAL = "https://calendly.com/xjca2006/new-meeting";

const fmtPct = v => (v === null || v === undefined ? "—" : v + "%");

export default function LostAndFound() {
  const [state, setState] = useState("idle");   // idle | reading | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [openSection, setOpenSection] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", organization: "", benchmark: false });
  const [formState, setFormState] = useState("");   // "" | sending | sent | error
  const [formErr, setFormErr] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const workerRef = useRef(null);

  // The page owns its ground: index.html paints `body` ink, and an
  // overscroll on a phone showed a black bar above a cream page.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = GROUND;
    return () => { document.body.style.background = prev; };
  }, []);

  // ?ref= , so an affiliate gets credit. Read once, kept in memory, and sent
  // ONLY with the lead — never appended to anything else.
  const ref = useRef(null);
  useEffect(() => {
    try { ref.current = new URLSearchParams(window.location.search).get("ref") || null; } catch { ref.current = null; }
  }, []);

  useEffect(() => () => { if (workerRef.current) workerRef.current.terminate(); }, []);

  const handleFile = useCallback((file) => {
    if (!file) return;
    setState("reading"); setError(""); setResult(null); setOpenSection(null);
    const reader = new FileReader();
    reader.onerror = () => { setState("error"); setError("Steward could not read that file."); };
    reader.onload = () => {
      try {
        if (workerRef.current) workerRef.current.terminate();
        // Vite bundles the worker; `type: module` so it can import the two
        // shared modules rather than carry a second copy of them.
        const w = new Worker(new URL("../lib/lostAndFoundWorker.js", import.meta.url), { type: "module" });
        workerRef.current = w;
        w.onmessage = (e) => {
          const d = e.data || {};
          if (!d.ok) { setState("error"); setError(d.message || "Steward could not read that file."); return; }
          if (d.result && d.result.error) {
            setState("error");
            setError(d.result.message || (d.result.readiness && d.result.readiness.sentence) || "Steward could not read that file.");
            return;
          }
          setResult(d.result); setState("done");
        };
        w.onerror = () => { setState("error"); setError("Steward could not read that file."); };
        const today = new Date().toISOString().slice(0, 10);
        w.postMessage({ bytes: reader.result, name: file.name, today }, [reader.result]);
      } catch {
        setState("error"); setError("Steward could not start the audit in this browser.");
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  async function submitLead(e) {
    e.preventDefault();
    setFormState("sending"); setFormErr("");
    try {
      // THE ONLY THING THAT LEAVES, BUILT BY NAME. Four keys, typed out, so
      // what is sent is provable by reading four lines.
      const body = {
        name: form.name.trim(),
        email: form.email.trim(),
        organization: form.organization.trim(),
        ref: ref.current || undefined,
      };
      const r = await fetch(API + "/lost-and-found/lead", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "That did not go through.");

      // The benchmark, if she ticked it. FOUR AGGREGATE NUMBERS, built by
      // `benchmarkPayload` in the shared module, which is the one function
      // allowed to shape anything destined for a server.
      if (form.benchmark && result) {
        await fetch(API + "/lost-and-found/benchmark", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(benchmarkPayload(result)),
        }).catch(() => { /* the report is the point; the benchmark is a gift */ });
      }
      setFormState("sent");
      await downloadPdf(result, form.organization.trim());
    } catch (err) {
      setFormState("error"); setFormErr(String((err && err.message) || "That did not go through."));
    }
  }

  const reset = () => { setState("idle"); setResult(null); setError(""); setFormState(""); };

  return (
    <div style={{ minHeight: "100vh", background: GROUND, color: INK, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

      <nav className="lf-nav" style={{ position: "sticky", top: 0, zIndex: 50, display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 12, padding: "0 32px", height: 56,
        background: GROUND, borderBottom: `1px solid ${EDGE}` }}>
        <Link to="/" style={{ textDecoration: "none", flexShrink: 0 }}>
          <span style={{ fontSize: 20, color: INK, fontFamily: SERIF, letterSpacing: "-0.02em" }}>Steward</span>
        </Link>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
          <Link to="/pricing" className="lf-hide-sm" style={{ fontSize: 13, color: GREY, textDecoration: "none" }}>Pricing</Link>
          <Link to="/signup" style={{ fontSize: 13, color: CREAM, background: INK, borderRadius: 8,
            padding: "7px 16px", textDecoration: "none", fontWeight: 700, whiteSpace: "nowrap" }}>Start now</Link>
        </div>
      </nav>

      <section style={{ maxWidth: 1080, margin: "0 auto", padding: "72px 24px 72px" }}>
        {/* ── THE HERO ─────────────────────────────────────────────── */}
        <div style={{ textAlign: "center", maxWidth: 820, margin: "0 auto" }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "1.8px", textTransform: "uppercase", color: GREY }}>
            Lost &amp; Found
          </span>
          <h1 className="lf-h1" data-testid="lf-hero"
            style={{ fontFamily: SERIF, fontSize: 64, lineHeight: 1.04, fontWeight: 600, letterSpacing: "-1.4px", margin: "18px 0 20px" }}>
            A $1,500 donor audit. Free.
          </h1>
          <p style={{ fontSize: 19, lineHeight: 1.55, color: GREY, margin: "0 auto", maxWidth: 640 }}>
            Consultants charge $500 to $2,000 to tell you which donors are slipping away.
            Upload the export your database already makes and know in two minutes.
            Free forever. No account. Your file never leaves your computer.
          </p>

          {/* What she is about to learn: the prize, previewed. */}
          <div className="lf-trio" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12,
            marginTop: 36, textAlign: "left" }}>
            {[
              ["01", "The dollars walking away", "The exact figure your lapsed and drifting donors represent."],
              ["02", "Your real retention rate", "What share of last year's donors gave again. Most orgs guess wrong."],
              ["03", "Who to call first", "Every name, ranked by what is at stake, so Monday morning writes itself."],
            ].map(([n, t, d]) => (
              <div key={n} style={{ background: WHITE, border: `1px solid ${EDGE}`, borderRadius: 14, padding: "18px 18px 20px" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: BRASS, letterSpacing: "1px" }}>{n}</div>
                <div style={{ fontSize: 15.5, fontWeight: 700, margin: "8px 0 6px", lineHeight: 1.35 }}>{t}</div>
                <div style={{ fontSize: 14, color: GREY, lineHeight: 1.55 }}>{d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── THE UPLOAD ───────────────────────────────────────────── */}
        <div style={{ maxWidth: 620, margin: "44px auto 0" }}>
          {state !== "done" && (
            <div data-testid="lf-drop"
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
              style={{ background: WHITE, border: `2px dashed ${drag ? EMERALD : EDGE}`, borderRadius: 18,
                       padding: "38px 24px", textAlign: "center", transition: "border-color .15s" }}>
              <div style={{ fontFamily: SERIF, fontSize: 26, marginBottom: 8 }}>
                {state === "reading" ? "Reading your file…" : "Drop your donor export here"}
              </div>
              <p style={{ fontSize: 15, color: GREY, margin: "0 0 18px", lineHeight: 1.55 }}>
                A CSV or an Excel file with a donor, an amount and a date on each row. Whatever your
                database already exports is fine; nothing needs tidying first.
              </p>
              <input ref={fileRef} data-testid="lf-file" type="file" accept=".csv,.xlsx,.xls,text/csv"
                onChange={e => handleFile(e.target.files && e.target.files[0])} style={{ display: "none" }}/>
              <button data-testid="lf-choose" onClick={() => fileRef.current && fileRef.current.click()}
                disabled={state === "reading"}
                style={{ background: EMERALD, color: WHITE, border: "none", borderRadius: 12, padding: "15px 30px",
                         fontSize: 16, fontWeight: 700, cursor: state === "reading" ? "wait" : "pointer", fontFamily: "inherit" }}>
                {state === "reading" ? "Working…" : "Choose a file"}
              </button>
              <div data-testid="lf-privacy" style={{ display: "inline-flex", alignItems: "center", gap: 8,
                marginTop: 18, fontSize: 14, fontWeight: 600, color: WASH_INK, background: WASH,
                borderRadius: 99, padding: "8px 16px" }}>
                <LockGlyph/> {PRIVACY_LINE}
              </div>
              <p style={{ fontSize: 13, color: GREY, margin: "12px 0 0", lineHeight: 1.55 }}>
                The whole audit runs in this browser tab. Your results are free and complete with no
                email address. We only ask who you are if you want the board-ready PDF.
              </p>
            </div>
          )}
          {state === "error" && (
            <div role="alert" data-testid="lf-error" style={{ background: "#f6ece8", border: "1px solid #e0a893",
              borderRadius: 12, padding: "14px 16px", fontSize: 14.5, lineHeight: 1.55, marginTop: 14 }}>
              {error}
            </div>
          )}
        </div>

        {/* ── THE RESULTS ──────────────────────────────────────────── */}
        {state === "done" && result && (
          <div data-testid="lf-results" style={{ marginTop: 40 }}>
            <Headline result={result} onAnother={reset}/>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14, marginTop: 20 }}>
              {result.sections.map(s => (
                <button key={s.key} data-testid={"lf-section-" + s.key}
                  onClick={() => setOpenSection(openSection === s.key ? null : s.key)}
                  style={{ background: WHITE, border: `1px solid ${EDGE}`, borderRadius: 16, padding: "20px 20px",
                           textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: GREY }}>{s.label}</div>
                  <div style={{ fontFamily: SERIF, fontSize: 44, lineHeight: 1.1, margin: "6px 0 8px" }}>{s.count}</div>
                  <div style={{ fontSize: 14, color: INK, lineHeight: 1.55 }}>{s.sentence}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: EMERALD, marginTop: 10 }}>
                    {openSection === s.key ? "Hide the names" : "See the names"}
                  </div>
                </button>
              ))}
            </div>

            {openSection && (() => {
              const s = result.sections.find(x => x.key === openSection);
              if (!s) return null;
              return (
                <div data-testid="lf-rows" style={{ background: WHITE, border: `1px solid ${EDGE}`, borderRadius: 16,
                  padding: "20px 22px", marginTop: 16 }}>
                  <div style={{ fontFamily: SERIF, fontSize: 24, marginBottom: 4 }}>{s.label}</div>
                  <p style={{ fontSize: 14, color: GREY, lineHeight: 1.55, margin: "0 0 14px" }}>{s.definition}</p>
                  {!s.rows.length && <div style={{ fontSize: 14, color: GREY }}>Nobody.</div>}
                  <div style={{ maxHeight: 420, overflowY: "auto" }}>
                    {s.rows.slice(0, 500).map((r, i) => (
                      <div key={(r.email || r.name) + i}
                        style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "baseline",
                                 padding: "10px 0", borderBottom: `1px solid ${EDGE}` }}>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ fontSize: 14.5, fontWeight: 600 }}>{r.name}</span>
                          <span style={{ fontSize: 13, color: GREY, display: "block" }}>{r.note}</span>
                        </span>
                        <span style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap" }}>{r.amount}</span>
                      </div>
                    ))}
                  </div>
                  {s.rows.length > 500 && (
                    <div style={{ fontSize: 13, color: GREY, marginTop: 10 }}>
                      Showing the first 500 of {s.rows.length}. All of them are in the PDF.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── THE PDF: THE PRIZE BEHIND THE EMAIL ─────────────── */}
            <div id="lf-report" data-testid="lf-report-form" style={{ background: INK, color: CREAM, borderRadius: 18,
              padding: "32px 28px", marginTop: 22 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "1.8px", textTransform: "uppercase", color: BRASS }}>
                The board-ready report
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 32, margin: "10px 0 8px", lineHeight: 1.15 }}>
                Take this to your board meeting.
              </div>
              <p style={{ fontSize: 15, lineHeight: 1.6, color: "rgba(240,237,230,0.78)", margin: "0 0 18px", maxWidth: 640 }}>
                The full audit as a clean PDF: every lapsed donor, every quiet donor, every dollar,
                ranked and ready to forward. Your results above are free either way. We ask who you
                are because we would like to know who we helped.
              </p>
              {formState === "sent" ? (
                <div data-testid="lf-sent" style={{ fontSize: 15.5, lineHeight: 1.6 }}>
                  Downloading. Nothing about your donors left your computer.
                  <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button onClick={() => downloadPdf(result, form.organization.trim())}
                      style={{ background: "transparent", color: CREAM, border: `1.5px solid ${CREAM}`, borderRadius: 10,
                               padding: "12px 20px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      Download it again
                    </button>
                    {/* THE FILE CANNOT TRAVEL, because it never left this
                        browser — and carrying it in sessionStorage would
                        break the one promise this page makes. What travels
                        is the INTENT: signup remembers they came from an
                        audit, and the import step after signup offers to
                        take the same file, which they still have. */}
                    <Link to="/signup" data-testid="lf-start-with-file"
                      onClick={() => { try {
                        sessionStorage.setItem("steward_from_audit", JSON.stringify({
                          at: new Date().toISOString(),
                          fileName: (result && result.file && result.file.name) || null,
                          organization: form.organization.trim() || null,
                        }));
                      } catch { /* private window: the link still works */ } }}
                      style={{ background: EMERALD, color: WHITE, borderRadius: 10, padding: "12px 20px",
                               fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
                      Start Steward with this file →
                    </Link>
                  </div>
                </div>
              ) : (
                <form onSubmit={submitLead} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, alignItems: "end" }}>
                  <label style={{ display: "block" }}>
                    <span style={LBL}>Your name</span>
                    <input data-testid="lf-name" required value={form.name} maxLength={200}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={INP}/>
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={LBL}>Email</span>
                    <input data-testid="lf-email" required type="email" value={form.email} maxLength={200}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={INP}/>
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={LBL}>Organization</span>
                    <input data-testid="lf-org" required value={form.organization} maxLength={200}
                      onChange={e => setForm(f => ({ ...f, organization: e.target.value }))} style={INP}/>
                  </label>
                  <button data-testid="lf-download" type="submit" disabled={formState === "sending"}
                    style={{ background: EMERALD, color: WHITE, border: "none", borderRadius: 10, padding: "14px 20px",
                             fontSize: 15, fontWeight: 700, cursor: formState === "sending" ? "wait" : "pointer",
                             fontFamily: "inherit", minHeight: 48 }}>
                    {formState === "sending" ? "Preparing…" : "Send me the PDF"}
                  </button>
                  <label style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "flex-start",
                                  fontSize: 14, lineHeight: 1.55, color: "rgba(240,237,230,0.85)", marginTop: 4 }}>
                    <input data-testid="lf-benchmark" type="checkbox" checked={form.benchmark}
                      onChange={e => setForm(f => ({ ...f, benchmark: e.target.checked }))}
                      style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}/>
                    <span>
                      Add my anonymous totals to the nonprofit benchmark.
                      <span style={{ display: "block", fontSize: 13, color: "rgba(240,237,230,0.62)", marginTop: 3 }}>
                        Four numbers: your donor count as a band, your retention rate, and the share
                        of your donors who are lapsed and drifting. Never a name, an email or a single gift.
                      </span>
                    </span>
                  </label>
                  {formErr && <div role="alert" style={{ gridColumn: "1 / -1", fontSize: 14, color: "#e0a893" }}>{formErr}</div>}
                </form>
              )}
            </div>
          </div>
        )}

        {/* ── THE CLOSE: THIS WAS THE SNAPSHOT ─────────────────────── */}
        <div data-testid="lf-close" style={{ background: WHITE, border: `1px solid ${EDGE}`, borderRadius: 18,
          padding: "40px 32px", marginTop: 46, maxWidth: 860, marginLeft: "auto", marginRight: "auto",
          textAlign: "center" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "1.8px", textTransform: "uppercase", color: GREY }}>
            The next step
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 38, lineHeight: 1.12, margin: "12px 0 14px", letterSpacing: "-0.5px" }}>
            This was the snapshot.<br/>Steward is the movie.
          </div>
          <p style={{ fontSize: 16.5, lineHeight: 1.6, color: GREY, margin: "0 auto 24px", maxWidth: 600 }}>
            Lost &amp; Found looks backward once. Steward watches your donors every week, drafts the
            next right thing, and waits for your approval. Want it running automatically, with next
            steps attached? That&apos;s Steward.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link to="/signup" style={{ background: EMERALD, color: WHITE, borderRadius: 12, padding: "15px 30px",
              fontSize: 16, fontWeight: 700, textDecoration: "none", display: "inline-block", minWidth: 44, minHeight: 44 }}>
              Start now
            </Link>
            <a href={CAL} target="_blank" rel="noreferrer" style={{ background: "transparent", color: INK,
              border: `1.5px solid ${INK}`, borderRadius: 12, padding: "15px 30px",
              fontSize: 16, fontWeight: 700, textDecoration: "none", display: "inline-block", minWidth: 44, minHeight: 44 }}>
              Book a call
            </a>
          </div>
        </div>

        {/* ── WHY FREE ─────────────────────────────────────────────── */}
        <div data-testid="lf-why-free" style={{ marginTop: 40, maxWidth: 720, marginLeft: "auto", marginRight: "auto",
          textAlign: "center" }}>
          <div style={{ fontFamily: SERIF, fontSize: 26, marginBottom: 10 }}>Why is this free?</div>
          <p style={{ fontSize: 16, lineHeight: 1.65, color: GREY, margin: 0 }}>
            We sell a CRM. But we believe every nonprofit deserves to know which donors are drifting,
            customer or not. So Lost &amp; Found is free, forever. If you want someone watching it
            automatically every week, that&apos;s what Steward does. No catch.
          </p>
        </div>
      </section>

      <style>{`
        @media (max-width: 760px){
          .lf-h1{ font-size: 40px !important; letter-spacing: -0.8px !important; }
          .lf-nav{ padding: 0 16px !important; }
          .lf-hide-sm{ display: none !important; }
          .lf-trio{ grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Headline({ result, onAnother }) {
  const h = result.headline;
  return (
    <div style={{ background: INK, color: CREAM, borderRadius: 18, padding: "30px 28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "baseline" }}>
        <div style={{ fontSize: 13, color: "rgba(240,237,230,0.72)" }} data-testid="lf-file-line">{result.file.sentence}</div>
        <button onClick={onAnother} style={{ background: "none", border: "none", color: BRASS, fontSize: 13,
          fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>Audit another file</button>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "1.8px", textTransform: "uppercase",
        color: BRASS, marginTop: 22 }}>At risk</div>
      <div data-testid="lf-at-risk" style={{ fontFamily: SERIF, fontSize: 64, lineHeight: 1.02, letterSpacing: "-1px" }}>
        {h.dollarsAtRisk}
      </div>
      <div style={{ fontSize: 15.5, color: "rgba(240,237,230,0.82)", lineHeight: 1.6, marginTop: 8, maxWidth: 640 }}>
        {h.atRiskSentence}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 20, marginTop: 26,
        paddingTop: 22, borderTop: "1px solid rgba(240,237,230,0.16)" }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "rgba(240,237,230,0.6)" }}>Retention</div>
          <div data-testid="lf-retention" style={{ fontFamily: SERIF, fontSize: 40, lineHeight: 1.05 }}>{fmtPct(h.retentionPct)}</div>
          <div style={{ fontSize: 14, color: "rgba(240,237,230,0.72)", lineHeight: 1.55, marginTop: 4 }}>{h.retentionSentence}</div>
        </div>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "rgba(240,237,230,0.6)" }}>On file</div>
          <div style={{ fontFamily: SERIF, fontSize: 40, lineHeight: 1.05 }}>{result.totals.donors.toLocaleString()}</div>
          <div style={{ fontSize: 14, color: "rgba(240,237,230,0.72)", lineHeight: 1.55, marginTop: 4 }}>
            {result.totals.donors.toLocaleString()} donors and {result.totals.gifts.toLocaleString()} gifts,
            {" "}{money(result.totals.lifetimeCents)} in all, from {result.totals.firstGiftDate} to {result.totals.lastGiftDate}.
          </div>
        </div>
      </div>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="13" height="15" viewBox="0 0 13 15" fill="none" aria-hidden="true">
      <rect x="1" y="6" width="11" height="8" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M3.6 6V4.2a2.9 2.9 0 0 1 5.8 0V6" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  );
}

const LBL = { display: "block", fontSize: 12.5, fontWeight: 700, color: "rgba(240,237,230,0.78)", marginBottom: 5 };
const INP = { width: "100%", boxSizing: "border-box", border: "1px solid #2d4a35", background: "#1a2e1f",
  color: CREAM, borderRadius: 10, padding: "13px 12px", fontSize: 16, fontFamily: "inherit", minHeight: 48 };

// ── THE PDF, GENERATED IN THE BROWSER ────────────────────────────────────
// jsPDF, loaded on demand so the 300KB does not sit in the bundle for
// everybody who only reads the page. The file is built from the audit that
// is already in memory: nothing is fetched, and nothing is posted.
async function downloadPdf(result, orgName) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 54;
  let y = M;

  const nl = (n = 14) => { y += n; if (y > H - M - 40) { doc.addPage(); y = M; } };
  const text = (s, { size = 11, bold = false, colour = [15, 26, 18], gap = 15, x = M, max = W - M * 2 } = {}) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...colour);
    for (const line of doc.splitTextToSize(String(s), max)) {
      if (y > H - M - 30) { doc.addPage(); y = M; }
      doc.text(line, x, y); y += gap;
    }
  };

  doc.setFillColor(15, 26, 18); doc.rect(0, 0, W, 86, "F");
  doc.setFont("times", "normal"); doc.setFontSize(26); doc.setTextColor(240, 237, 230);
  doc.text("Lost & Found", M, 46);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(201, 168, 76);
  doc.text(`A donor audit for ${orgName || "your organisation"} · ${result.today}`, M, 66);
  y = 124;

  text(result.headline.dollarsAtRisk + " is at risk", { size: 22, bold: true, gap: 28 });
  text(result.headline.atRiskSentence, { colour: [90, 85, 79] });
  nl(4);
  text(result.headline.retentionSentence, { colour: [90, 85, 79] });
  nl(4);
  text(result.file.sentence, { size: 10, colour: [90, 85, 79] });
  nl(16);

  for (const s of result.sections) {
    text(s.label, { size: 15, bold: true, gap: 20 });
    text(s.sentence, { gap: 15 });
    text(s.definition, { size: 9.5, colour: [90, 85, 79], gap: 12 });
    nl(4);
    if (!s.rows.length) { text("Nobody.", { size: 10, colour: [90, 85, 79] }); nl(12); continue; }
    for (const r of s.rows) {
      if (y > H - M - 30) { doc.addPage(); y = M; }
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(15, 26, 18);
      doc.text(String(r.name).slice(0, 52), M, y);
      doc.setTextColor(90, 85, 79);
      doc.text(String(r.note || "").slice(0, 48), M + 210, y);
      doc.setTextColor(15, 26, 18); doc.setFont("helvetica", "bold");
      doc.text(String(r.amount), W - M, y, { align: "right" });
      y += 14;
    }
    nl(18);
  }

  // THE LAST WORDS OF EVERY REPORT, from the shared module, so the page and
  // the file cannot say it differently.
  if (y > H - M - 90) { doc.addPage(); y = M; }
  nl(10);
  doc.setDrawColor(212, 207, 198); doc.line(M, y, W - M, y); nl(20);
  text(REPORT_FOOTER, { size: 10.5, colour: [90, 85, 79], gap: 14 });

  doc.save(`lost-and-found-${(orgName || "audit").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.pdf`);
}

export { TOP_AT_RISK };
