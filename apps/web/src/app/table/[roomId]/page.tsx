"use client";

import { useParams } from "next/navigation";
import React, { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Bot, CircleDollarSign, DoorOpen, Menu, NotebookText, Play, Rabbit, Send, UserRoundPlus, Volume2 } from "lucide-react";
import type { AuthUser, ChatMessageDto, ClientToServerEvents, MiniGameSettings, RunoutMode, ServerToClientEvents } from "@friends-poker/shared";
import {
  evaluateHand,
  type Card,
  type HandCategory,
  type PublicEnginePlayer,
  type PublicPokerGameState,
} from "@friends-poker/poker-engine";
import { getMe } from "../../../lib/api";
import { getBestJokerRank, isJoker, isRed } from "../../../lib/cards";
import { playSound, stopAllinSound } from "../../../lib/sound";
import { EMOJI_CATEGORIES } from "../../../lib/emoji-data";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface RuntimeSeat {
  userId: string;
  displayName: string;
  seatIndex: number;
  tableChips: number;
  ready: boolean;
  connected: boolean;
  emoji?: string;
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
    rabbitHunting: boolean;
    deckType?: string;
    miniGames?: MiniGameSettings;
  };
  seats: RuntimeSeat[];
  spectatorCount: number;
  nextHandReadyAt?: string;
  game?: PublicPokerGameState;
}

const seatPositions = [
  [50, 92],
  [22, 83],
  [8, 56],
  [14, 24],
  [38, 9],
  [62, 9],
  [86, 24],
  [92, 56],
  [78, 83],
];

