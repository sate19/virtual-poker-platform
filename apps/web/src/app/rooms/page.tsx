"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import type { RoomSummaryDto } from "@friends-poker/shared";
import { apiFetch, getMe } from "../../lib/api";

export default function RoomsPage() {
  const [rooms, setRooms] = useState<RoomSummaryDto[]>([]);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const user = await getMe();
    if (!user) {
      location.href = "/login";
      return;
    }
    try {
      setRooms(await apiFetch<RoomSummaryDto[]>("/rooms"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="page">
      <div className="sectionTitle">
        <div>
          <h1>房间列表</h1>
          <p className="muted">现金桌模式，2–9 人一桌，观战者不能看到暗牌。</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={load} title="刷新房间列表">
            <RefreshCw size={17} /> 刷新
          </button>
          <Link className="btn btnPrimary" href="/rooms/new">
            <Plus size={17} /> 创建房间
          </Link>
        </div>
      </div>
      <div className="error">{error}</div>
      <div className="grid">
        {rooms.map((room) => (
          <Link className="card" href={`/table/${room.id}`} key={room.id}>
            <h2>{room.name}</h2>
            <div className="statRow">
              <span className="muted">状态</span>
              <strong>{room.status}</strong>
            </div>
            <div className="statRow">
              <span className="muted">人数</span>
              <strong>
                {room.seatedCount}/{room.maxPlayers}
              </strong>
            </div>
            <div className="statRow">
              <span className="muted">盲注</span>
              <strong>
                {room.smallBlind}/{room.bigBlind}
              </strong>
            </div>
            <div className="statRow">
              <span className="muted">观战</span>
              <strong>{room.spectatorCount}</strong>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
