import { RANK_VALUE, cardToString } from "./cards";
import type { Card, HandCategory, HandEvaluation } from "./types";

let _jokerEval: ((cards: Card[]) => HandEvaluation) | null = null;

export function _registerJokerEvaluator(fn: ((cards: Card[]) => HandEvaluation) | null): void {
  _jokerEval = fn;
}

const CATEGORY_RANK: Record<HandCategory, number> = {
  "High Card": 0,
  "One Pair": 1,
  "Two Pair": 2,
  "Three of a Kind": 3,
  Straight: 4,
  Flush: 5,
  "Full House": 6,
  "Four of a Kind": 7,
  "Straight Flush": 8,
  "Royal Flush": 9,
};

export function evaluateSevenCardsPure(cards: Card[]): HandEvaluation {
  if (cards.length !== 7) {
    throw new Error("德州扑克摊牌评估需要正好 7 张牌");
  }
  const combos = combinations(cards, 5).map(evaluateFiveCards);
  return combos.sort(compareEvaluations).at(-1)!;
}

export function evaluateSevenCards(cards: Card[]): HandEvaluation {
  const hasJoker = cards.some((c) => c.rank === "R" || c.rank === "B");
  if (hasJoker && _jokerEval) {
    return _jokerEval(cards);
  }
  return evaluateSevenCardsPure(cards);
}

export function evaluateHand(cards: Card[]): HandEvaluation | undefined {
  if (cards.length < 5) return undefined;

  const hasJoker = cards.some((c) => c.rank === "R" || c.rank === "B");
  if (hasJoker && _jokerEval) {
    try {
      const mod = _jokerEval(cards);
      return mod;
    } catch {
      // fall through to standard
    }
  }

  if (!hasJoker) {
    const combos = combinations(cards, 5).map(evaluateFiveCards);
    return combos.sort(compareEvaluations).at(-1);
  }

  // hasJoker but DLC not loaded — fall back to bare evaluation (won't handle jokers)
  const combos = combinations(cards, 5).map(evaluateFiveCards);
  return combos.sort(compareEvaluations).at(-1);
}

export function compareEvaluations(a: HandEvaluation, b: HandEvaluation): number {
  if (a.categoryRank !== b.categoryRank) {
    return a.categoryRank - b.categoryRank;
  }
  const length = Math.max(a.ranks.length, b.ranks.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function evaluateFiveCards(cards: Card[]): HandEvaluation {
  if (cards.length !== 5) {
    throw new Error("5 张牌评估需要正好 5 张牌");
  }

  const values = cards.map((card) => RANK_VALUE[card.rank]).sort((a, b) => b - a);
  const groups = rankGroups(values);
  const isFlush = new Set(cards.map((card) => card.suit)).size === 1;
  const straightHigh = getStraightHigh(values);

  if (isFlush && straightHigh) {
    const category = straightHigh === 14 ? "Royal Flush" : "Straight Flush";
    return buildEvaluation(category, [straightHigh], cards);
  }

  const four = groups.find((group) => group.count === 4);
  if (four) {
    const kicker = groups.find((group) => group.rank !== four.rank)!.rank;
    return buildEvaluation("Four of a Kind", [four.rank, kicker], cards);
  }

  const trips = groups.filter((group) => group.count === 3);
  const pairs = groups.filter((group) => group.count === 2);
  if (trips.length > 0 && pairs.length > 0) {
    return buildEvaluation("Full House", [trips[0]!.rank, pairs[0]!.rank], cards);
  }

  if (isFlush) {
    return buildEvaluation("Flush", values, cards);
  }

  if (straightHigh) {
    return buildEvaluation("Straight", [straightHigh], cards);
  }

  if (trips.length > 0) {
    const kickers = groups.filter((group) => group.rank !== trips[0]!.rank).map((group) => group.rank);
    return buildEvaluation("Three of a Kind", [trips[0]!.rank, ...kickers], cards);
  }

  if (pairs.length >= 2) {
    const [highPair, lowPair] = pairs;
    const kicker = groups.find((group) => group.count === 1)!.rank;
    return buildEvaluation("Two Pair", [highPair!.rank, lowPair!.rank, kicker], cards);
  }

  if (pairs.length === 1) {
    const pair = pairs[0]!;
    const kickers = groups.filter((group) => group.rank !== pair.rank).map((group) => group.rank);
    return buildEvaluation("One Pair", [pair.rank, ...kickers], cards);
  }

  return buildEvaluation("High Card", values, cards);
}

function buildEvaluation(category: HandCategory, ranks: number[], cards: Card[]): HandEvaluation {
  return {
    category,
    categoryRank: CATEGORY_RANK[category],
    ranks,
    cards: [...cards].sort((a, b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]),
    label: `${category} ${ranks.join("-")} (${cards.map(cardToString).join(" ")})`,
  };
}

function rankGroups(values: number[]): Array<{ rank: number; count: number }> {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
}

function getStraightHigh(values: number[]): number | undefined {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) {
    unique.push(1);
  }
  for (let i = 0; i <= unique.length - 5; i += 1) {
    const window = unique.slice(i, i + 5);
    if (window.every((value, index) => index === 0 || value === window[index - 1]! - 1)) {
      return window[0] === 5 ? 5 : window[0];
    }
  }
  return undefined;
}

export function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) {
    return [[]];
  }
  if (items.length < size) {
    return [];
  }
  const [head, ...tail] = items;
  return [
    ...combinations(tail, size - 1).map((combo) => [head!, ...combo]),
    ...combinations(tail, size),
  ];
}
