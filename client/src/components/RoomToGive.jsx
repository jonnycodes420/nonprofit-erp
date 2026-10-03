// PROSPECT-1 — Room to give, screening files, public filings, prospect briefs.
//
// Everything here is drawn only for admins and staff with the major gifts
// permission (lib/majorGifts.js), and every route behind it refuses anyone
// else, so the server is the boundary and this is only what to draw.
//
// Room to give is a PLAIN WORD and its reasons: Strong, Some, or Not yet
// known. Never a meter, never a made-up number. A wealth figure is always a
// range from a named screening file with its date. Nothing here sends anything.
import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { T, Modal } from "./shared";
import { ColumnTargetSelect } from "./ColumnTargetSelect";
import { errorMessage } from "../lib/domainError";
import { postDownload, rangeOf, dollarsOf, dateWords, ROOM_LABEL } from "../lib/majorGifts";

const LABEL = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink3 };
const LINK = { background: "none", border: "none", padding: 0, color: T.greenDk, fontWeight: 700, fontSize: 12.5, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" };
const BTN = { background: T.greenDk, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const GHOST = { background: T.white, color: T.ink, border: "1px solid " + T.bg3, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const DANGER = { background: T.terracotta, color: T.white, border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const INPUT = { border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 10px", fontSize: 13, fontFamily: "inherit", background: T.white, color: T.ink, boxSizing: "border-box", width: "100%" };

// ── Room to give, in the scores card ───────────────────────────────────────
export function RoomToGiveBlock({ donorId, isReadOnly }) {
  const [r, setR] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = () => apiFetch(`/donors/${donorId}/room-to-give`).then(setR).catch(() => setR(false));
  useEffect(() => { setR(null); load(); }, [donorId]);
  if (!r) return null;
  const s = r.screening;
  const del = async () => {
    setBusy(true); setErr("");
    try { await apiFetch(`/donors/${donorId}/screening`, { method: "DELETE" }); setConfirm(false); await load(); }
    catch (e) { setErr(errorMessage(e, "The screening results were not deleted.")); }
    finally { setBusy(false); }
  };
  return (
    <div data-testid="dp-room-to-give" data-room-word={r.word} style={{ borderTop: "1px solid " + T.bg2, marginTop: 12, paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={LABEL}>Room to give</span>
        <span data-testid="dp-room-word" style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{r.label || ROOM_LABEL[r.word]}</span>
      </div>
      {(r.reasons || []).length > 0 && (
        <ul data-testid="dp-room-reasons" style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, color: T.ink2, lineHeight: 1.55 }}>
          {r.reasons.map(x => <li key={x.key}>{x.text}</li>)}
        </ul>
      )}
      {s && <div data-testid="dp-room-screening" style={{ fontSize: 12, color: T.ink3, marginTop: 6, lineHeight: 1.5 }}>
        From {s.provider}'s screening file, {dateWords(s.screenedOn)}.{" "}
        {!isReadOnly && <button type="button" data-testid="dp-room-delete" onClick={() => setConfirm(true)} style={{ ...LINK, color: T.ink3, fontWeight: 600 }}>Delete screening results</button>}
      </div>}
      {confirm && (
        <Modal onClose={() => setConfirm(false)} title="Delete these screening results?" width={420}>
          <p style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.6, marginTop: 0 }}>
            This removes what {s ? s.provider : "the screening provider"} sent back for this person. Their own giving stays, and Room to give goes back to what their own record shows. The deletion is recorded in the audit log.
          </p>
          {err && <div style={{ fontSize: 13, color: T.ink2, marginBottom: 8 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" style={GHOST} onClick={() => setConfirm(false)}>Keep them</button>
            <button type="button" data-testid="dp-room-delete-confirm" style={{ ...DANGER, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={del}>{busy ? "Deleting…" : "Delete"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── An organization's public filing, from the cache ────────────────────────
// The read only ever reads the cache; the lookup is a person's POST.
export function usePublicFiling(donorId, enabled) {
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!enabled) { setF(null); return; }
    let live = true;
    apiFetch(`/donors/${donorId}/public-filing`).then(r => live && setF(r)).catch(() => live && setF(false));
    return () => { live = false; };
  }, [donorId, enabled]);
  return [f, setF];
}

export function PublicFilingBlock({ data }) {
  const f = data && data.filing;
  if (!f) return null;
  return (
    <div data-testid="dp-public-filing" style={{ borderTop: "1px solid " + T.bg2, marginTop: 12, paddingTop: 10, fontSize: 12.5, color: T.ink2, lineHeight: 1.6 }}>
      <div style={LABEL}>Public filing</div>
      {f.totalAssetsCents != null && <div>Total assets: <strong style={{ color: T.ink }}>{dollarsOf(f.totalAssetsCents)}</strong></div>}
      {f.revenueCents != null && <div>Revenue: <strong style={{ color: T.ink }}>{dollarsOf(f.revenueCents)}</strong></div>}
      {f.taxYear && <div>Last filing year: <strong style={{ color: T.ink }}>{f.taxYear}</strong></div>}
      <div style={{ fontSize: 12, color: T.ink3 }}>
        Source: {f.sourceUrl ? <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: T.ink3 }}>{f.source}</a> : f.source}.
        {f.ein ? ` EIN ${f.ein}.` : ""}
      </div>
    </div>
  );
}

// "Look up public filing" from the More menu: a POST, by a person.
export function PublicFilingLookupModal({ donorId, onClose, onLoaded }) {
  const [state, setState] = useState({ busy: true });
  useEffect(() => {
    let live = true;
    apiFetch(`/donors/${donorId}/public-filing/refresh`, { method: "POST", body: "{}" })
      .then(r => { if (!live) return; setState({ r }); onLoaded && onLoaded(r); })
      .catch(e => live && setState({ err: errorMessage(e, "The public filing could not be looked up just now.") }));
    return () => { live = false; };
  }, [donorId]);
  const r = state.r;
  return (
    <Modal onClose={onClose} title="Public filing" width={460}>
      <div data-testid="filing-lookup">
        {state.busy && !r && !state.err && <div style={{ fontSize: 13.5, color: T.ink3 }}>Looking them up in the IRS file…</div>}
        {state.err && <div style={{ fontSize: 13.5, color: T.ink2 }}>{state.err}</div>}
        {r && !r.ein && <div style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.6 }}>There is no EIN on this record, so there is no filing to look up. Add the EIN to the organization's record and try again.</div>}
        {r && r.notLoaded && <div data-testid="filing-not-loaded" style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.6 }}>{r.message}</div>}
        {r && r.ein && !r.filing && !r.notLoaded && <div style={{ fontSize: 13.5, color: T.ink2, lineHeight: 1.6 }}>EIN {r.ein} is not in the IRS file{r.notFound && r.notFound.source ? ` (${r.notFound.source})` : ""}.</div>}
        {r && r.filing && <PublicFilingBlock data={r} />}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}><button type="button" style={GHOST} onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  );
}

// ── The prospect brief ─────────────────────────────────────────────────────
export function ProspectBriefModal({ donorId, name, onClose, onSaved }) {
  const [state, setState] = useState({ busy: true });
  useEffect(() => {
    let live = true;
    apiFetch(`/donors/${donorId}/prospect-brief`, { method: "POST", body: "{}" })
      .then(r => { if (!live) return; setState({ r }); onSaved && onSaved(r); })
      .catch(e => live && setState({ err: errorMessage(e, "The brief could not be written just now.") }));
    return () => { live = false; };
  }, [donorId]);
  const b = state.r && state.r.brief;
  const sections = [];
  if (b) for (const l of b.lines || []) {
    const last = sections[sections.length - 1];
    if (last && last.section === l.section) last.lines.push(l); else sections.push({ section: l.section, lines: [l] });
  }
  return (
    <Modal onClose={onClose} title={b ? b.title : `Prospect brief${name ? ": " + name : ""}`} width={620}>
      <div data-testid="prospect-brief" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {!b && !state.err && <div style={{ fontSize: 13.5, color: T.ink3 }}>Writing the brief from their record, the screening results and the public filing…</div>}
        {state.err && <div style={{ fontSize: 13.5, color: T.ink2 }}>{state.err}</div>}
        {b && sections.map(sec => (
          <div key={sec.section || "s"}>
            {sec.section && <div style={{ ...LABEL, marginBottom: 4 }}>{sec.section}</div>}
            {sec.lines.map((l, i) => (
              <div key={i} data-brief-line style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.55, padding: "3px 0" }}>
                {l.text} <span style={{ fontSize: 11.5, color: T.ink3 }}>Source: {l.source}</span>
              </div>
            ))}
          </div>
        ))}
        {b && (b.notKnown || []).length > 0 && <div>
          <div style={{ ...LABEL, marginBottom: 4 }}>Not known</div>
          {b.notKnown.map((t, i) => <div key={i} style={{ fontSize: 13, color: T.ink2, lineHeight: 1.5 }}>{t}</div>)}
        </div>}
        {b && <div data-testid="prospect-brief-saved" style={{ fontSize: 12.5, color: T.greenDk, fontWeight: 600 }}>
          Saved to their files{state.r.fileName ? ` as ${state.r.fileName}` : ""}. Nothing was sent.
        </div>}
        <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" style={GHOST} onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  );
}

// ── Prepare a screening file ───────────────────────────────────────────────
// `who` is { donorIds } (the ticked people) or null, which asks for a saved
// Group. A preview first: how many people, and exactly which fields leave
// Steward. The file downloads only after that, and Steward sends it nowhere.
export function ScreeningFileModal({ who: given, onClose }) {
  const [groups, setGroups] = useState(null);
  const [groupId, setGroupId] = useState("");
  const who = given && given.donorIds && given.donorIds.length ? given : (groupId ? { groupId } : null);
  const [p, setP] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (given && given.donorIds && given.donorIds.length) return;
    apiFetch("/groups").then(r => setGroups((r && r.groups) || [])).catch(() => setGroups([]));
  }, []);
  useEffect(() => {
    setP(null); setErr(""); setDone(false);
    if (!who) return;
    apiFetch("/screening/preview", { method: "POST", body: JSON.stringify(who) }).then(setP)
      .catch(e => setErr(errorMessage(e, "The preview could not be prepared.")));
  }, [JSON.stringify(who)]);
  const download = async () => {
    setBusy(true); setErr("");
    try { await postDownload("/screening/file", who, `screening-file-${new Date().toISOString().slice(0, 10)}.csv`); setDone(true); }
    catch (e) { setErr(errorMessage(e, "The file did not download.")); }
    finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title="Prepare a screening file" width={500}>
      <div data-testid="screening-file" style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13.5, color: T.ink2, lineHeight: 1.6 }}>
        {groups && <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={LABEL}>Which group</span>
          <select data-testid="screening-file-group" value={groupId} onChange={e => setGroupId(e.target.value)} style={INPUT}>
            <option value="">Choose a saved group</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}{g.count != null ? ` (${g.count})` : ""}</option>)}
          </select>
          {!groups.length && <span style={{ fontSize: 12.5, color: T.ink3 }}>There are no saved groups yet. Tick people on the Donors list instead.</span>}
        </label>}
        {who && !p && !err && <div style={{ color: T.ink3 }}>Counting who is in it…</div>}
        {p && <>
          <div data-testid="screening-file-count"><strong style={{ color: T.ink }}>{p.count === 1 ? "One person" : `${p.count} people`}</strong> will be in the file.</div>
          <div>
            <div style={LABEL}>These fields leave Steward</div>
            <div data-testid="screening-file-fields">{(p.fields || []).join(", ")}.</div>
          </div>
          <div style={{ fontSize: 12.5, color: T.ink3 }}>
            {p.withAddress} with an address, {p.withEmail} with an email, {p.withSpouse} with a spouse name. No giving, notes or scores are in the file.
          </div>
          {p.sentence && <div style={{ fontSize: 12.5, color: T.ink3 }}>{p.sentence}</div>}
        </>}
        {err && <div>{err}</div>}
        {done && <div data-testid="screening-file-done" style={{ color: T.greenDk, fontWeight: 600 }}>Downloaded. Send it to your screening provider yourself; Steward sends it nowhere.</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={GHOST} onClick={onClose}>{done ? "Close" : "Cancel"}</button>
          {p && !done && <button type="button" data-testid="screening-file-download" style={{ ...BTN, opacity: busy || !p.count ? 0.6 : 1 }} disabled={busy || !p.count} onClick={download}>{busy ? "Preparing…" : "Download the file"}</button>}
        </div>
      </div>
    </Modal>
  );
}

