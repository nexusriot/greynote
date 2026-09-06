import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { renderWikiLinks } from "../wikilinks";
import { slugify } from "../markdown";

// A task checkbox has no source position of its own, but its list item does —
// the item passes its line down so a click can rewrite the right line.
const TaskLineContext = createContext(null);

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

// Mermaid is loaded on demand: it is by far the heaviest dependency here and
// most notes never contain a diagram.
function MermaidBlock({ code }) {
    const [svg, setSvg] = useState("");
    const [err, setErr] = useState("");
    const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}`);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const mermaid = (await import("mermaid")).default;
                mermaid.initialize({
                    startOnLoad: false,
                    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
                });
                const { svg: rendered } = await mermaid.render(idRef.current, code);
                if (!cancelled) { setSvg(rendered); setErr(""); }
            } catch (e) {
                if (!cancelled) setErr(e.message || "Could not render this diagram");
            }
        })();
        return () => { cancelled = true; };
    }, [code]);

    if (err) {
        return (
            <div style={{ padding: 10, border: "1px solid var(--color-danger)", borderRadius: 6, fontSize: 12 }}>
                <div style={{ color: "var(--color-danger)", marginBottom: 6 }}>Diagram error: {err}</div>
                <pre style={{ margin: 0 }}>{code}</pre>
            </div>
        );
    }
    if (!svg) return <div style={{ fontSize: 12, opacity: 0.6 }}>Rendering diagram…</div>;

    // The SVG comes from mermaid's own renderer, not from user HTML.
    return <div style={{ textAlign: "center" }} dangerouslySetInnerHTML={{ __html: svg }} />;
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

// nodeText flattens a heading's inline markup so "## **Release** notes" gets the
// same anchor the outline computes from the source.
function nodeText(node) {
    if (!node) return "";
    if (node.value) return node.value;
    return (node.children || []).map(nodeText).join("");
}

function headingComponent(Tag) {
    return function Heading({ node, children, ...props }) {
        return <Tag id={slugify(nodeText(node))} {...props}>{children}</Tag>;
    };
}

export default function MarkdownRenderer({ children, wikiHref, onToggleTask }) {
    const text = wikiHref ? renderWikiLinks(children || "", wikiHref) : (children || "");

    const components = {
        pre: CopyablePre,
        a: AppLink,
        h1: headingComponent("h1"),
        h2: headingComponent("h2"),
        h3: headingComponent("h3"),
        h4: headingComponent("h4"),

        code({ node, className, children: codeChildren, ...props }) {
            if (/language-mermaid/.test(className || "")) {
                return <MermaidBlock code={String(codeChildren).replace(/\n$/, "")} />;
            }
            return <code className={className} {...props}>{codeChildren}</code>;
        },

        li({ node, children, ...props }) {
            const line = node?.position?.start?.line ?? null;
            return (
                <TaskLineContext.Provider value={line}>
                    <li {...props}>{children}</li>
                </TaskLineContext.Provider>
            );
        },

        input({ node, ...props }) {
            const line = useContext(TaskLineContext);
            if (props.type !== "checkbox" || !onToggleTask || line === null) {
                return <input {...props} readOnly />;
            }
            return (
                <input
                    type="checkbox"
                    checked={!!props.checked}
                    title="Toggle this task"
                    style={{ cursor: "pointer" }}
                    onChange={() => onToggleTask(line)}
                />
            );
        },
    };

    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeHighlight, rehypeKatex]}
            components={components}
        >
            {text}
        </ReactMarkdown>
    );
}
