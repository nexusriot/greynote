import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, uploadFile } from "../api";
import Snippet from "../components/Snippet";

function fmt(dt) {
    try { return new Date(dt).toLocaleString(); } catch { return dt; }
}

function TagPills({ tags }) {
    if (!tags) return null;
    return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {tags.split(",").map(t => t.trim()).filter(Boolean).map(t => (
                <span key={t} style={{ fontSize: 11, padding: "1px 6px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                    #{t}
                </span>
            ))}
        </div>
    );
}

function NoteCard({ note, children }) {
    return (
        <Link
            to={`/notes/${note.id}`}
            style={{
                padding: 12,
                border: `1px solid var(--color-border)`,
                borderRadius: 8,
                textDecoration: "none",
                color: "inherit",
                display: "block",
            }}
        >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {note.isPinned && <span title="Pinned" style={{ color: "var(--color-pin)", fontSize: 13 }}>📌</span>}
                <div style={{ fontWeight: 700, flex: 1 }}>{note.title || "(untitled)"}</div>
            </div>

            <TagPills tags={note.tags} />

            <div style={{ opacity: 0.65, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 4, fontSize: 13 }}>
                {children}
            </div>

            <div style={{ display: "flex", gap: 12, color: "var(--color-text-muted)", fontSize: 11, marginTop: 6 }}>
                <span>Created: {fmt(note.createdAt)}</span>
                <span>Updated: {fmt(note.updatedAt)}</span>
            </div>
        </Link>
    );
}

export default function Notes() {
    const [notes, setNotes] = useState([]);
    const [tags, setTags] = useState([]);
    const [err, setErr] = useState("");
    const [info, setInfo] = useState("");
    const [search, setSearch] = useState("");
    const [results, setResults] = useState(null); // null = not searching
    const [searching, setSearching] = useState(false);
    const [params, setParams] = useSearchParams();
    const [activeTag, setActiveTagState] = useState(params.get("tag") || "");
    const [importing, setImporting] = useState(false);
    const importRef = useRef(null);
    const nav = useNavigate();

    // The active tag lives in the URL so tag links and the back button work.
    function setActiveTag(tag) {
        setActiveTagState(tag);
        setParams(tag ? { tag } : {}, { replace: true });
    }

    async function load(tag = activeTag) {
        setErr("");
        try {
            const query = tag ? `?tag=${encodeURIComponent(tag)}` : "";
            const [list, tagList] = await Promise.all([
                apiFetch(`/api/notes${query}`),
                apiFetch("/api/tags"),
            ]);
            setNotes(list);
            setTags(tagList);
        } catch (e) {
            setErr(e.message);
        }
    }

    useEffect(() => { load(activeTag); }, [activeTag]);

    // Full-text search runs on the server; an empty query falls back to the list.
    useEffect(() => {
        const q = search.trim();
        if (!q) { setResults(null); setSearching(false); return; }

        // cancelled guards against a slow earlier request landing after a newer
        // one and painting stale results.
        let cancelled = false;
        setSearching(true);
        const timer = setTimeout(async () => {
            try {
                const res = await apiFetch(`/api/notes/search?q=${encodeURIComponent(q)}`);
                if (!cancelled) setResults(res.results);
            } catch (e) {
                if (!cancelled) setErr(e.message);
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 200);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [search]);

    async function create() {
        setErr("");
        try {
            const res = await apiFetch("/api/notes", { method: "POST", body: { title: "New note", content: "", tags: "" } });
            nav(`/notes/${res.id}`);
        } catch (e) {
            setErr(e.message);
        }
    }

    async function exportAll() {
        setErr("");
        try {
            const res = await fetch("/api/notes/export", { credentials: "include" });
            if (!res.ok) throw new Error(`Export failed (${res.status})`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "notes-export.zip"; a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            setErr(e.message);
        }
    }

    async function importFile(file) {
        setErr("");
        setInfo("");
        setImporting(true);
        try {
            const res = await uploadFile("/api/notes/import", file);
            const parts = [`Imported ${res.imported} note${res.imported === 1 ? "" : "s"}`];
            if (res.skipped?.length) parts.push(`skipped ${res.skipped.length}`);
            setInfo(parts.join(" — "));
            await load(activeTag);
        } catch (e) {
            setErr(e.message);
        } finally {
            setImporting(false);
        }
    }

    // The tag filter narrows the list server-side; search results arrive ranked,
    // so they are shown in the order the server returned them.
    const pinned = useMemo(() => notes.filter(n => n.isPinned), [notes]);
    const unpinned = useMemo(() => notes.filter(n => !n.isPinned), [notes]);

    return (
        <div style={{ display: "grid", gap: 10 }}>
            <input
                ref={importRef}
                type="file"
                accept=".md,.markdown,.txt,.zip"
                style={{ display: "none" }}
                onChange={async e => {
                    const file = e.target.files?.[0];
                    if (file) await importFile(file);
                    e.target.value = "";
                }}
            />

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ flex: 1, margin: 0 }}>Your notes</h2>
                <button onClick={() => importRef.current?.click()} disabled={importing} title="Import .md files or a .zip archive" style={{ fontSize: 12 }}>
                    {importing ? "Importing..." : "↑ Import"}
                </button>
                {notes.length > 0 && (
                    <button onClick={exportAll} title="Download all notes as .zip" style={{ fontSize: 12 }}>
                        ↓ Export all
                    </button>
                )}
                <button onClick={create}>+ New</button>
            </div>

            {err && <div style={{ color: "var(--color-danger)" }}>{err}</div>}
            {info && <div style={{ color: "var(--color-accent)", fontSize: 13 }}>{info}</div>}

            <input
                placeholder="Search notes..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ padding: "6px 10px", width: "100%" }}
            />

            {tags.length > 0 && !results && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    <button
                        onClick={() => setActiveTag("")}
                        style={{ padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: activeTag === "" ? 700 : 400 }}
                    >
                        All
                    </button>
                    {tags.map(t => (
                        <button
                            key={t.name}
                            onClick={() => setActiveTag(activeTag === t.name ? "" : t.name)}
                            style={{
                                padding: "2px 10px",
                                borderRadius: 12,
                                fontSize: 12,
                                fontWeight: activeTag === t.name ? 700 : 400,
                                background: activeTag === t.name ? "var(--color-accent)" : "var(--color-surface)",
                                color: activeTag === t.name ? "#fff" : "inherit",
                                borderColor: activeTag === t.name ? "var(--color-accent)" : "var(--color-border)",
                            }}
                        >
                            #{t.name} <span style={{ opacity: 0.6 }}>{t.count}</span>
                        </button>
                    ))}
                </div>
            )}

            {results ? (
                <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
                        {searching ? "Searching..." : `${results.length} result${results.length === 1 ? "" : "s"}`}
                    </div>
                    {results.map(hit => (
                        <NoteCard key={hit.id} note={hit}>
                            <Snippet text={hit.snippet} />
                        </NoteCard>
                    ))}
                    {!searching && results.length === 0 && (
                        <div style={{ opacity: 0.6, textAlign: "center", padding: 24 }}>Nothing matched that search.</div>
                    )}
                </div>
            ) : (
                <div style={{ display: "grid", gap: 8 }}>
                    {pinned.length > 0 && (
                        <>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
                                Pinned
                            </div>
                            {pinned.map(n => <NoteCard key={n.id} note={n}>{n.content || <em>Empty note</em>}</NoteCard>)}
                            {unpinned.length > 0 && (
                                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>
                                    Notes
                                </div>
                            )}
                        </>
                    )}
                    {unpinned.map(n => <NoteCard key={n.id} note={n}>{n.content || <em>Empty note</em>}</NoteCard>)}
                    {notes.length === 0 && activeTag && (
                        <div style={{ opacity: 0.6, textAlign: "center", padding: 24 }}>No notes tagged #{activeTag}.</div>
                    )}
                    {notes.length === 0 && !activeTag && (
                        <div style={{ opacity: 0.6, textAlign: "center", padding: 24 }}>No notes yet. Create one!</div>
                    )}
                </div>
            )}
        </div>
    );
}
