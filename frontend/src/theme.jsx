import { createContext, useContext, useEffect, useState } from "react";

const ThemeCtx = createContext(null);

export function ThemeProvider({ children }) {
    const [dark, setDark] = useState(() => {
        try { return localStorage.getItem("theme") === "dark"; } catch { return false; }
    });

    useEffect(() => {
        document.documentElement.dataset.theme = dark ? "dark" : "";
        try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
    }, [dark]);

    return (
        <ThemeCtx.Provider value={{ dark, toggle: () => setDark(d => !d) }}>
            {children}
        </ThemeCtx.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeCtx);
}
