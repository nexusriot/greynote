import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";

function fmt(dt) {
    try { return new Date(dt).toLocaleString(); } catch { return dt; }
}

function purgeCountdown(purgeAt) {
    if (!purgeAt) return "kept until you delete it";
    const days = Math.ceil((new Date(purgeAt) - new Date()) / 86400000);
    if (days <= 0) return "will be deleted shortly";
    return `deleted for good in ${days} day${days === 1 ? "" : "s"}`;
}

export default function Trash() {
    const [items, setItems] = useState([]);
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(true);

    async function load() {
        setErr("");
        try {
            setItems(await apiFetch("/api/notes/trash"));
        } catch (e) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    async function restore(id) {
        setErr("");
        try {
            await apiFetch(`/api/notes/${id}/restore`, { method: "POST" });
            await load();
        } catch (e) { setErr(e.message); }
    }

    async function purge(item) {
        if (!confirm(`Permanently delete "${item.title || "(untitled)"}"? This cannot be undone.`)) return;
        setErr("");
        try {
            await apiFetch(`/api/notes/${item.id}/purge`, { method: "DELETE" });
            await load();
        } catch (e) { setErr(e.message); }
    }

    async function emptyTrash() {
        if (!confirm(`Permanently delete all ${items.length} note(s) in the trash? This cannot be undone.`)) return;
        setErr("");
        try {
            await apiFetch("/api/notes/trash", { method: "DELETE" });
            await load();
        } catch (e) { setErr(e.message); }
    }

    return (
        <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 style={{ flex: 1, margin: 0 }}>Trash</h2>
                <Link to="/" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>← Notes</Link>
                {items.length > 0 && (
                    <button onClick={emptyTrash} style={{ color: "var(--color-danger)" }}>Empty trash</button>
                )}
            </div>

            {err && <div style={{ color: "var(--color-danger)" }}>{err}</div>}

            {loading ? (
                <div>Loading...</div>
            ) : items.length === 0 ? (
                <div style={{ opacity: 0.6, textAlign: "center", padding: 24 }}>
                    The trash is empty. Deleted notes land here first.
                </div>
            ) : (
                items.map(item => (
                    <div key={item.id} style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8, display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <div style={{ fontWeight: 700, flex: 1 }}>{item.title || "(untitled)"}</div>
                            <button onClick={() => restore(item.id)}>Restore</button>
                            <button onClick={() => purge(item)} style={{ color: "var(--color-danger)" }}>Delete forever</button>
                        </div>
                        <div style={{ opacity: 0.65, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {item.snippet || <em>Empty note</em>}
                        </div>
                        {item.tags && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {item.tags.split(",").filter(Boolean).map(t => (
                                    <span key={t} style={{ fontSize: 11, padding: "1px 6px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                                        #{t}
                                    </span>
                                ))}
                            </div>
                        )}
                        <div style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                            Deleted {fmt(item.deletedAt)} · {purgeCountdown(item.purgeAt)}
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}
