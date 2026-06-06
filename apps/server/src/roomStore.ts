import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import {
  applyAction,
  getPublicGameStateForUser,
  startHand,
  type PokerGameState,
} from "@friends-poker/poker-engine";
import type { AuthUser, ChatMessageDto, RoomSettingsDto, RoomStatus, RoomSummaryDto } from "@friends-poker/shared";
import { prisma } from "./prisma";

export interface RuntimeSeat {
  userId: string;
  displayName: string;
  seatIndex: number;
  tableChips: number;
  ready: boolean;
  connected: boolean;
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

export function rememberSocket(socket: Socket, user: AuthUser): void {
  socketUsers.set(socket.id, user);
}

export function forgetSocket(socket: Socket): void {
  const user = socketUsers.get(socket.id);
  socketUsers.delete(socket.id);
  if (!user) {
    return;
  }
  for (const room of rooms.values()) {
    const seat = room.seats.find((item) => item.userId === user.id);
    if (seat) {
      seat.connected = false;
    }
  }
}

export async function hydrateRoomsFromDatabase(): Promise<void> {
  const persistedRooms = await prisma.room.findMany({
    where: { status: { in: ["WAITING", "PLAYING"] } },
    include: { seats: { where: { status: "OCCUPIED" }, include: { user: true } } },
  });

  for (const persisted of persistedRooms) {
    rooms.set(persisted.id, {
      id: persisted.id,
      name: persisted.name,
      status: persisted.status,
      createdById: persisted.createdById,
      createdAt: persisted.createdAt.toISOString(),
      settings: {
        name: persisted.name,
        maxPlayers: persisted.maxPlayers,
        smallBlind: persisted.smallBlind,
        bigBlind: persisted.bigBlind,
        minBuyIn: persisted.minBuyIn,
        maxBuyIn: persisted.maxBuyIn,
        allowSpectators: persisted.allowSpectators,
      },
      seats: persisted.seats.map((seat: PersistedSeat) => ({
        userId: seat.userId,
        displayName: seat.user.displayName,
        seatIndex: seat.seatIndex,
        tableChips: seat.tableChips,
        ready: seat.ready,
        connected: false,
      })),
      spectators: new Map(),
      game: persisted.gameSnapshot as unknown as PokerGameState | undefined,
      handCounter: Number((persisted.gameSnapshot as any)?.handNumber ?? 0),
    });
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
      smallBlind: room.settings.smallBlind,
      bigBlind: room.settings.bigBlind,
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

export async function createRuntimeRoom(user: AuthUser, input: RoomSettingsDto): Promise<RuntimeRoom> {
  if (input.bigBlind < input.smallBlind * 2) {
    throw new Error("大盲至少应为小盲的 2 倍");
  }
  if (input.maxBuyIn < input.minBuyIn) {
    throw new Error("最大买入不能小于最小买入");
  }

  const dbRoom = await prisma.room.create({
    data: {
      name: input.name,
      maxPlayers: input.maxPlayers,
      smallBlind: input.smallBlind,
      bigBlind: input.bigBlind,
      minBuyIn: input.minBuyIn,
      maxBuyIn: input.maxBuyIn,
      allowSpectators: input.allowSpectators,
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
  };
  rooms.set(room.id, room);
  return room;
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
  });
  room.seats.sort((a, b) => a.seatIndex - b.seatIndex);
}

export async function standUp(roomId: string, user: AuthUser): Promise<void> {
  const room = getRuntimeRoom(roomId);
  if (room.game && room.game.phase !== "finished") {
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

export async function setReady(roomId: string, user: AuthUser, ready: boolean): Promise<void> {
  const room = getRuntimeRoom(roomId);
  const seat = room.seats.find((item) => item.userId === user.id);
  if (!seat) {
    throw new Error("只有已坐下玩家可以准备");
  }
  if (seat.tableChips <= 0) {
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
  }
}

export async function startRuntimeHand(roomId: string, user: AuthUser): Promise<void> {
  const room = getRuntimeRoom(roomId);
  if (!room.seats.some((seat) => seat.userId === user.id)) {
    throw new Error("只有牌桌玩家可以开始牌局");
  }
  if (room.game && room.game.phase !== "finished") {
    throw new Error("当前已有牌局进行中");
  }
  const readySeats = room.seats.filter((seat) => seat.ready && seat.tableChips > 0);
  if (readySeats.length < 2) {
    throw new Error("至少需要 2 名已准备玩家");
  }
  room.handCounter += 1;
  room.game = startHand({
    handId: randomUUID(),
    players: readySeats.map((seat) => ({
      userId: seat.userId,
      displayName: seat.displayName,
      seatIndex: seat.seatIndex,
      stack: seat.tableChips,
      ready: seat.ready,
    })),
    smallBlind: room.settings.smallBlind,
    bigBlind: room.settings.bigBlind,
    previousButtonSeatIndex: room.game?.buttonSeatIndex,
    handNumber: room.handCounter,
  });
  room.status = "PLAYING";
  syncStacksFromGame(room);
  await persistRoomSnapshot(room);
}

export async function applyRuntimeAction(roomId: string, user: AuthUser, action: { type: any; amount?: number }): Promise<void> {
  const room = getRuntimeRoom(roomId);
  if (!room.game) {
    throw new Error("当前没有进行中的牌局");
  }
  if (!room.seats.some((seat) => seat.userId === user.id)) {
    throw new Error("观战者不能执行游戏操作");
  }
  room.game = applyAction(room.game, user.id, action);
  syncStacksFromGame(room);
  if (room.game.phase === "finished") {
    await persistFinishedHand(room);
    for (const seat of room.seats) {
      seat.ready = false;
    }
    room.status = "WAITING";
  }
  await persistRoomSnapshot(room);
}

export async function closeRuntimeRoom(roomId: string, actor: AuthUser): Promise<void> {
  const room = getRuntimeRoom(roomId);
  for (const seat of [...room.seats]) {
    await prisma.user.update({
      where: { id: seat.userId },
      data: { virtualChips: { increment: seat.tableChips } },
    });
    await prisma.virtualChipLedger.create({
      data: { userId: seat.userId, delta: seat.tableChips, reason: "ROOM_CLOSED_RETURN", roomId },
    });
  }
  room.status = "CLOSED";
  room.seats = [];
  room.spectators.clear();
  await prisma.room.update({
    where: { id: roomId },
    data: { status: "CLOSED", closedAt: new Date(), gameSnapshot: room.game as any },
  });
  await prisma.adminAuditLog.create({
    data: {
      actorId: actor.id,
      action: "ROOM_CLOSE",
      targetType: "Room",
      targetId: roomId,
      metadata: { name: room.name },
    },
  });
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
    socket.emit("room:state", {
      id: room.id,
      name: room.name,
      status: room.status,
      settings: room.settings,
      seats: room.seats,
      spectatorCount: room.spectators.size,
      game: publicGame,
    });
    if (publicGame) {
      socket.emit("game:state", publicGame);
    }
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
  if (!room.game) {
    return;
  }
  const potTotal = room.game.sidePots.reduce((sum, pot) => sum + pot.amount, 0);
  const hand = await prisma.hand.create({
    data: {
      id: room.game.handId,
      roomId: room.id,
      handNumber: room.game.handNumber,
      buttonSeatIndex: room.game.buttonSeatIndex,
      smallBlind: room.settings.smallBlind,
      bigBlind: room.settings.bigBlind,
      board: room.game.communityCards as any,
      potTotal,
      result: {
        awards: room.game.awards,
        evaluations: room.game.showdownEvaluations,
      } as any,
      stateSnapshot: room.game as any,
      endedAt: new Date(),
      players: {
        create: room.game.players.map((player) => ({
          userId: player.userId,
          seatIndex: player.seatIndex,
          startingStack: player.startingStack,
          endingStack: player.stack,
          totalCommitted: player.totalCommitted,
          holeCards: player.holeCards as any,
          folded: player.status === "folded",
          wonAmount: Math.max(0, player.stack - player.startingStack + player.totalCommitted),
        })),
      },
      actions: {
        create: room.game.actionLog.map((entry) => ({
          roomId: room.id,
          userId: entry.userId,
          phase: mapPhase(entry.phase),
          action: entry.action,
          amount: entry.amount,
          metadata: entry as any,
        })),
      },
    },
  });

  for (const player of room.game.players) {
    const won = room.game.awards.some((award) => award.winnerIds.includes(player.userId));
    const showdown = Object.prototype.hasOwnProperty.call(room.game.showdownEvaluations, player.userId);
    const existingStats = await prisma.userStats.findUnique({ where: { userId: player.userId } });
    const net = player.stack - player.startingStack;
    const biggestPotWon = won ? Math.max(existingStats?.biggestPotWon ?? 0, potTotal) : existingStats?.biggestPotWon ?? 0;
    await prisma.userStats.upsert({
      where: { userId: player.userId },
      update: {
        totalHands: { increment: 1 },
        handsWon: { increment: won ? 1 : 0 },
        voluntarilyPutInPot: { increment: player.totalCommitted > room.settings.bigBlind ? 1 : 0 },
        showdownCount: { increment: showdown ? 1 : 0 },
        showdownWins: { increment: won && showdown ? 1 : 0 },
        biggestPotWon: { set: biggestPotWon },
        netVirtualChips: { increment: net },
      },
      create: {
        userId: player.userId,
        totalHands: 1,
        handsWon: won ? 1 : 0,
        voluntarilyPutInPot: player.totalCommitted > room.settings.bigBlind ? 1 : 0,
        showdownCount: showdown ? 1 : 0,
        showdownWins: won && showdown ? 1 : 0,
        biggestPotWon: won ? potTotal : 0,
        netVirtualChips: net,
      },
    });
  }

  await prisma.gameAction.create({
    data: {
      roomId: room.id,
      handId: hand.id,
      action: "HAND_FINISHED",
      amount: potTotal,
      metadata: { awards: room.game.awards } as any,
    },
  });
}

function mapPhase(phase: string): "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN" | "FINISHED" | undefined {
  const map: Record<string, "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN" | "FINISHED"> = {
    preflop: "PREFLOP",
    flop: "FLOP",
    turn: "TURN",
    river: "RIVER",
    showdown: "SHOWDOWN",
    finished: "FINISHED",
  };
  return map[phase];
}
