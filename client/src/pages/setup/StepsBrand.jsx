// ONBOARD-5 · Make it yours, and Receipts and letters. Each saves as she goes
// through the route that already owns it (/orgs/branding, /org/vocabulary,
// PATCH /orgs/:id, /letters/signatures/org, /acknowledgments/templates).
import { useEffect, useState, lazy, Suspense } from "react";
import { apiFetch } from "../../api";
import { C, MONTHS, Card, Choices, Drop, Message, readFile, label, side, input, why, btn, link, usd, chip } from "./ui";

const SignatureField = lazy(() => import("../../components/letters/SignatureField"));
const UploadWordLetter = lazy(() => import("../../components/letters/UploadWordLetter"));
const STEWARD = "#0d5c3a";   // Steward's emerald, the color when her site gives none
const HEX = /^#[0-9a-f]{6}$/i;
const errText = (e, fallback) => (e && (e.body && (e.body.message || e.body.sentence || e.body.error))) || (e && e.message) || fallback;

// Save the one fiscal month without touching her other words (PUT replaces the whole set).
async function saveFiscal(month) {
  const cur = await apiFetch("/org/vocabulary");
  await apiFetch("/org/vocabulary", { method: "PUT", body: JSON.stringify({ ...(cur.vocabulary || {}), fiscal_year_start_month: month }) });
}

export function MakeItYours({ org, reload }) {
  const [logo, setLogo] = useState(org.logo);
  const [colors, setColors] = useState(null);
  const [colorSentence, setColorSentence] = useState("");
  const [color, setColor] = useState(org.color ? { key: org.color.toLowerCase() } : null);
  const [hex, setHex] = useState("");
  const [month, setMonth] = useState(org.fiscalMonth ? { key: String(org.fiscalMonth) } : null);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    apiFetch("/onboarding/setup/site-colors", { method: "POST", body: "{}" })
      .then(r => { setColors(r.colors || []); setColorSentence(r.sentence || ""); })
      .catch(() => { setColors([]); setColorSentence("We could not read your website, so these are Steward's colors."); });
  }, []);
  const say = (text, tone) => setMsg({ text, tone });
  const pickLogo = async f => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) return say("A PNG or JPG works best. Steward can't use that file type for a logo.", "bad");
    if (f.size > 512 * 1024) return say("That logo is over 512 KB. Save a smaller copy and drop it here again.", "bad");
    try { const data = await readFile(f); await apiFetch("/orgs/branding", { method: "PUT", body: JSON.stringify({ logoData: data }) }); setLogo(data); say("Saved. Your logo is on every receipt, letter and giving page now."); reload(); }
    catch (e) { say(errText(e, "That logo didn't save. Try again."), "bad"); }
  };
  const saveColor = async c => {
    try { await apiFetch("/orgs/branding", { method: "PUT", body: JSON.stringify({ brandAccent: c }) }); setColor({ key: c }); say("Saved."); reload(); }
    catch (e) { say(errText(e, "That color didn't save. Try again."), "bad"); }
  };
  const pickMonth = async m => {
    if (!m) return;
    try { await saveFiscal(m); setMonth({ key: String(m) }); say(`Saved. Your year runs ${MONTHS[m - 1]} to ${MONTHS[(m + 10) % 12]}.`); reload(); }
    catch (e) { say(errText(e, "That didn't save. Try again."), "bad"); }
  };
  const swatches = [...new Set([...(colors || []), STEWARD, ...(org.color ? [org.color.toLowerCase()] : [])])];
  const customOn = color && color.custom;
  const hexOk = HEX.test(hex.trim());
  return <Card testid="setup-yours">
    <span style={label}>Your logo</span>
    <Drop accept="image/png,image/jpeg,image/webp,image/gif" onFile={pickLogo} testid="setup-logo-drop">
      {logo ? <img src={logo} alt="Your logo" style={{ maxHeight: 72, maxWidth: "100%", display: "block", margin: "0 auto 8px" }} /> : null}
      {logo ? <>Drop a new logo to replace it, or <u>choose a file</u></> : <>Drop your logo here, or <u>choose a file</u></>}
      <br /><small>PNG or JPG works best</small>
    </Drop>
    <div style={{ marginTop: 22 }}>
      <span style={label}>Your color</span>
      <div style={side}>{colors == null ? "Reading your website…" : colorSentence}</div>
      <div role="radiogroup" aria-label="Your color" style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        {swatches.map(c => {
          const on = !customOn && color && color.key === c;
          return <button key={c} type="button" role="radio" aria-checked={on} aria-label={`Color ${c}`} data-swatch={c} onClick={() => saveColor(c)}
            style={{ width: 38, height: 38, borderRadius: "50%", background: c, border: `3px solid ${C.white}`, boxShadow: `0 0 0 ${on ? 2 : 1}px ${on ? C.ink : C.line2}`, cursor: "pointer" }} />;
        })}
        <button type="button" role="radio" aria-checked={!!customOn} onClick={() => setColor({ custom: true, key: "custom" })} style={chip(!!customOn)}>Custom</button>
      </div>
      {customOn && <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <input aria-label="Your color as a hex code" value={hex} onChange={e => setHex(e.target.value)} placeholder="#rrggbb" style={{ ...input, width: 140, marginTop: 0 }} />
        {hexOk ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5 }}><span style={{ width: 28, height: 28, borderRadius: 6, background: hex.trim() }} />Your receipts and giving pages use this color.</span>
          : <span style={side}>Six letters or digits after a #, the way your website writes it.</span>}
        <button type="button" style={btn("quiet")} disabled={!hexOk} onClick={() => saveColor(hex.trim().toLowerCase())}>Use this color</button>
      </div>}
    </div>
    <div style={{ marginTop: 22 }}>
      <span style={label}>Your fiscal year starts in</span>
      <Choices name="Fiscal year start" testid="setup-fiscal" value={month && ["1", "7", "10"].includes(month.key) ? month : month ? { custom: true } : null}
        options={[{ key: "1", label: "January" }, { key: "7", label: "July" }, { key: "10", label: "October" }]}
        onPick={v => v.custom ? setMonth({ custom: true, key: month && month.key }) : pickMonth(Number(v.key))} />
      {month && (month.custom || !["1", "7", "10"].includes(month.key)) && <select aria-label="Another month" value={month.key && !month.custom ? month.key : (month.key || "")}
        onChange={e => pickMonth(Number(e.target.value))} style={{ ...input, maxWidth: 240 }}>
        <option value="" disabled>Choose the month</option>
        {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
      </select>}
    </div>
    <Message {...(msg || {})} />
  </Card>;
}

