import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import {
  advanceRunoutReveal,
  applyAction,
  chooseRunout,
  getPublicGameStateForUser,
  rabbitHunt,
  startHand,
  type Card,
  type DeckType,
  type PokerGameState,
  type RunoutMode,
} from "@friends-poker/poker-engine";
import type { AuthUser, ChatMessageDto, MiniGameSettings, RoomSettingsDto, RoomStatus, RoomSummaryDto } from "@friends-poker/shared";
import { getAutomaticTimeoutAction, reconcileActionClock } from "./actionClock";
import { type AIDecision, getAIDecision } from "./aiPlayer";
import { config } from "./config";
import { prisma } from "./prisma";

export interface RuntimeSeat {
  userId: string;
  displayName: string;
  seatIndex: number;
  tableChips: number;
  ready: boolean;
  connected: boolean;
  pendingChips: number;
  emoji?: string;
}

export interface RuntimeRoom {
  id: string;
  name: string;
  status: RoomStatus;
  settings: RoomSettingsDto;
  createdById: string;
  createdAt: string;
  seats: RuntimeSeat[];
  spectators: Map<string, string>;
  game?: PokerGameState;
  handCounter: number;
  nextHandReadyAt?: string;
  revealedPlayerIds: Set<string>;
  /** Track consecutive wins per user for three-peat mini-game */
  threePeatWinStreak: Map<string, number>;
}

type PersistedSeat = {
  userId: string;
  user: { displayName: string };
  seatIndex: number;
  tableChips: number;
  ready: boolean;
};

const rooms = new Map<string, RuntimeRoom>();
const socketUsers = new Map<string, AuthUser>();
const actionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const offlineCloseTimers = new Map<string, ReturnType<typeof setTimeout>>();
const runoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
const handPauseTimers = new Map<string, ReturnType<typeof setTimeout>>();
const aiOnlyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const aiUserIds = new Set<string>();
const RUNOUT_REVEAL_DELAY_MS = 1500;
const HAND_RESULT_HOLD_MS = 7000;
const AI_ONLY_STAND_UP_SECONDS = 180;
let realtimeServer: Server | undefined;

interface CloseRoomOptions {
  auditAction?: string;
  ledgerReason?: string;
  metadata?: Record<string, unknown>;
}

export function attachRealtimeServer(io: Server): void {
  realtimeServer = io;
  scheduleAllActionTimers();
  scheduleAllRunoutTimers();
}

export function rememberSocket(socket: Socket, user: AuthUser): void {
  socketUsers.set(socket.id, user);
  for (const room of rooms.values()) {
    const seat = room.seats.find((item) => item.userId === user.id);
    if (seat) {
      seat.connected = true;
      clearOfflineCloseTimer(room.id);
      clearAIOnlyTimer(room.id);
    }
  }
}

export function forgetSocket(socket: Socket): void {
  const user = socketUsers.get(socket.id);
  socketUsers.delete(socket.id);
  if (!user) {
    return;
  }
  // Only mark offline if user has no remaining sockets
  const hasOtherSocket = [...socketUsers.values()].some((u) => u.id === user.id);
  if (hasOtherSocket) return;
  for (const room of rooms.values()) {
    const seat = room.seats.find((item) => item.userId === user.id);
    if (seat) {
      seat.connected = false;
      scheduleOfflineCloseIfNeeded(room.id);
      scheduleAIOnlyStandUp(room.id);
    }
  }
}

export async function hydrateRoomsFromDatabase(): Promise<void> {
  rooms.clear();

  // Restore AI user ID set
  aiUserIds.clear();
  const aiUsers = await prisma.user.findMany({ where: { isAI: true }, select: { id: true } });
  for (const u of aiUsers) aiUserIds.add(u.id);

  const persistedRooms = await prisma.room.findMany({
    where: { status: { in: ["WAITING", "PLAYING"] }, deletedAt: null },
    include: { seats: { where: { status: "OCCUPIED" }, include: { user: true } } },
  });

  for (const persisted of persistedRooms) {
    const room: RuntimeRoom = {
      id: persisted.id,
      name: persisted.name,
      status: persisted.status,
      createdById: persisted.createdById,
      createdAt: persisted.createdAt.toISOString(),
      settings: {
        name: persisted.name,
        maxPlayers: persisted.maxPlayers,
        minPlayersToStart: persisted.minPlayersToStart,
        smallBlind: persisted.smallBlind,
        bigBlind: persisted.bigBlind,
        ante: persisted.ante,
        minBuyIn: persisted.minBuyIn,
        maxBuyIn: persisted.maxBuyIn,
        actionTimeoutSeconds: persisted.actionTimeoutSeconds,
        creatorOnlyStart: persisted.creatorOnlyStart,
        allowSpectators: persisted.allowSpectators,
        rabbitHunting: (persisted as any).rabbitHunting ?? true,
        deckType: (persisted as any).deckType ?? "standard",
        miniGames: {
          sevenTwo: (persisted as any).sevenTwo ?? false,
          bombPot: (persisted as any).bombPot ?? false,
          straddle: (persisted as any).straddle ?? false,
          showOne: (persisted as any).showOne ?? false,
          threePeat: (persisted as any).threePeat ?? false,
        },
      },
      seats: persisted.seats.map((seat: PersistedSeat) => ({
        userId: seat.userId,
        displayName: seat.user.displayName,
        seatIndex: seat.seatIndex,
        tableChips: seat.tableChips,
        ready: seat.ready,
        connected: false,
        pendingChips: 0,
      })),
      spectators: new Map(),
      game: persisted.gameSnapshot as unknown as PokerGameState | undefined,
      handCounter: Number((persisted.gameSnapshot as any)?.handNumber ?? 0),
      revealedPlayerIds: new Set(),
      threePeatWinStreak: new Map(),
    };

    if (room.game) {
      syncStacksFromGame(room);
      if (room.game.phase === "finished") {
        await settleFinishedRoomIfNeeded(room);
        await persistRoomSnapshot(room);
      } else if (room.game.phase === "revealing") {
        // The room is re-added to the runtime map below, then the reveal timer is resumed.
      } else if (reconcileActionClock(room.game, room.settings.actionTimeoutSeconds, new Date())) {
        await persistRoomSnapshot(room);
      }
    } else {
      await standUpBustedSeats(room);
    }

    rooms.set(persisted.id, room);
    if (room.game?.phase === "revealing") {
      scheduleRunoutReveal(room.id);
    }
    scheduleHandPauseTimer(room.id);
    scheduleActionTimer(room.id);
    scheduleOfflineCloseIfNeeded(room.id);
  }
}

