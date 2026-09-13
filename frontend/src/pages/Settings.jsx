import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { useAuth } from "../auth";
import { appVersion, versionLine } from "../version";

function Section({ title, children }) {
    return (
        <div style={{ padding: 16, border: "1px solid var(--color-border)", borderRadius: 8, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 700 }}>{title}</div>
            {children}
        </div>
    );
}

export default function Settings() {
    const nav = useNavigate();
    const { logout } = useAuth();

    const [currentPw, setCurrentPw] = useState("");
    const [newPw, setNewPw] = useState("");
    const [confirmPw, setConfirmPw] = useState("");
    const [pwMsg, setPwMsg] = useState(null); // { ok: bool, text: string }

    const [deletePw, setDeletePw] = useState("");
    const [deleteMsg, setDeleteMsg] = useState("");

    const [serverVersion, setServerVersion] = useState(null);

    useEffect(() => {
        let cancelled = false;
        apiFetch("/api/version")
            .then(res => { if (!cancelled) setServerVersion(res?.version || ""); })
            .catch(() => { if (!cancelled) setServerVersion(""); });
        return () => { cancelled = true; };
    }, []);

    async function changePassword(e) {
        e.preventDefault();
        setPwMsg(null);
        if (newPw.length < 6) { setPwMsg({ ok: false, text: "New password must be at least 6 characters." }); return; }
        if (newPw !== confirmPw) { setPwMsg({ ok: false, text: "New passwords do not match." }); return; }
        try {
            await apiFetch("/api/account/password", {
                method: "PUT",
                body: { currentPassword: currentPw, newPassword: newPw },
            });
            setPwMsg({ ok: true, text: "Password changed." });
            setCurrentPw(""); setNewPw(""); setConfirmPw("");
        } catch (e) {
            setPwMsg({ ok: false, text: e.message });
        }
    }

    async function deleteAccount(e) {
        e.preventDefault();
        setDeleteMsg("");
        if (!confirm("Permanently delete your account and all your notes? This cannot be undone.")) return;
        try {
            await apiFetch("/api/account", {
                method: "DELETE",
                body: { password: deletePw },
            });
            await logout();
            nav("/login");
        } catch (e) {
            setDeleteMsg(e.message);
        }
    }

    return (
        <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={() => nav("/")}>← Back</button>
                <span style={{ fontWeight: 700 }}>Account settings</span>
            </div>

            <Section title="Change password">
                <form onSubmit={changePassword} style={{ display: "grid", gap: 8 }}>
                    <input
                        type="password"
                        placeholder="Current password"
                        value={currentPw}
                        onChange={e => setCurrentPw(e.target.value)}
                        required
                        style={{ padding: 8 }}
                    />
                    <input
                        type="password"
                        placeholder="New password (min 6 chars)"
                        value={newPw}
                        onChange={e => setNewPw(e.target.value)}
                        required
                        style={{ padding: 8 }}
                    />
                    <input
                        type="password"
                        placeholder="Confirm new password"
                        value={confirmPw}
                        onChange={e => setConfirmPw(e.target.value)}
                        required
                        style={{ padding: 8 }}
                    />
                    {pwMsg && (
                        <div style={{ color: pwMsg.ok ? "var(--color-accent)" : "var(--color-danger)", fontSize: 13 }}>
                            {pwMsg.text}
                        </div>
                    )}
                    <button type="submit" style={{ alignSelf: "start" }}>Change password</button>
                </form>
            </Section>

            <Section title="About">
                <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
                    {serverVersion === null ? "Checking the server…" : versionLine(appVersion, serverVersion)}
                </p>
            </Section>

            <Section title="Danger zone">
                <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>
                    Deleting your account permanently removes all your notes, sessions, and account data.
                    This cannot be undone.
                </p>
                <form onSubmit={deleteAccount} style={{ display: "grid", gap: 8 }}>
                    <input
                        type="password"
                        placeholder="Confirm with your password"
                        value={deletePw}
                        onChange={e => setDeletePw(e.target.value)}
                        required
                        style={{ padding: 8 }}
                    />
                    {deleteMsg && <div style={{ color: "var(--color-danger)", fontSize: 13 }}>{deleteMsg}</div>}
                    <button type="submit" style={{ alignSelf: "start", color: "var(--color-danger)", borderColor: "var(--color-danger)" }}>
                        Delete my account
                    </button>
                </form>
            </Section>
        </div>
    );
}