const handCategoryLabel: Record<HandCategory, string> = {
  "High Card": "高牌",
  "One Pair": "一对",
  "Two Pair": "两对",
  "Three of a Kind": "三条",
  Straight: "顺子",
  Flush: "同花",
  "Full House": "葫芦",
  "Four of a Kind": "四条",
  "Straight Flush": "同花顺",
  "Royal Flush": "皇家同花顺",
};

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
  const [buyIn, setBuyIn] = useState(0);
  const [amount, setAmount] = useState(20);
  const [chipAmount, setChipAmount] = useState(200);
  const [nowMs, setNowMs] = useState(Date.now());
  const [showSettings, setShowSettings] = useState(false);
  const [editSmallBlind, setEditSmallBlind] = useState(0);
  const [editBigBlind, setEditBigBlind] = useState(0);
  const [editRabbitHunting, setEditRabbitHunting] = useState(true);
  const [editDeckType, setEditDeckType] = useState("standard");
  const [editTimeout, setEditTimeout] = useState(30);
  const [showLedger, setShowLedger] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [rabbitCards, setRabbitCards] = useState<Card[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [emojiPickerSeat, setEmojiPickerSeat] = useState<number | null>(null);
  const [emojiTab, setEmojiTab] = useState(0);
  const [throwEmoji, setThrowEmoji] = useState<string | null>(null);
  const [throwPickerOpen, setThrowPickerOpen] = useState(false);
  const [showSoundPanel, setShowSoundPanel] = useState(false);
  const [showKickPanel, setShowKickPanel] = useState(false);
  const [simpleSound, setSimpleSound] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("simpleSound") === "1";
    return false;
  });
  const [emojiFlights, setEmojiFlights] = useState<Array<{ id: number; fromUserId: string; toUserId: string; emoji: string; fromX: number; fromY: number; toX: number; toY: number }>>([]);
  const flightIdRef = useRef(0);
  const [allinConfirm, setAllinConfirm] = useState(false);
  const [preFold, setPreFold] = useState(false);
  const [preStand, setPreStand] = useState(false);
  const [revealedSelf, setRevealedSelf] = useState(false);
  const [ledger, setLedger] = useState<{ userId: string; displayName: string; boughtIn: number; cashedOut: number; tableChips: number; net: number }[]>([]);
  const pendingMeRefreshRef = useRef(false);
  const preFoldTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevActionCountRef = useRef(0);
  const prevPhaseRef = useRef("");
  const prevTurnUserIdRef = useRef<string | undefined>(undefined);
  const timerWarnedRef = useRef(false);
  const prevMessageCountRef = useRef(0);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const logPausedRef = useRef(false);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const chatPausedRef = useRef(false);
  const flippingRef = useRef<Set<number>>(new Set());
  const [flipping, setFlipping] = useState<Set<number>>(new Set());
  const potRef = useRef<HTMLDivElement>(null);
  const seatRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [coinAnims, setCoinAnims] = useState<Array<{ id: number; userId: string; delay: number; fromX: number; fromY: number; toX: number; toY: number }>>([]);
  const logPauseTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const chatPauseTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let cleanedUp = false;
    // withCredentials 在新版 socket.io-client 类型中已移除，但运行时仍支持
    const activeSocket: TypedSocket = io({ withCredentials: true, transports: ["polling"] } as any);
    setSocket(activeSocket);

    // Register listeners synchronously before any async work
    activeSocket.on("connect", () => {
      activeSocket.emit("room:join", { roomId });
      activeSocket.emit("state:request", { roomId });
    });
    activeSocket.on("room:state", (state) => {
      setRoom(state as RoomState);
      if (pendingMeRefreshRef.current) {
        pendingMeRefreshRef.current = false;
        void getMe().then((currentUser) => {
          if (currentUser) setMe(currentUser);
        });
      }
    });
    activeSocket.on("game:state", (state) =>
      setRoom((prev) => (prev ? { ...prev, game: state as PublicPokerGameState } : prev)),
    );
    activeSocket.on("chat:message", (message) => setMessages((prev) => [...prev.slice(-80), message]));
    activeSocket.on("emoji:throw", (payload: any) => {
      const fromSeat = room?.seats.find((s: any) => s.userId === payload.fromUserId);
      const toSeat = room?.seats.find((s: any) => s.userId === payload.toUserId);
      const fromEl = fromSeat ? seatRefs.current.get(fromSeat.seatIndex) : null;
      const toEl = toSeat ? seatRefs.current.get(toSeat.seatIndex) : null;
      const fromRect = fromEl?.getBoundingClientRect();
      const toRect = toEl?.getBoundingClientRect();
      setEmojiFlights((prev) => [...prev, {
        id: flightIdRef.current++,
        fromUserId: payload.fromUserId,
        toUserId: payload.toUserId,
        emoji: payload.emoji,
        fromX: fromRect ? fromRect.left + fromRect.width / 2 : 0,
        fromY: fromRect ? fromRect.top + fromRect.height / 2 : 0,
        toX: toRect ? toRect.left + toRect.width / 2 : 0,
        toY: toRect ? toRect.top + toRect.height / 2 : 0,
      }]);
    });
    activeSocket.on("game:rabbit-cards", (payload: any) => {
      setRabbitCards(payload.cards ?? []);
    });
    activeSocket.on("error", (payload) => {
      pendingMeRefreshRef.current = false;
      setError(payload.message);
    });

    void getMe().then((user) => {
      if (cleanedUp) return;
      if (!user) { location.href = "/login"; return; }
      setMe(user);
    });

    return () => {
      cleanedUp = true;
      activeSocket.emit("room:leave", { roomId });
      activeSocket.disconnect();
    };
  }, [roomId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  // ESC key cancels throw mode
  useEffect(() => {
    if (!throwEmoji) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setThrowEmoji(null); setThrowPickerOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [throwEmoji]);

  // Clean up finished emoji flights after animation
  useEffect(() => {
    if (emojiFlights.length === 0) return;
    const timer = setTimeout(() => setEmojiFlights([]), 800);
    return () => clearTimeout(timer);
  }, [emojiFlights.length]);

  useEffect(() => {
    if (room?.settings.maxBuyIn && buyIn === 0) setBuyIn(room.settings.maxBuyIn);
  }, [room?.settings.maxBuyIn, buyIn]);

  const maxPlayers = room?.settings.maxPlayers ?? 9;
  const mySeat = room?.seats.find((seat) => seat.userId === me?.id);
  const currentPlayer = room?.game?.players.find((player) => player.userId === room.game?.currentTurnUserId);
  const myPlayer = room?.game?.players.find((player) => player.userId === me?.id);
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
  const isShowdownHand = isFinished && room?.game?.showdownEvaluations && Object.keys(room.game.showdownEvaluations).length > 0;
  const isActiveHand = Boolean(room?.game && !isFinished);
  const runoutSelection = room?.game?.runoutSelection;
  const isRunoutEligible = Boolean(me?.id && runoutSelection?.eligiblePlayerIds.includes(me.id));
  const myRunoutVote = me?.id && runoutSelection ? runoutSelection.votes[me.id] : undefined;
  const runoutBoards = room?.game?.runoutBoards;
  const actionEnabled = isMyTurn(room, me) && !runoutSelection && !isRevealing && !isFinished;
  const toCall = myPlayer && room?.game ? Math.max(0, room.game.currentBet - myPlayer.committedThisStreet) : 0;
  const betOrRaiseAction = room?.game && room.game.currentBet > 0 ? "raise" : "bet";
  const isSeated = Boolean(mySeat);

  const potTotal = useMemo(
    () => room?.game?.players.reduce((sum, player) => sum + player.totalCommitted, 0) ?? 0,
    [room?.game?.players],
  );

  const potQuickAmounts = useMemo(() => {
    const ratios = [0.33, 0.5, 0.66, 1];
    if (!room?.game || !myPlayer) {
      return ratios.map((ratio) => ({
        ratio,
        label: `${Math.round(ratio * 100)}%池`,
        amount: 0,
      }));
    }
    return ratios.map((ratio) => ({
      ratio,
      label: `${Math.round(ratio * 100)}%池`,
      amount: potSizedAmount(room.game!, myPlayer, potTotal, ratio),
    }));
  }, [myPlayer, potTotal, room?.game]);

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
  const winnerIds = useMemo(() => new Set(winners.map((w) => w.player.userId)), [winners]);

  // Winner's best 5 cards for showdown highlighting
  const winnerBestCards = useMemo(() => {
    if (!isShowdownHand || winners.length === 0) return new Set<string>();
    const evals = room?.game?.showdownEvaluations;
    if (!evals) return new Set<string>();
    const cards = new Set<string>();
    for (const w of winners) {
      const e = evals[w.player.userId];
      if (e?.cards) {
        for (const c of e.cards) cards.add(`${c.rank}${c.suit}`);
      }
    }
    return cards;
  }, [isShowdownHand, winners, room?.game?.showdownEvaluations]);

  const handLabels = useHandLabels(room?.game?.players, room?.game?.communityCards ?? [], room?.game?.phase);
  const communityJokerRanks = useJokerRanks((room?.game?.communityCards ?? []) as Card[], room?.game?.phase);

  const seatRefCallbacks = useMemo(() =>
    Array.from({ length: maxPlayers }, (_, i) => (el: HTMLDivElement | null) => { if (el) seatRefs.current.set(i, el); }),
  [maxPlayers]);

  // Auto-scroll action log
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
      if (!atBottom) {
        logPausedRef.current = true;
        clearTimeout(logPauseTimerRef.current);
        logPauseTimerRef.current = setTimeout(() => { logPausedRef.current = false; }, 10000);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); clearTimeout(logPauseTimerRef.current); };
  }, []);

  useEffect(() => {
    if (logPausedRef.current) return;
    const el = logScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  // Auto-scroll chat on new messages
  useEffect(() => {
    const el = chatLogRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
      if (!atBottom) {
        chatPausedRef.current = true;
        clearTimeout(chatPauseTimerRef.current);
        chatPauseTimerRef.current = setTimeout(() => { chatPausedRef.current = false; }, 10000);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); clearTimeout(chatPauseTimerRef.current); };
  }, []);

  useEffect(() => {
    if (chatPausedRef.current) return;
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function playSoundFiltered(name: string) {
    if (simpleSound && name !== "turn" && name !== "allin") return;
    playSound(name);
  }

  // Sound effects — triggered locally via room state changes, everyone hears action sounds
  const actionLog = room?.game?.actionLog ?? [];
  const actionCount = actionLog.length;
  const handId = room?.game?.handId ?? "";

  // Reset action counter when a new hand starts
  const prevHandIdRef = useRef("");
  useEffect(() => {
    if (handId && handId !== prevHandIdRef.current) {
      prevHandIdRef.current = handId;
      prevActionCountRef.current = 0;
      flippingRef.current = new Set();
      stopAllinSound();
      setRabbitCards(null);
    }
  }, [handId]);

  // Sync ref on initial mount (avoid replaying past actions)
  useEffect(() => {
    if (actionCount > 0 && prevActionCountRef.current === 0) {
      prevActionCountRef.current = actionCount;
    }
  }, [actionCount]);

  useEffect(() => {
    if (actionCount <= prevActionCountRef.current) return;
    for (let i = prevActionCountRef.current; i < actionCount; i++) {
      const a = actionLog[i]?.action;
      if (a === "fold") playSoundFiltered("fold");
      else if (a === "check") playSoundFiltered("check");
      else if (a === "call") playSoundFiltered("call");
      else if (a === "bet") playSoundFiltered("bet");
      else if (a === "raise") playSoundFiltered("raise");
      else if (a === "all-in") playSoundFiltered("allin");
    }
    prevActionCountRef.current = actionCount;
  }, [actionCount]);

  useEffect(() => {
    const phase = room?.game?.phase;
    if (phase && phase !== prevPhaseRef.current && phase !== "finished") {
      setCoinAnims([]);
    }
    if (phase && phase !== prevPhaseRef.current && ["flop", "turn", "river"].includes(phase)) {
      playSoundFiltered("deal");
    }
    if (phase === "finished" && prevPhaseRef.current && prevPhaseRef.current !== "finished") {
      if (winners.length > 0) playSoundFiltered("win");
      setPreFold(false);
      setRevealedSelf(false);
      // Coin fly animation
      const potEl = potRef.current;
      if (potEl && winners.length > 0) {
        const potRect = potEl.getBoundingClientRect();
        const fromX = potRect.left + potRect.width / 2;
        const fromY = potRect.top + potRect.height / 2;
        const anims: typeof coinAnims = [];
        let id = 0;
        for (const w of winners) {
          const seatEl = seatRefs.current.get(w.player.seatIndex);
          if (!seatEl) continue;
          const seatRect = seatEl.getBoundingClientRect();
          const toX = seatRect.left + seatRect.width / 2;
          const toY = seatRect.top + seatRect.height / 2;
          const count = Math.ceil(w.delta / 100);
          for (let i = 0; i < count; i++) {
            anims.push({ id: id++, userId: w.player.userId, delay: i * 0.1, fromX, fromY, toX, toY });
          }
        }
        setCoinAnims(anims);
      }
      clearTimeout(preFoldTimerRef.current);
      if (preStand) { setPreStand(false); emit("room:stand", { roomId }); }
    }
    prevPhaseRef.current = phase ?? "";
  }, [room?.game?.phase, winners.length]);

  // Auto rabbit hunt — 1s after hand finishes
  useEffect(() => {
    if (!isFinished || !room?.settings.rabbitHunting || (room?.game?.communityCards.length ?? 0) >= 5 || rabbitCards) return;
    const timer = setTimeout(() => socket?.emit("game:rabbit", { roomId }), 1000);
    return () => clearTimeout(timer);
  }, [isFinished, room?.settings.rabbitHunting, room?.game?.communityCards, rabbitCards, roomId, socket]);

  // Card flip animation
  useEffect(() => {
    const cards = room?.game?.communityCards ?? [];
    const newCards: number[] = [];
    for (let i = 0; i < 5; i++) {
      const hasNew = cards[i] && !flippingRef.current.has(i);
      const cardChanged = cards[i]?.rank !== undefined;
      if (cardChanged && hasNew) newCards.push(i);
    }
    if (newCards.length === 0) return;
    for (const i of newCards) flippingRef.current.add(i);
    setFlipping(new Set(newCards));
    // Remove flip visual after animation
    const maxDelay = newCards.length === 3 ? newCards.length * 120 + 300 : 300;
    const timer = setTimeout(() => {
      setFlipping(new Set());
    }, maxDelay);
    return () => clearTimeout(timer);
  }, [room?.game?.communityCards]);

  // Turn sound + pre-fold auto-action
  useEffect(() => {
    const turnUserId = room?.game?.currentTurnUserId;
    if (turnUserId && turnUserId === me?.id && turnUserId !== prevTurnUserIdRef.current) {
      playSoundFiltered("turn");
      timerWarnedRef.current = false;
      // Pre-fold check: auto-fold after 1s delay
      clearTimeout(preFoldTimerRef.current);
      if (preFold) {
        preFoldTimerRef.current = setTimeout(() => {
          sendAction("fold");
        }, 1000);
      }
    }
    if (turnUserId !== me?.id) {
      setAllinConfirm(false);
      clearTimeout(preFoldTimerRef.current);
    }
    prevTurnUserIdRef.current = turnUserId;
  }, [room?.game?.currentTurnUserId, me?.id, preFold]);

  // Timer warning — only for the active player
  useEffect(() => {
    if (!actionEnabled || !remainingSeconds || remainingSeconds > 5) return;
    if (!timerWarnedRef.current) {
      playSoundFiltered("timer");
      timerWarnedRef.current = true;
    }
  }, [actionEnabled, remainingSeconds]);

  // Chat sound — everyone hears new messages
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      playSoundFiltered("chat");
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

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
    if (action === "all-in" && !allinConfirm) {
      setAllinConfirm(true);
      return;
    }
    setAllinConfirm(false);
    setPreFold(false);
    setPreStand(false);
    clearTimeout(preFoldTimerRef.current);
    emit("game:action", {
      roomId,
      action,
      amount: ["bet", "raise"].includes(action) ? amount : undefined,
    });
  }

  function sendBetOrRaise() {
    sendAction(betOrRaiseAction);
  }

  function adjustTableChips(type: "add" | "remove") {
    pendingMeRefreshRef.current = true;
    playSoundFiltered("chip");
    emit(type === "add" ? "room:chips:add" : "room:chips:remove", { roomId, amount: chipAmount });
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

  function openSettings() {
    if (!room) return;
    setEditSmallBlind(room.settings.smallBlind);
    setEditBigBlind(room.settings.bigBlind);
    setEditRabbitHunting(room.settings.rabbitHunting);
    setEditDeckType((room.settings as any).deckType ?? "standard");
    setEditTimeout(room.settings.actionTimeoutSeconds);
    setShowSettings(true);
  }

  async function saveSettings() {
    if (!room) return;
    setError("");
    try {
      const res = await fetch("/api/rooms/" + roomId + "/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smallBlind: editSmallBlind,
          bigBlind: editBigBlind,
          actionTimeoutSeconds: editTimeout,
          rabbitHunting: editRabbitHunting,
          deckType: editDeckType,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? "设置失败");
      }
      setShowSettings(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "设置失败");
    }
  }

  async function openLedger() {
    setError("");
    try {
      const res = await fetch("/api/rooms/" + roomId + "/ledger", { credentials: "include" });
      if (res.ok) setLedger(await res.json());
    } catch { /* ignore */ }
    setShowLedger(true);
  }

  return (
    <main className="page widePage tablePage">
      <div className="sectionTitle tableHeader">
        <div>
          <h1>
            {room?.name ?? "牌桌"}
            {room?.game?.deckType && room.game.deckType !== "standard" && (
              <span className="dlcBadge">👑 王室战争</span>
            )}
          </h1>
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
                <Play size={17} /> {isHandPaused ? `${nextHandSeconds} 秒后自动开局` : "开始一手"}
              </button>
              <button
                className={`btn ${preStand ? "btnPreFold" : ""}`}
                disabled={!isSeated}
                onClick={() => {
                  if (isActiveHand) { setPreStand((v) => !v); return; }
                  setPreStand(false);
                  emit("room:stand", { roomId });
                }}
              >
                {preStand && <span className="preFoldCheck">✓</span>}
                <DoorOpen size={17} /> 站起
              </button>
            </>
          ) : (
            <div className="actions">
              <select className="select" value={seatIndex} onChange={(event) => setSeatIndex(Number(event.target.value))}>
                {Array.from({ length: maxPlayers }, (_, index) => (
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
            <button className="iconButton" title="房间设置" type="button" onClick={openSettings}>
              <Menu size={26} />
            </button>
            <button className="iconButton" title="声音设置" type="button" onClick={() => setShowSoundPanel(!showSoundPanel)}>
              <Volume2 size={24} />
            </button>
            <button className="iconButton" title="筹码记录" type="button" onClick={openLedger}>
              <NotebookText size={23} />
            </button>
            <button className="iconButton" title="AI玩家" type="button" onClick={() => setShowAIPanel(!showAIPanel)}>
              <Bot size={22} />
            </button>
            <button className="iconButton" title="踢人" type="button" onClick={() => setShowKickPanel(!showKickPanel)}>
              <DoorOpen size={22} />
            </button>
          </div>

          <div className={`pokerTable ${throwEmoji ? "throwMode" : ""}`} onClick={() => { if (throwEmoji) { setThrowEmoji(null); } }}>
            <div className="tableCornerMeta">
              <span>
                {room?.settings.deckType === "royal-war" ? "👑RW" : "NLH"}
                {room?.game?.bombPot && " 💣"}
              </span>
              <strong>
                {room
                  ? `${room.settings.smallBlind} / ${room.settings.bigBlind}${room.settings.ante > 0 ? ` + ${room.settings.ante}` : ""}`
                  : "-- / --"}
              </strong>
              <span>{room ? `${room.settings.minPlayersToStart}+ 人开局 · ${room.settings.actionTimeoutSeconds} 秒行动` : ""}</span>
              {room?.settings.miniGames && getActiveMiniGameLabels(room.settings.miniGames).length > 0 && (
                <span className="miniGameInline">
                  {getActiveMiniGameLabels(room.settings.miniGames).join(" · ")}
                </span>
              )}
            </div>
            <div className="centerPot">
              <div className="birthdayBanner"><span className="birthdayMarquee">🎂 康师傅生日快乐！ 🎂 康师傅生日快乐！ 🎂</span></div>
              <div className="centerTopRow">
                <div className="potPill" ref={potRef}>
                  <CircleDollarSign size={18} /> {potTotal}
                </div>
                {room?.game && room.game.currentBet > 0 && <span className="streetBetPill">本轮最高 {room.game.currentBet}</span>}
              </div>
              {runoutBoards && runoutBoards.length > 1 ? (
                <div className="runoutBoards">
                  {runoutBoards.map((board, boardIndex) => (
                    <div className="runoutBoard" key={board.id}>
                      <span className="runoutLabel">第 {boardIndex + 1} 次</span>
                      <div className="community">
                        {[0, 1, 2, 3, 4].map((index) => (
                          <PokerCard key={index} card={board.cards[index]} dimmed={isShowdownHand && winnerBestCards.size > 0 && board.cards[index] ? !winnerBestCards.has(`${board.cards[index]!.rank}${board.cards[index]!.suit}`) : undefined} rankLabel={(board.cards[index] as Card) ? communityJokerRanks.get(`${(board.cards[index] as Card).rank}${(board.cards[index] as Card).suit}`) : undefined} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="communityRow">
                  <div className="community">
                    {[0, 1, 2, 3, 4].map((index) => {
                      const communityLen = room?.game?.communityCards.length ?? 0;
                      const c = room?.game?.communityCards[index] ?? rabbitCards?.[index - communityLen];
                      const isRabbit = Boolean(rabbitCards && index >= communityLen && c);
                      return (
                      <PokerCard
                        key={index}
                        card={c}
                        flipping={!rabbitCards && flipping.has(index)}
                        flipDelay={index * 120}
                        dimmed={isShowdownHand && winnerBestCards.size > 0 && c ? !winnerBestCards.has(`${c.rank}${c.suit}`) : undefined}
                        rabbit={isRabbit}
                        rankLabel={c ? communityJokerRanks.get(`${c.rank}${c.suit}`) : undefined}
                      />
                    );})}
                  </div>
                  {isFinished && room?.settings.rabbitHunting && (room?.game?.communityCards.length ?? 0) < 5 && !rabbitCards && (
                    <button className="rabbitBtn" onClick={() => socket?.emit("game:rabbit", { roomId })} title="Rabbit Hunt"><Rabbit size={18} /></button>
                  )}
                </div>
              )}
              {isFinished && winners.length > 0 ? (
                <div className="resultBanner">
                  {winners.map(({ player, delta }) => `${player.displayName} +${delta}`).join(" · ")}
                  {nextHandSeconds > 0 ? ` · ${nextHandSeconds} 秒后自动下一手` : ""}
                </div>
              ) : isRevealing ? (
                <div className="revealBanner">全下摊牌 · 正在逐张发牌</div>
              ) : (
                <span className="turnPill">{centerStatusText(room, currentPlayer?.displayName, nextHandSeconds)}</span>
              )}
            </div>

            {Array.from({ length: maxPlayers }, (_, index) => {
              const seat = room?.seats.find((item) => item.seatIndex === index);
              const player = room?.game?.players.find((item) => item.userId === seat?.userId);
              const positionIndex = displaySeatIndex(index, mySeat?.seatIndex, maxPlayers);
              const [left, top] = seatPositions[positionIndex] ?? [50, 50];
              const blindLabel =
                room?.game?.smallBlindSeatIndex === index ? "SB" : room?.game?.bigBlindSeatIndex === index ? "BB" : "";
              const handDelta = player ? winnerDeltas.get(player.userId) ?? 0 : 0;
              const equity = seat ? equityByUserId.get(seat.userId) : undefined;
              const currentHand = player ? handLabels.get(player.userId) : undefined;
              return (
                <div
                  className={`seat ${seat ? "" : "seatEmpty"} ${
                    seat && room?.game?.currentTurnUserId === seat.userId ? "seatActive" : ""
                  } ${seat?.userId === me?.id ? "seatSelf" : ""} ${
                    isFinished && seat && winnerIds.has(seat.userId) ? "seatWinner" : ""
                  } ${throwEmoji && seat && seat.userId !== me?.id ? "seatThrowTarget" : ""}`}
                  ref={seatRefCallbacks[index]}
                  style={{ left: `${left}%`, top: `${top}%` }}
                  key={index}
                  onClick={(e) => {
                    if (!throwEmoji || !seat || seat.userId === me?.id) return;
                    e.stopPropagation();
                    socket?.emit("emoji:throw", { roomId, toUserId: seat.userId, emoji: throwEmoji });
                    // Render local flight animation too
                    const mySeatEl = mySeat ? seatRefs.current.get(mySeat.seatIndex) : null;
                    const targetEl = seatRefs.current.get(index);
                    const fromRect = mySeatEl?.getBoundingClientRect();
                    const toRect = targetEl?.getBoundingClientRect();
                    setEmojiFlights((prev) => [...prev, {
                      id: flightIdRef.current++, fromUserId: me!.id, toUserId: seat.userId, emoji: throwEmoji,
                      fromX: fromRect ? fromRect.left + fromRect.width / 2 : 0,
                      fromY: fromRect ? fromRect.top + fromRect.height / 2 : 0,
                      toX: toRect ? toRect.left + toRect.width / 2 : 0,
                      toY: toRect ? toRect.top + toRect.height / 2 : 0,
                    }]);
                  }}
                >
                  {seat ? (
                    <>
                      <div className="seatName">
                        <span>{seat.displayName}</span>
                      </div>
                      <span className={`seatStatus ${seat.connected ? "statusOnline" : "statusOffline"}`}>{seat.connected ? "在线" : "离线"}</span>
                      <div className="seatChips">{seat.tableChips}</div>
                      <div className="muted">
                        {actionLabel(player?.lastAction ?? player?.status)} · 投入 {player?.totalCommitted ?? 0}
                      </div>
                      {player && !player.lastAction && player.committedThisStreet > 0 && !isFinished && (room?.game?.smallBlindSeatIndex === index || room?.game?.bigBlindSeatIndex === index) && (
                        <div className="streetBetBadge">{room?.game?.smallBlindSeatIndex === index ? `小盲 ${player.committedThisStreet}` : `大盲 ${player.committedThisStreet}`}</div>
                      )}
                      {player && player.lastAction && player.committedThisStreet > 0 && !isFinished && <div className="streetBetBadge">{streetActionLabel(player.lastAction, player.committedThisStreet)}</div>}
                      {player && player.lastAction === "check" && player.actedThisStreet && !isFinished && <div className="streetBetBadge">过牌</div>}
                      {player && isFinished && winnerIds.has(player.userId) && (
                        <div className="streetBetBadge winBadge">赢 +{winnerDeltas.get(player.userId)}</div>
                      )}
                      {currentHand && <div className="handStrengthBadge">{currentHand}</div>}
                      {isRevealing && equity && (
                        <div className="equityBadge">
                          胜率 {formatPercent(equity.winPercent)}
                          {equity.tiePercent > 0 ? ` · 平分 ${formatPercent(equity.tiePercent)}` : ""}
                        </div>
                      )}
                      <div className={`seatCards ${player?.status === "folded" && seat.userId !== me?.id ? "seatCardsFolded" : ""}`}>
                        {preStand && seat.userId === me?.id ? (
                          <span className="readyInBadge">Mamba out</span>
                        ) : player?.holeCards?.length ? (
                          player.holeCards.map((card, cardIndex) => {
                            const canReveal = isFinished && seat.userId === me?.id && !revealedSelf &&
                              (player?.status === "folded" || (!isShowdownHand && winnerIds.has(seat.userId)));
                            return (
                              <MiniCard
                                key={cardIndex}
                                card={card as Card}
                                dimmed={isShowdownHand && winnerBestCards.size > 0 ? !winnerBestCards.has(`${(card as Card).rank}${(card as Card).suit}`) : undefined}
                                rankLabel={getBestJokerRank(card as Card, [...(player.holeCards ?? []), ...(room?.game?.communityCards ?? [])] as Card[])}
                                onClick={canReveal ? () => { setRevealedSelf(true); socket?.emit("player:reveal", { roomId }); } : undefined}
                              />
                            );
                          })
                        ) : player ? (
                          <><div className="miniCard cardBack">?</div><div className="miniCard cardBack">?</div></>
                        ) : seat.ready ? (
                          <span className="readyInBadge">Mamba in</span>
                        ) : null}
                        {player?.status === "folded" && <span className="foldOverlay">FOLD</span>}
                      </div>
                      <div className="seatMarkers">
                        {room?.game?.buttonSeatIndex === index && <span className="dealerChip">D</span>}
                        {blindLabel && <span className="blindChip">{blindLabel}</span>}
                        {room?.game?.straddleSeatIndex === index && <span className="straddleChip">STR</span>}
                      </div>
                      <div
                        className={`seatEmoji ${seat.emoji ? "hasEmoji" : ""}`}
                        title={seat.emoji ? "点击更换或清除表情" : "点击设置表情"}
                        onClick={(e) => { e.stopPropagation(); setEmojiPickerSeat(emojiPickerSeat === index ? null : index); setEmojiTab(0); }}
                      >
                        {seat.emoji || "😊"}
                      </div>
                    </>
                  ) : (
                    <span>{index + 1} 号空位</span>
                  )}
                  {seat && room?.game?.currentTurnUserId === seat.userId && remainingSeconds !== undefined && (
                    <div className="seatTimer" aria-label="行动倒计时">
                      <span style={{ width: `${remainingPercent ?? 0}%` }} />
                      <em>{remainingSeconds}</em>
                    </div>
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
                    ? `本手已结算，${nextHandSeconds} 秒后自动开始下一手`
                    : "本手已结算，等待自动下一手"
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
            <button
              className={`btn btnDanger ${preFold ? "btnPreFold" : ""}`}
              disabled={!isSeated || !isActiveHand}
              onClick={() => {
                if (actionEnabled) { sendAction("fold"); return; }
                setPreFold((v) => !v);
              }}
            >
              {preFold && <span className="preFoldCheck">✓</span>}
              弃牌
            </button>
            <button className="btn" disabled={!actionEnabled} onClick={() => sendAction(toCall > 0 ? "call" : "check")}>
              {toCall > 0 ? `跟注 ${toCall}` : "过牌"}
            </button>
            <div className="potQuickButtons">
              {potQuickAmounts.map((option) => (
                <button
                  className="btn quickBetButton"
                  disabled={!actionEnabled}
                  key={option.label}
                  onClick={() => setAmount(option.amount)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input className="input betInput" type="number" value={amount} onChange={(event) => setAmount(Number(event.target.value))} onKeyDown={(e) => { if (e.key === "Enter" && actionEnabled) sendBetOrRaise(); }} />
            <button className="btn btnBet" disabled={!actionEnabled} onClick={sendBetOrRaise}>
              {betOrRaiseAction === "raise" ? "加注到" : "下注"}
            </button>
            <button className={`btn btnAllin ${allinConfirm ? "btnAllinGlow" : ""}`} disabled={!actionEnabled} onClick={() => sendAction("all-in")}>
              {allinConfirm ? "确认全下" : "全下"}
            </button>
          </div>
        </section>

        {coinAnims.map((coin) => (
          <span
            key={coin.id}
            className="coinFly"
            style={{
              left: coin.fromX,
              top: coin.fromY,
              animationDelay: `${coin.delay}s`,
              "--toX": `${coin.toX}px`,
              "--toY": `${coin.toY}px`,
              "--fromX": `${coin.fromX}px`,
              "--fromY": `${coin.fromY}px`,
            } as React.CSSProperties}
          >🪙</span>
        ))}

        {emojiFlights.map((flight) => {
          if (!flight.fromX && !flight.fromY) return null;
          return <span
            key={flight.id}
            className="emojiFly"
            style={{
              left: flight.fromX,
              top: flight.fromY,
              "--toX": `${flight.toX}px`,
              "--toY": `${flight.toY}px`,
              "--fromX": `${flight.fromX}px`,
              "--fromY": `${flight.fromY}px`,
            } as React.CSSProperties}
          >
            {flight.emoji}
          </span>;
        })}

        <aside className="sidePanel tableDrawer">
          <div className="card tableInfoCard">
            <h2>我的信息</h2>
            <div className="statRow">
              <span className="muted">账号</span>
              <strong>{me?.displayName}</strong>
            </div>
            <div className="statRow">
              <span className="muted">账户筹码</span>
              <strong>{me?.virtualChips ?? 0}</strong>
            </div>
            <div className="statRow">
              <span className="muted">桌上筹码</span>
              <strong>{mySeat?.tableChips ?? 0}</strong>
            </div>
            <div className="chipAdjustPanel">
              <input
                className="input chipInput"
                min={1}
                type="number"
                value={chipAmount}
                onChange={(event) => setChipAmount(Number(event.target.value))}
              />
              <button className="btn" disabled={!isSeated} onClick={() => adjustTableChips("add")}>
                补码
              </button>
              <button className="btn" disabled={!isSeated} onClick={() => adjustTableChips("remove")}>
                扣码
              </button>
              {isSeated && isActiveHand && <small className="muted">补码下一手生效</small>}
            </div>
            <div className="statRow">
              <span className="muted">观战人数</span>
              <strong>{room?.spectatorCount ?? 0}</strong>
            </div>
          </div>

          <div className="card tableLogCard">
            <h2>行动记录</h2>
            <div className="logScroll" ref={logScrollRef}>
              {(room?.game?.actionLog ?? []).map((entry, index) => {
                const name = room?.game?.players.find((p) => p.userId === entry.userId)?.displayName ?? "";
                return (
                  <div className="listRow" key={`${entry.createdAt}-${index}`}>
                    <span>{name ? `${name} ` : ""}{actionLabel(entry.action)}</span>
                    <span className="muted">{entry.amount ?? ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <div className="chatFloat">
          <div className="chatLog" ref={chatLogRef}>
            {messages.map((message) => (
              <div className="chatLine" key={message.id}>
                <strong>{message.displayName}</strong>
                <div>{message.message}</div>
                <small className="muted">{new Date(message.createdAt).toLocaleTimeString()}</small>
              </div>
            ))}
          </div>
          <div className="chatFormRow">
            <form className="actions" onSubmit={sendChat}>
              <input className="input" value={chat} maxLength={300} onChange={(event) => setChat(event.target.value)} placeholder="输入消息..." />
              <button className="btn btnPrimary" type="submit">
                <Send size={14} />
              </button>
            </form>
            <button
              className={`btn ${throwEmoji ? "btnDanger" : ""}`}
              title="投掷表情"
              onClick={() => {
                if (throwEmoji) { setThrowEmoji(null); setThrowPickerOpen(false); return; }
                setThrowPickerOpen(true);
              }}
            >
              🎯
            </button>
            {throwPickerOpen && !throwEmoji && (
              <div className="throwPickerPopover">
                <div className="throwPickerGrid">
                  {["😂","🔥","💩","🍅","👏","❤️","🎉","💀","😭","🤡","👍","👎","😍","🤬","🙏","💪","🎯","🍻","💣","✨","⚡","👑","🎁","🚀","🖕"].map((e) => (
                    <button key={e} className="throwEmojiCell" onClick={() => { setThrowEmoji(e); setThrowPickerOpen(false); }}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {showSettings && (
          <div className="modalOverlay" onClick={() => setShowSettings(false)}>
            <div className="modalCard" onClick={(e) => e.stopPropagation()}>
              <h2>房间设置</h2>
              <div className="field">
                <label>小盲</label>
                <input className="input" type="number" min={1} value={editSmallBlind} onChange={(e) => setEditSmallBlind(Number(e.target.value))} />
              </div>
              <div className="field">
                <label>大盲</label>
                <input className="input" type="number" min={2} value={editBigBlind} onChange={(e) => setEditBigBlind(Number(e.target.value))} />
              </div>
              <div className="field">
                <label>行动倒计时（秒）</label>
                <input className="input" type="number" min={5} max={300} value={editTimeout} onChange={(e) => setEditTimeout(Number(e.target.value))} />
              </div>
              <div className="field">
                <label>
                  <input type="checkbox" checked={editRabbitHunting} onChange={(e) => setEditRabbitHunting(e.target.checked)} />
                  {" "}Rabbit Hunting
                </label>
                <small className="muted">牌局提前结束时展示后续公共牌</small>
              </div>
              <div className="field">
                <label>牌库模式</label>
                <select className="select" value={editDeckType} onChange={(e) => setEditDeckType(e.target.value)}>
                  <option value="standard">标准（52张）</option>
                  <option value="royal-war">王室战争（54张+大小王）</option>
                </select>
                <small className="muted">下一局生效</small>
              </div>
              <div className="actions">
                <button className="btn" onClick={() => setShowSettings(false)}>取消</button>
                <button className="btn btnPrimary" onClick={saveSettings}>保存</button>
              </div>
            </div>
          </div>
        )}

        {showLedger && (
          <div className="modalOverlay" onClick={() => setShowLedger(false)}>
            <div className="modalCard modalWide" onClick={(e) => e.stopPropagation()}>
              <h2>筹码记录</h2>
              <table className="ledgerTable">
                <thead>
                  <tr><th>玩家</th><th>买入</th><th>卖出</th><th>桌上筹码</th><th>净收入</th></tr>
                </thead>
                <tbody>
                  {ledger.map((row) => (
                    <tr key={row.userId}>
                      <td>{row.displayName}</td>
                      <td>{row.boughtIn}</td>
                      <td>{row.cashedOut}</td>
                      <td>{row.tableChips}</td>
                      <td className={row.net >= 0 ? "netPositive" : "netNegative"}>
                        {row.net >= 0 ? "+" : ""}{row.net}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="actions">
                <button className="btn" onClick={() => setShowLedger(false)}>关闭</button>
              </div>
            </div>
          </div>
        )}

        {showAIPanel && (
          <div className="modalOverlay" onClick={() => setShowAIPanel(false)}>
            <div className="modalCard" onClick={(e) => e.stopPropagation()}>
              <h2>🤖 AI 玩家管理</h2>
              <div className="aiPanelBody">
                <button
                  className="btn btnPrimary aiPanelBtn"
                  disabled={aiLoading}
                  onClick={async () => {
                    setAiLoading(true);
                    try {
                      const res = await fetch("/api/rooms/" + roomId + "/ai-players", {
                        method: "POST",
                      });
                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        setError(data.message ?? "添加AI失败");
                      } else {
                        setError("");
                      }
                    } catch {
                      setError("添加AI失败");
                    }
                    setAiLoading(false);
                  }}
                >
                  {aiLoading ? "添加中..." : "+ 添加 AI 玩家"}
                </button>
                <button
                  className="btn btnDanger aiPanelBtn"
                  disabled={aiLoading}
                  onClick={async () => {
                    setAiLoading(true);
                    try {
                      const res = await fetch("/api/rooms/" + roomId + "/ai-players", {
                        method: "DELETE",
                      });
                      const data = await res.json().catch(() => ({}));
                      if (res.ok) {
                        setError(`已移除 ${data.removed ?? 0} 个AI玩家`);
                      } else {
                        setError(data.message ?? "删除AI失败");
                      }
                    } catch {
                      setError("删除AI失败");
                    }
                    setAiLoading(false);
                  }}
                >
                  删除所有 AI 玩家
                </button>
              </div>
              <div className="actions">
                <button className="btn" onClick={() => setShowAIPanel(false)}>关闭</button>
              </div>
            </div>
          </div>
        )}

        {showSoundPanel && (
          <div className="modalOverlay" onClick={() => setShowSoundPanel(false)}>
            <div className="modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 320 }}>
              <h2>声音设置</h2>
              <label className="checkboxRow" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={simpleSound}
                  onChange={(e) => {
                    setSimpleSound(e.target.checked);
                    localStorage.setItem("simpleSound", e.target.checked ? "1" : "0");
                  }}
                />
                简约模式（仅播放轮到你和 All-in 音效）
              </label>
              <div className="actions" style={{ marginTop: 16 }}>
                <button className="btn" onClick={() => setShowSoundPanel(false)}>关闭</button>
              </div>
            </div>
          </div>
        )}

        {showKickPanel && (
          <div className="modalOverlay" onClick={() => setShowKickPanel(false)}>
            <div className="modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 280 }}>
              <h2>踢出玩家</h2>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {room?.seats.filter((s) => s.userId !== me?.id).length === 0 && <p className="muted">没有可踢出的玩家</p>}
                {room?.seats.filter((s) => s.userId !== me?.id).map((s) => (
                  <button key={s.userId} className="btn" style={{ justifyContent: "flex-start" }} onClick={() => { emit("room:kick", { roomId, targetUserId: s.userId }); setShowKickPanel(false); }}>
                    <DoorOpen size={16} style={{ marginRight: 8 }} />
                    {s.displayName}（{s.seatIndex + 1} 号位）
                  </button>
                ))}
              </div>
              <div className="actions" style={{ marginTop: 16 }}>
                <button className="btn" onClick={() => setShowKickPanel(false)}>关闭</button>
              </div>
            </div>
          </div>
        )}

        {emojiPickerSeat !== null && (
          <div className="modalOverlay" onClick={() => setEmojiPickerSeat(null)}>
            <div className="emojiPicker" onClick={(e) => e.stopPropagation()}>
              <div className="emojiTabs">
                {EMOJI_CATEGORIES.map((cat, i) => (
                  <button
                    key={cat.label}
                    className={`emojiTab ${i === emojiTab ? "active" : ""}`}
                    onClick={() => setEmojiTab(i)}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              <div className="emojiGrid">
                {(EMOJI_CATEGORIES[emojiTab]?.emojis ?? []).map((emoji) => (
                  <button
                    key={emoji}
                    className="emojiCell"
                    onClick={() => {
                      socket?.emit("emoji:set", { roomId, emoji });
                      setEmojiPickerSeat(null);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="emojiActions">
                <button
                  className="btn"
                  onClick={() => {
                    socket?.emit("emoji:set", { roomId, emoji: "" });
                    setEmojiPickerSeat(null);
                  }}
                >
                  清除表情
                </button>
                <button className="btn" onClick={() => setEmojiPickerSeat(null)}>关闭</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function isMyTurn(room?: RoomState, me?: AuthUser): boolean {
  return Boolean(room?.game?.currentTurnUserId && me?.id && room.game.currentTurnUserId === me.id);
}

function displaySeatIndex(seatIndex: number, selfSeatIndex: number | undefined, maxPlayers: number): number {
  if (selfSeatIndex === undefined) {
    return seatIndex;
  }
  return (seatIndex - selfSeatIndex + maxPlayers) % maxPlayers;
}

function potSizedAmount(game: PublicPokerGameState, player: PublicEnginePlayer, potTotal: number, ratio: number): number {
  const toCall = Math.max(0, game.currentBet - player.committedThisStreet);
  const maxTarget = player.committedThisStreet + player.stack;
  if (game.currentBet > 0) {
    const potAfterCall = potTotal + toCall;
    const target = player.committedThisStreet + toCall + Math.round(potAfterCall * ratio);
    return Math.max(game.currentBet + game.minRaise, Math.min(maxTarget, target));
  }
  const target = Math.round(potTotal * ratio);
  return Math.max(game.bigBlind, Math.min(maxTarget, target || game.bigBlind));
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

const MINI_GAME_LABELS: Record<keyof MiniGameSettings, string> = {
  sevenTwo: "🎯 7-2",
  bombPot: "💣 炸弹底池",
  straddle: "🎲 抓头",
  showOne: "👁 亮一张",
  threePeat: "🔥 三连冠",
};

function getActiveMiniGameLabels(miniGames?: MiniGameSettings): string[] {
  if (!miniGames) return [];
  return Object.entries(miniGames)
    .filter(([, enabled]) => enabled)
    .map(([key]) => MINI_GAME_LABELS[key as keyof MiniGameSettings] ?? key);
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

function streetActionLabel(lastAction: string, amount: number): string {
  const labels: Record<string, string> = {
    fold: "弃牌",
    check: "过牌",
    call: "跟注",
    bet: "下注",
    raise: "加注",
    "all-in": "All-in",
  };
  const label = labels[lastAction] ?? lastAction;
  if (lastAction === "fold" || lastAction === "check") {
    return label;
  }
  return `${label} ${amount}`;
}

function describeCurrentHand(player: PublicEnginePlayer | undefined, communityCards: Card[]): string | undefined {
  const holeCards = player?.holeCards;
  if (!holeCards || holeCards.length === 0 || player?.status === "folded") {
    return undefined;
  }
  const cards = [...holeCards, ...communityCards];
  if (cards.length < 5) {
    if (holeCards.length === 2 && holeCards[0]?.rank === holeCards[1]?.rank) {
      return "一对";
    }
    if (holeCards.some(isJoker)) {
      return "Joker";
    }
    return `高牌 ${holeCards.map((card) => card.rank).join("/")}`;
  }
  const evaluation = evaluateHand(cards);
  return evaluation ? handCategoryLabel[evaluation.category] : undefined;
}

function useJokerRanks(allCards: Card[], phase: string | undefined) {
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const c of allCards) {
      map.set(`${c.rank}${c.suit}`, getBestJokerRank(c, allCards));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, allCards]);
}

function useHandLabels(players: PublicEnginePlayer[] | undefined, communityCards: Card[], phase: string | undefined) {
  return useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const p of players ?? []) {
      map.set(p.userId, describeCurrentHand(p, communityCards));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, players, communityCards]);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

const PokerCard = React.memo(function PokerCard({ card, flipping, flipDelay = 0, dimmed, rabbit, rankLabel }: { card?: Card; flipping?: boolean; flipDelay?: number; dimmed?: boolean; rabbit?: boolean; rankLabel?: string }) {
  if (!card) return <div className="playingCard communityEmpty" />;
  const red = isRed(card);
  const joker = isJoker(card);
  return (
    <div
      className={`playingCard ${red ? "redCard" : ""} ${joker ? "jokerCard" : ""} ${flipping ? "cardFlipping" : ""} ${dimmed === true ? "cardDimmed" : dimmed === false ? "cardHighlight" : ""} ${rabbit ? "rabbitCard" : ""}`}
      style={flipping ? { animationDelay: `${flipDelay}ms` } : undefined}
    >
      {joker ? (
        <>
          {rankLabel ? <span className="boardRank jokerRankBlink">{rankLabel}</span> : null}
          <span className="boardSuit jokerEmoji">👑</span>
        </>
      ) : (
        <>
          <span className="boardRank">{card.rank}</span>
          <span className="boardSuit">{suitSymbol[card.suit] ?? card.suit}</span>
        </>
      )}
    </div>
  );
});

const suitSymbol: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣", x: "" };

const MiniCard = React.memo(function MiniCard({ card, dimmed, rankLabel, onClick }: { card?: Card; dimmed?: boolean; rankLabel?: string; onClick?: () => void }) {
  if (!card) return <div className="miniCard cardBack">?</div>;
  const red = isRed(card);
  const joker = isJoker(card);
  return (
    <div className={`miniCard ${red ? "redCard" : ""} ${joker ? "jokerCard" : ""} ${dimmed === true ? "cardDimmed" : dimmed === false ? "cardHighlight" : ""} ${onClick ? "cardRevealable" : ""}`} onClick={onClick} title={onClick ? "点击向全桌展示手牌" : undefined}>
      {joker ? (
        <>
          {rankLabel ? <span className="miniRank jokerRankBlink">{rankLabel}</span> : null}
          <span className="miniSuit jokerEmoji">👑</span>
        </>
      ) : (
        <>
          <span className="miniRank">{card.rank}</span>
          <span className="miniSuit">{suitSymbol[card.suit] ?? card.suit}</span>
        </>
      )}
    </div>
  );
});
