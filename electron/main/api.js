"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

/**
 * HTTP client for the GreyNote backend.
 *
 * All network traffic goes through the main process rather than the renderer:
 * there is no origin to fight with, the session cookie never touches page
 * JavaScript, and the renderer can stay sandboxed behind the preload bridge.
 */
class ApiError extends Error {
    constructor(message, status, data) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.data = data;
    }
}

class ApiClient {
    /**
     * @param {string} baseUrl e.g. http://localhost:38080
     * @param {(cookie: string|null) => void} [onCookieChange] persists the session
     */
    constructor(baseUrl = "", onCookieChange = () => {}) {
        this.baseUrl = trimBase(baseUrl);
        this.cookie = null;
        this.onCookieChange = onCookieChange;
    }

    setBaseUrl(baseUrl) {
        this.baseUrl = trimBase(baseUrl);
    }

    /** Restores a session saved from a previous run. */
    setCookie(cookie) {
        this.cookie = cookie || null;
    }

    clearCookie() {
        this.cookie = null;
        this.onCookieChange(null);
    }

    /**
     * @param {string} path e.g. /api/notes
     * @param {{method?: string, body?: any, headers?: object, raw?: boolean,
     *          rawBody?: Buffer, contentType?: string}} [options]
     *   body is sent as JSON; rawBody is sent as given (file uploads), and then
     *   contentType says what it is.
     */
    request(path, options = {}) {
        const { method = "GET", body, headers = {}, raw = false, rawBody, contentType } = options;
        if (!this.baseUrl) {
            return Promise.reject(new ApiError("No server address is set", 0, null));
        }

        const url = new URL(path, this.baseUrl + "/");
        const transport = url.protocol === "https:" ? https : http;
        const payload = rawBody !== undefined
            ? rawBody
            : body === undefined ? null : Buffer.from(JSON.stringify(body));

        const requestHeaders = { Accept: "application/json", ...headers };
        if (payload) {
            requestHeaders["Content-Type"] = contentType || "application/json";
            requestHeaders["Content-Length"] = payload.length;
        }
        if (this.cookie) requestHeaders["Cookie"] = this.cookie;

        return new Promise((resolve, reject) => {
            const req = transport.request(url, { method, headers: requestHeaders }, res => {
                this.captureCookie(res);

                const chunks = [];
                res.on("data", chunk => chunks.push(chunk));
                res.on("end", () => {
                    const buffer = Buffer.concat(chunks);
                    if (raw) {
                        if (res.statusCode >= 400) {
                            reject(new ApiError(`HTTP ${res.statusCode}`, res.statusCode, null));
                            return;
                        }
                        resolve({ status: res.statusCode, headers: res.headers, buffer });
                        return;
                    }

                    const text = buffer.toString("utf8");
                    let data = null;
                    if (text && (res.headers["content-type"] || "").includes("application/json")) {
                        try {
                            data = JSON.parse(text);
                        } catch {
                            data = null;
                        }
                    }

                    if (res.statusCode >= 400) {
                        reject(new ApiError(data?.error || text || `HTTP ${res.statusCode}`, res.statusCode, data));
                        return;
                    }
                    resolve({ status: res.statusCode, headers: res.headers, data });
                });
            });

            req.on("error", err => reject(new ApiError(friendlyNetworkError(err), 0, null)));
            req.setTimeout(20000, () => req.destroy(new Error("timeout")));
            if (payload) req.write(payload);
            req.end();
        });
    }

    captureCookie(res) {
        const setCookie = res.headers["set-cookie"];
        if (!setCookie) return;

        for (const entry of setCookie) {
            const [pair] = entry.split(";");
            const [name, value] = pair.split("=");
            if (!name) continue;
            if (value === "" || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(entry)) {
                this.cookie = null;
            } else {
                this.cookie = pair.trim();
            }
            this.onCookieChange(this.cookie);
        }
    }

    async json(path, options) {
        const { data } = await this.request(path, options);
        return data;
    }

    // ---- endpoints --------------------------------------------------------

    login(email, password) {
        return this.request("/api/login", { method: "POST", body: { email, password } });
    }

    async logout() {
        try {
            await this.request("/api/logout", { method: "POST" });
        } finally {
            this.clearCookie();
        }
    }

    me() {
        return this.json("/api/me");
    }

    async listNotes({ full = false, limit, offset, tag, folder, recursive } = {}) {
        const query = new URLSearchParams();
        if (full) query.set("full", "1");
        if (limit) query.set("limit", String(limit));
        if (offset) query.set("offset", String(offset));
        if (tag) query.set("tag", tag);
        if (folder !== undefined && folder !== null) {
            query.set("folder", folder);
            if (recursive && folder !== "") query.set("recursive", "1");
        }

        const suffix = query.toString();
        const { data, headers } = await this.request("/api/notes" + (suffix ? `?${suffix}` : ""));
        return { notes: data || [], total: Number(headers["x-total-count"] || (data || []).length) };
    }

    getNote(id) {
        return this.json(`/api/notes/${id}`);
    }

    createNote(note) {
        return this.json("/api/notes", { method: "POST", body: note });
    }

    /** Sends the version the editor loaded so the server can reject a stale save. */
    updateNote(id, note, baseUpdatedAt) {
        return this.json(`/api/notes/${id}`, {
            method: "PUT",
            body: note,
            headers: baseUpdatedAt ? { "If-Match": baseUpdatedAt } : {},
        });
    }

    deleteNote(id) {
        return this.request(`/api/notes/${id}`, { method: "DELETE" });
    }

    togglePin(id) {
        return this.json(`/api/notes/${id}/pin`, { method: "POST" });
    }

