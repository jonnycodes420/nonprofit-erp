// PROSPECT-1 — who may see Room to give, screening results and prospect
// briefs: admins, and staff with the major gifts permission. The SERVER is the
// boundary (every route 403s without it); this only decides what to draw, so
// a person without the permission never sees an empty card or a refusal.
//
// One read of GET /me per page load, shared by every caller.
import { useEffect, useState } from "react";
import { API, apiFetch, getToken } from "../api";

// Keyed on the session token, so signing out and in as somebody else in the
// same tab never reuses the last person's answer.
let pending = null, pendingFor = null;
export function loadCanMajorGifts() {
  const tok = getToken();
  if (pendingFor !== tok) { pending = null; pendingFor = tok; }
  if (!tok) return Promise.resolve(false);
  if (!pending) pending = apiFetch("/me").then(r => !!(r && r.user && (r.user.canMajorGifts || r.user.role === "admin"))).catch(() => { pending = null; return false; });
  return pending;
}

export function useCanMajorGifts() {
  const [can, setCan] = useState(false);
  useEffect(() => { let live = true; loadCanMajorGifts().then(v => live && setCan(v)); return () => { live = false; }; }, []);
  return can;
}

// A POST that answers with a file (the screening file): fetched with the
// session and saved from the bytes.
export async function postDownload(path, body, fallbackName) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw Object.assign(new Error(e.message || e.error || "That file did not download."), { status: res.status, ...e });
  }
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename="?([^";]+)"?/i.exec(cd);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = (m && m[1]) || fallbackName || "file.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const ROOM_LABEL = { strong: "Strong", some: "Some", unknown: "Not yet known" };
export const ROOM_RANK = { strong: 2, some: 1, unknown: 0 };

// "$25,000" from cents, whole dollars when there are no cents.
export function dollarsOf(cents) {
  if (cents == null) return "";
  const c = Math.round(Number(cents) || 0);
  return "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
}
export function rangeOf(lo, hi) {
  if (lo == null && hi == null) return "";
  if (lo != null && hi != null && lo !== hi) return `${dollarsOf(lo)} to ${dollarsOf(hi)}`;
  return dollarsOf(lo != null ? lo : hi);
}
export function dateWords(d) {
  if (!d) return "";
  const s = String(d).slice(0, 10);
  const t = Date.parse(s + "T12:00:00Z");
  if (!Number.isFinite(t)) return s;
  return new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
