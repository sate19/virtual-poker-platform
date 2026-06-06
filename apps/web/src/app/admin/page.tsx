"use client";

import { useEffect, useState } from "react";
import { Ban, Coins, Lock } from "lucide-react";
import { apiFetch, getMe } from "../../lib/api";

interface AdminData {
  users: any[];
  rooms: any[];
  hands: any[];
  actions: any[];
  chats: any[];
  audit: any[];
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData>();
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const user = await getMe();
    if (!user) {
      location.href = "/login";
      return;
    }
    if (user.role !== "ADMIN") {
      setError("需要管理员权限");
      return;
    }
    try {
      const [users, rooms, hands, actions, chats, audit] = await Promise.all([
        apiFetch<any[]>("/admin/users"),
        apiFetch<any[]>("/admin/rooms"),
        apiFetch<any[]>("/admin/hands"),
        apiFetch<any[]>("/admin/actions"),
        apiFetch<any[]>("/admin/chats"),
        apiFetch<any[]>("/admin/audit"),
      ]);
      setData({ users, rooms, hands, actions, chats, audit });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleBan(user: any) {
    await apiFetch(`/admin/users/${user.id}/ban`, {
      method: "POST",
      body: JSON.stringify({ banned: !user.isBanned }),
    });
    await load();
  }

  async function adjustChips(user: any) {
    const value = prompt("调整虚拟筹码数量，可为负数", "1000");
    if (!value) {
      return;
    }
    await apiFetch(`/admin/users/${user.id}/chips`, {
      method: "POST",
      body: JSON.stringify({ delta: Number(value), reason: "管理员后台调整" }),
    });
    await load();
  }

  async function closeRoom(room: any) {
    await apiFetch(`/admin/rooms/${room.id}/close`, { method: "POST", body: JSON.stringify({}) });
    await load();
  }

  return (
    <main className="page widePage">
      <div className="sectionTitle">
        <h1>管理员后台</h1>
        <button className="btn" onClick={load}>
          刷新
        </button>
      </div>
      <div className="error">{error}</div>
      <div className="adminGrid">
        <section className="card">
          <h2>用户</h2>
          <table className="dataTable">
            <thead>
              <tr>
                <th>用户名</th>
                <th>角色</th>
                <th>虚拟筹码</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {(data?.users ?? []).map((user) => (
                <tr key={user.id}>
                  <td>
                    {user.displayName}
                    <br />
                    <span className="muted">{user.username}</span>
                  </td>
                  <td>{user.role}</td>
                  <td>{user.virtualChips}</td>
                  <td>
                    <button className="btn" onClick={() => toggleBan(user)} title="禁用或恢复用户">
                      <Ban size={15} />
                    </button>{" "}
                    <button className="btn" onClick={() => adjustChips(user)} title="调整虚拟筹码">
                      <Coins size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>房间</h2>
          {(data?.rooms ?? []).map((room) => (
            <div className="listRow" key={room.id}>
              <span>
                {room.name}
                <br />
                <span className="muted">{room.status}</span>
              </span>
              <button className="btn" onClick={() => closeRoom(room)} title="强制关闭房间">
                <Lock size={15} />
              </button>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>牌局历史</h2>
          {(data?.hands ?? []).map((hand) => (
            <div className="listRow" key={hand.id}>
              <span>
                {hand.room?.name} #{hand.handNumber}
              </span>
              <span className="muted">底池 {hand.potTotal}</span>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>行动日志</h2>
          {(data?.actions ?? []).slice(0, 60).map((action) => (
            <div className="listRow" key={action.id}>
              <span>{action.action}</span>
              <span className="muted">{action.amount ?? ""}</span>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>聊天记录</h2>
          {(data?.chats ?? []).slice(0, 60).map((chat) => (
            <div className="chatLine" key={chat.id}>
              <strong>{chat.user?.displayName}</strong>
              <div>{chat.message}</div>
              <small className="muted">{chat.room?.name}</small>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>审计日志</h2>
          {(data?.audit ?? []).map((entry) => (
            <div className="listRow" key={entry.id}>
              <span>{entry.action}</span>
              <span className="muted">{entry.actor?.displayName}</span>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
