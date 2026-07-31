import { useGame } from "@api/chairs/v1/game_rbt_react";
import { usePlayer } from "@api/chairs/v1/player_rbt_react";
import { useEffect, useRef, useState, type FC } from "react";
import { ChaosLab } from "./components/ChaosLab.tsx";
import { EventFeed } from "./components/EventFeed.tsx";
import { Ledger } from "./components/Ledger.tsx";
import { Stage } from "./components/Stage.tsx";
import { GAME_ID, type ChaosLogLine } from "./naive.ts";

export type Mode = "reboot" | "naive";

export type LogLine = ChaosLogLine & { seq: number };

const NAME_KEY = "musical-chairs-player";

// Ticket-booth name gate.
const Gate: FC<{ onEnter: (name: string) => void }> = ({ onEnter }) => {
  const [name, setName] = useState("");
  const submit = () => {
    const trimmed = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (trimmed) onEnter(trimmed);
  };
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="tent-stripes h-6 rounded-t-2xl border-2 border-b-0 border-[var(--ink)]" />
        <div className="bg-[var(--paper)] border-2 border-[var(--ink)] rounded-b-2xl shadow-[8px_8px_0_rgba(38,32,29,0.25)] p-8 text-center">
          <div className="flex justify-center gap-2 mb-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="bulb"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </div>
          <h1 className="font-display text-4xl text-[var(--red)] leading-tight mb-1">
            Musical Chairs
          </h1>
          <p className="text-sm text-[var(--teal)] font-bold uppercase tracking-widest mb-6">
            The production-reliability carnival
          </p>
          <p className="text-sm mb-6 opacity-80">
            Pay 10 🪙 a round. Grab a chair when the music stops. Try not
            to lose your coins to a distributed-systems bug.
          </p>
          <input
            value={name}
            onChange={(e) => setName((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="your player name"
            maxLength={16}
            className="w-full text-center font-mono2 text-lg bg-white border-2 border-[var(--ink)] rounded-lg px-4 py-3 mb-4 focus:outline-none focus:border-[var(--red)]"
          />
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="w-full font-display text-lg bg-[var(--gold)] border-2 border-[var(--ink)] rounded-lg py-3 shadow-[4px_4px_0_var(--ink)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_var(--ink)] transition-all disabled:opacity-40"
          >
            Step right up →
          </button>
        </div>
      </div>
    </main>
  );
};

const Arena: FC<{ playerId: string; onLeave: () => void }> = ({
  playerId,
  onLeave,
}) => {
  const game = useGame({ id: GAME_ID });
  const player = usePlayer({ id: playerId });
  const { response: snapshot } = game.useGet();
  const { response: me } = player.useGet();

  const [mode, setMode] = useState<Mode>("reboot");
  const [log, setLog] = useState<LogLine[]>([]);
  const [toast, setToast] = useState<string | undefined>();
  const seq = useRef(0);

  // Construct this Player on first mount; an "already constructed"
  // abort just means we've played before.
  useEffect(() => {
    void player.create().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  const pushLog = (line: ChaosLogLine) => {
    seq.current += 1;
    const entry = { ...line, seq: seq.current };
    setLog((previous) => [entry, ...previous].slice(0, 60));
  };

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 3500);
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="tent-stripes border-b-4 border-[var(--ink)]">
        <div className="max-w-7xl mx-auto px-4 py-5 flex flex-wrap items-center justify-between gap-3">
          <div className="bg-[var(--paper)] border-2 border-[var(--ink)] rounded-xl px-5 py-2 shadow-[5px_5px_0_rgba(38,32,29,0.35)] -rotate-1">
            <h1 className="font-display text-2xl sm:text-3xl text-[var(--red)]">
              🎪 Musical Chairs
            </h1>
            <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--teal)]">
              can your agent-written code survive production?
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="ticket px-4 py-2 rotate-1">
              <div className="font-mono2 text-sm font-bold">{playerId}</div>
              <div className="font-mono2 text-xs">
                🪙 {me?.coins ?? "…"} · 🏆 {me?.wins ?? 0}
              </div>
            </div>
            <button
              onClick={() => void player.buyCoins({ amount: 50 })}
              className="bg-[var(--gold)] border-2 border-[var(--ink)] rounded-lg px-3 py-2 text-sm font-bold shadow-[3px_3px_0_var(--ink)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_var(--ink)] transition-all"
              title="Mint 50 coins (recorded on the ledger)"
            >
              +50 🪙
            </button>
            <button
              onClick={onLeave}
              className="text-xs font-bold underline decoration-dashed text-[var(--paper)] drop-shadow"
            >
              leave
            </button>
          </div>
        </div>
      </header>

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[var(--ink)] text-[var(--paper)] font-mono2 text-sm px-5 py-3 rounded-lg shadow-xl border border-[var(--gold)]">
          {toast}
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Stage
            game={game}
            snapshot={snapshot}
            playerId={playerId}
            mode={mode}
            pushLog={pushLog}
            showToast={showToast}
          />
          <EventFeed events={snapshot?.events ?? []} />
        </div>
        <div className="space-y-6">
          <Ledger game={game} />
          <ChaosLab
            game={game}
            snapshot={snapshot}
            playerId={playerId}
            mode={mode}
            setMode={setMode}
            log={log}
            pushLog={pushLog}
          />
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-4 pb-8 text-center text-xs opacity-60 font-mono2">
        durable state, transactions & idempotency by{" "}
        <a href="https://reboot.dev" className="underline">
          reboot.dev
        </a>{" "}
        — chaos by design
      </footer>
    </div>
  );
};

const App: FC = () => {
  const [playerId, setPlayerId] = useState<string | undefined>(
    () => window.localStorage.getItem(NAME_KEY) ?? undefined
  );
  if (playerId === undefined) {
    return (
      <Gate
        onEnter={(name) => {
          window.localStorage.setItem(NAME_KEY, name);
          setPlayerId(name);
        }}
      />
    );
  }
  return (
    <Arena
      playerId={playerId}
      onLeave={() => {
        window.localStorage.removeItem(NAME_KEY);
        setPlayerId(undefined);
      }}
    />
  );
};

export default App;
