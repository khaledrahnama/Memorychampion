import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs separately (backend: npm run dev); proxy /api to it
// so the browser talks to a single origin, exactly like on Vercel.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": process.env.API_PROXY_TARGET ?? "http://localhost:4000" }
  }
});
