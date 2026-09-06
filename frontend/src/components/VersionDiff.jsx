import React, { useMemo, useState } from "react";
import { collapseUnchanged, diffLines, diffStats } from "../diff";

const COLORS = {
    add: { background: "rgba(46, 160, 67, 0.16)", marker: "+" },
    del: { background: "rgba(248, 81, 73, 0.16)", marker: "−" },
};

// VersionDiff shows what restoring a version would change: the old version on
// the left of the comparison, the note as it stands now on the right.
export default function VersionDiff({ oldText, newText }) {
    const [showAll, setShowAll] = useState(false);

    const entries = useMemo(() => diffLines(oldText || "", newText || ""), [oldText, newText]);
    const stats = useMemo(() => diffStats(entries), [entries]);
    const shown = useMemo(
        () => (showAll ? entries : collapseUnchanged(entries, 2)),
        [entries, showAll],
    );

    if (stats.added === 0 && stats.removed === 0) {
        return <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Identical to the current note.</div>;
    }

    return (
        <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12 }}>
                <span style={{ color: "var(--color-text-muted)" }}>
                    Compared with the note as it is now:
                </span>
                <span style={{ color: "#2ea043" }}>+{stats.added}</span>
                <span style={{ color: "#f85149" }}>−{stats.removed}</span>
                <button onClick={() => setShowAll(s => !s)} style={{ marginLeft: "auto", fontSize: 11, padding: "1px 8px" }}>
                    {showAll ? "Collapse" : "Show all lines"}
                </button>
            </div>

            <div style={{
                maxHeight: 300, overflow: "auto", borderRadius: 4,
                border: "1px solid var(--color-border)", background: "var(--color-surface)",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12,
            }}>
                {shown.map((entry, i) => {
                    if (entry.type === "gap") {
                        return (
                            <div key={i} style={{ padding: "2px 8px", color: "var(--color-text-muted)", opacity: 0.7 }}>
                                ⋯ {entry.count} unchanged line{entry.count === 1 ? "" : "s"}
                            </div>
                        );
                    }
                    const style = COLORS[entry.type];
                    return (
                        <div
                            key={i}
                            style={{
                                padding: "1px 8px",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                background: style?.background,
                            }}
                        >
                            <span style={{ opacity: 0.5, userSelect: "none" }}>{style?.marker ?? " "} </span>
                            {entry.text || " "}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
