import { createDeck, dealOne, shuffleDeck } from "./cards";
import { compareEvaluations, evaluateSevenCards } from "./handEvaluator";
import { awardSidePots, buildSidePots } from "./sidePots";
import type {
  EnginePlayer,
  GameActionLogEntry,
  PokerAction,
  PokerGameState,
  PublicPokerGameState,
} from "./types";

export interface StartHandInput {
  handId: string;
  players: Array<{
    userId: string;
    displayName: string;
    seatIndex: number;
    stack: number;
    ready: boolean;
  }>;
  smallBlind: number;
  bigBlind: number;
  previousButtonSeatIndex?: number;
  handNumber?: number;
  random?: () => number;
}

export function startHand(input: StartHandInput): PokerGameState {
  const activePlayers = input.players
    .filter((player) => player.ready && player.stack > 0)
    .sort((a, b) => a.seatIndex - b.seatIndex);
  if (activePlayers.length < 2) {
    throw new Error("至少需要 2 名已准备玩家才能开始牌局");
  }

  const buttonSeatIndex = nextOccupiedSeat(
    input.previousButtonSeatIndex ?? activePlayers[activePlayers.length - 1]!.seatIndex,
    activePlayers.map((player) => player.seatIndex),
  );
  const headsUp = activePlayers.length === 2;
  const smallBlindSeatIndex = headsUp
    ? buttonSeatIndex
    : nextOccupiedSeat(buttonSeatIndex, activePlayers.map((player) => player.seatIndex));
  const bigBlindSeatIndex = nextOccupiedSeat(
    smallBlindSeatIndex,
    activePlayers.map((player) => player.seatIndex),
  );

  let deck = shuffleDeck(createDeck(), input.random);
  const players: EnginePlayer[] = activePlayers.map((player) => ({
    ...player,
    startingStack: player.stack,
    status: "active",
    holeCards: [],
    committedThisStreet: 0,
    totalCommitted: 0,
    actedThisStreet: false,
  }));

  const dealOrder = orderedFrom(smallBlindSeatIndex, players);
  for (let round = 0; round < 2; round += 1) {
    for (const player of dealOrder) {
      const result = dealOne(deck);
      player.holeCards.push(result.card);
      deck = result.deck;
    }
  }

  const state: PokerGameState = {
    handId: input.handId,
    phase: "preflop",
    smallBlind: input.smallBlind,
    bigBlind: input.bigBlind,
    buttonSeatIndex,
    smallBlindSeatIndex,
    bigBlindSeatIndex,
    currentTurnUserId: undefined,
    currentBet: 0,
    minRaise: input.bigBlind,
    communityCards: [],
    deck,
    players,
    actionLog: [],
    sidePots: [],
    awards: [],
    showdownEvaluations: {},
    handNumber: input.handNumber ?? 1,
  };

  postBlind(state, smallBlindSeatIndex, input.smallBlind, "post-small-blind");
  postBlind(state, bigBlindSeatIndex, input.bigBlind, "post-big-blind");
  state.currentBet = Math.max(...state.players.map((player) => player.committedThisStreet));
  state.currentTurnUserId = nextActionUserId(state, nextOccupiedSeat(bigBlindSeatIndex, occupiedSeats(state)));
  return state;
}

export function applyAction(state: PokerGameState, userId: string, action: PokerAction): PokerGameState {
  const next = cloneState(state);
  if (!["preflop", "flop", "turn", "river"].includes(next.phase)) {
    throw new Error("当前阶段不能行动");
  }
  if (next.currentTurnUserId !== userId) {
    throw new Error("还没有轮到该玩家行动");
  }

  const player = next.players.find((item) => item.userId === userId);
  if (!player || player.status === "folded" || player.status === "all-in" || player.stack <= 0) {
    throw new Error("该玩家当前不能行动");
  }

  const toCall = Math.max(0, next.currentBet - player.committedThisStreet);
  switch (action.type) {
    case "fold":
      player.status = "folded";
      player.actedThisStreet = true;
      player.lastAction = "fold";
      log(next, userId, "fold");
      break;
    case "check":
      if (toCall !== 0) {
        throw new Error("当前不能过牌，需要跟注、加注或弃牌");
      }
      player.actedThisStreet = true;
      player.lastAction = "check";
      log(next, userId, "check");
      break;
    case "call":
      if (toCall <= 0) {
        throw new Error("当前无需跟注");
      }
      commitChips(player, toCall);
      player.actedThisStreet = true;
      player.lastAction = "call";
      log(next, userId, "call", Math.min(toCall, player.totalCommitted));
      break;
    case "bet":
      applyBet(next, player, action.amount);
      break;
    case "raise":
      applyRaise(next, player, action.amount);
      break;
    case "all-in":
      applyAllIn(next, player);
      break;
    default:
      throw new Error("未知行动");
  }

  return progressGame(next);
}

