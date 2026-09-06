import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer";

// localDate formats a Date as YYYY-MM-DD in the user's own timezone — the
// server must not decide which day "today" is.
export function localDate(date = new Date()) {
    return date.toLocaleDateString("en-CA");
}

function shiftDate(date, days) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + days);
    return localDate(d);
}

export default function Daily() {
    const [date, setDate] = useState(localDate());
    const [note, setNote] = useState(null);
    const [entries, setEntries] = useState([]);
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(true);
    const nav = useNavigate();

    const loadDay = useCallback(async (value) => {
        setErr("");
        setLoading(true);
        try {
            setNote(await apiFetch(`/api/notes/daily?date=${encodeURIComponent(value)}`));
        } catch (e) {
            if (e instanceof ApiError && e.status === 404) setNote(null);
            else setErr(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    async function loadEntries() {
        try {
            setEntries(await apiFetch("/api/notes/daily/list"));
        } catch { /* the list is a convenience, not essential */ }
    }

    useEffect(() => { loadDay(date); }, [date, loadDay]);
    useEffect(() => { loadEntries(); }, []);

    async function open() {
        setErr("");
        try {
            const res = await apiFetch("/api/notes/daily", { method: "POST", body: { date } });
            nav(`/notes/${res.id}`);
        } catch (e) { setErr(e.message); }
    }

    const isToday = date === localDate();

    return (
        <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ flex: 1, margin: 0 }}>Journal</h2>
                <Link to="/" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>← Notes</Link>
            </div>

            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => setDate(d => shiftDate(d, -1))} title="Previous day">←</button>
                <input
                    type="date"
                    value={date}
                    max={localDate()}
                    onChange={e => e.target.value && setDate(e.target.value)}
                    style={{ padding: "4px 8px" }}
                />
                <button onClick={() => setDate(d => shiftDate(d, 1))} disabled={isToday} title="Next day">→</button>
                {!isToday && <button onClick={() => setDate(localDate())}>Today</button>}
                <div style={{ marginLeft: "auto" }}>
                    <button onClick={open} style={{ fontWeight: 600 }}>
                        {note ? "Open in editor" : "Create entry"}
                    </button>
                </div>
            </div>

            {err && <div style={{ color: "var(--color-danger)" }}>{err}</div>}

            <div style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8, minHeight: 120 }}>
                {loading ? (
                    <div style={{ opacity: 0.6 }}>Loading...</div>
                ) : note ? (
                    <>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>{note.title}</div>
                        <MarkdownRenderer>{note.content}</MarkdownRenderer>
                    </>
                ) : (
                    <div style={{ opacity: 0.6 }}>
                        Nothing written for {date} yet. Creating an entry uses your daily template if you have one.
                    </div>
                )}
            </div>

            {entries.length > 0 && (
                <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
                        Recent entries
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {entries.slice(0, 30).map(e => (
                            <button
                                key={e.id}
                                onClick={() => setDate(e.date)}
                                style={{
                                    fontSize: 12, padding: "2px 8px", borderRadius: 12,
                                    fontWeight: e.date === date ? 700 : 400,
                                }}
                                title={e.title}
                            >
                                {e.date}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
