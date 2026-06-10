import { BIG_JOKER_RANKS, SMALL_JOKER_RANKS, isBigJoker, isJoker } from "./index";
import { combinations, evaluateFiveCards, compareEvaluations, evaluateSevenCardsPure, _registerJokerEvaluator } from "../../handEvaluator";
import type { Card, HandEvaluation } from "../../types";

export function expandJokers(cards: Card[]): Card[][] {
  const jokers = cards.filter(isJoker);
  const fixedCards = cards.filter((c) => !isJoker(c));
  if (jokers.length === 0) return [cards];

  const result: Card[][] = [];

  function expand(index: number, current: Card[]): void {
    if (index >= jokers.length) {
      result.push([...current]);
      return;
    }
    const joker = jokers[index]!;
    const allowedRanks = isBigJoker(joker) ? BIG_JOKER_RANKS : SMALL_JOKER_RANKS;
    for (const rank of allowedRanks) {
      current.push({ rank, suit: "x" });
      expand(index + 1, current);
      current.pop();
    }
  }

  expand(0, []);
  return result.map((expanded) => [...fixedCards, ...expanded]);
}

export function evaluateHand(cards: Card[]): HandEvaluation | undefined {
  if (cards.length < 5) return undefined;
  if (cards.length === 7) return evaluateSevenWithJokers(cards);

  if (!cards.some(isJoker)) {
    const combos = combinations(cards, 5).map(evaluateFiveCards);
    return combos.sort(compareEvaluations).at(-1);
  }

  const combos = combinations(cards, 5);
  let best: HandEvaluation | undefined;
  for (const combo of combos) {
    if (combo.some(isJoker)) {
      const expanded = expandJokers(combo);
      for (const concrete of expanded) {
        const evaluation = evaluateFiveCards(concrete);
        if (!best || compareEvaluations(evaluation, best) > 0) {
          best = evaluation;
        }
      }
    } else {
      const evaluation = evaluateFiveCards(combo);
      if (!best || compareEvaluations(evaluation, best) > 0) {
        best = evaluation;
      }
    }
  }
  return best;
}

export function evaluateSevenWithJokers(cards: Card[]): HandEvaluation {
  if (!cards.some(isJoker)) {
    return evaluateSevenCardsPure(cards);
  }

  const combos = combinations(cards, 5);
  let best: HandEvaluation | undefined;
  for (const combo of combos) {
    if (combo.some(isJoker)) {
      const expanded = expandJokers(combo);
      for (const concrete of expanded) {
        const evaluation = evaluateFiveCards(concrete);
        if (!best || compareEvaluations(evaluation, best) > 0) {
          best = evaluation;
        }
      }
    } else {
      const evaluation = evaluateFiveCards(combo);
      if (!best || compareEvaluations(evaluation, best) > 0) {
        best = evaluation;
      }
    }
  }
  return best!;
}

_registerJokerEvaluator(evaluateSevenWithJokers);
