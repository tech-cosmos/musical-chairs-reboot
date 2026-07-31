import type { Game, UseGameApi } from "@api/chairs/v1/game_rbt_react";
import { type FC } from "react";
import type { Mode } from "../App.tsx";
import dancingCat from "../assets/dancing-cat.gif";
import { naiveClaimChair, naiveJoin, type ChaosLogLine } from "../naive.ts";

// Pull a human-readable message out of a typed abort.
export function describeAborted(aborted: unknown): string {
  const a = aborted as any;
  const error = a?.error;
  const message =
    error?.message ?? a?.message ?? "the server said no (typed error)";
  const type = error?.constructor?.name ?? "Aborted";
  return `${type}: ${message}`;
}

const PhaseBadge: FC<{ phase: string }> = ({ phase }) => {
  const styles: Record<string, string> = {
    LOBBY: "bg-[var(--teal)] text-white",
    MUSIC: "bg-[var(--gold)] text-[var(--ink)]",
    SCRAMBLE: "alarm text-white",
    ROUND_OVER: "bg-[var(--ink)] text-[var(--gold-soft)]",
  };
  const labels: Record<string, string> = {
    LOBBY: "🎟️ Lobby — buy in!",
    MUSIC: "🎶 Music playing…",
    SCRAMBLE: "🚨 GRAB A CHAIR!",
    ROUND_OVER: "🏆 We have a winner",
  };
  return (
    <span
      className={`font-display text-sm px-4 py-2 rounded-lg border-2 border-[var(--ink)] ${styles[phase] ?? "bg-white"}`}
    >
      {labels[phase] ?? phase}
    </span>
  );
};

const Equalizer: FC = () => (
  <div className="flex items-end gap-1.5 h-16">
    {Array.from({ length: 14 }, (_, i) => (
      <div
        key={i}
        className="eq-bar w-3 rounded-t bg-[var(--red)]"
        style={{
          height: `${30 + ((i * 37) % 60)}%`,
          animationDelay: `${(i % 5) * 0.1}s`,
          background: i % 3 === 0 ? "var(--gold)" : i % 3 === 1 ? "var(--red)" : "var(--teal)",
        }}
      />
    ))}
  </div>
);

