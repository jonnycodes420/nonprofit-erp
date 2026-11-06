// lib/briefStream.js · ATLAS-3. BRIEF ME'S FIRST WORDS COME AT ONCE.
// POST /donors/:id/brief?stream=1 answers in lines: {type:"start", opening}
// within a second (from the record, in code), then {type:"brief"} once the
// model's brief is written and checked, or {type:"error"}. A kept brief
// comes back as the second line straight away.
import { API, getToken } from "../api";

export async function streamBrief(donorId, { fresh = false, onStart } = {}) {
  const r = await fetch(`${API}/donors/${encodeURIComponent(donorId)}/brief?stream=1${fresh ? "&fresh=1" : ""}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` }, body: "{}" });
  if (!r.ok || !/ndjson/.test(r.headers.get("content-type") || "")) {
    const b = await r.json().catch(() => ({}));
    const e = new Error(b.message || b.error || "The brief could not be written just now."); e.data = b; e.status = r.status; throw e;
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", brief = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      const x = JSON.parse(line);
      if (x.type === "start" && onStart) onStart(x);
      else if (x.type === "brief") brief = x.brief;
      else if (x.type === "error") { const e = new Error(x.error || "The brief could not be written just now."); e.data = x; throw e; }
    }
    if (done) break;
  }
  if (!brief) throw new Error("The brief could not be written just now.");
  return brief;
}
