import { h } from "../lib/dom.js";
import {
    collapseUnchanged,
    diffLines,
    diffStats,
    extractHeadings,
    renderMarkdown,
    taskLineNumbers,
    taskStats,
} from "../lib/markdown.js";
import { formatStamp, isDirty } from "../lib/state.js";

/**
 * Renders the preview and wires the parts of it that are interactive: wiki
 * links, external links and task checkboxes.
 */
function preview({ state, actions }) {
    const content = state.draft?.content ?? "";
    const index = new Map((state.links?.outgoing || []).map(link => [link.title.toLowerCase(), link.id]));

    const html = renderMarkdown(content, title => {
        const id = index.get(title.toLowerCase());
        return id ? `gn://note/${id}` : `gn://new/${encodeURIComponent(title)}`;
    });

    const container = h("div.md");
    container.innerHTML = html;

    for (const anchor of container.querySelectorAll("a[href]")) {
        const href = anchor.getAttribute("href");
        if (href.startsWith("gn://note/")) {
            anchor.addEventListener("click", event => {
                event.preventDefault();
                actions.openNote(Number(href.slice("gn://note/".length)));
            });
        } else if (href.startsWith("gn://new/")) {
            anchor.classList.add("wiki-missing");
            anchor.title = "This note does not exist yet — click to create it";
            anchor.addEventListener("click", event => {
                event.preventDefault();
                actions.newNote(decodeURIComponent(href.slice("gn://new/".length)));
            });
        } else if (/^https?:/i.test(href)) {
            anchor.addEventListener("click", event => {
                event.preventDefault();
                window.greynote.desktop.openExternal(href);
            });
        }
    }

    // marked renders task checkboxes without their source position, so they are
    // matched against the task lines of the markdown in document order.
    const lines = taskLineNumbers(content);
    container.querySelectorAll('input[type="checkbox"]').forEach((box, i) => {
        box.disabled = false;
        box.addEventListener("change", () => actions.toggleTask(lines[i]));
    });

    return container;
}

function conflictBanner({ state, actions }) {
    const theirs = state.conflict;
    return h("div.banner.conflict",
        h("strong", null, "This note changed somewhere else"),
        h("p.small", null,
            `Another client saved it at ${formatStamp(theirs.updatedAt)}. Saving now would overwrite that version.`),
        h("pre.small", { style: { maxHeight: "140px", overflow: "auto" } }, theirs.content || "(empty)"),
        h("div.row",
            h("button.primary", { onClick: () => actions.save({ force: true }) }, "Overwrite with mine"),
            h("button", { onClick: () => actions.useServerVersion() }, "Discard mine, load theirs"),
        ),
    );
}

function outline({ state, actions }) {
    const headings = extractHeadings(state.draft?.content ?? "");
    if (headings.length === 0) return h("p.muted.small", null, "No headings yet.");

    const min = Math.min(...headings.map(item => item.level));
    return h("div", null, ...headings.map(item => h("button.ghost.small", {
        style: { display: "block", paddingLeft: `${(item.level - min) * 14}px`, textAlign: "left" },
        onClick: () => actions.jumpToLine(item.line),
    }, item.text)));
}

function versionPanel({ state, actions }) {
    if (!state.versions) return h("p.muted.small", null, "Loading history…");
    if (state.versions.length === 0) return h("p.muted.small", null, "No versions yet — each save creates one.");

    return h("div", null, ...state.versions.map(version => {
        const open = state.openVersion?.id === version.id;
        return h("div", { style: { borderTop: "1px solid var(--border)", padding: "6px 0" } },
            h("button.ghost", { onClick: () => actions.openVersion(version.id) },
                `${version.title || "(untitled)"} — ${formatStamp(version.savedAt)}`),
            open ? versionDiff(state, actions) : null,
        );
    }));
}

function versionDiff(state, actions) {
    const entries = diffLines(state.openVersion.content, state.draft?.content ?? "");
    const stats = diffStats(entries);

    return h("div", { style: { marginTop: "6px" } },
        h("div.row.small",
            h("span.muted", null, "Compared with the note as it is now:"),
            h("span", { style: { color: "var(--success)" } }, `+${stats.added}`),
            h("span", { style: { color: "var(--danger)" } }, `−${stats.removed}`),
        ),
        h("div.diff", ...collapseUnchanged(entries, 2).map(entry => {
            if (entry.type === "gap") {
                return h("div.gap", null, `⋯ ${entry.count} unchanged line${entry.count === 1 ? "" : "s"}`);
            }
            const marker = entry.type === "add" ? "+" : entry.type === "del" ? "−" : " ";
            return h(`div.${entry.type}`, null, `${marker} ${entry.text}`);
        })),
        h("button", { style: { marginTop: "6px" }, onClick: () => actions.restoreVersion() },
            "Restore this version"),
    );
}

