import React, { useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

function CopyablePre({ children }) {
    const preRef = useRef(null);

    async function copy() {
        const text = preRef.current?.innerText ?? "";
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            prompt("Copy this code:", text);
        }
    }

    return (
        <div style={{ position: "relative" }}>
            <button
                onClick={copy}
                style={{
                    position: "absolute", top: 6, right: 6,
                    fontSize: 11, padding: "2px 8px", opacity: 0.65, zIndex: 1,
                }}
            >
                Copy
            </button>
            <pre ref={preRef}>{children}</pre>
        </div>
    );
}

export default function MarkdownRenderer({ children }) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{ pre: CopyablePre }}
        >
            {children}
        </ReactMarkdown>
    );
}
