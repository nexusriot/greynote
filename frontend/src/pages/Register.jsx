import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export default function Register() {
    const { register } = useAuth();
    const nav = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [err, setErr] = useState("");

    async function onSubmit(e) {
        e.preventDefault();
        setErr("");
        try {
            await register(email, password);
            nav("/");
        } catch (e) {
            setErr(e.message);
        }
    }

    return (
        <div>
            <h2>Register</h2>
            {err && <div style={{ color: "crimson" }}>{err}</div>}
            <form onSubmit={onSubmit} style={{ display: "grid", gap: 8, maxWidth: 360 }}>
                <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <input placeholder="password (min 6)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="submit">Create account</button>
            </form>
            <p>
                Have an account? <Link to="/login">Login</Link>
            </p>
        </div>
    );
}
