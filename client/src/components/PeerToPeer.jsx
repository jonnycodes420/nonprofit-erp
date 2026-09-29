// client/src/components/PeerToPeer.jsx — BUILD-103 Part 6.
//
// THE SCREEN AN ORG RUNS A WALK FROM. One campaign at a time: what it has
// raised, every team and every fundraiser against their goal, WHO HAS NOT
// RAISED ANYTHING YET so somebody can pick up the phone, and the leaderboard
// the public sees.
//
// Its totals equal the public page's in cents, because both are the same live
// SUM over the same gift rows — never a stored counter. The identity is
// printed on the screen rather than assumed: teams + solo + direct = the page.
import { useState, useEffect } from "react";
import { apiFetch, API, getToken } from "../api";
import { T, Card } from "./shared";
import { errorMessage } from "../lib/domainError";

const h = { fontSize: 11, fontWeight: 800, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 };
const btn = primary => ({ background: primary ? T.greenDk : T.white, border: primary ? "none" : "1px solid " + T.bg3,
  borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, color: primary ? T.white : T.ink,
  cursor: "pointer", fontFamily: "inherit" });
const inp = { background: T.white, border: "1px solid " + T.bg3, borderRadius: 8, padding: "7px 9px", fontSize: 13, color: T.ink };

// A file behind the login: fetched with the token, handed to the browser as a
// blob, because a plain link cannot carry the Authorization header. (The same
// shape Memberships.jsx uses for the member card.)
async function openAuthed(path, filename, { download = false } = {}) {
  const r = await fetch(API + path, { headers: { Authorization: "Bearer " + getToken() } });
  if (!r.ok) throw new Error("That file could not be made.");
  const url = URL.createObjectURL(await r.blob());
  if (download) { const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); }
  else window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const money = cents => {
  const n = Math.round(Number(cents) || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

// FIX-7 Part 3.3 — "$950 of $500" reads as a mistake the first time and as
// arithmetic the second. Past the goal, the sentence says so in the one action
// colour; short of it, the fraction is the honest shape.
function goalLine(raisedCents, goalCents) {
  if (!goalCents) return <span>{money(raisedCents)}</span>;
  if (raisedCents > goalCents) return (
    <span style={{ color: T.greenDk, fontWeight: 700 }}>{money(raisedCents)}, goal {money(goalCents)} passed</span>);
  return <span>{money(raisedCents)} of {money(goalCents)}</span>;
}

// FIX-7 Part 3.2 — taking somebody's page down is not a button you can brush
// past on the way to somewhere else. It lives behind More, it says what will
// happen in the words it will happen in, and it can be undone.
function RowMenu({ label, confirmText, onConfirm }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  if (asking) return (
    <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 6, maxWidth: 340 }}>
      <div style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}>{confirmText}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={btn(true)} data-testid="p2p-row-confirm"
          onClick={() => { setAsking(false); setOpen(false); onConfirm(); }}>{label}</button>
        <button style={btn(false)} onClick={() => { setAsking(false); setOpen(false); }}>Cancel</button>
      </div>
    </div>);
  return (
    <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
      {open && <button style={btn(false)} data-testid="p2p-row-action" onClick={() => setAsking(true)}>{label}</button>}
      <button style={{ ...btn(false), padding: "6px 10px" }} data-testid="p2p-row-more"
        aria-expanded={open} aria-label={open ? "Fewer options" : "More options"}
        onClick={() => setOpen(x => !x)}>{open ? "Close" : "More"}</button>
    </div>);
}

