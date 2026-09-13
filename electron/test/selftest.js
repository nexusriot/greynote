"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { clipboard, nativeImage } = require("electron");

/**
 * Drives the real app in a real Electron window against a real backend, then
 * writes screenshots and exits non-zero if a step failed.
 *
 * Started by `npm run selftest`, which launches the app with --selftest; the
 * steps run in the main process and reach into the renderer through the small
 * `window.__greynote_test__` handle the app exposes.
 */
const SHOTS = path.join(__dirname, "screenshots");

// A 2x2 red PNG: small enough to inline, and a real image both the server's
// sniffer and Chromium's decoder accept (the clipboard step needs the latter).
const PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR42mP4z8DwH4QZYAwAR8oH+Rq28akAAAAASUVORK5CYII=",
    "base64",
);

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

    for (const [view, name] of [["daily", "06-journal"], ["templates", "07-templates"], ["tags", "08-tags"], ["trash", "09-trash"], ["stats", "10-stats"], ["settings", "11-settings"], ["shared", "13-shared"], ["sessions", "14-sessions"], ["users", "15-users"]]) {
        await step(`opens the ${view} view`, async () => {
            await act("setView", view);
            await settle(900);
            const current = await state();
            if (current.view !== view) throw new Error(`view is ${current.view}`);
            if (current.error) throw new Error(current.error);
        });
        await shot(name);
    }

    await step("uploads an image and links it into the note", async () => {
        await act("setView", "notes");
        await act("openNote", createdId);
        await settle(600);

        clipboard.clear();
        const empty = await js(
            "window.greynote.desktop.pasteImage().then(r => JSON.stringify(r))",
        );
        if (!/clipboard/i.test(empty)) throw new Error(`an empty clipboard should say so: ${empty}`);

        clipboard.writeImage(nativeImage.createFromBuffer(PIXEL_PNG));
        await act("pasteImage");
        await settle(900);

        const current = await state();
        const link = (current.draft?.content || "").match(/!\[[^\]]*\]\((\/api\/images\/[^)]+)\)/);
        if (!link) throw new Error(current.error || "no image markdown was inserted");

        // The link the editor wrote has to be one the server will serve.
        const served = await api.request(link[1], { raw: true });
        if (served.status !== 200) throw new Error(`the image is not served: ${served.status}`);
        await act("save");
        await settle(900);
    });
    await shot("16-image");

    await step("sets and clears a share expiry", async () => {
        await act("enableShare");
        await settle(600);

        const future = new Date(Date.now() + 3600_000);
        await act("editShareExpiry", future.toISOString().slice(0, 16));
        await act("saveShareExpiry");
        await settle(600);
        if (!(await api.getNote(createdId)).shareExpiresAt) throw new Error("the expiry did not reach the server");

        await act("clearShareExpiry");
        await settle(600);
        if ((await api.getNote(createdId)).shareExpiresAt) throw new Error("the expiry was not cleared");
    });

    await step("reads its own share link back through the shared view", async () => {
        const note = await api.getNote(createdId);
        if (!note.shareUrl) throw new Error("the note has no share link");

        await act("setView", "shared");
        await act("editShared", { sharedToken: `${config.url}${note.shareUrl}`, sharedPassword: "" });
        await act("openSharedLink");
        await settle(900);

        const current = await state();
        if (!current.sharedNote) throw new Error(current.error || "nothing came back");
        if (current.sharedNote.id !== createdId) throw new Error("a different note came back");
    });
    await shot("17-shared-note");

    await step("stops sharing", async () => {
        await act("setView", "notes");
        await act("openNote", createdId);
        await settle(600);
        await act("disableShare");
        await settle(600);
        if ((await api.getNote(createdId)).shareUrl) throw new Error("the link is still live");
    });

    await step("lists this computer's session", async () => {
        await act("setView", "sessions");
        await settle(900);

        const current = await state();
        const here = (current.sessions || []).filter(item => item.isCurrent);
        if (here.length !== 1) throw new Error(`expected one current session, got ${here.length}`);
    });

    await step("refuses a password change with the wrong current password", async () => {
        await act("setView", "settings");
        await settle(600);
        await act("editSetting", { currentPassword: "not my password", newPassword: "irrelevant-but-long" });
        await act("changePassword");
        await settle(900);

        const current = await state();
        if (!current.error) throw new Error("the server's refusal was not surfaced");
        await act("editSetting", { currentPassword: "", newPassword: "" });
    });

    await step("asks for the password before closing the account", async () => {
        await act("editSetting", { closePassword: "" });
        await act("closeAccount");
        await settle(600);

        const current = await state();
        if (current.view !== "settings") throw new Error("it tried to close the account regardless");
        if (!current.error) throw new Error("no explanation was shown");
    });

    await step("imports a markdown file", async () => {
        const file = path.join(os.tmpdir(), `greynote-selftest-import-${Date.now()}.md`);
        fs.writeFileSync(file, "# Imported by the self-test\n\nBody from an imported file.\n");
        try {
            const report = await api.importNotes(path.basename(file), fs.readFileSync(file));
            if (report.imported !== 1) throw new Error(`imported ${report.imported} notes`);
        } finally {
            fs.unlinkSync(file);
        }

        const { notes } = await api.listNotes({ limit: 200 });
        const imported = notes.find(note => note.title === "Imported by the self-test");
        if (!imported) throw new Error("the imported note is not in the list");
        await api.deleteNote(imported.id);
        await api.purgeNote(imported.id);
    });

    await step("creates, promotes and removes a user", async () => {
        const email = `selftest-${Date.now()}@example.com`;
        await act("setView", "users");
        await settle(600);
        await act("editUserDraft", { email, password: "password123", isAdmin: false });
        await act("createUser");
        await settle(900);

        const created = (await state()).users.find(user => user.email === email);
        if (!created) throw new Error("the new user is not listed");

        await act("toggleUserAdmin", created);
        await settle(900);
        const promoted = (await state()).users.find(user => user.email === email);
        if (!promoted?.isAdmin) throw new Error("the admin flag did not stick");

        await js("window.confirm = () => true; true");
        await act("deleteUser", promoted);
        await settle(900);
        if ((await state()).users.some(user => user.email === email)) throw new Error("the user is still listed");
    });

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
