import React, { useState, useRef, useEffect } from "react";
import {
  getContentReactions,
  toggleEmojiReaction,
  generateUserHash,
} from "../db/supabase";

// Loading 图标组件
const LoadingSpinner: React.FC<{ size?: "sm" | "md" }> = ({ size = "sm" }) => {
  const sizeClass = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  return (
    <svg
      className={`${sizeClass} animate-spin text-current`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  );
};

// 表情数据接口
interface EmojiReaction {
  emoji: string;
  label: string;
  count: number;
  isActive: boolean;
  defaultShow?: boolean;
}

// 表情按钮组件
const EmojiButton: React.FC<{
  emoji: string;
  label: string;
  count: number;
  isActive: boolean;
  loading?: boolean;
  onClick: () => void;
}> = ({ emoji, label, count, isActive, loading = false, onClick }) => {
  return (
    <button
      aria-label={`表示 ${label}${count > 0 ? ` (${count})` : ""}`}
      type="button"
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
        <div className="flex items-center gap-1">
          <LoadingSpinner size="sm" />
          {count > 0 && (
            <span className="text-center text-xs font-medium">{count}</span>
          )}
        </div>
      ) : (
        <>
          <span className="text-xs">{emoji}</span>
          {count > 0 && (
            <span className="text-center text-xs font-medium">{count}</span>
          )}
        </>
      )}
    </button>
  );
};

// 主要的表情组件
const EmojiReactions: React.FC<{ id: string }> = ({ id }) => {
  const [hoveredEmoji, setHoveredEmoji] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<"left" | "center" | "right">(
    "center"
  );
  const [loadingEmoji, setLoadingEmoji] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userHash, setUserHash] = useState<string>("");
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [emojiReactions, setEmojiReactions] = useState<EmojiReaction[]>([
    { emoji: "👍", label: "+1", count: 0, isActive: false, defaultShow: false },
    { emoji: "👎", label: "-1", count: 0, isActive: false, defaultShow: false },
    { emoji: "😄", label: "大笑", count: 0, isActive: false },
    { emoji: "😕", label: "困惑", count: 0, isActive: false },
    { emoji: "🎉", label: "好耶", count: 0, isActive: false },
    { emoji: "❤️", label: "爱了", count: 0, isActive: false },
    { emoji: "🚀", label: "太快啦", count: 0, isActive: false },
    { emoji: "👀", label: "围观", count: 0, isActive: false },
  ]);

  // 初始化用户哈希（仅在客户端）
  useEffect(() => {
    setUserHash(generateUserHash());
  }, []);

  // 加载表情数据
  useEffect(() => {
    if (!userHash) return; // 等待 userHash 初始化完成

    const loadReactions = async () => {
      try {
        const reactions = await getContentReactions(id, userHash);

        setEmojiReactions(prev =>
          prev.map(reaction => {
            const dbReaction = reactions.find(
              (r: { emoji: string; count: number; is_active: boolean }) =>
                r.emoji === reaction.emoji
            );
            return {
              ...reaction,
              count: dbReaction?.count || 0,
              isActive: dbReaction?.is_active || false,
            };
          })
        );
      } catch (error) {
        console.error("Failed to load reactions:", error);
      }
    };

    loadReactions();
  }, [id, userHash]);

  // 监听点击外部区域事件
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMenuOpen]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = null;
      }
    };
  }, []);

  // 处理表情点击
  const handleEmojiClick = async (index: number) => {
    const reaction = emojiReactions[index];
    setLoadingEmoji(prev => [...prev, reaction.emoji]);
    // 清除之前的错误和定时器
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = null;
    }
    setError(null);

    try {
      const result = await toggleEmojiReaction(id, reaction.emoji, userHash);

      if (result) {
        setEmojiReactions(prev =>
          prev.map((r, i) => {
            if (i === index) {
              return {
                ...r,
                count: result.new_count,
                isActive: result.is_active,
              };
            }
            return r;
          })
        );
      }
    } catch (error) {
      console.error("Failed to toggle reaction:", error);
      setError("操作失败，请稍后重试");

      // 3秒后自动清除错误提示
      errorTimeoutRef.current = setTimeout(() => {
        setError(null);
        errorTimeoutRef.current = null;
      }, 3000);
    } finally {
      setLoadingEmoji(prev => prev.filter(emoji => emoji !== reaction.emoji));
    }

    // 点击表情后关闭菜单
    setIsMenuOpen(false);
  };

  // 切换菜单显示状态
  const toggleMenu = () => {
    if (!isMenuOpen && buttonRef.current) {
      // 检测按钮位置来决定菜单显示方向
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const buttonCenterX = buttonRect.left + buttonRect.width / 2;

      // 根据按钮位置决定菜单显示方向
      if (buttonCenterX < windowWidth * 0.2) {
        setMenuPosition("left");
      } else if (buttonCenterX > windowWidth * 0.8) {
        setMenuPosition("right");
      } else {
        setMenuPosition("center");
      }
    }
    setIsMenuOpen(!isMenuOpen);
  };

  return (
    <div id={id} className="emoji-reactions border-skin-line/30 mt-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* 已激活的表情显示 */}
        {emojiReactions
          .filter(
            reaction =>
              reaction.count > 0 || reaction.isActive || reaction.defaultShow
          )
          .map(reaction => (
            <EmojiButton
              key={reaction.emoji}
              emoji={reaction.emoji}
              label={reaction.label}
              count={reaction.count}
              isActive={reaction.isActive}
              loading={loadingEmoji.includes(reaction.emoji)}
              onClick={() => handleEmojiClick(emojiReactions.indexOf(reaction))}
            />
          ))}

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
                  ? emojiReactions.find(r => r.emoji === hoveredEmoji)?.label ||
                    "发表你的看法"
                  : "发表你的看法"}
              </p>
              <div className="my-2 border-t border-border"></div>
              <div className="m-2 grid grid-cols-4 gap-1">
                {emojiReactions
                  .filter(reaction => !reaction.defaultShow)
                  .map(reaction => (
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
                      onClick={() =>
                        handleEmojiClick(emojiReactions.indexOf(reaction))
                      }
                      onMouseEnter={() => setHoveredEmoji(reaction.emoji)}
                      onMouseLeave={() => setHoveredEmoji(null)}
                    >
                      {loadingEmoji.includes(reaction.emoji) ? (
                        <div className="flex items-center justify-center">
                          <LoadingSpinner size="md" />
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
