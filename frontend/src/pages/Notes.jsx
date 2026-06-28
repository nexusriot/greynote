import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

function fmt(dt) {
    try { return new Date(dt).toLocaleString(); } catch { return dt; }
}

function NoteCard({ note }) {
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

            {note.tags && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                    {note.tags.split(",").map(t => t.trim()).filter(Boolean).map(t => (
                        <span key={t} style={{ fontSize: 11, padding: "1px 6px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                            #{t}
                        </span>
                    ))}
                </div>
            )}

            <div style={{ opacity: 0.65, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 4, fontSize: 13 }}>
                {note.content || <em>Empty note</em>}
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
    const [err, setErr] = useState("");
    const [search, setSearch] = useState("");
    const [activeTag, setActiveTag] = useState("");
    const nav = useNavigate();

    async function load() {
        setErr("");
        try {
            setNotes(await apiFetch("/api/notes"));
        } catch (e) {
            setErr(e.message);
        }
    }

    async function create() {
        setErr("");
        try {
            const res = await apiFetch("/api/notes", { method: "POST", body: { title: "New note", content: "", tags: "" } });
            nav(`/notes/${res.id}`);
        } catch (e) {
            setErr(e.message);
        }
    }

    useEffect(() => { load(); }, []);

    const allTags = useMemo(() => {
        const set = new Set();
        notes.forEach(n => {
            if (n.tags) n.tags.split(",").forEach(t => { const s = t.trim(); if (s) set.add(s); });
        });
        return [...set].sort();
    }, [notes]);

    const filtered = useMemo(() => {
        return notes.filter(n => {
            if (activeTag) {
                const noteTags = n.tags ? n.tags.split(",").map(t => t.trim()) : [];
                if (!noteTags.includes(activeTag)) return false;
            }
            if (search) {
                const q = search.toLowerCase();
                if (!n.title.toLowerCase().includes(q) && !n.content.toLowerCase().includes(q)) return false;
            }
            return true;
        });
    }, [notes, activeTag, search]);

    const pinned = filtered.filter(n => n.isPinned);
    const unpinned = filtered.filter(n => !n.isPinned);

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

    return (
        <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 style={{ flex: 1, margin: 0 }}>Your notes</h2>
                {notes.length > 0 && (
                    <button onClick={exportAll} title="Download all notes as .zip" style={{ fontSize: 12 }}>
                        ↓ Export all
                    </button>
                )}
                <button onClick={create}>+ New</button>
            </div>

            {err && <div style={{ color: "var(--color-danger)" }}>{err}</div>}

            <input
                placeholder="Search notes..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ padding: "6px 10px", width: "100%" }}
            />

            {allTags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    <button
                        onClick={() => setActiveTag("")}
                        style={{ padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: activeTag === "" ? 700 : 400 }}
                    >
                        All
                    </button>
                    {allTags.map(t => (
                        <button
                            key={t}
                            onClick={() => setActiveTag(activeTag === t ? "" : t)}
                            style={{
                                padding: "2px 10px",
                                borderRadius: 12,
                                fontSize: 12,
                                fontWeight: activeTag === t ? 700 : 400,
                                background: activeTag === t ? "var(--color-accent)" : "var(--color-surface)",
                                color: activeTag === t ? "#fff" : "inherit",
                                borderColor: activeTag === t ? "var(--color-accent)" : "var(--color-border)",
                            }}
                        >
                            #{t}
                        </button>
                    ))}
                </div>
            )}

            <div style={{ display: "grid", gap: 8 }}>
                {pinned.length > 0 && (
                    <>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
                            Pinned
                        </div>
                        {pinned.map(n => <NoteCard key={n.id} note={n} />)}
                        {unpinned.length > 0 && (
                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>
                                Notes
                            </div>
                        )}
                    </>
                )}
                {unpinned.map(n => <NoteCard key={n.id} note={n} />)}
                {filtered.length === 0 && notes.length > 0 && (
                    <div style={{ opacity: 0.6, textAlign: "center", padding: 24 }}>No notes match your filter.</div>
                )}
                {notes.length === 0 && (
                    <div style={{ opacity: 0.6, textAlign: "center", padding: 24 }}>No notes yet. Create one!</div>
                )}
            </div>
        </div>
    );
}
