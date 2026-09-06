import React from "react";

// The backend wraps search matches in control characters instead of HTML, so a
// snippet can never inject markup. splitSnippet turns them back into segments.
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

export default function Snippet({ text, style }) {
    return (
        <span style={style}>
            {splitSnippet(text).map((part, i) =>
                part.match
                    ? <mark key={i} style={{ background: "var(--color-accent)", color: "#fff", borderRadius: 2, padding: "0 2px" }}>{part.text}</mark>
                    : <React.Fragment key={i}>{part.text}</React.Fragment>
            )}
        </span>
    );
}
