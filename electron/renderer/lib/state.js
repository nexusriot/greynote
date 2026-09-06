// Application state and the rules around it. Kept free of DOM references so the
// interesting decisions can be tested without a window.

export function createState(initial = {}) {
    let value = {
        view: "notes",          // notes | daily | templates | tags | trash | stats | settings | login
        notes: [],
        total: 0,
        selectedId: null,
        note: null,             // the note open in the editor
        draft: null,            // unsaved edits: { title, content, tags, folder }
        conflict: null,         // the server's copy after a rejected save
        search: "",
        results: null,          // search hits, null when not searching
        tag: "",
        folder: null,
        tags: [],
        folders: [],
        preview: false,
        online: true,
        offlineCache: false,    // showing notes from disk rather than the server
        error: null,
        message: null,
        me: null,
        ...initial,
    };

    const listeners = new Set();

    return {
        get: () => value,
        set(patch) {
            value = { ...value, ...patch };
            for (const listener of listeners) listener(value);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

/** True when the editor holds changes that have not been saved. */
export function isDirty(state) {
    if (!state.note || !state.draft) return false;
    return (
        state.draft.title !== state.note.title ||
        state.draft.content !== state.note.content ||
        state.draft.tags !== (state.note.tags || "") ||
        state.draft.folder !== (state.note.folder || "")
    );
}

export function draftFrom(note) {
    return {
        title: note?.title ?? "",
        content: note?.content ?? "",
        tags: note?.tags ?? "",
        folder: note?.folder ?? "",
    };
}

/**
 * Builds the query for the note list from the active filters. A folder of ""
 * means "unfiled", which is different from no folder filter at all (null).
 */
export function listFilters(state, { limit = 100, offset = 0 } = {}) {
    const filters = { limit, offset };
    if (state.tag) filters.tag = state.tag;
    if (state.folder !== null && state.folder !== undefined) {
        filters.folder = state.folder;
        if (state.folder !== "") filters.recursive = true;
    }
    return filters;
}

/** Splits a note's tag string the way the server normalises it. */
export function tagList(tags) {
    return (tags || "")
        .split(",")
        .map(tag => tag.trim())
        .filter(Boolean);
}

/**
 * Decides what to show for a note row: the search snippet when searching, the
 * list snippet otherwise, and a hint when the note is empty.
 */
export function rowPreview(note) {
    const text = (note.snippet || note.content || "").replace(/\s+/g, " ").trim();
    return text || "Empty note";
}

/** Highlight markers the server wraps search matches in. */
export const HIGHLIGHT_START = "\u0001";
export const HIGHLIGHT_END = "\u0002";

export function splitSnippet(snippet) {
    const out = [];
    let rest = snippet || "";
    while (rest) {
        const start = rest.indexOf(HIGHLIGHT_START);
        if (start < 0) {
            out.push({ text: rest, match: false });
            break;
        }
        if (start > 0) out.push({ text: rest.slice(0, start), match: false });

        const end = rest.indexOf(HIGHLIGHT_END, start);
        if (end < 0) {
            out.push({ text: rest.slice(start + 1), match: true });
            break;
        }
        out.push({ text: rest.slice(start + 1, end), match: true });
        rest = rest.slice(end + 1);
    }
    return out.filter(part => part.text !== "");
}

/** YYYY-MM-DD in the user's own timezone — the journal is a local-day concept. */
export function localDate(date = new Date()) {
    return date.toLocaleDateString("en-CA");
}

export function formatStamp(value) {
    if (!value) return "";
    try {
        return new Date(value).toLocaleString();
    } catch {
        return value;
    }
}
