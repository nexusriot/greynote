import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import MarkdownRenderer from "../components/MarkdownRenderer";
import { apiFetch } from "../api";

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
function VersionHistory({ noteId, onRestore }) {
    const [versions, setVersions] = useState([]);
    const [selected, setSelected] = useState(null);
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
                        <div style={{ borderTop: "1px solid var(--color-border)", padding: 10 }}>
                            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6 }}>
                                Preview — click Restore to apply
                            </div>
                            <div style={{ maxHeight: 240, overflowY: "auto", padding: 8, background: "var(--color-surface)", borderRadius: 4, fontSize: 13 }}>
                                <MarkdownRenderer>{selected.content}</MarkdownRenderer>
                            </div>
                            <button onClick={() => onRestore(selected)} style={{ marginTop: 8, color: "var(--color-accent)", fontWeight: 600 }}>
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

    const markdownRef = useRef(null);
    const textareaRef = useRef(null);
    const fileInputRef = useRef(null);

    const fullShareLink = useMemo(() => shareUrl ? window.location.origin + shareUrl : "", [shareUrl]);

    const wordCount = useMemo(() => {
        if (!note?.content) return 0;
        return note.content.trim().split(/\s+/).filter(Boolean).length;
    }, [note?.content]);

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

    // ── Save ────────────────────────────────────────────────────────────────────
    const save = useCallback(async () => {
        if (!note) return;
        setErr("");
        try {
            await apiFetch(`/api/notes/${id}`, {
                method: "PUT",
                body: { title: note.title, content: note.content, tags: note.tags || "", isPinned: note.isPinned || false },
            });
            setSaved(true);
            try { localStorage.removeItem(`greynote-draft-${id}`); } catch {}
        } catch (e) {
            setErr(e.message);
        }
    }, [note, id]);

    // ── Delete ──────────────────────────────────────────────────────────────────
    async function del() {
        if (!confirm("Delete this note? This cannot be undone.")) return;
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

    useEffect(() => { load(); }, [id]);

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
                    onClick={save}
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
                    <button onClick={del} style={{ color: "var(--color-danger)" }}>Delete</button>
                </div>
            </div>

            {err && <div style={{ color: "var(--color-danger)" }}>{err}</div>}

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

            {/* Preview toggle + word count */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={() => setPreview(p => !p)}>{preview ? "Edit" : "Preview"}</button>
                {!preview && (
                    <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                        {wordCount} {wordCount === 1 ? "word" : "words"} · Ctrl+S save · Ctrl+E preview · paste image to embed
                    </span>
                )}
            </div>

            {/* Preview div always rendered so exportHtml can grab innerHTML */}
            <div
                ref={markdownRef}
                style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8, display: preview ? "block" : "none", minHeight: 80 }}
            >
                <MarkdownRenderer>{note.content}</MarkdownRenderer>
            </div>

            {!preview && (
                <textarea
                    ref={textareaRef}
                    value={note.content}
                    onChange={e => { setNote(n => ({ ...n, content: e.target.value })); setSaved(false); }}
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

            {/* Version history */}
            <div style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 700 }}>Version history</span>
                    <button onClick={() => setShowVersions(v => !v)} style={{ fontSize: 12, padding: "2px 8px" }}>
                        {showVersions ? "Hide" : "Show"}
                    </button>
                </div>
                {showVersions && <VersionHistory noteId={id} onRestore={restoreVersion} />}
            </div>
        </div>
    );
}
