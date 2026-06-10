"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import type { AuthUser, RoomSummaryDto } from "@friends-poker/shared";
import { apiFetch, getMe } from "../../lib/api";

export default function RoomsPage() {
  const [rooms, setRooms] = useState<RoomSummaryDto[]>([]);
  const [me, setMe] = useState<AuthUser>();
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const user = await getMe();
    if (!user) {
      location.href = "/login";
      return;
    }
    setMe(user);
    try {
      setRooms(await apiFetch<RoomSummaryDto[]>("/rooms"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }

  async function deleteRoom(roomId: string, name: string) {
    if (!confirm("确定要删除房间 " + name + " 吗？")) return;
    setError("");
    try {
      await apiFetch("/admin/rooms/" + roomId, { method: "DELETE" });
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
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
          <div className="card roomCardWrapper" key={room.id}>
            <Link className="roomCardLink" href={`/table/${room.id}`}>
              <h2>
                {room.name}
                {room.deckType && room.deckType !== "standard" && <span className="dlcBadge">👑 王室战争</span>}
              </h2>
              <div className="statRow">
                <span className="muted">状态</span>
                <strong>{room.status}</strong>
              </div>
              <div className="statRow">
                <span className="muted">人数</span>
                <strong>{room.seatedCount}/{room.maxPlayers}</strong>
              </div>
              <div className="statRow">
                <span className="muted">盲注</span>
                <strong>
                  {room.smallBlind}/{room.bigBlind}
                  {room.ante > 0 ? ` / 前注 ${room.ante}` : ""}
                </strong>
              </div>
              <div className="statRow">
                <span className="muted">开局人数</span>
                <strong>{room.minPlayersToStart}+</strong>
              </div>
              <div className="statRow">
                <span className="muted">行动时间</span>
                <strong>{room.actionTimeoutSeconds} 秒</strong>
              </div>
              <div className="statRow">
                <span className="muted">观战</span>
                <strong>{room.spectatorCount}</strong>
              </div>
            </Link>
            {(me?.role === "ADMIN" || me?.id === room.createdById) && (
              <button
                className="roomDeleteBtn"
                title="删除房间"
                onClick={(e) => {
                  e.preventDefault();
                  deleteRoom(room.id, room.name);
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
