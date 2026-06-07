import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser, RoomSettingsDto } from "@friends-poker/shared";

const prismaMock = vi.hoisted(() => ({
  room: {
    create: vi.fn(),
  },
  roomSeat: {
    create: vi.fn(),
    deleteMany: vi.fn(),
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

import { __testing, createRuntimeRoom, sitDown, type RuntimeRoom } from "../src/roomStore";

const user: AuthUser = {
  id: "user-1",
  username: "user1",
  displayName: "玩家一",
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
});
