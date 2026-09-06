import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../api";

// NewNote creates a note and jumps straight into the editor. It backs the
// "create this note" destination of an unresolved [[wiki link]].
export default function NewNote() {
    const [params] = useSearchParams();
    const nav = useNavigate();
    const [err, setErr] = useState("");
    const started = useRef(false);

    const title = params.get("title") || "New note";

    useEffect(() => {
        if (started.current) return;
        started.current = true;

        (async () => {
            try {
                const res = await apiFetch("/api/notes", {
                    method: "POST",
                    body: { title, content: "", tags: "" },
                });
                nav(`/notes/${res.id}`, { replace: true });
            } catch (e) {
                setErr(e.message);
            }
        })();
    }, [title, nav]);

    if (err) return <div style={{ color: "var(--color-danger)" }}>{err}</div>;
    return <div>Creating "{title}"...</div>;
}
