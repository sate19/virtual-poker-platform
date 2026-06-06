"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { CircleDollarSign, DoorOpen, Play, Send, UserRoundPlus } from "lucide-react";
import type { AuthUser, ChatMessageDto, ServerToClientEvents, ClientToServerEvents } from "@friends-poker/shared";
import type { Card, PublicPokerGameState } from "@friends-poker/poker-engine";
import { API_URL, getMe } from "../../../lib/api";
import { formatCard, isRed } from "../../../lib/cards";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface RuntimeSeat {
  userId: string;
  displayName: string;
  seatIndex: number;
  tableChips: number;
  ready: boolean;
  connected: boolean;
}

interface RoomState {
  id: string;
  name: string;
  status: string;
  settings: {
    maxPlayers: number;
    smallBlind: number;
    bigBlind: number;
    minBuyIn: number;
    maxBuyIn: number;
  };
  seats: RuntimeSeat[];
  spectatorCount: number;
  game?: PublicPokerGameState;
}

const seatPositions = [
  [50, 91],
  [22, 82],
  [9, 56],
  [15, 25],
  [38, 10],
  [62, 10],
  [85, 25],
  [91, 56],
  [78, 82],
];

export default function TablePage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const [socket, setSocket] = useState<TypedSocket>();
  const [me, setMe] = useState<AuthUser>();
  const [room, setRoom] = useState<RoomState>();
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [chat, setChat] = useState("");
  const [error, setError] = useState("");
  const [seatIndex, setSeatIndex] = useState(0);
  const [buyIn, setBuyIn] = useState(1000);
  const [amount, setAmount] = useState(20);

  useEffect(() => {
    let activeSocket: TypedSocket | undefined;
    async function connect() {
      const user = await getMe();
      if (!user) {
        location.href = "/login";
        return;
      }
      setMe(user);
      activeSocket = io(API_URL, {
        withCredentials: true,
        transports: ["websocket", "polling"],
      });
      setSocket(activeSocket);
      activeSocket.on("connect", () => {
        activeSocket?.emit("room:join", { roomId });
        activeSocket?.emit("state:request", { roomId });
      });
      activeSocket.on("room:state", (state) => setRoom(state as RoomState));
      activeSocket.on("game:state", (state) =>
        setRoom((prev) => (prev ? { ...prev, game: state as PublicPokerGameState } : prev)),
      );
      activeSocket.on("chat:message", (message) => setMessages((prev) => [...prev.slice(-80), message]));
      activeSocket.on("error", (payload) => setError(payload.message));
    }
    void connect();
    return () => {
      activeSocket?.emit("room:leave", { roomId });
      activeSocket?.disconnect();
    };
  }, [roomId]);

  const mySeat = room?.seats.find((seat) => seat.userId === me?.id);
  const currentPlayer = room?.game?.players.find((player) => player.userId === room.game?.currentTurnUserId);
  const potTotal = useMemo(
    () => room?.game?.players.reduce((sum, player) => sum + player.totalCommitted, 0) ?? 0,
    [room?.game?.players],
  );

  function emit(event: keyof ClientToServerEvents, payload: any) {
    setError("");
    socket?.emit(event as any, payload);
  }

  function sendAction(action: "fold" | "check" | "call" | "bet" | "raise" | "all-in") {
    emit("game:action", {
      roomId,
      action,
      amount: ["bet", "raise"].includes(action) ? amount : undefined,
    });
  }

  function sendChat(event: React.FormEvent) {
    event.preventDefault();
    if (chat.trim()) {
      emit("chat:send", { roomId, message: chat.trim() });
      setChat("");
    }
  }

  return (
    <main className="page widePage">
      <div className="sectionTitle">
        <div>
          <h1>{room?.name ?? "牌桌"}</h1>
          <p className="muted">
            {room ? `盲注 ${room.settings.smallBlind}/${room.settings.bigBlind} · ${room.status}` : "正在连接"}
          </p>
        </div>
        <div className="actions">
          {mySeat ? (
            <>
              <button className="btn" onClick={() => emit("room:ready", { roomId, ready: !mySeat.ready })}>
                {mySeat.ready ? "取消准备" : "准备"}
              </button>
              <button className="btn btnPrimary" onClick={() => emit("game:start", { roomId })}>
                <Play size={17} /> 开始一手
              </button>
              <button className="btn" onClick={() => emit("room:stand", { roomId })}>
                <DoorOpen size={17} /> 站起
              </button>
            </>
          ) : (
            <div className="actions">
              <select className="select" value={seatIndex} onChange={(event) => setSeatIndex(Number(event.target.value))}>
                {Array.from({ length: room?.settings.maxPlayers ?? 9 }, (_, index) => (
                  <option key={index} value={index}>
                    {index + 1} 号位
                  </option>
                ))}
              </select>
              <input className="input" type="number" value={buyIn} onChange={(event) => setBuyIn(Number(event.target.value))} />
              <button className="btn btnPrimary" onClick={() => emit("room:sit", { roomId, seatIndex, buyIn })}>
                <UserRoundPlus size={17} /> 坐下
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="error">{error}</div>

      <div className="tableLayout">
        <section className="tableArea">
          <div className="pokerTable">
            <div className="centerPot">
              <div className="community">
                {[0, 1, 2, 3, 4].map((index) => (
                  <PokerCard key={index} card={room?.game?.communityCards[index]} />
                ))}
              </div>
              <strong>
                <CircleDollarSign size={17} /> 底池 {potTotal}
              </strong>
              <span className="muted">
                {currentPlayer ? `轮到 ${currentPlayer.displayName}` : room?.game?.phase ?? "等待开局"}
              </span>
            </div>

            {Array.from({ length: room?.settings.maxPlayers ?? 9 }, (_, index) => {
              const seat = room?.seats.find((item) => item.seatIndex === index);
              const player = room?.game?.players.find((item) => item.userId === seat?.userId);
              const [left, top] = seatPositions[index] ?? [50, 50];
              return (
                <div
                  className={`seat ${seat ? "" : "seatEmpty"} ${room?.game?.currentTurnUserId === seat?.userId ? "seatActive" : ""}`}
                  style={{ left: `${left}%`, top: `${top}%` }}
                  key={index}
                >
                  {seat ? (
                    <>
                      <div className="seatName">
                        <span>{seat.displayName}</span>
                        <span>{seat.connected ? "在线" : "离线"}</span>
                      </div>
                      <div className="muted">
                        筹码 {seat.tableChips} · {seat.ready ? "已准备" : "未准备"}
                      </div>
                      <div className="muted">
                        {player?.lastAction ?? player?.status ?? "等待"} · 投入 {player?.totalCommitted ?? 0}
                      </div>
                      <div className="seatCards">
                        {(player?.holeCards ?? [undefined, undefined]).map((card, cardIndex) => (
                          <MiniCard key={cardIndex} card={card as Card | undefined} />
                        ))}
                      </div>
                    </>
                  ) : (
                    <span>{index + 1} 号空位</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="controlBar">
            <button className="btn btnDanger" disabled={!isMyTurn(room, me)} onClick={() => sendAction("fold")}>
              弃牌
            </button>
            <button className="btn" disabled={!isMyTurn(room, me)} onClick={() => sendAction("check")}>
              过牌
            </button>
            <button className="btn" disabled={!isMyTurn(room, me)} onClick={() => sendAction("call")}>
              跟注
            </button>
            <input className="input" style={{ width: 120 }} type="number" value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
            <button className="btn" disabled={!isMyTurn(room, me)} onClick={() => sendAction("bet")}>
              下注
            </button>
            <button className="btn" disabled={!isMyTurn(room, me)} onClick={() => sendAction("raise")}>
              加注到
            </button>
            <button className="btn btnPrimary" disabled={!isMyTurn(room, me)} onClick={() => sendAction("all-in")}>
              全下
            </button>
          </div>
        </section>

        <aside className="sidePanel">
          <div className="card">
            <h2>我的信息</h2>
            <div className="statRow">
              <span className="muted">账号</span>
              <strong>{me?.displayName}</strong>
            </div>
            <div className="statRow">
              <span className="muted">桌上筹码</span>
              <strong>{mySeat?.tableChips ?? 0}</strong>
            </div>
            <div className="statRow">
              <span className="muted">观战人数</span>
              <strong>{room?.spectatorCount ?? 0}</strong>
            </div>
          </div>

          <div className="card">
            <h2>聊天</h2>
            <div className="chatLog">
              {messages.map((message) => (
                <div className="chatLine" key={message.id}>
                  <strong>{message.displayName}</strong>
                  <div>{message.message}</div>
                  <small className="muted">{new Date(message.createdAt).toLocaleTimeString()}</small>
                </div>
              ))}
            </div>
            <form className="actions" onSubmit={sendChat}>
              <input className="input" value={chat} maxLength={300} onChange={(event) => setChat(event.target.value)} />
              <button className="btn btnPrimary" type="submit">
                <Send size={17} /> 发送
              </button>
            </form>
          </div>

          <div className="card">
            <h2>行动记录</h2>
            {(room?.game?.actionLog ?? []).slice(-12).map((entry, index) => (
              <div className="listRow" key={`${entry.createdAt}-${index}`}>
                <span>{entry.action}</span>
                <span className="muted">{entry.amount ?? ""}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

function isMyTurn(room?: RoomState, me?: AuthUser): boolean {
  return Boolean(room?.game?.currentTurnUserId && me?.id && room.game.currentTurnUserId === me.id);
}

function PokerCard({ card }: { card?: Card }) {
  if (!card) {
    return <div className="playingCard cardBack">?</div>;
  }
  return <div className={`playingCard ${isRed(card) ? "redCard" : ""}`}>{formatCard(card)}</div>;
}

function MiniCard({ card }: { card?: Card }) {
  if (!card) {
    return <div className="miniCard cardBack">?</div>;
  }
  return <div className={`miniCard ${isRed(card) ? "redCard" : ""}`}>{formatCard(card)}</div>;
}
