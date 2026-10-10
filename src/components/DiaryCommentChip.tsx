import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { LoaderCircle } from "lucide-react";
import type { DiaryComment, DiaryCommentReaction } from "../db/diaryComments";
import { COMMENT_ICONS } from "../utils/commentRules.mjs";
import InteractionFeedback, {
  type InteractionPulse,
} from "./InteractionFeedback";
import { useFloatingPopover, usePopoverDismiss } from "./useFloatingPopover";

export default function DiaryCommentChip({
  comment,
  removing,
  reacting,
  onRemove,
  onReact,
  onRequestRemove,
  entering = false,
  onEntered,
}: {
  comment: DiaryComment;
  removing: boolean;
  reacting: boolean;
  onRemove: () => Promise<boolean>;
  onReact: () => Promise<DiaryCommentReaction | null>;
  onRequestRemove: () => void;
  entering?: boolean;
  onEntered?: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const [confirming, setConfirming] = useState(false);
  const [pulse, setPulse] = useState<InteractionPulse | null>(null);
  const sequence = useRef(0);
  const [entryWidth, setEntryWidth] = useState<number | null>(null);
  const enteredCallback = useRef(onEntered);
  enteredCallback.current = onEntered;
  useLayoutEffect(() => {
    setEntryWidth(
      entering && anchor.current
        ? anchor.current.getBoundingClientRect().width
        : null
    );
  }, [entering]);
  useEffect(() => {
    if (!entering) return;
    const timer = setTimeout(() => enteredCallback.current?.(), 550);
    return () => clearTimeout(timer);
  }, [entering]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const position = useFloatingPopover({
    open: confirming,
    anchor,
    panel: tip,
    width: 160,
    align: "center",
  });
  usePopoverDismiss({
    open: confirming,
    anchor,
    panel: tip,
    busy: removing,
    onDismiss: () => setConfirming(false),
  });
  async function interact() {
    if (comment.isOwn) {
      onRequestRemove();
      setConfirming(true);
      return;
    }
    const result = await onReact();
    if (result && alive.current)
      setPulse({
        text: result.is_active ? "+1" : "−1",
        key: ++sequence.current,
      });
  }
  async function confirmRemove() {
    const success = await onRemove();
    if (success && alive.current) setConfirming(false);
  }
  const count = comment.interaction_count ?? 0;
  const active = comment.isOwn || comment.has_reacted;
  return (
    <span
      className={`relative inline-flex max-w-full ${entering && entryWidth !== null ? "diary-comment-enter" : ""}`}
      style={
        entryWidth === null
          ? undefined
          : ({ "--diary-comment-width": `${entryWidth}px` } as CSSProperties)
      }
      onAnimationEnd={event => {
        if (
          event.target === event.currentTarget &&
          event.animationName === "diary-comment-enter"
        )
          onEntered?.();
      }}
    >
      <button
        ref={anchor}
        type="button"
        aria-label={
          comment.isOwn
            ? `撤回自己的评论：${comment.message || comment.emoji}`
            : `${comment.has_reacted ? "取消互动" : "为评论加一"}：${comment.message || comment.emoji}`
        }
        aria-pressed={Boolean(active)}
        disabled={removing || reacting}
        title={
          comment.isOwn
            ? "点击确认撤回你的评论"
            : comment.has_reacted
              ? "再次点击取消互动"
              : "为这条评论加一"
        }
        onClick={() => void interact()}
        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-xs leading-4 transition-colors disabled:cursor-wait disabled:opacity-60 ${active ? "border-accent/40 bg-accent/10 hover:bg-accent/15" : "border-border bg-background hover:border-accent/40 hover:bg-accent/5"}`}
      >
        {comment.emoji && (
          <span
            role="img"
            aria-label={
              COMMENT_ICONS.find(icon => icon.emoji === comment.emoji)?.label ??
              "图标"
            }
          >
            {comment.emoji}
          </span>
        )}
        {comment.nickname && (
          <span className="max-w-28 truncate text-foreground/60">
            {comment.nickname}
          </span>
        )}
        {comment.message && (
          <span className="break-all">{comment.message}</span>
        )}
        {comment.status === "pending" && (
          <span className="shrink-0 text-[10px] text-foreground/50">
            未通过审核
          </span>
        )}
        {removing || reacting ? (
          <LoaderCircle
            size={12}
            className="shrink-0 animate-spin"
            aria-hidden="true"
          />
        ) : null}
      </button>
      <InteractionFeedback
        count={count}
        pulse={pulse}
        onPulseEnd={key =>
          setPulse(current => (current?.key === key ? null : current))
        }
      />
      {confirming &&
        createPortal(
          <div
            ref={tip}
            role="dialog"
            aria-label="确认删除评论"
            style={{
              ...position,
              visibility: position.width ? "visible" : "hidden",
            }}
            className="fixed z-[60] rounded-lg border border-border bg-background p-2 text-xs text-foreground shadow-xl"
          >
            <p className="mb-2 text-center">确定删除这条评论？</p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                disabled={removing}
                onClick={() => {
                  setConfirming(false);
                  anchor.current?.focus({ preventScroll: true });
                }}
                className="rounded border border-border px-2 py-1 text-foreground/70 hover:text-foreground"
              >
                取消
              </button>
              <button
                type="button"
                disabled={removing}
                onClick={() => void confirmRemove()}
                className="rounded border border-red-500/30 bg-red-500/5 px-2 py-1 text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
              >
                {removing ? "删除中…" : "删除"}
              </button>
            </div>
          </div>,
          document.body
        )}
    </span>
  );
}
