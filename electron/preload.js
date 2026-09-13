"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * The only surface the renderer gets. No Node, no fetch to the backend, no
 * cookie access — just these calls, each returning { ok, data } or
 * { ok: false, error, status }.
 */
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("greynote", {
    settings: {
        get: () => invoke("settings:get"),
        set: values => invoke("settings:set", values),
    },
    auth: {
        me: () => invoke("auth:me"),
        login: (email, password) => invoke("auth:login", { email, password }),
        logout: () => invoke("auth:logout"),
        changePassword: (currentPassword, newPassword) =>
            invoke("auth:changePassword", { currentPassword, newPassword }),
        deleteAccount: password => invoke("auth:deleteAccount", password),
        sessions: () => invoke("auth:sessions"),
        revokeSession: id => invoke("auth:revokeSession", id),
    },
    admin: {
        users: () => invoke("admin:users"),
        createUser: user => invoke("admin:createUser", user),
        setAdmin: (id, isAdmin) => invoke("admin:setAdmin", { id, isAdmin }),
        deleteUser: id => invoke("admin:deleteUser", id),
    },
    server: {
        version: () => invoke("server:version"),
    },
    notes: {
        list: filters => invoke("notes:list", filters),
        cached: () => invoke("notes:cached"),
        get: id => invoke("notes:get", id),
        create: note => invoke("notes:create", note),
        update: (id, note, baseUpdatedAt) => invoke("notes:update", { id, note, baseUpdatedAt }),
        remove: id => invoke("notes:delete", id),
        pin: id => invoke("notes:pin", id),
        search: (query, limit) => invoke("notes:search", { query, limit }),
        links: id => invoke("notes:links", id),
        versions: id => invoke("notes:versions", id),
        version: (id, versionId) => invoke("notes:version", { id, versionId }),
    },
    trash: {
        list: () => invoke("trash:list"),
        restore: id => invoke("trash:restore", id),
        purge: id => invoke("trash:purge", id),
        empty: () => invoke("trash:empty"),
    },
    tags: {
        list: () => invoke("tags:list"),
        rename: (name, next) => invoke("tags:rename", { name, next }),
        remove: name => invoke("tags:delete", name),
        merge: (from, into) => invoke("tags:merge", { from, into }),
    },
    folders: {
        list: () => invoke("folders:list"),
        rename: (from, to) => invoke("folders:rename", { from, to }),
        remove: path => invoke("folders:delete", path),
    },
    templates: {
        list: () => invoke("templates:list"),
        save: template => invoke("templates:save", template),
        remove: id => invoke("templates:delete", id),
        apply: (id, options) => invoke("templates:apply", { id, ...(options || {}) }),
    },
    daily: {
        get: date => invoke("daily:get", date),
        open: date => invoke("daily:open", date),
        list: () => invoke("daily:list"),
    },
    stats: {
        get: () => invoke("stats:get"),
    },
    share: {
        enable: (id, expiresAt) => invoke("share:enable", { id, expiresAt }),
        disable: id => invoke("share:disable", id),
        setPassword: (id, password) => invoke("share:password", { id, password }),
        setExpiry: (id, expiresAt) => invoke("share:expiry", { id, expiresAt }),
        read: (token, password) => invoke("share:read", { token, password }),
    },
    desktop: {
        copy: text => invoke("desktop:copy", text),
        openExternal: url => invoke("desktop:openExternal", url),
        exportZip: () => invoke("desktop:exportZip"),
        importNotes: () => invoke("desktop:importNotes"),
        insertImage: () => invoke("desktop:insertImage"),
        pasteImage: () => invoke("desktop:pasteImage"),
        saveNoteAs: (title, content) => invoke("desktop:saveNoteAs", { title, content }),
    },
    // Menu items, the tray and the global hotkey all arrive here.
    onCommand: handler => {
        const listener = (_event, command) => handler(command);
        ipcRenderer.on("command", listener);
        return () => ipcRenderer.removeListener("command", listener);
    },
});
