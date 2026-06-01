import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
//dfh
export default defineConfig(({ mode }) => ({
  base: "/animate/", // <-- ADD THIS LINE (Make sure to include both slashes)
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));