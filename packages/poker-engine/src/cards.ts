import type { Card, DeckType, Rank, Suit } from "./types";

export const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A", "R", "B"];
export const SUITS: Suit[] = ["s", "h", "d", "c", "x"];
export const STANDARD_RANKS = RANKS.slice(0, 13);
export const STANDARD_SUITS = SUITS.slice(0, 4);

// Joker rank ranges (dlc 兼容)
export const BIG_JOKER_RANKS: Rank[] = ["9", "T", "J", "Q", "K", "A"];
export const SMALL_JOKER_RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8"];

export const RANK_VALUE: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
  R: 15,
  B: 1,
};

export function createDeck(deckType: DeckType = "standard"): Card[] {
  if (deckType === "royal-war") {
    try {
      const mod = require("./dlc/royal-war") as { createRoyalWarDeck(): Card[] };
      return mod.createRoyalWarDeck();
    } catch {
      // DLC folder removed, fall back to standard
    }
  }
  return STANDARD_SUITS.flatMap((suit) => STANDARD_RANKS.map((rank) => ({ rank, suit })));
}

export function shuffleDeck(deck: Card[], random: () => number = Math.random): Card[] {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function dealOne(deck: Card[]): { card: Card; deck: Card[] } {
  const [card, ...rest] = deck;
  if (!card) {
    throw new Error("牌堆已空");
  }
  return { card, deck: rest };
}

export function cardToString(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function parseCard(value: string): Card {
  const rank = value[0] as Rank | undefined;
  const suit = value[1] as Suit | undefined;
  if (!rank || !suit || !RANKS.includes(rank) || !SUITS.includes(suit) || value.length !== 2) {
    throw new Error(`非法牌面: ${value}`);
  }
  return { rank, suit };
}

export function parseCards(values: string[]): Card[] {
  return values.map(parseCard);
}
