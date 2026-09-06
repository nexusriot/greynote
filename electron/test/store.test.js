import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../main/store.js";

const dirs = [];
function tempStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greynote-store-"));
    dirs.push(dir);
    return new Store(dir);
}

afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Store", () => {
    it("starts from defaults and persists changes", () => {
        const store = tempStore();
        expect(store.get("serverUrl")).toBe("http://localhost:38080");

        store.set("serverUrl", "https://notes.example.com");
        expect(new Store(store.directory).get("serverUrl")).toBe("https://notes.example.com");
    });

    it("keeps the session cookie across restarts", () => {
        const store = tempStore();
        store.set("cookie", "notes_session=abc");
        expect(new Store(store.directory).get("cookie")).toBe("notes_session=abc");
    });

    it("round-trips the offline note cache", () => {
        const store = tempStore();
        expect(store.readCache()).toBe(null);

        store.writeCache([{ id: 1, title: "Cached" }]);
        const cache = new Store(store.directory).readCache();
        expect(cache.notes).toEqual([{ id: 1, title: "Cached" }]);
        expect(cache.savedAt).toBeTruthy();
    });

    it("drops the cache on request", () => {
        const store = tempStore();
        store.writeCache([{ id: 1 }]);
        store.clearCache();
        expect(store.readCache()).toBe(null);
    });

    it("survives a corrupt settings file", () => {
        const store = tempStore();
        fs.writeFileSync(store.settingsPath, "{ not json");
        expect(new Store(store.directory).get("serverUrl")).toBe("http://localhost:38080");
    });

    it("survives a corrupt cache file", () => {
        const store = tempStore();
        fs.writeFileSync(store.cachePath, "{ not json");
        expect(store.readCache()).toBe(null);
    });
});
