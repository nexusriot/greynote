import React, { useMemo } from "react";
import { extractHeadings } from "../markdown";

// Outline lists a note's headings. Clicking one scrolls the preview (or, while
// editing, jumps the textarea caret to that line).
export default function Outline({ content, onJump }) {
    const headings = useMemo(() => extractHeadings(content), [content]);

    if (headings.length === 0) {
        return (
            <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                No headings yet — start a line with <code>##</code> to build an outline.
            </div>
        );
    }

    const minLevel = Math.min(...headings.map(h => h.level));

    return (
        <nav style={{ display: "grid", gap: 2 }}>
            {headings.map(h => (
                <button
                    key={`${h.line}-${h.slug}`}
                    onClick={() => onJump(h)}
                    title={`Line ${h.line}`}
                    style={{
                        textAlign: "left",
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        padding: "2px 4px",
                        fontSize: 13,
                        color: "inherit",
                        opacity: h.level === minLevel ? 1 : 0.75,
                        fontWeight: h.level === minLevel ? 600 : 400,
                        paddingLeft: 4 + (h.level - minLevel) * 14,
                    }}
                >
                    {h.text}
                </button>
            ))}
        </nav>
    );
}
