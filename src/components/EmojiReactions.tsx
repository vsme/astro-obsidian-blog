import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { LoaderCircle } from "lucide-react";
import { usePopoverDismiss } from "./useFloatingPopover";
import InteractionFeedback, {
  type InteractionPulse,
} from "./InteractionFeedback";
import {
  getCachedContentReactions,
  getContentReactions,
  toggleEmojiReaction,
  generateUserHash,
  type ReactionRow,
} from "../db/supabase";

// 表情数据接口
interface EmojiReaction {
  emoji: string;
  label: string;
  count: number;
  isActive: boolean;
}

interface ReactionSyncDetail {
  contentId: string;
  emoji: string;
  count: number;
  isActive: boolean;
}

const REACTION_SYNC_EVENT = "astro-paper:reaction-sync";

function mergeReactionRows(reactions: EmojiReaction[], rows: ReactionRow[]) {
  return reactions.map(reaction => {
    const cachedReaction = rows.find(row => row.emoji === reaction.emoji);
    return {
      ...reaction,
      count: cachedReaction?.count ?? 0,
      isActive: cachedReaction?.is_active ?? false,
    };
  });
}

// 表情按钮组件
const EmojiButton: React.FC<{
  emoji: string;
  label: string;
  count: number;
  isActive: boolean;
  loading?: boolean;
  pulse?: InteractionPulse;
  onPulseEnd: (key: number) => void;
  onClick: () => void;
}> = ({
  emoji,
  label,
  count,
  isActive,
  loading = false,
  pulse,
  onPulseEnd,
  onClick,
}) => {
  return (
    <span className="relative inline-flex">
      <button
        aria-label={`表示 ${label}${count > 0 ? ` (${count})` : ""}`}
        type="button"
        aria-pressed={isActive}
        disabled={loading}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 transition-all duration-200 ${
          loading ? "cursor-not-allowed opacity-60" : "hover:scale-105"
        } ${
          isActive
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border bg-background"
        }`}
        onClick={onClick}
      >
        {loading ? (
          <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
        ) : (
          <span className="text-xs">{emoji}</span>
        )}
      </button>
      <InteractionFeedback
        count={count}
        pulse={pulse}
        onPulseEnd={onPulseEnd}
      />
    </span>
  );
};

// 主要的表情组件
interface EmojiReactionsProps {
  id: string;
  inline?: boolean;
  menuAlign?: "auto" | "contained" | "left" | "center" | "right";
  data?: { userHash: string; rows: ReactionRow[] } | null;
  afterMenu?: React.ReactNode;
  children?: React.ReactNode;
}

const EmojiReactions: React.FC<EmojiReactionsProps> = ({
  id,
  menuAlign = "auto",
  inline = false,
  data,
  afterMenu,
  children,
}) => {
  const [hoveredEmoji, setHoveredEmoji] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<"left" | "center" | "right">(
    "center"
  );
  const [loadingEmoji, setLoadingEmoji] = useState<string[]>([]);
  const [pulses, setPulses] = useState<Record<string, InteractionPulse>>({});
  const sequence = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [userHash, setUserHash] = useState<string>("");
  const reactionsRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [emojiReactions, setEmojiReactions] = useState<EmojiReaction[]>([
    { emoji: "👍", label: "+1", count: 0, isActive: false },
    { emoji: "👎", label: "-1", count: 0, isActive: false },
    { emoji: "😄", label: "大笑", count: 0, isActive: false },
    { emoji: "😕", label: "困惑", count: 0, isActive: false },
    { emoji: "🎉", label: "好耶", count: 0, isActive: false },
    { emoji: "❤️", label: "爱了", count: 0, isActive: false },
    { emoji: "🚀", label: "太快啦", count: 0, isActive: false },
    { emoji: "👀", label: "围观", count: 0, isActive: false },
  ]);

  // 水合后、首次绘制前优先恢复短时缓存；未命中时再请求 Supabase。
  useLayoutEffect(() => {
    const currentUserHash = data?.userHash ?? generateUserHash();
    setUserHash(currentUserHash);

    const rows = data?.rows ?? getCachedContentReactions(id, currentUserHash);
    if (rows) setEmojiReactions(previous => mergeReactionRows(previous, rows));
    if (data !== undefined || rows) return;

    let cancelled = false;
    void getContentReactions(id, currentUserHash)
      .then(reactions => {
        if (!cancelled) {
          setEmojiReactions(previous => mergeReactionRows(previous, reactions));
        }
      })
      .catch(error => {
        console.error("Failed to load reactions:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [id, data]);

  // 同一内容可能同时出现在地图弹窗和时间线中，保持两个实例即时同步。
  useEffect(() => {
    const handleReactionSync = (event: Event) => {
      const { contentId, emoji, count, isActive } = (
        event as CustomEvent<ReactionSyncDetail>
      ).detail;
      if (contentId !== id) return;

      setEmojiReactions(previous =>
        previous.map(reaction =>
          reaction.emoji === emoji ? { ...reaction, count, isActive } : reaction
        )
      );
    };

    window.addEventListener(REACTION_SYNC_EVENT, handleReactionSync);
    return () =>
      window.removeEventListener(REACTION_SYNC_EVENT, handleReactionSync);
  }, [id]);

  usePopoverDismiss({
    open: isMenuOpen,
    anchor: buttonRef,
    panel: menuRef,
    onDismiss: () => setIsMenuOpen(false),
  });
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error]);

  // 处理表情点击
  const handleEmojiClick = async (reaction: EmojiReaction) => {
    setLoadingEmoji(prev => [...prev, reaction.emoji]);
    setError(null);

    try {
      const result = await toggleEmojiReaction(id, reaction.emoji, userHash);

      if (result) {
        const pulse = {
          text: result.is_active ? "+1" : "−1",
          key: ++sequence.current,
        };
        setPulses(previous => ({
          ...previous,
          [result.emoji]: pulse,
        }));
        window.dispatchEvent(
          new CustomEvent<ReactionSyncDetail>(REACTION_SYNC_EVENT, {
            detail: {
              contentId: id,
              emoji: result.emoji,
              count: result.new_count,
              isActive: result.is_active,
            },
          })
        );
      }
    } catch (error) {
      console.error("Failed to toggle reaction:", error);
      setError(error instanceof Error ? error.message : "操作失败，请稍后重试");
    } finally {
      setLoadingEmoji(prev => prev.filter(emoji => emoji !== reaction.emoji));
    }

    // 点击表情后关闭菜单
    setIsMenuOpen(false);
  };

  const toggleMenu = () => {
    if (isMenuOpen) {
      setIsMenuOpen(false);
      return;
    }
    if (menuAlign !== "auto" && menuAlign !== "contained") {
      setMenuPosition(menuAlign);
    } else if (buttonRef.current) {
      const bounds = buttonRef.current.getBoundingClientRect();
      const center = bounds.left + bounds.width / 2;
      const content =
        menuAlign === "contained"
          ? reactionsRef.current?.getBoundingClientRect()
          : null;
      const left = content ? content.left + 96 : window.innerWidth * 0.2;
      const right = content ? content.right - 96 : window.innerWidth * 0.8;
      setMenuPosition(
        center < left ? "left" : center > right ? "right" : "center"
      );
    }
    setIsMenuOpen(true);
  };

  return (
    <div
      id={id}
      ref={reactionsRef}
      className={`emoji-reactions border-skin-line/30 ${inline ? "" : "mt-4"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex shrink-0 items-center gap-2">
          {/* GitHub风格的表情菜单 */}
          <div className="relative leading-[0]" ref={menuRef}>
            <button
              ref={buttonRef}
              aria-label="添加回应"
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border px-1 py-1 transition-all duration-200 hover:bg-background"
              onClick={toggleMenu}
            >
              <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 16 16"
                width="16"
                height="16"
                fill="currentColor"
                className="octicon octicon-smiley"
                style={{ verticalAlign: "text-bottom" }}
              >
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm3.82 1.636a.75.75 0 0 1 1.038.175l.007.009c.103.118.22.222.35.31.264.178.683.37 1.285.37.602 0 1.02-.192 1.285-.371.13-.088.247-.192.35-.31l.007-.008a.75.75 0 0 1 1.222.87l-.022-.015c.02.013.021.015.021.015v.001l-.001.002-.002.003-.005.007-.014.019a2.066 2.066 0 0 1-.184.213c-.16.166-.338.316-.53.445-.63.418-1.37.638-2.127.629-.946 0-1.652-.308-2.126-.63a3.331 3.331 0 0 1-.715-.657l-.014-.02-.005-.006-.002-.003v-.002h-.001l.613-.432-.614.43a.75.75 0 0 1 .183-1.044ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM5 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5.25 2.25.592.416a97.71 97.71 0 0 0-.592-.416Z"></path>
              </svg>
            </button>

            {isMenuOpen && (
              <div
                className={`absolute bottom-full z-50 mb-2 min-w-max rounded-lg border bg-[var(--background)] p-0 shadow-xl ${
                  menuPosition === "right"
                    ? "right-0"
                    : menuPosition === "center"
                      ? "left-1/2 -translate-x-1/2"
                      : "left-0"
                }`}
              >
                <p className="m-2 overflow-hidden text-sm text-ellipsis whitespace-nowrap text-foreground/70">
                  {hoveredEmoji
                    ? emojiReactions.find(r => r.emoji === hoveredEmoji)
                        ?.label || "发表你的看法"
                    : "发表你的看法"}
                </p>
                <div className="my-2 border-t border-border"></div>
                <div className="m-2 grid grid-cols-4 gap-1">
                  {emojiReactions.map(reaction => (
                    <button
                      key={reaction.emoji}
                      aria-label={
                        reaction.isActive
                          ? `取消 ${reaction.label}`
                          : `表示 ${reaction.label}`
                      }
                      type="button"
                      disabled={loadingEmoji.includes(reaction.emoji)}
                      className={`rounded-md p-1.5 transition-all duration-200 ${
                        loadingEmoji.includes(reaction.emoji)
                          ? "cursor-not-allowed opacity-60"
                          : "hover:scale-125"
                      } ${reaction.isActive ? "bg-accent/10" : ""}`}
                      onClick={() => handleEmojiClick(reaction)}
                      onMouseEnter={() => setHoveredEmoji(reaction.emoji)}
                      onMouseLeave={() => setHoveredEmoji(null)}
                    >
                      {loadingEmoji.includes(reaction.emoji) ? (
                        <div className="flex items-center justify-center">
                          <LoaderCircle
                            size={16}
                            className="animate-spin"
                            aria-hidden="true"
                          />
                        </div>
                      ) : (
                        <span className="text-base">{reaction.emoji}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {afterMenu}
        </div>
        {/* 已激活的表情显示 */}
        {emojiReactions
          .filter(
            reaction =>
              reaction.count > 0 || reaction.isActive || pulses[reaction.emoji]
          )
          .map(reaction => (
            <EmojiButton
              key={reaction.emoji}
              emoji={reaction.emoji}
              label={reaction.label}
              count={reaction.count}
              isActive={reaction.isActive}
              loading={loadingEmoji.includes(reaction.emoji)}
              pulse={pulses[reaction.emoji]}
              onPulseEnd={key =>
                setPulses(previous => {
                  if (previous[reaction.emoji]?.key !== key) return previous;
                  const next = { ...previous };
                  delete next[reaction.emoji];
                  return next;
                })
              }
              onClick={() => handleEmojiClick(reaction)}
            />
          ))}

        {children}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="error-message absolute mt-2 flex animate-in items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 transition-all duration-300 fade-in slide-in-from-top-2 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          <svg
            className="h-4 w-4 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

export default EmojiReactions;
