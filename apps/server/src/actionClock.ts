import type { PokerAction, PokerGameState } from "@friends-poker/poker-engine";

export interface ActionClock {
  userId: string;
  startedAt: string;
  deadlineAt: string;
  timeoutSeconds: number;
}

export function isActionClockNeeded(state?: PokerGameState): boolean {
  return Boolean(
    state?.currentTurnUserId &&
      ["preflop", "flop", "turn", "river"].includes(state.phase),
  );
}

export function getAutomaticTimeoutAction(state: PokerGameState): PokerAction | undefined {
  if (!state.currentTurnUserId) {
    return undefined;
  }

  const player = state.players.find((item) => item.userId === state.currentTurnUserId);
  if (!player || player.status === "folded" || player.status === "all-in" || player.stack <= 0) {
    return undefined;
  }

  const toCall = Math.max(0, state.currentBet - player.committedThisStreet);
  return { type: toCall === 0 ? "check" : "fold" };
}

export function reconcileActionClock(
  state: PokerGameState,
  timeoutSeconds: number,
  now = new Date(),
  force = false,
): boolean {
  if (!isActionClockNeeded(state) || !state.currentTurnUserId) {
    if (state.actionClock) {
      delete state.actionClock;
      return true;
    }
    return false;
  }

  const current = state.actionClock;
  const currentDeadline = current ? Date.parse(current.deadlineAt) : Number.NaN;
  const currentTurnUserId = state.currentTurnUserId;
  const shouldReset =
    force ||
    !current ||
    current.userId !== currentTurnUserId ||
    !Number.isFinite(currentDeadline) ||
    currentDeadline <= now.getTime();

  if (!shouldReset) {
    return false;
  }

  state.actionClock = {
    userId: currentTurnUserId,
    startedAt: now.toISOString(),
    deadlineAt: new Date(now.getTime() + timeoutSeconds * 1000).toISOString(),
    timeoutSeconds,
  };
  return true;
}
