import { type FC } from "react";

export const EventFeed: FC<{ events: string[] }> = ({ events }) => (
  <section className="bg-[var(--paper)] border-2 border-[var(--ink)] rounded-2xl shadow-[8px_8px_0_rgba(38,32,29,0.18)] overflow-hidden">
    <div className="px-5 py-3 border-b-2 border-dashed border-[var(--ink)]/30 flex items-center gap-2">
      <span className="text-lg">📯</span>
      <h2 className="font-display text-sm">Ringmaster's Feed</h2>
    </div>
    <ul className="px-5 py-3 max-h-56 overflow-y-auto font-mono2 text-[13px] leading-relaxed">
      {events.length === 0 && (
        <li className="opacity-50">nothing has happened yet…</li>
      )}
      {events.map((event, i) => (
        <li
          key={`${event}-${i}`}
          className={`feed-item py-0.5 ${i === 0 ? "font-bold" : ""}`}
          style={{ opacity: Math.max(1 - i * 0.03, 0.45) }}
        >
          {event}
        </li>
      ))}
    </ul>
  </section>
);