export function getPublicGameStateForUser(
  state: PokerGameState,
  userId?: string,
): PublicPokerGameState {
  const canShowdown = state.phase === "showdown" || state.phase === "finished";
  const showdownPlayerIds = new Set(
    canShowdown
      ? state.players
          .filter((player) => player.status !== "folded" && player.holeCards.length === 2)
          .map((player) => player.userId)
      : [],
  );

  return {
    handId: state.handId,
    phase: state.phase,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    buttonSeatIndex: state.buttonSeatIndex,
    smallBlindSeatIndex: state.smallBlindSeatIndex,
    bigBlindSeatIndex: state.bigBlindSeatIndex,
    currentTurnUserId: state.currentTurnUserId,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    communityCards: [...state.communityCards],
    players: state.players.map((player) => ({
      userId: player.userId,
      displayName: player.displayName,
      seatIndex: player.seatIndex,
      stack: player.stack,
      status: player.status,
      ready: player.ready,
      committedThisStreet: player.committedThisStreet,
      totalCommitted: player.totalCommitted,
      actedThisStreet: player.actedThisStreet,
      lastAction: player.lastAction,
      holeCards:
        player.userId === userId || showdownPlayerIds.has(player.userId)
          ? [...player.holeCards]
          : undefined,
    })),
    actionLog: [...state.actionLog],
    sidePots: state.sidePots.map((pot) => ({ ...pot })),
    awards: state.awards.map((award) => ({ ...award })),
    showdownEvaluations: canShowdown ? { ...state.showdownEvaluations } : {},
    handNumber: state.handNumber,
  };
}

export function getLegalActions(state: PokerGameState, userId: string): PokerAction[] {
  const player = state.players.find((item) => item.userId === userId);
  if (!player || state.currentTurnUserId !== userId || player.stack <= 0) {
    return [];
  }
  const toCall = Math.max(0, state.currentBet - player.committedThisStreet);
  const actions: PokerAction[] = [{ type: "fold" }, { type: "all-in" }];
  if (toCall === 0) {
    actions.push({ type: "check" });
    if (player.stack >= state.bigBlind) {
      actions.push({ type: "bet", amount: state.bigBlind });
    }
  } else {
    actions.push({ type: "call", amount: toCall });
    if (player.stack + player.committedThisStreet >= state.currentBet + state.minRaise) {
      actions.push({ type: "raise", amount: state.currentBet + state.minRaise });
    }
  }
  return actions;
}

function applyBet(state: PokerGameState, player: EnginePlayer, amount?: number): void {
  if (state.currentBet !== 0) {
    throw new Error("已有下注时不能 bet，请使用 raise");
  }
  const bet = integerAmount(amount, "下注金额");
  if (bet < state.bigBlind && bet < player.stack) {
    throw new Error("下注金额不能小于大盲，除非全下");
  }
  commitChips(player, bet);
  state.currentBet = player.committedThisStreet;
  state.minRaise = Math.max(state.bigBlind, state.currentBet);
  resetActedAfterAggression(state, player.userId);
  player.actedThisStreet = true;
  player.lastAction = "bet";
  log(state, player.userId, "bet", bet);
}

function applyRaise(state: PokerGameState, player: EnginePlayer, raiseTo?: number): void {
  if (state.currentBet <= 0) {
    throw new Error("还没有下注时不能 raise，请使用 bet");
  }
  const target = integerAmount(raiseTo, "加注到");
  const minTarget = state.currentBet + state.minRaise;
  const allInTarget = player.committedThisStreet + player.stack;
  if (target < minTarget && target < allInTarget) {
    throw new Error(`最小加注到 ${minTarget}`);
  }
  if (target <= state.currentBet) {
    throw new Error("加注金额必须高于当前下注");
  }
  const add = target - player.committedThisStreet;
  commitChips(player, add);
  const raiseSize = player.committedThisStreet - state.currentBet;
  const fullRaise = raiseSize >= state.minRaise;
  state.currentBet = Math.max(state.currentBet, player.committedThisStreet);
  if (fullRaise) {
    state.minRaise = raiseSize;
    resetActedAfterAggression(state, player.userId);
  }
  player.actedThisStreet = true;
  player.lastAction = "raise";
  log(state, player.userId, "raise", player.committedThisStreet);
}

