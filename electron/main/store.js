"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = {
    serverUrl: "http://localhost:38080",
    cookie: null,
    theme: "system",
    windowBounds: null,
    quickCaptureShortcut: "CommandOrControl+Shift+N",
    startMinimised: false,
};

/**
 * Settings and the offline note cache, both plain JSON files in the app's
 * userData directory. A notes client does not need a database on the desktop —
 * the server has one — but it does need to open instantly and show something
 * useful when the network is down.
 */
class Store {
    constructor(directory) {
        this.directory = directory;
        this.settingsPath = path.join(directory, "settings.json");
        this.cachePath = path.join(directory, "notes-cache.json");
        this.settings = { ...DEFAULTS, ...readJson(this.settingsPath, {}) };
    }

    get(key) {
        return this.settings[key];
    }

    set(key, value) {
        this.settings[key] = value;
        this.persistSettings();
    }

    update(values) {
        Object.assign(this.settings, values);
        this.persistSettings();
    }

    persistSettings() {
        writeJson(this.settingsPath, this.settings);
    }

    /** The last note list seen, shown while offline and on cold start. */
    readCache() {
        const cache = readJson(this.cachePath, null);
        if (!cache || !Array.isArray(cache.notes)) return null;
        return cache;
    }

    writeCache(notes) {
        writeJson(this.cachePath, { savedAt: new Date().toISOString(), notes });
    }

    clearCache() {
        try {
            fs.rmSync(this.cachePath, { force: true });
        } catch {
            // a cache that will not delete is not worth failing over
        }
    }
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJson(file, value) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        // Written via a temporary file so a crash mid-write cannot leave the
        // settings truncated.
        const temp = `${file}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(value, null, 2));
        fs.renameSync(temp, file);
    } catch {
        // Losing a cache write is survivable; crashing the app over it is not.
    }
}

module.exports = { Store, DEFAULTS };
