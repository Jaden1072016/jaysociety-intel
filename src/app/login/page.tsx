"use client";
import { useActionState } from "react";
import { login } from "../actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, {} as { error?: string });
  return (
    <main className="wrap" style={{ maxWidth: 380, paddingTop: "18vh" }}>
      <div className="brand"><img src="/icons/icon-192.png" alt="" /><div><h1>Jay Society Intel</h1><span>Private</span></div></div>
      <form action={action} className="card">
        <label>Password<input type="password" name="password" autoComplete="current-password" autoFocus required /></label>
        {state?.error && <p style={{ color: "var(--bad)", fontSize: "0.85rem" }}>{state.error}</p>}
        <button className="primary" disabled={pending}>{pending ? "Checking…" : "Sign in"}</button>
      </form>
    </main>
  );
}
