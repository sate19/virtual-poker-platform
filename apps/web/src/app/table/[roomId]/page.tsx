"use client";

import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { CircleDollarSign, DoorOpen, Menu, NotebookText, Play, Send, UserRoundPlus, Volume2 } from "lucide-react";
import type { AuthUser, ChatMessageDto, ClientToServerEvents, RunoutMode, ServerToClientEvents } from "@friends-poker/shared";
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
    minPlayersToStart: number;
    smallBlind: number;
    bigBlind: number;
    ante: number;
    minBuyIn: number;
    maxBuyIn: number;
    actionTimeoutSeconds: number;
    creatorOnlyStart: boolean;
  };
  seats: RuntimeSeat[];
  spectatorCount: number;
  nextHandReadyAt?: string;
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
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    let activeSocket: TypedSocket | undefined;
    async function connect() {
      const user = await getMe();
      if (!user) {
        location.href = "/login";
        return;
      }
      setMe(user);
      activeSocket = io(typeof window !== "undefined" ? "" : API_URL, {
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

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const mySeat = room?.seats.find((seat) => seat.userId === me?.id);
  const currentPlayer = room?.game?.players.find((player) => player.userId === room.game?.currentTurnUserId);
  const actionClock = room?.game?.actionClock;
  const remainingMs = actionClock ? Math.max(0, Date.parse(actionClock.deadlineAt) - nowMs) : undefined;
  const remainingSeconds = remainingMs === undefined ? undefined : Math.ceil(remainingMs / 1000);
  const remainingPercent =
    actionClock && remainingMs !== undefined
      ? Math.max(0, Math.min(100, (remainingMs / (actionClock.timeoutSeconds * 1000)) * 100))
      : undefined;
  const nextHandRemainingMs = room?.nextHandReadyAt ? Math.max(0, Date.parse(room.nextHandReadyAt) - nowMs) : 0;
  const nextHandSeconds = nextHandRemainingMs > 0 ? Math.ceil(nextHandRemainingMs / 1000) : 0;
  const isHandPaused = nextHandSeconds > 0;
  const isRevealing = room?.game?.phase === "revealing";
  const isFinished = room?.game?.phase === "finished";
  const runoutSelection = room?.game?.runoutSelection;
  const isRunoutEligible = Boolean(me?.id && runoutSelection?.eligiblePlayerIds.includes(me.id));
  const myRunoutVote = me?.id && runoutSelection ? runoutSelection.votes[me.id] : undefined;
  const runoutBoards = room?.game?.runoutBoards;
  const actionEnabled = isMyTurn(room, me) && !runoutSelection && !isRevealing && !isFinished;

  const potTotal = useMemo(
    () => room?.game?.players.reduce((sum, player) => sum + player.totalCommitted, 0) ?? 0,
    [room?.game?.players],
  );
  const winnerDeltas = useMemo(() => {
    const deltas = new Map<string, number>();
    if (room?.game?.phase !== "finished") {
      return deltas;
    }
    for (const player of room.game.players) {
      const delta = player.stack - player.startingStack;
      if (delta > 0) {
        deltas.set(player.userId, delta);
      }
    }
    return deltas;
  }, [room?.game]);
  const winners = useMemo(
    () =>
      room?.game?.players
        .map((player) => ({ player, delta: winnerDeltas.get(player.userId) ?? 0 }))
        .filter((item) => item.delta > 0)
        .sort((a, b) => b.delta - a.delta) ?? [],
    [room?.game?.players, winnerDeltas],
  );
  const equityByUserId = useMemo(() => {
    const equities = new Map<string, { winPercent: number; tiePercent: number; samples: number }>();
    const sourceBoards = runoutBoards?.filter((board) => board.equities?.length) ?? [];
    for (const board of sourceBoards) {
      for (const equity of board.equities ?? []) {
        const current = equities.get(equity.userId) ?? { winPercent: 0, tiePercent: 0, samples: 0 };
        equities.set(equity.userId, {
          winPercent: current.winPercent + equity.winPercent,
          tiePercent: current.tiePercent + equity.tiePercent,
          samples: current.samples + 1,
        });
      }
    }
    for (const [userId, equity] of equities) {
      equities.set(userId, {
        winPercent: equity.winPercent / equity.samples,
        tiePercent: equity.tiePercent / equity.samples,
        samples: equity.samples,
      });
    }
    return equities;
  }, [runoutBoards]);

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

  function sendRunout(mode: RunoutMode) {
    emit("game:runout", { roomId, mode });
  }

  function sendChat(event: FormEvent) {
    event.preventDefault();
    if (chat.trim()) {
      emit("chat:send", { roomId, message: chat.trim() });
      setChat("");
    }
  }

  return (
    <main className="page widePage tablePage">
      <div className="sectionTitle tableHeader">
        <div>
          <h1>{room?.name ?? "牌桌"}</h1>
          <p className="muted">
            {room
              ? `盲注 ${room.settings.smallBlind}/${room.settings.bigBlind} · 前注 ${room.settings.ante} · ${phaseLabel(room.status)}`
              : "正在连接"}
          </p>
        </div>
        <div className="actions">
          {mySeat ? (
            <>
              <button className="btn" onClick={() => emit("room:ready", { roomId, ready: !mySeat.ready })}>
                {mySeat.ready ? "取消准备" : "准备"}
              </button>
              <button
                className="btn btnPrimary"
                disabled={isHandPaused || Boolean(room?.game && room.game.phase !== "finished")}
                onClick={() => emit("game:start", { roomId })}
              >
                <Play size={17} /> {isHandPaused ? `${nextHandSeconds} 秒后可开始` : "开始一手"}
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
          <div className="tableRail" aria-label="牌桌工具">
            <button className="iconButton" title="牌桌菜单" type="button">
              <Menu size={26} />
            </button>
            <button className="iconButton" title="声音设置" type="button">
              <Volume2 size={24} />
            </button>
            <button className="iconButton" title="记录面板" type="button">
              <NotebookText size={23} />
            </button>
          </div>

          <div className="pokerTable">
            <div className="tableCornerMeta">
              <span>NLH</span>
              <strong>
                {room
                  ? `${room.settings.smallBlind} / ${room.settings.bigBlind}${room.settings.ante > 0 ? ` + ${room.settings.ante}` : ""}`
                  : "-- / --"}
              </strong>
              <span>{room ? `${room.settings.minPlayersToStart}+ 人开局 · ${room.settings.actionTimeoutSeconds} 秒行动` : ""}</span>
            </div>
            <div className="centerPot">
              <div className="potPill">
                <CircleDollarSign size={18} /> {potTotal}
              </div>
              {runoutBoards && runoutBoards.length > 1 ? (
                <div className="runoutBoards">
                  {runoutBoards.map((board, boardIndex) => (
                    <div className="runoutBoard" key={board.id}>
                      <span className="runoutLabel">第 {boardIndex + 1} 次</span>
                      <div className="community">
                        {[0, 1, 2, 3, 4].map((index) => (
                          <PokerCard key={index} card={board.cards[index]} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="community">
                  {[0, 1, 2, 3, 4].map((index) => (
                    <PokerCard key={index} card={room?.game?.communityCards[index]} />
                  ))}
                </div>
              )}
              <span className="turnPill">{centerStatusText(room, currentPlayer?.displayName, nextHandSeconds)}</span>
              {remainingSeconds !== undefined && currentPlayer && (
                <span className={`timerPill ${remainingSeconds <= 5 ? "timerDanger" : ""}`}>{remainingSeconds} 秒</span>
              )}
              {isRevealing && <div className="revealBanner">全下摊牌 · 正在逐张发牌</div>}
              {isFinished && winners.length > 0 && (
                <div className="resultBanner">
                  {winners.map(({ player, delta }) => `${player.displayName} +${delta}`).join(" · ")}
                  {nextHandSeconds > 0 ? ` · ${nextHandSeconds} 秒后可开始下一手` : ""}
                </div>
              )}
            </div>

            {Array.from({ length: room?.settings.maxPlayers ?? 9 }, (_, index) => {
              const seat = room?.seats.find((item) => item.seatIndex === index);
              const player = room?.game?.players.find((item) => item.userId === seat?.userId);
              const [left, top] = seatPositions[index] ?? [50, 50];
              const blindLabel =
                room?.game?.smallBlindSeatIndex === index ? "SB" : room?.game?.bigBlindSeatIndex === index ? "BB" : "";
              const handDelta = player ? winnerDeltas.get(player.userId) ?? 0 : 0;
              const equity = seat ? equityByUserId.get(seat.userId) : undefined;
              return (
                <div
                  className={`seat ${seat ? "" : "seatEmpty"} ${
                    seat && room?.game?.currentTurnUserId === seat.userId ? "seatActive" : ""
                  } ${seat?.userId === me?.id ? "seatSelf" : ""}`}
                  style={{ left: `${left}%`, top: `${top}%` }}
                  key={index}
                >
                  {seat ? (
                    <>
                      <div className="seatName">
                        <span>{seat.displayName}</span>
                        <span className={seat.connected ? "statusOnline" : "statusOffline"}>{seat.connected ? "在线" : "离线"}</span>
                      </div>
                      <div className="seatChipLine">
                        <span>筹码 {seat.tableChips}</span>
                        {handDelta > 0 && <strong className="winDelta">+{handDelta}</strong>}
                      </div>
                      <div className="muted">{seat.ready ? "已准备" : "未准备"}</div>
                      <div className="muted">
                        {actionLabel(player?.lastAction ?? player?.status)} · 投入 {player?.totalCommitted ?? 0}
                      </div>
                      {isRevealing && equity && (
                        <div className="equityBadge">
                          胜率 {formatPercent(equity.winPercent)}
                          {equity.tiePercent > 0 ? ` · 平分 ${formatPercent(equity.tiePercent)}` : ""}
                        </div>
                      )}
                      <div className="seatCards">
                        {(player?.holeCards ?? [undefined, undefined]).map((card, cardIndex) => (
                          <MiniCard key={cardIndex} card={card as Card | undefined} />
                        ))}
                      </div>
                      <div className="seatMarkers">
                        {room?.game?.buttonSeatIndex === index && <span className="dealerChip">D</span>}
                        {blindLabel && <span className="blindChip">{blindLabel}</span>}
                      </div>
                      {room?.game?.currentTurnUserId === seat.userId && remainingSeconds !== undefined && (
                        <div className="seatTimer" aria-label="行动倒计时">
                          <span style={{ width: `${remainingPercent ?? 0}%` }} />
                          <em>{remainingSeconds}</em>
                        </div>
                      )}
                    </>
                  ) : (
                    <span>{index + 1} 号空位</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="controlBar actionDock">
            <div className="actionClockBanner">
              {isRevealing
                ? "全下后无人可继续行动，系统正在逐张发牌"
                : isFinished
                  ? nextHandSeconds > 0
                    ? `本手已结算，${nextHandSeconds} 秒后可开始下一手`
                    : "本手已结算，可以准备下一手"
                  : currentPlayer && remainingSeconds !== undefined
                    ? `当前行动：${currentPlayer.displayName} · ${remainingSeconds} 秒`
                    : "等待下一次行动"}
            </div>
            {runoutSelection && (
              <div className="runoutPanel">
                <div>
                  <strong>全下摊牌</strong>
                  <span className="muted">
                    {runoutSelection.eligiblePlayerIds.length} 名玩家参与，剩余 {runoutSelection.remainingCards} 张公共牌
                  </span>
                </div>
                {isRunoutEligible ? (
                  <div className="runoutActions">
                    <button className="btn" onClick={() => sendRunout("once")}>
                      发一次
                    </button>
                    <button className="btn btnPrimary" disabled={myRunoutVote === "twice"} onClick={() => sendRunout("twice")}>
                      {myRunoutVote === "twice" ? "已同意发两次" : "同意发两次"}
                    </button>
                  </div>
                ) : (
                  <span className="muted">等待参与摊牌的玩家选择发牌方式</span>
                )}
              </div>
            )}
            <button className="btn btnDanger" disabled={!actionEnabled} onClick={() => sendAction("fold")}>
              弃牌
            </button>
            <button className="btn" disabled={!actionEnabled} onClick={() => sendAction("check")}>
              过牌
            </button>
            <button className="btn" disabled={!actionEnabled} onClick={() => sendAction("call")}>
              跟注
            </button>
            <input className="input betInput" type="number" value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
            <button className="btn" disabled={!actionEnabled} onClick={() => sendAction("bet")}>
              下注
            </button>
            <button className="btn" disabled={!actionEnabled} onClick={() => sendAction("raise")}>
              加注到
            </button>
            <button className="btn btnPrimary" disabled={!actionEnabled} onClick={() => sendAction("all-in")}>
              全下
            </button>
          </div>
        </section>

        <aside className="sidePanel tableDrawer">
          <div className="card tableInfoCard">
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

          <div className="card chatCard">
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

          <div className="card tableLogCard">
            <h2>行动记录</h2>
            {(room?.game?.actionLog ?? []).slice(-12).map((entry, index) => (
              <div className="listRow" key={`${entry.createdAt}-${index}`}>
                <span>{actionLabel(entry.action)}</span>
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

function centerStatusText(room?: RoomState, currentDisplayName?: string, nextHandSeconds = 0): string {
  if (room?.game?.runoutSelection) {
    return "全下后选择发牌次数";
  }
  if (room?.game?.phase === "revealing") {
    return "全下发牌中";
  }
  if (room?.game?.phase === "finished") {
    return nextHandSeconds > 0 ? `结算展示 ${nextHandSeconds} 秒` : "本手结束";
  }
  if (currentDisplayName) {
    return `轮到 ${currentDisplayName}`;
  }
  return room?.game?.phase ? phaseLabel(room.game.phase) : "等待开局";
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    WAITING: "等待中",
    PLAYING: "进行中",
    FINISHED: "已结束",
    CLOSED: "已关闭",
    waiting: "等待中",
    preflop: "翻牌前",
    flop: "翻牌圈",
    turn: "转牌圈",
    river: "河牌圈",
    showdown: "摊牌",
    runout: "选择发牌",
    revealing: "发牌中",
    finished: "本手结束",
  };
  return labels[phase] ?? phase;
}

function actionLabel(action?: string): string {
  const labels: Record<string, string> = {
    "post-small-blind": "小盲",
    "post-big-blind": "大盲",
    "post-ante": "前注",
    fold: "弃牌",
    check: "过牌",
    call: "跟注",
    bet: "下注",
    raise: "加注",
    "all-in": "全下",
    "runout-selection": "选择发牌次数",
    "run-it-once": "发一次",
    "run-it-twice-vote": "同意发两次",
    "runout-reveal-once": "发牌一次",
    "runout-reveal-twice": "发牌两次",
    showdown: "摊牌",
    "showdown-run-twice": "摊牌两次",
    "win-by-fold": "弃牌获胜",
    active: "行动中",
    folded: "已弃牌",
    ready: "已准备",
    seated: "已入座",
    out: "离桌",
  };
  if (!action) {
    return "等待";
  }
  if (action.startsWith("runout-card-")) {
    return "翻出公共牌";
  }
  return labels[action] ?? action;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function PokerCard({ card }: { card?: Card }) {
  if (!card) {
    return <div className="playingCard communityEmpty" />;
  }
  return <div className={`playingCard ${isRed(card) ? "redCard" : ""}`}>{formatCard(card)}</div>;
}

function MiniCard({ card }: { card?: Card }) {
  if (!card) {
    return <div className="miniCard cardBack">?</div>;
  }
  return <div className={`miniCard ${isRed(card) ? "redCard" : ""}`}>{formatCard(card)}</div>;
}
