import { describe, expect, it } from "vitest";
import { applyAction, getLegalActions, getPublicGameStateForUser, startHand } from "../src";

function fixedRandom(): () => number {
  return () => 0.42;
}

const basePlayers = [
  { userId: "u1", displayName: "玩家一", seatIndex: 0, stack: 1000, ready: true },
  { userId: "u2", displayName: "玩家二", seatIndex: 3, stack: 1000, ready: true },
  { userId: "u3", displayName: "玩家三", seatIndex: 6, stack: 1000, ready: true },
];

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

  it("supports all-in and produces a finished showdown with awards", () => {
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

    expect(state.phase).toBe("finished");
    expect(state.communityCards).toHaveLength(5);
    expect(state.sidePots.length).toBeGreaterThanOrEqual(1);
    expect(state.awards.length).toBeGreaterThanOrEqual(1);
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
