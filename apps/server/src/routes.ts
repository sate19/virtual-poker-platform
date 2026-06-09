import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clearSessionCookie, hashPassword, requestUser, requireAdmin, requireUser, setSessionCookie, signSession, verifyPassword } from "./auth";
import { prisma } from "./prisma";
import { adjustChipsSchema, createRoomSchema, loginSchema, registerSchema, updateRoomSettingsSchema } from "./validation";
import { addAIPlayersToRoom, closeRuntimeRoom, createRuntimeRoom, getRoomLedger, getRuntimeRoom, getRuntimeRoomIfLoaded, listRooms, removeAIPlayersFromRoom, updateRoomSettings } from "./roomStore";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ ok: true }));

  app.post("/auth/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await prisma.user.create({
        data: {
          username: input.username,
          displayName: input.displayName,
          passwordHash,
          stats: { create: {} },
        },
      });
      setSessionCookie(reply, signSession(user.id));
      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        virtualChips: user.virtualChips,
      };
    } catch {
      reply.code(409);
      return { code: "USERNAME_EXISTS", message: "用户名已存在" };
    }
  });

  app.post("/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { username: input.username } });
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      reply.code(401);
      return { code: "INVALID_LOGIN", message: "用户名或密码错误" };
    }
    if (user.isBanned) {
      reply.code(403);
      return { code: "BANNED", message: "该账号已被禁用" };
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    setSessionCookie(reply, signSession(user.id));
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      virtualChips: user.virtualChips,
    };
  });

  app.post("/auth/logout", { preHandler: requireUser }, async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: requireUser }, async (request) => requestUser(request));

  app.patch("/auth/me", { preHandler: requireUser }, async (request) => {
    const user = requestUser(request);
    const input = z.object({ displayName: z.string().min(1).max(24) }).parse(request.body);
    await prisma.user.update({ where: { id: user.id }, data: { displayName: input.displayName } });
    return { id: user.id, username: user.username, displayName: input.displayName, role: user.role, virtualChips: user.virtualChips };
  });

  app.post("/auth/me/buy-chips", { preHandler: requireUser }, async (request) => {
    const user = requestUser(request);
    const input = z.object({ amount: z.number().int().min(1).max(1000000) }).parse(request.body);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { virtualChips: { increment: input.amount } },
    });
    await prisma.virtualChipLedger.create({
      data: { userId: user.id, delta: input.amount, reason: "PURCHASE", metadata: { note: "自助购码" } },
    });
    return { virtualChips: updated.virtualChips };
  });

  app.get("/rooms", { preHandler: requireUser }, async () => listRooms());

  app.post("/rooms", { preHandler: requireUser }, async (request) => {
    const user = requestUser(request);
    const input = createRoomSchema.parse(request.body);
    const room = await createRuntimeRoom(user, input);
    return { id: room.id };
  });

  app.patch("/rooms/:roomId/settings", { preHandler: requireUser }, async (request) => {
    const user = requestUser(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    const input = updateRoomSettingsSchema.parse({ ...request.body, roomId });
    await updateRoomSettings(roomId, user, input);
    return { ok: true };
  });

  app.post("/rooms/:roomId/ai-players", { preHandler: requireUser }, async (request) => {
    const user = requestUser(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return addAIPlayersToRoom(roomId, user);
  });

  app.delete("/rooms/:roomId/ai-players", { preHandler: requireUser }, async (request) => {
    const user = requestUser(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return removeAIPlayersFromRoom(roomId, user);
  });

  app.get("/rooms/:roomId/ledger", { preHandler: requireUser }, async (request) => {
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return getRoomLedger(roomId);
  });

  app.get("/rooms/:roomId", { preHandler: requireUser }, async (request) => {
    const params = z.object({ roomId: z.string() }).parse(request.params);
    const room = getRuntimeRoom(params.roomId);
    return {
      id: room.id,
      name: room.name,
      status: room.status,
      settings: room.settings,
      seats: room.seats,
      spectatorCount: room.spectators.size,
    };
  });

  app.get("/stats/me", { preHandler: requireUser }, async (request) => {
    const user = requestUser(request);
    const stats = await prisma.userStats.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });
    const recentHands = await prisma.handPlayer.findMany({
      where: { userId: user.id },
      include: { hand: { include: { room: true } } },
      orderBy: { hand: { endedAt: "desc" } },
      take: 20,
    });
    return { stats, recentHands };
  });

  app.get("/admin/users", { preHandler: requireAdmin }, async () =>
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        virtualChips: true,
        isBanned: true,
        createdAt: true,
        lastLoginAt: true,
        stats: true,
      },
    }),
  );

  app.get("/admin/rooms", { preHandler: requireAdmin }, async () => getAdminRoomRows());

  app.get("/admin/hands", { preHandler: requireAdmin }, async () =>
    prisma.hand.findMany({
      where: { room: { deletedAt: null } },
      orderBy: { startedAt: "desc" },
      take: 100,
      include: {
        room: true,
        players: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
              },
            },
          },
        },
      },
    }),
  );

  app.get("/admin/actions", { preHandler: requireAdmin }, async () => {
    const roomIds = await getVisibleRoomIds();
    return prisma.gameAction.findMany({
      where: { roomId: { in: roomIds } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  });

  app.get("/admin/chats", { preHandler: requireAdmin }, async () =>
    prisma.chatMessage.findMany({
      where: { room: { deletedAt: null } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        room: true,
      },
    }),
  );

  app.get("/admin/audit", { preHandler: requireAdmin }, async () =>
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    }),
  );

  app.get("/admin/analytics", { preHandler: requireAdmin }, async () => {
    const roomIds = await getVisibleRoomIds();
    const [hands, actions, users] = await Promise.all([
      prisma.hand.findMany({
        where: { roomId: { in: roomIds } },
        orderBy: { endedAt: "desc" },
        take: 500,
        include: {
          room: { select: { id: true, name: true } },
          players: {
            include: {
              user: { select: { id: true, username: true, displayName: true } },
            },
          },
        },
      }),
      prisma.gameAction.findMany({ where: { roomId: { in: roomIds } }, orderBy: { createdAt: "desc" }, take: 2000 }),
      prisma.user.findMany({
        include: { stats: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const totalHands = hands.length;
    const totalPot = hands.reduce((sum, hand) => sum + hand.potTotal, 0);
    const largestHand = hands.reduce<(typeof hands)[number] | undefined>(
      (largest, hand) => (!largest || hand.potTotal > largest.potTotal ? hand : largest),
      undefined,
    );
    const showdownHands = hands.filter((hand) => {
      const result = hand.result as { evaluations?: Record<string, unknown> } | null;
      return Boolean(result?.evaluations && Object.keys(result.evaluations).length > 1);
    }).length;
    const timeoutActions = actions.filter((action) => action.action.startsWith("timeout-auto")).length;
    const actionBreakdown = Object.entries(
      actions.reduce<Record<string, number>>((counts, action) => {
        counts[action.action] = (counts[action.action] ?? 0) + 1;
        return counts;
      }, {}),
    )
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);

    const playerAgg = new Map<
      string,
      {
        userId: string;
        username: string;
        displayName: string;
        hands: number;
        folded: number;
        totalCommitted: number;
        netVirtualChips: number;
      }
    >();

    const roomAgg = new Map<
      string,
      {
        roomId: string;
        roomName: string;
        hands: number;
        totalPot: number;
        largestPot: number;
        totalPlayers: number;
      }
    >();

    for (const hand of hands) {
      const roomRow = roomAgg.get(hand.roomId) ?? {
        roomId: hand.roomId,
        roomName: hand.room?.name ?? "已删除房间",
        hands: 0,
        totalPot: 0,
        largestPot: 0,
        totalPlayers: 0,
      };
      roomRow.hands += 1;
      roomRow.totalPot += hand.potTotal;
      roomRow.largestPot = Math.max(roomRow.largestPot, hand.potTotal);
      roomRow.totalPlayers += hand.players.length;
      roomAgg.set(hand.roomId, roomRow);

      for (const player of hand.players) {
        const row = playerAgg.get(player.userId) ?? {
          userId: player.userId,
          username: player.user.username,
          displayName: player.user.displayName,
          hands: 0,
          folded: 0,
          totalCommitted: 0,
          netVirtualChips: 0,
        };
        row.hands += 1;
        row.folded += player.folded ? 1 : 0;
        row.totalCommitted += player.totalCommitted;
        row.netVirtualChips += player.endingStack - player.startingStack;
        playerAgg.set(player.userId, row);
      }
    }

    const playerLeaderboard = users
      .map((user) => {
        const row = playerAgg.get(user.id);
        const stats = user.stats;
        const handsPlayed = stats?.totalHands ?? row?.hands ?? 0;
        const showdownCount = stats?.showdownCount ?? 0;
        return {
          userId: user.id,
          username: user.username,
          displayName: user.displayName,
          hands: handsPlayed,
          handsWon: stats?.handsWon ?? 0,
          winRate: ratio(stats?.handsWon ?? 0, handsPlayed),
          vpip: ratio(stats?.voluntarilyPutInPot ?? 0, handsPlayed),
          showdownRate: ratio(showdownCount, handsPlayed),
          showdownWinRate: ratio(stats?.showdownWins ?? 0, showdownCount),
          netVirtualChips: stats?.netVirtualChips ?? row?.netVirtualChips ?? 0,
          biggestPotWon: stats?.biggestPotWon ?? 0,
          averageCommitted: ratio(row?.totalCommitted ?? 0, row?.hands ?? 0),
          foldRate: ratio(row?.folded ?? 0, row?.hands ?? 0),
        };
      })
      .sort((a, b) => b.netVirtualChips - a.netVirtualChips)
      .slice(0, 20);

    const roomLeaderboard = [...roomAgg.values()]
      .map((room) => ({
        ...room,
        averagePot: ratio(room.totalPot, room.hands),
        averagePlayers: ratio(room.totalPlayers, room.hands),
      }))
      .sort((a, b) => b.hands - a.hands)
      .slice(0, 20);

    const leader = playerLeaderboard[0];
    const insights = [
      largestHand
        ? `最大底池来自 ${largestHand.room?.name ?? "已删除房间"} 第 ${largestHand.handNumber} 手，底池 ${largestHand.potTotal}。`
        : "暂无可分析的牌局记录。",
      totalHands > 0 ? `平均底池为 ${Math.round(totalPot / totalHands)}，摊牌率为 ${Math.round(ratio(showdownHands, totalHands) * 100)}%。` : "暂无平均底池数据。",
      timeoutActions > 0 ? `最近行动中有 ${timeoutActions} 次超时自动处理，可关注行动时间设置。` : "最近没有超时自动处理记录。",
      leader ? `当前历史净收益最高用户为 ${leader.displayName}，净变化 ${leader.netVirtualChips}。` : "暂无玩家排行数据。",
    ];

    return {
      overview: {
        totalHands,
        totalPot,
        averagePot: ratio(totalPot, totalHands),
        largestPot: largestHand?.potTotal ?? 0,
        showdownHands,
        showdownRate: ratio(showdownHands, totalHands),
        timeoutActions,
        autoFoldCount: actions.filter((action) => action.action === "timeout-auto-fold").length,
        autoCheckCount: actions.filter((action) => action.action === "timeout-auto-check").length,
        averagePlayersPerHand: ratio(
          hands.reduce((sum, hand) => sum + hand.players.length, 0),
          totalHands,
        ),
      },
      actionBreakdown,
      playerLeaderboard,
      roomLeaderboard,
      insights,
    };
  });

  app.post("/admin/users/:userId/ban", { preHandler: requireAdmin }, async (request) => {
    const actor = requestUser(request);
    const { userId } = z.object({ userId: z.string() }).parse(request.params);
    const { banned } = z.object({ banned: z.boolean() }).parse(request.body);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { isBanned: banned },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        virtualChips: true,
        isBanned: true,
      },
    });
    await prisma.adminAuditLog.create({
      data: {
        actorId: actor.id,
        action: banned ? "USER_BAN" : "USER_RESTORE",
        targetType: "User",
        targetId: userId,
        metadata: { username: user.username },
      },
    });
    return user;
  });

  app.post("/admin/users/:userId/chips", { preHandler: requireAdmin }, async (request) => {
    const actor = requestUser(request);
    const { userId } = z.object({ userId: z.string() }).parse(request.params);
    const input = adjustChipsSchema.parse(request.body);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { virtualChips: { increment: input.delta } },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        virtualChips: true,
        isBanned: true,
      },
    });
    await prisma.virtualChipLedger.create({
      data: { userId, delta: input.delta, reason: "ADMIN_ADJUST", metadata: { reason: input.reason } },
    });
    await prisma.adminAuditLog.create({
      data: {
        actorId: actor.id,
        action: "USER_CHIPS_ADJUST",
        targetType: "User",
        targetId: userId,
        metadata: input,
      },
    });
    return user;
  });

  app.post("/admin/rooms/:roomId/close", { preHandler: requireAdmin }, async (request) => {
    const actor = requestUser(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    await closeRuntimeRoom(roomId, actor);
    return { ok: true };
  });

  app.delete("/admin/rooms/:roomId", { preHandler: requireAdmin }, async (request) => {
    const actor = requestUser(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, name: true, status: true, closedAt: true, deletedAt: true },
    });
    if (!room || room.deletedAt) {
      return { ok: true };
    }

    const runtimeRoom = getRuntimeRoomIfLoaded(roomId);
    if (runtimeRoom && runtimeRoom.status !== "CLOSED") {
      await closeRuntimeRoom(roomId, actor, {
        auditAction: "ROOM_DELETE_CLOSE",
        ledgerReason: "ROOM_DELETE_RETURN",
        metadata: { deleteRequested: true },
      });
    } else if (room.status !== "CLOSED") {
      await prisma.room.update({
        where: { id: roomId },
        data: { status: "CLOSED", closedAt: room.closedAt ?? new Date() },
      });
    }

    await prisma.room.update({ where: { id: roomId }, data: { deletedAt: new Date() } });
    await prisma.adminAuditLog.create({
      data: {
        actorId: actor.id,
        action: "ROOM_DELETE",
        targetType: "Room",
        targetId: roomId,
        metadata: { name: room.name },
      },
    });
    return { ok: true };
  });
}

