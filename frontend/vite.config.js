import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In Docker the backend is reachable as the compose service; VITE_API_TARGET
// lets a local dev server point somewhere else.
const apiTarget = process.env.VITE_API_TARGET || "http://backend:8080";

export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 5173,
        allowedHosts: true,
        proxy: {
            "/api": apiTarget,
            "/health": apiTarget,
        },
    },
});
