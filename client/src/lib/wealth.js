// lib/wealth.js · WEALTH-1. Is it already known this person may see Wealth Scores?
// Tiny on purpose: lib/profileReads.js is in Home's first download. The loader
// and the hook live with the component (components/WealthScore.jsx), which sets
// this once GET /me has answered. An admin always may (the server's rule too).
import { getToken } from "../api";
let knownFor = null;
export const noteWealthScores = (tok, yes) => { knownFor = yes ? tok : null; };
export const canWealthScoresNow = () => {
  const tok = getToken();
  if (!tok) return false;
  if (knownFor === tok) return true;
  try { return JSON.parse(localStorage.getItem("npe_user") || "null")?.role === "admin"; } catch { return false; }
};