function ratio(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

async function getVisibleRoomIds(): Promise<string[]> {
  const rooms = await prisma.room.findMany({ where: { deletedAt: null }, select: { id: true } });
  return rooms.map((room) => room.id);
}

async function getAdminRoomRows() {
  const rooms = await prisma.room.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: {
        select: {
          id: true,
          username: true,
          displayName: true,
        },
      },
      seats: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              role: true,
              virtualChips: true,
              isBanned: true,
            },
          },
        },
      },
      hands: {
        orderBy: { startedAt: "asc" },
        include: {
          players: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return rooms.map((room) => {
    const runtime = getRuntimeRoomIfLoaded(room.id);
    const profitRows = new Map<
      string,
      {
        userId: string;
        username: string;
        displayName: string;
        completedNet: number;
        liveNet: number;
        netVirtualChips: number;
        currentStack: number | null;
        committed: number;
        connected: boolean | null;
      }
    >();

    let totalPot = 0;
    let largestPot = 0;
    for (const hand of room.hands) {
      totalPot += hand.potTotal;
      largestPot = Math.max(largestPot, hand.potTotal);
      for (const player of hand.players) {
        const row = ensureProfitRow(profitRows, player.userId, player.user.displayName, player.user.username);
        row.completedNet += player.endingStack - player.startingStack;
      }
    }

    for (const seat of room.seats) {
      const row = ensureProfitRow(profitRows, seat.userId, seat.user.displayName, seat.user.username);
      if (seat.status === "OCCUPIED") {
        row.currentStack = seat.tableChips;
      }
    }

    if (runtime?.game && runtime.game.phase !== "finished") {
      for (const player of runtime.game.players) {
        const row = ensureProfitRow(profitRows, player.userId, player.displayName, "");
        row.liveNet += player.stack - player.startingStack;
        row.currentStack = player.stack;
        row.committed = player.totalCommitted;
      }
    }

    if (runtime) {
      for (const seat of runtime.seats) {
        const row = ensureProfitRow(profitRows, seat.userId, seat.displayName, "");
        if (row.currentStack === null) {
          row.currentStack = seat.tableChips;
        }
        row.connected = seat.connected;
      }
    }

    const profitLoss = [...profitRows.values()]
      .map((row) => ({
        ...row,
        netVirtualChips: row.completedNet + row.liveNet,
      }))
      .sort((a, b) => b.netVirtualChips - a.netVirtualChips || a.displayName.localeCompare(b.displayName, "zh-CN"));

    const firstHand = room.hands[0];
    const lastHand = room.hands[room.hands.length - 1];
    const occupiedSeats = room.seats.filter((seat) => seat.status === "OCCUPIED");

    return {
      id: room.id,
      name: room.name,
      status: runtime?.status ?? room.status,
      createdAt: room.createdAt,
      closedAt: room.closedAt,
      createdBy: room.createdBy,
      seatedCount: runtime?.seats.length ?? occupiedSeats.length,
      connectedSeatedCount: runtime?.seats.filter((seat) => seat.connected).length ?? 0,
      spectatorCount: runtime?.spectators.size ?? 0,
      totalHands: room.hands.length,
      totalPot,
      largestPot,
      firstHandStartedAt: firstHand?.startedAt ?? null,
      lastHandEndedAt: lastHand?.endedAt ?? null,
      profitLoss,
    };
  });
}

function ensureProfitRow(
  rows: Map<
    string,
    {
      userId: string;
      username: string;
      displayName: string;
      completedNet: number;
      liveNet: number;
      netVirtualChips: number;
      currentStack: number | null;
      committed: number;
      connected: boolean | null;
    }
  >,
  userId: string,
  displayName: string,
  username: string,
) {
  const existing = rows.get(userId);
  if (existing) {
    if (!existing.username && username) {
      existing.username = username;
    }
    return existing;
  }
  const row = {
    userId,
    username,
    displayName,
    completedNet: 0,
    liveNet: 0,
    netVirtualChips: 0,
    currentStack: null,
    committed: 0,
    connected: null,
  };
  rows.set(userId, row);
  return row;
}