export function listRooms(): RoomSummaryDto[] {
  return [...rooms.values()]
    .filter((room) => room.status !== "CLOSED")
    .map((room) => ({
      id: room.id,
      name: room.name,
      status: room.status,
      seatedCount: room.seats.length,
      spectatorCount: room.spectators.size,
      maxPlayers: room.settings.maxPlayers,
      minPlayersToStart: room.settings.minPlayersToStart,
      smallBlind: room.settings.smallBlind,
      bigBlind: room.settings.bigBlind,
      ante: room.settings.ante,
      actionTimeoutSeconds: room.settings.actionTimeoutSeconds,
      creatorOnlyStart: room.settings.creatorOnlyStart,
      deckType: (room.settings.deckType ?? "standard") as DeckType,
      miniGames: room.settings.miniGames ?? ({} as MiniGameSettings),
      createdById: room.createdById,
      createdAt: room.createdAt,
    }));
}

export function getRuntimeRoom(roomId: string): RuntimeRoom {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error("房间不存在");
  }
  return room;
}

export function getRuntimeRoomIfLoaded(roomId: string): RuntimeRoom | undefined {
  return rooms.get(roomId);
}

export async function createRuntimeRoom(user: AuthUser, input: RoomSettingsDto): Promise<RuntimeRoom> {
  if (input.bigBlind < input.smallBlind * 2) {
    throw new Error("大盲至少应为小盲的 2 倍");
  }
  if (input.minPlayersToStart > input.maxPlayers) {
    throw new Error("开局人数不能大于最大人数");
  }
  if (input.ante > input.bigBlind) {
    throw new Error("前注不能大于大盲");
  }
  if (input.maxBuyIn < input.minBuyIn) {
    throw new Error("最大买入不能小于最小买入");
  }

  const dbRoom = await prisma.room.create({
    data: {
      name: input.name,
      maxPlayers: input.maxPlayers,
      minPlayersToStart: input.minPlayersToStart,
      smallBlind: input.smallBlind,
      bigBlind: input.bigBlind,
      ante: input.ante,
      minBuyIn: input.minBuyIn,
      maxBuyIn: input.maxBuyIn,
      actionTimeoutSeconds: input.actionTimeoutSeconds,
      creatorOnlyStart: input.creatorOnlyStart,
      allowSpectators: input.allowSpectators,
      rabbitHunting: input.rabbitHunting,
      deckType: input.deckType ?? "standard",
      sevenTwo: input.miniGames?.sevenTwo ?? false,
      bombPot: input.miniGames?.bombPot ?? false,
      straddle: input.miniGames?.straddle ?? false,
      showOne: input.miniGames?.showOne ?? false,
      threePeat: input.miniGames?.threePeat ?? false,
      createdById: user.id,
    },
  });

  const room: RuntimeRoom = {
    id: dbRoom.id,
    name: dbRoom.name,
    status: dbRoom.status,
    createdById: user.id,
    createdAt: dbRoom.createdAt.toISOString(),
    settings: input,
    seats: [],
    spectators: new Map(),
    handCounter: 0,
    revealedPlayerIds: new Set(),
    threePeatWinStreak: new Map(),
  };
  rooms.set(room.id, room);
  return room;
}

export async function updateRoomSettings(
  roomId: string,
  user: AuthUser,
  input: { smallBlind?: number; bigBlind?: number; actionTimeoutSeconds?: number; rabbitHunting?: boolean; deckType?: string },
): Promise<void> {
  const room = getRuntimeRoom(roomId);
  if (room.createdById !== user.id) {
    throw new Error("只有房主可以修改房间设置");
  }
  // 所有设置均可随时修改，牌局进行中则下一局生效  if (input.smallBlind !== undefined) room.settings.smallBlind = input.smallBlind;
  if (input.bigBlind !== undefined) room.settings.bigBlind = input.bigBlind;
  if (input.actionTimeoutSeconds !== undefined) room.settings.actionTimeoutSeconds = input.actionTimeoutSeconds;
  if (input.rabbitHunting !== undefined) room.settings.rabbitHunting = input.rabbitHunting;
  if (input.deckType !== undefined) room.settings.deckType = input.deckType;
  if (room.settings.bigBlind < room.settings.smallBlind * 2) {
    throw new Error("大盲至少应为小盲的 2 倍");
  }
  await prisma.room.update({
    where: { id: roomId },
    data: {
      ...(input.smallBlind !== undefined ? { smallBlind: input.smallBlind } : {}),
      ...(input.bigBlind !== undefined ? { bigBlind: input.bigBlind } : {}),
      ...(input.actionTimeoutSeconds !== undefined ? { actionTimeoutSeconds: input.actionTimeoutSeconds } : {}),
      ...(input.rabbitHunting !== undefined ? { rabbitHunting: input.rabbitHunting } : {}),
      ...(input.deckType !== undefined ? { deckType: input.deckType } : {}),
    },
  });
  if (realtimeServer) {
    await emitRoomState(realtimeServer, roomId);
    await emitAllRoomLists(realtimeServer);
  }
}

export async function getRoomLedger(roomId: string): Promise<{
  userId: string;
  displayName: string;
  boughtIn: number;
  cashedOut: number;
  tableChips: number;
  net: number;
}[]> {
  const room = getRuntimeRoom(roomId);
  const entries = await prisma.virtualChipLedger.findMany({
    where: {
      roomId,
      reason: { in: ["TABLE_BUY_IN", "TABLE_TOP_UP", "TABLE_WITHDRAW", "TABLE_LEAVE_RETURN"] },
    },
  });
  const playerMap = new Map<string, { displayName: string; boughtIn: number; cashedOut: number; tableChips: number }>();
  for (const entry of entries) {
    const row = playerMap.get(entry.userId) ?? { displayName: "", boughtIn: 0, cashedOut: 0, tableChips: 0 };
    if (entry.reason === "TABLE_BUY_IN" || entry.reason === "TABLE_TOP_UP") row.boughtIn += Math.abs(entry.delta);
    else row.cashedOut += entry.delta;
    playerMap.set(entry.userId, row);
  }
  // Fill names from current seats
  for (const seat of room.seats) {
    const row = playerMap.get(seat.userId);
    if (row) { row.displayName = seat.displayName; row.tableChips = seat.tableChips + seat.pendingChips; }
  }
  // Fill missing names from DB for historical players
  const missingIds = [...playerMap.entries()].filter(([, r]) => !r.displayName).map(([id]) => id);
  if (missingIds.length > 0) {
    const users = await prisma.user.findMany({ where: { id: { in: missingIds } }, select: { id: true, displayName: true } });
    for (const u of users) {
      const row = playerMap.get(u.id);
      if (row) row.displayName = u.displayName;
    }
  }
  return [...playerMap.entries()].map(([userId, row]) => ({
    userId,
    displayName: row.displayName || userId,
    boughtIn: row.boughtIn,
    cashedOut: row.cashedOut,
    tableChips: row.tableChips,
    net: row.cashedOut + row.tableChips - row.boughtIn,
  }));
}

