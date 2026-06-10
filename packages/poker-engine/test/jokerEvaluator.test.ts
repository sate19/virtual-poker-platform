import { describe, expect, it } from "vitest";
import {
  BIG_JOKER_RANKS,
  SMALL_JOKER_RANKS,
  evaluateHand,
  evaluateSevenCards,
  evaluateSevenCardsPure,
  parseCard,
  parseCards,
} from "../src";
import {
  BIG_JOKER,
  SMALL_JOKER,
  isJoker,
  expandJokers,
} from "../src/dlc/royal-war";

describe("joker utilities", () => {
  it("identifies jokers correctly", () => {
    expect(isJoker(BIG_JOKER)).toBe(true);
    expect(isJoker(SMALL_JOKER)).toBe(true);
    expect(isJoker({ rank: "A", suit: "s" })).toBe(false);
  });

  it("parses joker card strings", () => {
    expect(parseCard("Rx")).toEqual(BIG_JOKER);
    expect(parseCard("Bx")).toEqual(SMALL_JOKER);
  });

  it("verify joker ranges", () => {
    expect(BIG_JOKER_RANKS).toEqual(["9", "T", "J", "Q", "K", "A"]);
    expect(SMALL_JOKER_RANKS).toEqual(["2", "3", "4", "5", "6", "7", "8"]);
  });
});

describe("evaluateHand with jokers", () => {
  it("standard 7-card hand (no jokers) works correctly — regression", () => {
    const hand = parseCards(["As", "Ks", "Qs", "Js", "Ts", "2d", "3c"]);
    expect(evaluateSevenCards(hand).category).toBe("Royal Flush");
    expect(evaluateHand(hand)?.category).toBe("Royal Flush");
  });

  it("Big Joker + K-Q-J-T-x-x makes Ace-high straight", () => {
    const hand = [...parseCards(["Ks", "Qh", "Jd", "Tc", "2d", "3c"]), BIG_JOKER];
    const result = evaluateSevenCards(hand);
    expect(result.category).toBe("Straight");
    expect(result.ranks[0]).toBe(14);
  });

  it("Small Joker + A-2-3-4-x-x makes wheel straight (5-high)", () => {
    const hand = [...parseCards(["As", "2h", "3d", "4c", "9d", "Tc"]), SMALL_JOKER];
    const result = evaluateSevenCards(hand);
    expect(result.category).toBe("Straight");
    expect(result.ranks[0]).toBe(5);
  });

  it("Big Joker cannot complete A-2-3-4 wheel", () => {
    const hand = [...parseCards(["As", "2h", "3d", "4c", "9d", "Tc"]), BIG_JOKER];
    const result = evaluateSevenCards(hand);
    // Big joker is 9-A, can't be 5. No straight possible.
    expect(result.category).not.toBe("Straight");
  });

  it("Big Joker + K-K-x-x-x makes three Ks", () => {
    const hand = [...parseCards(["Ks", "Kh", "2d", "3c", "8s", "9d"]), BIG_JOKER];
    const result = evaluateSevenCards(hand);
    expect(result.category).toBe("Three of a Kind");
    expect(result.ranks[0]).toBe(13);
  });

  it("Small Joker + 9-T-J-Q-K makes 8-9-T-J-Q straight (K-high using natural cards)", () => {
    const hand = [...parseCards(["9s", "Th", "Jd", "Qc", "Kd", "2c"]), SMALL_JOKER];
    const result = evaluateSevenCards(hand);
    // Best is K-high straight using 9-T-J-Q-K, joker is just an extra card
    expect(result.category).toBe("Straight");
    expect(result.ranks[0]).toBe(13);
  });

  it("Big Joker + A♥ K♥ Q♥ J♥ 2♦ is NOT a flush", () => {
    const hand = [...parseCards(["Ah", "Kh", "Qh", "Jh", "2d", "3c"]), BIG_JOKER];
    const result = evaluateSevenCards(hand);
    // Joker has no suit, can't complete flush. Best: Ace-high straight.
    expect(result.category).not.toBe("Flush");
    expect(result.category).not.toBe("Straight Flush");
    expect(result.category).toBe("Straight");
  });

  it("Big Joker + K-K-Q-Q = Full House K over Q", () => {
    const hand = [...parseCards(["Ks", "Kh", "Qd", "Qc", "2d", "3c"]), BIG_JOKER];
    const result = evaluateSevenCards(hand);
    expect(result.category).toBe("Full House");
    expect(result.ranks[0]).toBe(13);
  });

  it("Small Joker + 5-5-5 makes four of a kind", () => {
    const hand = [...parseCards(["5s", "5h", "5d", "2c", "3s", "9d"]), SMALL_JOKER];
    const result = evaluateSevenCards(hand);
    expect(result.category).toBe("Four of a Kind");
    expect(result.ranks[0]).toBe(5);
  });

  it("Big Joker cannot be 5 (9-A only)", () => {
    const hand = [...parseCards(["5s", "5h", "5d", "2c", "4s", "6d"]), BIG_JOKER];
    const result = evaluateSevenCards(hand);
    expect(result.category).toBe("Three of a Kind");
  });

  it("Big Joker + Small Joker + T-J-Q makes 8-9-T-J-Q straight", () => {
    const hand = [...parseCards(["Ts", "Jh", "Qd", "2c", "3s"]), BIG_JOKER, SMALL_JOKER];
    const result = evaluateSevenCards(hand);
    expect(result.category).toBe("Straight");
    expect(result.ranks[0]).toBe(12);
  });

  it("evaluateHand works with 5 cards containing a joker", () => {
    const hand = [...parseCards(["Ks", "Qh", "Jd", "Tc"]), BIG_JOKER];
    const result = evaluateHand(hand);
    expect(result?.category).toBe("Straight");
  });

  it("evaluateHand works with 6 cards containing a joker", () => {
    const hand = [...parseCards(["Ks", "Kh", "Qd", "2c", "3s"]), BIG_JOKER];
    const result = evaluateHand(hand);
    expect(result?.category).toBe("Three of a Kind");
  });

  it("evaluateHand returns undefined for < 5 cards", () => {
    expect(evaluateHand([BIG_JOKER])).toBeUndefined();
    expect(evaluateHand(parseCards(["As", "Kh"]))).toBeUndefined();
  });

  it("5 same-suited non-joker cards still form flush (regression)", () => {
    const hand = parseCards(["As", "Ks", "Qs", "Js", "9s", "2d", "3c"]);
    const result = evaluateSevenCards(hand);
    expect(result.category).toBe("Flush");
  });

  it("evaluateSevenCardsPure skips joker logic", () => {
    const hand = parseCards(["As", "Ks", "Qs", "Js", "Ts", "2d", "3c"]);
    expect(evaluateSevenCardsPure(hand).category).toBe("Royal Flush");
  });
});

