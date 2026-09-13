import { h, mount } from "./lib/dom.js";
import {
    createState,
    draftFrom,
    insertSnippet,
    isDirty,
    listFilters,
    localDate,
} from "./lib/state.js";
import { toggleTaskAtLine } from "./lib/markdown.js";
import { noteList, sidebar } from "./views/notes.js";
import { editorPane } from "./views/editor.js";
import {
    dailyView,
    sessionsView,
    settingsView,
    sharedView,
    statsView,
    tagsView,
    templatesView,
    trashView,
    usersView,
} from "./views/library.js";

const api = window.greynote;
const store = createState({ view: "loading", split: false });
const root = document.getElementById("root");

const PAGE_SIZE = 100;
let searchTimer = null;

// ---------------------------------------------------------------- helpers ---

/** Unwraps an IPC result, surfacing the error in the UI and returning null. */
function unwrap(result, { silent = false } = {}) {
    if (result?.ok) return result.data;
    if (!silent) store.set({ error: result?.error || "Something went wrong" });
    return null;
}

function flash(message) {
    store.set({ message, error: null });
    setTimeout(() => {
        if (store.get().message === message) store.set({ message: null });
    }, 4000);
}

function applyTheme(theme) {
    const dark = theme === "dark" ||
        (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
}

// ----------------------------------------------------------------- actions ---

const actions = {
    async refresh({ keepSelection = true } = {}) {
        const state = store.get();
        const result = await api.notes.list(listFilters(state, { limit: PAGE_SIZE }));

        if (!result.ok) {
            // Fall back to whatever the last successful sync left on disk.
            const cached = unwrap(await api.notes.cached(), { silent: true });
            store.set({
                online: false,
                offlineCache: Boolean(cached),
                notes: cached?.notes || state.notes,
                error: result.error,
            });
            return;
        }

        const [tags, folders] = await Promise.all([api.tags.list(), api.folders.list()]);
        store.set({
            online: true,
            offlineCache: false,
            error: null,
            notes: result.data.notes,
            total: result.data.total,
            tags: unwrap(tags, { silent: true }) || [],
            folders: unwrap(folders, { silent: true }) || [],
            selectedId: keepSelection ? store.get().selectedId : null,
        });
    },

    async loadMore() {
        const state = store.get();
        const result = await api.notes.list(listFilters(state, { limit: PAGE_SIZE, offset: state.notes.length }));
        const data = unwrap(result);
        if (data) store.set({ notes: [...state.notes, ...data.notes], total: data.total });
    },

    setView(view) {
        store.set({ view, error: null, message: null });
        if (view === "trash") actions.loadTrash();
        if (view === "templates") actions.loadTemplates();
        if (view === "stats") actions.loadStats();
        if (view === "daily") actions.loadDaily();
        if (view === "settings") actions.loadSettings();
        if (view === "sessions") actions.loadSessions();
        if (view === "users") actions.loadUsers();
    },

    setTag(tag) {
        store.set({ tag, view: "notes" });
        actions.refresh();
    },

    setFolder(folder) {
        store.set({ folder, view: "notes" });
        actions.refresh();
    },

    setSearch(value) {
        store.set({ search: value });
        clearTimeout(searchTimer);

        if (!value.trim()) {
            store.set({ results: null });
            return;
        }
        // A slow earlier response must not paint over a newer one.
        const query = value;
        searchTimer = setTimeout(async () => {
            const result = await api.notes.search(query, 60);
            if (store.get().search !== query) return;
            const data = unwrap(result);
            if (data) store.set({ results: data.results });
        }, 180);
    },

    async openNote(id) {
        if (!(await actions.confirmDiscard())) return;

        const note = unwrap(await api.notes.get(id));
        if (!note) return;

        store.set({
            view: "notes",
            selectedId: id,
            note,
            draft: draftFrom(note),
            conflict: null,
            links: null,
            versions: null,
            openVersion: null,
            error: null,
        });

        api.notes.links(id).then(result => {
            if (store.get().selectedId === id) store.set({ links: unwrap(result, { silent: true }) || { outgoing: [], backlinks: [] } });
        });
        api.notes.versions(id).then(result => {
            if (store.get().selectedId === id) store.set({ versions: unwrap(result, { silent: true }) || [] });
        });
    },

    async newNote(title = "New note") {
        if (!(await actions.confirmDiscard())) return;

        const state = store.get();
        const created = unwrap(await api.notes.create({
            title,
            content: "",
            tags: state.tag || "",
            folder: state.folder || "",
            isPinned: false,
        }));
        if (!created) return;

        await actions.refresh();
        await actions.openNote(created.id);
        document.getElementById("editor-textarea")?.focus();
    },

    editDraft(patch) {
        store.set({ draft: { ...store.get().draft, ...patch } });
    },

    async save({ force = false } = {}) {
        const state = store.get();
        if (!state.note || !state.draft) return;

        const result = await api.notes.update(
            state.note.id,
            { ...state.draft, isPinned: state.note.isPinned },
            force ? null : state.note.updatedAt,
        );

        if (!result.ok) {
            if (result.status === 409) {
                store.set({ conflict: result.data?.current || null, error: null });
                return;
            }
            store.set({ error: result.error });
            return;
        }

        store.set({
            note: { ...state.note, ...state.draft, updatedAt: result.data?.updatedAt || state.note.updatedAt },
            conflict: null,
            error: null,
        });
        flash("Saved");
        actions.refresh();
        api.notes.links(state.note.id).then(r => store.set({ links: unwrap(r, { silent: true }) }));
    },

    useServerVersion() {
        const { conflict } = store.get();
        if (!conflict) return;
        store.set({ note: conflict, draft: draftFrom(conflict), conflict: null });
    },

    async togglePin() {
        const state = store.get();
        const result = unwrap(await api.notes.pin(state.note.id));
        if (!result) return;
        store.set({ note: { ...state.note, isPinned: result.isPinned } });
        actions.refresh();
    },

    async trashNote() {
        const state = store.get();
        if (!confirm(`Move "${state.note.title || "this note"}" to the trash?`)) return;

        if (!unwrap(await api.notes.remove(state.note.id))) return;
        store.set({ note: null, draft: null, selectedId: null });
        flash("Moved to the trash");
        actions.refresh();
    },

    toggleTask(line) {
        const state = store.get();
        const content = toggleTaskAtLine(state.draft.content, line);
        if (content === state.draft.content) return;
        store.set({ draft: { ...state.draft, content } });
        actions.save();
    },

    jumpToLine(line) {
        const textarea = document.getElementById("editor-textarea");
        if (!textarea) {
            store.set({ preview: false });
            return;
        }
        const lines = store.get().draft.content.split("\n");
        const offset = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
        textarea.focus();
        textarea.setSelectionRange(offset, offset + (lines[line - 1] || "").length);
        textarea.scrollTop = ((line - 1) / Math.max(lines.length, 1)) * textarea.scrollHeight;
    },

    editorKeyDown(event) {
        if (event.key === "Tab") {
            event.preventDefault();
            const textarea = event.target;
            const { selectionStart: start, selectionEnd: end, value } = textarea;
            const next = value.slice(0, start) + "  " + value.slice(end);
            actions.editDraft({ content: next });
            requestAnimationFrame(() => textarea.setSelectionRange(start + 2, start + 2));
        }
    },

    setPreview(preview) {
        store.set({ preview });
    },

    setSplit(split) {
        store.set({ split });
    },

    async openVersion(versionId) {
        const state = store.get();
        if (state.openVersion?.id === versionId) {
            store.set({ openVersion: null });
            return;
        }
        const version = unwrap(await api.notes.version(state.note.id, versionId));
        if (version) store.set({ openVersion: version });
    },

    restoreVersion() {
        const { openVersion, draft } = store.get();
        if (!openVersion) return;
        store.set({
            draft: { ...draft, title: openVersion.title, content: openVersion.content, tags: openVersion.tags },
            openVersion: null,
        });
        flash("Version loaded into the editor — save to keep it");
    },

    async enableShare() {
        const state = store.get();
        const result = unwrap(await api.share.enable(state.note.id, ""));
        if (!result) return;
        store.set({ note: { ...state.note, shareUrl: result.shareUrl } });
        flash("Share link created");
    },

    async disableShare() {
        const state = store.get();
        if (!unwrap(await api.share.disable(state.note.id))) return;
        store.set({ note: { ...state.note, shareUrl: "", sharePasswordSet: false } });
        flash("Sharing disabled");
    },

    async setSharePassword() {
        const password = prompt("Share password (leave blank to remove):", "");
        if (password === null) return;
        const state = store.get();
        if (!unwrap(await api.share.setPassword(state.note.id, password))) return;
        store.set({ note: { ...state.note, sharePasswordSet: Boolean(password.trim()) } });
        flash(password.trim() ? "Password set" : "Password removed");
    },

    editShareExpiry(value) {
        store.set({ shareExpiry: value });
    },

    /** The picker speaks local time; the server wants RFC3339. */
    async saveShareExpiry() {
        const state = store.get();
        const value = (state.shareExpiry || "").trim();
        if (!value) {
            store.set({ error: "Pick a date and time first" });
            return;
        }
        const when = new Date(value);
        if (Number.isNaN(when.getTime())) {
            store.set({ error: "That date could not be read" });
            return;
        }
        if (!unwrap(await api.share.setExpiry(state.note.id, when.toISOString()))) return;
        store.set({ note: { ...state.note, shareExpiresAt: when.toISOString() } });
        flash("Expiry set");
    },

    async clearShareExpiry() {
        const state = store.get();
        if (!unwrap(await api.share.setExpiry(state.note.id, ""))) return;
        store.set({ note: { ...state.note, shareExpiresAt: "" }, shareExpiry: "" });
        flash("The link no longer expires");
    },

    editShared(patch) {
        store.set(patch);
    },

    async openSharedLink() {
        const state = store.get();
        const token = (state.sharedToken || "").trim();
        if (!token) {
            store.set({ error: "Paste a share link or token first" });
            return;
        }

        const result = await api.share.read(token, state.sharedPassword || "");
        if (!result.ok) {
            store.set({
                sharedNote: null,
                error: result.status === 401
                    ? "That link is password protected — enter its password"
                    : result.error,
            });
            return;
        }
        store.set({ sharedNote: result.data, error: null });
    },

    // ---- images ------------------------------------------------------------

    async insertImage() {
        actions.attachImage(await api.desktop.insertImage());
    },

    async pasteImage() {
        actions.attachImage(await api.desktop.pasteImage());
    },

    /** Puts the uploaded image's markdown where the cursor is. */
    attachImage(result) {
        const uploaded = unwrap(result);
        if (!uploaded || uploaded.cancelled) return;

        const state = store.get();
        const markdown = `![${uploaded.name || "image"}](${uploaded.url})`;
        const textarea = document.getElementById("editor-textarea");
        const content = state.draft?.content ?? "";

        const at = textarea ? textarea.selectionStart : content.length;
        const to = textarea ? textarea.selectionEnd : content.length;
        const { content: next, caret } = insertSnippet(content, at, to, markdown);

        actions.editDraft({ content: next });
        if (textarea) {
            requestAnimationFrame(() => {
                textarea.focus();
                textarea.setSelectionRange(caret, caret);
            });
        }
        flash("Image uploaded");
    },

    async copyShareLink() {
        const state = store.get();
        const settings = state.settings || unwrap(await api.settings.get(), { silent: true }) || {};
        await api.desktop.copy(`${settings.serverUrl || ""}${state.note.shareUrl}`);
        flash("Link copied");
    },

    async saveNoteAs() {
        const state = store.get();
        const result = unwrap(await api.desktop.saveNoteAs(state.draft.title, state.draft.content));
        if (result?.saved) flash(`Saved to ${result.path}`);
    },

    async exportZip() {
        const result = unwrap(await api.desktop.exportZip());
        if (result?.saved) flash(`Exported to ${result.path}`);
    },

    // ---- trash ------------------------------------------------------------

    async loadTrash() {
        store.set({ trash: unwrap(await api.trash.list()) || [] });
    },

    async restoreNote(id) {
        if (!unwrap(await api.trash.restore(id))) return;
        flash("Restored");
        actions.loadTrash();
        actions.refresh();
    },

    async purgeNote(item) {
        if (!confirm(`Permanently delete "${item.title || "this note"}"? This cannot be undone.`)) return;
        if (!unwrap(await api.trash.purge(item.id))) return;
        actions.loadTrash();
    },

    async emptyTrash() {
        const count = (store.get().trash || []).length;
        if (!confirm(`Permanently delete all ${count} note(s) in the trash?`)) return;
        if (!unwrap(await api.trash.empty())) return;
        actions.loadTrash();
    },

    // ---- tags and folders --------------------------------------------------

    toggleTagSelection(name) {
        const selection = store.get().tagSelection || [];
        store.set({
            tagSelection: selection.includes(name)
                ? selection.filter(tag => tag !== name)
                : [...selection, name],
        });
    },

    clearTagSelection() {
        store.set({ tagSelection: [], mergeInto: "" });
    },

    setMergeTarget(value) {
        store.set({ mergeInto: value });
    },

    async mergeTags() {
        const state = store.get();
        const into = (state.mergeInto || "").trim();
        const from = (state.tagSelection || []).filter(tag => tag !== into);
        if (!into || from.length === 0) {
            store.set({ error: "Pick the tags to merge and the tag to merge them into." });
            return;
        }
        if (!unwrap(await api.tags.merge(from, into))) return;
        store.set({ tagSelection: [], mergeInto: "" });
        flash(`Merged into #${into}`);
        actions.refresh();
    },

    async renameTag(name) {
        const next = prompt(`Rename #${name} to:`, name);
        if (!next || next === name) return;
        if (!unwrap(await api.tags.rename(name, next))) return;
        flash("Tag renamed");
        actions.refresh();
    },

    async removeTag(name) {
        if (!confirm(`Remove #${name} from every note? The notes are kept.`)) return;
        if (!unwrap(await api.tags.remove(name))) return;
        actions.refresh();
    },

    async renameFolder(path) {
        const to = prompt(`Move "${path}" to:`, path);
        if (to === null || to === path) return;
        if (!unwrap(await api.folders.rename(path, to))) return;
        flash("Folder moved");
        actions.refresh();
    },

    async removeFolder(path) {
        if (!confirm(`Remove the "${path}" folder? Its notes move to Unfiled — nothing is deleted.`)) return;
        if (!unwrap(await api.folders.remove(path))) return;
        if (store.get().folder === path) store.set({ folder: null });
        actions.refresh();
    },

    // ---- templates ---------------------------------------------------------

    async loadTemplates() {
        store.set({ templates: unwrap(await api.templates.list()) || [] });
    },

    newTemplate() {
        store.set({ templateDraft: { name: "", title: "", content: "", tags: "", folder: "", isDaily: false } });
    },

    editTemplateRecord(template) {
        store.set({ templateDraft: { ...template } });
    },

    editTemplate(patch) {
        store.set({ templateDraft: { ...store.get().templateDraft, ...patch } });
    },

    cancelTemplate() {
        store.set({ templateDraft: null, error: null });
    },

    async saveTemplate() {
        const draft = store.get().templateDraft;
        if (!draft.name.trim()) {
            store.set({ error: "A template needs a name." });
            return;
        }
        if (!unwrap(await api.templates.save(draft))) return;
        store.set({ templateDraft: null });
        flash("Template saved");
        actions.loadTemplates();
    },

    async deleteTemplate(template) {
        if (!confirm(`Delete the "${template.name}" template? Notes made from it are kept.`)) return;
        if (!unwrap(await api.templates.remove(template.id))) return;
        actions.loadTemplates();
    },

    async useTemplate(id) {
        const created = unwrap(await api.templates.apply(id, { date: localDate() }));
        if (!created) return;
        await actions.refresh();
        await actions.openNote(created.id);
    },

    // ---- journal -----------------------------------------------------------

    async loadDaily() {
        const state = store.get();
        const date = state.dailyDate || localDate();
        store.set({ dailyDate: date });

        const [entries, day] = await Promise.all([api.daily.list(), api.daily.get(date)]);
        store.set({
            dailyEntries: unwrap(entries, { silent: true }) || [],
            // A day with no entry answers 404, which is an answer and not an error.
            dailyNote: day.ok ? day.data : null,
        });
    },

    setDailyDate(date) {
        store.set({ dailyDate: date });
        actions.loadDaily();
    },

    shiftDailyDate(days) {
        const base = new Date(`${store.get().dailyDate || localDate()}T12:00:00`);
        base.setDate(base.getDate() + days);
        actions.setDailyDate(localDate(base));
    },

    async openDaily(date) {
        const result = unwrap(await api.daily.open(date || localDate()));
        if (!result) return;
        await actions.refresh();
        await actions.openNote(result.id);
    },

    // ---- stats and settings ------------------------------------------------

    async loadStats() {
        store.set({ stats: unwrap(await api.stats.get()) });
    },

    async loadSettings() {
        const [settings, version] = await Promise.all([api.settings.get(), api.server.version()]);
        const current = unwrap(settings) || {};
        store.set({
            settings: current,
            appVersion: current.appVersion,
            // A server that cannot be reached is worth saying out loud here.
            serverVersion: version.ok ? version.data.version : "unreachable",
        });
    },

    async changePassword() {
        const settings = store.get().settings || {};
        const current = settings.currentPassword || "";
        const next = settings.newPassword || "";
        if (next.length < 6) {
            store.set({ error: "The new password needs at least 6 characters" });
            return;
        }
        if (!unwrap(await api.auth.changePassword(current, next))) return;

        store.set({ settings: { ...settings, currentPassword: "", newPassword: "" } });
        flash("Password changed");
    },

    async closeAccount() {
        const settings = store.get().settings || {};
        const password = settings.closePassword || "";
        if (!password) {
            store.set({ error: "Confirm with your password to close the account" });
            return;
        }
        if (!confirm("Delete this account and every note in it? This cannot be undone.")) return;
        if (!unwrap(await api.auth.deleteAccount(password))) return;

        store.set({ view: "login", me: null, notes: [], note: null, draft: null, settings: {} });
    },

    async importNotes() {
        const result = unwrap(await api.desktop.importNotes());
        if (!result || result.cancelled) return;

        store.set({ importReport: result });
        flash(`Imported ${result.imported} note${result.imported === 1 ? "" : "s"}`);
        await actions.refresh();
    },

    // ---- sessions ----------------------------------------------------------

    async loadSessions() {
        store.set({ sessions: unwrap(await api.auth.sessions()) || [] });
    },

    async revokeSession(item) {
        const here = item.isCurrent;
        if (here && !confirm("Sign this computer out?")) return;
        if (!unwrap(await api.auth.revokeSession(item.id))) return;

        if (here) {
            store.set({ view: "login", me: null, notes: [], note: null, draft: null });
            return;
        }
        flash("Session revoked");
        actions.loadSessions();
    },

    // ---- users (admin) -----------------------------------------------------

    async loadUsers() {
        store.set({ users: unwrap(await api.admin.users()) || [] });
    },

    editUserDraft(patch) {
        store.set({ userDraft: { ...(store.get().userDraft || {}), ...patch } });
    },

    async createUser() {
        const draft = store.get().userDraft || {};
        if (!draft.email || (draft.password || "").length < 6) {
            store.set({ error: "An email and a password of at least 6 characters are required" });
            return;
        }
        if (!unwrap(await api.admin.createUser({
            email: draft.email,
            password: draft.password,
            isAdmin: Boolean(draft.isAdmin),
        }))) return;

        store.set({ userDraft: {} });
        flash("User created");
        actions.loadUsers();
    },

    async toggleUserAdmin(user) {
        if (!unwrap(await api.admin.setAdmin(user.id, !user.isAdmin))) return;
        actions.loadUsers();
    },

    async deleteUser(user) {
        if (!confirm(`Delete ${user.email} and all of their notes?`)) return;
        if (!unwrap(await api.admin.deleteUser(user.id))) return;

        flash("User deleted");
        actions.loadUsers();
    },

    editSetting(patch) {
        store.set({ settings: { ...store.get().settings, ...patch } });
    },

    async saveServerUrl() {
        const settings = store.get().settings;
        await api.settings.set({ serverUrl: settings.serverUrl });
        flash("Server URL saved");
        actions.bootstrap();
    },

    async setTheme(theme) {
        await api.settings.set({ theme });
        store.set({ settings: { ...store.get().settings, theme } });
        applyTheme(theme);
    },

    async saveShortcut() {
        await api.settings.set({ quickCaptureShortcut: store.get().settings.quickCaptureShortcut });
        flash("Shortcut saved — it takes effect next time the app starts");
    },

    async logout() {
        await api.auth.logout();
        store.set({ view: "login", me: null, notes: [], note: null, draft: null });
    },

    async login(email, password) {
        const result = await api.auth.login(email, password);
        if (!result.ok) {
            store.set({ error: result.error });
            return;
        }
        store.set({ me: result.data, error: null });
        await actions.bootstrap();
    },

    /** Leaving unsaved work behind should always be a deliberate choice. */
    async confirmDiscard() {
        if (!isDirty(store.get())) return true;
        return confirm("This note has unsaved changes. Discard them?");
    },

    /** Used by the offline banner: try the server again. */
    async retry() {
        store.set({ error: null });
        await actions.bootstrap();
    },

    async bootstrap() {
        const settings = unwrap(await api.settings.get(), { silent: true }) || {};
        applyTheme(settings.theme);
        store.set({ settings });

        const me = await api.auth.me();
        if (!me.ok) {
            // A server we cannot reach is not the same as being signed out: with
            // a saved session, show the notes cached on this computer instead of
            // demanding a password that cannot be checked.
            if (me.status === 0 && settings.hasSession) {
                const cached = unwrap(await api.notes.cached(), { silent: true });
                store.set({
                    view: "notes",
                    online: false,
                    offlineCache: true,
                    notes: cached?.notes || [],
                    total: cached?.notes?.length || 0,
                    error: me.error,
                });
                return;
            }
            store.set({ view: "login", me: null, error: me.status === 401 ? null : me.error });
            return;
        }

        store.set({ view: "notes", me: me.data, error: null });
        await actions.refresh();
    },
};

// ------------------------------------------------------------------ render ---

function loginView(state) {
    let email = "";
    let password = "";

    return h("div.login",
        h("h1", null, "GreyNote"),
        h("p.muted", null, "Sign in to your notes"),
        state.error ? h("div.banner.error", null, state.error) : null,
        h("input", { id: "login-email", placeholder: "Email", oninput: event => { email = event.target.value; } }),
        h("input", {
            id: "login-password",
            type: "password",
            placeholder: "Password",
            oninput: event => { password = event.target.value; },
            onkeydown: event => { if (event.key === "Enter") actions.login(email, password); },
        }),
        h("button.primary", { onClick: () => actions.login(email, password) }, "Sign in"),
        h("details",
            h("summary.small.muted", null, "Server settings"),
            h("div.row", { style: { marginTop: "6px" } },
                h("input", {
                    id: "login-server",
                    value: state.settings?.serverUrl || "",
                    oninput: event => actions.editSetting({ serverUrl: event.target.value }),
                }),
                h("button", { onClick: () => actions.saveServerUrl() }, "Save"),
            ),
        ),
    );
}

function render(state) {
    if (state.view === "loading") {
        mount(root, h("div.empty", "Loading…"));
        return;
    }
    if (state.view === "login") {
        mount(root, loginView(state));
        return;
    }

    const mainByView = {
        notes: () => editorPane({ state, actions }),
        trash: () => trashView({ state, actions }),
        tags: () => tagsView({ state, actions }),
        templates: () => templatesView({ state, actions }),
        daily: () => dailyView({ state, actions }),
        stats: () => statsView({ state, actions }),
        shared: () => sharedView({ state, actions }),
        sessions: () => sessionsView({ state, actions }),
        users: () => usersView({ state, actions }),
        settings: () => settingsView({ state, actions }),
    };

    mount(root,
        h("div", { class: state.view === "notes" ? "app" : "app wide-editor" },
            sidebar({ state, actions }),
            state.view === "notes" ? noteList({ state, actions }) : h("div"),
            (mainByView[state.view] || mainByView.notes)(),
        ),
    );
}

store.subscribe(render);

// Menu items, the tray and the global hotkey all arrive as commands.
api.onCommand(command => {
    switch (command) {
        case "new-note": actions.newNote(); break;
        case "quick-capture": actions.newNote("Quick note"); break;
        case "today": actions.openDaily(localDate()); break;
        case "save": actions.save(); break;
        case "save-as": actions.saveNoteAs(); break;
        case "export": actions.exportZip(); break;
        case "toggle-preview": actions.setPreview(!store.get().preview); break;
        case "focus-search": document.getElementById("search-input")?.focus(); break;
        case "view-notes": actions.setView("notes"); break;
        case "view-daily": actions.setView("daily"); break;
        case "view-templates": actions.setView("templates"); break;
        case "view-tags": actions.setView("tags"); break;
        case "view-trash": actions.setView("trash"); break;
        case "view-stats": actions.setView("stats"); break;
        case "view-sessions": actions.setView("sessions"); break;
        case "view-users": actions.setView("users"); break;
        case "view-shared": actions.setView("shared"); break;
        case "import": actions.importNotes(); break;
        case "insert-image": actions.insertImage(); break;
        case "view-settings": actions.setView("settings"); break;
        default: break;
    }
});

window.addEventListener("beforeunload", event => {
    if (isDirty(store.get())) event.preventDefault();
});

// Exposed for the self-test harness to drive the UI without a robot.
window.__greynote_test__ = { store, actions };

render(store.get());
actions.bootstrap();
