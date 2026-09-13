"use strict";

const { app, ipcMain, shell, dialog, clipboard } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { ApiError } = require("./api");

/**
 * Every renderer call lands here. Handlers return `{ ok, data }` or
 * `{ ok: false, error, status }` rather than throwing across the bridge, so the
 * UI can react to a 409 or an offline server without unwrapping exceptions.
 */
function registerIpc({ api, store, getWindow, onAuthChange = () => {} }) {
    const handle = (channel, fn) => {
        ipcMain.handle(channel, async (_event, ...args) => {
            try {
                return { ok: true, data: await fn(...args) };
            } catch (err) {
                if (err instanceof ApiError) {
                    return { ok: false, error: err.message, status: err.status, data: err.data };
                }
                return { ok: false, error: err?.message || "Something went wrong", status: 0 };
            }
        });
    };

    // ---- settings and session --------------------------------------------

    handle("settings:get", () => ({
        serverUrl: store.get("serverUrl"),
        theme: store.get("theme"),
        quickCaptureShortcut: store.get("quickCaptureShortcut"),
        startMinimised: store.get("startMinimised"),
        hasSession: Boolean(store.get("cookie")),
        appVersion: app.getVersion(),
    }));

    handle("settings:set", values => {
        if (typeof values.serverUrl === "string") {
            const url = values.serverUrl.trim().replace(/\/+$/, "");
            store.set("serverUrl", url);
            api.setBaseUrl(url);
        }
        for (const key of ["theme", "quickCaptureShortcut", "startMinimised"]) {
            if (values[key] !== undefined) store.set(key, values[key]);
        }
        return true;
    });

    handle("auth:me", async () => {
        const me = await api.me();
        onAuthChange(true);
        return me;
    });

    handle("auth:login", async ({ email, password }) => {
        await api.login(email, password);
        const me = await api.me();
        onAuthChange(true);
        return me;
    });

    handle("auth:changePassword", ({ currentPassword, newPassword }) =>
        api.changePassword(currentPassword, newPassword).then(() => true));

    handle("auth:sessions", () => api.sessions());
    handle("auth:revokeSession", id => api.revokeSession(id).then(() => true));

    // Closing the account ends this computer's session with it, cache included.
    handle("auth:deleteAccount", async password => {
        await api.deleteAccount(password);
        store.set("cookie", null);
        store.clearCache();
        onAuthChange(false);
        return true;
    });

    handle("admin:users", () => api.users());
    handle("admin:createUser", user => api.createUser(user).then(() => true));
    handle("admin:setAdmin", ({ id, isAdmin }) => api.setUserAdmin(id, isAdmin).then(() => true));
    handle("admin:deleteUser", id => api.deleteUser(id).then(() => true));

    handle("server:version", () => api.serverVersion());

    handle("auth:logout", async () => {
        await api.logout();
        store.set("cookie", null);
        store.clearCache();
        onAuthChange(false);
        return true;
    });

    // ---- notes ------------------------------------------------------------

    handle("notes:list", async filters => {
        const result = await api.listNotes(filters);
        // Cached so the next cold start (or a dropped connection) still has
        // something to show.
        if (!filters || (!filters.tag && filters.folder === undefined && !filters.offset)) {
            store.writeCache(result.notes);
        }
        return result;
    });

    handle("notes:cached", () => store.readCache());
    handle("notes:get", id => api.getNote(id));
    handle("notes:create", note => api.createNote(note));
    handle("notes:update", ({ id, note, baseUpdatedAt }) => api.updateNote(id, note, baseUpdatedAt));
    handle("notes:delete", id => api.deleteNote(id).then(() => true));
    handle("notes:pin", id => api.togglePin(id));
    handle("notes:search", ({ query, limit }) => api.search(query, limit));
    handle("notes:links", id => api.links(id));
    handle("notes:versions", id => api.versions(id));
    handle("notes:version", ({ id, versionId }) => api.version(id, versionId));

    handle("trash:list", () => api.trash());
    handle("trash:restore", id => api.restoreNote(id).then(() => true));
    handle("trash:purge", id => api.purgeNote(id).then(() => true));
    handle("trash:empty", () => api.emptyTrash());

    handle("tags:list", () => api.tags());
    handle("tags:rename", ({ name, next }) => api.renameTag(name, next));
    handle("tags:delete", name => api.deleteTag(name));
    handle("tags:merge", ({ from, into }) => api.mergeTags(from, into));

    handle("folders:list", () => api.folders());
    handle("folders:rename", ({ from, to }) => api.renameFolder(from, to));
    handle("folders:delete", folderPath => api.deleteFolder(folderPath));

    handle("templates:list", () => api.templates());
    handle("templates:save", template => api.saveTemplate(template));
    handle("templates:delete", id => api.deleteTemplate(id).then(() => true));
    handle("templates:apply", ({ id, title, date }) => api.applyTemplate(id, { title, date }));

    handle("daily:get", date => api.dailyNote(date));
    handle("daily:open", date => api.openDaily(date));
    handle("daily:list", () => api.dailyEntries());
    handle("stats:get", () => api.stats());

    handle("share:enable", ({ id, expiresAt }) => api.enableShare(id, expiresAt));
    handle("share:disable", id => api.disableShare(id).then(() => true));
    handle("share:password", ({ id, password }) => api.setSharePassword(id, password).then(() => true));
    handle("share:expiry", ({ id, expiresAt }) => api.setShareExpiry(id, expiresAt).then(() => true));
    handle("share:read", ({ token, password }) => api.sharedNote(shareToken(token), password));

    // ---- desktop-only conveniences ---------------------------------------

    handle("desktop:copy", text => {
        clipboard.writeText(String(text ?? ""));
        return true;
    });

    handle("desktop:openExternal", url => {
        // Only http(s) — an arbitrary URL from note content must not be able to
        // launch a local handler.
        if (!/^https?:\/\//i.test(url)) throw new Error("Only http and https links can be opened");
        return shell.openExternal(url).then(() => true);
    });

    handle("desktop:exportZip", async () => {
        const window = getWindow();
        const { canceled, filePath } = await dialog.showSaveDialog(window, {
            title: "Export all notes",
            defaultPath: "notes-export.zip",
            filters: [{ name: "Zip archive", extensions: ["zip"] }],
        });
        if (canceled || !filePath) return { saved: false };

        const { buffer } = await api.exportZip();
        fs.writeFileSync(filePath, buffer);
        return { saved: true, path: filePath };
    });

    handle("desktop:importNotes", async () => {
        const window = getWindow();
        const { canceled, filePaths } = await dialog.showOpenDialog(window, {
            title: "Import notes",
            properties: ["openFile"],
            filters: [{ name: "Notes", extensions: ["zip", "md", "markdown"] }],
        });
        if (canceled || filePaths.length === 0) return { cancelled: true };

        const file = filePaths[0];
        const result = await api.importNotes(path.basename(file), fs.readFileSync(file));
        return { cancelled: false, ...result };
    });

    handle("desktop:insertImage", async () => {
        const window = getWindow();
        const { canceled, filePaths } = await dialog.showOpenDialog(window, {
            title: "Insert an image",
            properties: ["openFile"],
            filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
        });
        if (canceled || filePaths.length === 0) return { cancelled: true };

        const file = filePaths[0];
        const uploaded = await api.uploadImage(path.basename(file), fs.readFileSync(file), imageType(file));
        return { cancelled: false, ...uploaded, name: path.basename(file) };
    });

    // The clipboard route is the one people reach for after a screenshot.
    handle("desktop:pasteImage", async () => {
        const image = clipboard.readImage();
        if (image.isEmpty()) throw new Error("There is no image on the clipboard");

        const uploaded = await api.uploadImage("pasted.png", image.toPNG(), "image/png");
        return { cancelled: false, ...uploaded, name: "pasted image" };
    });

    handle("desktop:saveNoteAs", async ({ title, content }) => {
        const window = getWindow();
        const { canceled, filePath } = await dialog.showSaveDialog(window, {
            title: "Save note as markdown",
            defaultPath: `${(title || "note").replace(/[\\/:*?"<>|]/g, "_")}.md`,
            filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (canceled || !filePath) return { saved: false };

        fs.writeFileSync(filePath, content ?? "");
        return { saved: true, path: filePath };
    });
}

/** Accepts a whole share URL as readily as a bare token. */
function shareToken(value) {
    const text = String(value ?? "").trim();
    const match = text.match(/\/(?:share|api\/share)\/([^/?#]+)/);
    return match ? match[1] : text;
}

function imageType(file) {
    switch (path.extname(file).toLowerCase()) {
        case ".png": return "image/png";
        case ".gif": return "image/gif";
        case ".webp": return "image/webp";
        default: return "image/jpeg";
    }
}

module.exports = { registerIpc, shareToken };
