"use client";

import { useEffect, useState } from "react";
import { apiFetch, getMe } from "../../lib/api";

interface StatsPayload {
  stats: {
    totalHands: number;
    handsWon: number;
    voluntarilyPutInPot: number;
    showdownCount: number;
    showdownWins: number;
    netVirtualChips: number;
    biggestPotWon: number;
    tournamentsPlayed: number;
    tournamentsWon: number;
  };
  recentHands: Array<{
    id: string;
    seatIndex: number;
    startingStack: number;
    endingStack: number;
    totalCommitted: number;
    wonAmount: number;
    hand: { handNumber: number; potTotal: number; room: { name: string } };
  }>;
}

export default function ProfilePage() {
  const [data, setData] = useState<StatsPayload>();

  useEffect(() => {
    async function load() {
      const user = await getMe();
      if (!user) {
        location.href = "/login";
        return;
      }
      setData(await apiFetch<StatsPayload>("/stats/me"));
    }
    void load();
  }, []);

  const stats = data?.stats;
  return (
    <main className="page">
      <div className="sectionTitle">
        <h1>个人统计</h1>
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
            <span>
              {item.hand.room.name} #{item.hand.handNumber}
            </span>
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

function rate(win: number, total: number) {
  return total === 0 ? 0 : Math.round((win / total) * 1000) / 10;
}
