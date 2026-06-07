"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { apiFetch } from "../../../lib/api";

type NumericRoomKey =
  | "maxPlayers"
  | "minPlayersToStart"
  | "smallBlind"
  | "bigBlind"
  | "ante"
  | "minBuyIn"
  | "maxBuyIn"
  | "actionTimeoutSeconds";

export default function NewRoomPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "标准牌局",
    maxPlayers: 9,
    minPlayersToStart: 2,
    smallBlind: 5,
    bigBlind: 10,
    ante: 0,
    minBuyIn: 400,
    maxBuyIn: 2000,
    actionTimeoutSeconds: 30,
    creatorOnlyStart: false,
    allowSpectators: true,
  });
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const room = await apiFetch<{ id: string }>("/rooms", {
        method: "POST",
        body: JSON.stringify(form),
      });
      router.push(`/table/${room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    }
  }

  function updateNumber(key: NumericRoomKey, value: string) {
    setForm((prev) => ({ ...prev, [key]: Number(value) }));
  }

  return (
    <main className="page">
      <form className="form card" onSubmit={submit}>
        <h1>创建房间</h1>
        <div className="field">
          <label>房间名</label>
          <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </div>
        <div className="field">
          <label>最大人数</label>
          <select
            className="select"
            value={form.maxPlayers}
            onChange={(event) => {
              const maxPlayers = Number(event.target.value);
              setForm((prev) => ({
                ...prev,
                maxPlayers,
                minPlayersToStart: Math.min(prev.minPlayersToStart, maxPlayers),
              }));
            }}
          >
            {[2, 3, 4, 5, 6, 7, 8, 9].map((count) => (
              <option key={count} value={count}>
                {count} 人
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>最低开局人数</label>
          <select className="select" value={form.minPlayersToStart} onChange={(event) => updateNumber("minPlayersToStart", event.target.value)}>
            {Array.from({ length: form.maxPlayers - 1 }, (_, index) => index + 2).map((count) => (
              <option key={count} value={count}>
                {count} 人
              </option>
            ))}
          </select>
        </div>
        <div className="grid">
          <div className="field">
            <label>小盲</label>
            <input className="input" type="number" value={form.smallBlind} onChange={(event) => updateNumber("smallBlind", event.target.value)} />
          </div>
          <div className="field">
            <label>大盲</label>
            <input className="input" type="number" value={form.bigBlind} onChange={(event) => updateNumber("bigBlind", event.target.value)} />
          </div>
        </div>
        <div className="grid">
          <div className="field">
            <label>前注</label>
            <input className="input" type="number" min={0} value={form.ante} onChange={(event) => updateNumber("ante", event.target.value)} />
          </div>
          <div className="field">
            <label>行动时限（秒）</label>
            <input
              className="input"
              type="number"
              min={5}
              max={300}
              value={form.actionTimeoutSeconds}
              onChange={(event) => updateNumber("actionTimeoutSeconds", event.target.value)}
            />
          </div>
        </div>
        <div className="grid">
          <div className="field">
            <label>最小买入</label>
            <input className="input" type="number" value={form.minBuyIn} onChange={(event) => updateNumber("minBuyIn", event.target.value)} />
          </div>
          <div className="field">
            <label>最大买入</label>
            <input className="input" type="number" value={form.maxBuyIn} onChange={(event) => updateNumber("maxBuyIn", event.target.value)} />
          </div>
        </div>
        <label className="listRow">
          <span>允许观战</span>
          <input
            type="checkbox"
            checked={form.allowSpectators}
            onChange={(event) => setForm({ ...form, allowSpectators: event.target.checked })}
          />
        </label>
        <label className="listRow">
          <span>仅创建者可开局</span>
          <input
            type="checkbox"
            checked={form.creatorOnlyStart}
            onChange={(event) => setForm({ ...form, creatorOnlyStart: event.target.checked })}
          />
        </label>
        <div className="error">{error}</div>
        <button className="btn btnPrimary" type="submit">
          <Plus size={18} /> 创建
        </button>
      </form>
    </main>
  );
}
