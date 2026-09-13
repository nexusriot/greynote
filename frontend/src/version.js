// __APP_VERSION__ is stamped in at build time (see vite.config.js). Under the
// test runner there is no define step, so fall back rather than throw.
export const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/**
 * The About line. The server version is fetched, so it has to read sensibly
 * before the answer arrives and when it never does.
 */
export function versionLine(app, server) {
    return `Web ${app || "dev"} · server ${server || "unreachable"}`;
}
