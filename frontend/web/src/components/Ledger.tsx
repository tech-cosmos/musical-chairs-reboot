import type { UseGameApi } from "@api/chairs/v1/game_rbt_react";
import { type FC } from "react";

// The invariant dashboard: conservation of coins, one body per chair.
// Green means the system survived; red means a naive path lost money.
export const Ledger: FC<{ game: UseGameApi }> = ({ game }) => {
  const { response } = game.useDashboard();

  const broken =
    response !== undefined &&
    (!response.coinsConserved ||
      response.overbookedChairs > 0 ||
      response.unverifiedFees > 0);

  return (
    <section
      className={`bg-[var(--paper)] border-2 rounded-2xl shadow-[8px_8px_0_rgba(38,32,29,0.18)] overflow-hidden ${
        broken ? "ledger-broken border-[var(--alarm)]" : "border-[var(--ink)]"
      }`}
    >
      <div className="px-5 py-3 border-b-2 border-dashed border-[var(--ink)]/30 flex items-center justify-between">
        <h2 className="font-display text-sm flex items-center gap-2">
          <span className="text-lg">⚖️</span> The Ledger
        </h2>
        <button
          onClick={() => void game.touch()}
          className="font-mono2 text-xs underline decoration-dashed opacity-60 hover:opacity-100"
          title="Re-audit the books"
        >
          re-audit
        </button>
      </div>

      {response === undefined ? (
        <p className="px-5 py-4 font-mono2 text-sm animate-pulse">
          counting coins…
        </p>
      ) : (
        <div className="px-5 py-4">
          <div
            className={`rounded-lg border-2 px-4 py-3 mb-4 font-mono2 text-sm font-bold text-center ${
              broken
                ? "bg-[var(--alarm)]/10 border-[var(--alarm)] text-[var(--alarm)]"
                : "bg-[var(--teal)]/10 border-[var(--teal)] text-[var(--teal)]"
            }`}
          >
            {!broken && "✓ EVERY COIN ACCOUNTED FOR"}
            {response.missing > 0 && `✗ ${response.missing} COINS VANISHED`}
            {response.missing < 0 &&
              `✗ ${-response.missing} COINS CONJURED FROM NOWHERE`}
            {response.unverifiedFees > 0 && (
              <div className="mt-1">
                ✗ {response.unverifiedFees} COINS OF FEES NEVER VERIFIED
              </div>
            )}
            {response.overbookedChairs > 0 && (
              <div className="mt-1">
                ✗ {response.overbookedChairs} CHAIR
                {response.overbookedChairs > 1 ? "S" : ""} DOUBLE-BOOKED
              </div>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-2 font-mono2 text-[13px] mb-4">
            <dt className="opacity-60">minted</dt>
            <dd className="text-right font-bold">🪙 {response.minted}</dd>
            <dt className="opacity-60">in wallets</dt>
            <dd className="text-right font-bold">🪙 {response.totalBalances}</dd>
            <dt className="opacity-60">in the pot</dt>
            <dd className="text-right font-bold">🪙 {response.pot}</dd>
            <dt className="opacity-60">paid to winners</dt>
            <dd className="text-right font-bold">🪙 {response.payouts}</dd>
          </dl>

          <ul className="font-mono2 text-xs border-t-2 border-dashed border-[var(--ink)]/20 pt-3 space-y-1 max-h-36 overflow-y-auto">
            {response.balances.map((balance) => (
              <li key={balance.playerId} className="flex justify-between">
                <span>{balance.playerId}</span>
                <span>
                  🪙 {balance.coins}
                  {balance.wins > 0 && ` · 🏆 ${balance.wins}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
