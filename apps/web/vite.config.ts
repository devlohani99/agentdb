import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/events": { target: "http://localhost:3000", changeOrigin: true },
      "/tickets": { target: "http://localhost:3000", changeOrigin: true },
      "/tenants": { target: "http://localhost:3000", changeOrigin: true },
      "/runs": { target: "http://localhost:3000", changeOrigin: true },
      "/metrics": { target: "http://localhost:3000", changeOrigin: true },
      "/health": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
