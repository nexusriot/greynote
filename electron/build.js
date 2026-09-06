"use strict";

// One esbuild call turns the renderer's ES modules (plus marked, DOMPurify and
// the markdown/diff helpers shared with the web client) into a single script the
// sandboxed page can load.
const esbuild = require("esbuild");
const path = require("node:path");

const watch = process.argv.includes("--watch");

const options = {
    entryPoints: [path.join(__dirname, "renderer", "app.js")],
    outfile: path.join(__dirname, "renderer", "bundle.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome126"],
    sourcemap: true,
    logLevel: "info",
};

if (watch) {
    esbuild.context(options).then(ctx => ctx.watch());
} else {
    esbuild.build(options).catch(() => process.exit(1));
}
