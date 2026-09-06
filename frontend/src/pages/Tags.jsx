import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";

export default function Tags() {
    const [tags, setTags] = useState([]);
    const [err, setErr] = useState("");
    const [info, setInfo] = useState("");
    const [loading, setLoading] = useState(true);
    const [renaming, setRenaming] = useState(null); // tag name being renamed
    const [renameTo, setRenameTo] = useState("");
    const [selected, setSelected] = useState([]);
    const [mergeInto, setMergeInto] = useState("");

    async function load() {
        setErr("");
        try {
            setTags(await apiFetch("/api/tags"));
        } catch (e) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    async function run(action, successMessage) {
        setErr("");
        setInfo("");
        try {
            const res = await action();
            setInfo(typeof successMessage === "function" ? successMessage(res) : successMessage);
            await load();
        } catch (e) {
            setErr(e.message);
        }
    }

    function startRename(name) {
        setRenaming(name);
        setRenameTo(name);
    }

    async function commitRename() {
        const name = renameTo.trim();
        if (!name || name === renaming) { setRenaming(null); return; }
        await run(
            () => apiFetch(`/api/tags/${encodeURIComponent(renaming)}`, { method: "PUT", body: { name } }),
            res => `Renamed to #${res.name} across ${res.notesUpdated} note(s)`,
        );
        setRenaming(null);
    }

    async function remove(name) {
        if (!confirm(`Remove #${name} from every note? The notes themselves are kept.`)) return;
        await run(
            () => apiFetch(`/api/tags/${encodeURIComponent(name)}`, { method: "DELETE" }),
            res => `Removed #${name} from ${res.notesUpdated} note(s)`,
        );
        setSelected(s => s.filter(t => t !== name));
    }

    async function merge() {
        const into = mergeInto.trim().toLowerCase();
        const from = selected.filter(t => t !== into);
        if (!into || from.length === 0) {
            setErr("Pick the tags to merge and the tag to merge them into.");
            return;
        }
        await run(
            () => apiFetch("/api/tags/merge", { method: "POST", body: { from, into } }),
            res => `Merged into #${res.name} across ${res.notesUpdated} note(s)`,
        );
        setSelected([]);
        setMergeInto("");
    }

    function toggle(name) {
        setSelected(s => s.includes(name) ? s.filter(t => t !== name) : [...s, name]);
    }

    return (
        <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 style={{ flex: 1, margin: 0 }}>Tags</h2>
                <Link to="/" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>← Notes</Link>
            </div>

            {err && <div style={{ color: "var(--color-danger)" }}>{err}</div>}
            {info && <div style={{ color: "var(--color-accent)", fontSize: 13 }}>{info}</div>}

            {selected.length > 0 && (
                <div style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8, display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 13 }}>
                        Merge {selected.map(t => `#${t}`).join(", ")} into:
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input
                            list="tag-names"
                            value={mergeInto}
                            onChange={e => setMergeInto(e.target.value)}
                            placeholder="target tag"
                            style={{ padding: 6, flex: 1, minWidth: 140 }}
                        />
                        <datalist id="tag-names">
                            {tags.map(t => <option key={t.name} value={t.name} />)}
                        </datalist>
                        <button onClick={merge} style={{ fontWeight: 600 }}>Merge</button>
                        <button onClick={() => setSelected([])}>Cancel</button>
                    </div>
                </div>
            )}

            {loading ? (
                <div>Loading...</div>
            ) : tags.length === 0 ? (
                <div style={{ opacity: 0.6, textAlign: "center", padding: 24 }}>
                    No tags yet. Add them while editing a note.
                </div>
            ) : (
                tags.map(tag => (
                    <div key={tag.name} style={{ padding: "8px 12px", border: "1px solid var(--color-border)", borderRadius: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                            type="checkbox"
                            checked={selected.includes(tag.name)}
                            onChange={() => toggle(tag.name)}
                            title="Select for merging"
                        />

                        {renaming === tag.name ? (
                            <>
                                <input
                                    value={renameTo}
                                    autoFocus
                                    onChange={e => setRenameTo(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter") commitRename();
                                        if (e.key === "Escape") setRenaming(null);
                                    }}
                                    style={{ padding: 4, flex: 1, minWidth: 120 }}
                                />
                                <button onClick={commitRename} style={{ fontWeight: 600 }}>Save</button>
                                <button onClick={() => setRenaming(null)}>Cancel</button>
                            </>
                        ) : (
                            <>
                                <Link to={`/?tag=${encodeURIComponent(tag.name)}`} style={{ flex: 1, textDecoration: "none", color: "inherit", fontWeight: 600 }}>
                                    #{tag.name}
                                </Link>
                                <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                                    {tag.count} note{tag.count === 1 ? "" : "s"}
                                </span>
                                <button onClick={() => startRename(tag.name)} style={{ fontSize: 12 }}>Rename</button>
                                <button onClick={() => remove(tag.name)} style={{ fontSize: 12, color: "var(--color-danger)" }}>Remove</button>
                            </>
                        )}
                    </div>
                ))
            )}
        </div>
    );
}
