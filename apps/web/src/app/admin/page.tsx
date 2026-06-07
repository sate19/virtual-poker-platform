"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Ban, Coins, Lock, ShieldAlert, Trash2 } from "lucide-react";
import type { AuthUser } from "@friends-poker/shared";
import { apiFetch, getMe } from "../../lib/api";

interface AdminAnalytics {
  overview: {
    totalHands: number;
    totalPot: number;
    averagePot: number;
    largestPot: number;
    showdownHands: number;
    showdownRate: number;
    timeoutActions: number;
    autoFoldCount: number;
    autoCheckCount: number;
    averagePlayersPerHand: number;
  };
  actionBreakdown: Array<{ action: string; count: number }>;
  playerLeaderboard: Array<{
    userId: string;
    username: string;
    displayName: string;
    hands: number;
    handsWon: number;
    winRate: number;
    vpip: number;
    showdownRate: number;
    showdownWinRate: number;
    netVirtualChips: number;
    biggestPotWon: number;
    averageCommitted: number;
    foldRate: number;
  }>;
  roomLeaderboard: Array<{
    roomId: string;
    roomName: string;
    hands: number;
    totalPot: number;
    largestPot: number;
    averagePot: number;
    averagePlayers: number;
  }>;
  insights: string[];
}

interface AdminData {
  users: any[];
  rooms: any[];
  hands: any[];
  actions: any[];
  chats: any[];
  audit: any[];
  analytics: AdminAnalytics;
}

type AccessState = "checking" | "allowed" | "denied";

