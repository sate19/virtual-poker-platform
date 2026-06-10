import type { Card, Rank } from "@friends-poker/poker-engine";
import { BIG_JOKER_RANKS, SMALL_JOKER_RANKS, evaluateHand } from "@friends-poker/poker-engine";

const suitSymbol: Record<string, string> = {
  s: "♠",
  h: "♥",
  d: "♦",
  c: "♣",
  x: "",
};

export function formatCard(card?: Card): string {
  if (!card) return "??";
  if (isJoker(card)) return isBigJoker(card) ? "大王" : "小王";
  return `${card.rank}${suitSymbol[card.suit] ?? card.suit}`;
}

export function isRed(card?: Card): boolean {
  if (!card) return false;
  if (isBigJoker(card)) return true;
  if (isSmallJoker(card)) return false;
  return card.suit === "h" || card.suit === "d";
}

export function isJoker(card?: Card): boolean {
  return card?.rank === "R" || card?.rank === "B";
}

export function isBigJoker(card?: Card): boolean {
  return card?.rank === "R";
}

export function isSmallJoker(card?: Card): boolean {
  return card?.rank === "B";
}

export function getBestJokerRank(joker: Card, allCards: Card[]): string {
  if (allCards.length < 5) return "";
  if (!isJoker(joker)) return "";

  const allowedRanks = isBigJoker(joker) ? BIG_JOKER_RANKS : SMALL_JOKER_RANKS;
  const fixedCards = allCards.filter((c) => c !== joker);

  let bestRank: Rank = allowedRanks[0]!;
  let bestEval: ReturnType<typeof evaluateHand> = undefined;

  for (const rank of allowedRanks) {
    const virtual: Card = { rank, suit: "x" };
    const testCards = [...fixedCards, virtual];
    const evaluation = evaluateHand(testCards);
    if (evaluation && (!bestEval || compareEvaluations(evaluation, bestEval) > 0)) {
      bestEval = evaluation;
      bestRank = rank;
    }
  }
  return bestRank;
}

function compareEvaluations(a: { categoryRank: number; ranks: number[] }, b: { categoryRank: number; ranks: number[] }): number {
  if (a.categoryRank !== b.categoryRank) return a.categoryRank - b.categoryRank;
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i += 1) {
    const diff = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
