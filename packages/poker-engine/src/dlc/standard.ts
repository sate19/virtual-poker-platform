import type { Card } from "../types";
import { RANKS, SUITS, STANDARD_RANKS, STANDARD_SUITS } from "../cards";

export function createStandardDeck(): Card[] {
  return STANDARD_SUITS.flatMap((suit) => STANDARD_RANKS.map((rank) => ({ rank, suit })));
}
