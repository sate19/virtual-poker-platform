import { z } from "zod";

export const registerSchema = z.object({
  username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),
  displayName: z.string().min(1).max(24),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  username: z.string().min(3).max(24),
  password: z.string().min(8).max(128),
});

export const createRoomSchema = z.object({
  name: z.string().min(1).max(40),
  maxPlayers: z.number().int().min(2).max(9).default(9),
  smallBlind: z.number().int().min(1),
  bigBlind: z.number().int().min(2),
  minBuyIn: z.number().int().min(1),
  maxBuyIn: z.number().int().min(1),
  allowSpectators: z.boolean().default(true),
});

export const sitSchema = z.object({
  roomId: z.string().min(1),
  seatIndex: z.number().int().min(0).max(8),
  buyIn: z.number().int().min(1),
});

export const roomIdSchema = z.object({ roomId: z.string().min(1) });

export const readySchema = roomIdSchema.extend({ ready: z.boolean() });

export const gameActionSchema = roomIdSchema.extend({
  action: z.enum(["fold", "check", "call", "bet", "raise", "all-in"]),
  amount: z.number().int().positive().optional(),
});

export const chatSchema = roomIdSchema.extend({
  message: z.string().trim().min(1).max(300),
});

export const adjustChipsSchema = z.object({
  delta: z.number().int().min(-1_000_000).max(1_000_000),
  reason: z.string().min(1).max(120),
});
