import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser, RoomSettingsDto } from "@friends-poker/shared";

const prismaMock = vi.hoisted(() => ({
  room: {
    create: vi.fn(),
    update: vi.fn(),
  },
  roomSeat: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  virtualChipLedger: {
    create: vi.fn(),
  },
  $transaction: vi.fn(async (operations: unknown[]) => operations),
}));

vi.mock("../src/prisma", () => ({
  prisma: prismaMock,
}));

import {
  __testing,
  addTableChips,
  createRuntimeRoom,
  removeTableChips,
  sitDown,
  startRuntimeHand,
  type RuntimeRoom,
} from "../src/roomStore";

const user: AuthUser = {
  id: "user-1",
  username: "user1",
  displayName: "玩家一",
  role: "USER",
  virtualChips: 5000,
  isBanned: false,
};

const secondUser: AuthUser = {
  id: "user-2",
  username: "user2",
  displayName: "玩家二",
  role: "USER",
  virtualChips: 5000,
  isBanned: false,
};

const settings: RoomSettingsDto = {
  name: "测试房间",
  maxPlayers: 9,
  minPlayersToStart: 2,
  smallBlind: 10,
  bigBlind: 20,
  ante: 0,
  minBuyIn: 200,
  maxBuyIn: 2000,
  actionTimeoutSeconds: 30,
  creatorOnlyStart: false,
  allowSpectators: true,
};