function applyAllIn(state: PokerGameState, player: EnginePlayer): void {
  const oldCurrentBet = state.currentBet;
  const target = player.committedThisStreet + player.stack;
  commitChips(player, player.stack);
  player.status = "all-in";
  player.actedThisStreet = true;
  player.lastAction = "all-in";

  if (target > oldCurrentBet) {
    const raiseSize = target - oldCurrentBet;
    state.currentBet = target;
    if (raiseSize >= state.minRaise) {
      state.minRaise = raiseSize;
      resetActedAfterAggression(state, player.userId);
      player.actedThisStreet = true;
    }
  }
  log(state, player.userId, "all-in", target);
}

function progressGame(state: PokerGameState): PokerGameState {
  const remaining = state.players.filter((player) => player.status !== "folded");
  if (remaining.length === 1) {
    return finishByFold(state, remaining[0]!.userId);
  }

  if (!isBettingRoundComplete(state)) {
    state.currentTurnUserId = nextActionUserId(state, nextSeatAfterCurrent(state));
    return state;
  }

  if (remaining.every((player) => player.status === "all-in")) {
    dealCommunityToShowdown(state);
    return finishByShowdown(state);
  }

  if (state.phase === "river") {
    return finishByShowdown(state);
  }

  advanceStreet(state);
  if (state.players.filter((player) => player.status !== "folded" && player.status !== "all-in").length === 0) {
    dealCommunityToShowdown(state);
    return finishByShowdown(state);
  }
  state.currentTurnUserId = nextActionUserId(
    state,
    nextOccupiedSeat(state.buttonSeatIndex, occupiedSeats(state)),
  );
  return state;
}

function advanceStreet(state: PokerGameState): void {
  for (const player of state.players) {
    player.committedThisStreet = 0;
    player.actedThisStreet = player.status === "folded" || player.status === "all-in";
  }
  state.currentBet = 0;
  state.minRaise = state.bigBlind;

  if (state.phase === "preflop") {
    burnAndDeal(state, 3);
    state.phase = "flop";
  } else if (state.phase === "flop") {
    burnAndDeal(state, 1);
    state.phase = "turn";
  } else if (state.phase === "turn") {
    burnAndDeal(state, 1);
    state.phase = "river";
  }
  log(state, undefined, state.phase);
}

function finishByFold(state: PokerGameState, winnerId: string): PokerGameState {
  const potAmount = state.players.reduce((sum, player) => sum + player.totalCommitted, 0);
  const winner = state.players.find((player) => player.userId === winnerId)!;
  winner.stack += potAmount;
  state.sidePots = [
    {
      id: "pot-1",
      amount: potAmount,
      level: 0,
      contributorIds: state.players.filter((player) => player.totalCommitted > 0).map((player) => player.userId),
      eligiblePlayerIds: [winnerId],
    },
  ];
  state.awards = [{ potId: "pot-1", amount: potAmount, winnerIds: [winnerId] }];
  state.phase = "finished";
  state.currentTurnUserId = undefined;
  log(state, winnerId, "win-by-fold", potAmount);
  return state;
}

function finishByShowdown(state: PokerGameState): PokerGameState {
  dealCommunityToShowdown(state);
  const participants = state.players.map((player) => {
    const hand =
      player.status !== "folded"
        ? evaluateSevenCards([...player.holeCards, ...state.communityCards])
        : undefined;
    if (hand) {
      state.showdownEvaluations[player.userId] = hand;
    }
    return {
      userId: player.userId,
      committed: player.totalCommitted,
      folded: player.status === "folded",
      seatIndex: player.seatIndex,
      hand,
    };
  });
  state.sidePots = buildSidePots(participants);
  const { awards, payouts } = awardSidePots(state.sidePots, participants, state.buttonSeatIndex);
  state.awards = awards;
  for (const player of state.players) {
    player.stack += payouts[player.userId] ?? 0;
  }
  state.phase = "finished";
  state.currentTurnUserId = undefined;
  log(state, undefined, "showdown");
  return state;
}

function isBettingRoundComplete(state: PokerGameState): boolean {
  return state.players
    .filter((player) => player.status !== "folded" && player.status !== "all-in")
    .every((player) => player.actedThisStreet && player.committedThisStreet === state.currentBet);
}

