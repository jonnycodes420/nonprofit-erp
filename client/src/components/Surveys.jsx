// SURVEY-1 — Communications → Surveys. Build a survey, share it (link, QR,
// embed), read the answers (every count opens the responses behind it), and
// "Send this survey", which writes drafts for a person to send. Steward sends
// nothing on its own.
import { useState, useEffect } from "react";
import { apiFetch, API, getToken } from "../api";
import { T, Modal, Spin } from "./shared";
import { Figure } from "./Figure";
import { QrCodeBlock, EmbedCodeBlock } from "./ShareBlocks";
import { errorMessage } from "../lib/domainError";
import { QUESTION_TYPES, CHOICE_TYPES, privacySentence } from "../../../shared/surveyShape.js";

const LABEL = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };
const card = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 12, padding: "16px 18px" };
const field = { width: "100%", boxSizing: "border-box", border: "1px solid " + T.bg3, borderRadius: 8, padding: "9px 10px", fontSize: 13.5, fontFamily: "inherit", background: T.white, color: T.ink };
const btn = { background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const quiet = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };

const blankQuestion = () => ({ type: "one", label: "", required: false, options: ["", ""] });
const blankSurvey = () => ({ title: "", intro: "", thankYou: "", mode: "named", audience: "donors", sections: [{ title: "", questions: [blankQuestion()] }] });

