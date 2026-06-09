import { createDeck, dealOne, shuffleDeck } from "./cards";
import { compareEvaluations, evaluateSevenCards } from "./handEvaluator";
import { awardSidePots, buildSidePots } from "./sidePots";
import type {
  Card,
  EnginePlayer,
  GameActionLogEntry,
  HandEvaluation,
  PotAward,
  PokerAction,
  PokerGameState,
  PublicPokerGameState,
  RunoutBoard,
  RunoutEquity,
  RunoutMode,
  RunoutPlan,
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
  ante?: number;
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
    ante: input.ante ?? 0,
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

  postAntes(state, input.ante ?? 0);
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

export function chooseRunout(state: PokerGameState, userId: string, mode: RunoutMode): PokerGameState {
  const next = cloneState(state);
  if (next.phase !== "runout" || !next.runoutSelection) {
    throw new Error("当前牌局不需要选择发牌次数");
  }
  if (!next.runoutSelection.eligiblePlayerIds.includes(userId)) {
    throw new Error("只有仍参与摊牌的玩家可以选择发牌次数");
  }

  next.runoutSelection.votes[userId] = mode;
  log(next, userId, mode === "twice" ? "run-it-twice-vote" : "run-it-once");

  if (mode === "once") {
    return startRunoutReveal(next, "once");
  }

  const allAcceptedTwice = next.runoutSelection.eligiblePlayerIds.every(
    (playerId) => next.runoutSelection?.votes[playerId] === "twice",
  );
  return allAcceptedTwice ? startRunoutReveal(next, "twice") : next;
}

export function advanceRunoutReveal(state: PokerGameState): PokerGameState {
  const next = cloneState(state);
  if (next.phase !== "revealing") {
    throw new Error("当前牌局不在逐张发牌阶段");
  }
  if (!next.runoutBoards?.length || !next.runoutPlan?.length) {
    return finalizeRunout(next);
  }

  const board = next.runoutBoards.find((item) => !item.isComplete && item.cards.length < 5);
  if (!board) {
    return finalizeRunout(next);
  }

  const plan = next.runoutPlan.find((item) => item.id === board.id);
  const card = plan?.cards[board.cards.length];
  if (card) {
    board.cards.push({ ...card });
    log(next, undefined, `runout-card-${board.id}`);
  }
  board.isComplete = board.cards.length >= 5;
  next.communityCards = next.runoutBoards[0]?.cards.map((item) => ({ ...item })) ?? [];

  if (next.runoutBoards.every((item) => item.isComplete || item.cards.length >= 5)) {
    return finalizeRunout(next);
  }

  updateRunoutEquities(next);
  return next;
}

export function getPublicGameStateForUser(
  state: PokerGameState,
  userId?: string,
): PublicPokerGameState {
  const canShowdown =
    state.phase === "showdown" || state.phase === "runout" || state.phase === "revealing" || state.phase === "finished";
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
    ante: state.ante,
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
      startingStack: player.startingStack,
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
    actionClock: state.actionClock ? { ...state.actionClock } : undefined,
    runoutSelection: state.runoutSelection
      ? {
          ...state.runoutSelection,
          eligiblePlayerIds: [...state.runoutSelection.eligiblePlayerIds],
          votes: { ...state.runoutSelection.votes },
        }
      : undefined,
    runoutMode: state.runoutMode,
    runoutBoards: canShowdown
      ? state.runoutBoards?.map((board) => ({
          ...board,
          cards: board.cards.map((card) => ({ ...card })),
          awards: board.awards.map((award) => ({ ...award })),
          payouts: { ...board.payouts },
          showdownEvaluations: { ...board.showdownEvaluations },
          equities: board.equities?.map((equity) => ({ ...equity })),
          isComplete: board.isComplete,
        }))
      : undefined,
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

  if (shouldResolveWithoutFurtherBetting(state)) {
    return beginRunoutOrShowdown(state);
  }

  if (state.phase === "river") {
    return finishByShowdown(state);
  }

  advanceStreet(state);
  if (shouldResolveWithoutFurtherBetting(state)) {
    return beginRunoutOrShowdown(state);
  }
  state.currentTurnUserId = nextActionUserId(
    state,
    nextOccupiedSeat(state.buttonSeatIndex, occupiedSeats(state)),
  );
  return state;
}

function shouldResolveWithoutFurtherBetting(state: PokerGameState): boolean {
  const remaining = state.players.filter((player) => player.status !== "folded");
  const actionable = remaining.filter((player) => player.status !== "all-in" && player.stack > 0);
  return remaining.length > 1 && remaining.some((player) => player.status === "all-in") && actionable.length <= 1;
}

function beginRunoutOrShowdown(state: PokerGameState): PokerGameState {
  if (state.communityCards.length >= 5) {
    return finishByShowdown(state);
  }

  const eligiblePlayerIds = state.players
    .filter((player) => player.status !== "folded")
    .map((player) => player.userId);
  state.phase = "runout";
  state.currentTurnUserId = undefined;
  delete state.actionClock;
  state.runoutSelection = {
    eligiblePlayerIds,
    votes: {},
    remainingCards: 5 - state.communityCards.length,
    startedAt: new Date().toISOString(),
  };
  log(state, undefined, "runout-selection");
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
  delete state.runoutSelection;
  delete state.runoutMode;
  delete state.runoutBoards;
  delete state.runoutPlan;
  log(state, winnerId, "win-by-fold", potAmount);
  return state;
}

function finishByShowdown(state: PokerGameState): PokerGameState {
  return startRunoutReveal(state, "once");
}

function startRunoutReveal(state: PokerGameState, mode: RunoutMode): PokerGameState {
  const boardCount = mode === "twice" ? 2 : 1;
  const baseCommunityCards = state.communityCards.map((card) => ({ ...card }));
  let deck = state.deck;
  const runoutPlan: RunoutPlan[] = [];
  const runoutBoards: RunoutBoard[] = [];

  for (let boardIndex = 0; boardIndex < boardCount; boardIndex += 1) {
    const boardId = `board-${boardIndex + 1}`;
    const dealt = dealBoardRunout(deck, baseCommunityCards);
    deck = dealt.deck;
    runoutPlan.push({ id: boardId, cards: dealt.cards.map((card) => ({ ...card })) });
    runoutBoards.push({
      id: boardId,
      cards: baseCommunityCards.map((card) => ({ ...card })),
      awards: [],
      payouts: Object.fromEntries(state.players.map((player) => [player.userId, 0])),
      showdownEvaluations: {},
      equities: [],
      isComplete: baseCommunityCards.length >= 5,
    });
  }

  state.deck = deck;
  state.sidePots = buildSidePots(getPotParticipants(state));
  state.runoutMode = mode;
  state.runoutPlan = runoutPlan;
  state.runoutBoards = runoutBoards;
  state.communityCards = runoutBoards[0]?.cards.map((card) => ({ ...card })) ?? baseCommunityCards;
  state.currentTurnUserId = undefined;
  delete state.actionClock;
  delete state.runoutSelection;

  if (baseCommunityCards.length >= 5) {
    return finalizeRunout(state);
  }

  state.phase = "revealing";
  updateRunoutEquities(state);
  log(state, undefined, mode === "twice" ? "runout-reveal-twice" : "runout-reveal-once");
  return state;
}

function finalizeRunout(state: PokerGameState): PokerGameState {
  const runoutBoards = state.runoutBoards?.length
    ? state.runoutBoards
    : [
        {
          id: "board-1",
          cards: state.communityCards.map((card) => ({ ...card })),
          awards: [],
          payouts: Object.fromEntries(state.players.map((player) => [player.userId, 0])),
          showdownEvaluations: {},
          equities: [],
          isComplete: true,
        },
      ];
  const boardCount = runoutBoards.length;
  const baseParticipants = getPotParticipants(state);
  const sidePots = state.sidePots.length > 0 ? state.sidePots : buildSidePots(baseParticipants);
  const totalPayouts: Record<string, number> = Object.fromEntries(state.players.map((player) => [player.userId, 0]));
  const flattenedAwards: PotAward[] = [];

  for (let boardIndex = 0; boardIndex < boardCount; boardIndex += 1) {
    const board = runoutBoards[boardIndex]!;
    const plan = state.runoutPlan?.find((item) => item.id === board.id);
    const completeCards = (plan?.cards ?? board.cards).slice(0, 5).map((card) => ({ ...card }));
    board.cards = completeCards;
    board.isComplete = true;

    const showdownEvaluations: Record<string, HandEvaluation> = Object.fromEntries(
      state.players
        .filter((player) => player.status !== "folded")
        .map((player) => [player.userId, evaluateSevenCards([...player.holeCards, ...completeCards])]),
    );
    const participants = baseParticipants.map((player) => ({
      ...player,
      hand: player.folded ? undefined : showdownEvaluations[player.userId],
    }));
    const boardPots = sidePots
      .map((pot) => ({
        ...pot,
        amount: splitAmountForBoard(pot.amount, boardIndex, boardCount),
      }))
      .filter((pot) => pot.amount > 0);
    const { awards, payouts } = awardSidePots(boardPots, participants, state.buttonSeatIndex);
    const boardAwards = awards.map((award) => ({ ...award, boardId: board.id }));

    for (const player of state.players) {
      totalPayouts[player.userId] = (totalPayouts[player.userId] ?? 0) + (payouts[player.userId] ?? 0);
    }
    flattenedAwards.push(
      ...boardAwards.map((award) => ({
        ...award,
        potId: `${board.id}:${award.potId}`,
      })),
    );
    board.awards = boardAwards;
    board.payouts = payouts;
    board.showdownEvaluations = showdownEvaluations;
    board.equities = finalEquitiesForBoard(state, completeCards);
  }

  state.communityCards = runoutBoards[0]?.cards.map((card) => ({ ...card })) ?? state.communityCards;
  state.sidePots = sidePots;
  state.awards = flattenedAwards;
  state.showdownEvaluations = runoutBoards[0]?.showdownEvaluations ?? {};
  state.runoutBoards = runoutBoards;
  delete state.runoutSelection;
  delete state.runoutPlan;

  for (const player of state.players) {
    player.stack += totalPayouts[player.userId] ?? 0;
  }
  state.phase = "finished";
  state.currentTurnUserId = undefined;
  delete state.actionClock;
  log(state, undefined, state.runoutMode === "twice" ? "showdown-run-twice" : "showdown");
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

function postAntes(state: PokerGameState, amount: number): void {
  const ante = Math.max(0, Math.floor(amount));
  if (ante === 0) {
    return;
  }
  for (const player of state.players) {
    const committed = commitAnte(player, ante);
    if (committed > 0) {
      log(state, player.userId, "post-ante", committed);
    }
  }
}

function commitAnte(player: EnginePlayer, amount: number): number {
  const committed = Math.min(player.stack, Math.max(0, Math.floor(amount)));
  player.stack -= committed;
  player.totalCommitted += committed;
  if (player.stack === 0) {
    player.status = "all-in";
    player.actedThisStreet = true;
  }
  return committed;
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

function dealBoardRunout(deck: Card[], baseCommunityCards: Card[]): { cards: Card[]; deck: Card[] } {
  let nextDeck = deck;
  const cards = baseCommunityCards.map((card) => ({ ...card }));
  while (cards.length < 5) {
    const count = cards.length < 3 ? 3 : 1;
    const burn = dealOne(nextDeck);
    nextDeck = burn.deck;
    for (let i = 0; i < count; i += 1) {
      const result = dealOne(nextDeck);
      cards.push(result.card);
      nextDeck = result.deck;
    }
  }
  return { cards, deck: nextDeck };
}

function getPotParticipants(state: PokerGameState): Array<{
  userId: string;
  committed: number;
  folded: boolean;
  seatIndex: number;
}> {
  return state.players.map((player) => ({
    userId: player.userId,
    committed: player.totalCommitted,
    folded: player.status === "folded",
    seatIndex: player.seatIndex,
  }));
}

function updateRunoutEquities(state: PokerGameState): void {
  for (const board of state.runoutBoards ?? []) {
    board.isComplete = board.cards.length >= 5;
    board.equities = calculateRunoutEquities(state, board.cards);
  }
}

function finalEquitiesForBoard(state: PokerGameState, boardCards: Card[]): RunoutEquity[] {
  return calculateRunoutEquities(state, boardCards.slice(0, 5));
}

function calculateRunoutEquities(state: PokerGameState, boardCards: Card[]): RunoutEquity[] {
  const players = state.players.filter((player) => player.status !== "folded" && player.holeCards.length === 2);
  if (players.length === 0) {
    return [];
  }

  const missingCards = Math.max(0, 5 - boardCards.length);
  const counters: Record<string, { wins: number; ties: number }> = Object.fromEntries(
    players.map((player) => [player.userId, { wins: 0, ties: 0 }]),
  );
  let samples = 0;
  const score = (completion: Card[]) => {
    samples += 1;
    const completeBoard = [...boardCards, ...completion];
    const evaluations = players.map((player) => ({
      userId: player.userId,
      hand: evaluateSevenCards([...player.holeCards, ...completeBoard]),
    }));
    let winners = [evaluations[0]!];
    for (const evaluation of evaluations.slice(1)) {
      const comparison = compareEvaluations(evaluation.hand, winners[0]!.hand);
      if (comparison > 0) {
        winners = [evaluation];
      } else if (comparison === 0) {
        winners.push(evaluation);
      }
    }
    for (const winner of winners) {
      if (winners.length === 1) {
        counters[winner.userId]!.wins += 1;
      } else {
        counters[winner.userId]!.ties += 1;
      }
    }
  };

  if (missingCards === 0) {
    score([]);
  } else {
    const deadCards = new Set(
      [...boardCards, ...players.flatMap((player) => player.holeCards)].map((card) => cardKey(card)),
    );
    const unknownCards = createDeck().filter((card) => !deadCards.has(cardKey(card)));
    const exactCount = combinationCount(unknownCards.length, missingCards);
    if (exactCount <= 2500) {
      visitCombinations(unknownCards, missingCards, score);
    } else {
      const sampleCount = 2000;
      const random = seededRandom(`${state.handId}:${boardCards.map(cardKey).join(",")}:${missingCards}`);
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        score(sampleDistinctCards(unknownCards, missingCards, random));
      }
    }
  }

  return players.map((player) => ({
    userId: player.userId,
    winPercent: roundPercent((counters[player.userId]!.wins / samples) * 100),
    tiePercent: roundPercent((counters[player.userId]!.ties / samples) * 100),
    samples,
  }));
}

function visitCombinations(cards: Card[], count: number, callback: (combo: Card[]) => void): void {
  const combo: Card[] = [];
  const visit = (startIndex: number) => {
    if (combo.length === count) {
      callback(combo.map((card) => ({ ...card })));
      return;
    }
    const remaining = count - combo.length;
    for (let index = startIndex; index <= cards.length - remaining; index += 1) {
      combo.push(cards[index]!);
      visit(index + 1);
      combo.pop();
    }
  };
  visit(0);
}

function sampleDistinctCards(cards: Card[], count: number, random: () => number): Card[] {
  const pool = cards.map((card) => ({ ...card }));
  for (let index = 0; index < count; index += 1) {
    const swapIndex = index + Math.floor(random() * (pool.length - index));
    [pool[index], pool[swapIndex]] = [pool[swapIndex]!, pool[index]!];
  }
  return pool.slice(0, count);
}

function combinationCount(total: number, count: number): number {
  if (count < 0 || count > total) {
    return 0;
  }
  let result = 1;
  const normalizedCount = Math.min(count, total - count);
  for (let index = 1; index <= normalizedCount; index += 1) {
    result = (result * (total - normalizedCount + index)) / index;
  }
  return result;
}

function seededRandom(seed: string): () => number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6d2b79f5;
    let mixed = hash;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

function splitAmountForBoard(amount: number, boardIndex: number, boardCount: number): number {
  return Math.floor(amount / boardCount) + (boardIndex < amount % boardCount ? 1 : 0);
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
    actionClock: state.actionClock ? { ...state.actionClock } : undefined,
    runoutSelection: state.runoutSelection
      ? {
          ...state.runoutSelection,
          votes: { ...state.runoutSelection.votes },
          eligiblePlayerIds: [...state.runoutSelection.eligiblePlayerIds],
        }
      : undefined,
    runoutMode: state.runoutMode,
    runoutBoards: state.runoutBoards?.map((board) => ({
      ...board,
      cards: board.cards.map((card) => ({ ...card })),
      awards: board.awards.map((award) => ({ ...award })),
      payouts: { ...board.payouts },
      showdownEvaluations: { ...board.showdownEvaluations },
      equities: board.equities?.map((equity) => ({ ...equity })),
      isComplete: board.isComplete,
    })),
    runoutPlan: state.runoutPlan?.map((plan) => ({
      id: plan.id,
      cards: plan.cards.map((card) => ({ ...card })),
    })),
  };
}

export function comparePlayerHands(
  a: { hand: ReturnType<typeof evaluateSevenCards> },
  b: { hand: ReturnType<typeof evaluateSevenCards> },
): number {
  return compareEvaluations(a.hand, b.hand);
}

export function rabbitHunt(state: PokerGameState): Card[] {
  const deck = [...state.deck];
  const dealt = state.communityCards.length;
  if (dealt >= 5) return [];

  const cards: Card[] = [];
  // Deck order after dealing: [future burns + cards]
  // Skip burn, then take the card(s) for each remaining street
  const remaining = 5 - dealt;
  let di = 0;

  for (let needed = remaining; needed > 0; needed--) {
    di++; // skip burn
    if (di < deck.length) {
      cards.push(deck[di]!);
      di++;
    }
  }

  return cards;
}
