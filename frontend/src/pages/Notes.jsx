import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, apiFetchWithMeta, uploadFile } from "../api";
import Snippet from "../components/Snippet";

const PAGE_SIZE = 50;

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
                {note.folder && (
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>📁 {note.folder}</span>
                )}
            </div>

            <TagPills tags={note.tags} />

            <div style={{ opacity: 0.65, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 4, fontSize: 13 }}>
                {note.snippet ? <Snippet text={note.snippet} /> : <em>Empty note</em>}
            </div>

            <div style={{ display: "flex", gap: 12, color: "var(--color-text-muted)", fontSize: 11, marginTop: 6 }}>
                <span>Created: {fmt(note.createdAt)}</span>
                <span>Updated: {fmt(note.updatedAt)}</span>
            </div>
        </Link>
    );
}

// FolderBar shows the folder tree as chips, plus rename/remove for the folder
// currently in view.
function FolderBar({ folders, active, onSelect, onRename, onRemove }) {
    if (folders.length === 0) return null;

    return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>📁</span>
            <button
                onClick={() => onSelect(null)}
                style={{ padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: active === null ? 700 : 400 }}
            >
                Any
            </button>
            <button
                onClick={() => onSelect("")}
                style={{ padding: "2px 10px", borderRadius: 12, fontSize: 12, fontWeight: active === "" ? 700 : 400 }}
                title="Notes that are not in a folder"
            >
                Unfiled
            </button>
            {folders.map(f => (
                <button
                    key={f.path}
                    onClick={() => onSelect(f.path)}
                    title={`${f.total} note${f.total === 1 ? "" : "s"} including subfolders`}
                    style={{
                        padding: "2px 10px",
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: active === f.path ? 700 : 400,
                        background: active === f.path ? "var(--color-accent)" : "var(--color-surface)",
                        color: active === f.path ? "#fff" : "inherit",
                        borderColor: active === f.path ? "var(--color-accent)" : "var(--color-border)",
                    }}
                >
                    {f.path} <span style={{ opacity: 0.6 }}>{f.total}</span>
                </button>
            ))}
            {active && (
                <>
                    <button onClick={onRename} style={{ fontSize: 11, padding: "2px 8px" }}>Rename folder</button>
                    <button onClick={onRemove} style={{ fontSize: 11, padding: "2px 8px", color: "var(--color-danger)" }}>
                        Remove folder
                    </button>
                </>
            )}
        </div>
    );
}