export function SurveysPanel({ isReadOnly, orgName, onOpenDrafts }) {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);       // survey being built or edited
  const [results, setResults] = useState(null); // survey id
  const [share, setShare] = useState(null);     // survey
  const [msg, setMsg] = useState("");
  const load = () => apiFetch("/surveys").then(setD).catch(() => setD({ surveys: [] }));
  useEffect(() => { load(); }, []);
  if (!d) return <div style={{ padding: 40, textAlign: "center" }}><Spin /></div>;

  const send = async s => {
    setMsg("");
    try { const r = await apiFetch(`/surveys/${s.id}/drafts`, { method: "POST", body: JSON.stringify({}) }); setMsg(r.sentence); }
    catch (e) { setMsg(errorMessage(e, "The drafts could not be made.")); }
  };
  const setStatus = async (s, status) => { await apiFetch(`/surveys/${s.id}`, { method: "PUT", body: JSON.stringify({ status }) }).catch(() => {}); load(); };
  const setVolunteer = async id => { await apiFetch("/surveys-volunteer-followup", { method: "PUT", body: JSON.stringify({ surveyId: id || null }) }).catch(() => {}); load(); };

  if (results) return <SurveyResults id={results} onBack={() => setResults(null)} />;
  return (
    <div data-testid="surveys" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink }}>Surveys</h2>
        {!isReadOnly && <button style={btn} data-testid="survey-new" onClick={() => setEdit(blankSurvey())}>New survey</button>}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: T.ink2, lineHeight: 1.55 }}>
        Ask your donors and volunteers what they think. Share a survey by link, QR code or on your own website. "Send this survey" puts a draft for each person in Drafts to review; nothing goes out until you send it. A named answer lands on that person's record.
      </p>
      {msg && <div style={{ ...card, borderLeft: "3px solid " + T.greenDk, fontSize: 13, color: T.ink }}>{msg}{onOpenDrafts && / draft/.test(msg) && <> <button style={{ ...quiet, marginLeft: 8 }} onClick={onOpenDrafts}>Open drafts to review</button></>}</div>}
      {!d.surveys.length && <div style={{ ...card, fontSize: 13.5, color: T.ink3 }}>No surveys yet. "Why do you give?" is a good first one.</div>}
      {d.surveys.map(s => (
        <div key={s.id} data-survey={s.id} style={{ ...card, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>{s.title}</div>
            <div style={{ fontSize: 12.5, color: T.ink3, marginTop: 2 }}>
              {s.mode === "anonymous" ? "Anonymous" : "Named"} · {s.audience === "volunteers" ? "for volunteers" : s.audience === "donors" ? "for donors" : String(s.audience || "").startsWith("group:") ? "for a group" : "for anyone"} · {s.status === "open" ? "open" : "closed"}
            </div>
          </div>
          <div style={{ fontSize: 13, color: T.ink2 }}>
            <Figure value={s.responses} kind="count" label={`${s.title}: responses`} source={{ key: "survey-answers", params: { survey: s.id } }} variant="inline" /> responses
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={quiet} data-testid="survey-results" onClick={() => setResults(s.id)}>Results</button>
            <button style={quiet} onClick={() => setShare(s)}>Share</button>
            {!isReadOnly && <button style={quiet} onClick={() => setEdit(s)}>Edit</button>}
            {!isReadOnly && s.status === "open" && <button style={btn} data-testid="survey-send" onClick={() => send(s)}>Send this survey</button>}
            {!isReadOnly && <button style={quiet} onClick={() => setStatus(s, s.status === "open" ? "closed" : "open")}>{s.status === "open" ? "Close" : "Reopen"}</button>}
          </div>
        </div>
      ))}
      <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: T.ink2, flex: "1 1 280px" }}>Volunteer follow-up: the thank-you drafted when a volunteer reaches an hours milestone can carry a link to one survey.</span>
        <select aria-label="Volunteer follow-up survey" value={d.volunteerSurveyId || ""} disabled={isReadOnly} onChange={e => setVolunteer(e.target.value)} style={{ ...field, width: 260 }}>
          <option value="">No survey on volunteer thank-yous</option>
          {d.surveys.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </div>
      {edit && <SurveyBuilder initial={edit} orgName={orgName} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {share && (
        <Modal onClose={() => setShare(null)} title={`Share: ${share.title}`} width={520}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={LABEL}>Link</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={share.url} style={field} onFocus={e => e.target.select()} />
              <button style={quiet} onClick={() => { try { navigator.clipboard.writeText(share.url); setMsg("Link copied."); } catch { /* ignore */ } }}>Copy</button>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: T.ink3 }}>Put it in your own email or newsletter. {share.mode === "named" ? "Opened from this link, it asks for a name and email; drafts from \"Send this survey\" carry each person's own link instead." : "It is anonymous whoever opens it."}</p>
            <QrCodeBlock url={share.url} filenameBase={`survey-${share.slug}`} />
            <EmbedCodeBlock url={share.url + "?embed=1"} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function SurveyBuilder({ initial, orgName, onClose, onSaved }) {
  const [s, setS] = useState(() => JSON.parse(JSON.stringify(initial)));
  // PARITY-1 Part D — a survey can be for one of the org's Groups.
  const [groupOpts, setGroupOpts] = useState([]);
  useEffect(() => { apiFetch("/groups").then(r => setGroupOpts((r && r.groups) || [])).catch(() => setGroupOpts([])); }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const setSec = (si, f) => setS(x => ({ ...x, sections: x.sections.map((sec, i) => (i === si ? f(sec) : sec)) }));
  const setQ = (si, qi, f) => setSec(si, sec => ({ ...sec, questions: sec.questions.map((q, i) => (i === qi ? f(q) : q)) }));
  const save = async () => {
    setBusy(true); setErr("");
    const body = { ...s, sections: s.sections.map(sec => ({ ...sec, questions: sec.questions.map(q => ({ ...q, options: (q.options || []).map(o => o.trim()).filter(Boolean) })) })) };
    try { await apiFetch(s.id ? `/surveys/${s.id}` : "/surveys", { method: s.id ? "PUT" : "POST", body: JSON.stringify(body) }); onSaved(); }
    catch (e) { setErr(errorMessage(e, "The survey could not be saved.")); }
    setBusy(false);
  };
  return (
    <Modal onClose={onClose} title={s.id ? "Edit survey" : "New survey"} width={640}>
      <div data-testid="survey-builder" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input aria-label="Survey title" placeholder="Title, for example: Why do you give?" value={s.title} onChange={e => setS({ ...s, title: e.target.value })} style={field} />
        <textarea aria-label="Introduction" placeholder="A sentence or two at the top (optional)" value={s.intro} onChange={e => setS({ ...s, intro: e.target.value })} style={{ ...field, minHeight: 60 }} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: T.ink2, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="radio" name="mode" checked={s.mode === "named"} onChange={() => setS({ ...s, mode: "named" })} /> Named
          </label>
          <label style={{ fontSize: 13, color: T.ink2, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="radio" name="mode" checked={s.mode === "anonymous"} onChange={() => setS({ ...s, mode: "anonymous" })} /> Anonymous
          </label>
          <select aria-label="Who it is for" value={s.audience} onChange={e => setS({ ...s, audience: e.target.value })} style={{ ...field, width: 200 }}>
            <option value="donors">For donors</option><option value="volunteers">For volunteers</option><option value="anyone">For anyone</option>
            {groupOpts.map(g => <option key={g.id} value={`group:${g.id}`}>For the group {g.name}</option>)}
          </select>
        </div>
        <div data-testid="survey-privacy-preview" style={{ fontSize: 12.5, color: T.ink2, background: T.bg, borderRadius: 8, padding: "9px 11px", lineHeight: 1.55 }}>
          <strong>The top of the survey says:</strong> {privacySentence(s.mode, orgName)}
        </div>
        {s.sections.map((sec, si) => (
          <div key={si} style={{ border: "1px solid " + T.bg3, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <input aria-label="Section title" placeholder={`Section ${si + 1} title (optional)`} value={sec.title} onChange={e => setSec(si, x => ({ ...x, title: e.target.value }))} style={field} />
            {sec.questions.map((q, qi) => (
              <div key={qi} data-builder-question style={{ background: T.bg, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input aria-label="Question" placeholder="The question" value={q.label} onChange={e => setQ(si, qi, x => ({ ...x, label: e.target.value }))} style={{ ...field, flex: "1 1 240px", width: "auto" }} />
                  <select aria-label="Question type" value={q.type} onChange={e => setQ(si, qi, x => ({ ...x, type: e.target.value, options: CHOICE_TYPES.includes(e.target.value) ? (x.options && x.options.length ? x.options : ["", ""]) : [] }))} style={{ ...field, width: 170 }}>
                    {QUESTION_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
                {CHOICE_TYPES.includes(q.type) && (
                  <textarea aria-label="Choices, one per line" placeholder="One choice per line" value={(q.options || []).join("\n")}
                    onChange={e => setQ(si, qi, x => ({ ...x, options: e.target.value.split("\n") }))} style={{ ...field, minHeight: 70 }} />
                )}
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <label style={{ fontSize: 12.5, color: T.ink2, display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={!!q.required} onChange={e => setQ(si, qi, x => ({ ...x, required: e.target.checked }))} /> Required
                  </label>
                  <button style={{ ...quiet, marginLeft: "auto" }} onClick={() => setSec(si, x => ({ ...x, questions: x.questions.filter((_, i) => i !== qi) }))}>Remove</button>
                </div>
              </div>
            ))}
            <button style={quiet} data-testid="survey-add-question" onClick={() => setSec(si, x => ({ ...x, questions: [...x.questions, blankQuestion()] }))}>Add a question</button>
          </div>
        ))}
        <button style={quiet} onClick={() => setS(x => ({ ...x, sections: [...x.sections, { title: "", questions: [blankQuestion()] }] }))}>Add a section</button>
        <textarea aria-label="Thank-you message" placeholder="Thank-you message (optional)" value={s.thankYou} onChange={e => setS({ ...s, thankYou: e.target.value })} style={{ ...field, minHeight: 50 }} />
        {err && <div style={{ fontSize: 13, color: T.gold700 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={quiet} onClick={onClose}>Cancel</button>
          <button style={btn} data-testid="survey-save" disabled={busy} onClick={save}>{busy ? "Saving" : "Save survey"}</button>
        </div>
      </div>
    </Modal>
  );
}

function SurveyResults({ id, onBack }) {
  const [d, setD] = useState(null);
  useEffect(() => { apiFetch(`/surveys/${id}/results`).then(setD).catch(() => setD(false)); }, [id]);
  const exportCsv = async () => {
    const r = await fetch(`${API}/surveys/${id}/export.csv`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob()), a = document.createElement("a");
    a.href = url; a.download = `${(d && d.survey.slug) || "survey"}-responses.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };
  if (d === null) return <div style={{ padding: 40, textAlign: "center" }}><Spin /></div>;
  if (!d) return <div style={card}>These results could not be loaded. <button style={quiet} onClick={onBack}>Back</button></div>;
  return (
    <div data-testid="survey-results-view" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button style={quiet} onClick={onBack}>Back to surveys</button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: T.ink, flex: "1 1 auto" }}>{d.survey.title}</h2>
        <button style={quiet} data-testid="survey-export" onClick={exportCsv}>Export CSV</button>
      </div>
      <div style={{ ...card, fontSize: 13, color: T.ink2 }}>
        <Figure value={d.total} kind="count" label="Responses" source={d.totalSource} variant="inline" /> responses · {d.survey.mode === "anonymous" ? "Anonymous" : "Named"}. <span style={{ color: T.ink3 }}>{d.privacy}</span>
      </div>
      {d.questions.map(q => {
        const max = Math.max(1, ...q.buckets.map(b => b.count));
        const text = q.type === "short" || q.type === "long";
        return (
          <div key={q.id} data-result-question={q.id} style={card}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: T.ink }}>{q.label}</div>
            <div style={{ fontSize: 12, color: T.ink3, margin: "2px 0 10px" }}>
              <Figure value={q.answered} kind="count" label={`${q.label}: answered`} source={q.answeredSource} variant="inline" /> answered{text ? ". Open the number to read every answer." : ""}
            </div>
            {!text && q.buckets.map(b => (
              <div key={b.key} style={{ display: "grid", gridTemplateColumns: "minmax(80px,180px) 1fr 44px", gap: 10, alignItems: "center", padding: "3px 0" }}>
                <span style={{ fontSize: 13, color: T.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.label}</span>
                <div style={{ background: T.bg, borderRadius: 4, height: 12 }}><div style={{ width: `${(b.count / max) * 100}%`, height: "100%", background: T.greenDk, borderRadius: 4 }} /></div>
                <span style={{ fontSize: 13, fontWeight: 700, textAlign: "right" }}><Figure value={b.count} kind="count" label={`${q.label}: ${b.label}`} source={b.source} variant="inline" /></span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
