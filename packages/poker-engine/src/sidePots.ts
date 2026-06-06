import { compareEvaluations } from "./handEvaluator";
import type { HandEvaluation, PotAward, SidePot } from "./types";

export interface PotParticipant {
  userId: string;
  committed: number;
  folded: boolean;
  seatIndex: number;
  hand?: HandEvaluation;
}

export function buildSidePots(participants: PotParticipant[]): SidePot[] {
  const committedPlayers = participants.filter((player) => player.committed > 0);
  const levels = [...new Set(committedPlayers.map((player) => player.committed))].sort((a, b) => a - b);
  let previous = 0;

  return levels
    .map((level, index) => {
      const contributors = committedPlayers.filter((player) => player.committed >= level);
      const amount = (level - previous) * contributors.length;
      previous = level;
      return {
        id: `pot-${index + 1}`,
        amount,
        level,
        contributorIds: contributors.map((player) => player.userId),
        eligiblePlayerIds: contributors
          .filter((player) => !player.folded)
          .map((player) => player.userId),
      };
    })
    .filter((pot) => pot.amount > 0);
}

export function awardSidePots(
  pots: SidePot[],
  participants: PotParticipant[],
  buttonSeatIndex: number,
): { awards: PotAward[]; payouts: Record<string, number> } {
  const participantById = new Map(participants.map((player) => [player.userId, player]));
  const payouts: Record<string, number> = Object.fromEntries(participants.map((player) => [player.userId, 0]));

  const awards = pots.map((pot) => {
    const eligible = pot.eligiblePlayerIds
      .map((id) => participantById.get(id))
      .filter((player): player is PotParticipant => Boolean(player && player.hand));

    if (eligible.length === 0) {
      return { potId: pot.id, amount: pot.amount, winnerIds: [] };
    }

    const best = eligible
      .map((player) => player.hand!)
      .sort(compareEvaluations)
      .at(-1)!;
    const winners = eligible.filter((player) => compareEvaluations(player.hand!, best) === 0);
    const baseShare = Math.floor(pot.amount / winners.length);
    let oddChips = pot.amount % winners.length;
    const oddOrder = sortByOddChipOrder(winners, buttonSeatIndex);

    for (const winner of winners) {
      payouts[winner.userId] = (payouts[winner.userId] ?? 0) + baseShare;
    }
    for (const winner of oddOrder) {
      if (oddChips <= 0) {
        break;
      }
      payouts[winner.userId] = (payouts[winner.userId] ?? 0) + 1;
      oddChips -= 1;
    }

    return {
      potId: pot.id,
      amount: pot.amount,
      winnerIds: winners.map((winner) => winner.userId),
      oddChipWinnerId: pot.amount % winners.length > 0 ? oddOrder[0]?.userId : undefined,
    };
  });

  return { awards, payouts };
}

export function sortByOddChipOrder<T extends { seatIndex: number }>(
  players: T[],
  buttonSeatIndex: number,
): T[] {
  return [...players].sort((a, b) => {
    const distanceA = positiveSeatDistance(buttonSeatIndex, a.seatIndex);
    const distanceB = positiveSeatDistance(buttonSeatIndex, b.seatIndex);
    return distanceA - distanceB;
  });
}

function positiveSeatDistance(buttonSeatIndex: number, seatIndex: number): number {
  const tableSize = 9;
  return (seatIndex - buttonSeatIndex + tableSize) % tableSize || tableSize;
}
