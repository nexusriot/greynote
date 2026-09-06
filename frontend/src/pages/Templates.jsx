import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

const PLACEHOLDERS = ["{{date}}", "{{time}}", "{{datetime}}", "{{weekday}}", "{{month}}", "{{year}}", "{{title}}"];

const EMPTY = { name: "", title: "", content: "", tags: "", folder: "", isDaily: false };

function TemplateForm({ value, onChange, onSave, onCancel, saving }) {
    return (
        <div style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8, display: "grid", gap: 8 }}>
            <input
                placeholder="Template name (e.g. Meeting)"
                value={value.name}
                onChange={e => onChange({ ...value, name: e.target.value })}
                style={{ padding: 6 }}
                autoFocus
            />
            <input
                placeholder="Note title, e.g. Meeting {{date}}"
                value={value.title}
                onChange={e => onChange({ ...value, title: e.target.value })}
                style={{ padding: 6 }}
            />
            <textarea
                placeholder="Note body..."
                value={value.content}
                onChange={e => onChange({ ...value, content: e.target.value })}
                rows={8}
                style={{ padding: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                    placeholder="tags, comma separated"
                    value={value.tags}
                    onChange={e => onChange({ ...value, tags: e.target.value })}
                    style={{ padding: 6, flex: 1, minWidth: 140 }}
                />
                <input
                    placeholder="folder (optional)"
                    value={value.folder}
                    onChange={e => onChange({ ...value, folder: e.target.value })}
                    style={{ padding: 6, flex: 1, minWidth: 140 }}
                />
            </div>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                <input
                    type="checkbox"
                    checked={value.isDaily}
                    onChange={e => onChange({ ...value, isDaily: e.target.checked })}
                />
                Use for daily notes (only one template can hold this)
            </label>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                Placeholders: {PLACEHOLDERS.join(" ")}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onSave} disabled={saving} style={{ fontWeight: 600 }}>
                    {saving ? "Saving..." : "Save template"}
                </button>
                <button onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}

export default function Templates() {
    const [templates, setTemplates] = useState([]);
    const [draft, setDraft] = useState(null); // { id?, ...fields }
    const [err, setErr] = useState("");
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const nav = useNavigate();

    async function load() {
        setErr("");
        try {
            setTemplates(await apiFetch("/api/templates"));
        } catch (e) {
            setErr(e.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    async function save() {
        if (!draft.name.trim()) { setErr("A template needs a name."); return; }
        setErr("");
        setSaving(true);
        try {
            if (draft.id) {
                await apiFetch(`/api/templates/${draft.id}`, { method: "PUT", body: draft });
            } else {
                await apiFetch("/api/templates", { method: "POST", body: draft });
            }
            setDraft(null);
            await load();
        } catch (e) {
            setErr(e.message);
        } finally {
            setSaving(false);
        }
    }

    async function remove(tpl) {
        if (!confirm(`Delete the "${tpl.name}" template? Notes made from it are kept.`)) return;
        setErr("");
        try {
            await apiFetch(`/api/templates/${tpl.id}`, { method: "DELETE" });
            await load();
        } catch (e) { setErr(e.message); }
    }

    async function use(tpl) {
        setErr("");
        try {
            const res = await apiFetch(`/api/templates/${tpl.id}/apply`, {
                method: "POST",
                body: { date: new Date().toLocaleDateString("en-CA") }, // local YYYY-MM-DD
            });
            nav(`/notes/${res.id}`);
        } catch (e) { setErr(e.message); }
    }

    return (
        <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 style={{ flex: 1, margin: 0 }}>Templates</h2>
                <Link to="/" style={{ fontSize: 12, color: "var(--color-text-muted)" }}>← Notes</Link>
                {!draft && <button onClick={() => setDraft({ ...EMPTY })}>+ New template</button>}
            </div>

            {err && <div style={{ color: "var(--color-danger)" }}>{err}</div>}

            {draft && (
                <TemplateForm
                    value={draft}
                    onChange={setDraft}
                    onSave={save}
                    onCancel={() => { setDraft(null); setErr(""); }}
                    saving={saving}
                />
            )}

            {loading ? (
                <div>Loading...</div>
            ) : templates.length === 0 && !draft ? (
                <div style={{ opacity: 0.6, textAlign: "center", padding: 24 }}>
                    No templates yet. Create one to start new notes from a fixed shape.
                </div>
            ) : (
                templates.map(tpl => (
                    <div key={tpl.id} style={{ padding: 12, border: "1px solid var(--color-border)", borderRadius: 8, display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700 }}>{tpl.name}</span>
                            {tpl.isDaily && (
                                <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 10, background: "var(--color-accent)", color: "#fff" }}>
                                    daily
                                </span>
                            )}
                            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                                <button onClick={() => use(tpl)} style={{ fontWeight: 600 }}>Use</button>
                                <button onClick={() => setDraft({ ...tpl })}>Edit</button>
                                <button onClick={() => remove(tpl)} style={{ color: "var(--color-danger)" }}>Delete</button>
                            </div>
                        </div>
                        {tpl.title && (
                            <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Title: {tpl.title}</div>
                        )}
                        {tpl.content && (
                            <pre style={{
                                margin: 0, padding: 8, background: "var(--color-surface)", borderRadius: 4,
                                fontSize: 12, maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap",
                            }}>
                                {tpl.content}
                            </pre>
                        )}
                        <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--color-text-muted)" }}>
                            {tpl.tags && <span>#{tpl.tags.split(",").join(" #")}</span>}
                            {tpl.folder && <span>📁 {tpl.folder}</span>}
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}
