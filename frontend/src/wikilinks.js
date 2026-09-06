// [[Wiki link]] support. The same rules the backend indexes with: links inside
// code fences or inline code are ignored, an optional `|alias` sets the label,
// and matching is case-insensitive.

const CODE_SEGMENT = /(```[\s\S]*?```|`[^`\n]*`)/g;
const WIKI_LINK = /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g;

// splitCode divides text into segments, flagging the ones that are code.
function splitCode(text) {
    const parts = [];
    let last = 0;
    for (const match of text.matchAll(CODE_SEGMENT)) {
        if (match.index > last) parts.push({ text: text.slice(last, match.index), code: false });
        parts.push({ text: match[0], code: true });
        last = match.index + match[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last), code: false });
    return parts;
}

// parseWikiLinks lists the link targets in a note, in order, without duplicates.
export function parseWikiLinks(text) {
    const out = [];
    const seen = new Set();
    for (const part of splitCode(text || "")) {
        if (part.code) continue;
        for (const match of part.text.matchAll(WIKI_LINK)) {
            const title = match[1].trim();
            if (!title || seen.has(title.toLowerCase())) continue;
            seen.add(title.toLowerCase());
            out.push(title);
        }
    }
    return out;
}

// escapeHref percent-encodes parentheses: an unbalanced one inside a markdown
// link destination ends the destination early and breaks the whole link.
function escapeHref(href) {
    return href.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

// escapeLabel keeps a bracket in the link text from opening a nested link.
function escapeLabel(label) {
    return label.replace(/\[/g, "\\[");
}

// renderWikiLinks rewrites [[Target]] into ordinary markdown links so the
// existing renderer can display them. hrefFor(title) supplies the destination.
export function renderWikiLinks(text, hrefFor) {
    return splitCode(text || "")
        .map(part => {
            if (part.code) return part.text;
            return part.text.replace(WIKI_LINK, (whole, rawTitle, alias) => {
                const title = rawTitle.trim();
                if (!title) return whole;
                const label = (alias ?? "").trim() || title;
                const href = hrefFor(title);
                if (!href) return label;
                return `[${escapeLabel(label)}](${escapeHref(href)})`;
            });
        })
        .join("");
}

// wikiLinkIndex maps lowercased titles to note ids for the links a note has.
export function wikiLinkIndex(outgoing) {
    const index = new Map();
    for (const link of outgoing || []) {
        index.set(link.title.toLowerCase(), link.id ?? null);
    }
    return index;
}
