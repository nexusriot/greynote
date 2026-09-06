import React, { useRef } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import { renderWikiLinks } from "../wikilinks";

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

// AppLink keeps in-app destinations (wiki links) inside the router instead of
// reloading the page, and dims links that point at a note which does not exist.
// node is react-markdown's AST handle; it must not reach the DOM element.
function AppLink({ href, children, node, ...props }) {
    const nav = useNavigate();
    const internal = typeof href === "string" && href.startsWith("/");
    const unresolved = internal && href.startsWith("/new?");

    if (!internal) return <a href={href} {...props}>{children}</a>;

    return (
        <a
            href={href}
            title={unresolved ? "This note does not exist yet — click to create it" : undefined}
            style={unresolved ? { color: "var(--color-text-muted)", textDecoration: "underline dotted" } : undefined}
            onClick={e => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                nav(href);
            }}
            {...props}
        >
            {children}
        </a>
    );
}

export default function MarkdownRenderer({ children, wikiHref }) {
    const text = wikiHref ? renderWikiLinks(children || "", wikiHref) : (children || "");

    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{ pre: CopyablePre, a: AppLink }}
        >
            {text}
        </ReactMarkdown>
    );
}