// ── Bring in screening results ─────────────────────────────────────────────
// The provider's returned file, through the one column mapper. Unmatched rows
// are listed, never guessed.
export function ScreeningImportModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);       // { name, text }
  const [provider, setProvider] = useState("");
  const [screenedOn, setScreenedOn] = useState(new Date().toISOString().slice(0, 10));
  const [pre, setPre] = useState(null);
  const [mapping, setMapping] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setErr(""); setPre(null); setResult(null);
    const text = await f.text();
    setFile({ name: f.name, text });
    setBusy(true);
    try {
      const r = await apiFetch("/screening/import/preview", { method: "POST", body: JSON.stringify({ csv: text, fileName: f.name }) });
      setPre(r);
      const m = {};
      for (const h of r.headers || []) m[h] = (r.proposal && r.proposal[h]) || "ignore";
      setMapping(m);
    } catch (e2) { setErr(errorMessage(e2, "That file could not be read.")); }
    finally { setBusy(false); }
  };
  const taken = new Set(Object.values(mapping).filter(v => String(v).startsWith("std:")).map(v => v.slice(4)));
  const go = async () => {
    setBusy(true); setErr("");
    try {
      const flat = {};
      for (const [h, v] of Object.entries(mapping)) flat[h] = String(v).startsWith("std:") ? v.slice(4) : "ignore";
      const r = await apiFetch("/screening/import", { method: "POST", body: JSON.stringify({ csv: file.text, fileName: file.name, provider: provider.trim(), screenedOn, mapping: flat }) });
      setResult(r); onDone && onDone(r);
    } catch (e) { setErr(errorMessage(e, "The results were not brought in. Nothing was written.")); }
    finally { setBusy(false); }
  };
  const ready = file && pre && provider.trim() && /^\d{4}-\d{2}-\d{2}$/.test(screenedOn) && !busy;
  return (
    <Modal onClose={onClose} title="Bring in screening results" width={640}>
      <div data-testid="screening-import" style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5, color: T.ink2, lineHeight: 1.55 }}>
        {!result && <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={LABEL}>Screening provider</span>
              <input data-testid="screening-provider" value={provider} onChange={e => setProvider(e.target.value)} placeholder="Who screened the file" style={INPUT} /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={LABEL}>Date screened</span>
              <input data-testid="screening-date" type="date" value={screenedOn} onChange={e => setScreenedOn(e.target.value)} style={INPUT} /></label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={LABEL}>The file they sent back</span>
            <input data-testid="screening-file-input" type="file" accept=".csv,text/csv" onChange={pick} style={{ fontSize: 13 }} /></label>
          {pre && <div>
            <div style={{ ...LABEL, marginBottom: 6 }}>What each column becomes</div>
            <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 8 }}>{pre.rowCount === 1 ? "One row" : `${pre.rowCount} rows`} in the file. A row is matched by the Steward ID it carries, else by email, else by name and ZIP together. Anything else is listed, not guessed.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(pre.headers || []).map(h => (
                <div key={h} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr)", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis" }} title={h}>{h}</div>
                  <ColumnTargetSelect header={h} standardFields={pre.standardFields || []} cfDefs={{ donor: [], gift: [] }} entity="donor"
                    value={mapping[h] || "ignore"} takenStd={new Set([...taken].filter(k => mapping[h] !== "std:" + k))}
                    onChange={v => setMapping(m => ({ ...m, [h]: v }))} compact allowNew={false} testId={"screening-map-" + h} />
                </div>
              ))}
            </div>
          </div>}
        </>}
        {err && <div>{err}</div>}
        {result && <div data-testid="screening-import-result">
          <div style={{ fontSize: 14.5, color: T.ink, fontWeight: 700 }}>
            {result.matched === 1 ? "One person" : `${result.matched} people`} matched{result.rows != null ? ` of ${result.rows} rows` : ""}.
            {(result.strongNow || []).length ? ` Now Strong: ${result.strongNow.map(x => x.name).join(", ")}.` : ""}
          </div>
          <div style={{ fontSize: 12.5, color: T.ink3 }}>Stored with the provider's name and the date screened. Room to give now shows their screening reasons.</div>
          {(result.unmatched || []).length > 0 && <div style={{ marginTop: 10 }}>
            <div style={LABEL}>Not matched, so not brought in</div>
            {result.unmatched.map(u => (
              <div key={u.row} data-screening-unmatched={u.row} style={{ fontSize: 13, padding: "4px 0", borderTop: "1px solid " + T.bg2 }}>
                Row {u.row}: {u.name || "no name"}{u.email ? ` (${u.email})` : ""}. {u.why}
              </div>
            ))}
          </div>}
        </div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={GHOST} onClick={onClose}>{result ? "Close" : "Cancel"}</button>
          {!result && <button type="button" data-testid="screening-import-go" style={{ ...BTN, opacity: ready ? 1 : 0.6 }} disabled={!ready} onClick={go}>{busy ? "Working…" : "Bring them in"}</button>}
        </div>
      </div>
    </Modal>
  );
}

// "Capacity range from the screening file: $25,000 to $50,000" when a caller
// has the numbers to hand.
export { rangeOf };