describe("expandJokers", () => {
  it("returns single result for no-joker combo", () => {
    const cards = parseCards(["As", "Ks", "Qs", "Js", "Ts"]);
    const result = expandJokers(cards);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(cards);
  });

  it("expands Big Joker to 6 possibilities", () => {
    const cards = [...parseCards(["As", "Ks", "Qs", "Js"]), BIG_JOKER];
    const result = expandJokers(cards);
    expect(result).toHaveLength(6);
  });

  it("expands Small Joker to 7 possibilities", () => {
    const cards = [...parseCards(["As", "Ks", "Qs", "Js"]), SMALL_JOKER];
    const result = expandJokers(cards);
    expect(result).toHaveLength(7);
  });

  it("expands 2 jokers to 42 possibilities (6 x 7)", () => {
    const cards = [...parseCards(["As", "Ks", "Qs"]), BIG_JOKER, SMALL_JOKER];
    const result = expandJokers(cards);
    expect(result).toHaveLength(42);
  });

  it("all expanded cards have suit x", () => {
    const cards = [...parseCards(["As", "Ks", "Qs", "Js"]), BIG_JOKER];
    const results = expandJokers(cards);
    for (const hand of results) {
      const jokerCard = hand.find((c) => !parseCards(["As", "Ks", "Qs", "Js"]).some((orig) => orig.rank === c.rank && orig.suit === c.suit));
      if (jokerCard) {
        expect(jokerCard.suit).toBe("x");
      }
    }
  });
});

describe("performance", () => {
  it("evaluates 1000 hands with 2 jokers in under 1000ms", () => {
    const hand = [...parseCards(["As", "Kh", "Qd", "2c", "3s"]), BIG_JOKER, SMALL_JOKER];
    for (let i = 0; i < 10; i += 1) evaluateSevenCards(hand);
    const start = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      evaluateSevenCards(hand);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
