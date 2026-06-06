"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { apiFetch } from "../../lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, displayName, password }),
      });
      router.push("/rooms");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    }
  }

  return (
    <main className="page">
      <form className="form card" onSubmit={submit}>
        <h1>注册</h1>
        <div className="field">
          <label>用户名</label>
          <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} />
        </div>
        <div className="field">
          <label>显示名称</label>
          <input className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
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
          <UserPlus size={18} /> 注册并登录
        </button>
      </form>
    </main>
  );
}
