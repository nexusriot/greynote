import { h } from "../lib/dom.js";
import { formatStamp, localDate } from "../lib/state.js";
import { renderMarkdown } from "../lib/markdown.js";

function pane(title, actions, ...children) {
    return h("div.main-pane",
        h("div.toolbar", h("strong", null, title), h("span.spacer"), ...actions),
        h("div.pane-body", ...children),
    );
}

export function trashView({ state, actions }) {
    const items = state.trash || [];

    return pane("Trash",
        [items.length > 0 && h("button.danger", { onClick: () => actions.emptyTrash() }, "Empty trash")],
        items.length === 0
            ? h("div.empty", "The trash is empty. Deleted notes land here first.")
            : items.map(item => h("div.card",
                h("div.row",
                    h("strong", null, item.title || "(untitled)"),
                    h("span.spacer"),
                    h("button", { onClick: () => actions.restoreNote(item.id) }, "Restore"),
                    h("button.danger", { onClick: () => actions.purgeNote(item) }, "Delete forever"),
                ),
                item.snippet ? h("p.small.muted", null, item.snippet) : null,
                h("p.small.muted", null,
                    `Deleted ${formatStamp(item.deletedAt)}` +
                    (item.purgeAt ? ` · purged after ${formatStamp(item.purgeAt)}` : "")),
            )),
    );
}