function nextActionUserId(state: PokerGameState, startSeatIndex: number): string | undefined {
  const ordered = orderedFrom(startSeatIndex, state.players);
  return ordered.find(
    (player) => player.status !== "folded" && player.status !== "all-in" && player.stack > 0,
  )?.userId;
}

function nextSeatAfterCurrent(state: PokerGameState): number {
  const current = state.players.find((player) => player.userId === state.currentTurnUserId);
  return nextOccupiedSeat(current?.seatIndex ?? state.buttonSeatIndex, occupiedSeats(state));
}

function postBlind(
  state: PokerGameState,
  seatIndex: number,
  amount: number,
  action: GameActionLogEntry["action"],
): void {
  const player = state.players.find((item) => item.seatIndex === seatIndex);
  if (!player) {
    throw new Error("盲注座位不存在");
  }
  commitChips(player, amount);
  log(state, player.userId, action, amount);
}

function commitChips(player: EnginePlayer, amount: number): number {
  const committed = Math.min(player.stack, Math.max(0, Math.floor(amount)));
  player.stack -= committed;
  player.committedThisStreet += committed;
  player.totalCommitted += committed;
  if (player.stack === 0) {
    player.status = "all-in";
  }
  return committed;
}

function resetActedAfterAggression(state: PokerGameState, aggressorUserId: string): void {
  for (const player of state.players) {
    if (player.userId !== aggressorUserId && player.status !== "folded" && player.status !== "all-in") {
      player.actedThisStreet = false;
    }
  }
}

function burnAndDeal(state: PokerGameState, count: number): void {
  const burn = dealOne(state.deck);
  state.deck = burn.deck;
  for (let i = 0; i < count; i += 1) {
    const result = dealOne(state.deck);
    state.communityCards.push(result.card);
    state.deck = result.deck;
  }
}

function dealCommunityToShowdown(state: PokerGameState): void {
  while (state.communityCards.length < 5) {
    burnAndDeal(state, state.communityCards.length < 3 ? 3 : 1);
    if (state.communityCards.length === 3) {
      state.phase = "flop";
    } else if (state.communityCards.length === 4) {
      state.phase = "turn";
    } else if (state.communityCards.length === 5) {
      state.phase = "river";
    }
  }
}

function orderedFrom<T extends { seatIndex: number }>(seatIndex: number, players: T[]): T[] {
  return [...players].sort((a, b) => seatDistance(seatIndex, a.seatIndex) - seatDistance(seatIndex, b.seatIndex));
}

function nextOccupiedSeat(fromSeatIndex: number, occupied: number[]): number {
  const sorted = [...occupied].sort((a, b) => a - b);
  for (let offset = 1; offset <= 9; offset += 1) {
    const candidate = (fromSeatIndex + offset) % 9;
    if (sorted.includes(candidate)) {
      return candidate;
    }
  }
  throw new Error("没有可用座位");
}

function occupiedSeats(state: PokerGameState): number[] {
  return state.players.map((player) => player.seatIndex);
}

function seatDistance(from: number, to: number): number {
  return (to - from + 9) % 9;
}

function integerAmount(amount: number | undefined, label: string): number {
  if (amount === undefined || !Number.isInteger(amount) || amount <= 0) {
    throw new Error(`${label}必须是正整数`);
  }
  return amount;
}

function log(state: PokerGameState, userId: string | undefined, action: string, amount?: number): void {
  state.actionLog.push({
    userId,
    action,
    amount,
    phase: state.phase,
    createdAt: new Date().toISOString(),
  });
}

function cloneState(state: PokerGameState): PokerGameState {
  return {
    ...state,
    communityCards: state.communityCards.map((card) => ({ ...card })),
    deck: state.deck.map((card) => ({ ...card })),
    players: state.players.map((player) => ({
      ...player,
      holeCards: player.holeCards.map((card) => ({ ...card })),
    })),
    actionLog: state.actionLog.map((entry) => ({ ...entry })),
    sidePots: state.sidePots.map((pot) => ({ ...pot })),
    awards: state.awards.map((award) => ({ ...award })),
    showdownEvaluations: { ...state.showdownEvaluations },
  };
}

export function comparePlayerHands(
  a: { hand: ReturnType<typeof evaluateSevenCards> },
  b: { hand: ReturnType<typeof evaluateSevenCards> },
): number {
  return compareEvaluations(a.hand, b.hand);
}
