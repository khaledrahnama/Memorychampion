import type { GameStatus } from "../lib/api";
import { STATUS_LABEL } from "../lib/format";

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="1" y="1" width="13.5" height="13.5" rx="4.5" fill="#6C47FF" />
      <rect x="17.5" y="1" width="13.5" height="13.5" rx="4.5" fill="#6C47FF" />
      <rect x="1" y="17.5" width="13.5" height="13.5" rx="4.5" fill="#6C47FF" />
      <rect x="17.5" y="17.5" width="13.5" height="13.5" rx="4.5" fill="#F5B83D" />
    </svg>
  );
}

export function Avatar({ name, className = "h-9 w-9 text-sm" }: { name?: string | null; className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-violet font-display font-extrabold text-white ${className}`}>
      {(name ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

const PILL: Record<GameStatus, string> = {
  registration_open: "bg-violet-soft text-violet-light",
  starting_soon: "bg-sun-soft text-sun",
  live: "bg-sun-soft text-sun",
  finished: "bg-mint-soft text-mint",
  cancelled: "bg-raised text-muted"
};

export function StatusPill({ status, round, rounds }: { status: GameStatus; round?: number; rounds?: number }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold ${PILL[status]}`}>
      {status === "live" && <span className="h-2 w-2 animate-pulse rounded-full bg-sun" />}
      {status === "live" && round !== undefined && rounds ? `Live · Round ${round} of ${rounds}` : STATUS_LABEL[status]}
    </span>
  );
}

/** Decorative stack of memory cards for the hero (front card mirrors a real generated card). */
export function CardStack() {
  const back = (
    <svg viewBox="0 0 300 210" className="h-full w-full">
      <defs>
        <pattern id="backdots" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="6" cy="6" r="1.4" fill="#8E73FF" />
        </pattern>
      </defs>
      <rect width="300" height="210" rx="14" fill="#6C47FF" />
      <rect x="10" y="10" width="280" height="190" rx="9" fill="url(#backdots)" stroke="#8E73FF" strokeWidth="2" />
    </svg>
  );
  return (
    <div className="relative mx-auto aspect-[3/2] w-full max-w-[460px]">
      <div className="absolute left-0 top-[22%] h-[64%] w-[64%] -rotate-[9deg] drop-shadow-2xl">{back}</div>
      <div className="absolute right-0 top-[24%] h-[64%] w-[64%] rotate-[7deg] drop-shadow-2xl">{back}</div>
      <div className="absolute left-[19%] top-[6%] h-[70%] w-[62%] -rotate-[2deg] drop-shadow-[0_30px_40px_rgba(0,0,0,0.55)]">
        <svg viewBox="0 0 600 400" className="h-full w-full overflow-hidden rounded-[18px]">
          <defs>
            <pattern id="herodots" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="11" cy="11" r="1.6" fill="#DDD3BD" />
            </pattern>
          </defs>
          <rect width="600" height="400" rx="26" fill="#F5F0E3" />
          <rect width="600" height="400" rx="26" fill="url(#herodots)" />
          {[
            [115, 185, -8], [190, 245, 12], [470, 175, 6]
          ].map(([x, y, r], i) => (
            <g key={`s${i}`} transform={`translate(${x} ${y}) rotate(${r})`} stroke="#1B1530" strokeWidth="5" strokeLinejoin="round">
              <polygon transform="translate(4 5)" fill="#1B1530" points="0,-38 9.4,-12.9 36.1,-11.7 15.2,4.9 22.3,30.8 0,16 -22.3,30.8 -15.2,4.9 -36.1,-11.7 -9.4,-12.9" />
              <polygon fill="#3E63DD" points="0,-38 9.4,-12.9 36.1,-11.7 15.2,4.9 22.3,30.8 0,16 -22.3,30.8 -15.2,4.9 -36.1,-11.7 -9.4,-12.9" />
            </g>
          ))}
          {[
            [345, 100, 30], [105, 290, 33], [470, 265, 30], [480, 345, 34]
          ].map(([x, y, r], i) => (
            <g key={`c${i}`} stroke="#1B1530" strokeWidth="5">
              <circle cx={x + 4} cy={y + 5} r={r} fill="#1B1530" />
              <circle cx={x} cy={y} r={r} fill="#F76B15" />
            </g>
          ))}
          <rect x="468" y="26" width="104" height="70" rx="12" fill="#1B1530" />
          <text x="520" y="75" textAnchor="middle" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontSize="40" fill="#F5F0E3">47</text>
        </svg>
      </div>
    </div>
  );
}