export default function Notes() {
    const [notes, setNotes] = useState([]);
    const [total, setTotal] = useState(0);
    const [tags, setTags] = useState([]);
    const [folders, setFolders] = useState([]);
    const [err, setErr] = useState("");
    const [info, setInfo] = useState("");
    const [search, setSearch] = useState("");
    const [results, setResults] = useState(null); // null = not searching
    const [searching, setSearching] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [params, setParams] = useSearchParams();
    const [activeTag, setActiveTagState] = useState(params.get("tag") || "");
    const [activeFolder, setActiveFolderState] = useState(params.get("folder"));
    const [importing, setImporting] = useState(false);
    const importRef = useRef(null);
    const nav = useNavigate();

    // Filters live in the URL so links, reloads and the back button all work.
    const syncParams = useCallback((tag, folder) => {
        const next = {};
        if (tag) next.tag = tag;
        if (folder !== null && folder !== undefined) next.folder = folder;
        setParams(next, { replace: true });
    }, [setParams]);

    function setActiveTag(tag) {
        setActiveTagState(tag);
        syncParams(tag, activeFolder);
    }

    function setActiveFolder(folder) {
        setActiveFolderState(folder);
        syncParams(activeTag, folder);
    }

    const listQuery = useCallback((offset) => {
        const parts = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
        if (activeTag) parts.push(`tag=${encodeURIComponent(activeTag)}`);
        if (activeFolder !== null && activeFolder !== undefined) {
            parts.push(`folder=${encodeURIComponent(activeFolder)}`);
            if (activeFolder !== "") parts.push("recursive=1");
        }
        return `/api/notes?${parts.join("&")}`;
    }, [activeTag, activeFolder]);

    const load = useCallback(async () => {
        setErr("");
        try {
            const [list, tagList, folderList] = await Promise.all([
                apiFetchWithMeta(listQuery(0)),
                apiFetch("/api/tags"),
                apiFetch("/api/folders"),
            ]);
            setNotes(list.data);
            setTotal(Number(list.headers.get("X-Total-Count") || list.data.length));
            setTags(tagList);
            setFolders(folderList);
        } catch (e) {
            setErr(e.message);
        }
    }, [listQuery]);

    useEffect(() => { load(); }, [load]);

    async function loadMore() {
        setLoadingMore(true);
        try {
            const more = await apiFetchWithMeta(listQuery(notes.length));
            setNotes(current => [...current, ...more.data]);
        } catch (e) {
            setErr(e.message);
        } finally {
            setLoadingMore(false);
        }
    }

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
            const res = await apiFetch("/api/notes", {
                method: "POST",
                body: { title: "New note", content: "", tags: "", folder: activeFolder || "" },
            });
            nav(`/notes/${res.id}`);
        } catch (e) {
            setErr(e.message);
        }
    }

    async function openToday() {
        setErr("");
        try {
            const res = await apiFetch("/api/notes/daily", {
                method: "POST",
                body: { date: new Date().toLocaleDateString("en-CA") },
            });
            nav(`/notes/${res.id}`);
        } catch (e) { setErr(e.message); }
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
            await load();
        } catch (e) {
            setErr(e.message);
        } finally {
            setImporting(false);
        }
    }

    async function renameFolder() {
        const to = prompt(`Rename "${activeFolder}" to:`, activeFolder);
        if (to === null || to.trim() === activeFolder) return;
        setErr("");
        try {
            const res = await apiFetch("/api/folders", { method: "PUT", body: { from: activeFolder, to } });
            setActiveFolder(res.path || null);
            await load();
        } catch (e) { setErr(e.message); }
    }

    async function removeFolder() {
        if (!confirm(`Remove the "${activeFolder}" folder? Its notes move to Unfiled — nothing is deleted.`)) return;
        setErr("");
        try {
            await apiFetch(`/api/folders?path=${encodeURIComponent(activeFolder)}`, { method: "DELETE" });
            setActiveFolder(null);
            await load();
        } catch (e) { setErr(e.message); }
    }

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
                <button onClick={openToday} title="Open today's journal entry" style={{ fontSize: 12 }}>
                    ☀ Today
                </button>
                <button onClick={() => importRef.current?.click()} disabled={importing} title="Import .md files or a .zip archive" style={{ fontSize: 12 }}>
                    {importing ? "Importing..." : "↑ Import"}
                </button>
                {total > 0 && (
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

            {!results && (
                <FolderBar
                    folders={folders}
                    active={activeFolder}
                    onSelect={setActiveFolder}
                    onRename={renameFolder}
                    onRemove={removeFolder}
                />
            )}

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
                    {results.map(hit => <NoteCard key={hit.id} note={hit} />)}
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
                            {pinned.map(n => <NoteCard key={n.id} note={n} />)}
                            {unpinned.length > 0 && (
                                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>
                                    Notes
                                </div>
                            )}
                        </>
                    )}
                    {unpinned.map(n => <NoteCard key={n.id} note={n} />)}

                    {notes.length < total && (
                        <button onClick={loadMore} disabled={loadingMore} style={{ padding: 8 }}>
                            {loadingMore ? "Loading..." : `Load more (${notes.length} of ${total})`}
                        </button>
                    )}

                    {notes.length === 0 && (activeTag || activeFolder) && (
                        <div style={{ opacity: 0.6, textAlign: "center", padding: 24 }}>No notes match this filter.</div>
                    )}
                    {notes.length === 0 && !activeTag && activeFolder === null && (
                        <div style={{ opacity: 0.6, textAlign: "center", padding: 24 }}>No notes yet. Create one!</div>
                    )}
                </div>
            )}
        </div>
    );
}
