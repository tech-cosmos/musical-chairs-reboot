// The "naive REST client": raw fetch calls written the way a typical
// happy-path integration (or a happy-path coding agent) writes them.
// Two separate requests where one transaction belongs, timeouts with
// blind retries, and status-code-only "error handling".
//
// This file exists to LOSE the demo. `App.tsx` + Reboot win it.

const BASE = import.meta.env.VITE_REBOOT_URL as string;
export const GAME_ID = "the-game";

export type ChaosLogLine = {
  kind: "req" | "ok" | "warn" | "fail" | "info";
  text: string;
};

async function post(
  service: string,
  method: string,
  stateType: string,
  stateId: string,
  body: unknown,
  timeoutMs?: number
): Promise<{ status: number; json: any }> {
  const controller = new AbortController();
  const timer =
    timeoutMs !== undefined
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
  try {
    const response = await fetch(`${BASE}/chairs.v1.${service}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-reboot-state-ref": `chairs.v1.${stateType}:${stateId}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: response.status, json: await response.json() };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// "Payment provider": charge the player's wallet. Always returns 200.
export function naiveCharge(
  playerId: string,
  amount: number,
  opts: { delayMs?: number; timeoutMs?: number } = {}
) {
  return post(
    "PlayerMethods",
    "NaiveWithdraw",
    "Player",
    playerId,
    { amount, delayMs: opts.delayMs ?? 0 },
    opts.timeoutMs
  );
}

// "Order creation": enroll the (already-charged, we hope) player.
export function naiveEnroll(playerId: string) {
  return post("GameMethods", "Enroll", "Game", GAME_ID, { playerId });
}

export function naiveChairAvailable(chairId: number) {
  return post("GameMethods", "ChairAvailable", "Game", GAME_ID, { chairId });
}

export function naiveSit(playerId: string, chairId: number) {
  return post("GameMethods", "NaiveSit", "Game", GAME_ID, {
    playerId,
    chairId,
  });
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// The hardened join over the SAME raw HTTP transport the naive client
// uses — the only difference is one header: x-reboot-idempotency-key.
// The server deduplicates retries and replays the original result.
export async function rebootFetchJoin(
  playerId: string,
  idempotencyKey: string,
  timeoutMs?: number
): Promise<{ status: number; json: any }> {
  const controller = new AbortController();
  const timer =
    timeoutMs !== undefined
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
  try {
    const response = await fetch(`${BASE}/chairs.v1.GameMethods/Join`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-reboot-state-ref": `chairs.v1.Game:${GAME_ID}`,
        "x-reboot-idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ playerId }),
      signal: controller.signal,
    });
    return { status: response.status, json: await response.json() };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// The classic two-step checkout: charge, then enroll. `crashBetween`
// simulates the process dying between the two requests.
export async function naiveJoin(
  playerId: string,
  fee: number,
  log: (line: ChaosLogLine) => void,
  opts: { crashBetween?: boolean } = {}
): Promise<void> {
  log({ kind: "req", text: `POST /charge ${playerId} amount=${fee}` });
  const charge = await naiveCharge(playerId, fee);
  log({
    kind: "ok",
    text: `HTTP ${charge.status} ${JSON.stringify(charge.json)}`,
  });
  // Only the status code is checked. `charged: false` sails right by.
  if (charge.status !== 200) {
    log({ kind: "fail", text: "charge failed, giving up" });
    return;
  }
  if (opts.crashBetween) {
    log({
      kind: "fail",
      text: `☠️ process crashed before POST /enroll — ${fee} coins are gone`,
    });
    return;
  }
  log({ kind: "req", text: `POST /enroll ${playerId}` });
  const enroll = await naiveEnroll(playerId);
  log({ kind: "ok", text: `HTTP ${enroll.status} — enrolled` });
}

// Check-then-act chair claim with human "think time" in the middle.
export async function naiveClaimChair(
  playerId: string,
  chairId: number,
  log: (line: ChaosLogLine) => void,
  thinkMs = 350
): Promise<void> {
  log({ kind: "req", text: `GET /chair/${chairId}/available (${playerId})` });
  const check = await naiveChairAvailable(chairId);
  const available = check.json?.available === true;
  log({
    kind: available ? "ok" : "warn",
    text: `available=${available} (${playerId})`,
  });
  if (!available) return;
  await sleep(thinkMs); // The race window. Someone else is sprinting.
  log({ kind: "req", text: `POST /chair/${chairId}/sit (${playerId})` });
  await naiveSit(playerId, chairId);
  log({ kind: "ok", text: `HTTP 200 — ${playerId} sat down (they think)` });
}
