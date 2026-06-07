export type Suit = "s" | "h" | "d" | "c";
export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "T"
  | "J"
  | "Q"
  | "K"
  | "A";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type HandCategory =
  | "High Card"
  | "One Pair"
  | "Two Pair"
  | "Three of a Kind"
  | "Straight"
  | "Flush"
  | "Full House"
  | "Four of a Kind"
  | "Straight Flush"
  | "Royal Flush";

export interface HandEvaluation {
  category: HandCategory;
  categoryRank: number;
  ranks: number[];
  cards: Card[];
  label: string;
}

export type GamePhase =
  | "waiting"
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "runout"
  | "revealing"
  | "finished";
export type PlayerStatus = "seated" | "ready" | "active" | "folded" | "all-in" | "out";
export type PokerActionType = "fold" | "check" | "call" | "bet" | "raise" | "all-in";
export type RunoutMode = "once" | "twice";

export interface EnginePlayer {
  userId: string;
  displayName: string;
  seatIndex: number;
  startingStack: number;
  stack: number;
  status: PlayerStatus;
  ready: boolean;
  holeCards: Card[];
  committedThisStreet: number;
  totalCommitted: number;
  actedThisStreet: boolean;
  lastAction?: PokerActionType;
}

export interface PokerAction {
  type: PokerActionType;
  amount?: number;
}

export interface GameActionLogEntry {
  userId?: string;
  action: string;
  amount?: number;
  phase: GamePhase;
  createdAt: string;
}

export interface ActionClockState {
  userId: string;
  startedAt: string;
  deadlineAt: string;
  timeoutSeconds: number;
}

export interface SidePot {
  id: string;
  amount: number;
  eligiblePlayerIds: string[];
  contributorIds: string[];
  level: number;
}

export interface PotAward {
  potId: string;
  amount: number;
  winnerIds: string[];
  oddChipWinnerId?: string;
  boardId?: string;
}

export interface RunoutEquity {
  userId: string;
  winPercent: number;
  tiePercent: number;
  samples: number;
}

export interface RunoutSelection {
  eligiblePlayerIds: string[];
  votes: Record<string, RunoutMode>;
  remainingCards: number;
  startedAt: string;
}

export interface RunoutBoard {
  id: string;
  cards: Card[];
  awards: PotAward[];
  payouts: Record<string, number>;
  showdownEvaluations: Record<string, HandEvaluation>;
  equities?: RunoutEquity[];
  isComplete?: boolean;
}

export interface RunoutPlan {
  id: string;
  cards: Card[];
}

export interface PokerGameState {
  handId: string;
  phase: GamePhase;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  buttonSeatIndex: number;
  smallBlindSeatIndex: number;
  bigBlindSeatIndex: number;
  currentTurnUserId?: string;
  currentBet: number;
  minRaise: number;
  communityCards: Card[];
  deck: Card[];
  players: EnginePlayer[];
  actionLog: GameActionLogEntry[];
  sidePots: SidePot[];
  awards: PotAward[];
  showdownEvaluations: Record<string, HandEvaluation>;
  handNumber: number;
  actionClock?: ActionClockState;
  runoutSelection?: RunoutSelection;
  runoutMode?: RunoutMode;
  runoutBoards?: RunoutBoard[];
  runoutPlan?: RunoutPlan[];
}

export interface PublicEnginePlayer {
  userId: string;
  displayName: string;
  seatIndex: number;
  startingStack: number;
  stack: number;
  status: PlayerStatus;
  ready: boolean;
  committedThisStreet: number;
  totalCommitted: number;
  actedThisStreet: boolean;
  lastAction?: PokerActionType;
  holeCards?: Card[];
}

export interface PublicPokerGameState {
  handId: string;
  phase: GamePhase;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  buttonSeatIndex: number;
  smallBlindSeatIndex: number;
  bigBlindSeatIndex: number;
  currentTurnUserId?: string;
  currentBet: number;
  minRaise: number;
  communityCards: Card[];
  players: PublicEnginePlayer[];
  actionLog: GameActionLogEntry[];
  sidePots: SidePot[];
  awards: PotAward[];
  showdownEvaluations: Record<string, HandEvaluation>;
  handNumber: number;
  actionClock?: ActionClockState;
  runoutSelection?: RunoutSelection;
  runoutMode?: RunoutMode;
  runoutBoards?: RunoutBoard[];
}