export async function sitDown(roomId: string, user: AuthUser, seatIndex: number, buyIn: number): Promise<void> {
  const room = getRuntimeRoom(roomId);
  if (room.status === "CLOSED") {
    throw new Error("房间已关闭");
  }
  if (seatIndex >= room.settings.maxPlayers) {
    throw new Error("该座位超出房间人数上限");
  }
  if (buyIn < room.settings.minBuyIn || buyIn > room.settings.maxBuyIn) {
    throw new Error(`买入需在 ${room.settings.minBuyIn} 到 ${room.settings.maxBuyIn} 之间`);
  }
  if (room.seats.some((seat) => seat.seatIndex === seatIndex)) {
    throw new Error("该座位已被占用");
  }
  if (room.seats.some((seat) => seat.userId === user.id)) {
    throw new Error("你已经坐在本房间");
  }

  const latestUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!latestUser || latestUser.virtualChips < buyIn) {
    throw new Error("虚拟筹码不足");
  }

  await prisma.$transaction([
    prisma.roomSeat.deleteMany({
      where: {
        roomId,
        status: "STANDING",
        OR: [{ userId: user.id }, { seatIndex }],
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { virtualChips: { decrement: buyIn } },
    }),
    prisma.virtualChipLedger.create({
      data: { userId: user.id, delta: -buyIn, reason: "TABLE_BUY_IN", roomId },
    }),
    prisma.roomSeat.create({
      data: {
        roomId,
        userId: user.id,
        seatIndex,
        tableChips: buyIn,
      },
    }),
  ]);

  room.spectators.delete(user.id);
  room.seats.push({
    userId: user.id,
    displayName: user.displayName,
    seatIndex,
    tableChips: buyIn,
    ready: false,
    connected: true,
    pendingChips: 0,
  });
  room.seats.sort((a, b) => a.seatIndex - b.seatIndex);
  clearOfflineCloseTimer(room.id);
}

export async function standUp(roomId: string, user: AuthUser, force = false): Promise<void> {
  const room = getRuntimeRoom(roomId);
  if (!force && room.game && room.game.phase !== "finished") {
    throw new Error("一手牌进行中暂不能站起");
  }
  const seat = room.seats.find((item) => item.userId === user.id);
  if (!seat) {
    return;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { virtualChips: { increment: seat.tableChips } },
    }),
    prisma.virtualChipLedger.create({
      data: { userId: user.id, delta: seat.tableChips, reason: "TABLE_LEAVE_RETURN", roomId },
    }),
    prisma.roomSeat.update({
      where: { roomId_userId: { roomId, userId: user.id } },
      data: { status: "STANDING", tableChips: 0, ready: false, leftAt: new Date() },
    }),
  ]);

  room.seats = room.seats.filter((item) => item.userId !== user.id);
}

export async function addTableChips(roomId: string, user: AuthUser, amount: number): Promise<void> {
  const room = getRuntimeRoom(roomId);
  const seat = room.seats.find((item) => item.userId === user.id);
  if (!seat) {
    throw new Error("只有已坐下玩家可以补码");
  }
  if (seat.tableChips + seat.pendingChips + amount > room.settings.maxBuyIn) {
    throw new Error(`桌上筹码不能超过 ${room.settings.maxBuyIn}`);
  }

  const latestUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!latestUser || latestUser.virtualChips < amount) {
    throw new Error("虚拟筹码不足");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { virtualChips: { decrement: amount } },
    }),
    prisma.virtualChipLedger.create({
      data: { userId: user.id, delta: -amount, reason: "TABLE_TOP_UP", roomId },
    }),
    prisma.roomSeat.update({
      where: { roomId_userId: { roomId, userId: user.id } },
      data: { tableChips: { increment: amount } },
    }),
  ]);

  if (room.game && room.game.phase !== "finished") {
    seat.pendingChips += amount;
  } else {
    seat.tableChips += amount;
  }
}

export async function removeTableChips(roomId: string, user: AuthUser, amount: number): Promise<void> {
  const room = getRuntimeRoom(roomId);
  const seat = room.seats.find((item) => item.userId === user.id);
  if (!seat) {
    throw new Error("只有已坐下玩家可以扣码");
  }
  const effective = seat.tableChips + seat.pendingChips;
  if (amount > effective) {
    throw new Error("扣码数量不能大于桌上筹码");
  }

  const leavesSeat = amount === effective;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { virtualChips: { increment: amount } },
    }),
    prisma.virtualChipLedger.create({
      data: { userId: user.id, delta: amount, reason: "TABLE_WITHDRAW", roomId },
    }),
    prisma.roomSeat.update({
      where: { roomId_userId: { roomId, userId: user.id } },
      data: leavesSeat
        ? { status: "STANDING", tableChips: 0, ready: false, leftAt: new Date() }
        : { tableChips: { decrement: amount } },
    }),
  ]);

  if (leavesSeat) {
    room.seats = room.seats.filter((item) => item.userId !== user.id);
  } else if (room.game && room.game.phase !== "finished") {
    seat.pendingChips -= amount;
  } else {
    seat.tableChips -= amount;
  }
}

export async function setReady(roomId: string, user: AuthUser, ready: boolean): Promise<void> {
  const room = getRuntimeRoom(roomId);
  const seat = room.seats.find((item) => item.userId === user.id);
  if (!seat) {
    throw new Error("只有已坐下玩家可以准备");
  }
  if (seat.tableChips + seat.pendingChips <= 0) {
    throw new Error("桌上筹码不足");
  }
  seat.ready = ready;
  await prisma.roomSeat.update({
    where: { roomId_userId: { roomId, userId: user.id } },
    data: { ready },
  });
}

export async function joinAsSpectator(roomId: string, user: AuthUser, socketId: string): Promise<void> {
  const room = getRuntimeRoom(roomId);
  const seat = room.seats.find((item) => item.userId === user.id);
  if (seat) {
    seat.connected = true;
    clearOfflineCloseTimer(room.id);
    return;
  }
  if (!room.settings.allowSpectators) {
    throw new Error("该房间不允许观战");
  }
  room.spectators.set(user.id, socketId);
}

export function leaveRoom(roomId: string, user: AuthUser): void {
  const room = getRuntimeRoom(roomId);
  room.spectators.delete(user.id);
  const seat = room.seats.find((item) => item.userId === user.id);
  if (seat) {
    seat.connected = false;
    scheduleOfflineCloseIfNeeded(room.id);
    scheduleAIOnlyStandUp(room.id);
  }
}

export async function startRuntimeHand(roomId: string, user: AuthUser): Promise<void> {
  const room = getRuntimeRoom(roomId);
  if (!room.seats.some((seat) => seat.userId === user.id)) {
    throw new Error("只有牌桌玩家可以开始牌局");
  }
  if (room.settings.creatorOnlyStart && room.createdById !== user.id) {
    throw new Error("只有房间创建者可以开始牌局");
  }
  if (room.game && room.game.phase !== "finished") {
    throw new Error("当前已有牌局进行中");
  }
  if (room.nextHandReadyAt && Date.parse(room.nextHandReadyAt) > Date.now()) {
    throw new Error("上一手结算展示中，请稍候");
  }
  const readySeats = room.seats.filter((seat) => seat.ready && seat.tableChips > 0);
  if (readySeats.length < room.settings.minPlayersToStart) {
    throw new Error(`至少需要 ${room.settings.minPlayersToStart} 名已准备玩家`);
  }
  await beginRuntimeHand(room, readySeats);
}