// A receipt drawn from what she typed and a real gift of hers, before anything is saved.
function SampleReceipt({ f, gift }) {
  return <div data-testid="setup-sample-receipt" style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 18, background: C.white, fontSize: 13.5, lineHeight: 1.55 }}>
    <div style={{ fontWeight: 700, fontSize: 15 }}>{f.legalName || "Your legal name"}</div>
    <div style={side}>{f.receiptAddress || "The address that prints"} · EIN {f.ein || "XX-XXXXXXX"}</div>
    <p style={{ margin: "12px 0 0" }}>Received with thanks from <b>{gift ? gift.donor : "a donor"}</b>: <b>{gift ? usd(gift.amountCents) : "$100"}</b> on {gift && gift.date ? String(gift.date).slice(0, 10) : "the gift's date"}.</p>
    <p style={{ margin: "8px 0 0", color: C.dim }}>No goods or services were provided in exchange for this gift.</p>
    <p style={{ margin: "14px 0 0" }}>{f.receiptSignatureName || "Who signs"}{f.receiptSignatureTitle ? `, ${f.receiptSignatureTitle}` : ""}</p>
  </div>;
}

export function ReceiptsAndLetters({ org, reload }) {
  const [f, setF] = useState({ legalName: org.legalName, ein: org.ein, receiptAddress: org.receiptAddress, receiptSignatureName: org.signerName, receiptSignatureTitle: org.signerTitle });
  const [preview, setPreview] = useState(null);
  const [word, setWord] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = k => e => { setF(x => ({ ...x, [k]: e.target.value })); setPreview(null); };
  const look = async () => {
    setMsg(null);
    const s = await apiFetch("/onboarding/setup/sample").catch(() => ({ gift: null }));
    let letter = null;
    if (s.gift) {
      const r = await apiFetch("/acknowledgments/letters/preview", { method: "POST", body: JSON.stringify({ giftIds: [s.gift.id] }) }).catch(() => null);
      letter = r && r.letters && r.letters[0] ? r.letters[0].text : null;
    }
    setPreview({ gift: s.gift, letter });
  };
  const save = async () => {
    try { await apiFetch(`/orgs/${encodeURIComponent(org.id)}`, { method: "PATCH", body: JSON.stringify(f) }); setMsg({ text: "Saved. Your receipts and letters print this from now on." }); reload(); }
    catch (e) { setMsg({ text: errText(e, "That didn't save. Try again."), tone: "bad" }); }
  };
  const field = (k, name, half) => <div style={{ flex: half ? "1 1 240px" : "1 1 100%", minWidth: 0 }}>
    <label style={label}>{name}<input value={f[k] || ""} onChange={set(k)} style={input} /></label></div>;
  return <Card testid="setup-letters">
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>{field("legalName", "Legal name", true)}{field("ein", "EIN", true)}</div>
    <div style={{ marginTop: 14 }}>{field("receiptAddress", "Address on receipts")}</div>
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14 }}>{field("receiptSignatureName", "Who signs", true)}{field("receiptSignatureTitle", "Their title", true)}</div>
    <div style={{ marginTop: 14 }}>
      <span style={label}>Their signature</span>
      <div style={side}>A photo of it on white paper. It prints in its own color, so blue ink stays blue.</div>
      <Suspense fallback={null}><SignatureField scope="org" signerName={f.receiptSignatureName} /></Suspense>
    </div>
    <div style={{ marginTop: 18 }}>
      <span style={label}>Your thank-you letter</span>
      {word ? <Suspense fallback={<p style={side}>Opening…</p>}><UploadWordLetter onClose={() => setWord(false)} onSaved={() => { setWord(false); setMsg({ text: "Your letter is saved as your thank-you letter." }); }} /></Suspense>
        : <button type="button" data-testid="setup-word" onClick={() => setWord(true)} style={{ display: "block", width: "100%", border: "2px dashed rgba(13,92,58,.35)", borderRadius: 12, padding: 22, marginTop: 10, background: "transparent", color: C.dim, font: "inherit", cursor: "pointer" }}>
          Upload your Word letter. We keep your letterhead and find the fields.</button>}
    </div>
    {!preview ? <div style={why}>You'll see a sample receipt and letter with a real gift of yours before anything is saved.
      <div style={{ marginTop: 10 }}><button type="button" data-testid="setup-letters-preview" style={btn("primary")} onClick={look}>See the sample</button></div></div>
      : <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}><div style={{ ...side, fontWeight: 700, marginBottom: 6 }}>Receipt</div><SampleReceipt f={f} gift={preview.gift} /></div>
          <div style={{ flex: "1 1 280px", minWidth: 0 }}><div style={{ ...side, fontWeight: 700, marginBottom: 6 }}>Thank-you letter</div>
            <div data-testid="setup-sample-letter" style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 18, background: C.white, fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}>
              {preview.letter || (preview.gift ? "Your letter shows here once a letter template is saved." : "Once your donors are in, the sample uses a real gift of yours.")}</div></div>
        </div>
        {!preview.gift && <p style={side}>No gift of yours is in Steward yet, so the receipt shows where each part goes.</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" data-testid="setup-letters-save" style={btn("primary")} onClick={save}>Looks right. Save</button>
          <button type="button" style={link} onClick={() => setPreview(null)}>Change something</button>
        </div>
      </div>}
    <Message {...(msg || {})} />
  </Card>;
}
