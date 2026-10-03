// CONTENT-1 · the Node build of the marketing site, for the prerender only.
// `npm run build` runs the normal browser build, then this, then
// scripts/prerender.mjs. Nothing here ships to the browser.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const MAIN = fileURLToPath(new URL("./src/main.jsx", import.meta.url));
const STUB = fileURLToPath(new URL("./src/marketing/prerender-auth-stub.js", import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    {
      // main.jsx mounts the app on import; a marketing page only wants useAuth.
      name: "prerender-no-app-mount",
      enforce: "pre",
      async resolveId(source, importer, opts) {
        const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
        return r && r.id === MAIN ? STUB : null;
      },
    },
  ],
  build: {
    ssr: "src/marketing/prerender.jsx",
    outDir: "dist-prerender",
    emptyOutDir: true,
    copyPublicDir: false,
    rollupOptions: { output: { format: "esm", entryFileNames: "prerender.mjs" } },
  },
});
