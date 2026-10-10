import { useEffect, useRef } from "react";
import "../styles/diary-comments.css";

export type InteractionPulse = { text: string; key: number };

export default function InteractionFeedback({
  count,
  countLabel = "次互动",
  pulse,
  onPulseEnd,
}: {
  count: number;
  countLabel?: string;
  pulse?: InteractionPulse | null;
  onPulseEnd: (key: number) => void;
}) {
  const finished = useRef(onPulseEnd);
  finished.current = onPulseEnd;
  useEffect(() => {
    if (!pulse) return;
    const timer = setTimeout(() => finished.current(pulse.key), 750);
    return () => clearTimeout(timer);
  }, [pulse]);
  return (
    <>
      {count > 1 && (
        <span
          className="pointer-events-none absolute -top-1.5 -right-1.5 rounded-full border border-border bg-background px-1 font-mono text-[10px] leading-3.5 text-accent"
          aria-label={`${count} ${countLabel}`}
        >
          +{count}
        </span>
      )}
      {pulse && (
        <span
          key={pulse.key}
          aria-hidden="true"
          className="diary-comment-reaction-pop pointer-events-none absolute -top-5 right-0 text-xs font-semibold text-accent"
        >
          {pulse.text}
        </span>
      )}
    </>
  );
}
