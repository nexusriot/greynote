import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

export default function NoteEdit() {
    const { id } = useParams();
    const nav = useNavigate();
    const [note, setNote] = useState(null);
    const [err, setErr] = useState("");
    const [shareUrl, setShareUrl] = useState("");

    const fullShareLink = useMemo(() => {
        if (!shareUrl) return "";
        return window.location.origin + shareUrl; // shareUrl is like /share/{token}
    }, [shareUrl]);

    async function load() {
        setErr("");
        try {
            const n = await apiFetch(`/api/notes/${id}`);
            setNote(n);
            setShareUrl(n.shareUrl || "");
        } catch (e) {
            setErr(e.message);
        }
    }

    async function save() {
        setErr("");
        try {
            await apiFetch(`/api/notes/${id}`, {
                method: "PUT",
                body: { title: note.title, content: note.content },
            });
            nav("/"); // go back to notes list
        } catch (e) {
            setErr(e.message);
        }
    }

    async function del() {
        await apiFetch(`/api/notes/${id}`, { method: "DELETE" });
        nav("/");
    }

    async function enableShare() {
        const res = await apiFetch(`/api/notes/${id}/share`, { method: "POST" });
        setShareUrl(res.shareUrl);
    }

    async function disableShare() {
        await apiFetch(`/api/notes/${id}/share/disable`, { method: "POST" });
        setShareUrl("");
    }

    async function copyLink() {
        await navigator.clipboard.writeText(fullShareLink);
        alert("Copied share link!");
    }

    useEffect(() => { load(); }, [id]);

    if (err) return <div style={{ color: "crimson" }}>{err}</div>;
    if (!note) return <div>Loading...</div>;

    return (
        <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => nav("/")}>← Back</button>
                <button onClick={save}>Save</button>
                <button onClick={del} style={{ marginLeft: "auto" }}>Delete</button>
            </div>

            <input
                value={note.title}
                onChange={(e) => setNote({ ...note, title: e.target.value })}
                style={{ fontSize: 18, padding: 8 }}
            />
            <textarea
                value={note.content}
                onChange={(e) => setNote({ ...note, content: e.target.value })}
                rows={14}
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", padding: 8 }}
            />

            <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Sharing</div>

                {shareUrl ? (
                    <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ wordBreak: "break-all" }}>{fullShareLink}</div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={copyLink}>Copy link</button>
                            <button onClick={disableShare}>Disable</button>
                        </div>
                    </div>
                ) : (
                    <button onClick={enableShare}>Create share link</button>
                )}
            </div>
        </div>
    );
}
