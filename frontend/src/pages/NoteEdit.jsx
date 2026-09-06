import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import MarkdownRenderer from "../components/MarkdownRenderer";
import EditorToolbar from "../components/EditorToolbar";
import Outline from "../components/Outline";
import VersionDiff from "../components/VersionDiff";
import { apiFetch } from "../api";
import { wikiLinkIndex } from "../wikilinks";
import { taskStats, toggleTaskAtLine } from "../markdown";
import { applyToolbarAction, continueList, indentSelection } from "../editor";

// ── Tags pill input ────────────────────────────────────────────────────────────
function TagsInput({ value, onChange }) {
    const [input, setInput] = useState("");
    const tags = useMemo(
        () => (value ? value.split(",").map(t => t.trim()).filter(Boolean) : []),
        [value]
    );

    function commit() {
        const tag = input.trim().toLowerCase();
        if (tag && !tags.includes(tag)) onChange([...tags, tag].join(","));
        setInput("");
    }

    function onKeyDown(e) {
        if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
        else if (e.key === "Backspace" && !input && tags.length > 0) {
            onChange(tags.slice(0, -1).join(","));
        }
    }

    return (
        <div style={{
            display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center",
            padding: "4px 8px", border: "1px solid var(--color-border)", borderRadius: 6, minHeight: 36,
        }}>
            {tags.map(t => (
                <span key={t} style={{
                    display: "inline-flex", alignItems: "center", gap: 3,
                    padding: "2px 8px", background: "var(--color-surface)",
                    border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12,
                }}>
                    #{t}
                    <button
                        type="button"
                        onClick={() => onChange(tags.filter(x => x !== t).join(","))}
                        style={{ border: "none", background: "none", cursor: "pointer", padding: 0, lineHeight: 1, opacity: 0.6, fontSize: 14 }}
                    >×</button>
                </span>
            ))}
            <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={commit}
                placeholder={tags.length === 0 ? "Add tags (Enter)..." : ""}
                style={{ border: "none", outline: "none", background: "transparent", fontSize: 13, minWidth: 80, flex: 1, padding: 0 }}
            />
        </div>
    );
}

