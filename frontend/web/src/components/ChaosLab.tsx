import type { Game, UseGameApi } from "@api/chairs/v1/game_rbt_react";
import { useState, type FC } from "react";
import type { LogLine, Mode } from "../App.tsx";
import {
  naiveCharge,
  naiveClaimChair,
  naiveEnroll,
  naiveJoin,
  rebootFetchJoin,
  sleep,
  type ChaosLogLine,
} from "../naive.ts";

// The Chaos Lab: five production failure modes, injected on demand.
// Naive mode reproduces each bug with raw REST calls; Reboot mode
// shows the same pressure bouncing off transactions + idempotency.
export const ChaosLab: FC<{
  game: UseGameApi;
  snapshot: Game.GetResponse | undefined;
  playerId: string;
  mode: Mode;
  setMode: (mode: Mode) => void;
  log: LogLine[];
  pushLog: (line: ChaosLogLine) => void;
}> = ({ game, snapshot, playerId, mode, setMode, log, pushLog }) => {
  const [busy, setBusy] = useState(false);
  const slow = (snapshot?.slowJoinMs ?? 0) > 0;
  const fee = snapshot?.entryFee ?? 10;

  const run = (demo: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void demo()
      .catch((error: unknown) =>
        pushLog({ kind: "fail", text: `unexpected: ${String(error)}` })
      )
      .finally(() => {
        void game.touch();
        setBusy(false);
      });
  };

  // ── Failure mode 1: the retry that charges twice ──────────────────
  const retryStorm = () =>
    run(async () => {
      pushLog({ kind: "info", text: `═══ RETRY STORM ×3 (${mode}) ═══` });
      if (mode === "naive") {
        for (let attempt = 1; attempt <= 3; attempt++) {
          pushLog({ kind: "warn", text: `network flaky — attempt ${attempt}` });
          await naiveJoin(playerId, fee, pushLog);
        }
        pushLog({
          kind: "fail",
          text: `3 blind retries → charged ${3 * fee} coins, enrolled 3 times`,
        });
      } else {
        // Same raw HTTP transport as the naive client — the ONLY
        // difference is one header: x-reboot-idempotency-key (a UUID),
        // minted once per logical action and reused by every retry.
        const key = crypto.randomUUID();
        pushLog({
          kind: "req",
          text: `3 retries of one join, SAME idempotency key ${key.slice(0, 8)}…`,
        });
        for (let attempt = 1; attempt <= 3; attempt++) {
          const start = performance.now();
          const { status, json } = await rebootFetchJoin(playerId, key);
          const ms = Math.round(performance.now() - start);
          const aborted = json?.code !== undefined;
          pushLog({
            kind: "ok",
            text: `attempt ${attempt}: HTTP ${status} in ${ms}ms${
              aborted
                ? " (typed abort — replayed, not re-charged)"
                : attempt > 1
                  ? " (deduped: original result replayed)"
                  : ""
            }`,
          });
        }
        pushLog({
          kind: "ok",
          text: `net effect: charged ${fee} coins ONCE — retries were harmless (see ledger)`,
        });
      }
    });

  // ── Failure mode 2: the timeout that lied ─────────────────────────
  const lyingTimeout = () =>
    run(async () => {
      pushLog({ kind: "info", text: `═══ LYING TIMEOUT (${mode}) ═══` });
      if (mode === "naive") {
        pushLog({
          kind: "req",
          text: "POST /charge (server takes 2500ms, client's patience: 600ms)",
        });
        // An application-level timeout: we stop WAITING, but the
        // request is still out there, still processing.
        const abandoned = naiveCharge(playerId, fee, { delayMs: 2500 });
        void abandoned.catch(() => {});
        const early = await Promise.race([
          abandoned.then(() => true),
          sleep(600).then(() => false),
        ]);
        if (early) {
          pushLog({ kind: "ok", text: "charge returned in time?!" });
        } else {
          pushLog({
            kind: "warn",
            text: "✗ client timeout — ASSUMING charge failed. retrying…",
          });
        }
        await naiveCharge(playerId, fee);
        pushLog({ kind: "ok", text: "retry charged. enrolling once…" });
        await naiveEnroll(playerId);
        await sleep(2200); // Let the "failed" first charge land.
        pushLog({
          kind: "fail",
          text: `the timed-out charge ALSO landed → paid ${2 * fee} for one seat. ledger is now RED 📉`,
        });
      } else {
        pushLog({
          kind: "req",
          text: "slow server ON (4s). join fired with idempotency key; client gives up at 1s",
        });
        await game.setChaos({ slowJoinMs: 4000 });
        const key = crypto.randomUUID();
        try {
          await rebootFetchJoin(playerId, key, 1000);
          pushLog({ kind: "ok", text: "join returned in time?!" });
        } catch {
          pushLog({
            kind: "warn",
            text: "✗ 'client timeout' — but we DON'T blind-retry a new request…",
          });
          pushLog({
            kind: "req",
            text: "…we re-send with the SAME idempotency key and await the one true outcome",
          });
        }
        const start = performance.now();
        const { status, json } = await rebootFetchJoin(playerId, key);
        const ms = Math.round(performance.now() - start);
        await game.setChaos({ slowJoinMs: 0 });
        const aborted = json?.code !== undefined;
        pushLog(
          aborted
            ? {
                kind: "ok",
                text: `HTTP ${status}: typed abort — charged ZERO times, not twice`,
              }
            : {
                kind: "ok",
                text: `HTTP ${status} in ${ms}ms: timeout + retry, one key → charged ${fee} ONCE (ledger stays green)`,
              }
        );
      }
    });

  // ── Failure mode 3: the 200 that hid a failure ────────────────────
  const silent200 = () =>
    run(async () => {
      pushLog({ kind: "info", text: `═══ THE 200 THAT LIED (${mode}) ═══` });
      if (mode === "naive") {
        pushLog({
          kind: "req",
          text: "POST /charge on a (probably) broke wallet",
        });
        const charge = await naiveCharge(playerId, 999999);
        pushLog({
          kind: "ok",
          text: `HTTP ${charge.status} ${JSON.stringify(charge.json)}`,
        });
        pushLog({
          kind: "warn",
          text: "status == 200, so ship it → enrolling WITHOUT payment",
        });
        await naiveEnroll(playerId);
        pushLog({
          kind: "fail",
          text: "enrolled for free — the pot now claims coins nobody paid",
        });
      } else {
        pushLog({ kind: "req", text: "join with a 999999-coin entry… kidding." });
        pushLog({
          kind: "req",
          text: "reboot join aborts with a TYPED error when you can't pay:",
        });
        const { aborted } = await game.join({ playerId });
        if (aborted !== undefined) {
          pushLog({
            kind: "ok",
            text: `✓ abort surfaced to the client: ${JSON.stringify(
              (aborted as any).error ?? {}
            ).slice(0, 90)}`,
          });
        } else {
          pushLog({
            kind: "ok",
            text: "join succeeded (you could afford it) — errors here are typed aborts, never a lying 200",
          });
        }
      }
    });

  // ── Failure mode 4: two buyers, one remaining item ────────────────
  const raceBots = () =>
    run(async () => {
      pushLog({ kind: "info", text: `═══ TWO BOTS, ONE CHAIR (${mode}) ═══` });
      if (snapshot?.phase !== "SCRAMBLE") {
        pushLog({
          kind: "warn",
          text: "needs a SCRAMBLE — start a game, wait for the music to stop",
        });
        return;
      }
      const open = snapshot.chairs.find((c) => c.occupants.length === 0);
      if (open === undefined) {
        pushLog({ kind: "warn", text: "no open chair left to fight over" });
        return;
      }
      if (mode === "naive") {
        pushLog({
          kind: "req",
          text: `bot-α and bot-β both check chair ${open.chairId + 1}…`,
        });
        await Promise.all([
          naiveClaimChair("bot-α", open.chairId, pushLog, 250),
          naiveClaimChair("bot-β", open.chairId, pushLog, 300),
        ]);
        pushLog({
          kind: "fail",
          text: "both checks said available → both sat → one chair, two bots 💥",
        });
      } else {
        pushLog({
          kind: "req",
          text: `bot-α and bot-β race game.claim(chair ${open.chairId + 1}) concurrently`,
        });
        const results = await Promise.all([
          game.claim({ playerId: "bot-α", chairId: open.chairId }),
          game.claim({ playerId: "bot-β", chairId: open.chairId }),
        ]);
        const losers = results.filter((r) => r.aborted !== undefined).length;
        pushLog({
          kind: "ok",
          text: `writers are serialized: ${2 - losers} seated, ${losers} got a typed rejection (bots aren't in the round, so likely both)`,
        });
      }
    });

  // ── Failure mode 5: the crash between the charge and the email ────
  const crashBetween = () =>
    run(async () => {
      pushLog({ kind: "info", text: `═══ CRASH MID-CHECKOUT (${mode}) ═══` });
      if (mode === "naive") {
        await naiveJoin(playerId, fee, pushLog, { crashBetween: true });
        pushLog({
          kind: "fail",
          text: "charged but never enrolled — check The Ledger 📉",
        });
      } else {
        pushLog({
          kind: "req",
          text: "join = ONE transaction: charge + enroll commit or roll back together.",
        });
        pushLog({
          kind: "req",
          text: "livedemo: toggle slow server, click join, then Ctrl-C the backend mid-join. restart it. no coins lost.",
        });
        const { aborted } = await game.join({ playerId });
        pushLog(
          aborted !== undefined
            ? { kind: "ok", text: `join aborted cleanly: nothing half-done` }
            : { kind: "ok", text: "join committed atomically: charged AND enrolled" }
        );
      }
    });

  const toggleSlow = () =>
    run(async () => {
      await game.setChaos({ slowJoinMs: slow ? 0 : 4000 });
      pushLog({
        kind: "info",
        text: slow ? "🌤 slow server OFF" : "🐢 slow server ON — join takes 4s",
      });
    });

  const resetGame = () =>
    run(async () => {
      await game.reset();
      pushLog({ kind: "info", text: "🧹 game reset (pot carries over)" });
    });

  const colors: Record<ChaosLogLine["kind"], string> = {
    req: "text-sky-300",
    ok: "text-[var(--neon)]",
    warn: "text-amber-300",
    fail: "text-[var(--alarm)] font-bold",
    info: "text-fuchsia-300 font-bold",
  };

  const button =
    "w-full text-left font-mono2 text-xs border rounded-lg px-3 py-2 transition-colors disabled:opacity-40";

  return (
    <section className="chaos-panel rounded-2xl shadow-[8px_8px_0_rgba(23,19,32,0.4)] overflow-hidden text-[#d8d4e8]">
      <div className="px-5 py-3 border-b border-[var(--neon)]/20 flex items-center justify-between">
        <h2 className="font-mono2 text-sm font-bold text-[var(--neon)]">
          ▚ CHAOS LAB
        </h2>
        <div className="flex rounded-lg overflow-hidden border border-[var(--neon)]/40 font-mono2 text-xs">
          <button
            onClick={() => setMode("naive")}
            className={`px-3 py-1.5 ${mode === "naive" ? "bg-[var(--alarm)] text-white font-bold" : "opacity-60 hover:opacity-100"}`}
          >
            NAIVE
          </button>
          <button
            onClick={() => setMode("reboot")}
            className={`px-3 py-1.5 ${mode === "reboot" ? "bg-[var(--neon)] text-[var(--night)] font-bold" : "opacity-60 hover:opacity-100"}`}
          >
            REBOOT
          </button>
        </div>
      </div>

      <div className="px-5 py-4 space-y-2">
        <p className="font-mono2 text-[11px] opacity-60 mb-3">
          {mode === "naive"
            ? "// raw REST calls, no transactions, no idempotency. break things."
            : "// same pressure, but through Reboot transactions + idempotency."}
        </p>
        <button onClick={retryStorm} disabled={busy} className={`${button} border-[var(--alarm)]/40 hover:bg-[var(--alarm)]/10`}>
          💸 1 · the retry that charges twice
        </button>
        <button onClick={lyingTimeout} disabled={busy} className={`${button} border-amber-300/40 hover:bg-amber-300/10`}>
          ⏱ 2 · the timeout that lied
        </button>
        <button onClick={silent200} disabled={busy} className={`${button} border-sky-300/40 hover:bg-sky-300/10`}>
          🤫 3 · the 200 that hid a failure
        </button>
        <button onClick={raceBots} disabled={busy} className={`${button} border-fuchsia-300/40 hover:bg-fuchsia-300/10`}>
          🪑 4 · two buyers, one remaining chair
        </button>
        <button onClick={crashBetween} disabled={busy} className={`${button} border-[var(--neon)]/40 hover:bg-[var(--neon)]/10`}>
          ☠️ 5 · the crash between charge and email
        </button>

        <div className="flex gap-2 pt-2">
          <button
            onClick={toggleSlow}
            disabled={busy}
            className={`${button} flex-1 ${slow ? "border-amber-300 bg-amber-300/15" : "border-white/20 hover:bg-white/5"}`}
          >
            🐢 slow server: {slow ? "ON" : "off"}
          </button>
          <button
            onClick={resetGame}
            disabled={busy}
            className={`${button} flex-1 border-white/20 hover:bg-white/5`}
          >
            🧹 reset game
          </button>
        </div>
      </div>

      <div className="chaos-log mx-5 mb-5 rounded-lg bg-black/50 border border-white/10 px-3 py-2 h-52 overflow-y-auto font-mono2 text-[11px] leading-relaxed">
        {log.length === 0 && (
          <p className="opacity-40">chaos log — run a failure mode above…</p>
        )}
        {log.map((line) => (
          <p key={line.seq} className={colors[line.kind]}>
            <span className="opacity-40">{String(line.seq).padStart(3, "0")} </span>
            {line.text}
          </p>
        ))}
      </div>
    </section>
  );
};
