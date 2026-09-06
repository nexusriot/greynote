import React from "react";

const BUTTONS = [
    { action: "bold", label: "B", title: "Bold (Ctrl+B)", style: { fontWeight: 800 } },
    { action: "italic", label: "I", title: "Italic (Ctrl+I)", style: { fontStyle: "italic" } },
    { action: "strike", label: "S", title: "Strikethrough", style: { textDecoration: "line-through" } },
    { action: "heading", label: "H", title: "Heading" },
    { action: "link", label: "🔗", title: "Link (Ctrl+K)" },
    { action: "code", label: "‹›", title: "Inline code" },
    { action: "codeblock", label: "{ }", title: "Code block" },
    { action: "quote", label: "❝", title: "Quote" },
    { action: "bullet", label: "•", title: "Bullet list" },
    { action: "task", label: "☑", title: "Task list" },
];

// EditorToolbar is deliberately markdown-native: it edits the text the user can
// still see, rather than replacing the textarea with a rich-text surface.
export default function EditorToolbar({ onAction, disabled }) {
    return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {BUTTONS.map(b => (
                <button
                    key={b.action}
                    type="button"
                    title={b.title}
                    disabled={disabled}
                    onMouseDown={e => e.preventDefault()} // keep the textarea selection
                    onClick={() => onAction(b.action)}
                    style={{
                        minWidth: 30, padding: "2px 6px", fontSize: 13, lineHeight: 1.4,
                        ...b.style,
                    }}
                >
                    {b.label}
                </button>
            ))}
        </div>
    );
}
