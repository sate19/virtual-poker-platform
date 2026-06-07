import { describe, expect, it } from "vitest";
import {
  advanceRunoutReveal,
  applyAction,
  chooseRunout,
  getLegalActions,
  getPublicGameStateForUser,
  parseCards,
  startHand,
  type PokerGameState,
} from "../src";

function fixedRandom(): () => number {
  return () => 0.42;
}

const basePlayers = [
  { userId: "u1", displayName: "玩家一", seatIndex: 0, stack: 1000, ready: true },
  { userId: "u2", displayName: "玩家二", seatIndex: 3, stack: 1000, ready: true },
  { userId: "u3", displayName: "玩家三", seatIndex: 6, stack: 1000, ready: true },
];

function revealAll(state: PokerGameState): PokerGameState {
  let next = state;
  let guard = 20;
  while (next.phase === "revealing" && guard > 0) {
    next = advanceRunoutReveal(next);
    guard -= 1;
  }
  return next;
}

describe("game state machine", () => {
  it("posts blinds and starts preflop at the seat after big blind", () => {
    const state = startHand({
      handId: "h1",
      players: basePlayers,
      smallBlind: 5,
      bigBlind: 10,
      random: fixedRandom(),
    });

    expect(state.buttonSeatIndex).toBe(0);
    expect(state.smallBlindSeatIndex).toBe(3);
    expect(state.bigBlindSeatIndex).toBe(6);
    expect(state.currentTurnUserId).toBe("u1");
    expect(state.players.find((player) => player.userId === "u2")!.totalCommitted).toBe(5);
    expect(state.players.find((player) => player.userId === "u3")!.totalCommitted).toBe(10);
  });

  it("posts antes without counting them as current street calls", () => {
    const state = startHand({
      handId: "h1",
      players: basePlayers,
      smallBlind: 5,
      bigBlind: 10,
      ante: 2,
      random: fixedRandom(),
    });

    expect(state.ante).toBe(2);
    expect(state.currentBet).toBe(10);
    expect(state.players.find((player) => player.userId === "u1")!.totalCommitted).toBe(2);
    expect(state.players.find((player) => player.userId === "u1")!.committedThisStreet).toBe(0);
    expect(state.players.find((player) => player.userId === "u2")!.totalCommitted).toBe(7);
    expect(state.players.find((player) => player.userId === "u2")!.committedThisStreet).toBe(5);
    expect(state.actionLog.filter((entry) => entry.action === "post-ante")).toHaveLength(3);
  });

  it("rejects users acting out of turn or spectators acting", () => {
    const state = startHand({
      handId: "h1",
      players: basePlayers,
      smallBlind: 5,
      bigBlind: 10,
      random: fixedRandom(),
    });

    expect(() => applyAction(state, "u2", { type: "fold" })).toThrow("还没有轮到该玩家行动");
    expect(() => applyAction(state, "spectator", { type: "fold" })).toThrow("还没有轮到该玩家行动");
  });

  it("advances betting rounds and allows fold win immediately", () => {
    let state = startHand({
      handId: "h1",
      players: basePlayers,
      smallBlind: 5,
      bigBlind: 10,
      random: fixedRandom(),
    });
    state = applyAction(state, "u1", { type: "call" });
    state = applyAction(state, "u2", { type: "call" });
    state = applyAction(state, "u3", { type: "check" });

    expect(state.phase).toBe("flop");
    expect(state.communityCards).toHaveLength(3);

    const first = state.currentTurnUserId!;
    state = applyAction(state, first, { type: "bet", amount: 20 });
    while (state.phase !== "finished") {
      state = applyAction(state, state.currentTurnUserId!, { type: "fold" });
    }
    expect(state.phase).toBe("finished");
    expect(state.awards[0]!.winnerIds).toEqual([first]);
  });

  it("supports all-in and lets eligible players choose a single runout", () => {
    let state = startHand({
      handId: "h1",
      players: basePlayers.map((player, index) => ({ ...player, stack: index === 0 ? 30 : 100 })),
      smallBlind: 5,
      bigBlind: 10,
      random: fixedRandom(),
    });
    state = applyAction(state, "u1", { type: "all-in" });
    state = applyAction(state, "u2", { type: "all-in" });
    state = applyAction(state, "u3", { type: "call" });

    expect(state.phase).toBe("runout");
    expect(state.runoutSelection?.eligiblePlayerIds).toEqual(["u1", "u2", "u3"]);
    state = chooseRunout(state, "u1", "once");

    expect(state.phase).toBe("revealing");
    expect(state.runoutBoards?.[0]?.cards).toHaveLength(0);
    expect(state.runoutBoards?.[0]?.equities).toHaveLength(3);
    const publicState = getPublicGameStateForUser(state, "u1");
    expect("runoutPlan" in publicState).toBe(false);
    expect(publicState.players.find((player) => player.userId === "u2")!.holeCards).toHaveLength(2);
    state = advanceRunoutReveal(state);
    expect(state.phase).toBe("revealing");
    expect(state.communityCards).toHaveLength(1);
    state = revealAll(state);

    expect(state.phase).toBe("finished");
    expect(state.communityCards).toHaveLength(5);
    expect(state.sidePots.length).toBeGreaterThanOrEqual(1);
    expect(state.awards.length).toBeGreaterThanOrEqual(1);
  });

  it("runs it twice and splits multi-way side pots per board", () => {
    let state = startHand({
      handId: "h1",
      players: basePlayers.map((player, index) => ({ ...player, stack: [30, 60, 100][index]! })),
      smallBlind: 5,
      bigBlind: 10,
      random: fixedRandom(),
    });
    state.players.find((player) => player.userId === "u1")!.holeCards = parseCards(["As", "Ah"]);
    state.players.find((player) => player.userId === "u2")!.holeCards = parseCards(["Kd", "Kh"]);
    state.players.find((player) => player.userId === "u3")!.holeCards = parseCards(["Qd", "Qh"]);
    state.deck = parseCards([
      "2c",
      "Ac",
      "7d",
      "8d",
      "3c",
      "4s",
      "5c",
      "9h",
      "2d",
      "Ks",
      "7c",
      "8c",
      "3d",
      "4h",
      "5d",
      "9s",
    ]);

    state = applyAction(state, "u1", { type: "all-in" });
    state = applyAction(state, "u2", { type: "all-in" });
    state = applyAction(state, "u3", { type: "call" });

    expect(state.phase).toBe("runout");
    expect(state.sidePots).toEqual([]);

    state = chooseRunout(state, "u1", "twice");
    expect(state.phase).toBe("runout");
    state = chooseRunout(state, "u2", "twice");
    expect(state.phase).toBe("runout");
    state = chooseRunout(state, "u3", "twice");

    expect(state.phase).toBe("revealing");
    expect(state.runoutMode).toBe("twice");
    expect(state.runoutBoards).toHaveLength(2);
    expect(state.sidePots.map((pot) => pot.amount)).toEqual([90, 60]);
    state = advanceRunoutReveal(state);
    expect(state.runoutBoards?.[0]?.cards).toHaveLength(1);
    expect(state.runoutBoards?.[0]?.equities).toHaveLength(3);
    expect(state.runoutBoards?.[1]?.cards).toHaveLength(0);
    state = revealAll(state);

    expect(state.phase).toBe("finished");
    expect(state.runoutMode).toBe("twice");
    expect(state.runoutBoards).toHaveLength(2);
    expect(state.sidePots.map((pot) => pot.amount)).toEqual([90, 60]);
    expect(state.awards.reduce((sum, award) => sum + award.amount, 0)).toBe(150);
    expect(state.players.map((player) => [player.userId, player.stack])).toEqual([
      ["u1", 45],
      ["u2", 105],
      ["u3", 40],
    ]);
  });

  it("masks private state for other users and spectators", () => {
    const state = startHand({
      handId: "h1",
      players: basePlayers,
      smallBlind: 5,
      bigBlind: 10,
      random: fixedRandom(),
    });

    const forUser = getPublicGameStateForUser(state, "u1");
    const forSpectator = getPublicGameStateForUser(state);

    expect(forUser.players.find((player) => player.userId === "u1")!.holeCards).toHaveLength(2);
    expect(forUser.players.find((player) => player.userId === "u2")!.holeCards).toBeUndefined();
    expect(forSpectator.players.every((player) => player.holeCards === undefined)).toBe(true);
    expect("deck" in forUser).toBe(false);
  });

  it("exposes legal actions for current player only", () => {
    const state = startHand({
      handId: "h1",
      players: basePlayers,
      smallBlind: 5,
      bigBlind: 10,
      random: fixedRandom(),
    });

    expect(getLegalActions(state, "u1").map((action) => action.type)).toContain("call");
    expect(getLegalActions(state, "u2")).toEqual([]);
  });
});