    search(query, limit = 50) {
        return this.json(`/api/notes/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    }

    links(id) {
        return this.json(`/api/notes/${id}/links`);
    }

    versions(id) {
        return this.json(`/api/notes/${id}/versions`);
    }

    version(id, versionId) {
        return this.json(`/api/notes/${id}/versions/${versionId}`);
    }

    trash() {
        return this.json("/api/notes/trash");
    }

    restoreNote(id) {
        return this.request(`/api/notes/${id}/restore`, { method: "POST" });
    }

    purgeNote(id) {
        return this.request(`/api/notes/${id}/purge`, { method: "DELETE" });
    }

    emptyTrash() {
        return this.json("/api/notes/trash", { method: "DELETE" });
    }

    tags() {
        return this.json("/api/tags");
    }

    renameTag(name, next) {
        return this.json(`/api/tags/${encodeURIComponent(name)}`, { method: "PUT", body: { name: next } });
    }

    deleteTag(name) {
        return this.json(`/api/tags/${encodeURIComponent(name)}`, { method: "DELETE" });
    }

    mergeTags(from, into) {
        return this.json("/api/tags/merge", { method: "POST", body: { from, into } });
    }

    folders() {
        return this.json("/api/folders");
    }

    renameFolder(from, to) {
        return this.json("/api/folders", { method: "PUT", body: { from, to } });
    }

    deleteFolder(path) {
        return this.json(`/api/folders?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    }

    templates() {
        return this.json("/api/templates");
    }

    saveTemplate(template) {
        return template.id
            ? this.json(`/api/templates/${template.id}`, { method: "PUT", body: template })
            : this.json("/api/templates", { method: "POST", body: template });
    }

    deleteTemplate(id) {
        return this.request(`/api/templates/${id}`, { method: "DELETE" });
    }

    applyTemplate(id, { title = "", date = "" } = {}) {
        return this.json(`/api/templates/${id}/apply`, { method: "POST", body: { title, date } });
    }

    openDaily(date) {
        return this.json("/api/notes/daily", { method: "POST", body: { date } });
    }

    dailyEntries() {
        return this.json("/api/notes/daily/list");
    }

    stats() {
        return this.json("/api/notes/stats");
    }

    enableShare(id, expiresAt = "") {
        return this.json(`/api/notes/${id}/share`, { method: "POST", body: { expiresAt } });
    }

    disableShare(id) {
        return this.request(`/api/notes/${id}/share/disable`, { method: "POST" });
    }

    setSharePassword(id, password) {
        return this.request(`/api/notes/${id}/share/password`, { method: "PUT", body: { password } });
    }

    exportZip() {
        return this.request("/api/notes/export", { raw: true });
    }

    /** POSTs one file as multipart/form-data: images and the import archive. */
    uploadFile(path, { field = "file", filename, buffer, contentType }) {
        const boundary = `----greynote${crypto.randomBytes(12).toString("hex")}`;
        const head = Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
            `Content-Type: ${contentType || "application/octet-stream"}\r\n\r\n`,
        );
        const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

        return this.json(path, {
            method: "POST",
            rawBody: Buffer.concat([head, buffer, tail]),
            contentType: `multipart/form-data; boundary=${boundary}`,
        });
    }

    uploadImage(filename, buffer, contentType) {
        return this.uploadFile("/api/images", { filename, buffer, contentType });
    }

    importNotes(filename, buffer) {
        return this.uploadFile("/api/notes/import", { filename, buffer, contentType: "application/octet-stream" });
    }

    /** The day's journal entry, or a 404 when that day has none. */
    dailyNote(date) {
        return this.json(`/api/notes/daily${date ? `?date=${encodeURIComponent(date)}` : ""}`);
    }

    setShareExpiry(id, expiresAt) {
        return this.request(`/api/notes/${id}/share/expiry`, {
            method: "PUT",
            body: { expiresAt: expiresAt || "" },
        });
    }

    /**
     * Reads a note someone shared. The link is the credential, so this is the
     * one call that deliberately carries no session.
     */
    sharedNote(token, password = "") {
        return this.json(`/api/share/${encodeURIComponent(token)}`, {
            headers: password ? { "X-Share-Password": password } : {},
        });
    }

    // ---- account and sessions ---------------------------------------------

    changePassword(currentPassword, newPassword) {
        return this.request("/api/account/password", {
            method: "PUT",
            body: { currentPassword, newPassword },
        });
    }

    deleteAccount(password) {
        return this.request("/api/account", { method: "DELETE", body: { password } });
    }

    sessions() {
        return this.json("/api/sessions");
    }

    revokeSession(id) {
        return this.request(`/api/sessions/${id}`, { method: "DELETE" });
    }

    // ---- administration ---------------------------------------------------

    users() {
        return this.json("/api/admin/users");
    }

    createUser({ email, password, isAdmin = false }) {
        return this.request("/api/admin/users", { method: "POST", body: { email, password, isAdmin } });
    }

    setUserAdmin(id, isAdmin) {
        return this.request(`/api/admin/users/${id}/admin`, { method: "PUT", body: { isAdmin } });
    }

    deleteUser(id) {
        return this.request(`/api/admin/users/${id}`, { method: "DELETE" });
    }

    /** The server's own version, shown next to the app's in Settings. */
    serverVersion() {
        return this.json("/api/version");
    }
}

function trimBase(url) {
    return (url || "").trim().replace(/\/+$/, "");
}

/** Turns Node's socket errors into something worth showing a person. */
function friendlyNetworkError(err) {
    switch (err.code) {
        case "ECONNREFUSED":
            return "The server refused the connection — is it running?";
        case "ENOTFOUND":
            return "That server address could not be found";
        case "ETIMEDOUT":
            return "The server did not respond in time";
        default:
            return err.message || "Network error";
    }
}

module.exports = { ApiClient, ApiError };
