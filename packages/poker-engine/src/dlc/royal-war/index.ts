import type { Card, Rank } from "../../types";

export const BIG_JOKER: Card = { rank: "R", suit: "x" };
export const SMALL_JOKER: Card = { rank: "B", suit: "x" };

export const BIG_JOKER_RANKS: Rank[] = ["9", "T", "J", "Q", "K", "A"];
export const SMALL_JOKER_RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8"];

export function isJoker(card: Card): boolean {
  return card.rank === "R" || card.rank === "B";
}

export function isBigJoker(card: Card): boolean {
  return card.rank === "R";
}

export function isSmallJoker(card: Card): boolean {
  return card.rank === "B";
}

export function createRoyalWarDeck(): Card[] {
  const { createStandardDeck } = require("../standard");
  return [...createStandardDeck(), BIG_JOKER, SMALL_JOKER];
}

export { expandJokers, evaluateHand, evaluateSevenWithJokers } from "./evaluator";
