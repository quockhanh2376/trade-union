import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    target: ["es2021", "chrome105", "safari13"]
  }
});

