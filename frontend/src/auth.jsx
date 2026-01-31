import React, { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
    const [me, setMe] = useState(null);
    const [loading, setLoading] = useState(true);

    async function refreshMe() {
        try {
            const m = await apiFetch("/api/me");
            setMe(m);
            return m;
        } catch {
            setMe(null);
            return null;
        }
    }

    async function login(email, password) {
        await apiFetch("/api/login", {
            method: "POST",
            body: { email, password },
        });
        await refreshMe();
    }

    async function logout() {
        await apiFetch("/api/logout", { method: "POST" });
        setMe(null);
    }

    useEffect(() => {
        (async () => {
            await refreshMe();
            setLoading(false);
        })();
    }, []);

    return (
        <AuthCtx.Provider value={{ me, loading, login, logout, refreshMe }}>
            {children}
        </AuthCtx.Provider>
    );
}

export function useAuth() {
    const v = useContext(AuthCtx);
    if (!v) throw new Error("useAuth must be used inside AuthProvider");
    return v;
}
