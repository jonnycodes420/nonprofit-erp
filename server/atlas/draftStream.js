// server/atlas/draftStream.js · SPEED-3. A DRAFT'S FIRST WORDS IN UNDER 3 SECONDS.
//
// Muse waited about 20 s for an Atlas draft with nothing on screen but a
// spinner. The draft is the slowest call Atlas makes, and its words were
// shown only once the whole email had come back. Now the same call (same
// model, prompt, tool and budget) is streamed: the tool's JSON arrives in
// pieces, and the email's body so far is handed to `onWords` as it grows, so
// the status line can show it. What Atlas keeps is the finished call's
// answer, exactly as before; the words on the way are only a preview.
"use strict";

// The body so far, out of a tool's partial JSON ("…\"body\":\"Dear Mar").
function partialField(json, field) {
  const m = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(json);
  if (!m) return "";
  const raw = m[1].replace(/\\u[0-9a-fA-F]{0,3}$|\\$/, "");   // a piece may end inside an escape
  try { return JSON.parse(`"${raw}"`); } catch { return ""; }
}

// One streamed call. `client` is aiClient's anthropicFor(orgId). Resolves to
// the final message (as messages.create would), rejects as it would.
async function streamTool(client, args, { timeout, onWords, field = "body" } = {}) {
  const ctl = new AbortController();
  const stop = setTimeout(() => ctl.abort(), timeout);
  try {
    const stream = await client.messages.stream(args, { signal: ctl.signal, maxRetries: 0 });
    let json = "", shown = "";
    stream.on("streamEvent", ev => {
      if (!onWords || !ev || ev.type !== "content_block_delta" || !ev.delta || ev.delta.type !== "input_json_delta") return;
      json += ev.delta.partial_json || "";
      const now = partialField(json, field);
      if (now && now !== shown) { shown = now; onWords(now); }
    });
    return await stream.finalMessage();
  } catch (e) {
    if (ctl.signal.aborted) { const t = new Error("Request timed out."); t.name = "APIConnectionTimeoutError"; throw t; }
    throw e;
  } finally { clearTimeout(stop); }
}

module.exports = { streamTool, partialField };
