import { describe, expect, it } from "vitest";
import { compareEvaluations, evaluateSevenCards, parseCards } from "../src";

const evaluate = (cards: string[]) => evaluateSevenCards(parseCards(cards));

describe("hand evaluator", () => {
  it("orders all hand categories correctly", () => {
    const hands = [
      evaluate(["As", "Ks", "Qs", "Js", "Ts", "2d", "3c"]),
      evaluate(["9s", "8s", "7s", "6s", "5s", "2d", "3c"]),
      evaluate(["As", "Ah", "Ad", "Ac", "2s", "3d", "4c"]),
      evaluate(["Ks", "Kh", "Kd", "2c", "2s", "3d", "4c"]),
      evaluate(["As", "Js", "8s", "5s", "2s", "3d", "4c"]),
      evaluate(["5s", "4h", "3d", "2c", "As", "9d", "Tc"]),
      evaluate(["Qs", "Qh", "Qd", "2c", "4s", "9d", "Tc"]),
      evaluate(["Js", "Jh", "9d", "9c", "4s", "2d", "Tc"]),
      evaluate(["Ts", "Th", "9d", "5c", "4s", "2d", "Ac"]),
      evaluate(["As", "Kh", "9d", "5c", "4s", "2d", "Tc"]),
    ];

    expect(hands.map((hand) => hand.category)).toEqual([
      "Royal Flush",
      "Straight Flush",
      "Four of a Kind",
      "Full House",
      "Flush",
      "Straight",
      "Three of a Kind",
      "Two Pair",
      "One Pair",
      "High Card",
    ]);
    for (let i = 0; i < hands.length - 1; i += 1) {
      expect(compareEvaluations(hands[i]!, hands[i + 1]!)).toBeGreaterThan(0);
    }
  });

  it("handles A2345 as the lowest straight", () => {
    const wheel = evaluate(["As", "2h", "3d", "4c", "5s", "9d", "Tc"]);
    const sixHigh = evaluate(["2s", "3h", "4d", "5c", "6s", "9d", "Tc"]);

    expect(wheel.category).toBe("Straight");
    expect(wheel.ranks).toEqual([5]);
    expect(compareEvaluations(sixHigh, wheel)).toBeGreaterThan(0);
  });

  it("compares kickers and ties correctly", () => {
    const aceKicker = evaluate(["As", "Ah", "Kd", "8c", "7s", "3d", "2c"]);
    const queenKicker = evaluate(["Ad", "Ac", "Qd", "8h", "7c", "3s", "2d"]);
    const tieOne = evaluate(["Ks", "Kh", "Qd", "8c", "7s", "3d", "2c"]);
    const tieTwo = evaluate(["Kd", "Kc", "Qs", "8h", "7c", "3s", "2d"]);

    expect(compareEvaluations(aceKicker, queenKicker)).toBeGreaterThan(0);
    expect(compareEvaluations(tieOne, tieTwo)).toBe(0);
  });
});
