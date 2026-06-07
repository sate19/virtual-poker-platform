import { describe, expect, it } from "vitest";
import type { PokerGameState } from "@friends-poker/poker-engine";
import { getAutomaticTimeoutAction, reconcileActionClock } from "../src/actionClock";

function game(overrides: Partial<PokerGameState> = {}): PokerGameState {
  return {
    handId: "hand-1",
    phase: "flop",
    smallBlind: 5,
    bigBlind: 10,
    ante: 0,
    buttonSeatIndex: 0,
    smallBlindSeatIndex: 1,
    bigBlindSeatIndex: 2,
    currentTurnUserId: "u1",
    currentBet: 20,
    minRaise: 10,
    communityCards: [],
    deck: [],
    players: [
      {
        userId: "u1",
        displayName: "玩家一",
        seatIndex: 0,
        startingStack: 100,
        stack: 80,
        status: "active",
        ready: true,
        holeCards: [],
        committedThisStreet: 10,
        totalCommitted: 20,
        actedThisStreet: false,
      },
      {
        userId: "u2",
        displayName: "玩家二",
        seatIndex: 1,
        startingStack: 100,
        stack: 70,
        status: "active",
        ready: true,
        holeCards: [],
        committedThisStreet: 20,
        totalCommitted: 30,
        actedThisStreet: true,
      },
    ],
    actionLog: [],
    sidePots: [],
    awards: [],
    showdownEvaluations: {},
    handNumber: 1,
    ...overrides,
  };
}

describe("action clock", () => {
  it("folds automatically when the current player faces a bet", () => {
    expect(getAutomaticTimeoutAction(game())).toEqual({ type: "fold" });
  });

  it("checks automatically when no chips are required to continue", () => {
    expect(
      getAutomaticTimeoutAction(
        game({
          currentBet: 10,
          players: game().players.map((player) =>
            player.userId === "u1" ? { ...player, committedThisStreet: 10 } : player,
          ),
        }),
      ),
    ).toEqual({ type: "check" });
  });

  it("creates, keeps, and resets deadlines only when the turn changes or expires", () => {
    const state = game();
    const now = new Date("2026-06-06T12:00:00.000Z");

    expect(reconcileActionClock(state, 30, now)).toBe(true);
    expect(state.actionClock).toMatchObject({
      userId: "u1",
      startedAt: "2026-06-06T12:00:00.000Z",
      deadlineAt: "2026-06-06T12:00:30.000Z",
      timeoutSeconds: 30,
    });

    expect(reconcileActionClock(state, 30, new Date("2026-06-06T12:00:10.000Z"))).toBe(false);
    state.currentTurnUserId = "u2";
    expect(reconcileActionClock(state, 30, new Date("2026-06-06T12:00:11.000Z"))).toBe(true);
    expect(state.actionClock?.userId).toBe("u2");
  });
});
