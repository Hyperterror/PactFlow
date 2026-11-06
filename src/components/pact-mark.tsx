import { cn } from "@/lib/cn";

/**
 * The PactFlow mark.
 *
 * Two arcs that approach each other from opposite sides and never quite close:
 * one continuous ring, formed by two parties, held open by the agreement they
 * share. It is deliberately abstract — no handshake, no brain, no dollar sign —
 * and it draws entirely in `currentColor` so it survives monochrome printing,
 * an app icon tile, and the wordmark lockup without a second asset.
 */
export function PactMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("h-5 w-5", className)}
    >
      <path
        d="M19.4 6.4a10.4 10.4 0 0 1 0 19.2"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      <path
        d="M12.6 25.6a10.4 10.4 0 0 1 0-19.2"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        opacity="0.72"
      />
    </svg>
  );
}

/**
 * Mark in an app-icon tile. Used wherever the mark needs to sit on the ivory
 * canvas and hold its own contrast.
 */
export function PactMarkTile({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground",
        className,
      )}
    >
      <PactMark className="h-[18px] w-[18px]" />
    </span>
  );
}

/** Mark + wordmark. The lockup used in navigation and on the auth rail. */
export function PactWordmark({
  className,
  tileClassName,
  showTile = true,
}: {
  className?: string;
  tileClassName?: string;
  showTile?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      {showTile ? <PactMarkTile className={tileClassName} /> : <PactMark className="h-6 w-6" />}
      <span className="text-sm font-semibold tracking-[-0.01em]">PactFlow</span>
    </span>
  );
}
