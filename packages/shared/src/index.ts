export type UserRole = "USER" | "ADMIN";

export type RoomStatus = "WAITING" | "PLAYING" | "FINISHED" | "CLOSED";

export type GameActionType = "fold" | "check" | "call" | "bet" | "raise" | "all-in";
export type RunoutMode = "once" | "twice";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  virtualChips: number;
  isBanned: boolean;
}

export interface MiniGameSettings {
  sevenTwo: boolean;
  bombPot: boolean;
  straddle: boolean;
  showOne: boolean;
  threePeat: boolean;
}

export interface RoomSettingsDto {
  name: string;
  maxPlayers: number;
  minPlayersToStart: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  minBuyIn: number;
  maxBuyIn: number;
  actionTimeoutSeconds: number;
  creatorOnlyStart: boolean;
  allowSpectators: boolean;
  rabbitHunting: boolean;
  deckType: string;
  miniGames: MiniGameSettings;
}

export interface RoomSummaryDto {
  id: string;
  name: string;
  status: RoomStatus;
  seatedCount: number;
  spectatorCount: number;
  maxPlayers: number;
  minPlayersToStart: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  actionTimeoutSeconds: number;
  creatorOnlyStart: boolean;
  deckType: string;
  miniGames: MiniGameSettings;
  createdById: string;
  createdAt: string;
}

export type CreateRoomPayload = RoomSettingsDto;

export interface JoinRoomPayload {
  roomId: string;
}

export interface SitPayload {
  roomId: string;
  seatIndex: number;
  buyIn: number;
}

export interface StandPayload {
  roomId: string;
}

export interface ReadyPayload {
  roomId: string;
  ready: boolean;
}

export interface AdjustTableChipsPayload {
  roomId: string;
  amount: number;
}

export interface StartGamePayload {
  roomId: string;
}

export interface GameActionPayload {
  roomId: string;
  action: GameActionType;
  amount?: number;
}

export interface RunoutPayload {
  roomId: string;
  mode: RunoutMode;
}

export interface ChatSendPayload {
  roomId: string;
  message: string;
}

export interface ChatMessageDto {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  message: string;
  createdAt: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface NotificationPayload {
  message: string;
  level?: "info" | "success" | "warning" | "error";
}

export interface EmojiPayload {
  roomId: string;
  emoji: string;
}

export interface EmojiThrowPayload {
  roomId: string;
  toUserId: string;
  emoji: string;
}

export interface ClientToServerEvents {
  "room:join": (payload: JoinRoomPayload) => void;
  "room:leave": (payload: JoinRoomPayload) => void;
  "room:create": (payload: CreateRoomPayload) => void;
  "room:sit": (payload: SitPayload) => void;
  "room:stand": (payload: StandPayload) => void;
  "room:kick": (payload: { roomId: string; targetUserId: string }) => void;
  "room:ready": (payload: ReadyPayload) => void;
  "room:chips:add": (payload: AdjustTableChipsPayload) => void;
  "room:chips:remove": (payload: AdjustTableChipsPayload) => void;
  "game:start": (payload: StartGamePayload) => void;
  "game:action": (payload: GameActionPayload) => void;
  "game:runout": (payload: RunoutPayload) => void;
  "chat:send": (payload: ChatSendPayload) => void;
  "state:request": (payload: JoinRoomPayload) => void;
  "player:reveal": (payload: JoinRoomPayload) => void;
  "emoji:set": (payload: EmojiPayload) => void;
  "emoji:throw": (payload: EmojiThrowPayload) => void;
  "game:rabbit": (payload: JoinRoomPayload) => void;
}

export interface ServerToClientEvents {
  "room:list": (rooms: RoomSummaryDto[]) => void;
  "room:state": (state: unknown) => void;
  "game:state": (state: unknown) => void;
  "game:event": (event: unknown) => void;
  "chat:message": (message: ChatMessageDto) => void;
  "emoji:show": (payload: EmojiPayload & { userId: string }) => void;
  "emoji:throw": (payload: EmojiThrowPayload & { fromUserId: string }) => void;
  "game:rabbit-cards": (payload: { cards: any[] }) => void;
  error: (payload: ErrorPayload) => void;
  notification: (payload: NotificationPayload) => void;
}

export const SOCKET_EVENTS = {
  client: [
    "room:join",
    "room:leave",
    "room:create",
    "room:sit",
    "room:stand",
    "room:kick",
    "room:ready",
    "room:chips:add",
    "room:chips:remove",
    "game:start",
    "game:action",
    "game:runout",
    "chat:send",
    "state:request",
    "emoji:set",
    "emoji:throw",
  ],
  server: [
    "room:list",
    "room:state",
    "game:state",
    "game:event",
    "chat:message",
    "emoji:show",
    "emoji:throw",
    "error",
    "notification",
  ],
} as const;
