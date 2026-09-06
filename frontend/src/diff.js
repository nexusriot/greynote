// Line diff used by the version history. A plain LCS is enough here: notes are
// small, and the output only has to show what a restore would change.

// lcsTable builds the classic dynamic-programming table of common line counts.
function lcsTable(a, b) {
    const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i][j] = a[i] === b[j]
                ? table[i + 1][j + 1] + 1
                : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    return table;
}

// diffLines returns one entry per line: "same", "del" (only in a) or "add"
// (only in b), in reading order.
export function diffLines(a, b) {
    // An empty document is zero lines, not one empty line, so creating a note
    // from nothing reads as a pure addition.
    const left = a ? a.split("\n") : [];
    const right = b ? b.split("\n") : [];
    const table = lcsTable(left, right);

    const out = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
        if (left[i] === right[j]) {
            out.push({ type: "same", text: left[i] });
            i++;
            j++;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            out.push({ type: "del", text: left[i] });
            i++;
        } else {
            out.push({ type: "add", text: right[j] });
            j++;
        }
    }
    while (i < left.length) out.push({ type: "del", text: left[i++] });
    while (j < right.length) out.push({ type: "add", text: right[j++] });

    return out;
}

export function diffStats(entries) {
    return {
        added: entries.filter(e => e.type === "add").length,
        removed: entries.filter(e => e.type === "del").length,
    };
}

// collapseUnchanged hides long runs of identical lines, keeping `context` lines
// of either side of each change.
export function collapseUnchanged(entries, context = 2) {
    const keep = new Array(entries.length).fill(false);
    entries.forEach((entry, i) => {
        if (entry.type === "same") return;
        for (let j = Math.max(0, i - context); j <= Math.min(entries.length - 1, i + context); j++) {
            keep[j] = true;
        }
    });

    const out = [];
    let skipped = 0;
    entries.forEach((entry, i) => {
        if (keep[i]) {
            if (skipped > 0) {
                out.push({ type: "gap", count: skipped });
                skipped = 0;
            }
            out.push(entry);
        } else {
            skipped++;
        }
    });
    if (skipped > 0) out.push({ type: "gap", count: skipped });

    return out;
}
