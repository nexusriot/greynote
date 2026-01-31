import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

import { apiFetch } from "../api";

export default function ShareView() {
    const { token } = useParams();
    const [note, setNote] = useState(null);
    const [err, setErr] = useState("");

    useEffect(() => {
        (async () => {
            try {
                const n = await apiFetch(`/api/share/${token}`);
                setNote(n);
            } catch (e) {
                setErr(e.message);
            }
        })();
    }, [token]);

    if (err) return <div style={{ color: "crimson" }}>{err}</div>;
    if (!note) return <div>Loading...</div>;

    return (
        <div>
            <div style={{ marginBottom: 12 }}>
                <Link to="/">Go to app</Link>
            </div>
            <h2>{note.title}</h2>
            <pre style={{ whiteSpace: "pre-wrap", padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {note.content}
        </ReactMarkdown>
      </pre>
        </div>
    );
}