export async function applyRuntimeAction(roomId: string, user: AuthUser, action: { type: any; amount?: number }): Promise<void> {
  const room = getRuntimeRoom(roomId);
  if (!room.game) {
    throw new Error("当前没有进行中的牌局");
  }
  if (!room.seats.some((seat) => seat.userId === user.id)) {
    throw new Error("观战者不能执行游戏操作");
  }
  clearActionTimer(room.id);
  const prevPhase = room.game?.phase;
  try {
    room.game = applyAction(room.game, user.id, action);
    syncStacksFromGame(room);

    // Pause 1s when street advances so players can see the last action
    if (prevPhase && prevPhase !== room.game.phase && ["flop", "turn", "river"].includes(room.game.phase)) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (room.game.phase === "revealing") {
      scheduleRunoutReveal(room.id);
    } else if (!(await settleFinishedRoomIfNeeded(room)) && room.game) {
      reconcileActionClock(room.game, room.settings.actionTimeoutSeconds, new Date(), true);
    }
    await persistRoomSnapshot(room);
    scheduleActionTimer(room.id);
  } catch (error) {
    scheduleActionTimer(room.id);
    throw error;
  }
}

export async function chooseRuntimeRunout(roomId: string, user: AuthUser, mode: RunoutMode): Promise<void> {
  const room = getRuntimeRoom(roomId);
  if (!room.game) {
    throw new Error("当前没有需要选择发牌次数的牌局");
  }
  if (!room.seats.some((seat) => seat.userId === user.id)) {
    throw new Error("观战者不能选择发牌次数");
  }

  clearActionTimer(room.id);
  room.game = chooseRunout(room.game, user.id, mode);
  syncStacksFromGame(room);
  if (room.game.phase === "revealing") {
    scheduleRunoutReveal(room.id);
  } else {
    await settleFinishedRoomIfNeeded(room);
  }
  await persistRoomSnapshot(room);
  scheduleActionTimer(room.id);
}

export async function addAIPlayersToRoom(roomId: string, _actor: Pick<AuthUser, "id">): Promise<{ added: number }> {
  const room = getRuntimeRoom(roomId);
  if (room.status === "CLOSED") throw new Error("房间已关闭");

  // Find the next available seat
  const takenSeats = new Set(room.seats.map((s) => s.seatIndex));
  let seatIndex = 0;
  while (takenSeats.has(seatIndex) && seatIndex < room.settings.maxPlayers) {
    seatIndex++;
  }
  if (seatIndex >= room.settings.maxPlayers) throw new Error("没有空座位");

  // Count existing AI players for display name
  const existingAICount = room.seats.filter((s) => aiUserIds.has(s.userId)).length;
  const displayName = `AI-机器人${existingAICount + 1}`;
  const username = `ai_bot_${randomUUID().slice(0, 8)}`;
  const passwordHash = await import("node:crypto").then((crypto) =>
    crypto.createHash("sha256").update(randomUUID()).digest("hex"),
  );

  const aiUser = await prisma.user.create({
    data: {
      username,
      displayName,
      passwordHash,
      role: "USER",
      virtualChips: 1_000_000,
      isAI: true,
      stats: { create: {} },
    },
  });

  aiUserIds.add(aiUser.id);

  const authUser: AuthUser = {
    id: aiUser.id,
    username: aiUser.username,
    displayName: aiUser.displayName,
    role: aiUser.role as "USER" | "ADMIN",
    virtualChips: aiUser.virtualChips,
    isBanned: false,
  };

  // Use standard sitDown + setReady flow (same as human player)
  await sitDown(roomId, authUser, seatIndex, room.settings.maxBuyIn);
  await setReady(roomId, authUser, true);

  if (realtimeServer) {
    await emitRoomState(realtimeServer, roomId);
    await emitAllRoomLists(realtimeServer);
  }

  return { added: 1 };
}

export async function removeAIPlayersFromRoom(roomId: string, _actor: Pick<AuthUser, "id">): Promise<{ removed: number }> {
  const room = getRuntimeRoom(roomId);

  const aiSeats = room.seats.filter((s) => aiUserIds.has(s.userId));
  if (aiSeats.length === 0) return { removed: 0 };

  for (const seat of aiSeats) {
    aiUserIds.delete(seat.userId);

    const authUser: AuthUser = {
      id: seat.userId,
      username: "",
      displayName: seat.displayName,
      role: "USER",
      virtualChips: 0,
      isBanned: false,
    };

    // Use standard standUp flow (same as human player), force during active hand
    await standUp(roomId, authUser, true);
  }

  if (realtimeServer) {
    await emitRoomState(realtimeServer, roomId);
    await emitAllRoomLists(realtimeServer);
  }

  return { removed: aiSeats.length };
}

export function rabbitHuntRoom(roomId: string, user: AuthUser): { cards: Card[] } {
  const room = getRuntimeRoom(roomId);
  if (!room.game) throw new Error("当前没有牌局");
  if (room.game.phase !== "finished") throw new Error("只能在牌局结束后使用");
  if (!room.settings.rabbitHunting) throw new Error("该房间未开启 Rabbit Hunting");
  if (room.game.communityCards.length >= 5) throw new Error("河牌已发出，没有更多公共牌");

  const cards = rabbitHunt(room.game);
  return { cards };
}

export async function closeRuntimeRoom(
  roomId: string,
  actor: Pick<AuthUser, "id">,
  options: CloseRoomOptions = {},
): Promise<void> {
  const room = getRuntimeRoom(roomId);
  if (room.status === "CLOSED") {
    return;
  }
  clearRunoutTimer(room.id);
  if (room.game?.phase === "finished") {
    await settleFinishedRoomIfNeeded(room);
    await persistRoomSnapshot(room);
  }

  const closedAt = new Date();
  const refunds = [...room.seats]
    .map((seat) => ({ seat, amount: getReturnableChipsForSeat(room, seat) }))
    .filter((refund) => refund.amount > 0);
  const ledgerReason = options.ledgerReason ?? "ROOM_CLOSED_RETURN";

  await prisma.$transaction([
    ...refunds.flatMap((refund) => [
      prisma.user.update({
        where: { id: refund.seat.userId },
        data: { virtualChips: { increment: refund.amount } },
      }),
      prisma.virtualChipLedger.create({
        data: { userId: refund.seat.userId, delta: refund.amount, reason: ledgerReason, roomId },
      }),
    ]),
    prisma.roomSeat.updateMany({
      where: { roomId, status: "OCCUPIED" },
      data: { status: "STANDING", tableChips: 0, ready: false, leftAt: closedAt },
    }),
    prisma.room.update({
      where: { id: roomId },
      data: { status: "CLOSED", closedAt, gameSnapshot: room.game as any },
    }),
    prisma.adminAuditLog.create({
      data: {
        actorId: actor.id,
        action: options.auditAction ?? "ROOM_CLOSE",
        targetType: "Room",
        targetId: roomId,
        metadata: {
          name: room.name,
          refundTotal: refunds.reduce((sum, refund) => sum + refund.amount, 0),
          ...options.metadata,
        },
      },
    }),
  ]);

  room.status = "CLOSED";
  clearOfflineCloseTimer(room.id);
  clearActionTimer(room.id);
  clearRunoutTimer(room.id);
  clearHandPauseTimer(room.id);
  room.seats = [];
  room.spectators.clear();
}

