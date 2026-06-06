import { describe, expect, it } from "vitest";
import { awardSidePots, buildSidePots, evaluateSevenCards, parseCards } from "../src";
import type { PotParticipant } from "../src";

const hand = (cards: string[]) => evaluateSevenCards(parseCards(cards));

const royal = hand(["As", "Ks", "Qs", "Js", "Ts", "2d", "3c"]);
const quads = hand(["Ah", "Ad", "Ac", "As", "9d", "2c", "3s"]);
const pair = hand(["Kh", "Kd", "9c", "8s", "7h", "2d", "3c"]);
const high = hand(["Ah", "Kd", "9c", "8s", "7h", "2d", "3c"]);

describe("side pots", () => {
  it("builds a simple all-in pot for two players", () => {
    const pots = buildSidePots([
      { userId: "a", committed: 100, folded: false, seatIndex: 1 },
      { userId: "b", committed: 100, folded: false, seatIndex: 2 },
    ]);

    expect(pots).toEqual([
      {
        id: "pot-1",
        amount: 200,
        contributorIds: ["a", "b"],
        eligiblePlayerIds: ["a", "b"],
        level: 100,
      },
    ]);
  });

  it("builds multiple side pots for uneven three-way all-in", () => {
    const pots = buildSidePots([
      { userId: "a", committed: 50, folded: false, seatIndex: 1 },
      { userId: "b", committed: 100, folded: false, seatIndex: 2 },
      { userId: "c", committed: 250, folded: false, seatIndex: 3 },
    ]);

    expect(pots.map((pot) => pot.amount)).toEqual([150, 100, 150]);
    expect(pots.map((pot) => pot.eligiblePlayerIds)).toEqual([["a", "b", "c"], ["b", "c"], ["c"]]);
  });

  it("keeps folded player chips in the pot but removes eligibility", () => {
    const pots = buildSidePots([
      { userId: "a", committed: 100, folded: true, seatIndex: 1 },
      { userId: "b", committed: 100, folded: false, seatIndex: 2 },
      { userId: "c", committed: 200, folded: false, seatIndex: 3 },
    ]);

    expect(pots[0]!.amount).toBe(300);
    expect(pots[0]!.eligiblePlayerIds).toEqual(["b", "c"]);
    expect(pots[1]!.eligiblePlayerIds).toEqual(["c"]);
  });

  it("awards different winners for main and side pots", () => {
    const participants: PotParticipant[] = [
      { userId: "a", committed: 50, folded: false, seatIndex: 1, hand: royal },
      { userId: "b", committed: 100, folded: false, seatIndex: 2, hand: pair },
      { userId: "c", committed: 100, folded: false, seatIndex: 3, hand: quads },
    ];
    const pots = buildSidePots(participants);
    const { awards, payouts } = awardSidePots(pots, participants, 0);

    expect(awards[0]!.winnerIds).toEqual(["a"]);
    expect(awards[1]!.winnerIds).toEqual(["c"]);
    expect(payouts).toEqual({ a: 150, b: 0, c: 100 });
  });

  it("splits pots and assigns odd chip to first winner left of button", () => {
    const participants: PotParticipant[] = [
      { userId: "a", committed: 101, folded: false, seatIndex: 1, hand: high },
      { userId: "b", committed: 101, folded: false, seatIndex: 2, hand: high },
      { userId: "c", committed: 101, folded: false, seatIndex: 3, hand: pair },
    ];
    const pots = buildSidePots(participants);
    const { payouts } = awardSidePots(pots, participants, 9);

    expect(payouts).toEqual({ a: 0, b: 0, c: 303 });

    const tied: PotParticipant[] = [
      { userId: "a", committed: 101, folded: false, seatIndex: 1, hand: high },
      { userId: "b", committed: 101, folded: false, seatIndex: 2, hand: high },
    ];
    const split = awardSidePots(buildSidePots(tied), tied, 0);
    expect(split.payouts).toEqual({ a: 101, b: 101 });

    const odd: PotParticipant[] = [
      { userId: "a", committed: 101, folded: false, seatIndex: 1, hand: high },
      { userId: "b", committed: 100, folded: false, seatIndex: 2, hand: high },
    ];
    const oddResult = awardSidePots(buildSidePots(odd), odd, 0);
    expect(oddResult.payouts.a).toBe(101);
    expect(oddResult.payouts.b).toBe(100);
  });
});
