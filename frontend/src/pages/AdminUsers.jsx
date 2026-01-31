import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

function fmt(dt) {
    try { return new Date(dt).toLocaleString(); } catch { return dt; }
}

export default function AdminUsers() {
    const nav = useNavigate();

    const [me, setMe] = useState(null);
    const [users, setUsers] = useState([]);
    const [err, setErr] = useState("");

    // create form
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isAdmin, setIsAdmin] = useState(false);

    async function loadMe() {
        const m = await apiFetch("/api/me");
        setMe(m);
        return m;
    }

    async function loadUsers() {
        const list = await apiFetch("/api/admin/users");
        setUsers(list);
    }

    async function refresh() {
        setErr("");
        try {
            const m = await loadMe();
            if (!m.isAdmin) {
                setErr("Admin only");
                return;
            }
            await loadUsers();
        } catch (e) {
            setErr(e.message);
        }
    }

    useEffect(() => { refresh(); }, []);

    async function createUser() {
        setErr("");
        try {
            await apiFetch("/api/admin/users", {
                method: "POST",
                body: { email, password, isAdmin },
            });
            setEmail("");
            setPassword("");
            setIsAdmin(false);
            await loadUsers();
        } catch (e) {
            setErr(e.message);
        }
    }

    async function toggleAdmin(u) {
        setErr("");
        try {
            await apiFetch(`/api/admin/users/${u.id}/admin`, {
                method: "PUT",
                body: { isAdmin: !u.isAdmin },
            });
            await loadUsers();
        } catch (e) {
            setErr(e.message);
        }
    }

    async function deleteUser(u) {
        if (!confirm(`Delete user ${u.email}? This also deletes their notes.`)) return;
        setErr("");
        try {
            await apiFetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
            await loadUsers();
        } catch (e) {
            setErr(e.message);
        }
    }

    if (err) return <div style={{ color: "crimson" }}>{err}</div>;
    if (!me) return <div>Loading...</div>;

    if (!me.isAdmin) {
        return (
            <div style={{ display: "grid", gap: 10 }}>
                <div>Admin only.</div>
                <button onClick={() => nav("/")}>← Back</button>
            </div>
        );
    }

    return (
        <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={() => nav("/")}>← Back</button>
                <div style={{ fontWeight: 700 }}>Users</div>
            </div>

            <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>Create user</div>

                <input
                    placeholder="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{ padding: 8 }}
                />
                <input
                    placeholder="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    style={{ padding: 8 }}
                />
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                        type="checkbox"
                        checked={isAdmin}
                        onChange={(e) => setIsAdmin(e.target.checked)}
                    />
                    Admin
                </label>

                <button onClick={createUser} disabled={!email || password.length < 6}>
                    Create
                </button>
            </div>

            <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Existing users</div>

                <div style={{ display: "grid", gap: 8 }}>
                    {users.map((u) => (
                        <div key={u.id} style={{ display: "grid", gap: 6, padding: 10, border: "1px solid #eee", borderRadius: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                <div style={{ fontWeight: 600 }}>{u.email}</div>
                                <div style={{ opacity: 0.7 }}>id: {u.id}</div>
                            </div>

                            <div style={{ display: "flex", gap: 12, opacity: 0.8, fontSize: 12 }}>
                                <span>Created: {fmt(u.createdAt)}</span>
                                <span>Role: {u.isAdmin ? "Admin" : "User"}</span>
                            </div>

                            <div style={{ display: "flex", gap: 8 }}>
                                <button
                                    onClick={() => toggleAdmin(u)}
                                    disabled={u.id === me.userId} // don’t allow toggling yourself via UI
                                >
                                    {u.isAdmin ? "Remove Admin" : "Make Admin"}
                                </button>

                                <button
                                    onClick={() => deleteUser(u)}
                                    disabled={u.id === me.userId}
                                    style={{ marginLeft: "auto" }}
                                >
                                    Delete user
                                </button>
                            </div>

                            {u.id === me.userId && (
                                <div style={{ fontSize: 12, opacity: 0.7 }}>
                                    (You)
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
