import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" : le build peut être servi depuis n'importe quel chemin.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: [".."] }, // autorise l'import du dossier ../shared
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
