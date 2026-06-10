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
  minPlayersToStart: z.number().int().min(2).max(9).default(2),
  smallBlind: z.number().int().min(1),
  bigBlind: z.number().int().min(2),
  ante: z.number().int().min(0).max(1_000_000).default(0),
  minBuyIn: z.number().int().min(1),
  maxBuyIn: z.number().int().min(1),
  actionTimeoutSeconds: z.number().int().min(5).max(300).default(30),
  creatorOnlyStart: z.boolean().default(false),
  allowSpectators: z.boolean().default(true),
  rabbitHunting: z.boolean().default(true),
  deckType: z.string().default("standard"),
}).refine((room) => room.minPlayersToStart <= room.maxPlayers, {
  message: "开局人数不能大于最大人数",
  path: ["minPlayersToStart"],
});

export const updateRoomSettingsSchema = z.object({
  roomId: z.string().min(1),
  smallBlind: z.number().int().min(1).optional(),
  bigBlind: z.number().int().min(2).optional(),
  actionTimeoutSeconds: z.number().int().min(5).max(300).optional(),
  rabbitHunting: z.boolean().optional(),
  deckType: z.string().optional(),
});

export const sitSchema = z.object({
  roomId: z.string().min(1),
  seatIndex: z.number().int().min(0).max(8),
  buyIn: z.number().int().min(1),
});

export const roomIdSchema = z.object({ roomId: z.string().min(1) });

export const readySchema = roomIdSchema.extend({ ready: z.boolean() });

export const tableChipAdjustmentSchema = roomIdSchema.extend({
  amount: z.number().int().positive().max(1_000_000),
});

export const gameActionSchema = roomIdSchema.extend({
  action: z.enum(["fold", "check", "call", "bet", "raise", "all-in"]),
  amount: z.number().int().positive().optional(),
});

export const runoutSchema = roomIdSchema.extend({
  mode: z.enum(["once", "twice"]),
});

export const chatSchema = roomIdSchema.extend({
  message: z.string().trim().min(1).max(300),
});

export const adjustChipsSchema = z.object({
  delta: z.number().int().min(-1_000_000).max(1_000_000),
  reason: z.string().min(1).max(120),
});
