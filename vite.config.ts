import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => ({
  base: "/animate/",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  // ─── ADD THIS WORKER CONFIGURATION ───
  worker: {
    format: "es",
    plugins: () => [react()],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));