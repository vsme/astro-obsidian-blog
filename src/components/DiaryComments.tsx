import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ComponentProps,
} from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, X } from "lucide-react";
import DiaryCommentChip from "./DiaryCommentChip";
import EmojiReactions from "./EmojiReactions";
import { useFloatingPopover, usePopoverDismiss } from "./useFloatingPopover";
import {
  getDiaryInteractions,
  getCachedDiaryComments,
  getDiaryCommentCooldown,
  COMMENT_COOLDOWN_EVENT,
  DiaryCommentRateLimitError,
  submitDiaryComment,
  removeDiaryComment,
  toggleDiaryCommentReaction,
  type DiaryCommentReaction,
  type DiaryComment,
} from "../db/diaryComments";
import {
  COMMENT_LIMIT,
  NICKNAME_LIMIT,
  countCharacters,
} from "../utils/commentRules.mjs";

export default function DiaryComments({
  contentId,
  menuAlign = "auto",
}: {
  contentId: string;
  menuAlign?: ComponentProps<typeof EmojiReactions>["menuAlign"];
}) {
  const uid = useId();
  const root = useRef<HTMLDivElement>(null),
    form = useRef<HTMLFormElement>(null),
    button = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [comments, setComments] = useState<DiaryComment[]>([]);
  const [emojiData, setEmojiData] =
    useState<Awaited<ReturnType<typeof getDiaryInteractions>>["emojiData"]>(
      null
    );
  const [expanded, setExpanded] = useState(false),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""),
    [nickname, setNickname] = useState(""),
    [email, setEmail] = useState("");
  const [error, setError] = useState(""),
    [loadError, setLoadError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState<{ text: string; key: number } | null>(
    null
  );
  const [noticeFading, setNoticeFading] = useState(false);
  const noticeSequence = useRef(0);
  const [reacting, setReacting] = useState<string[]>([]);
  const [entering, setEntering] = useState<string[]>([]);
  const reactionsInFlight = useRef(new Set<string>());
  const alive = useRef(true);
  const submitting = useRef(false);
  const [cooldown, setCooldown] =
    useState<ReturnType<typeof getDiaryCommentCooldown>>(null);
  useEffect(() => {
    const update = () => setCooldown(getDiaryCommentCooldown());
    update();
    window.addEventListener(COMMENT_COOLDOWN_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(COMMENT_COOLDOWN_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(
      () => setCooldown(getDiaryCommentCooldown()),
      Math.max(0, cooldown.until - Date.now()) + 50
    );
    return () => clearTimeout(timer);
  }, [cooldown]);
  useLayoutEffect(() => {
    let cancelled = false;
    void getCachedDiaryComments(contentId).then(rows => {
      if (!cancelled && rows) setComments(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [contentId]);
  async function loadInteractions(
    refresh = false,
    animate = false,
    isCurrent = () => alive.current
  ) {
    try {
      const data = await getDiaryInteractions(contentId, refresh);
      if (!isCurrent()) return;
      if (data.comments) {
        if (animate) {
          const existing = new Set(comments.map(row => row.id));
          setEntering(
            data.comments
              .filter(row => row.isOwn && !existing.has(row.id))
              .map(row => row.id)
          );
        }
        setComments(data.comments);
      }
      if (data.emojiData) setEmojiData(data.emojiData);
      setLoadError(data.error);
    } catch {
      if (isCurrent()) setLoadError("评论暂时无法加载");
    }
  }
  function showNotice(text: string) {
    setNoticeFading(false);
    setNotice({ text, key: ++noticeSequence.current });
  }
  useEffect(() => {
    if (!notice) return;
    const fade = setTimeout(() => setNoticeFading(true), 900);
    const hide = setTimeout(() => setNotice(null), 1900);
    return () => {
      clearTimeout(fade);
      clearTimeout(hide);
    };
  }, [notice]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = () => void loadInteractions(false, false, () => !cancelled);
    if (!root.current || !("IntersectionObserver" in window)) {
      load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          // Restore updated caches when switching between footprint views.
          load();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(root.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [contentId]);
  const position = useFloatingPopover({
    open,
    anchor: button,
    panel: form,
    width: 240,
  });
  usePopoverDismiss({
    open,
    anchor: button,
    panel: form,
    busy,
    onDismiss: () => setOpen(false),
  });
  useLayoutEffect(() => {
    if (!open) return;
    input.current?.focus({ preventScroll: true });
    // The portal may start hidden until positioned. Focus after it becomes visible,
    // without taking focus away if the visitor already chose another form field.
    const frame = requestAnimationFrame(() => {
      if (!form.current?.contains(document.activeElement))
        input.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const count = countCharacters(message);
  const nicknameCount = countCharacters(nickname);
  const invalid = count > COMMENT_LIMIT || nicknameCount > NICKNAME_LIMIT;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || getDiaryCommentCooldown()) return;
    submitting.current = true;
    setError("");
    setNotice(null);
    setBusy(true);
    try {
      await submitDiaryComment({
        content_id: contentId,
        message,
        nickname,
        email,
      });
      if (!alive.current) return;
      setMessage("");
      setEmail("");
      setOpen(false);
      button.current?.focus();
      showNotice("已发表");
      await loadInteractions(true, true);
    } catch (error) {
      if (alive.current)
        setError(
          error instanceof DiaryCommentRateLimitError
            ? ""
            : error instanceof Error
              ? error.message
              : "评论暂时无法提交"
        );
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function remove(comment: DiaryComment) {
    if (removing || !comment.isOwn) return false;
    setRemoving(comment.id);
    setActionError("");
    setNotice(null);
    try {
      await removeDiaryComment(comment);
      if (!alive.current) return false;
      setComments(rows => rows.filter(row => row.id !== comment.id));
      setEntering(ids => ids.filter(id => id !== comment.id));
      showNotice("已删除");
      return true;
    } catch (error) {
      if (alive.current)
        setActionError(
          error instanceof Error ? error.message : "评论暂时无法撤回"
        );
      return false;
    } finally {
      if (alive.current) setRemoving(null);
    }
  }
  async function react(
    comment: DiaryComment
  ): Promise<DiaryCommentReaction | null> {
    if (reactionsInFlight.current.has(comment.id) || comment.isOwn) return null;
    reactionsInFlight.current.add(comment.id);
    setReacting([...reactionsInFlight.current]);
    setActionError("");
    try {
      const result = await toggleDiaryCommentReaction(comment);
      if (alive.current)
        setComments(rows =>
          rows.map(row =>
            row.id === comment.id
              ? {
                  ...row,
                  interaction_count: result.interaction_count,
                  has_reacted: result.is_active,
                }
              : row
          )
        );
      return result;
    } catch (error) {
      if (alive.current)
        setActionError(
          error instanceof Error ? error.message : "互动暂时不可用"
        );
      return null;
    } finally {
      reactionsInFlight.current.delete(comment.id);
      if (alive.current) setReacting([...reactionsInFlight.current]);
    }
  }
  return (
    <div
      ref={root}
      className="relative mt-4 text-sm leading-normal"
      data-pagefind-ignore
    >
      <EmojiReactions
        id={contentId}
        inline
        data={emojiData}
        menuAlign={menuAlign}
        afterMenu={
          <span className="relative inline-flex shrink-0">
            <button
              ref={button}
              type="button"
              aria-label="发表短评论"
              disabled={busy}
              aria-expanded={open}
              aria-controls={`${uid}-form`}
              title="发表短评论"
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border px-1 py-1 leading-[0] text-foreground transition-all duration-200 hover:bg-background"
              onClick={() => {
                setOpen(!open);
                setError("");
                setNotice(null);
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
                focusable="false"
                style={{ verticalAlign: "text-bottom" }}
              >
                <path
                  fillRule="evenodd"
                  d="M8 1a7 7 0 0 0-7 7c0 1.2.3 2.3.9 3.3L1 15l3.7-.9A7 7 0 1 0 8 1Zm0 1.5a5.5 5.5 0 1 1-2.9 10.17l-.27-.17-1.79.44.44-1.79-.17-.27A5.5 5.5 0 0 1 8 2.5Z"
                />
              </svg>
            </button>
            {notice && (
              <span
                key={notice.key}
                role="status"
                className={`pointer-events-none absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 text-[10px] leading-3.5 whitespace-nowrap text-accent transition-opacity duration-1000 motion-reduce:transition-none ${noticeFading ? "opacity-0" : "opacity-100"}`}
              >
                {notice.text}
              </span>
            )}
          </span>
        }
      >
        {(expanded ? comments : comments.slice(0, 5)).map(comment => (
          <DiaryCommentChip
            key={comment.id}
            comment={comment}
            removing={removing === comment.id}
            reacting={reacting.includes(comment.id)}
            entering={entering.includes(comment.id)}
            onEntered={() =>
              setEntering(ids => ids.filter(id => id !== comment.id))
            }
            onRemove={() => remove(comment)}
            onReact={() => react(comment)}
            onRequestRemove={() => {
              setOpen(false);
              setNotice(null);
            }}
          />
        ))}
        {comments.length > 5 && (
          <button
            type="button"
            className="rounded px-1 text-xs text-foreground/60 hover:text-accent"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起" : `还有 ${comments.length - 5} 条`}
          </button>
        )}
      </EmojiReactions>
      {loadError && (
        <p className="mt-1 text-[10px] leading-4 text-foreground/60">
          {loadError}。
          <button
            type="button"
            className="ml-1 underline"
            onClick={() => void loadInteractions(true)}
          >
            重试
          </button>
        </p>
      )}
      {actionError && (
        <p
          className="mt-1 text-[10px] leading-4 text-red-600 dark:text-red-400"
          role="alert"
        >
          {actionError}
        </p>
      )}
      {open &&
        createPortal(
          <form
            ref={form}
            id={`${uid}-form`}
            onSubmit={submit}
            className="fixed z-50 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border bg-[var(--background)] p-0 text-sm leading-normal text-foreground shadow-xl"
            style={{
              ...position,
              visibility: position.width ? "visible" : "hidden",
            }}
            data-pagefind-ignore
            aria-label="发表短评论"
            aria-busy={busy}
            aria-describedby={`${uid}-privacy`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
              <span className="text-sm text-foreground/70">发表你的看法</span>
              <button
                type="button"
                disabled={busy}
                aria-label="关闭评论框"
                onClick={() => {
                  setOpen(false);
                  button.current?.focus();
                }}
                className="flex size-5 shrink-0 items-center justify-center rounded text-foreground/70 hover:text-accent disabled:opacity-40"
              >
                <X size={15} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-2 p-2">
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-1.5">
                <label className="min-w-0 text-[10px] text-foreground/70">
                  昵称 <span className="ml-0.5 text-foreground/50">选填</span>
                  <input
                    value={nickname}
                    disabled={busy}
                    maxLength={160}
                    onChange={event => setNickname(event.target.value)}
                    autoComplete="nickname"
                    aria-invalid={nicknameCount > NICKNAME_LIMIT}
                    aria-label="昵称（选填）"
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-sans text-xs outline-none placeholder:text-foreground/45 focus:border-accent disabled:opacity-60 aria-invalid:border-red-400"
                    placeholder="默认匿名"
                  />
                </label>
                <label className="min-w-0 text-[10px] text-foreground/70">
                  邮箱 <span className="ml-0.5 text-foreground/50">选填</span>
                  <input
                    type="email"
                    value={email}
                    disabled={busy}
                    maxLength={254}
                    onChange={event => setEmail(event.target.value)}
                    autoComplete="email"
                    aria-label="邮箱（选填，不公开）"
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-sans text-xs outline-none placeholder:text-foreground/45 focus:border-accent disabled:opacity-60"
                    placeholder="仅作者可见"
                  />
                </label>
              </div>
              {nicknameCount > NICKNAME_LIMIT && (
                <p
                  className="mt-2 text-[10px] leading-4 text-red-600 dark:text-red-400"
                  role="alert"
                >
                  昵称最多 20 个字
                </p>
              )}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label
                    className="text-[10px] text-foreground/70"
                    htmlFor={`${uid}-message`}
                  >
                    你的看法
                  </label>
                  <span
                    id={`${uid}-count`}
                    className={`font-mono text-[10px] tabular-nums ${count > COMMENT_LIMIT ? "text-red-600 dark:text-red-400" : "text-foreground/60"}`}
                  >
                    {count} / {COMMENT_LIMIT}
                  </span>
                </div>
                <input
                  ref={input}
                  id={`${uid}-message`}
                  value={message}
                  onChange={event => setMessage(event.target.value)}
                  disabled={busy}
                  maxLength={320}
                  placeholder="写下你的看法…"
                  autoComplete="off"
                  aria-describedby={`${uid}-count`}
                  aria-invalid={count > COMMENT_LIMIT}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-sans text-xs outline-none placeholder:text-foreground/45 focus:border-accent disabled:opacity-60 aria-invalid:border-red-400"
                />
              </div>
              {(error || cooldown) && (
                <p
                  className="rounded-lg border border-red-500/15 bg-red-500/5 px-2 py-1.5 text-[10px] leading-4 text-red-600 dark:text-red-400"
                  role="alert"
                >
                  {error || cooldown?.message}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
              <p
                id={`${uid}-privacy`}
                className="text-[10px] text-foreground/60"
              >
                邮箱不公开 · 自动审核
              </p>
              <button
                type="submit"
                disabled={
                  busy || Boolean(cooldown) || invalid || !message.trim()
                }
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? (
                  <LoaderCircle
                    size={13}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {busy ? "审核中…" : cooldown ? "稍后再试" : "发表"}
              </button>
            </div>
          </form>,
          document.body
        )}
    </div>
  );
}
