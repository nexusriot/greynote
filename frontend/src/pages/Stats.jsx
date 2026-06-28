import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";

function BarChart({ data }) {
    if (!data || data.length === 0) {
        return <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: 12 }}>No data yet.</div>;
    }

    const W = 600, H = 180;
    const PAD = { top: 16, right: 8, bottom: 36, left: 28 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;
    const max = Math.max(...data.map(d => d.count), 1);
    const slotW = chartW / data.length;
    const barW = Math.max(4, slotW - 4);

    return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
            {[0, 0.5, 1].map(t => {
                const y = PAD.top + chartH * (1 - t);
                return (
                    <g key={t}>
                        <line x1={PAD.left} y1={y} x2={PAD.left + chartW} y2={y}
                            stroke="var(--color-border)" strokeWidth={1} />
                        <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize={9} fill="var(--color-text-muted)">
                            {Math.round(max * t)}
                        </text>
                    </g>
                );
            })}

            {data.map((d, i) => {
                const x = PAD.left + i * slotW + (slotW - barW) / 2;
                const barH = Math.max(1, (d.count / max) * chartH);
                const y = PAD.top + chartH - barH;
                const labelX = PAD.left + i * slotW + slotW / 2;
                return (
                    <g key={d.month}>
                        <rect x={x} y={y} width={barW} height={barH}
                            fill="var(--color-accent)" rx={2} opacity={0.85} />
                        <text x={labelX} y={H - PAD.bottom + 12} textAnchor="middle"
                            fontSize={8} fill="var(--color-text-muted)">
                            {d.month.slice(5)}
                        </text>
                        <text x={labelX} y={H - PAD.bottom + 22} textAnchor="middle"
                            fontSize={7} fill="var(--color-text-muted)" opacity={0.7}>
                            {d.month.slice(0, 4)}
                        </text>
                        {d.count > 0 && barH > 14 && (
                            <text x={x + barW / 2} y={y - 3} textAnchor="middle"
                                fontSize={8} fill="var(--color-text-muted)">
                                {d.count}
                            </text>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

export default function Stats() {
    const [stats, setStats] = useState(null);
    const [err, setErr] = useState("");

    useEffect(() => {
        (async () => {
            try { setStats(await apiFetch("/api/notes/stats")); }
            catch (e) { setErr(e.message); }
        })();
    }, []);

    if (err) return <div style={{ color: "var(--color-danger)" }}>{err}</div>;
    if (!stats) return <div>Loading...</div>;

    const avgWords = stats.totalNotes > 0 ? Math.round(stats.totalWords / stats.totalNotes) : 0;
    const maxTagCount = stats.topTags?.[0]?.count ?? 1;

    return (
        <div style={{ display: "grid", gap: 24, maxWidth: 680 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <h2 style={{ margin: 0, flex: 1 }}>Statistics</h2>
                <Link to="/" style={{ fontSize: 13, color: "var(--color-text-muted)", textDecoration: "none" }}>← Notes</Link>
            </div>

            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                {[
                    { label: "Notes", value: stats.totalNotes.toLocaleString() },
                    { label: "Total words", value: stats.totalWords.toLocaleString() },
                    { label: "Avg words/note", value: avgWords.toLocaleString() },
                ].map(({ label, value }) => (
                    <div key={label} style={{
                        padding: "16px 12px",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        textAlign: "center",
                    }}>
                        <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{value}</div>
                        <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 6 }}>{label}</div>
                    </div>
                ))}
            </div>

            {/* Notes over time */}
            <div>
                <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Notes over time</h3>
                <div style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8 }}>
                    <BarChart data={stats.notesPerMonth} />
                </div>
            </div>

            {/* Tags */}
            {stats.topTags && stats.topTags.length > 0 && (
                <div>
                    <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>
                        Tags <span style={{ fontWeight: 400, color: "var(--color-text-muted)", fontSize: 13 }}>({stats.topTags.length})</span>
                    </h3>
                    <div style={{ display: "grid", gap: 7 }}>
                        {stats.topTags.map(({ tag, count }) => (
                            <div key={tag} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ minWidth: 90, fontSize: 13, fontWeight: 500, color: "var(--color-accent)" }}>#{tag}</span>
                                <div style={{ flex: 1, height: 8, background: "var(--color-surface)", borderRadius: 4, border: "1px solid var(--color-border)", overflow: "hidden" }}>
                                    <div style={{
                                        height: "100%",
                                        width: `${(count / maxTagCount) * 100}%`,
                                        background: "var(--color-accent)",
                                        borderRadius: 4,
                                        opacity: 0.8,
                                    }} />
                                </div>
                                <span style={{ fontSize: 12, color: "var(--color-text-muted)", minWidth: 24, textAlign: "right" }}>{count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
