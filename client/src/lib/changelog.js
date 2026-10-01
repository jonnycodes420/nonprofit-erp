// TRUST-2 — the What's new entries, bundled from docs/changelog/ once, for the
// public page and the in-app panel alike.
import { entriesFrom } from "../../../shared/changelog.js";
export const CHANGELOG = entriesFrom(import.meta.glob("../../../docs/changelog/*.md", { query: "?raw", import: "default", eager: true }));
export const LAST_SEEN_KEY = "npe_whats_new_seen";
