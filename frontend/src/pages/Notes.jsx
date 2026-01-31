import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

export default function Notes() {
    const [notes, setNotes] = useState([]);
    const [err, setErr] = useState("");
    const nav = useNavigate();

    function fmt(dt) {
        try { return new Date(dt).toLocaleString(); } catch { return dt; }
    }

    async function load() {
        setErr("");
        try {
            setNotes(await apiFetch("/api/notes"));
        } catch (e) {
            setErr(e.message);
        }
    }

    async function create() {
        const res = await apiFetch("/api/notes", { method: "POST", body: { title: "New note", content: "" } });
        nav(`/notes/${res.id}`);
    }

    useEffect(() => { load(); }, []);

    return (
        <div>
            <div style={{ display: "flex", alignItems: "center" }}>
                <h2 style={{ flex: 1 }}>Your notes</h2>
                <button onClick={create}>+ New</button>
            </div>
            {err && <div style={{ color: "crimson" }}>{err}</div>}
            <div style={{ display: "grid", gap: 8 }}>
                {notes.map((n) => (
                    <Link key={n.id} to={`/notes/${n.id}`} style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, textDecoration: "none" }}>
                        <div style={{ fontWeight: 700 }}>{n.title}</div>
                        <div style={{ display: "flex", gap: 12, opacity: 0.75, fontSize: 12, marginTop: 6 }}>
                            <span>Created: {fmt(n.createdAt)}</span>
                            <span>Updated: {fmt(n.updatedAt)}</span>
                        </div>
                        <div style={{ opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.content}</div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
