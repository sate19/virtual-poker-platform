import type { Card, PokerActionType, PokerGameState } from "@friends-poker/poker-engine";
import { config } from "./config";

export interface AIDecision {
  action: PokerActionType;
  amount?: number;
}

function potTotal(state: PokerGameState): number {
  return state.players.reduce((sum, p) => sum + p.totalCommitted, 0);
}

function cardLabel(card: Card): string {
  const suit: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const rank = card.rank === "T" ? "10" : card.rank;
  return `${rank}${suit[card.suit] ?? card.suit}`;
}

function buildPrompt(state: PokerGameState, userId: string): string {
  const player = state.players.find((p) => p.userId === userId);
  if (!player) throw new Error("AI player not found in game state");

  const holeCards = player.holeCards.map(cardLabel).join(" ");
  const community = state.communityCards.length
    ? state.communityCards.map(cardLabel).join(" ")
    : "(无)";

  const phaseLabels: Record<string, string> = {
    preflop: "翻牌前",
    flop: "翻牌",
    turn: "转牌",
    river: "河牌",
  };

  const toCall = Math.max(0, state.currentBet - player.committedThisStreet);
  const minRaise = state.minRaise || state.bigBlind;

  const validActions: string[] = [];
  if (toCall === 0) {
    validActions.push("check（过牌）");
    if (player.stack > 0) {
      validActions.push(`bet（下注，最少 ${minRaise}，最多 ${player.stack}）`);
    }
  } else if (toCall >= player.stack) {
    validActions.push("all-in（全下，等于跟注全部筹码）");
  } else {
    validActions.push("fold（弃牌）");
    validActions.push(`call（跟注 ${toCall}）`);
    if (player.stack > toCall) {
      validActions.push(
        `raise（加注，至少 ${toCall + minRaise}，最多 ${player.stack + player.committedThisStreet}）`,
      );
    }
  }
  if (player.stack > 0 && !validActions.some((a) => a.startsWith("all-in"))) {
    validActions.push(`all-in（全下 ${player.stack + player.committedThisStreet}）`);
  }

  const phaseLabel = phaseLabels[state.phase] ?? state.phase;
  const playersActive = state.players.filter((p) => p.status !== "folded" && p.status !== "out").length;

  return `你正在玩无限注德州扑克。请根据当前牌局做出最优决策。

当前阶段：${phaseLabel}
你的手牌：${holeCards}
公共牌：${community}
底池总额：${potTotal(state)}
当前最高下注：${state.currentBet}
你已投入本轮：${player.committedThisStreet}
你需要跟注：${toCall}
你的剩余筹码：${player.stack}
你的位置：座位 ${player.seatIndex}
还在牌局中的玩家人数：${playersActive}
小盲：${state.smallBlind} / 大盲：${state.bigBlind}

你可以选择的操作：
${validActions.map((a) => `- ${a}`).join("\n")}

请只回复一个 JSON 对象，不要包含其他文字。格式如下：
{"action": "<action>", "amount": <number>}

action 必须是以下之一：fold, check, call, bet, raise, all-in
amount 只在 bet, raise 时需要，表示你总共要投入的筹码数（不是加注额）。
对于 call，amount 固定为 ${toCall}。
对于 check/fold，不需要 amount。

示例回复：
{"action": "raise", "amount": 120}
{"action": "call", "amount": 20}
{"action": "fold"}`;
}

function parseResponse(text: string): AIDecision | null {
  // Extract JSON from the response (in case there's surrounding text)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const action = parsed.action?.toLowerCase();

    if (!["fold", "check", "call", "bet", "raise", "all-in"].includes(action)) {
      return null;
    }

    return {
      action: action as AIDecision["action"],
      amount: typeof parsed.amount === "number" ? Math.floor(parsed.amount) : undefined,
    };
  } catch {
    return null;
  }
}

export async function getAIDecision(state: PokerGameState, userId: string): Promise<AIDecision> {
  if (!config.deepseekApiKey) {
    // Fallback: basic heuristic when no API key configured
    return fallbackDecision(state, userId);
  }

  const prompt = buildPrompt(state, userId);

  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "你是一位专业的德州扑克AI玩家。你总是用JSON格式回复。" },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error("[AI] DeepSeek API error:", response.status);
      return fallbackDecision(state, userId);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) return fallbackDecision(state, userId);

    const decision = parseResponse(content);
    if (!decision) {
      console.warn("[AI] Failed to parse DeepSeek response:", content);
      return fallbackDecision(state, userId);
    }

    return decision;
  } catch (error) {
    console.error("[AI] DeepSeek request failed:", error);
    return fallbackDecision(state, userId);
  }
}

function fallbackDecision(state: PokerGameState, userId: string): AIDecision {
  const player = state.players.find((p) => p.userId === userId);
  if (!player) return { action: "fold" };

  const toCall = Math.max(0, state.currentBet - player.committedThisStreet);

  if (toCall === 0) {
    // Check or bet sometimes
    if (Math.random() < 0.3 && player.stack > state.bigBlind * 3) {
      const betAmount = Math.min(player.stack, state.bigBlind * Math.ceil(Math.random() * 5));
      return { action: "bet", amount: betAmount };
    }
    return { action: "check" };
  }

  if (toCall >= player.stack) {
    // Must go all-in to continue
    if (Math.random() < 0.5) {
      return { action: "all-in" };
    }
    return { action: "fold" };
  }

  // Needs to call — decide based on simple heuristics
  const potOdds = toCall / (potTotal(state) + toCall);
  const r = Math.random();

  if (r < potOdds * 0.5) {
    return { action: "fold" };
  }

  if (r > 0.7 && player.stack > toCall * 2) {
    const raiseAmount = Math.min(
      player.stack + player.committedThisStreet,
      toCall + player.committedThisStreet + state.bigBlind * Math.ceil(Math.random() * 4),
    );
    return { action: "raise", amount: raiseAmount };
  }

  return { action: "call", amount: toCall };
}
