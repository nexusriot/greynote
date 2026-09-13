import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// package.json carries the release from the root VERSION file, so the bundle
// can report the version it was built from next to the server's own.
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));

// In Docker the backend is reachable as the compose service; VITE_API_TARGET
// lets a local dev server point somewhere else.
const apiTarget = process.env.VITE_API_TARGET || "http://backend:8080";

export default defineConfig({
    plugins: [react()],
    define: {
        __APP_VERSION__: JSON.stringify(version),
    },
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