export async function sendChatMessage(roomId: string, user: AuthUser, message: string): Promise<ChatMessageDto> {
  getRuntimeRoom(roomId);
  const created = await prisma.chatMessage.create({
    data: { roomId, userId: user.id, message },
    include: { user: true },
  });
  return {
    id: created.id,
    roomId,
    userId: user.id,
    displayName: created.user.displayName,
    message: created.message,
    createdAt: created.createdAt.toISOString(),
  };
}

export async function emitAllRoomLists(io: Server): Promise<void> {
  io.emit("room:list", listRooms());
}

export async function emitRoomState(io: Server, roomId: string): Promise<void> {
  const room = getRuntimeRoom(roomId);
  const sockets = await io.in(roomId).fetchSockets();
  for (const socket of sockets) {
    const user = socketUsers.get(socket.id);
    const publicGame = room.game ? getPublicGameStateForUser(room.game, user?.id) : undefined;
    // Win-by-fold: hide winner cards from everyone (owner keeps them for click-to-reveal)
    if (publicGame && room.game?.phase === "finished") {
      const showdownEvals = room.game.showdownEvaluations;
      const noShowdown = !showdownEvals || Object.keys(showdownEvals).length === 0;
      if (noShowdown) {
        for (const p of publicGame.players) {
          if (p.status !== "folded" && p.holeCards && p.userId !== user?.id && !room.revealedPlayerIds.has(p.userId)) {
            (p as any).holeCards = undefined;
          }
        }
      }
    }
    // Inject hole cards for revealed players so all clients can see them
    if (publicGame && room.revealedPlayerIds.size > 0) {
      for (const p of publicGame.players) {
        if (room.revealedPlayerIds.has(p.userId) && !p.holeCards) {
          const enginePlayer = room.game!.players.find((ep) => ep.userId === p.userId);
          if (enginePlayer) (p as any).holeCards = enginePlayer.holeCards.map((c) => ({ ...c }));
        }
      }
    }
    socket.emit("room:state", {
      id: room.id,
      name: room.name,
      status: room.status,
      settings: room.settings,
      seats: room.seats,
      spectatorCount: room.spectators.size,
      nextHandReadyAt: room.nextHandReadyAt,
      game: publicGame,
    });
    if (publicGame) {
      socket.emit("game:state", publicGame);
    }
  }
}

function scheduleAllActionTimers(): void {
  for (const room of rooms.values()) {
    scheduleActionTimer(room.id);
  }
}

function scheduleAllRunoutTimers(): void {
  for (const room of rooms.values()) {
    scheduleRunoutReveal(room.id);
    scheduleHandPauseTimer(room.id);
  }
}

function clearRunoutTimer(roomId: string): void {
  const existing = runoutTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
    runoutTimers.delete(roomId);
  }
}

function scheduleRunoutReveal(roomId: string): void {
  clearRunoutTimer(roomId);
  const room = rooms.get(roomId);
  if (!room?.game || room.game.phase !== "revealing") {
    return;
  }

  const timer = setTimeout(() => {
    void handleRunoutReveal(roomId);
  }, RUNOUT_REVEAL_DELAY_MS);
  runoutTimers.set(roomId, timer);
}

async function handleRunoutReveal(roomId: string): Promise<void> {
  const room = rooms.get(roomId);
  if (!room?.game || room.game.phase !== "revealing") {
    clearRunoutTimer(roomId);
    return;
  }

  try {
    room.game = advanceRunoutReveal(room.game);
    syncStacksFromGame(room);
    if (room.game.phase === "finished") {
      await settleFinishedRoomIfNeeded(room);
    }
    await persistRoomSnapshot(room);

    if (realtimeServer) {
      await emitRoomState(realtimeServer, room.id);
      await emitAllRoomLists(realtimeServer);
    }

    if (room.game?.phase === "revealing") {
      scheduleRunoutReveal(room.id);
    } else {
      clearRunoutTimer(room.id);
    }
  } catch (error) {
    console.error("Failed to advance runout reveal", error);
    scheduleRunoutReveal(roomId);
  }
}

function clearHandPauseTimer(roomId: string): void {
  const existing = handPauseTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
    handPauseTimers.delete(roomId);
  }
}

function scheduleHandPauseTimer(roomId: string): void {
  clearHandPauseTimer(roomId);
  const room = rooms.get(roomId);
  if (!room?.nextHandReadyAt) {
    return;
  }
  const delayMs = Math.max(0, Date.parse(room.nextHandReadyAt) - Date.now());
  const timer = setTimeout(() => {
    void handleHandPauseElapsed(roomId);
  }, delayMs + 25);
  handPauseTimers.set(roomId, timer);
}

async function handleHandPauseElapsed(roomId: string): Promise<void> {
  handPauseTimers.delete(roomId);
  const latest = rooms.get(roomId);
  if (!latest || latest.status === "CLOSED") {
    return;
  }
  if (!latest.nextHandReadyAt || Date.parse(latest.nextHandReadyAt) > Date.now()) {
    return;
  }

  latest.nextHandReadyAt = undefined;
  const removedBustedSeats = await standUpBustedSeats(latest);
  const nextHandSeats = latest.seats.filter((seat) => seat.tableChips > 0);
  if (nextHandSeats.length >= latest.settings.minPlayersToStart) {
    await beginRuntimeHand(latest, nextHandSeats);
    if (realtimeServer) {
      await emitRoomState(realtimeServer, roomId);
      await emitAllRoomLists(realtimeServer);
    }
    return;
  }

  await persistRoomSnapshot(latest);
  if (realtimeServer) {
    await emitRoomState(realtimeServer, roomId);
    if (removedBustedSeats) {
      await emitAllRoomLists(realtimeServer);
    }
  }
}

function clearOfflineCloseTimer(roomId: string): void {
  const existing = offlineCloseTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
    offlineCloseTimers.delete(roomId);
  }
}

