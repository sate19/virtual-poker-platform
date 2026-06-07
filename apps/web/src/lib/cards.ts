import type { Card } from "@friends-poker/poker-engine";

const suitSymbol: Record<string, string> = {
  s: "\u2660",
  h: "\u2665",
  d: "\u2666",
  c: "\u2663",
};

export function formatCard(card?: Card): string {
  if (!card) {
    return "??";
  }
  return `${card.rank}${suitSymbol[card.suit] ?? card.suit}`;
}

export function isRed(card?: Card): boolean {
  return card?.suit === "h" || card?.suit === "d";
}
