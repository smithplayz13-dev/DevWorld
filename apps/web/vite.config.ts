import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api/v1": {
        target: loadEnv(mode, ".", "DEVWORLD_").DEVWORLD_API_ORIGIN ?? "http://127.0.0.1:8000",
        changeOrigin: false,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
}));
