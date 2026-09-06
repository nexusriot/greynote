import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { ThemeProvider, useTheme } from "./theme";
import CommandPalette from "./components/CommandPalette";
import Login from "./pages/Login";
import Notes from "./pages/Notes";
import NoteEdit from "./pages/NoteEdit";
import ShareView from "./pages/ShareView";
import AdminUsers from "./pages/AdminUsers";
import Sessions from "./pages/Sessions";
import Settings from "./pages/Settings";
import Stats from "./pages/Stats";
import Trash from "./pages/Trash";
import Tags from "./pages/Tags";
import NewNote from "./pages/NewNote";
import Templates from "./pages/Templates";
import Daily from "./pages/Daily";

function Shell({ children }) {
    const { me, loading, logout } = useAuth();
    const { dark, toggle } = useTheme();
    const [paletteOpen, setPaletteOpen] = useState(false);

    useEffect(() => {
        function onKey(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === "k") {
                e.preventDefault();
                if (me) setPaletteOpen(p => !p);
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [me]);

    return (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
            <header style={{
                display: "flex", gap: 12, alignItems: "center", marginBottom: 16,
                paddingBottom: 12, borderBottom: "1px solid var(--color-border)",
            }}>
                <Link to="/" style={{ fontWeight: 700, textDecoration: "none", color: "inherit" }}>
                    Notes
                </Link>

                {!loading && me && (
                    <button
                        onClick={() => setPaletteOpen(true)}
                        title="Quick open (Ctrl+K)"
                        style={{ fontSize: 13, padding: "3px 10px", opacity: 0.7 }}
                    >
                        ⌕ Jump to...
                    </button>
                )}

                {!loading && me && (
                    <>
                        <Link to="/daily" style={{ textDecoration: "none", color: "var(--color-text-muted)", fontSize: 14 }}>
                            Journal
                        </Link>
                        <Link to="/templates" style={{ textDecoration: "none", color: "var(--color-text-muted)", fontSize: 14 }}>
                            Templates
                        </Link>
                        <Link to="/tags" style={{ textDecoration: "none", color: "var(--color-text-muted)", fontSize: 14 }}>
                            Tags
                        </Link>
                        <Link to="/trash" style={{ textDecoration: "none", color: "var(--color-text-muted)", fontSize: 14 }}>
                            Trash
                        </Link>
                        <Link to="/stats" style={{ textDecoration: "none", color: "var(--color-text-muted)", fontSize: 14 }}>
                            Stats
                        </Link>
                    </>
                )}

                {!loading && me?.isAdmin && (
                    <Link to="/admin/users" style={{ textDecoration: "none", color: "var(--color-text-muted)", fontSize: 14 }}>
                        Users
                    </Link>
                )}

                <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
                    <button
                        onClick={toggle}
                        title={dark ? "Light mode" : "Dark mode"}
                        style={{ fontSize: 16, padding: "2px 8px" }}
                    >
                        {dark ? "☀️" : "🌙"}
                    </button>

                    {loading ? null : me ? (
                        <>
                            <Link to="/settings" style={{ textDecoration: "none", color: "var(--color-text-muted)", fontSize: 13 }} title="Account settings">
                                {me.email}
                            </Link>
                            <button onClick={logout}>Logout</button>
                        </>
                    ) : (
                        <Link to="/login">Login</Link>
                    )}
                </div>
            </header>

            {children}

            {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
        </div>
    );
}

function RequireAuth({ children }) {
    const { me, loading } = useAuth();
    if (loading) return <div>Loading...</div>;
    if (!me) return <Navigate to="/login" replace />;
    return children;
}

export default function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <BrowserRouter>
                    <Shell>
                        <Routes>
                            <Route path="/login" element={<Login />} />
                            <Route path="/admin/users" element={<RequireAuth><AdminUsers /></RequireAuth>} />
                            <Route path="/sessions" element={<RequireAuth><Sessions /></RequireAuth>} />
                            <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
                            <Route path="/stats" element={<RequireAuth><Stats /></RequireAuth>} />
                            <Route path="/tags" element={<RequireAuth><Tags /></RequireAuth>} />
                            <Route path="/trash" element={<RequireAuth><Trash /></RequireAuth>} />
                            <Route path="/new" element={<RequireAuth><NewNote /></RequireAuth>} />
                            <Route path="/templates" element={<RequireAuth><Templates /></RequireAuth>} />
                            <Route path="/daily" element={<RequireAuth><Daily /></RequireAuth>} />
                            <Route path="/" element={<RequireAuth><Notes /></RequireAuth>} />
                            <Route path="/notes/:id" element={<RequireAuth><NoteEdit /></RequireAuth>} />
                            <Route path="/share/:token" element={<ShareView />} />
                        </Routes>
                    </Shell>
                </BrowserRouter>
            </AuthProvider>
        </ThemeProvider>
    );
}
