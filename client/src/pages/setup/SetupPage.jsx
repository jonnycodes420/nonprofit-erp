// ONBOARD-5 · /onboard/setup. SETUP IS ONE CALM PAGE AT A TIME.
//
// Ten steps on their own full page (Jonathan approved the mockup on 24 Nov,
// _briefs/ONBOARD-5-mockup.html, with no step for an email-marketing tool): thin progress bars
// across the top (click any to jump), "Step N of 10 · <name>" and "About N
// minutes left", then one step per page: kicker, a Fraunces headline that says
// what she gets, one lead line, the content, and Back · Skip for now · Continue.
// The page she is on is stored (server/onboard/guided.js), so she leaves and
// comes back to the same step on any device. Each step's done-state is read
// from what really happened; Continue on Funds and How you talk confirms them.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../../api";
import { BOOKING_URL } from "../../marketing/booking/config";
import { C, SERIF, FONT_CSS, btn, count } from "./ui";
import { MakeItYours, ReceiptsAndLetters } from "./StepsBrand";
import { BringDonors, FundsCampaigns, HowYouTalk } from "./StepsPeople";
import { WhereGiftsComeIn, QuickBooks, Email } from "./StepsConnect";
import { InviteTeam, YoureSet } from "./StepsTeam";

const PAGE_CSS = `${FONT_CSS}
.setup-wrap{max-width:820px;margin:0 auto;padding:26px 16px 64px}
.setup-wrap button:disabled{opacity:.45;cursor:default}
.setup-wrap button:focus-visible,.setup-wrap a:focus-visible{outline:2px solid ${"#0d5c3a"};outline-offset:2px}
@media (max-width:640px){.setup-three,.setup-gets,.setup-overview{grid-template-columns:1fr!important}.setup-act{width:100%}.setup-act>*{width:100%;justify-content:center}.setup-h1{font-size:27px!important}}`;

// What each page says (the mockup's words, with her organization's name).
const HEAD = {
  yours: { t: o => `Let's make Steward look like ${o || "you"}`, l: "Your logo and colors go on every receipt, letter, email and giving page." },
  people: { t: () => "Bring in your donors", l: "Pick whichever is easiest. You can always add more later." },
  letters: { t: () => "Make your receipts and thank-yous yours", l: "This is what your donors hold in their hands. We'll get it right before the first one goes out." },
  funds: { t: () => "Here's what we found in your file", l: "Tidy these once and every report, receipt and letter reads right." },
  voice: { t: () => "Steward should sound like you", l: "A few choices that change what Steward counts and says." },
  gifts: { t: () => "Connect where your gifts already come in", l: "Every online gift lands on the right donor without anyone typing it. Nothing changes about how people give." },
  quickbooks: { k: "Connect · QuickBooks", t: () => "Connect QuickBooks so your books and Steward agree", l: "Gifts post to the right accounts and funds, and your bookkeeper stops re-typing them." },
  email: { k: "Connect · Email", t: () => "Connect your email so every donor conversation is in one place", l: "Steward reads mail to and from your donors and files it on their page. It never sends anything on its own." },
  team: { t: () => "Who else should be in Steward?", l: "Everyone gets their own login. There's no extra charge per person." },
  call: { t: () => "Here's who to call this week", l: "Steward has read your history. These are the first people worth a call, and why." },
};

