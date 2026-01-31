import React, { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
    const [me, setMe] = useState(null);
    const [loading, setLoading] = useState(true);

    async function refresh() {
        try {
            const data = await apiFetch("/api/me");
            setMe(data);
        } catch {
            setMe(null);
        } finally {
            setLoading(false);
        }
    }

    async function login(email, password) {
        await apiFetch("/api/login", { method: "POST", body: { email, password } });
        await refresh();
    }

    async function register(email, password) {
        await apiFetch("/api/register", { method: "POST", body: { email, password } });
        await login(email, password);
    }

    async function logout() {
        await apiFetch("/api/logout", { method: "POST" });
        setMe(null);
    }

    useEffect(() => { refresh(); }, []);

    return (
        <AuthCtx.Provider value={{ me, loading, login, register, logout, refresh }}>
            {children}
        </AuthCtx.Provider>
    );
}

export function useAuth() {
    return useContext(AuthCtx);
}
