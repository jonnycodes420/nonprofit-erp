// Lean static guard — the point is to FAIL THE BUILD on an undefined/misnamed
// reference before it ever reaches a user's browser. Two runtime ReferenceError
// crashes shipped from one build (BUILD-21's `fundBalances`, then the donor
// profile's `fmt`) because nothing statically catches undefined refs — Vite/
// esbuild don't. `no-undef` closes that class. Kept deliberately minimal so it
// stays fast and doesn't drown real errors in style noise on an unlinted repo.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

// FIX-2 E — JSX USE COUNTS AS USE. `no-unused-vars` cannot see a name used
// only as a JSX tag (<Modal/>, <Foo.Bar/>), so every such import read as
// "never used": hundreds of false warnings, and one file (VolunteersHub.jsx)
// that turned the rule off altogether. This is eslint-plugin-react's
// jsx-uses-vars, in the six lines it takes, rather than a new dependency.
const jsxUses = { rules: { "jsx-uses-vars": {
  meta: { type: "problem", schema: [] },
  create: context => ({ JSXOpeningElement(node) {
    let n = node.name;
    while (n.type === "JSXMemberExpression") n = n.object;
    if (n.type === "JSXIdentifier") context.sourceCode.markVariableAsUsed(n.name, node);
  } }),
} } };

export default [
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { "react-hooks": reactHooks, "jsx-uses": jsxUses },
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
      "jsx-uses/jsx-uses-vars": "error",
      // The SECOND crash class this gate now catches: a hook called
      // CONDITIONALLY (after an early return / inside an if / &&) throws
      // "Rendered more hooks than during the previous render" in production —
      // exactly the Pipeline crash a locked/loading early return + a DnD useMemo
      // caused. As an error it FAILS THE BUILD instead. Enforced, not just
      // registered-for-disable-directives.
      "react-hooks/rules-of-hooks": "error",
      // Noisy but real — surfaces stale-closure bugs. A warning (non-blocking)
      // so it informs without breaking the deploy; existing `// eslint-disable-
      // next-line react-hooks/exhaustive-deps` directives still resolve.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
