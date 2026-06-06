"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogIn } from "lucide-react";
import { apiFetch } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      router.push("/rooms");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    }
  }

  return (
    <main className="page">
      <form className="form card" onSubmit={submit}>
        <h1>登录</h1>
        <div className="field">
          <label>用户名</label>
          <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} />
        </div>
        <div className="field">
          <label>密码</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="error">{error}</div>
        <button className="btn btnPrimary" type="submit">
          <LogIn size={18} /> 登录
        </button>
        <Link className="muted" href="/register">
          还没有账号？去注册
        </Link>
      </form>
    </main>
  );
}
