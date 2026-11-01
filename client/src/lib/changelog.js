// TRUST-2 — the What's new entries, bundled from docs/changelog/ once, for the
// public page and the in-app panel alike.
import { entriesFrom } from "../../../shared/changelog.js";
export { PRODUCT_WORDS } from "../../../shared/changelog.js";   // PERF-2: the panel's words load with its entries
export const CHANGELOG = entriesFrom(import.meta.glob("../../../docs/changelog/*.md", { query: "?raw", import: "default", eager: true }));