// ── Version history panel ──────────────────────────────────────────────────────
function VersionHistory({ noteId, currentContent, onRestore }) {
    const [versions, setVersions] = useState([]);
    const [selected, setSelected] = useState(null);
    const [mode, setMode] = useState("diff");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try { setVersions(await apiFetch(`/api/notes/${noteId}/versions`)); }
            catch {}
            setLoading(false);
        })();
    }, [noteId]);

    async function viewVersion(v) {
        if (selected?.id === v.id) { setSelected(null); return; }
        try { setSelected(await apiFetch(`/api/notes/${noteId}/versions/${v.id}`)); }
        catch {}
    }

    function fmtDate(dt) { try { return new Date(dt).toLocaleString(); } catch { return dt; } }

    if (loading) return <div style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>Loading...</div>;
    if (!versions.length) return <div style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>No versions yet — each save creates one.</div>;

    return (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {versions.map(v => (
                <div key={v.id} style={{ border: "1px solid var(--color-border)", borderRadius: 6 }}>
                    <button
                        onClick={() => viewVersion(v)}
                        style={{ width: "100%", textAlign: "left", padding: "8px 10px", border: "none", background: "none", cursor: "pointer", display: "flex", justifyContent: "space-between" }}
                    >
                        <span style={{ fontWeight: 500, fontSize: 13 }}>{v.title || "(untitled)"}</span>
                        <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{fmtDate(v.savedAt)}</span>
                    </button>
                    {selected?.id === v.id && (
                        <div style={{ borderTop: "1px solid var(--color-border)", padding: 10, display: "grid", gap: 8 }}>
                            <div style={{ display: "flex", gap: 6 }}>
                                <button
                                    onClick={() => setMode("diff")}
                                    style={{ fontSize: 11, padding: "2px 8px", fontWeight: mode === "diff" ? 700 : 400 }}
                                >
                                    Changes
                                </button>
                                <button
                                    onClick={() => setMode("preview")}
                                    style={{ fontSize: 11, padding: "2px 8px", fontWeight: mode === "preview" ? 700 : 400 }}
                                >
                                    Preview
                                </button>
                            </div>

                            {mode === "diff" ? (
                                <VersionDiff oldText={selected.content} newText={currentContent} />
                            ) : (
                                <div style={{ maxHeight: 240, overflowY: "auto", padding: 8, background: "var(--color-surface)", borderRadius: 4, fontSize: 13 }}>
                                    <MarkdownRenderer>{selected.content}</MarkdownRenderer>
                                </div>
                            )}

                            <button onClick={() => onRestore(selected)} style={{ color: "var(--color-accent)", fontWeight: 600, justifySelf: "start" }}>
                                Restore this version
                            </button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// ── Share password setter ──────────────────────────────────────────────────────
function SharePasswordInput({ hasPassword, onSave, onCancel }) {
    const [pw, setPw] = useState("");
    return (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
                type="password"
                placeholder={hasPassword ? "New password (blank to remove)" : "Set a password..."}
                value={pw}
                onChange={e => setPw(e.target.value)}
                style={{ padding: 6, flex: 1, minWidth: 160 }}
            />
            <button onClick={() => onSave(pw)} style={{ fontWeight: 600 }}>Save</button>
            <button onClick={onCancel}>Cancel</button>
        </div>
    );
}

function LinksPanel({ links }) {
    const unresolved = links.outgoing.filter(l => l.id === null);

    if (links.backlinks.length === 0 && links.outgoing.length === 0) {
        return (
            <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                No links yet — write <code>[[Another note]]</code> to link one.
            </div>
        );
    }

    return (
        <div style={{ display: "grid", gap: 10 }}>
            {links.backlinks.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
                        Linked from
                    </div>
                    {links.backlinks.map(b => (
                        <Link
                            key={b.id}
                            to={`/notes/${b.id}`}
                            style={{ textDecoration: "none", color: "inherit", border: "1px solid var(--color-border)", borderRadius: 6, padding: "6px 10px" }}
                        >
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{b.title || "(untitled)"}</div>
                            <div style={{ fontSize: 12, opacity: 0.65, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {b.snippet}
                            </div>
                        </Link>
                    ))}
                </div>
            )}

            {links.outgoing.length > 0 && (
                <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
                        Links to
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {links.outgoing.map(l => l.id !== null ? (
                            <Link key={l.title} to={`/notes/${l.id}`} style={{ fontSize: 13 }}>{l.title}</Link>
                        ) : (
                            <Link
                                key={l.title}
                                to={`/new?title=${encodeURIComponent(l.title)}`}
                                title="This note does not exist yet — click to create it"
                                style={{ fontSize: 13, color: "var(--color-text-muted)", textDecoration: "underline dotted" }}
                            >
                                {l.title}
                            </Link>
                        ))}
                    </div>
                    {unresolved.length > 0 && (
                        <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                            {unresolved.length === 1
                                ? "1 link points at a note that does not exist yet."
                                : `${unresolved.length} links point at notes that do not exist yet.`}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ConflictBanner({ current, onKeepMine, onUseTheirs }) {
    return (
        <div style={{ padding: 12, border: "1px solid var(--color-danger)", borderRadius: 8, display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 700, color: "var(--color-danger)" }}>
                This note changed somewhere else
            </div>
            <div style={{ fontSize: 13 }}>
                Another device saved it at {current ? new Date(current.updatedAt).toLocaleString() : "an unknown time"}.
                Saving now would overwrite that version.
            </div>
            {current && (
                <div style={{ maxHeight: 160, overflowY: "auto", padding: 8, background: "var(--color-surface)", borderRadius: 4, fontSize: 12, whiteSpace: "pre-wrap" }}>
                    {current.content || "(empty)"}
                </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={onKeepMine} style={{ fontWeight: 600 }}>Overwrite with my version</button>
                <button onClick={onUseTheirs}>Discard mine, load theirs</button>
            </div>
        </div>
    );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function NoteEdit() {
    const { id } = useParams();
    const nav = useNavigate();

    const [note, setNote] = useState(null);
    const [saved, setSaved] = useState(true);
    const [err, setErr] = useState("");
    const [shareUrl, setShareUrl] = useState("");
    const [shareHasPassword, setShareHasPassword] = useState(false);
    const [shareExpiresAt, setShareExpiresAt] = useState(""); // "YYYY-MM-DD" local date or ""
    const [preview, setPreview] = useState(true);
    const [showVersions, setShowVersions] = useState(false);
    const [showPasswordInput, setShowPasswordInput] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [conflict, setConflict] = useState(null);
    const [links, setLinks] = useState({ outgoing: [], backlinks: [] });
    const [folders, setFolders] = useState([]);
    const [showOutline, setShowOutline] = useState(false);

    const markdownRef = useRef(null);
    const textareaRef = useRef(null);
    const fileInputRef = useRef(null);

    const fullShareLink = useMemo(() => shareUrl ? window.location.origin + shareUrl : "", [shareUrl]);

    const wikiHref = useMemo(() => {
        const index = wikiLinkIndex(links.outgoing);
        return title => {
            const id = index.get(title.toLowerCase());
            return id ? `/notes/${id}` : `/new?title=${encodeURIComponent(title)}`;
        };
    }, [links]);

    const wordCount = useMemo(() => {
        if (!note?.content) return 0;
        return note.content.trim().split(/\s+/).filter(Boolean).length;
    }, [note?.content]);

    const tasks = useMemo(() => taskStats(note?.content || ""), [note?.content]);

    // ── Load ────────────────────────────────────────────────────────────────────
    async function load() {
        setErr("");
        try {
            const n = await apiFetch(`/api/notes/${id}`);
            const draftKey = `greynote-draft-${id}`;
            try {
                const raw = localStorage.getItem(draftKey);
                if (raw) {
                    const draft = JSON.parse(raw);
                    if (draft.updatedAt > n.updatedAt && confirm("You have an unsaved draft. Restore it?")) {
                        setNote({ ...n, title: draft.title, content: draft.content, tags: draft.tags });
                        setSaved(false);
                        setPreview(false);
                        setShareUrl(n.shareUrl || "");
                        setShareHasPassword(n.sharePasswordSet || false);
                        setShareExpiresAt(n.shareExpiresAt ? n.shareExpiresAt.slice(0, 10) : "");
                        return;
                    }
                    localStorage.removeItem(draftKey);
                }
            } catch {}
            setNote(n);
            setShareUrl(n.shareUrl || "");
            setShareHasPassword(n.sharePasswordSet || false);
            setShareExpiresAt(n.shareExpiresAt ? n.shareExpiresAt.slice(0, 10) : "");
            if (!n.content) setPreview(false);
        } catch (e) {
            setErr(e.message);
        }
    }

    const loadFolders = useCallback(async () => {
        try {
            setFolders(await apiFetch("/api/folders"));
        } catch {
            setFolders([]);
        }
    }, []);

    const loadLinks = useCallback(async () => {
        try {
            setLinks(await apiFetch(`/api/notes/${id}/links`));
        } catch {
            setLinks({ outgoing: [], backlinks: [] });
        }
    }, [id]);

    // ── Save ────────────────────────────────────────────────────────────────────
    // force skips the If-Match check, which is how "overwrite theirs" resolves a
    // conflict.
    const saveNote = useCallback(async (target, { force = false } = {}) => {
        if (!target) return;
        setErr("");
        try {
            const res = await apiFetch(`/api/notes/${id}`, {
                method: "PUT",
                headers: !force && target.updatedAt ? { "If-Match": target.updatedAt } : undefined,
                body: {
                    title: target.title,
                    content: target.content,
                    tags: target.tags || "",
                    folder: target.folder || "",
                    isPinned: target.isPinned || false,
                },
            });
            setNote(n => ({ ...n, updatedAt: res?.updatedAt || n.updatedAt }));
            setSaved(true);
            setConflict(null);
            try { localStorage.removeItem(`greynote-draft-${id}`); } catch {}
            loadLinks();
        } catch (e) {
            if (e.status === 409) {
                setConflict(e.data?.current ?? null);
                return;
            }
            setErr(e.message);
        }
    }, [id, loadLinks]);

    const save = useCallback(
        (options) => saveNote(note, options),
        [saveNote, note],
    );

    function loadServerVersion() {
        if (!conflict) { setConflict(null); return; }
        setNote(n => ({ ...n, ...conflict }));
        setSaved(true);
        setConflict(null);
        try { localStorage.removeItem(`greynote-draft-${id}`); } catch {}
    }

    // ── Delete ──────────────────────────────────────────────────────────────────
    async function del() {
        if (!confirm("Move this note to the trash? You can restore it from there.")) return;
        setErr("");
        try {
            await apiFetch(`/api/notes/${id}`, { method: "DELETE" });
            try { localStorage.removeItem(`greynote-draft-${id}`); } catch {}
            nav("/");
        } catch (e) { setErr(e.message); }
    }

    function goBack() {
        if (!saved && !confirm("Leave without saving? Your changes will be lost.")) return;
        try { if (!saved) localStorage.removeItem(`greynote-draft-${id}`); } catch {}
        nav("/");
    }

    // ── Pin ─────────────────────────────────────────────────────────────────────
    async function togglePin() {
        setErr("");
        try {
            const res = await apiFetch(`/api/notes/${id}/pin`, { method: "POST" });
            setNote(n => ({ ...n, isPinned: res.isPinned }));
        } catch (e) { setErr(e.message); }
    }

    // ── Share ───────────────────────────────────────────────────────────────────
    async function enableShare() {
        setErr("");
        try {
            const body = shareExpiresAt ? { expiresAt: shareExpiresAt + "T23:59:59Z" } : {};
            const res = await apiFetch(`/api/notes/${id}/share`, { method: "POST", body });
            setShareUrl(res.shareUrl);
        } catch (e) { setErr(e.message); }
    }

    async function disableShare() {
        setErr("");
        try {
            await apiFetch(`/api/notes/${id}/share/disable`, { method: "POST" });
            setShareUrl("");
            setShareExpiresAt("");
        } catch (e) { setErr(e.message); }
    }

    async function saveShareExpiry() {
        setErr("");
        try {
            const expiresAt = shareExpiresAt ? shareExpiresAt + "T23:59:59Z" : "";
            await apiFetch(`/api/notes/${id}/share/expiry`, { method: "PUT", body: { expiresAt } });
        } catch (e) { setErr(e.message); }
    }

    async function copyLink() {
        try { await navigator.clipboard.writeText(fullShareLink); alert("Copied!"); }
        catch { prompt("Copy this link:", fullShareLink); }
    }

    async function saveSharePassword(password) {
        setErr("");
        try {
            await apiFetch(`/api/notes/${id}/share/password`, { method: "PUT", body: { password } });
            setShareHasPassword(!!password.trim());
            setShowPasswordInput(false);
        } catch (e) { setErr(e.message); }
    }

    // ── Image upload ────────────────────────────────────────────────────────────
    async function uploadImage(file) {
        setUploading(true);
        setErr("");
        try {
            const form = new FormData();
            form.append("file", file);
            const res = await fetch("/api/images", { method: "POST", credentials: "include", body: form });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || "Upload failed");
            }
            const { url } = await res.json();
            insertAtCursor(`![](${url})`);
        } catch (e) {
            setErr(e.message);
        } finally {
            setUploading(false);
        }
    }

    // applyToTextarea runs a pure transform from editor.js against the live
    // selection and puts the caret back where the transform asked for.
    function applyToTextarea(transform) {
        const ta = textareaRef.current;
        if (!ta) return;

        const next = transform(note.content || "", ta.selectionStart, ta.selectionEnd);
        setNote(n => ({ ...n, content: next.text }));
        setSaved(false);
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(next.start, next.end);
        });
    }

    function onToolbarAction(action) {
        applyToTextarea((text, start, end) => applyToolbarAction(action, text, start, end));
    }

    function onEditorKeyDown(e) {
        const ta = textareaRef.current;
        if (!ta) return;

        if (e.key === "Enter" && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
            const next = continueList(note.content || "", ta.selectionStart);
            if (next) {
                e.preventDefault();
                setNote(n => ({ ...n, content: next.text }));
                setSaved(false);
                requestAnimationFrame(() => {
                    ta.focus();
                    ta.setSelectionRange(next.caret, next.caret);
                });
            }
            return;
        }

        if (e.key === "Tab") {
            e.preventDefault();
            applyToTextarea((text, start, end) => indentSelection(text, start, end, e.shiftKey));
            return;
        }

        const shortcuts = { b: "bold", i: "italic", k: "link" };
        const action = (e.ctrlKey || e.metaKey) && shortcuts[e.key.toLowerCase()];
        if (action) {
            e.preventDefault();
            e.stopPropagation(); // Ctrl+K belongs to the editor while typing, not the palette
            onToolbarAction(action);
        }
    }

    // Toggling a checkbox in the preview edits the markdown and saves straight
    // away — a checkbox that needs a separate save does not feel like a checkbox.
    function onToggleTask(line) {
        if (!note) return;
        const content = toggleTaskAtLine(note.content || "", line);
        if (content === note.content) return;

        const next = { ...note, content };
        setNote(next);
        setSaved(false);
        saveNote(next);
    }

    function jumpToHeading(heading) {
        if (preview) {
            const el = markdownRef.current?.querySelector(`[id="${CSS.escape(heading.slug)}"]`);
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }

        const ta = textareaRef.current;
        if (!ta) return;
        const lines = (note.content || "").split("\n");
        const offset = lines.slice(0, heading.line - 1).reduce((n, line) => n + line.length + 1, 0);
        ta.focus();
        ta.setSelectionRange(offset, offset + (lines[heading.line - 1] || "").length);
        ta.scrollTop = ((heading.line - 1) / Math.max(lines.length, 1)) * ta.scrollHeight;
    }

    function insertAtCursor(text) {
        const ta = textareaRef.current;
        if (!ta) {
            setNote(n => ({ ...n, content: (n.content || "") + text }));
            setSaved(false);
            return;
        }
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const before = note.content.substring(0, start);
        const after = note.content.substring(end);
        const newContent = before + text + after;
        setNote(n => ({ ...n, content: newContent }));
        setSaved(false);
        requestAnimationFrame(() => {
            ta.focus();
            const pos = start + text.length;
            ta.setSelectionRange(pos, pos);
        });
    }

    async function onPaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
            if (item.type.startsWith("image/")) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (blob) { await uploadImage(blob); }
                return;
            }
        }
    }

    // ── Export ──────────────────────────────────────────────────────────────────
    function downloadBlob(content, filename, type) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const a = document.createElement("a");
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    }

    function exportMd() {
        downloadBlob(note.content, `${note.title || "note"}.md`, "text/markdown");
    }

    function exportHtml() {
        const inner = markdownRef.current?.innerHTML ?? "";
        const title = (note.title || "Note").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;color:#111}pre{background:#f4f4f4;padding:16px;border-radius:4px;overflow:auto}code{font-family:monospace}blockquote{border-left:4px solid #ddd;margin:0;padding-left:16px;color:#555}</style>
</head>
<body><h1>${title}</h1>${inner}</body></html>`;
        downloadBlob(html, `${note.title || "note"}.html`, "text/html");
    }

    // ── Version restore ─────────────────────────────────────────────────────────
    function restoreVersion(v) {
        setNote(n => ({ ...n, title: v.title, content: v.content, tags: v.tags || "" }));
        setSaved(false);
        setPreview(false);
        setShowVersions(false);
    }

    // ── Auto-save draft ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (!note || saved) return;
        const timer = setTimeout(() => {
            try {
                localStorage.setItem(`greynote-draft-${id}`, JSON.stringify({
                    title: note.title, content: note.content, tags: note.tags,
                    updatedAt: new Date().toISOString(),
                }));
            } catch {}
        }, 2000);
        return () => clearTimeout(timer);
    }, [note?.title, note?.content, note?.tags, saved, id]);

    // ── Keyboard shortcuts ──────────────────────────────────────────────────────
    useEffect(() => {
        function onKeyDown(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
            if ((e.ctrlKey || e.metaKey) && e.key === "e") { e.preventDefault(); setPreview(p => !p); }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [save]);

    // ── Unsaved-changes guard ───────────────────────────────────────────────────
    useEffect(() => {
        if (saved) return;
        const handler = e => { e.preventDefault(); e.returnValue = ""; };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [saved]);

    // Everything below is per-note state: clearing it on an id change stops one
    // note's editor content, conflict or backlinks from bleeding into the next.
    useEffect(() => {
        setNote(null);
        setConflict(null);
        setLinks({ outgoing: [], backlinks: [] });
        load();
        loadLinks();
        loadFolders();
    }, [id, loadLinks, loadFolders]);

    if (err && !note) return <div style={{ color: "var(--color-danger)" }}>{err}</div>;
    if (!note) return <div>Loading...</div>;

    return (
        <div style={{ display: "grid", gap: 10 }}>
            {/* Hidden file input for image picker */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={async e => {
                    const file = e.target.files?.[0];
                    if (file) await uploadImage(file);
                    e.target.value = "";
                }}
            />

            {/* Toolbar */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={goBack}>← Back</button>
                <button
                    onClick={() => save()}
                    style={{
                        fontWeight: saved ? 400 : 700,
                        background: saved ? "var(--color-surface)" : "var(--color-accent)",
                        color: saved ? "inherit" : "#fff",
                        borderColor: saved ? "var(--color-border)" : "var(--color-accent)",
                    }}
                >
                    {saved ? "Saved" : "Save *"}
                </button>
                <button onClick={togglePin} title={note.isPinned ? "Unpin" : "Pin to top"} style={{ color: note.isPinned ? "var(--color-pin)" : "inherit" }}>
                    {note.isPinned ? "📌 Pinned" : "Pin"}
                </button>

                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button onClick={() => { setPreview(false); fileInputRef.current?.click(); }} title="Insert image" disabled={uploading}>
                        {uploading ? "Uploading..." : "🖼 Image"}
                    </button>
                    <button onClick={exportMd} title="Download .md">↓ .md</button>
                    <button onClick={exportHtml} title="Download .html">↓ .html</button>
                    <button onClick={del} style={{ color: "var(--color-danger)" }} title="Move to trash">Delete</button>
                </div>
            </div>

            {err && <div style={{ color: "var(--color-danger)" }}>{err}</div>}

            {conflict !== null && (
                <ConflictBanner
                    current={conflict}
                    onKeepMine={() => save({ force: true })}
                    onUseTheirs={loadServerVersion}
                />
            )}

            {/* Timestamps */}
            <div style={{ display: "flex", gap: 12, color: "var(--color-text-muted)", fontSize: 12 }}>
                <span>Created: {new Date(note.createdAt).toLocaleString()}</span>
                <span>Updated: {new Date(note.updatedAt).toLocaleString()}</span>
            </div>

            {/* Title */}
            <input
                value={note.title}
                onChange={e => { setNote(n => ({ ...n, title: e.target.value })); setSaved(false); }}
                style={{ fontSize: 18, padding: 8 }}
                placeholder="Note title"
            />

            {/* Tags */}
            <TagsInput value={note.tags || ""} onChange={tags => { setNote(n => ({ ...n, tags })); setSaved(false); }} />

            {/* Folder */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>📁</span>
                <input
                    list="note-folders"
                    placeholder="Folder (optional, e.g. Work/Projects)"
                    value={note.folder || ""}
                    onChange={e => { setNote(n => ({ ...n, folder: e.target.value })); setSaved(false); }}
                    style={{ padding: 6, flex: 1, fontSize: 13 }}
                />
                <datalist id="note-folders">
                    {folders.map(f => <option key={f.path} value={f.path} />)}
                </datalist>
            </div>

            {/* Preview toggle + word count */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => setPreview(p => !p)}>{preview ? "Edit" : "Preview"}</button>
                <button onClick={() => setShowOutline(o => !o)} style={{ fontSize: 12 }}>
                    {showOutline ? "Hide outline" : "Outline"}
                </button>
                <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                    {wordCount} {wordCount === 1 ? "word" : "words"}
                    {tasks.total > 0 && ` · ${tasks.done}/${tasks.total} tasks`}
                    {!preview && " · Ctrl+S save · Ctrl+E preview · Tab indent"}
                </span>
            </div>

            {showOutline && (
                <div style={{ padding: 10, border: "1px solid var(--color-border)", borderRadius: 8 }}>
                    <Outline content={note.content} onJump={jumpToHeading} />
                </div>
            )}

            {!preview && <EditorToolbar onAction={onToolbarAction} />}

            {/* Preview div always rendered so exportHtml can grab innerHTML */}
            <div
                ref={markdownRef}
                style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8, display: preview ? "block" : "none", minHeight: 80 }}
            >
                <MarkdownRenderer wikiHref={wikiHref} onToggleTask={onToggleTask}>{note.content}</MarkdownRenderer>
            </div>

            {!preview && (
                <textarea
                    ref={textareaRef}
                    value={note.content}
                    onChange={e => { setNote(n => ({ ...n, content: e.target.value })); setSaved(false); }}
                    onKeyDown={onEditorKeyDown}
                    onPaste={onPaste}
                    rows={16}
                    style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", padding: 8 }}
                />
            )}

            {/* Sharing */}
            <div style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8, display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>Sharing</div>
                {shareUrl ? (
                    <>
                        <div style={{ wordBreak: "break-all", fontSize: 13 }}>{fullShareLink}</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button onClick={copyLink}>Copy link</button>
                            <button onClick={disableShare}>Disable</button>
                            <button onClick={() => setShowPasswordInput(p => !p)}>
                                {shareHasPassword ? "Change password" : "Set password"}
                            </button>
                        </div>
                        {shareHasPassword && !showPasswordInput && (
                            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>🔒 Password protected</div>
                        )}
                        {showPasswordInput && (
                            <SharePasswordInput hasPassword={shareHasPassword} onSave={saveSharePassword} onCancel={() => setShowPasswordInput(false)} />
                        )}
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Expires:</label>
                            <input
                                type="date"
                                value={shareExpiresAt}
                                min={new Date().toISOString().slice(0, 10)}
                                onChange={e => setShareExpiresAt(e.target.value)}
                                style={{ padding: "3px 6px", fontSize: 12 }}
                            />
                            <button onClick={saveShareExpiry} style={{ fontSize: 12, padding: "3px 10px" }}>
                                {shareExpiresAt ? "Save expiry" : "Remove expiry"}
                            </button>
                            {shareExpiresAt && (
                                <button onClick={() => { setShareExpiresAt(""); }} style={{ fontSize: 12, padding: "3px 8px", color: "var(--color-text-muted)" }}>
                                    ✕ Clear
                                </button>
                            )}
                        </div>
                    </>
                ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <label style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Expires (optional):</label>
                            <input
                                type="date"
                                value={shareExpiresAt}
                                min={new Date().toISOString().slice(0, 10)}
                                onChange={e => setShareExpiresAt(e.target.value)}
                                style={{ padding: "3px 6px", fontSize: 12 }}
                            />
                        </div>
                        <button onClick={enableShare} style={{ alignSelf: "start" }}>Create share link</button>
                    </div>
                )}
            </div>

            {/* Links */}
            <div style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8, display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>Links</div>
                <LinksPanel links={links} />
            </div>

            {/* Version history */}
            <div style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 700 }}>Version history</span>
                    <button onClick={() => setShowVersions(v => !v)} style={{ fontSize: 12, padding: "2px 8px" }}>
                        {showVersions ? "Hide" : "Show"}
                    </button>
                </div>
                {showVersions && (
                    <VersionHistory noteId={id} currentContent={note.content} onRestore={restoreVersion} />
                )}
            </div>
        </div>
    );
}
