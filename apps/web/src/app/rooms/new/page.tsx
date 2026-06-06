"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { apiFetch } from "../../../lib/api";

type NumericRoomKey = "maxPlayers" | "smallBlind" | "bigBlind" | "minBuyIn" | "maxBuyIn";

export default function NewRoomPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "标准牌局",
    maxPlayers: 9,
    smallBlind: 5,
    bigBlind: 10,
    minBuyIn: 400,
    maxBuyIn: 2000,
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
          <select className="select" value={form.maxPlayers} onChange={(event) => updateNumber("maxPlayers", event.target.value)}>
            {[2, 3, 4, 5, 6, 7, 8, 9].map((count) => (
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
        <div className="error">{error}</div>
        <button className="btn btnPrimary" type="submit">
          <Plus size={18} /> 创建
        </button>
      </form>
    </main>
  );
}
