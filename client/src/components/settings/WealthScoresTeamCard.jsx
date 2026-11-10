// settings/WealthScoresTeamCard.jsx · WEALTH-1. "Everyone on the team can see
// Wealth Scores" (PUT /org/wealth-scores, admins only). Its own file so it rides
// in Settings' chunk.
import { useEffect, useState } from "react";
import { apiFetch } from "../../api";
import { errorMessage } from "../../lib/domainError";
import { T } from "../shared";

export function WealthScoresTeamSetting({ isAdmin }) {
  const [team, setTeam] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { apiFetch("/org/wealth-scores").then(r => setTeam(!!(r && r.team))).catch(() => setTeam(null)); }, []);
  if (!isAdmin || team === null) return null;
  const flip = async on => {
    setTeam(on); setMsg("");
    try { const r = await apiFetch("/org/wealth-scores", { method: "PUT", body: JSON.stringify({ team: on }) }); setTeam(!!r.team); setMsg(r.sentence || ""); window.__stewardWealthAsk = null; }
    catch (e) { setTeam(!on); setMsg(errorMessage(e, "That setting did not change.")); }
  };
  return (
    <label data-testid="settings-wealth-team" style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: T.ink, padding: "12px 0 4px", cursor: "pointer" }}>
      <input type="checkbox" checked={team} onChange={e => flip(e.target.checked)} style={{ accentColor: T.greenDk, marginTop: 2 }} />
      <span><b>Everyone on the team can see Wealth Scores</b>
        <span style={{ display: "block", fontSize: 11.5, color: T.ink3 }}>{msg || "Off: only admins and staff with the major gifts permission see them. Wealth Scores never appear on anything a donor sees."}</span></span>
    </label>
  );
}