export function tagsView({ state, actions }) {
    const selected = state.tagSelection || [];

    return pane("Tags & folders", [],
        selected.length > 0 && h("div.card",
            h("h3", null, `Merge ${selected.map(tag => `#${tag}`).join(", ")} into:`),
            h("div.row",
                h("input", {
                    id: "merge-target",
                    placeholder: "target tag",
                    value: state.mergeInto || "",
                    oninput: event => actions.setMergeTarget(event.target.value),
                }),
                h("button.primary", { onClick: () => actions.mergeTags() }, "Merge"),
                h("button", { onClick: () => actions.clearTagSelection() }, "Cancel"),
            ),
        ),

        h("div.card",
            h("h3", null, "Tags"),
            state.tags.length === 0
                ? h("p.muted.small", null, "No tags yet.")
                : state.tags.map(tag => h("div.row", { style: { padding: "4px 0" } },
                    h("input", {
                        type: "checkbox",
                        checked: selected.includes(tag.name),
                        onchange: () => actions.toggleTagSelection(tag.name),
                    }),
                    h("strong", null, `#${tag.name}`),
                    h("span.muted.small", null, `${tag.count}`),
                    h("span.spacer"),
                    h("button", { onClick: () => actions.renameTag(tag.name) }, "Rename"),
                    h("button.danger", { onClick: () => actions.removeTag(tag.name) }, "Remove"),
                )),
        ),

        h("div.card",
            h("h3", null, "Folders"),
            state.folders.length === 0
                ? h("p.muted.small", null, "No folders yet.")
                : state.folders.map(folder => h("div.row", { style: { padding: "4px 0" } },
                    h("strong", null, `📁 ${folder.path}`),
                    h("span.muted.small", null, `${folder.total}`),
                    h("span.spacer"),
                    h("button", { onClick: () => actions.renameFolder(folder.path) }, "Move"),
                    h("button.danger", { onClick: () => actions.removeFolder(folder.path) }, "Remove"),
                )),
        ),
    );
}

export function templatesView({ state, actions }) {
    const draft = state.templateDraft;

    return pane("Templates",
        [!draft && h("button.primary", { onClick: () => actions.newTemplate() }, "+ New template")],

        draft && h("div.card",
            h("h3", null, draft.id ? "Edit template" : "New template"),
            h("input", {
                placeholder: "Template name",
                value: draft.name,
                oninput: event => actions.editTemplate({ name: event.target.value }),
            }),
            h("input", {
                style: { marginTop: "6px" },
                placeholder: "Note title, e.g. Meeting {{date}}",
                value: draft.title,
                oninput: event => actions.editTemplate({ title: event.target.value }),
            }),
            h("textarea", {
                style: { marginTop: "6px", width: "100%", minHeight: "140px" },
                placeholder: "Note body…",
                value: draft.content,
                oninput: event => actions.editTemplate({ content: event.target.value }),
            }),
            h("div.row", { style: { marginTop: "6px" } },
                h("input", {
                    placeholder: "tags",
                    value: draft.tags,
                    oninput: event => actions.editTemplate({ tags: event.target.value }),
                }),
                h("input", {
                    placeholder: "folder",
                    value: draft.folder,
                    oninput: event => actions.editTemplate({ folder: event.target.value }),
                }),
            ),
            h("label.row.small", { style: { marginTop: "6px" } },
                h("input", {
                    type: "checkbox",
                    checked: draft.isDaily,
                    onchange: event => actions.editTemplate({ isDaily: event.target.checked }),
                }),
                "Use for daily notes (only one template can hold this)",
            ),
            h("p.small.muted", null,
                "Placeholders: {{date}} {{time}} {{datetime}} {{weekday}} {{month}} {{year}} {{title}}"),
            h("div.row",
                h("button.primary", { onClick: () => actions.saveTemplate() }, "Save template"),
                h("button", { onClick: () => actions.cancelTemplate() }, "Cancel"),
            ),
        ),

        (state.templates || []).length === 0 && !draft
            ? h("div.empty", "No templates yet. Create one to start notes from a fixed shape.")
            : (state.templates || []).map(template => h("div.card",
                h("div.row",
                    h("strong", null, template.name),
                    template.isDaily ? h("span.chip", null, "daily") : null,
                    h("span.spacer"),
                    h("button.primary", { onClick: () => actions.useTemplate(template.id) }, "Use"),
                    h("button", { onClick: () => actions.editTemplateRecord(template) }, "Edit"),
                    h("button.danger", { onClick: () => actions.deleteTemplate(template) }, "Delete"),
                ),
                template.title ? h("p.small.muted", null, `Title: ${template.title}`) : null,
                template.content ? h("pre.small", { style: { maxHeight: "120px", overflow: "auto" } }, template.content) : null,
            )),
    );
}

export function dailyView({ state, actions }) {
    const entries = state.dailyEntries || [];
    const note = state.dailyNote;

    return pane("Journal",
        [h("button.primary", { onClick: () => actions.openDaily(state.dailyDate) },
            note ? "Open in editor" : "Create entry")],

        h("div.row", { style: { marginBottom: "10px" } },
            h("button", { onClick: () => actions.shiftDailyDate(-1) }, "←"),
            h("input", {
                type: "date",
                value: state.dailyDate || localDate(),
                max: localDate(),
                onchange: event => event.target.value && actions.setDailyDate(event.target.value),
            }),
            h("button", {
                disabled: (state.dailyDate || localDate()) === localDate(),
                onClick: () => actions.shiftDailyDate(1),
            }, "→"),
            h("button", { onClick: () => actions.setDailyDate(localDate()) }, "Today"),
        ),

        h("div.card",
            note
                ? h("div", h("strong", null, note.title), previewBlock(note.content))
                : h("p.muted", null,
                    `Nothing written for ${state.dailyDate || localDate()} yet. Creating an entry uses your daily template if you have one.`),
        ),

        entries.length > 0 && h("div.card",
            h("h3", null, "Recent entries"),
            h("div.row.wrap", ...entries.slice(0, 40).map(entry => h("button.ghost", {
                class: entry.date === state.dailyDate ? "primary" : "",
                onClick: () => actions.setDailyDate(entry.date),
            }, entry.date))),
        ),
    );
}

function previewBlock(content) {
    const container = h("div.md");
    container.innerHTML = renderMarkdown(content || "");
    return container;
}

export function statsView({ state }) {
    const stats = state.stats;
    if (!stats) return pane("Statistics", [], h("div.empty", "Loading…"));

    const maxMonth = Math.max(1, ...stats.notesPerMonth.map(month => month.count));

    return pane("Statistics", [],
        h("div.card",
            h("h3", null, `${stats.totalNotes} notes`),
            h("p", null, `${stats.totalWords} words in total`),
            stats.totalNotes > 0
                ? h("p.muted", null, `${Math.round(stats.totalWords / stats.totalNotes)} words per note on average`)
                : null,
        ),

        stats.topTags.length > 0 && h("div.card",
            h("h3", null, "Most used tags"),
            ...stats.topTags.slice(0, 12).map(tag => h("div.row",
                h("span", null, `#${tag.tag}`),
                h("span.spacer"),
                h("span.muted", null, String(tag.count)),
            )),
        ),

        stats.notesPerMonth.length > 0 && h("div.card",
            h("h3", null, "Notes per month"),
            ...stats.notesPerMonth.slice(-12).map(month => h("div.row",
                h("span.small", { style: { width: "70px" } }, month.month),
                h("span", {
                    style: {
                        background: "var(--accent)",
                        height: "10px",
                        borderRadius: "3px",
                        width: `${Math.round((month.count / maxMonth) * 60)}%`,
                    },
                }),
                h("span.small.muted", null, String(month.count)),
            )),
        ),
    );
}

export function settingsView({ state, actions }) {
    const settings = state.settings || {};

    return pane("Settings", [],
        state.message ? h("div.banner.info", null, state.message) : null,
        state.error ? h("div.banner.error", null, state.error) : null,

        h("div.card",
            h("h3", null, "Server"),
            h("div.row",
                h("input", {
                    id: "server-url",
                    style: { flex: "1" },
                    value: settings.serverUrl || "",
                    oninput: event => actions.editSetting({ serverUrl: event.target.value }),
                }),
                h("button.primary", { onClick: () => actions.saveServerUrl() }, "Save"),
            ),
            h("p.small.muted", null, `Signed in as ${state.me?.email || "—"}`),
            h("button", { onClick: () => actions.logout() }, "Log out"),
        ),

        h("div.card",
            h("h3", null, "Appearance"),
            h("div.row",
                ...["system", "light", "dark"].map(theme => h("button", {
                    class: settings.theme === theme ? "primary" : "",
                    onClick: () => actions.setTheme(theme),
                }, theme)),
            ),
        ),

        h("div.card",
            h("h3", null, "Quick capture"),
            h("p.small.muted", null,
                "A global shortcut opens GreyNote with a fresh note, even when the window is hidden."),
            h("div.row",
                h("input", {
                    value: settings.quickCaptureShortcut || "",
                    placeholder: "CommandOrControl+Shift+N",
                    oninput: event => actions.editSetting({ quickCaptureShortcut: event.target.value }),
                }),
                h("button", { onClick: () => actions.saveShortcut() }, "Save shortcut"),
            ),
        ),

        h("div.card",
            h("h3", null, "Notes"),
            h("div.row",
                h("button", { onClick: () => actions.exportZip() }, "Export all notes as .zip"),
                h("button", { onClick: () => actions.importNotes() }, "Import .md or .zip…"),
            ),
            state.importReport ? importReport(state.importReport) : null,
        ),

        h("div.card",
            h("h3", null, "Password"),
            h("div.row",
                h("input", {
                    type: "password",
                    placeholder: "current password",
                    value: settings.currentPassword || "",
                    oninput: event => actions.editSetting({ currentPassword: event.target.value }),
                }),
                h("input", {
                    type: "password",
                    placeholder: "new password (min 6)",
                    value: settings.newPassword || "",
                    oninput: event => actions.editSetting({ newPassword: event.target.value }),
                }),
                h("button.primary", { onClick: () => actions.changePassword() }, "Change"),
            ),
        ),

        h("div.card",
            h("h3", null, "About"),
            h("p.small.muted", null, `Desktop ${state.appVersion || "—"} · server ${state.serverVersion || "—"}`),
        ),

        h("div.card",
            h("h3", null, "Close account"),
            h("p.small.muted", null,
                "This deletes the account and every note in it, on the server, for good."),
            h("div.row",
                h("input", {
                    type: "password",
                    placeholder: "confirm with your password",
                    value: settings.closePassword || "",
                    oninput: event => actions.editSetting({ closePassword: event.target.value }),
                }),
                h("button.danger", { onClick: () => actions.closeAccount() }, "Delete my account"),
            ),
        ),
    );
}

function importReport(report) {
    return h("div", { style: { marginTop: "8px" } },
        h("p.small", null,
            `Imported ${report.imported} note${report.imported === 1 ? "" : "s"}` +
            (report.skipped?.length ? `, skipped ${report.skipped.length}` : "")),
        ...(report.skipped || []).slice(0, 8).map(skip =>
            h("p.small.muted", null, `${skip.name}: ${skip.reason}`)),
    );
}

export function sessionsView({ state, actions }) {
    const sessions = state.sessions || [];

    return pane("Sessions", [h("button", { onClick: () => actions.loadSessions() }, "Refresh")],
        state.message ? h("div.banner.info", null, state.message) : null,
        state.error ? h("div.banner.error", null, state.error) : null,

        h("p.small.muted", null,
            "Every browser, phone and computer signed in to this account. Revoking one signs it out."),

        sessions.length === 0
            ? h("div.empty", "No sessions listed.")
            : sessions.map(item => h("div.card",
                h("div.row",
                    h("strong", null, item.isCurrent ? "This computer" : `Session ${item.id}`),
                    item.isCurrent ? h("span.chip", null, "current") : null,
                    h("span.spacer"),
                    h("button.danger", { onClick: () => actions.revokeSession(item) },
                        item.isCurrent ? "Sign out here" : "Revoke"),
                ),
                h("p.small.muted", null,
                    `Signed in ${formatStamp(item.createdAt)} · expires ${formatStamp(item.expiresAt)}`),
            )),
    );
}

export function usersView({ state, actions }) {
    const users = state.users || [];
    const draft = state.userDraft || {};

    return pane("Users", [h("button", { onClick: () => actions.loadUsers() }, "Refresh")],
        state.message ? h("div.banner.info", null, state.message) : null,
        state.error ? h("div.banner.error", null, state.error) : null,

        h("div.card",
            h("h3", null, "Add a user"),
            h("div.row",
                h("input", {
                    placeholder: "email",
                    value: draft.email || "",
                    oninput: event => actions.editUserDraft({ email: event.target.value }),
                }),
                h("input", {
                    type: "password",
                    placeholder: "password (min 6)",
                    value: draft.password || "",
                    oninput: event => actions.editUserDraft({ password: event.target.value }),
                }),
                h("label.row.small",
                    h("input", {
                        type: "checkbox",
                        checked: Boolean(draft.isAdmin),
                        onchange: event => actions.editUserDraft({ isAdmin: event.target.checked }),
                    }),
                    "admin",
                ),
                h("button.primary", { onClick: () => actions.createUser() }, "Create"),
            ),
        ),

        users.length === 0
            ? h("div.empty", "No users listed.")
            : users.map(user => h("div.card",
                h("div.row",
                    h("strong", null, user.email),
                    user.isAdmin ? h("span.chip", null, "admin") : null,
                    user.id === state.me?.userId ? h("span.chip", null, "you") : null,
                    h("span.spacer"),
                    h("button", { onClick: () => actions.toggleUserAdmin(user) },
                        user.isAdmin ? "Remove admin" : "Make admin"),
                    h("button.danger", { onClick: () => actions.deleteUser(user) }, "Delete"),
                ),
                h("p.small.muted", null, `Joined ${formatStamp(user.createdAt)}`),
            )),
    );
}

// A note someone shared by link, read without signing in as them.
export function sharedView({ state, actions }) {
    const shared = state.sharedNote;

    return pane("Shared link", [],
        state.error ? h("div.banner.error", null, state.error) : null,

        h("div.card",
            h("h3", null, "Open a link someone sent you"),
            h("div.row",
                h("input", {
                    style: { flex: "1" },
                    placeholder: "share link or token",
                    value: state.sharedToken || "",
                    oninput: event => actions.editShared({ sharedToken: event.target.value }),
                }),
                h("input", {
                    type: "password",
                    placeholder: "password, if it needs one",
                    value: state.sharedPassword || "",
                    oninput: event => actions.editShared({ sharedPassword: event.target.value }),
                }),
                h("button.primary", { onClick: () => actions.openSharedLink() }, "Open"),
            ),
        ),

        shared && h("div.card",
            h("div.row",
                h("strong", null, shared.title || "(untitled)"),
                h("span.spacer"),
                h("span.small.muted", null, `Updated ${formatStamp(shared.updatedAt)}`),
            ),
            shared.tags
                ? h("div.row.wrap", ...shared.tags.split(",").filter(Boolean)
                    .map(tag => h("span.chip", null, `#${tag}`)))
                : null,
            previewBlock(shared.content),
        ),
    );
}
