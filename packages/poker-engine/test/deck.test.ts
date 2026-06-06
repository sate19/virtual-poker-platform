import { describe, expect, it } from "vitest";
import { cardToString, createDeck, dealOne, shuffleDeck } from "../src";

describe("deck", () => {
  it("creates a standard 52-card deck with unique cards", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardToString)).size).toBe(52);
  });

  it("shuffles without losing or duplicating cards", () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck, () => 0.13);
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map(cardToString))).toEqual(new Set(deck.map(cardToString)));
  });

  it("deals one card and reduces the deck", () => {
    const deck = createDeck();
    const { card, deck: rest } = dealOne(deck);
    expect(cardToString(card)).toBe(cardToString(deck[0]!));
    expect(rest).toHaveLength(51);
  });
});
