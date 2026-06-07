import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@friends-poker/shared";
import { config } from "./config";
import { getUserFromToken, parseCookie } from "./auth";
import {
  applyRuntimeAction,
  attachRealtimeServer,
  chooseRuntimeRunout,
  createRuntimeRoom,
  emitAllRoomLists,
  emitRoomState,
  forgetSocket,
  joinAsSpectator,
  leaveRoom,
  rememberSocket,
  sendChatMessage,
  setReady,
  sitDown,
  standUp,
  startRuntimeHand,
} from "./roomStore";
import {
  chatSchema,
  createRoomSchema,
  gameActionSchema,
  readySchema,
  roomIdSchema,
  runoutSchema,
  sitSchema,
} from "./validation";

export function registerSocket(app: FastifyInstance): Server<ClientToServerEvents, ServerToClientEvents> {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    cors: {
      origin: config.webOrigin,
      credentials: true,
    },
  });
  attachRealtimeServer(io);

  io.use(async (socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie);
    const user = await getUserFromToken(cookies[config.cookieName]);
    if (!user) {
      next(new Error("请先登录"));
      return;
    }
    rememberSocket(socket, user);
    (socket.data as any).user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user = (socket.data as any).user;
    socket.emit("room:list", []);
    void emitAllRoomLists(io);

    socket.on("room:create", async (payload) => {
      await guarded(socket, async () => {
        const input = createRoomSchema.parse(payload);
        const room = await createRuntimeRoom(user, input);
        await socket.join(room.id);
        await joinAsSpectator(room.id, user, socket.id);
        await emitAllRoomLists(io);
        await emitRoomState(io, room.id);
      });
    });

    socket.on("room:join", async (payload) => {
      await guarded(socket, async () => {
        const { roomId } = roomIdSchema.parse(payload);
        await socket.join(roomId);
        await joinAsSpectator(roomId, user, socket.id);
        await emitRoomState(io, roomId);
        await emitAllRoomLists(io);
      });
    });

    socket.on("room:leave", async (payload) => {
      await guarded(socket, async () => {
        const { roomId } = roomIdSchema.parse(payload);
        leaveRoom(roomId, user);
        await socket.leave(roomId);
        await emitRoomState(io, roomId);
        await emitAllRoomLists(io);
      });
    });

    socket.on("room:sit", async (payload) => {
      await guarded(socket, async () => {
        const input = sitSchema.parse(payload);
        await sitDown(input.roomId, user, input.seatIndex, input.buyIn);
        await emitRoomState(io, input.roomId);
        await emitAllRoomLists(io);
      });
    });

    socket.on("room:stand", async (payload) => {
      await guarded(socket, async () => {
        const { roomId } = roomIdSchema.parse(payload);
        await standUp(roomId, user);
        await emitRoomState(io, roomId);
        await emitAllRoomLists(io);
      });
    });

    socket.on("room:ready", async (payload) => {
      await guarded(socket, async () => {
        const { roomId, ready } = readySchema.parse(payload);
        await setReady(roomId, user, ready);
        await emitRoomState(io, roomId);
      });
    });

    socket.on("game:start", async (payload) => {
      await guarded(socket, async () => {
        const { roomId } = roomIdSchema.parse(payload);
        await startRuntimeHand(roomId, user);
        await emitRoomState(io, roomId);
        await emitAllRoomLists(io);
      });
    });

    socket.on("game:action", async (payload) => {
      await guarded(socket, async () => {
        const input = gameActionSchema.parse(payload);
        await applyRuntimeAction(input.roomId, user, { type: input.action, amount: input.amount });
        await emitRoomState(io, input.roomId);
        await emitAllRoomLists(io);
      });
    });

    socket.on("game:runout", async (payload) => {
      await guarded(socket, async () => {
        const input = runoutSchema.parse(payload);
        await chooseRuntimeRunout(input.roomId, user, input.mode);
        await emitRoomState(io, input.roomId);
        await emitAllRoomLists(io);
      });
    });

    socket.on("chat:send", async (payload) => {
      await guarded(socket, async () => {
        const input = chatSchema.parse(payload);
        const message = await sendChatMessage(input.roomId, user, input.message);
        io.to(input.roomId).emit("chat:message", message);
      });
    });

    socket.on("state:request", async (payload) => {
      await guarded(socket, async () => {
        const { roomId } = roomIdSchema.parse(payload);
        await emitRoomState(io, roomId);
      });
    });

    socket.on("disconnect", () => {
      forgetSocket(socket);
    });
  });

  return io;
}

async function guarded(socket: any, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    socket.emit("error", {
      code: "REQUEST_FAILED",
      message: error instanceof Error ? error.message : "请求失败",
    });
  }
}