function scheduleOfflineCloseIfNeeded(roomId: string): void {
  clearOfflineCloseTimer(roomId);
  const room = rooms.get(roomId);
  if (!room || room.status === "CLOSED" || room.seats.length === 0 || room.seats.some((seat) => seat.connected)) {
    return;
  }

  const timer = setTimeout(() => {
    void autoCloseRoomIfAllPlayersOffline(roomId);
  }, config.offlineRoomCloseGraceSeconds * 1000);
  offlineCloseTimers.set(roomId, timer);
}

function clearAIOnlyTimer(roomId: string): void {
  const existing = aiOnlyTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
    aiOnlyTimers.delete(roomId);
  }
}

function scheduleAIOnlyStandUp(roomId: string): void {
  clearAIOnlyTimer(roomId);
  const room = rooms.get(roomId);
  if (!room || room.status === "CLOSED") return;

  const seats = room.seats;
  if (seats.length === 0) return;

  // Check if any human player is connected
  const hasHumanConnected = seats.some((s) => !aiUserIds.has(s.userId) && s.connected);
  if (hasHumanConnected) return;

  // Check there's at least one AI connected
  const hasAIConnected = seats.some((s) => aiUserIds.has(s.userId) && s.connected);
  if (!hasAIConnected) return;

  const timer = setTimeout(() => {
    void standUpAIOnlyPlayers(roomId);
  }, AI_ONLY_STAND_UP_SECONDS * 1000);
  aiOnlyTimers.set(roomId, timer);
}

async function standUpAIOnlyPlayers(roomId: string): Promise<void> {
  const room = rooms.get(roomId);
  if (!room || room.status === "CLOSED") return;

  // Re-check: still no human connected?
  const hasHumanConnected = room.seats.some((s) => !aiUserIds.has(s.userId) && s.connected);
  if (hasHumanConnected) return;

  const aiSeats = room.seats.filter((s) => aiUserIds.has(s.userId));
  for (const seat of aiSeats) {
    try {
      await standUp(roomId, { id: seat.userId, username: "", displayName: seat.displayName, role: "USER", virtualChips: 0, isBanned: false }, true);
    } catch {
      // Ignore errors for individual stand-up
    }
  }

  if (realtimeServer) {
    realtimeServer.to(room.id).emit("notification", {
      level: "warning",
      message: "所有真人玩家已离线超过 3 分钟，AI 玩家已自动离座。",
    });
    await emitRoomState(realtimeServer, room.id);
    await emitAllRoomLists(realtimeServer);
  }
}

async function autoCloseRoomIfAllPlayersOffline(roomId: string): Promise<void> {
  const room = rooms.get(roomId);
  if (!room || room.status === "CLOSED" || room.seats.length === 0 || room.seats.some((seat) => seat.connected)) {
    return;
  }
  // Never auto-close a room with an active (non-finished) game
  if (room.game && room.game.phase !== "finished") {
    scheduleOfflineCloseIfNeeded(roomId);
    return;
  }

  try {
    await closeRuntimeRoom(roomId, { id: room.createdById }, {
      auditAction: "ROOM_AUTO_CLOSE_ALL_OFFLINE",
      ledgerReason: "ROOM_AUTO_CLOSED_RETURN",
      metadata: {
        reason: "ALL_SEATED_PLAYERS_OFFLINE",
        graceSeconds: config.offlineRoomCloseGraceSeconds,
      },
    });

    if (realtimeServer) {
      realtimeServer.to(room.id).emit("notification", {
        level: "warning",
        message: "房间内已无在线玩家，系统已自动关闭该房间。",
      });
      await emitRoomState(realtimeServer, room.id);
      await emitAllRoomLists(realtimeServer);
    }
  } catch (error) {
    console.error("Failed to auto-close offline room", error);
  }
}

function clearActionTimer(roomId: string): void {
  const existing = actionTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
    actionTimers.delete(roomId);
  }
}

function scheduleActionTimer(roomId: string): void {
  clearActionTimer(roomId);
  const room = rooms.get(roomId);
  const clock = room?.game?.actionClock;
  if (!room?.game?.currentTurnUserId || !clock || room.game.phase === "finished") {
    return;
  }

  const isAI = aiUserIds.has(room.game.currentTurnUserId);
  const thinkMs = isAI ? config.aiThinkSeconds * 1000 : Math.max(0, Date.parse(clock.deadlineAt) - Date.now());

  const timer = setTimeout(() => {
    if (isAI) {
      void handleAIAction(roomId, clock.userId);
    } else {
      void handleActionTimeout(roomId, clock.userId, clock.deadlineAt);
    }
  }, thinkMs + 25);
  actionTimers.set(roomId, timer);
}

async function handleAIAction(roomId: string, userId: string): Promise<void> {
  const room = rooms.get(roomId);
  if (!room?.game || room.game.currentTurnUserId !== userId) return;

  const decision: AIDecision = await getAIDecision(room.game, userId);

  const action = { type: decision.action, amount: decision.amount };

  room.game.actionLog.push({
    userId,
    action: `ai-${action.type}${action.amount ? ` ${action.amount}` : ""}`,
    phase: room.game.phase,
    createdAt: new Date().toISOString(),
  });

  const prevPhase = room.game.phase;
  try {
    room.game = applyAction(room.game, userId, action);
    syncStacksFromGame(room);

    if (prevPhase !== room.game.phase && ["flop", "turn", "river"].includes(room.game.phase)) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (room.game.phase === "revealing") {
      scheduleRunoutReveal(room.id);
    } else if (!(await settleFinishedRoomIfNeeded(room)) && room.game) {
      reconcileActionClock(room.game, room.settings.actionTimeoutSeconds, new Date(), true);
    }
    await persistRoomSnapshot(room);
    scheduleActionTimer(room.id);

    if (realtimeServer) {
      await emitRoomState(realtimeServer, roomId);
    }
  } catch (error) {
    console.error("[AI] Action failed:", error);
    scheduleActionTimer(room.id);
  }
}

