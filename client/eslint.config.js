// Lean static guard — the point is to FAIL THE BUILD on an undefined/misnamed
// reference before it ever reaches a user's browser. Two runtime ReferenceError
// crashes shipped from one build (BUILD-21's `fundBalances`, then the donor
// profile's `fmt`) because nothing statically catches undefined refs — Vite/
// esbuild don't. `no-undef` closes that class. Kept deliberately minimal so it
// stays fast and doesn't drown real errors in style noise on an unlinted repo.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["src/**/*.{js,jsx}"],
    // Registered so the codebase's existing `// eslint-disable-next-line
    // react-hooks/exhaustive-deps` directives resolve to a real rule (an
    // unknown rule in a disable directive is itself an error). The hooks rules
    // are left at their defaults — this guard is about no-undef, not hooks.
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    rules: {
      // The guard. An undefined reference fails the build.
      "no-undef": "error",
      // Surfaces dead imports (like a stale `fmt` import) without blocking the
      // build — warnings don't change eslint's exit code.
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
    },
  },
];