describe("room store seating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks zero-stack seats standing and removes them from runtime seating", async () => {
    const room: RuntimeRoom = {
      id: "room-busted",
      name: "测试房间",
      status: "WAITING",
      settings,
      createdById: "owner-1",
      createdAt: new Date("2026-06-07T00:00:00.000Z").toISOString(),
      seats: [
        { userId: "busted", displayName: "出局玩家", seatIndex: 0, tableChips: 0, ready: false, connected: true },
        { userId: "winner", displayName: "获胜玩家", seatIndex: 1, tableChips: 400, ready: false, connected: true },
      ],
      spectators: new Map(),
      handCounter: 1,
    };

    await expect(__testing.standUpBustedSeats(room)).resolves.toBe(true);

    expect(prismaMock.roomSeat.updateMany).toHaveBeenCalledWith({
      where: {
        roomId: "room-busted",
        userId: { in: ["busted"] },
        status: "OCCUPIED",
      },
      data: expect.objectContaining({
        status: "STANDING",
        tableChips: 0,
        ready: false,
      }),
    });
    expect(room.seats.map((seat) => seat.userId)).toEqual(["winner"]);
  });

  it("clears old standing seat rows before a player buys back into the room", async () => {
    prismaMock.room.create.mockResolvedValue({
      id: "room-rebuy",
      name: settings.name,
      status: "WAITING",
      maxPlayers: settings.maxPlayers,
      minPlayersToStart: settings.minPlayersToStart,
      smallBlind: settings.smallBlind,
      bigBlind: settings.bigBlind,
      ante: settings.ante,
      minBuyIn: settings.minBuyIn,
      maxBuyIn: settings.maxBuyIn,
      actionTimeoutSeconds: settings.actionTimeoutSeconds,
      creatorOnlyStart: settings.creatorOnlyStart,
      allowSpectators: settings.allowSpectators,
      createdById: user.id,
      createdAt: new Date("2026-06-07T00:00:00.000Z"),
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: user.id, virtualChips: 5000 });

    await createRuntimeRoom(user, settings);
    await sitDown("room-rebuy", user, 2, 1000);

    expect(prismaMock.roomSeat.deleteMany).toHaveBeenCalledWith({
      where: {
        roomId: "room-rebuy",
        status: "STANDING",
        OR: [{ userId: user.id }, { seatIndex: 2 }],
      },
    });
    expect(prismaMock.roomSeat.create).toHaveBeenCalledWith({
      data: {
        roomId: "room-rebuy",
        userId: user.id,
        seatIndex: 2,
        tableChips: 1000,
      },
    });
  });

  it("tops up a seated player without writing hand results or stats", async () => {
    prismaMock.room.create.mockResolvedValue({
      id: "room-top-up",
      name: settings.name,
      status: "WAITING",
      maxPlayers: settings.maxPlayers,
      minPlayersToStart: settings.minPlayersToStart,
      smallBlind: settings.smallBlind,
      bigBlind: settings.bigBlind,
      ante: settings.ante,
      minBuyIn: settings.minBuyIn,
      maxBuyIn: settings.maxBuyIn,
      actionTimeoutSeconds: settings.actionTimeoutSeconds,
      creatorOnlyStart: settings.creatorOnlyStart,
      allowSpectators: settings.allowSpectators,
      createdById: user.id,
      createdAt: new Date("2026-06-07T00:00:00.000Z"),
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: user.id, virtualChips: 5000 });

    const room = await createRuntimeRoom(user, settings);
    await sitDown("room-top-up", user, 2, 1000);
    await addTableChips("room-top-up", user, 300);

    expect(room.seats.find((seat) => seat.userId === user.id)?.tableChips).toBe(1300);
    expect(prismaMock.virtualChipLedger.create).toHaveBeenLastCalledWith({
      data: { userId: user.id, delta: -300, reason: "TABLE_TOP_UP", roomId: "room-top-up" },
    });
    expect(prismaMock.roomSeat.update).toHaveBeenLastCalledWith({
      where: { roomId_userId: { roomId: "room-top-up", userId: user.id } },
      data: { tableChips: { increment: 300 } },
    });
  });

  it("removes table chips without changing hand profit accounting", async () => {
    prismaMock.room.create.mockResolvedValue({
      id: "room-remove",
      name: settings.name,
      status: "WAITING",
      maxPlayers: settings.maxPlayers,
      minPlayersToStart: settings.minPlayersToStart,
      smallBlind: settings.smallBlind,
      bigBlind: settings.bigBlind,
      ante: settings.ante,
      minBuyIn: settings.minBuyIn,
      maxBuyIn: settings.maxBuyIn,
      actionTimeoutSeconds: settings.actionTimeoutSeconds,
      creatorOnlyStart: settings.creatorOnlyStart,
      allowSpectators: settings.allowSpectators,
      createdById: user.id,
      createdAt: new Date("2026-06-07T00:00:00.000Z"),
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: user.id, virtualChips: 5000 });

    const room = await createRuntimeRoom(user, settings);
    await sitDown("room-remove", user, 2, 1000);
    await removeTableChips("room-remove", user, 250);

    expect(room.seats.find((seat) => seat.userId === user.id)?.tableChips).toBe(750);
    expect(prismaMock.virtualChipLedger.create).toHaveBeenLastCalledWith({
      data: { userId: user.id, delta: 250, reason: "TABLE_WITHDRAW", roomId: "room-remove" },
    });
    expect(prismaMock.roomSeat.update).toHaveBeenLastCalledWith({
      where: { roomId_userId: { roomId: "room-remove", userId: user.id } },
      data: { tableChips: { decrement: 250 } },
    });
  });

  it("automatically starts the next hand when the hand pause elapses", async () => {
    prismaMock.room.create.mockResolvedValue({
      id: "room-auto-next",
      name: settings.name,
      status: "WAITING",
      maxPlayers: settings.maxPlayers,
      minPlayersToStart: settings.minPlayersToStart,
      smallBlind: settings.smallBlind,
      bigBlind: settings.bigBlind,
      ante: settings.ante,
      minBuyIn: settings.minBuyIn,
      maxBuyIn: settings.maxBuyIn,
      actionTimeoutSeconds: settings.actionTimeoutSeconds,
      creatorOnlyStart: settings.creatorOnlyStart,
      allowSpectators: settings.allowSpectators,
      createdById: user.id,
      createdAt: new Date("2026-06-07T00:00:00.000Z"),
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: user.id, virtualChips: 5000 });

    const room = await createRuntimeRoom(user, settings);
    await sitDown("room-auto-next", user, 0, 1000);
    await sitDown("room-auto-next", secondUser, 1, 1000);
    for (const seat of room.seats) {
      seat.ready = true;
    }

    await startRuntimeHand("room-auto-next", user);
    const firstHandId = room.game?.handId;
    if (!room.game) {
      throw new Error("missing started game");
    }
    room.game.phase = "finished";
    room.nextHandReadyAt = new Date(Date.now() - 1000).toISOString();

    await __testing.handleHandPauseElapsed("room-auto-next");

    expect(room.status).toBe("PLAYING");
    expect(room.game?.handNumber).toBe(2);
    expect(room.game?.handId).not.toBe(firstHandId);
    expect(room.nextHandReadyAt).toBeUndefined();
    expect(room.seats.every((seat) => seat.ready)).toBe(true);
  });
});
