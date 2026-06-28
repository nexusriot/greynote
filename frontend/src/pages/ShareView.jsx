import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import MarkdownRenderer from "../components/MarkdownRenderer";
export default function ShareView() {
    const { token } = useParams();
    const [note, setNote] = useState(null);
    const [err, setErr] = useState("");
    const [expired, setExpired] = useState(false);
    const [requiresPassword, setRequiresPassword] = useState(false);
    const [password, setPassword] = useState("");
    const [wrongPassword, setWrongPassword] = useState(false);

    async function fetchNote(pw) {
        setErr("");
        setWrongPassword(false);
        try {
            const headers = pw ? { "X-Share-Password": pw } : {};
            const res = await fetch(`/api/share/${token}`, { headers });
            if (res.status === 410) { setExpired(true); return; }
            if (res.status === 401) {
                const body = await res.json();
                if (body.requiresPassword) { setRequiresPassword(true); return; }
            }
            if (res.status === 403) { setWrongPassword(true); return; }
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            setNote(await res.json());
            setRequiresPassword(false);
        } catch (e) {
            setErr(e.message);
        }
    }

    useEffect(() => { fetchNote(""); }, [token]);

    if (expired) return (
        <div style={{ display: "grid", gap: 12, maxWidth: 400 }}>
            <Link to="/">← Go to app</Link>
            <h2 style={{ margin: 0 }}>Link expired</h2>
            <p style={{ color: "var(--color-text-muted)", margin: 0, fontSize: 14 }}>
                This share link has expired and is no longer accessible.
            </p>
        </div>
    );

    if (err) return (
        <div style={{ display: "grid", gap: 12 }}>
            <Link to="/">← Go to app</Link>
            <div style={{ color: "var(--color-danger)" }}>{err}</div>
        </div>
    );

    if (requiresPassword) return (
        <div style={{ display: "grid", gap: 12, maxWidth: 360 }}>
            <Link to="/">← Go to app</Link>
            <h2 style={{ margin: 0 }}>This note is password protected</h2>
            {wrongPassword && <div style={{ color: "var(--color-danger)" }}>Wrong password.</div>}
            <input
                type="password"
                placeholder="Enter password..."
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && fetchNote(password)}
                autoFocus
                style={{ padding: 8 }}
            />
            <button onClick={() => fetchNote(password)}>Unlock</button>
        </div>
    );

    if (!note) return <div>Loading...</div>;

    return (
        <div style={{ display: "grid", gap: 12 }}>
            <div><Link to="/">← Go to app</Link></div>
            <h2 style={{ margin: 0 }}>{note.title}</h2>
            {note.tags && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {note.tags.split(",").map(t => t.trim()).filter(Boolean).map(t => (
                        <span key={t} style={{ fontSize: 12, padding: "2px 8px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                            #{t}
                        </span>
                    ))}
                </div>
            )}
            <div style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8 }}>
                <MarkdownRenderer>{note.content}</MarkdownRenderer>
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                Last updated: {new Date(note.updatedAt).toLocaleString()}
            </div>
        </div>
    );
}
