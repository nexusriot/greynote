import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

function fmt(dt) {
    try { return new Date(dt).toLocaleString(); } catch { return dt; }
}

export default function Sessions() {
    const nav = useNavigate();
    const [sessions, setSessions] = useState([]);
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(true);

    async function load() {
        setErr("");
        try {
            const list = await apiFetch("/api/sessions");
            setSessions(list);
        } catch (e) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    }

    async function revoke(id) {
        setErr("");
        try {
            await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
            setSessions(ss => ss.filter(s => s.id !== id));
        } catch (e) {
            setErr(e.message);
        }
    }

    async function revokeAll() {
        if (!confirm("Revoke all other sessions? You will stay logged in here.")) return;
        const others = sessions.filter(s => !s.isCurrent);
        for (const s of others) {
            await revoke(s.id);
        }
    }

    useEffect(() => { load(); }, []);

    return (
        <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={() => nav("/")}>← Back</button>
                <span style={{ fontWeight: 700 }}>Active sessions</span>
                {sessions.filter(s => !s.isCurrent).length > 0 && (
                    <button onClick={revokeAll} style={{ marginLeft: "auto", color: "var(--color-danger)" }}>
                        Revoke all others
                    </button>
                )}
            </div>

            {err && <div style={{ color: "var(--color-danger)" }}>{err}</div>}
            {loading && <div>Loading...</div>}

            <div style={{ display: "grid", gap: 8 }}>
                {sessions.map(s => (
                    <div
                        key={s.id}
                        style={{
                            padding: 12,
                            border: `1px solid var(--color-border)`,
                            borderRadius: 8,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 12,
                        }}
                    >
                        <div style={{ display: "grid", gap: 4 }}>
                            <div style={{ fontWeight: 600 }}>
                                {s.isCurrent ? "This session" : "Session"}
                                {s.isCurrent && (
                                    <span style={{ marginLeft: 8, fontSize: 11, padding: "1px 6px", background: "var(--color-accent)", color: "#fff", borderRadius: 4 }}>
                                        current
                                    </span>
                                )}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                                Started: {fmt(s.createdAt)}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                                Expires: {fmt(s.expiresAt)}
                            </div>
                        </div>
                        {!s.isCurrent && (
                            <button onClick={() => revoke(s.id)} style={{ color: "var(--color-danger)", flexShrink: 0 }}>
                                Revoke
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
