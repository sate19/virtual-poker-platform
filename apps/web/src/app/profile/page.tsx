"use client";

import { useEffect, useState } from "react";
import type { AuthUser } from "@friends-poker/shared";
import { apiFetch, getMe } from "../../lib/api";

interface StatsPayload {
  stats: {
    totalHands: number; handsWon: number; voluntarilyPutInPot: number;
    showdownCount: number; showdownWins: number; netVirtualChips: number;
    biggestPotWon: number; tournamentsPlayed: number; tournamentsWon: number;
  };
  recentHands: Array<{
    id: string; seatIndex: number; startingStack: number; endingStack: number;
    totalCommitted: number; wonAmount: number;
    hand: { handNumber: number; potTotal: number; room: { name: string } };
  }>;
}

export default function ProfilePage() {
  const [me, setMe] = useState<AuthUser>();
  const [data, setData] = useState<StatsPayload>();
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    async function load() {
      const user = await getMe();
      if (!user) { location.href = "/login"; return; }
      setMe(user);
      setDisplayName(user.displayName);
      setData(await apiFetch<StatsPayload>("/stats/me"));
    }
    void load();
  }, []);

  async function saveName() {
    setMsg(""); setSaving(true);
    try {
      const updated = await apiFetch<AuthUser>("/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      setMe(updated);
      setMsg("昵称已更新");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "更新失败");
    } finally {
      setSaving(false);
    }
  }

  const stats = data?.stats;
  return (
    <main className="page">
      <div className="sectionTitle">
        <h1>个人主页</h1>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>个人信息</h2>
        <div className="statRow">
          <span className="muted">账号</span>
          <strong>{me?.username}</strong>
        </div>
        <div className="statRow">
          <span className="muted">牌桌昵称</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="input"
              value={displayName}
              maxLength={24}
              onChange={(e) => setDisplayName(e.target.value)}
              style={{ width: 200 }}
            />
            <button className="btn btnPrimary" disabled={saving || !displayName.trim()} onClick={saveName}>
              保存
            </button>
          </div>
        </div>
        {msg && <p className={msg.includes("失败") ? "error" : "muted"} style={{ margin: "8px 0 0" }}>{msg}</p>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>账户筹码</h2>
        <div className="statRow">
          <span className="muted">当前筹码</span>
          <strong>{me?.virtualChips ?? 0}</strong>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input
            className="input"
            type="number"
            min={1}
            placeholder="购码数量"
            id="buyAmount"
            style={{ width: 160 }}
          />
          <button className="btn btnPrimary" onClick={async () => {
            const el = document.getElementById("buyAmount") as HTMLInputElement;
            const amount = Number(el?.value);
            if (!amount || amount < 1) { setMsg("请输入有效数量"); return; }
            setMsg(""); setSaving(true);
            try {
              const res = await apiFetch<{ virtualChips: number }>("/auth/me/buy-chips", {
                method: "POST",
                body: JSON.stringify({ amount }),
              });
              setMe((prev) => prev ? { ...prev, virtualChips: res.virtualChips } : prev);
              setMsg(`成功购买 ${amount} 筹码`);
              el.value = "";
            } catch (err) {
              setMsg(err instanceof Error ? err.message : "购买失败");
            } finally { setSaving(false); }
          }} disabled={saving}>
            购买筹码
          </button>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>基础数据</h2>
          <Stat label="总手数" value={stats?.totalHands} />
          <Stat label="获胜手数" value={stats?.handsWon} />
          <Stat label="入局次数" value={stats?.voluntarilyPutInPot} />
          <Stat label="摊牌次数" value={stats?.showdownCount} />
          <Stat label="摊牌胜率" value={stats ? `${rate(stats.showdownWins, stats.showdownCount)}%` : "-"} />
          <Stat label="总虚拟筹码盈亏" value={stats?.netVirtualChips} />
          <Stat label="最大赢得底池" value={stats?.biggestPotWon} />
        </div>
        <div className="card">
          <h2>锦标赛预留</h2>
          <Stat label="参与次数" value={stats?.tournamentsPlayed} />
          <Stat label="获胜次数" value={stats?.tournamentsWon} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>最近对局</h2>
        {(data?.recentHands ?? []).map((item) => (
          <div className="listRow" key={item.id}>
            <span>{item.hand.room.name} #{item.hand.handNumber}</span>
            <span className="muted">
              底池 {item.hand.potTotal} · {item.startingStack} → {item.endingStack}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value?: number | string }) {
  return (
    <div className="statRow">
      <span className="muted">{label}</span>
      <strong>{value ?? "-"}</strong>
    </div>
  );
}

function rate(win: number, total: number) { return total === 0 ? 0 : Math.round((win / total) * 1000) / 10; }
