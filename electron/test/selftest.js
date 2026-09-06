"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Drives the real app in a real Electron window against a real backend, then
 * writes screenshots and exits non-zero if a step failed.
 *
 * Started by `npm run selftest`, which launches the app with --selftest; the
 * steps run in the main process and reach into the renderer through the small
 * `window.__greynote_test__` handle the app exposes.
 */
const SHOTS = path.join(__dirname, "screenshots");

const config = {
    url: process.env.GREYNOTE_URL || "http://localhost:38080",
    email: process.env.GREYNOTE_EMAIL || "admin@example.com",
    password: process.env.GREYNOTE_PASSWORD || "supersecret123",
};

async function run({ app, window, store, api }) {
    fs.mkdirSync(SHOTS, { recursive: true });

    const results = [];
    const step = async (name, fn) => {
        try {
            await fn();
            results.push({ name, ok: true });
            console.log(`  ✓ ${name}`);
        } catch (err) {
            results.push({ name, ok: false, error: err.message });
            console.error(`  ✗ ${name}: ${err.message}`);
        }
    };

    const js = source => window.webContents.executeJavaScript(source, true);
    const state = () => js("JSON.parse(JSON.stringify(window.__greynote_test__.store.get()))");
    const act = (name, ...args) =>
        js(`window.__greynote_test__.actions[${JSON.stringify(name)}](...${JSON.stringify(args)})`);

    const shot = async name => {
        const image = await window.webContents.capturePage();
        fs.writeFileSync(path.join(SHOTS, `${name}.png`), image.toPNG());
    };

    const settle = (ms = 600) => new Promise(resolve => setTimeout(resolve, ms));

    // A separate, much shorter run used to prove the offline path: start it with
    // the server stopped after a normal run has filled the cache.
    if (process.env.GREYNOTE_OFFLINE_CHECK === "1") {
        await step("falls back to the cached notes when the server is down", async () => {
            await settle(1500);
            const current = await state();
            if (!current.offlineCache) throw new Error("the offline banner is not showing");
            if (current.notes.length === 0) throw new Error("no cached notes were restored");
        });
        await shot("12-offline");

        const offlineFailures = results.filter(result => !result.ok);
        console.log(`\n${results.length - offlineFailures.length}/${results.length} steps passed`);
        app.exit(offlineFailures.length === 0 ? 0 : 1);
        return;
    }

    console.log(`GreyNote desktop self-test against ${config.url}`);

    // The app under test talks to whichever server the environment names.
    store.set("serverUrl", config.url);
    api.setBaseUrl(config.url);

    await window.webContents.executeJavaScript("new Promise(r => setTimeout(r, 300))");

    await step("signs in", async () => {
        await act("logout").catch(() => {});
        await act("login", config.email, config.password);
        await settle(1200);
        const current = await state();
        if (current.view === "login") throw new Error(current.error || "still on the login screen");
        if (!current.me?.email) throw new Error("no account came back from /api/me");
    });

    await step("lists notes", async () => {
        await act("refresh");
        await settle();
        const current = await state();
        if (!Array.isArray(current.notes)) throw new Error("no note list");
    });
    await shot("01-notes");

    let createdId = null;
    await step("creates a note", async () => {
        await act("newNote", "Desktop self-test");
        await settle(900);
        const current = await state();
        if (!current.note) throw new Error("nothing opened in the editor");
        createdId = current.note.id;
    });

    await step("edits and saves", async () => {
        await act("editDraft", { content: "# Heading\n\n- [ ] a task\n\nBody from the desktop client." });
        await act("save");
        await settle(900);
        const current = await state();
        if (current.error) throw new Error(current.error);
        const stored = await api.getNote(createdId);
        if (!stored.content.includes("Body from the desktop client.")) {
            throw new Error("the server did not receive the edit");
        }
    });
    await shot("02-editor");

    await step("renders the preview", async () => {
        await act("setPreview", true);
        await settle();
        const html = await js("document.querySelector('.md')?.innerHTML || ''");
        if (!html.includes("<h1")) throw new Error("markdown did not render");
        if (!html.includes("checkbox")) throw new Error("task list did not render");
    });
    await shot("03-preview");

    await step("ticks a task from the preview", async () => {
        await js("document.querySelector('.md input[type=checkbox]').click()");
        await settle(900);
        const stored = await api.getNote(createdId);
        if (!stored.content.includes("- [x] a task")) throw new Error("the checkbox did not reach the server");
    });

    await step("searches", async () => {
        await act("setSearch", "desktop");
        await settle(900);
        const current = await state();
        if (!current.results || current.results.length === 0) throw new Error("search returned nothing");
        await act("setSearch", "");
        await settle(300);
    });
    await shot("04-search");

    await step("rejects a stale save with a conflict", async () => {
        // Change the note behind the editor's back, the way another client would.
        const before = await api.getNote(createdId);
        await api.updateNote(createdId, {
            title: before.title,
            content: "changed by another client",
            tags: before.tags,
            folder: before.folder,
            isPinned: before.isPinned,
        }, before.updatedAt);

        await act("editDraft", { content: "written on the desktop" });
        await act("save");
        await settle(900);

        const current = await state();
        if (!current.conflict) throw new Error("no conflict was reported");
        if (!current.conflict.content.includes("another client")) throw new Error("the server copy is missing");
    });
    await shot("05-conflict");

    await step("resolves the conflict by keeping mine", async () => {
        await act("save", { force: true });
        await settle(900);
        const current = await state();
        if (current.conflict) throw new Error("the conflict banner is still up");
        const stored = await api.getNote(createdId);
        if (stored.content !== "written on the desktop") throw new Error("the overwrite did not stick");
    });

    for (const [view, name] of [["daily", "06-journal"], ["templates", "07-templates"], ["tags", "08-tags"], ["trash", "09-trash"], ["stats", "10-stats"], ["settings", "11-settings"]]) {
        await step(`opens the ${view} view`, async () => {
            await act("setView", view);
            await settle(900);
            const current = await state();
            if (current.view !== view) throw new Error(`view is ${current.view}`);
            if (current.error) throw new Error(current.error);
        });
        await shot(name);
    }

    await step("moves the note to the trash", async () => {
        await act("setView", "notes");
        await act("openNote", createdId);
        await settle(600);
        // confirm() has no one to answer it in a self-test. The trailing `true`
        // keeps executeJavaScript from trying to clone the function back.
        await js("window.confirm = () => true; true");
        await act("trashNote");
        await settle(900);

        const trash = await api.trash();
        if (!trash.some(item => item.id === createdId)) throw new Error("the note is not in the trash");
    });

    await step("purges it again", async () => {
        await api.purgeNote(createdId);
    });

    await step("leaves the server as it found it", async () => {
        // Repeated runs must not pile up notes on whatever server is being used.
        const { notes } = await api.listNotes({ limit: 200 });
        for (const note of notes.filter(note => note.title === "Desktop self-test")) {
            await api.deleteNote(note.id);
            await api.purgeNote(note.id);
        }
        for (const item of await api.trash()) {
            if (item.title === "Desktop self-test") await api.purgeNote(item.id);
        }
    });

    const failed = results.filter(result => !result.ok);
    console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
    console.log(`screenshots: ${SHOTS}`);

    app.exit(failed.length === 0 ? 0 : 1);
}

module.exports = { run };