export default function AdminPage() {
  const [data, setData] = useState<AdminData>();
  const [me, setMe] = useState<AuthUser>();
  const [access, setAccess] = useState<AccessState>("checking");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const user = await getMe();
    if (!user) {
      location.href = "/login";
      return;
    }
    setMe(user);
    if (user.role !== "ADMIN") {
      setAccess("denied");
      setData(undefined);
      return;
    }
    setAccess("allowed");
    try {
      const [users, rooms, hands, actions, chats, audit, analytics] = await Promise.all([
        apiFetch<any[]>("/admin/users"),
        apiFetch<any[]>("/admin/rooms"),
        apiFetch<any[]>("/admin/hands"),
        apiFetch<any[]>("/admin/actions"),
        apiFetch<any[]>("/admin/chats"),
        apiFetch<any[]>("/admin/audit"),
        apiFetch<AdminAnalytics>("/admin/analytics"),
      ]);
      setData({ users, rooms, hands, actions, chats, audit, analytics });
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
    if (room.status === "CLOSED") {
      return;
    }
    await apiFetch(`/admin/rooms/${room.id}/close`, { method: "POST", body: JSON.stringify({}) });
    await load();
  }

  async function deleteRoom(room: any) {
    const confirmed = confirm(`删除房间「${room.name}」后，它将不再出现在后台列表和统计中。确定继续？`);
    if (!confirmed) {
      return;
    }
    await apiFetch(`/admin/rooms/${room.id}`, { method: "DELETE" });
    await load();
  }

  if (access === "checking") {
    return (
      <main className="page widePage">
        <div className="card">正在校验管理员权限</div>
      </main>
    );
  }

  if (access === "denied") {
    return (
      <main className="page widePage">
        <section className="card accessPanel">
          <ShieldAlert size={32} />
          <div>
            <h1>需要管理员账号</h1>
            <p className="muted">
              当前账号 {me?.displayName ?? ""} 没有后台权限。后台数据接口仅允许 ADMIN 角色访问。
            </p>
          </div>
          <Link className="btn btnPrimary" href="/login">
            使用管理员账号登录
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page widePage">
      <div className="sectionTitle">
        <div>
          <h1>管理员后台</h1>
          <p className="muted">用户、房间、牌局和审计数据管理。</p>
        </div>
        <button className="btn" onClick={load}>
          刷新
        </button>
      </div>
      <div className="error">{error}</div>

      <section className="adminGrid adminGridWide">
        <MetricCard label="总手数" value={formatNumber(data?.analytics.overview.totalHands)} />
        <MetricCard label="总底池" value={formatNumber(data?.analytics.overview.totalPot)} />
        <MetricCard label="平均底池" value={formatNumber(data?.analytics.overview.averagePot)} />
        <MetricCard label="摊牌率" value={formatPercent(data?.analytics.overview.showdownRate)} />
        <MetricCard label="最大底池" value={formatNumber(data?.analytics.overview.largestPot)} />
        <MetricCard label="超时处理" value={formatNumber(data?.analytics.overview.timeoutActions)} />
      </section>

      <div className="adminGrid">
        <section className="card adminWideCard">
          <h2>用户</h2>
          <div className="tableScroller">
            <table className="dataTable adminUserTable">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>角色</th>
                  <th>虚拟筹码</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(data?.users ?? []).map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.displayName}</strong>
                      <br />
                      <span className="muted">{user.username}</span>
                    </td>
                    <td>{user.role}</td>
                    <td>{formatNumber(user.virtualChips)}</td>
                    <td>{user.isBanned ? "已禁用" : "正常"}</td>
                    <td className="adminActionsCell">
                      <button className="btn iconOnlyButton" onClick={() => toggleBan(user)} title="禁用或恢复用户">
                        <Ban size={15} />
                      </button>
                      <button className="btn iconOnlyButton" onClick={() => adjustChips(user)} title="调整虚拟筹码">
                        <Coins size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card adminWideCard">
          <h2>玩家表现分析</h2>
          <div className="tableScroller">
            <table className="dataTable analyticsTable">
              <thead>
                <tr>
                  <th>玩家</th>
                  <th>手数</th>
                  <th>胜率</th>
                  <th>VPIP</th>
                  <th>摊牌胜率</th>
                  <th>净变化</th>
                  <th>最大赢池</th>
                </tr>
              </thead>
              <tbody>
                {(data?.analytics.playerLeaderboard ?? []).map((player) => (
                  <tr key={player.userId}>
                    <td>
                      <strong>{player.displayName}</strong>
                      <br />
                      <span className="muted">{player.username}</span>
                    </td>
                    <td>{formatNumber(player.hands)}</td>
                    <td>{formatPercent(player.winRate)}</td>
                    <td>{formatPercent(player.vpip)}</td>
                    <td>{formatPercent(player.showdownWinRate)}</td>
                    <td>{formatNumber(player.netVirtualChips)}</td>
                    <td>{formatNumber(player.biggestPotWon)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card adminWideCard">
          <h2>房间</h2>
          <div className="tableScroller">
            <table className="dataTable adminRoomTable">
              <thead>
                <tr>
                  <th>房间</th>
                  <th>创建人</th>
                  <th>时间</th>
                  <th>状态</th>
                  <th>牌局数据</th>
                  <th>实时盈亏</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rooms ?? []).map((room) => (
                  <tr key={room.id}>
                    <td>
                      <strong>{room.name}</strong>
                      <br />
                      <span className="muted">{room.id}</span>
                    </td>
                    <td>
                      <strong>{room.createdBy?.displayName ?? "-"}</strong>
                      <br />
                      <span className="muted">{room.createdBy?.username ?? ""}</span>
                    </td>
                    <td>
                      <span>开始 {formatDate(room.createdAt)}</span>
                      <br />
                      <span className="muted">结束 {formatDate(room.closedAt) || "-"}</span>
                    </td>
                    <td>
                      <strong>{room.status}</strong>
                      <br />
                      <span className="muted">
                        在线 {formatNumber(room.connectedSeatedCount)} / 入座 {formatNumber(room.seatedCount)}
                      </span>
                    </td>
                    <td>
                      {formatNumber(room.totalHands)} 手
                      <br />
                      <span className="muted">
                        底池 {formatNumber(room.totalPot)} · 最大 {formatNumber(room.largestPot)}
                      </span>
                    </td>
                    <td>
                      <div className="profitList">
                        {(room.profitLoss ?? []).slice(0, 5).map((row: any) => (
                          <div className="profitRow" key={row.userId}>
                            <span>
                              {row.displayName}
                              {row.connected === false ? <small className="muted"> 离线</small> : null}
                            </span>
                            <strong className={row.netVirtualChips >= 0 ? "profitPositive" : "profitNegative"}>
                              {formatSigned(row.netVirtualChips)}
                            </strong>
                          </div>
                        ))}
                        {(room.profitLoss ?? []).length === 0 ? <span className="muted">暂无数据</span> : null}
                      </div>
                    </td>
                    <td className="adminActionsCell">
                      <button
                        className="btn iconOnlyButton"
                        onClick={() => closeRoom(room)}
                        title="关闭房间"
                        disabled={room.status === "CLOSED"}
                      >
                        <Lock size={15} />
                      </button>
                      <button className="btn iconOnlyButton" onClick={() => deleteRoom(room)} title="删除房间">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2>房间数据分析</h2>
          {(data?.analytics.roomLeaderboard ?? []).map((room) => (
            <div className="statRow" key={room.roomId}>
              <span>
                {room.roomName}
                <br />
                <span className="muted">
                  {formatNumber(room.hands)} 手 · 平均 {formatNumber(room.averagePlayers)} 人
                </span>
              </span>
              <strong>{formatNumber(room.averagePot)}</strong>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>数据提示</h2>
          {(data?.analytics.insights ?? []).map((item) => (
            <div className="listRow" key={item}>
              <span>{item}</span>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>行动分布</h2>
          {(data?.analytics.actionBreakdown ?? []).slice(0, 12).map((action) => (
            <div className="statRow" key={action.action}>
              <span>{action.action}</span>
              <strong>{formatNumber(action.count)}</strong>
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
              <span className="muted">底池 {formatNumber(hand.potTotal)}</span>
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

function MetricCard({ label, value }: { label: string; value?: string }) {
  return (
    <section className="card metricCard">
      <span className="muted">{label}</span>
      <strong>{value ?? "0"}</strong>
    </section>
  );
}

function formatNumber(value?: number): string {
  return Math.round(value ?? 0).toLocaleString("zh-CN");
}

function formatPercent(value?: number): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function formatSigned(value?: number): string {
  const rounded = Math.round(value ?? 0);
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("zh-CN")}`;
}

function formatDate(value?: string | null): string {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
