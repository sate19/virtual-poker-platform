import type { Card, DeckType } from "../types";
import { createStandardDeck } from "./standard";
import { createRoyalWarDeck } from "./royal-war";

export function createDeckByType(deckType: DeckType): Card[] {
  switch (deckType) {
    case "royal-war":
      return createRoyalWarDeck();
    default:
      return createStandardDeck();
  }
}

export function deckHasJokers(deckType: DeckType): boolean {
  return deckType === "royal-war";
}

export {
  isJoker,
  isBigJoker,
  isSmallJoker,
  BIG_JOKER,
  SMALL_JOKER,
  BIG_JOKER_RANKS,
  SMALL_JOKER_RANKS,
  evaluateHand,
  evaluateSevenWithJokers,
  expandJokers,
} from "./royal-war";
