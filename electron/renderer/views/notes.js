import { h } from "../lib/dom.js";
import { formatStamp, rowPreview, splitSnippet, tagList } from "../lib/state.js";

/** A search snippet, with the server's match markers turned into <mark>. */
function snippet(text) {
    return splitSnippet(text).map(part =>
        part.match ? h("mark", null, part.text) : document.createTextNode(part.text)
    );
}

export function noteList({ state, actions }) {
    const rows = state.results ?? state.notes;

    return h("div.list-pane",
        h("div.list-toolbar",
            h("input", {
                type: "search",
                placeholder: "Search notes",
                value: state.search,
                id: "search-input",
                oninput: event => actions.setSearch(event.target.value),
            }),
            h("button", { title: "New note (Ctrl+N)", onClick: () => actions.newNote() }, "+"),
        ),

        state.offlineCache && h("div.banner.error.small", { style: { margin: "8px" } },
            h("div", "Showing the last notes saved on this computer — the server is not reachable."),
            h("button", { style: { marginTop: "6px" }, onClick: () => actions.retry() }, "Try again")),

        h("div.list-scroll",
            rows.length === 0
                ? h("div.empty", state.search ? "Nothing matched that search." : "No notes yet.")
                : rows.map(note => h("button.note-card", {
                    class: note.id === state.selectedId ? "selected" : "",
                    onClick: () => actions.openNote(note.id),
                },
                    h("div.title",
                        note.isPinned ? h("span", { title: "Pinned", style: { color: "var(--pin)" } }, "📌") : null,
                        h("span", null, note.title || "(untitled)"),
                    ),
                    h("div.snippet", note.snippet ? snippet(note.snippet) : rowPreview(note)),
                    h("div.meta",
                        note.folder ? h("span", null, `📁 ${note.folder}`) : null,
                        ...tagList(note.tags).slice(0, 4).map(tag => h("span.chip", null, `#${tag}`)),
                        h("span", null, formatStamp(note.updatedAt)),
                    ),
                )),
        ),

        !state.results && state.notes.length < state.total
            ? h("button.ghost", { style: { margin: "8px" }, onClick: () => actions.loadMore() },
                `Load more (${state.notes.length} of ${state.total})`)
            : null,
    );
}

export function sidebar({ state, actions }) {
    const navItem = (view, label, count) => h("button.nav-item", {
        class: state.view === view ? "active" : "",
        onClick: () => actions.setView(view),
    }, label, count !== undefined ? h("span.count", null, String(count)) : null);

    return h("div.sidebar",
        h("div.brand", "GreyNote"),
        navItem("notes", "Notes", state.total || undefined),
        navItem("daily", "Journal"),
        navItem("templates", "Templates"),
        navItem("tags", "Tags & folders"),
        navItem("trash", "Trash"),
        navItem("stats", "Statistics"),
        navItem("settings", "Settings"),

        state.folders.length > 0 && h("div.sidebar-heading", "Folders"),
        state.folders.length > 0 && h("button.nav-item", {
            class: state.folder === null ? "active" : "",
            onClick: () => actions.setFolder(null),
        }, "Any folder"),
        state.folders.length > 0 && h("button.nav-item", {
            class: state.folder === "" ? "active" : "",
            onClick: () => actions.setFolder(""),
        }, "Unfiled"),
        ...state.folders.map(folder => h("button.nav-item", {
            class: state.folder === folder.path ? "active" : "",
            onClick: () => actions.setFolder(folder.path),
        }, folder.path, h("span.count", null, String(folder.total)))),

        state.tags.length > 0 && h("div.sidebar-heading", "Tags"),
        ...state.tags.map(tag => h("button.nav-item", {
            class: state.tag === tag.name ? "active" : "",
            onClick: () => actions.setTag(state.tag === tag.name ? "" : tag.name),
        }, `#${tag.name}`, h("span.count", null, String(tag.count)))),
    );
}