export const Stage: FC<{
  game: UseGameApi;
  snapshot: Game.GetResponse | undefined;
  playerId: string;
  mode: Mode;
  pushLog: (line: ChaosLogLine) => void;
  showToast: (message: string) => void;
}> = ({ game, snapshot, playerId, mode, pushLog, showToast }) => {
  if (snapshot === undefined) {
    return (
      <div className="bg-[var(--paper)] border-2 border-[var(--ink)] rounded-2xl p-10 text-center font-mono2 animate-pulse">
        raising the tent…
      </div>
    );
  }

  const s = snapshot;
  const joined = s.players.includes(playerId);
  const active = s.active.includes(playerId);
  const seated = s.chairs.some((c) => c.occupants.includes(playerId));

  const handleJoin = async () => {
    if (mode === "naive") {
      pushLog({ kind: "info", text: `— naive join for ${playerId} —` });
      await naiveJoin(playerId, s.entryFee, pushLog);
      await game.touch();
      return;
    }
    const { aborted } = await game.join({ playerId });
    if (aborted !== undefined) showToast(describeAborted(aborted));
  };

  const handleStart = async () => {
    const { aborted } = await game.start();
    if (aborted !== undefined) showToast(describeAborted(aborted));
  };

  const handleChair = async (chairId: number) => {
    if (mode === "naive") {
      await naiveClaimChair(playerId, chairId, pushLog);
      await game.touch();
      return;
    }
    const { aborted } = await game.claim({ playerId, chairId });
    if (aborted !== undefined) showToast(describeAborted(aborted));
  };

  return (
    <section className="bg-[var(--paper)] border-2 border-[var(--ink)] rounded-2xl shadow-[8px_8px_0_rgba(38,32,29,0.18)] overflow-hidden">
      {/* Stage header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b-2 border-dashed border-[var(--ink)]/30">
        <PhaseBadge phase={s.phase} />
        <div className="flex items-center gap-4 font-mono2 text-sm">
          <span title="game number">🎪 game #{s.gameNumber}</span>
          {s.roundNumber > 0 && <span>round {s.roundNumber}</span>}
          <span className="bg-[var(--gold-soft)] border-2 border-[var(--ink)] rounded-lg px-3 py-1 font-bold">
            pot 🪙 {s.pot}
          </span>
        </div>
      </div>

      <div className="p-6">
        {/* LOBBY */}
        {s.phase === "LOBBY" && (
          <div className="text-center">
            <p className="mb-5 opacity-80">
              Entry costs <b>{s.entryFee} 🪙</b>. Winner takes the pot.
              {s.pot > 0 && (
                <span className="text-[var(--red)] font-bold">
                  {" "}
                  (there are {s.pot} 🪙 already in the jar!)
                </span>
              )}
            </p>
            <div className="flex flex-wrap justify-center gap-3 mb-6 min-h-12">
              {s.players.length === 0 && (
                <span className="font-mono2 text-sm opacity-50 self-center">
                  the tent is empty… be the first in
                </span>
              )}
              {s.players.map((p, i) => (
                <div
                  key={`${p}-${i}`}
                  className={`ticket px-4 py-2 font-mono2 text-sm font-bold ${i % 2 ? "rotate-1" : "-rotate-1"}`}
                >
                  🎟️ {p}
                  {p === playerId && (
                    <span className="text-[var(--teal)]"> (you)</span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-4">
              <button
                onClick={() => void handleJoin()}
                disabled={joined && mode === "reboot"}
                className="font-display text-lg bg-[var(--red)] text-white border-2 border-[var(--ink)] rounded-xl px-8 py-4 shadow-[5px_5px_0_var(--ink)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[3px_3px_0_var(--ink)] transition-all disabled:opacity-40 disabled:shadow-[5px_5px_0_var(--ink)] disabled:translate-x-0 disabled:translate-y-0"
              >
                {joined && mode === "reboot"
                  ? "🎟️ you're in!"
                  : `buy a ticket · ${s.entryFee} 🪙`}
              </button>
              <button
                onClick={() => void handleStart()}
                disabled={s.players.length < 2}
                className="font-display text-lg bg-[var(--teal)] text-white border-2 border-[var(--ink)] rounded-xl px-8 py-4 shadow-[5px_5px_0_var(--ink)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[3px_3px_0_var(--ink)] transition-all disabled:opacity-40"
              >
                start the music ▶
              </button>
            </div>
            {mode === "naive" && (
              <p className="mt-4 font-mono2 text-xs text-[var(--red)]">
                ⚠ naive mode: join = two separate HTTP calls, no
                idempotency, no transaction
              </p>
            )}
          </div>
        )}

        {/* MUSIC */}
        {s.phase === "MUSIC" && (
          <div className="text-center">
            <div className="flex justify-center mb-5">
              <Equalizer />
            </div>
            <div className="flex justify-center mb-5">
              <img
                src={dancingCat}
                alt="a cat, dancing"
                className="dancer h-48 rounded-2xl border-2 border-[var(--ink)] shadow-[6px_6px_0_rgba(38,32,29,0.25)]"
              />
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 mb-5 max-h-24 overflow-y-auto px-2">
              {s.active.map((p) => (
                <span
                  key={p}
                  className={`font-mono2 text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                    p === playerId
                      ? "bg-[var(--gold-soft)] border-[var(--ink)]"
                      : "bg-white/60 border-[var(--ink)]/30"
                  }`}
                >
                  {p === playerId ? `${p} (you)` : p}
                </span>
              ))}
            </div>
            <p className="font-mono2 text-sm opacity-70">
              chairs are being arranged backstage… when the music stops,{" "}
              <b>TAP ONE</b>. {s.active.length} dancing,{" "}
              {Math.max(s.active.length - 1, 0)} chairs coming.
            </p>
            {!active && (
              <p className="mt-3 font-mono2 text-xs text-[var(--teal)]">
                👀 you're spectating this game — join the next lobby
              </p>
            )}
          </div>
        )}

        {/* SCRAMBLE */}
        {s.phase === "SCRAMBLE" && (
          <div>
            <p className="text-center font-display text-xl text-[var(--red)] mb-2">
              {active
                ? seated
                  ? "😮‍💨 you're seated — watch the panic"
                  : "THE MUSIC STOPPED — SIT DOWN!"
                : "👀 spectating the scramble"}
            </p>
            <p className="text-center font-mono2 text-sm font-bold mb-5">
              <span className="bg-[var(--gold-soft)] border-2 border-[var(--ink)] rounded-lg px-3 py-1">
                {s.chairs.filter((c) => c.occupants.length === 0).length} of{" "}
                {s.chairs.length} chairs still open
              </span>
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(5.2rem,1fr))] gap-2 sm:gap-3">
              {s.chairs.map((chair, i) => {
                const mine = chair.occupants.includes(playerId);
                const taken = chair.occupants.length > 0;
                const overbooked = chair.occupants.length > 1;
                const canTap = active && !seated && (!taken || mode === "naive");
                return (
                  <button
                    key={chair.chairId}
                    onClick={() => void handleChair(chair.chairId)}
                    disabled={!canTap}
                    className={`chair-btn chair-appear rounded-xl border-2 p-2 text-center ${
                      overbooked
                        ? "overbooked bg-[var(--alarm)]/20 border-[var(--alarm)]"
                        : mine
                          ? "bg-[var(--gold-soft)] border-[var(--ink)]"
                          : taken
                            ? "bg-black/5 border-[var(--ink)]/30 opacity-45 grayscale"
                            : "chair-open bg-white border-[var(--ink)]"
                    }`}
                    style={{ animationDelay: `${Math.min(i * 0.03, 0.6)}s` }}
                  >
                    <div className="text-3xl leading-none mb-1">🪑</div>
                    {!taken && (
                      <div className="font-mono2 text-[10px] font-bold text-[var(--red)]">
                        TAP!
                      </div>
                    )}
                    <div className="font-mono2 text-[10px] font-bold break-all leading-tight">
                      {chair.occupants.map((occupant) => (
                        <div key={occupant}>
                          {occupant === playerId ? "you!" : occupant}
                        </div>
                      ))}
                    </div>
                    {overbooked && (
                      <div className="font-mono2 text-[9px] font-bold text-[var(--alarm)]">
                        💥 {chair.occupants.length} ON 1 CHAIR
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {mode === "naive" && (
              <p className="mt-5 text-center font-mono2 text-xs text-[var(--red)]">
                ⚠ naive mode: check-then-act — availability is a separate
                read from the sit
              </p>
            )}
          </div>
        )}

        {/* ROUND_OVER */}
        {s.phase === "ROUND_OVER" && (
          <div className="relative text-center py-6 overflow-hidden">
            {Array.from({ length: 18 }, (_, i) => (
              <span
                key={i}
                className="confetti"
                style={{
                  left: `${(i * 53) % 100}%`,
                  background:
                    i % 3 === 0
                      ? "var(--red)"
                      : i % 3 === 1
                        ? "var(--gold)"
                        : "var(--teal)",
                  animationDelay: `${(i % 6) * 0.25}s`,
                }}
              />
            ))}
            <div className="winner-pop inline-block bg-[var(--gold-soft)] border-2 border-[var(--ink)] rounded-2xl px-10 py-6 shadow-[8px_8px_0_rgba(38,32,29,0.25)]">
              <div className="text-5xl mb-2">🏆</div>
              <div className="font-display text-2xl">
                {s.lastWinner
                  ? s.lastWinner === playerId
                    ? "YOU WIN!"
                    : `${s.lastWinner} wins!`
                  : "nobody sat down?!"}
              </div>
              <div className="font-mono2 text-sm mt-1">
                {s.lastWinner
                  ? `${s.pot} 🪙 heading to their wallet…`
                  : "the pot carries over 😈"}
              </div>
            </div>
            {s.eliminatedLast.length > 0 && (
              <p className="mt-4 font-mono2 text-xs opacity-60">
                eliminated: {s.eliminatedLast.join(", ")}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
