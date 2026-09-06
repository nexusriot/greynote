import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import Snippet from "./Snippet";

export default function CommandPalette({ onClose }) {
    const nav = useNavigate();
    const [query, setQuery] = useState("");
    const [notes, setNotes] = useState([]);
    const [hits, setHits] = useState(null); // server search results, null when idle
    const [loading, setLoading] = useState(true);
    const [index, setIndex] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
        (async () => {
            try {
                const ns = await apiFetch("/api/notes");
                setNotes(ns);
            } catch {}
            setLoading(false);
        })();
    }, []);

    // An empty query lists recent notes; anything else goes through the ranked
    // server-side search so the palette and the notes list agree.
    useEffect(() => {
        const q = query.trim();
        if (!q) { setHits(null); return; }

        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const res = await apiFetch(`/api/notes/search?q=${encodeURIComponent(q)}&limit=30`);
                if (!cancelled) setHits(res.results);
            } catch {
                if (!cancelled) setHits([]);
            }
        }, 150);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [query]);

    const results = hits ?? notes;

    useEffect(() => { setIndex(0); }, [query]);

    // Scroll selected item into view
    useEffect(() => {
        const el = listRef.current?.children[index];
        el?.scrollIntoView({ block: "nearest" });
    }, [index]);

    const select = useCallback((note) => {
        nav(`/notes/${note.id}`);
        onClose();
    }, [nav, onClose]);

    function onKeyDown(e) {
        if (e.key === "Escape") { onClose(); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); setIndex(i => Math.min(i + 1, results.length - 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
        if (e.key === "Enter" && results[index]) select(results[index]);
    }

    function highlight(text, q) {
        if (!q.trim()) return text;
        const idx = text.toLowerCase().indexOf(q.toLowerCase());
        if (idx === -1) return text;
        return (
            <>
                {text.slice(0, idx)}
                <mark style={{ background: "var(--color-accent)", color: "#fff", borderRadius: 2 }}>
                    {text.slice(idx, idx + q.length)}
                </mark>
                {text.slice(idx + q.length)}
            </>
        );
    }

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
                display: "flex", alignItems: "flex-start", justifyContent: "center",
                paddingTop: "10vh", zIndex: 1000,
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: "var(--color-bg)", border: "1px solid var(--color-border)",
                    borderRadius: 12, width: "100%", maxWidth: 580,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                    overflow: "hidden",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--color-border)", gap: 10 }}>
                    <span style={{ color: "var(--color-text-muted)", fontSize: 16 }}>⌕</span>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder="Jump to note..."
                        style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16 }}
                    />
                    <kbd style={{ fontSize: 11, opacity: 0.5, padding: "2px 5px", border: "1px solid var(--color-border)", borderRadius: 4 }}>Esc</kbd>
                </div>

                <div ref={listRef} style={{ maxHeight: 360, overflowY: "auto" }}>
                    {loading && (
                        <div style={{ padding: 16, color: "var(--color-text-muted)", fontSize: 13 }}>Loading...</div>
                    )}
                    {!loading && results.length === 0 && (
                        <div style={{ padding: 16, color: "var(--color-text-muted)", fontSize: 13 }}>No notes found.</div>
                    )}
                    {results.map((note, i) => (
                        <div
                            key={note.id}
                            onClick={() => select(note)}
                            style={{
                                padding: "10px 16px", cursor: "pointer",
                                background: i === index ? "var(--color-surface)" : "transparent",
                                borderBottom: "1px solid var(--color-border-light)",
                            }}
                        >
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                {note.isPinned && <span style={{ fontSize: 11, color: "var(--color-pin)" }}>📌</span>}
                                <span style={{ fontWeight: 500, fontSize: 14 }}>{highlight(note.title || "(untitled)", query)}</span>
                            </div>
                            {note.tags && (
                                <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
                                    {note.tags.split(",").map(t => t.trim()).filter(Boolean).map(t => (
                                        <span key={t} style={{ fontSize: 10, padding: "1px 5px", border: "1px solid var(--color-border)", borderRadius: 8 }}>
                                            #{t}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {(note.snippet || note.content) && (
                                <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {note.snippet
                                        ? <Snippet text={note.snippet} />
                                        : note.content.slice(0, 120)}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {!loading && (
                    <div style={{ padding: "6px 14px", borderTop: "1px solid var(--color-border)", fontSize: 11, color: "var(--color-text-muted)", display: "flex", gap: 12 }}>
                        <span>↑↓ navigate</span>
                        <span>↵ open</span>
                        <span>{results.length} {results.length === 1 ? "note" : "notes"}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
