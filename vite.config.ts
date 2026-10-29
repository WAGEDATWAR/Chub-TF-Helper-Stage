import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// The helper imports the parent game's `core/` + `data/` from the committed `vendor/`
// copy, so local dev and CI resolve the exact same core (one source of truth). The
// parent lives in a sibling folder while you co-develop; refresh the vendored copy
// with `npm run sync:vendor`.
const PARENT = resolve(__dirname, "vendor");

// Port 5173 is deliberate: Chub's stage renderer hardcodes the fallback
//   http://localhost:5173/index.html
// for a stage whose saved staging URL is empty, and its postMessage origin
// allowlist contains localhost:5173 (not 5175). Serving there means the fallback
// works even if the URL is not persisted. Plain http matches that fallback
// exactly (Chub does not upgrade it to https).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@core": resolve(PARENT, "core"),
      "@gamedata": resolve(PARENT, "data"),
    },
  },
  // host: true binds every interface, so a LAN URL also works.
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    fs: { allow: [resolve(__dirname), PARENT] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: { input: resolve(__dirname, "index.html"), external: [] },
  },
});