export function PeerToPeerView({ isReadOnly, isAdmin = true, orgSlug = "", onNavigate, openPageId = "" }) {
  const [pages, setPages] = useState(null);
  const [pageId, setPageId] = useState("");
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState("");
  const [undo, setUndo] = useState(null);
  const [openRaised, setOpenRaised] = useState(false);
  const [newTeam, setNewTeam] = useState(null);

  useEffect(() => {
    apiFetch("/giving-pages")
      .then(r => {
        const list = (Array.isArray(r) ? r : r.pages || []).filter(p => p.status !== "archived");
        setPages(list);
        // FIX-7 Part 4 — a page the caller asked for wins, so a campaign just
        // created with peer-to-peer on opens on its OWN page, not on whichever
        // one happens to be first.
        setPageId(x => (openPageId && list.some(p => p.id === openPageId) ? openPageId : x)
          || list.find(p => p.p2p_enabled)?.id || list[0]?.id || "");
      })
      .catch(() => setPages([]));
  }, [openPageId]);

  const load = () => {
    if (!pageId) return;
    apiFetch(`/giving-pages/${pageId}/p2p`).then(setD).catch(e => { setD(null); setMsg(errorMessage(e, "That campaign did not load.")); });
  };
  useEffect(() => { load(); }, [pageId]);

  const takedown = async (kind, id, status, name) => {
    setMsg(""); setUndo(null);
    try {
      const r = kind === "team"
        ? await apiFetch(`/p2p-teams/${id}`, { method: "PUT", body: JSON.stringify({ status }) })
        : await apiFetch(`/peer-fundraisers/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
      setMsg(r.sentence || (status === "archived"
        ? `${name} is off the public site. Past gifts still count.`
        : `${name} is back up.`));
      setUndo({ kind, id, name, status: status === "archived" ? "active" : "archived" });
      load();
    } catch (e) { setMsg(errorMessage(e, "That did not go through.")); }
  };
  const addTeam = async () => {
    setMsg("");
    try {
      await apiFetch(`/giving-pages/${pageId}/teams`, { method: "POST", body: JSON.stringify(newTeam) });
      setNewTeam(null); load();
    } catch (e) { setMsg(errorMessage(e, "That team did not save.")); }
  };
  const turnOn = async () => {
    setMsg("");
    try { await apiFetch(`/giving-pages/${pageId}`, { method: "PUT", body: JSON.stringify({ p2pEnabled: true }) }); load(); }
    catch (e) { setMsg(errorMessage(e, "That did not save.")); }
  };

  if (!pages) return <div style={{ padding: 48, textAlign: "center", color: T.ink3, fontSize: 13 }}>Loading…</div>;
  if (!pages.length) return (
    <div style={{ fontSize: 13, color: T.ink3, maxWidth: 520 }}>
      Peer-to-peer runs on a giving page. Make one first, then turn it on here and supporters can start their own
      fundraisers under it.
    </div>);

  const t = d?.totals;
  return (
    <div data-testid="p2p-view" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select value={pageId} onChange={e => setPageId(e.target.value)} style={inp} aria-label="Campaign" data-testid="p2p-campaign">
          {pages.map(p => <option key={p.id} value={p.id}>{p.title}{p.p2p_enabled ? "" : " (not peer-to-peer yet)"}</option>)}
        </select>
        <button style={{ ...btn(false), marginLeft: "auto" }} data-testid="p2p-csv"
          onClick={() => openAuthed("/reports/p2p-fundraisers?format=csv", "fundraisers-by-campaign.csv", { download: true })
            .catch(e => setMsg(errorMessage(e, "The file could not be made.")))}>Fundraisers CSV</button>
      </div>
      {msg && <div role="status" style={{ fontSize: 12.5, color: T.ink, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span>{msg}</span>
        {undo && <button style={{ ...btn(false), padding: "4px 10px", fontSize: 12 }} data-testid="p2p-undo"
          onClick={() => takedown(undo.kind, undo.id, undo.status, undo.name)}>Undo</button>}
      </div>}

      {d && !d.page.p2pEnabled && (
        <Card style={{ padding: "16px 18px" }}>
          <div style={h}>Not peer-to-peer yet</div>
          <div style={{ fontSize: 13, color: T.ink2, maxWidth: 560, marginBottom: 10 }}>
            Turning this on puts a "start your own fundraiser" button on the public page. Supporters get their own page
            under this campaign, and every gift through one counts on this campaign as well as on theirs.
          </div>
          {!isReadOnly && isAdmin && <button style={btn(true)} onClick={turnOn} data-testid="p2p-enable">Turn it on</button>}
        </Card>)}

      {d && d.page.p2pEnabled && <>
        {/* THE TOTALS, AND THE IDENTITY THEY FOOT TO. Printed, not assumed. */}
        <Card style={{ padding: "16px 18px" }}>
          <div style={h}>{d.page.title}</div>
          {/* FIX-7 Part 3.1 — the identity lives BEHIND the total, where a
              figure's rows live everywhere else in this app. Somebody who
              wants to check the number opens it; everybody else reads four
              numbers and gets on with the walk. */}
          <div style={{ display: "flex", gap: 26, flexWrap: "wrap", marginBottom: 8 }}>
            {[["Raised", money(t.pageCents)], ["Through people", money(t.throughPeopleCents)],
              ["Given directly", money(t.directCents)],
              ["Goal", d.page.goalCents ? money(d.page.goalCents) : "None set"]].map(([label, value]) => (
              <div key={label}>
                {label === "Raised"
                  ? <button data-testid="p2p-raised" aria-expanded={openRaised} onClick={() => setOpenRaised(x => !x)}
                      title="What this is made of" style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                        fontSize: 22, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif",
                        borderBottom: "1px dashed " + T.bg3 }}>{value}</button>
                  : <div style={{ fontSize: 22, fontWeight: 800, color: T.ink, fontFamily: "'DM Serif Display',serif" }}>{value}</div>}
                <div style={{ fontSize: 11.5, color: T.ink3 }}>{label}</div>
              </div>))}
          </div>
          {openRaised && (
            <div data-testid="p2p-foots" style={{ fontSize: 12, color: T.ink3, lineHeight: 1.5,
              background: T.bg2, border: "1px solid " + T.bg3, borderRadius: 9, padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6 }}>
                {[["Through teams", t.teamCents], ["Through fundraisers with no team", t.soloCents],
                  ["Given to the page directly", t.directCents]].map(([l, v]) => (
                  <div key={l} style={{ display: "flex", gap: 10 }}>
                    <span>{l}</span><span style={{ marginLeft: "auto", color: T.ink, fontWeight: 700 }}>{money(v)}</span>
                  </div>))}
                <div style={{ display: "flex", gap: 10, borderTop: "1px solid " + T.bg3, paddingTop: 3 }}>
                  <span>Raised</span><span style={{ marginLeft: "auto", color: T.ink, fontWeight: 800 }}>{money(t.pageCents)}</span>
                </div>
              </div>
              {t.footsSentence} {d.sentence}
            </div>)}
          {orgSlug && <div style={{ fontSize: 12, color: T.ink3, marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>The public page:</span>
            <span style={{ color: T.ink, wordBreak: "break-all" }} data-testid="p2p-public-url">/give/{orgSlug}/{d.page.slug}</span>
            <button style={{ ...btn(false), padding: "4px 10px", fontSize: 12 }} data-testid="p2p-copy-link"
              onClick={() => {
                const url = `${window.location.origin}/give/${orgSlug}/${d.page.slug}`;
                if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => setMsg("Link copied.")).catch(() => setMsg(url));
                else setMsg(url);
              }}>Copy link</button>
          </div>}
        </Card>

        {/* WHO HAS NOT RAISED ANYTHING YET. First, because it is the list
            somebody actually does something about. */}
        {d.notYet.length > 0 && (
          <Card style={{ padding: "16px 18px" }} data-testid="p2p-not-yet">
            <div style={h}>{d.notYet.length} {d.notYet.length === 1 ? "fundraiser has" : "fundraisers have"} not raised anything yet</div>
            <div style={{ fontSize: 12, color: T.ink3, marginBottom: 10, lineHeight: 1.5 }}>{d.notYetSentence}</div>
            <div style={{ fontSize: 13.5, color: T.ink }}>
              {d.notYet.map(f => f.name).join(" · ")}
            </div>
          </Card>)}

        {/* TEAMS */}
        <Card style={{ padding: "16px 18px" }} data-testid="p2p-teams">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ ...h, marginBottom: 0 }}>Teams</div>
            {!isReadOnly && !newTeam && <button style={btn(false)} data-testid="p2p-team-add"
              onClick={() => setNewTeam({ name: "", goalAmount: "" })}>Add a team</button>}
          </div>
          {!d.teams.length && !newTeam && <div style={{ fontSize: 13, color: T.ink3 }}>
            No teams yet. Supporters can start one when they sign up, or add one here.
          </div>}
          {d.teams.map(tm => (
            <div key={tm.id} data-testid="p2p-team-row" style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 13,
              color: T.ink, padding: "8px 0", borderTop: "1px solid " + T.bg3, flexWrap: "wrap", opacity: tm.status === "active" ? 1 : 0.55 }}>
              <strong style={{ minWidth: 170 }}>{tm.name}{tm.status === "archived" ? " (taken down)" : ""}</strong>
              {goalLine(tm.raisedCents, tm.goalCents)}
              <span style={{ color: T.ink3 }}>{tm.members} {tm.members === 1 ? "fundraiser" : "fundraisers"}</span>
              {!isReadOnly && isAdmin && <RowMenu
                label={tm.status === "active" ? "Take it down" : "Put it back"}
                confirmText={tm.status === "active"
                  ? `${tm.name} comes off the public site and stops taking gifts. Its past gifts still count. You can put it back.`
                  : `${tm.name} goes back on the public site and can take gifts again.`}
                onConfirm={() => takedown("team", tm.id, tm.status === "active" ? "archived" : "active", tm.name)} />}
            </div>))}
          {newTeam && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <input placeholder="Team name" value={newTeam.name} onChange={e => setNewTeam(x => ({ ...x, name: e.target.value }))} style={{ ...inp, width: 190 }} />
            <input placeholder="Goal ($)" type="number" value={newTeam.goalAmount} onChange={e => setNewTeam(x => ({ ...x, goalAmount: e.target.value }))} style={{ ...inp, width: 110 }} />
            <button style={btn(true)} onClick={addTeam} data-testid="p2p-team-save">Save</button>
            <button style={btn(false)} onClick={() => setNewTeam(null)}>Cancel</button>
          </div>}
        </Card>

        {/* EVERY FUNDRAISER — the leaderboard the public sees, plus takedown */}
        <Card style={{ padding: "16px 18px" }} data-testid="p2p-fundraisers">
          <div style={h}>Fundraisers</div>
          <div style={{ fontSize: 12, color: T.ink3, marginBottom: 10, lineHeight: 1.5 }}>
            In the order the public leaderboard shows them. Raised is a live sum over the gifts each one brought in, in cents.
          </div>
          {!d.fundraisers.length && <div style={{ fontSize: 13, color: T.ink3 }}>
            Nobody has signed up yet. The button is on the public page.
          </div>}
          {d.fundraisers.map((f, i) => (
            <div key={f.id} data-testid="p2p-fundraiser-row" style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 13,
              color: T.ink, padding: "8px 0", borderTop: "1px solid " + T.bg3, flexWrap: "wrap", opacity: f.status === "active" ? 1 : 0.55 }}>
              <span style={{ color: T.ink3, width: 22 }}>{i + 1}</span>
              <strong style={{ minWidth: 160 }}>{f.name}{f.status === "archived" ? " (taken down)" : ""}</strong>
              {goalLine(f.raisedCents, f.goalCents)}
              {f.teamName && <span style={{ color: T.ink3 }}>{f.teamName}</span>}
              <span style={{ color: T.ink3 }}>{f.giftCount} {f.giftCount === 1 ? "gift" : "gifts"}</span>
              {!f.isPerson && <span style={{ color: T.ink3 }} title="This fundraiser is not matched to a person in the CRM, so no soft credit is being recorded for them. Matching is by exact email only.">no record matched</span>}
              {!isReadOnly && isAdmin && <RowMenu
                label={f.status === "active" ? "Take it down" : "Put it back"}
                confirmText={f.status === "active"
                  ? `${f.name}'s page comes off the public site and stops taking gifts. Their past gifts still count. You can put it back.`
                  : `${f.name}'s page goes back on the public site and can take gifts again.`}
                onConfirm={() => takedown("fundraiser", f.id, f.status === "active" ? "archived" : "active", f.name)} />}
            </div>))}
        </Card>
      </>}
    </div>
  );
}

export default PeerToPeerView;
