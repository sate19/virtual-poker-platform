import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clearSessionCookie, hashPassword, requestUser, requireAdmin, requireUser, setSessionCookie, signSession, verifyPassword } from "./auth";
import { prisma } from "./prisma";
import { adjustChipsSchema, createRoomSchema, loginSchema, registerSchema } from "./validation";
import { closeRuntimeRoom, createRuntimeRoom, getRuntimeRoom, listRooms } from "./roomStore";

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

  app.get("/rooms", { preHandler: requireUser }, async () => listRooms());

  app.post("/rooms", { preHandler: requireUser }, async (request) => {
    const user = requestUser(request);
    const input = createRoomSchema.parse(request.body);
    const room = await createRuntimeRoom(user, input);
    return { id: room.id };
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

  app.get("/admin/rooms", { preHandler: requireAdmin }, async () =>
    prisma.room.findMany({
      orderBy: { createdAt: "desc" },
      include: {
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
      },
    }),
  );

  app.get("/admin/hands", { preHandler: requireAdmin }, async () =>
    prisma.hand.findMany({
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

  app.get("/admin/actions", { preHandler: requireAdmin }, async () =>
    prisma.gameAction.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  );

  app.get("/admin/chats", { preHandler: requireAdmin }, async () =>
    prisma.chatMessage.findMany({
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
}
