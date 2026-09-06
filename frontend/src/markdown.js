// Pure markdown helpers shared by the editor, the outline and the preview.

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

// toggleTaskAtLine flips the checkbox on a 1-based source line. Returns the
// original text unchanged when that line is not a task item, so a stray click
// can never rewrite the note.
export function toggleTaskAtLine(markdown, line) {
    const lines = (markdown || "").split("\n");
    const index = line - 1;
    if (index < 0 || index >= lines.length) return markdown;

    const match = lines[index].match(TASK_LINE);
    if (!match) return markdown;

    const checked = match[2].toLowerCase() === "x";
    lines[index] = lines[index].replace(TASK_LINE, `$1${checked ? " " : "x"}$3`);
    return lines.join("\n");
}

// taskStats counts checkboxes so the editor can show progress.
export function taskStats(markdown) {
    let total = 0;
    let done = 0;
    for (const line of (markdown || "").split("\n")) {
        const match = line.match(TASK_LINE);
        if (!match) continue;
        total++;
        if (match[2].toLowerCase() === "x") done++;
    }
    return { total, done };
}

export function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
}

// extractHeadings reads the ATX headings of a note for the outline panel. Code
// fences are skipped so a commented "# heading" does not appear.
export function extractHeadings(markdown) {
    const out = [];
    let inFence = false;
    const lines = (markdown || "").split("\n");

    lines.forEach((raw, i) => {
        if (/^\s*(```|~~~)/.test(raw)) {
            inFence = !inFence;
            return;
        }
        if (inFence) return;

        const match = raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (!match) return;

        const text = match[2].trim();
        if (!text) return;
        out.push({ level: match[1].length, text, slug: slugify(text), line: i + 1 });
    });

    return out;
}
