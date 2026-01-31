import React from "react";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Login from "./pages/Login";
// import Register from "./pages/Register";
import Notes from "./pages/Notes";
import NoteEdit from "./pages/NoteEdit";
import ShareView from "./pages/ShareView";
import AdminUsers from "./pages/AdminUsers";

function Shell({ children }) {
    const { me, loading, logout } = useAuth();
    return (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
            <header style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
                <Link to="/" style={{ fontWeight: 700, textDecoration: "none" }}>Notes</Link>
                <div style={{ marginLeft: "auto" }}>
                    {loading ? null : me ? (
                        <>
                            <span style={{ marginRight: 12 }}>{me.email}</span>
                            <button onClick={logout}>Logout</button>
                        </>
                    ) : (
                        <Link to="/login">Login</Link>
                    )}
                </div>
            </header>
            {children}
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
        <AuthProvider>
            <BrowserRouter>
                <Shell>
                    <Routes>
                        <Route path="/login" element={<Login />} />
                        {/*<Route path="/register" element={<Register />} />*/}
                        <Route path="/admin/users" element={<AdminUsers />} />

                        <Route
                            path="/"
                            element={
                                <RequireAuth>
                                    <Notes />
                                </RequireAuth>
                            }
                        />
                        <Route
                            path="/notes/:id"
                            element={
                                <RequireAuth>
                                    <NoteEdit />
                                </RequireAuth>
                            }
                        />

                        {/* public share page */}
                        <Route path="/share/:token" element={<ShareView />} />
                    </Routes>
                </Shell>
            </BrowserRouter>
        </AuthProvider>
    );
}