export default function SetupPage() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [d, setD] = useState(null);
  const [org, setOrg] = useState(null);
  const [status, setStatus] = useState(null);
  const [at, setAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const saveRef = useRef(null);
  const registerSave = useCallback(fn => { saveRef.current = fn; }, []);

  const load = useCallback(() => Promise.all([
    apiFetch("/onboarding/guided?page=1"),
    apiFetch("/onboarding/setup/org"),
  ]).then(([g, o]) => { setD(g); setOrg(o); return g; }), []);

  useEffect(() => {
    document.title = "Set up Steward";
    load().then(g => {
      const asked = params.get("step");
      const ids = (g.steps || []).map(s => s.id);
      setAt(ids.includes(asked) ? asked : g.current || ids[0]);
    }).catch(() => setErr("Setup could not be read just now. Try again in a minute."));
    apiFetch("/oauth/status").then(setStatus).catch(() => setStatus(null));
  }, []);

  // She comes back to the page she was on.
  useEffect(() => {
    if (!at) return;
    saveRef.current = null;
    window.scrollTo(0, 0);
    if (params.get("step") !== at) setParams({ step: at }, { replace: true });
    apiFetch("/onboarding/guided/at", { method: "POST", body: JSON.stringify({ step: at }) }).catch(() => {});
  }, [at]);

  if (err) return <Shell org={null}><p style={{ color: C.ink }}>{err}</p></Shell>;
  if (!d || !org || !at) return <Shell org={org && org.name}><p style={{ color: C.dim }}>Opening your setup…</p></Shell>;

  const steps = d.steps;
  const i = Math.max(0, steps.findIndex(s => s.id === at));
  const s = steps[i];
  const last = i === steps.length - 1;
  const left = steps.slice(i).filter(x => !x.done).reduce((a, x) => a + (x.minutes || 0), 0);
  const reload = () => { load().catch(() => {}); };
  const go = id => setAt(id);
  const next = async () => {
    setBusy(true);
    try {
      if (saveRef.current && !(await saveRef.current())) { setBusy(false); return; }
      if (s.id === "funds" || s.id === "voice") await apiFetch("/onboarding/guided/confirm", { method: "POST", body: JSON.stringify({ step: s.id }) });
      if (last) { await apiFetch("/onboarding/guided/finish", { method: "POST", body: "{}" }); nav("/app/dashboard"); return; }
      await load();
      setAt(steps[i + 1].id);
    } catch { setErr("That didn't save. Try again in a minute."); }
    setBusy(false);
  };
  const skip = async () => {
    setBusy(true);
    await apiFetch("/onboarding/guided/skip", { method: "POST", body: JSON.stringify({ step: s.id, skip: true }) }).catch(() => null);
    await load().catch(() => {});
    setBusy(false);
    setAt(steps[i + 1].id);
  };
  const head = HEAD[s.id];
  const body = {
    yours: <MakeItYours org={org} reload={reload} />,
    people: <BringDonors step={s} reload={reload} go={go} />,
    letters: <ReceiptsAndLetters org={org} reload={reload} />,
    funds: <FundsCampaigns reload={reload} />,
    voice: <HowYouTalk registerSave={registerSave} />,
    gifts: <WhereGiftsComeIn reload={reload} />,
    quickbooks: <QuickBooks status={status} />,
    email: <Email status={status} />,
    team: <InviteTeam reload={reload} />,
    call: <YoureSet />,
  }[s.id];

  return <Shell org={org.name}>
    <div role="list" aria-label="Setup steps" style={{ display: "flex", gap: 6, marginBottom: 8 }}>
      {steps.map((x, j) => <button key={x.id} type="button" role="listitem" data-testid="setup-bar" data-step={x.id} data-done={x.done ? "1" : "0"} data-skipped={x.skipped ? "1" : "0"}
        aria-current={j === i ? "step" : undefined} aria-label={`Step ${j + 1}: ${x.title}${x.done ? ", done" : x.skipped ? ", skipped" : ""}`} onClick={() => setAt(x.id)}
        style={{ flex: 1, height: 4, padding: 0, border: 0, borderRadius: 2, cursor: "pointer", background: j === i ? C.emerald : x.done ? C.ink : C.line2 }} />)}
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, color: C.dim, marginBottom: 24, flexWrap: "wrap" }}>
      <span data-testid="setup-count">Step {i + 1} of {steps.length} · {s.title}</span>
      <span data-testid="setup-eta">{left ? `About ${count(left, "minute")} left` : "Done"}</span>
    </div>
    <section data-testid="setup-step" data-step={s.id} aria-labelledby="setup-h1">
      <div style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 700, color: C.emerald }}>{head.k || s.title}</div>
      <h1 id="setup-h1" className="setup-h1" style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, lineHeight: 1.15, margin: "6px 0 8px", color: C.ink }}>{head.t(org.name)}</h1>
      <p style={{ color: C.dim, margin: "0 0 22px", fontSize: 16.5, lineHeight: 1.5 }}>{head.l}</p>
      {body}
    </section>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
      <button type="button" data-testid="setup-back" style={{ ...btn("ghost"), visibility: i ? "visible" : "hidden" }} onClick={() => setAt(steps[i - 1].id)}>← Back</button>
      <span style={{ flex: 1 }} />
      {!last && <button type="button" data-testid="setup-skip" style={btn("ghost")} disabled={busy} onClick={skip}>Skip for now</button>}
      <button type="button" data-testid="setup-next" style={btn("primary")} disabled={busy} onClick={next}>{last ? "Go to Home" : "Continue"}</button>
    </div>
    <p style={{ textAlign: "center", marginTop: 18, fontSize: 13.5, color: C.dim }}>Stuck? Jonathan sets this up with you.{" "}
      <a href={BOOKING_URL} target="_blank" rel="noopener noreferrer" style={{ color: C.emerald, fontWeight: 700 }}>Book 30 minutes</a> or just reply to his email.</p>
  </Shell>;
}

function Shell({ org, children }) {
  return <div style={{ minHeight: "100vh", background: C.cream, color: C.ink, fontFamily: "'DM Sans',system-ui,sans-serif", fontSize: 15, lineHeight: 1.55 }}>
    <style>{PAGE_CSS}</style>
    <header style={{ background: C.ink, color: C.white, padding: "16px 24px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <a href="/app/dashboard" style={{ fontFamily: SERIF, fontSize: 22, color: C.white, textDecoration: "none" }}>Steward</a>
      <span style={{ marginLeft: "auto", fontSize: 13, opacity: 0.8 }}>{org ? `Setting up ${org} · saved as you go` : "Saved as you go"}</span>
    </header>
    <main className="setup-wrap">{children}</main>
  </div>;
}