async function handleActionTimeout(roomId: string, userId: string, deadlineAt: string): Promise<void> {
  const room = rooms.get(roomId);
  if (!room?.game || room.game.currentTurnUserId !== userId) {
    return;
  }
  if (room.game.actionClock?.deadlineAt !== deadlineAt || Date.parse(deadlineAt) > Date.now()) {
    scheduleActionTimer(roomId);
    return;
  }

  const action = getAutomaticTimeoutAction(room.game);
  if (!action) {
    if (reconcileActionClock(room.game, room.settings.actionTimeoutSeconds, new Date(), true)) {
      await persistRoomSnapshot(room);
    }
    scheduleActionTimer(roomId);
    return;
  }

  room.game.actionLog.push({
    userId,
    action: action.type === "check" ? "timeout-auto-check" : "timeout-auto-fold",
    phase: room.game.phase,
    createdAt: new Date().toISOString(),
  });

  try {
    room.game = applyAction(room.game, userId, action);
    syncStacksFromGame(room);
    if (room.game.phase === "revealing") {
      scheduleRunoutReveal(room.id);
    } else if (!(await settleFinishedRoomIfNeeded(room)) && room.game) {
      reconcileActionClock(room.game, room.settings.actionTimeoutSeconds, new Date(), true);
    }
    await persistRoomSnapshot(room);
    scheduleActionTimer(room.id);

    if (realtimeServer) {
      realtimeServer.to(room.id).emit("notification", {
        level: "warning",
        message: action.type === "check" ? "玩家行动超时，系统已自动过牌。" : "玩家行动超时，系统已自动弃牌。",
      });
      await emitRoomState(realtimeServer, room.id);
      await emitAllRoomLists(realtimeServer);
    }
  } catch (error) {
    console.error("Failed to apply timeout action", error);
    if (room.game && reconcileActionClock(room.game, room.settings.actionTimeoutSeconds, new Date(), true)) {
      await persistRoomSnapshot(room);
      scheduleActionTimer(room.id);
    }
  }
}

const BOMB_POT_INTERVAL = 5;
const BOMB_POT_ANTE_MULTIPLIER = 3;
const SEVEN_TWO_BOUNTY_MULTIPLIER = 1;
const THREE_PEAT_BOUNTY = 100;

async function beginRuntimeHand(room: RuntimeRoom, seats: RuntimeSeat[]): Promise<void> {
  room.revealedPlayerIds.clear();
  for (const seat of seats) {
    seat.ready = true;
    if (seat.pendingChips !== 0) {
      seat.tableChips = Math.max(0, seat.tableChips + seat.pendingChips);
      seat.pendingChips = 0;
    }
  }
  room.handCounter += 1;

  const isBombPotHand =
    room.settings.miniGames?.bombPot && room.handCounter % BOMB_POT_INTERVAL === 0;
  const bombPotAmount = isBombPotHand ? room.settings.bigBlind * BOMB_POT_ANTE_MULTIPLIER : undefined;
  const useStraddle = room.settings.miniGames?.straddle ?? false;

  room.game = startHand({
    handId: randomUUID(),
    players: seats.map((seat) => ({
      userId: seat.userId,
      displayName: seat.displayName,
      seatIndex: seat.seatIndex,
      stack: seat.tableChips,
      ready: true,
    })),
    smallBlind: room.settings.smallBlind,
    bigBlind: room.settings.bigBlind,
    ante: room.settings.ante,
    previousButtonSeatIndex: room.game?.buttonSeatIndex,
    handNumber: room.handCounter,
    deckType: (room.settings.deckType ?? "standard") as DeckType,
    bombPotAmount,
    straddle: useStraddle,
  });
  reconcileActionClock(room.game, room.settings.actionTimeoutSeconds, new Date(), true);
  room.status = "PLAYING";
  room.nextHandReadyAt = undefined;
  clearHandPauseTimer(room.id);
  syncStacksFromGame(room);
  await persistRoomSnapshot(room);
  scheduleActionTimer(room.id);
}

function assertCanAdjustSeatChips(room: RuntimeRoom): void {
  if (room.status === "CLOSED") {
    throw new Error("房间已关闭");
  }
  if (room.game && room.game.phase !== "finished") {
    throw new Error("一手牌进行中不能补码或扣码");
  }
}

function syncStacksFromGame(room: RuntimeRoom): void {
  if (!room.game) {
    return;
  }
  for (const player of room.game.players) {
    const seat = room.seats.find((item) => item.userId === player.userId);
    if (seat) {
      seat.tableChips = player.stack;
    }
  }
}

function getReturnableChipsForSeat(room: RuntimeRoom, seat: RuntimeSeat): number {
  if (!room.game || room.game.phase === "finished") {
    return seat.tableChips;
  }
  const player = room.game.players.find((item) => item.userId === seat.userId);
  return player ? player.stack + player.totalCommitted : seat.tableChips;
}

async function persistRoomSnapshot(room: RuntimeRoom): Promise<void> {
  await prisma.room.update({
    where: { id: room.id },
    data: {
      status: room.status,
      gameSnapshot: room.game as any,
      seats: {
        updateMany: room.seats.map((seat) => ({
          where: { userId: seat.userId },
          data: { tableChips: seat.tableChips, ready: seat.ready },
        })),
      },
    },
  });
}

async function persistFinishedHand(room: RuntimeRoom): Promise<void> {
  if (!room.game) return;

  const existing = await prisma.userHandHistory.findFirst({ where: { handId: room.game.handId } });
  if (existing) return;

  const potTotal = room.game.sidePots.reduce((sum, pot) => sum + pot.amount, 0);
  const playerActions = room.game.actionLog.filter(
    (e) => e.userId && ["fold", "check", "call", "bet", "raise", "all-in"].includes(e.action),
  );

  const opponentMap = new Map(
    room.game.players.map((p) => [
      p.userId,
      { userId: p.userId, displayName: p.displayName, seatIndex: p.seatIndex },
    ]),
  );

  for (const player of room.game.players) {
    const won = room.game.awards.some((a) => a.winnerIds.includes(player.userId));
    const showdown = Object.prototype.hasOwnProperty.call(room.game.showdownEvaluations, player.userId);
    const wonAmount = Math.max(0, player.stack - player.startingStack + player.totalCommitted);
    const net = player.stack - player.startingStack;
    const bestHand = showdown ? room.game.showdownEvaluations[player.userId]?.label ?? null : null;

    const opponents = room.game.players
      .filter((p) => p.userId !== player.userId)
      .map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        seatIndex: p.seatIndex,
        holeCards: showdown ? (p.holeCards as any) : undefined,
        wonAmount: Math.max(0, p.stack - p.startingStack + p.totalCommitted),
      }));

    await prisma.userHandHistory.create({
      data: {
        handId: room.game.handId,
        roomId: room.id,
        roomName: room.name,
        userId: player.userId,
        handNumber: room.game.handNumber,
        playerCount: room.game.players.length,
        buttonSeatIndex: room.game.buttonSeatIndex,
        deckType: room.game.deckType,
        smallBlind: room.settings.smallBlind,
        bigBlind: room.settings.bigBlind,
        ante: room.settings.ante,
        seatIndex: player.seatIndex,
        holeCards: player.holeCards as any,
        communityCards: room.game.communityCards as any,
        startingStack: player.startingStack,
        endingStack: player.stack,
        netResult: net,
        totalCommitted: player.totalCommitted,
        folded: player.status === "folded",
        wonAmount,
        bestHand: bestHand as any,
        potTotal,
        result: won ? (room.game!.awards.length > 1 || room.game!.awards[0]!.winnerIds.length > 1 ? "split" : "win") : player.status === "folded" ? "fold" : "lose",
        actions: playerActions as any,
        opponents: opponents as any,
        startedAt: room.game.actionLog[0]?.createdAt ? new Date(room.game.actionLog[0].createdAt) : new Date(),
        endedAt: new Date(),
      },
    });

    const existingStats = await prisma.userStats.findUnique({ where: { userId: player.userId } });
    const biggestPotWon = won ? Math.max(existingStats?.biggestPotWon ?? 0, potTotal) : existingStats?.biggestPotWon ?? 0;
    await prisma.userStats.upsert({
      where: { userId: player.userId },
      update: {
        totalHands: { increment: 1 },
        handsWon: { increment: won ? 1 : 0 },
        voluntarilyPutInPot: { increment: player.totalCommitted > forcedCommitmentForSeat(room, player.seatIndex) ? 1 : 0 },
        showdownCount: { increment: showdown ? 1 : 0 },
        showdownWins: { increment: won && showdown ? 1 : 0 },
        biggestPotWon: { set: biggestPotWon },
        netVirtualChips: { increment: net },
      },
      create: {
        userId: player.userId,
        totalHands: 1,
        handsWon: won ? 1 : 0,
        voluntarilyPutInPot: player.totalCommitted > forcedCommitmentForSeat(room, player.seatIndex) ? 1 : 0,
        showdownCount: showdown ? 1 : 0,
        showdownWins: won && showdown ? 1 : 0,
        biggestPotWon: won ? potTotal : 0,
        netVirtualChips: net,
      },
    });
  }
}