function sharePanel({ state, actions }) {
    if (!state.note?.id) return null;

    return h("div.card",
        h("h3", null, "Sharing"),
        state.note.shareUrl
            ? h("div",
                h("code.small", null, state.note.shareUrl),
                h("div.row", { style: { marginTop: "6px" } },
                    h("button", { onClick: () => actions.copyShareLink() }, "Copy link"),
                    h("button", { onClick: () => actions.setSharePassword() },
                        state.note.sharePasswordSet ? "Change password" : "Set password"),
                    h("button.danger", { onClick: () => actions.disableShare() }, "Disable"),
                ),
                state.note.sharePasswordSet ? h("p.small.muted", null, "🔒 Password protected") : null,
            )
            : h("button", { onClick: () => actions.enableShare() }, "Create share link"),
    );
}

function linksPanel({ state, actions }) {
    const links = state.links;
    if (!links) return h("p.muted.small", null, "Loading links…");

    const unresolved = links.outgoing.filter(link => link.id === null);
    if (links.outgoing.length === 0 && links.backlinks.length === 0) {
        return h("p.muted.small", null, "No links yet — write [[Another note]] to link one.");
    }

    return h("div",
        links.backlinks.length > 0 && h("div",
            h("div.sidebar-heading", "Linked from"),
            ...links.backlinks.map(back => h("button.ghost", {
                style: { display: "block", textAlign: "left" },
                onClick: () => actions.openNote(back.id),
            }, back.title || "(untitled)")),
        ),
        links.outgoing.length > 0 && h("div",
            h("div.sidebar-heading", "Links to"),
            h("div.row.wrap", ...links.outgoing.map(link => h("button.ghost", {
                class: link.id === null ? "muted" : "",
                onClick: () => link.id === null ? actions.newNote(link.title) : actions.openNote(link.id),
            }, link.title))),
            unresolved.length > 0
                ? h("p.small.muted", null,
                    unresolved.length === 1
                        ? "1 link points at a note that does not exist yet."
                        : `${unresolved.length} links point at notes that do not exist yet.`)
                : null,
        ),
    );
}

export function editorPane({ state, actions }) {
    if (!state.note) {
        return h("div.main-pane", h("div.empty", "Select a note, or press Ctrl+N to write one."));
    }

    const dirty = isDirty(state);
    const tasks = taskStats(state.draft?.content ?? "");
    const words = (state.draft?.content ?? "").trim().split(/\s+/).filter(Boolean).length;

    return h("div.main-pane",
        h("div.toolbar",
            h("button", {
                class: dirty ? "primary" : "",
                onClick: () => actions.save(),
            }, dirty ? "Save *" : "Saved"),
            h("button", { onClick: () => actions.togglePin() },
                state.note.isPinned ? "📌 Pinned" : "Pin"),
            h("button", { onClick: () => actions.setPreview(!state.preview) },
                state.preview ? "Edit" : "Preview"),
            h("button", { onClick: () => actions.setSplit(!state.split) },
                state.split ? "Single pane" : "Split"),
            h("span.spacer"),
            h("button", { onClick: () => actions.saveNoteAs() }, "Save as…"),
            h("button.danger", { onClick: () => actions.trashNote() }, "Delete"),
        ),

        h("div", { class: state.split && !state.preview ? "pane-body split" : "pane-body" },
            h("div",
                state.conflict ? conflictBanner({ state, actions }) : null,
                state.error ? h("div.banner.error", null, state.error) : null,
                state.message ? h("div.banner.info", null, state.message) : null,

                h("input.editor-title", {
                    value: state.draft.title,
                    placeholder: "Note title",
                    oninput: event => actions.editDraft({ title: event.target.value }),
                }),

                h("div.editor-meta",
                    h("input", {
                        value: state.draft.tags,
                        placeholder: "tags, comma separated",
                        oninput: event => actions.editDraft({ tags: event.target.value }),
                    }),
                    h("input", {
                        value: state.draft.folder,
                        placeholder: "folder (e.g. Work/Projects)",
                        list: "folder-options",
                        oninput: event => actions.editDraft({ folder: event.target.value }),
                    }),
                    h("datalist", { id: "folder-options" },
                        ...state.folders.map(folder => h("option", { value: folder.path }))),
                ),

                h("div.row.small.muted",
                    h("span", null, `${words} word${words === 1 ? "" : "s"}`),
                    tasks.total > 0 ? h("span", null, `${tasks.done}/${tasks.total} tasks`) : null,
                    h("span", null, `Updated ${formatStamp(state.note.updatedAt)}`),
                ),

                state.preview
                    ? preview({ state, actions })
                    : h("textarea.editor", {
                        id: "editor-textarea",
                        value: state.draft.content,
                        placeholder: "Write in markdown…",
                        oninput: event => actions.editDraft({ content: event.target.value }),
                        onkeydown: event => actions.editorKeyDown(event),
                    }),
            ),

            state.split && !state.preview ? preview({ state, actions }) : null,
        ),

        h("div.pane-body", { style: { flex: "0 0 auto", maxHeight: "40%", borderTop: "1px solid var(--border)" } },
            h("div.card", h("h3", null, "Outline"), outline({ state, actions })),
            h("div.card", h("h3", null, "Links"), linksPanel({ state, actions })),
            sharePanel({ state, actions }),
            h("div.card", h("h3", null, "Version history"), versionPanel({ state, actions })),
        ),
    );
}
