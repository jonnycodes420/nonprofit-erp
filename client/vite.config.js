import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { execSync } from "node:child_process";

// Deploy verification (deploy rewire, 2026-08-11): stamp the built page with
// the exact commit it was built from, so `curl | grep build-sha` against the
// live site proves which commit is deployed. Vercel git builds carry
// VERCEL_GIT_COMMIT_SHA, the Actions deploy job carries GITHUB_SHA, and a
// local build falls back to `git rev-parse` (or "unstamped").
const buildSha = (() => {
  const env = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.BUILD_SHA;
  if (env) return env;
  try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "unstamped"; }
})();

export default defineConfig({
  build: {
    // Gated on the same token that drives the Sentry plugin below, not just
    // "true" — if SENTRY_AUTH_TOKEN is unset (local dev, a PR preview build
    // missing the secret), no maps are generated at all, so there's never a
    // window where maps exist in dist but nothing uploads-then-strips them.
    // When the token IS set, maps are generated, uploaded to Sentry, then
    // deleted from dist (sourcemaps.filesToDeleteAfterUpload) — the bundle
    // Vercel actually serves never has raw source maps in either case.
    sourcemap: !!process.env.SENTRY_AUTH_TOKEN,
  },
  plugins: [
    react(),
    {
      name: "build-sha-meta",
      transformIndexHtml() {
        return [{ tag: "meta", attrs: { name: "build-sha", content: buildSha }, injectTo: "head" }];
      },
    },
    // Uploads source maps to Sentry at build time so production stack traces
    // resolve to real file/line instead of minified output. Requires
    // SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN (see CLAUDE.md env vars);
    // no-ops entirely when SENTRY_AUTH_TOKEN is absent, so local/preview
    // builds without the secret still succeed.
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        filesToDeleteAfterUpload: ["./dist/**/*.map"],
      },
    }),
  ],
});