async function settleFinishedRoomIfNeeded(room: RuntimeRoom): Promise<boolean> {
  if (!room.game || room.game.phase !== "finished") {
    return false;
  }

  clearActionTimer(room.id);
  delete room.game.actionClock;
  syncStacksFromGame(room);
  await persistFinishedHand(room);

  // --- Mini-game settlements ---
  const miniGames = room.settings.miniGames ?? {};
  const winners = findHandWinners(room.game);

  for (const winner of winners) {
    // 7-2 Game: winner with 7-2 offsuit gets bounty from each seated player
    if (miniGames.sevenTwo && hasSevenTwoOffsuit(winner.holeCards)) {
      const bounty = room.settings.bigBlind * SEVEN_TWO_BOUNTY_MULTIPLIER;
      await distributeBounty(room, winner.userId, bounty, "7-2 游戏赏金");
    }

    // Three-peat: track and reward consecutive wins
    if (miniGames.threePeat) {
      const streak = (room.threePeatWinStreak.get(winner.userId) ?? 0) + 1;
      room.threePeatWinStreak.set(winner.userId, streak);
      if (streak >= 3) {
        await distributeBounty(room, winner.userId, THREE_PEAT_BOUNTY, "三连冠赏金");
        room.threePeatWinStreak.set(winner.userId, 0);
      }
    }
  }

  // Reset three-peat streaks for non-winners
  if (miniGames.threePeat) {
    for (const player of room.game.players) {
      if (!winners.some((w) => w.userId === player.userId)) {
        room.threePeatWinStreak.set(player.userId, 0);
      }
    }
  }

  // Show One: log a marker so client knows winner should reveal
  if (miniGames.showOne && winners.length > 0) {
    logMiniGame(room, "show-one-required", winners.map((w) => w.userId));
  }

  for (const seat of room.seats) {
    seat.ready = false;
  }
  room.status = "WAITING";
  if (!room.nextHandReadyAt) {
    room.nextHandReadyAt = new Date(Date.now() + HAND_RESULT_HOLD_MS).toISOString();
  }
  scheduleHandPauseTimer(room.id);
  return true;
}

async function standUpBustedSeats(room: RuntimeRoom): Promise<boolean> {
  const bustedSeats = room.seats.filter((seat) => seat.tableChips + seat.pendingChips <= 0);
  if (bustedSeats.length === 0) {
    return false;
  }

  await prisma.roomSeat.updateMany({
    where: {
      roomId: room.id,
      userId: { in: bustedSeats.map((seat) => seat.userId) },
      status: "OCCUPIED",
    },
    data: {
      status: "STANDING",
      tableChips: 0,
      ready: false,
      leftAt: new Date(),
    },
  });

  room.seats = room.seats.filter((seat) => seat.tableChips > 0);
  return true;
}

export const __testing = {
  handleHandPauseElapsed,
  standUpBustedSeats,
};

function forcedCommitmentForSeat(room: RuntimeRoom, seatIndex: number): number {
  let forced = room.settings.ante;
  if (room.game?.smallBlindSeatIndex === seatIndex) {
    forced += room.settings.smallBlind;
  }
  if (room.game?.bigBlindSeatIndex === seatIndex) {
    forced += room.settings.bigBlind;
  }
  return forced;
}

/** Find players who won chips this hand */
function findHandWinners(game: PokerGameState): Array<{ userId: string; holeCards: Card[] }> {
  const winnerIds = new Set(
    game.awards.flatMap((award) => award.winnerIds),
  );
  return game.players
    .filter((player) => winnerIds.has(player.userId) && player.holeCards.length === 2)
    .map((player) => ({ userId: player.userId, holeCards: player.holeCards }));
}

/** Check if hole cards are 7 and 2 of different suits */
function hasSevenTwoOffsuit(holeCards: Card[]): boolean {
  if (holeCards.length !== 2) return false;
  const [a, b] = holeCards;
  if (!a || !b) return false;
  const ranks = new Set([a.rank, b.rank]);
  return ranks.has("7") && ranks.has("2") && a.suit !== b.suit;
}

/** Distribute bounty: deduct from all seated players, give to target */
async function distributeBounty(
  room: RuntimeRoom,
  recipientId: string,
  amount: number,
  reason: string,
): Promise<void> {
  const recipientSeat = room.seats.find((seat) => seat.userId === recipientId);
  if (!recipientSeat) return;

  let totalCollected = 0;
  const deductions: Array<{ userId: string; delta: number }> = [];

  for (const seat of room.seats) {
    if (seat.userId === recipientId) continue;
    const pay = Math.min(amount, seat.tableChips);
    if (pay <= 0) continue;
    seat.tableChips -= pay;
    totalCollected += pay;
    deductions.push({ userId: seat.userId, delta: -pay });
  }

  if (totalCollected === 0) return;

  recipientSeat.tableChips += totalCollected;

  await prisma.virtualChipLedger.createMany({
    data: [
      ...deductions.map((d) => ({
        userId: d.userId,
        delta: d.delta,
        reason,
        roomId: room.id,
      })),
      {
        userId: recipientId,
        delta: totalCollected,
        reason,
        roomId: room.id,
      },
    ],
  });
}

/** Log a mini-game event in the game's action log */
function logMiniGame(
  room: RuntimeRoom,
  action: string,
  userIds: string[],
): void {
  if (!room.game) return;
  room.game.actionLog.push({
    userId: userIds[0],
    action,
    phase: room.game.phase,
    createdAt: new Date().toISOString(),
  });
}

