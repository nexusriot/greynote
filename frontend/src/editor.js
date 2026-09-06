// Pure text transforms behind the editor toolbar and its Enter/Tab handling.
// Each returns the new text plus where the selection should end up, so the
// caller only has to write it back to the textarea.

// wrapSelection surrounds the selection with markers, or unwraps it when the
// markers are already there. With nothing selected it drops in a placeholder
// and selects it.
export function wrapSelection(text, start, end, marker, placeholder = "text") {
    const selected = text.slice(start, end);

    const before = text.slice(start - marker.length, start);
    const after = text.slice(end, end + marker.length);
    if (selected && before === marker && after === marker) {
        return {
            text: text.slice(0, start - marker.length) + selected + text.slice(end + marker.length),
            start: start - marker.length,
            end: end - marker.length,
        };
    }

    const body = selected || placeholder;
    return {
        text: text.slice(0, start) + marker + body + marker + text.slice(end),
        start: start + marker.length,
        end: start + marker.length + body.length,
    };
}

// lineBounds returns the start and end offsets of the lines the selection touches.
export function lineBounds(text, start, end) {
    const from = text.lastIndexOf("\n", start - 1) + 1;
    let to = text.indexOf("\n", end);
    if (to === -1) to = text.length;
    return { from, to };
}

// prefixLines adds (or removes, when every line already has it) a line prefix —
// used for headings, quotes and lists.
export function prefixLines(text, start, end, prefix) {
    const { from, to } = lineBounds(text, start, end);
    const block = text.slice(from, to);
    const lines = block.split("\n");

    const allPrefixed = lines.every(line => line.startsWith(prefix));
    const next = lines
        .map(line => (allPrefixed ? line.slice(prefix.length) : prefix + line))
        .join("\n");

    const delta = next.length - block.length;
    return {
        text: text.slice(0, from) + next + text.slice(to),
        start: from,
        end: to + delta,
    };
}

// insertLink wraps the selection as a markdown link and selects the URL slot.
export function insertLink(text, start, end) {
    const label = text.slice(start, end) || "text";
    const snippet = `[${label}](url)`;
    return {
        text: text.slice(0, start) + snippet + text.slice(end),
        start: start + snippet.length - 4,
        end: start + snippet.length - 1,
    };
}

export function insertCodeBlock(text, start, end) {
    const selected = text.slice(start, end);
    const snippet = "```\n" + (selected || "") + "\n```";
    return {
        text: text.slice(0, start) + snippet + text.slice(end),
        start: start + 4,
        end: start + 4 + selected.length,
    };
}

export const TOOLBAR_ACTIONS = {
    bold: (text, start, end) => wrapSelection(text, start, end, "**", "bold text"),
    italic: (text, start, end) => wrapSelection(text, start, end, "*", "italic text"),
    strike: (text, start, end) => wrapSelection(text, start, end, "~~", "struck out"),
    code: (text, start, end) => wrapSelection(text, start, end, "`", "code"),
    heading: (text, start, end) => prefixLines(text, start, end, "## "),
    quote: (text, start, end) => prefixLines(text, start, end, "> "),
    bullet: (text, start, end) => prefixLines(text, start, end, "- "),
    task: (text, start, end) => prefixLines(text, start, end, "- [ ] "),
    link: insertLink,
    codeblock: insertCodeBlock,
};

export function applyToolbarAction(action, text, start, end) {
    const fn = TOOLBAR_ACTIONS[action];
    return fn ? fn(text, start, end) : { text, start, end };
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s+(.*)$/;

// continueList implements Enter inside a list: it repeats the marker on the new
// line, numbers ordered lists, and clears the marker when the item was left
// empty (the usual way to end a list). Returns null when the caret is not in a
// list, so the caller can let the browser insert the newline itself.
export function continueList(text, caret) {
    const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
    const line = text.slice(lineStart, caret);

    const match = line.match(LIST_ITEM);
    if (!match) return null;

    const [, indent, marker, checkbox, body] = match;
    if (!body.trim()) {
        // Empty item: drop the marker instead of continuing the list.
        return { text: text.slice(0, lineStart) + text.slice(caret), caret: lineStart };
    }

    let nextMarker = marker;
    const ordered = marker.match(/^(\d+)([.)])$/);
    if (ordered) nextMarker = `${Number(ordered[1]) + 1}${ordered[2]}`;

    const insert = `\n${indent}${nextMarker}${checkbox ? " [ ]" : ""} `;
    return {
        text: text.slice(0, caret) + insert + text.slice(caret),
        caret: caret + insert.length,
    };
}

// indentSelection implements Tab / Shift+Tab over the selected lines.
export function indentSelection(text, start, end, outdent = false) {
    const unit = "  ";
    if (outdent) {
        const { from, to } = lineBounds(text, start, end);
        const block = text.slice(from, to);
        const next = block
            .split("\n")
            .map(line => (line.startsWith(unit) ? line.slice(unit.length) : line.replace(/^\s+/, "")))
            .join("\n");
        return { text: text.slice(0, from) + next + text.slice(to), start: from, end: from + next.length };
    }

    if (start === end) {
        return { text: text.slice(0, start) + unit + text.slice(end), start: start + unit.length, end: start + unit.length };
    }
    return prefixLines(text, start, end, unit);
}
