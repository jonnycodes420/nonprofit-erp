// PARITY-1 Part D · GROUPS. Saved lists of people, kept by hand or by a rule.
//
// GroupsPage     the Groups screen (Relationships, Groups): every group, a way
//                to make one, and each group's own page.
// GroupPage      one group: people, average gift, this fiscal year, lifetime,
//                number of gifts, the last twelve months, and the people with
//                Mid and Major filters. Every number is a <Figure> with its source.
// LightningMark  the mark a group by rule carries, wherever groups are listed.
// ProfileGroups  the small Groups control on a donor's profile.
// AddToGroup     the Donors directory's bulk action.
//
// Everything reads routes/groups.js. A group by rule is the donor list's own
// filter, worked out fresh every time, so nothing here stores who is in one.
import { useCallback, useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { apiFetch } from "../api";
import { T, Spin } from "./shared";
import { Figure, FigureContext } from "./Figure";
import { errorMessage } from "../lib/domainError";

const ACTION = T.greenDk;
const card = { background: T.bgCard, border: "1px solid " + T.bg2, borderRadius: 12, padding: "16px 18px" };
const field = { border: "1px solid " + T.bg2, borderRadius: 8, padding: "7px 10px", fontSize: 13, background: T.bgCard, color: T.ink, fontFamily: "inherit" };
const primary = { background: ACTION, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const quiet = { background: "transparent", color: T.ink, border: "1px solid " + T.bg2, borderRadius: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" };

// The rule a group can be built on: the donor list's own filters.
const RULE_FIELDS = [
  { key: "role", label: "Role", options: [["", "Anyone"], ["donor", "Donors"], ["volunteer", "Volunteers"], ["staff_board", "Staff and board"]] },
  { key: "level", label: "Giving level", options: [["", "Any level"], ["general", "General"], ["mid", "Mid"], ["major", "Major"]] },
  { key: "lifecycle", label: "Lifecycle", options: [["", "Any"], ["new", "New"], ["current", "Current"], ["recaptured", "Recaptured"], ["lapsed", "Lapsed"]] },
  { key: "closeness", label: "Closeness", options: [["", "Any"], ["close", "Close"], ["warm", "Warm"], ["cooling", "Cooling"], ["new", "New"]] },
  { key: "given", label: "Has given", options: [["", "Either"], ["ever", "Has given"], ["never", "Has never given"]] },
  { key: "stage", label: "Stage", options: [["", "Any stage"], ["prospect", "Prospect"], ["qualify", "Qualify"], ["cultivate", "Cultivate"], ["solicit", "Solicit"], ["steward", "Steward"], ["lapsed", "Lapsed"]] },
];

export function LightningMark({ size = 14 }) {
  return (
    <span title="A group by rule: its people are worked out fresh every time" aria-label="Group by rule" data-testid="group-dynamic"
      style={{ display: "inline-flex", verticalAlign: "-2px", marginLeft: 6 }}>
      <Zap size={size} color={T.gold} aria-hidden="true" />
    </span>
  );
}

function NewGroup({ onMade, onCancel }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("static");
  const [rules, setRules] = useState({});
  const [retained, setRetained] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = () => {
    setBusy(true); setErr("");
    const r = { ...rules };
    if (retained) r.retained = "1";
    apiFetch("/groups", { method: "POST", body: JSON.stringify({ name, description, kind, rules: kind === "dynamic" ? r : undefined }) })
      .then(g => { setBusy(false); onMade(g); })
      .catch(e => { setBusy(false); setErr(e?.body?.error || errorMessage(e, "That group did not save.")); });
  };
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }} data-testid="group-new">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input aria-label="Group name" placeholder="Name, like Gala table hosts" value={name} onChange={e => setName(e.target.value)} style={{ ...field, flex: "1 1 220px" }} />
        <input aria-label="Description" placeholder="What it is for (optional)" value={description} onChange={e => setDescription(e.target.value)} style={{ ...field, flex: "2 1 260px" }} />
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: T.ink2 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" name="group-kind" checked={kind === "static"} onChange={() => setKind("static")} /> Kept by hand
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" name="group-kind" checked={kind === "dynamic"} onChange={() => setKind("dynamic")} /> By a rule <LightningMark size={13} />
        </label>
      </div>
      {kind === "dynamic" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {RULE_FIELDS.map(f => (
            <select key={f.key} aria-label={f.label} value={rules[f.key] || ""} onChange={e => setRules({ ...rules, [f.key]: e.target.value })} style={field}>
              {f.options.map(([v, l]) => <option key={v} value={v}>{v ? l : `${f.label}: ${l}`}</option>)}
            </select>
          ))}
          <label style={{ fontSize: 13, color: T.ink2, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={retained} onChange={e => setRetained(e.target.checked)} /> Retained only
          </label>
        </div>
      )}
      <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>
        {kind === "dynamic"
          ? "Every rule you set must hold. Who is in it is worked out fresh each time, so a gift that moves somebody across a rule moves them in or out on its own."
          : "Add people from the Donors list (tick them, then Add to a group) or from a person's profile."}
      </div>
      {err && <div role="alert" style={{ fontSize: 13, color: T.ink }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={primary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Make the group"}</button>
        <button type="button" style={quiet} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function GroupPage({ groupId, onBack, onOpenPerson, isReadOnly }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [level, setLevel] = useState("all");
  const load = useCallback(() => {
    apiFetch(`/groups/${groupId}`).then(d => { setData(d); setErr(""); }).catch(e => setErr(errorMessage(e, "This group did not load.")));
  }, [groupId]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div role="alert" style={{ ...card, color: T.ink }}>{err}</div>;
  if (!data) return <div style={{ padding: 24 }}><Spin /></div>;
  const g = data.group;
  const members = (data.members || []).filter(m => level === "all" || m.level === level);
  const max = Math.max(1, ...data.months.map(m => Math.abs(Number(m.value) || 0)));
  const remove = id => apiFetch(`/groups/${g.id}/members/remove`, { method: "POST", body: JSON.stringify({ donorIds: [id] }) }).then(load).catch(() => {});
  return (
    <FigureContext.Provider value={{ openPerson: onOpenPerson || null }}>
      <div data-testid="group-page">
        <button type="button" style={{ ...quiet, marginBottom: 12 }} onClick={onBack}>All groups</button>
        <h2 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontWeight: 400, fontSize: 26, margin: "0 0 4px", color: T.ink }}>
          {g.name}{g.kind === "dynamic" && <LightningMark size={16} />}
        </h2>
        {g.description && <p style={{ fontSize: 14, color: T.ink2, margin: "0 0 4px" }}>{g.description}</p>}
        <p style={{ fontSize: 13, color: T.ink3, margin: "0 0 16px", lineHeight: 1.55 }}>{g.sentence}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
          {data.figures.map(f => (
            <Figure key={f.label} label={f.label} value={f.value} kind={f.kind} definition={f.sentence} source={f.source} figureKey={`group-${f.label}`} />
          ))}
        </div>
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.07em", textTransform: "uppercase", color: T.ink3, fontWeight: 700, marginBottom: 4 }}>Month by month</div>
          <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 10 }}>{data.monthsSentence}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 6, alignItems: "end", minHeight: 120 }}>
            {data.months.map(m => (
              <div key={m.month} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
                <div aria-hidden="true" style={{ width: "100%", maxWidth: 28, height: Math.max(2, Math.round((Math.abs(Number(m.value) || 0) / max) * 90)), background: ACTION, borderRadius: 3 }} />
                <span style={{ fontSize: 10.5, color: T.ink2, overflow: "hidden", maxWidth: "100%" }}>
                  <Figure variant="inline" kind="money" label={`Gifts in ${m.label}`} value={m.value} definition={data.monthsSentence} source={m.source} />
                </span>
                <span style={{ fontSize: 10.5, color: T.ink3 }}>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={card}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.ink, marginRight: "auto" }}>The people</div>
            {[["all", "Everyone"], ["mid", "Mid"], ["major", "Major"]].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={level === k} data-testid={`group-filter-${k}`} onClick={() => setLevel(k)}
                style={{ ...quiet, padding: "5px 10px", background: level === k ? T.bg : "transparent", fontWeight: level === k ? 700 : 400 }}>{l}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: T.ink3, marginBottom: 8 }}>{data.levelSentence}</div>
          {!members.length && <div style={{ fontSize: 13, color: T.ink3, padding: "8px 0" }}>
            {data.members.length ? "Nobody in this group is at that level." : g.kind === "static" ? "Nobody yet. Add people from the Donors list or from a profile." : "Nobody matches this rule today."}
          </div>}
          {members.map(m => (
            <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid " + T.bg2, flexWrap: "wrap" }}>
              <button type="button" onClick={() => onOpenPerson && onOpenPerson(m.id)}
                style={{ background: "none", border: "none", padding: 0, font: "inherit", color: T.ink, fontWeight: 600, cursor: "pointer", textAlign: "left", flex: "1 1 180px", minWidth: 0 }}>{m.name}</button>
              <span style={{ fontSize: 12, color: T.ink3, width: 64 }}>{m.level ? m.level.charAt(0).toUpperCase() + m.level.slice(1) : "Not given"}</span>
              <span style={{ fontSize: 12.5, color: T.ink2, width: 110, textAlign: "right" }}>
                ${Math.round(m.last12).toLocaleString("en-US")} <span style={{ color: T.ink3 }}>this 12 mo.</span>
              </span>
              {g.kind === "static" && !isReadOnly && (
                <button type="button" style={{ ...quiet, padding: "4px 9px", fontSize: 12 }} onClick={() => remove(m.id)} aria-label={`Take ${m.name} out of ${g.name}`}>Take out</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </FigureContext.Provider>
  );
}

export default function GroupsPage({ isReadOnly, onNavigate, initialGroupId }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [making, setMaking] = useState(false);
  const [open, setOpen] = useState(initialGroupId || null);
  const load = useCallback(() => {
    apiFetch("/groups").then(r => { setList(r); setErr(""); }).catch(e => setErr(errorMessage(e, "Groups did not load.")));
  }, []);
  useEffect(() => { load(); }, [load]);
  const openPerson = id => onNavigate && onNavigate("donors", { selectDonorId: id });
  if (open) return <GroupPage groupId={open} isReadOnly={isReadOnly} onBack={() => { setOpen(null); load(); }} onOpenPerson={openPerson} />;
  return (
    <FigureContext.Provider value={{ openPerson }}>
      <div data-testid="groups-page">
        <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontWeight: 400, fontSize: 32, margin: "0 0 6px", color: T.ink }}>Groups</h1>
        <p style={{ fontSize: 14, color: T.ink3, lineHeight: 1.6, margin: "0 0 16px", maxWidth: 680 }}>
          Lists of people with a name. Keep one by hand, or let a rule keep it for you. A group works wherever a list does:
          campaigns, your email tool's tags, journeys, surveys and the board pack.
        </p>
        {!isReadOnly && !making && <button type="button" style={{ ...primary, marginBottom: 16 }} onClick={() => setMaking(true)}>New group</button>}
        {making && <NewGroup onCancel={() => setMaking(false)} onMade={g => { setMaking(false); load(); if (g && g.id) setOpen(g.id); }} />}
        {err && <div role="alert" style={{ ...card, color: T.ink }}>{err}</div>}
        {!list && !err && <Spin />}
        {list && !list.groups.length && (
          <div style={{ ...card, color: T.ink3, fontSize: 14 }}>No groups yet. Make one for the people you think of together: table hosts, board prospects, or warm volunteers who have never given.</div>
        )}
        {list && list.groups.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {list.groups.map(g => (
              <div key={g.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }} data-testid="group-card">
                <button type="button" onClick={() => setOpen(g.id)}
                  style={{ background: "none", border: "none", padding: 0, font: "inherit", textAlign: "left", cursor: "pointer", color: T.ink, fontSize: 16, fontWeight: 600 }}>
                  {g.name}{g.kind === "dynamic" && <LightningMark />}
                </button>
                <div style={{ fontSize: 12.5, color: T.ink3, lineHeight: 1.5 }}>{g.description || g.sentence}</div>
                <div style={{ fontSize: 13, color: T.ink2 }}>
                  <Figure variant="inline" kind="count" label={`People in ${g.name}`} value={g.count} definition={list.countSentence} source={g.countSource} /> {g.count === 1 ? "person" : "people"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </FigureContext.Provider>
  );
}

// The profile's small control: the groups this person is in, and a way to
// add them to one kept by hand.
export function ProfileGroups({ donorId, isReadOnly }) {
  const [d, setD] = useState(null);
  const [pick, setPick] = useState("");
  const load = useCallback(() => {
    if (!donorId) return;
    apiFetch(`/donors/${donorId}/groups`).then(setD).catch(() => setD(null));
  }, [donorId]);
  useEffect(() => { load(); }, [load]);
  if (!d || (!d.groups.length && !d.canJoin.length)) return null;
  const add = () => {
    if (!pick) return;
    apiFetch(`/groups/${pick}/members`, { method: "POST", body: JSON.stringify({ donorIds: [donorId] }) }).then(() => { setPick(""); load(); }).catch(() => {});
  };
  const out = gid => apiFetch(`/groups/${gid}/members/remove`, { method: "POST", body: JSON.stringify({ donorIds: [donorId] }) }).then(load).catch(() => {});
  return (
    <div data-testid="profile-groups" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, color: T.ink2, marginTop: 6 }}>
      <span style={{ color: T.ink3 }}>Groups:</span>
      {d.groups.map(g => (
        <span key={g.id} style={{ border: "1px solid " + T.bg2, borderRadius: 999, padding: "2px 9px", background: T.bgCard, display: "inline-flex", alignItems: "center", gap: 4 }}>
          {g.name}{g.kind === "dynamic" ? <LightningMark size={12} /> : (!isReadOnly && (
            <button type="button" aria-label={`Take out of ${g.name}`} onClick={() => out(g.id)}
              style={{ background: "none", border: "none", padding: "0 0 0 2px", cursor: "pointer", color: T.ink3, font: "inherit" }}>×</button>
          ))}
        </span>
      ))}
      {!d.groups.length && <span style={{ color: T.ink3 }}>none</span>}
      {!isReadOnly && d.canJoin.length > 0 && (
        <span style={{ display: "inline-flex", gap: 4 }}>
          <select aria-label="Add to a group" value={pick} onChange={e => setPick(e.target.value)} style={{ ...field, padding: "3px 6px", fontSize: 12 }}>
            <option value="">Add to a group</option>
            {d.canJoin.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {pick && <button type="button" style={{ ...quiet, padding: "3px 9px", fontSize: 12 }} onClick={add}>Add</button>}
        </span>
      )}
    </div>
  );
}

// The Donors directory's bulk action: put the ticked people in a group kept
// by hand.
export function AddToGroup({ donorIds, onDone }) {
  const [groups, setGroups] = useState(null);
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { apiFetch("/groups").then(r => setGroups(((r && r.groups) || []).filter(g => g.kind === "static"))).catch(() => setGroups([])); }, []);
  if (!groups || !groups.length) return null;
  const add = () => {
    if (!pick || !donorIds.length) return;
    apiFetch(`/groups/${pick}/members`, { method: "POST", body: JSON.stringify({ donorIds }) })
      .then(r => { setMsg(r.sentence || ""); setPick(""); onDone && onDone(); })
      .catch(e => setMsg(errorMessage(e, "They were not added.")));
  };
  return (
    <span data-testid="bulk-add-to-group" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <select aria-label="Add to a group" value={pick} onChange={e => setPick(e.target.value)} style={{ ...field, padding: "5px 8px" }}>
        <option value="">Add to a group</option>
        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      {pick && <button type="button" style={{ ...quiet, padding: "5px 10px" }} onClick={add}>Add {donorIds.length}</button>}
      {msg && <span style={{ fontSize: 12, color: T.ink3 }}>{msg}</span>}
    </span>
  );
}
