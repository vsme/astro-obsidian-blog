import {
  supabase,
  generateUserHash,
  getCachedContentReactions,
  setCachedContentReactions,
  type ReactionRow,
} from "./supabase";
import { validateComment, type CommentInput } from "../utils/commentRules.mjs";
import { getCommentOwnerToken } from "../utils/commentOwner.mjs";
import {
  readStoredJson,
  writeStoredJson,
  removeStoredValue,
} from "../utils/browserStorage.mjs";

export interface DiaryComment {
  id: string;
  content_id: string;
  message: string;
  emoji: string | null;
  nickname: string | null;
  created_at: string;
  isOwn?: boolean;
  status?: "approved" | "pending";
  interaction_count?: number;
  has_reacted?: boolean;
  author_participating: boolean;
}
export interface DiaryCommentReaction {
  interaction_count: number;
  is_active: boolean;
  author_participating: boolean;
  requires_delete_confirmation: boolean;
}
type RateAction = "submit" | "react";
export interface DiaryCommentCooldown {
  until: number;
  message: string;
}
export const COMMENT_COOLDOWN_EVENT = "astro-paper:comment-cooldown";
const cooldowns = new Map<RateAction, DiaryCommentCooldown>();
const cooldownKey = (action: RateAction) =>
  `astro-paper:diary-comment-cooldown:v1:${getEmojiUserHash()}:${action}`;
export class DiaryCommentRateLimitError extends Error {
  constructor(
    message: string,
    public retryAt: number
  ) {
    super(message);
    this.name = "DiaryCommentRateLimitError";
  }
}
export function getDiaryCommentCooldown(
  action: RateAction = "submit"
): DiaryCommentCooldown | null {
  if (typeof window === "undefined") return null;
  const valid = (
    value: DiaryCommentCooldown | null | undefined
  ): value is DiaryCommentCooldown =>
    Boolean(
      value &&
        typeof value.message === "string" &&
        Number.isFinite(value.until) &&
        value.until > Date.now() &&
        value.until <= Date.now() + 86400_000
    );
  let stored = cooldowns.get(action);
  const persisted = readStoredJson<DiaryCommentCooldown>(cooldownKey(action));
  if (valid(persisted) && (!valid(stored) || persisted.until > stored.until))
    stored = persisted;
  if (valid(stored)) {
    cooldowns.set(action, stored);
    return stored;
  }
  cooldowns.delete(action);
  removeStoredValue(cooldownKey(action));
  return null;
}
function rememberCooldown(
  action: RateAction,
  message: string,
  seconds: number
) {
  const cooldown = { until: Date.now() + seconds * 1000, message };
  cooldowns.set(action, cooldown);
  writeStoredJson(cooldownKey(action), cooldown);
  if (typeof window.dispatchEvent === "function")
    window.dispatchEvent(new Event(COMMENT_COOLDOWN_EVENT));
  return cooldown;
}
const emojiErrors = new Map<string, string>();
const COMMENT_CACHE_TTL_MS = 5 * 60 * 1000;
const COMMENT_CACHE_PREFIX = "astro-paper:diary-comments:v2";
type CommentCacheEntry = { expiresAt: number; rows: DiaryComment[] };
const cache = new Map<string, CommentCacheEntry>();
let mutationVersion = 0;
const pending = new Map<
  string,
  { version: number; request: Promise<DiaryComment[]> }
>();
let cacheScope: { token: string | null; key: Promise<string> } | undefined;
async function getCacheScope(token = getCommentOwnerToken()) {
  if (typeof window === "undefined") return null;
  if (cacheScope?.token !== token) {
    cacheScope = {
      token,
      key: (async () => {
        const digest = token
          ? await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(`diary-comment-cache/v1:${token}`)
            )
          : null;
        const viewer = digest
          ? Array.from(new Uint8Array(digest), byte =>
              byte.toString(16).padStart(2, "0")
            ).join("")
          : "anonymous";
        return `${getEmojiUserHash()}:${viewer}`;
      })(),
    };
  }
  return cacheScope.key.catch(() => null);
}
function cacheKey(scope: string, id: string) {
  return `${COMMENT_CACHE_PREFIX}:${encodeURIComponent(scope)}:${id}`;
}
function projectComment(row: DiaryComment): DiaryComment {
  if (typeof row.author_participating !== "boolean")
    throw new Error("评论互动暂时不可用，请稍后重试");
  return {
    id: row.id,
    content_id: row.content_id,
    message: row.message,
    emoji: row.emoji,
    nickname: row.nickname,
    created_at: row.created_at,
    status: row.status,
    isOwn: row.isOwn === true,
    interaction_count: row.interaction_count ?? 0,
    has_reacted: row.has_reacted === true,
    author_participating: row.author_participating,
  };
}
function remember(key: string, entry: CommentCacheEntry) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > 100) cache.delete(cache.keys().next().value!);
}
function readCachedEntry(scope: string, id: string): CommentCacheEntry | null {
  const key = cacheKey(scope, id);
  const memory = cache.get(key);
  if (memory && memory.expiresAt > Date.now()) return memory;
  cache.delete(key);
  const entry = readStoredJson<CommentCacheEntry>(key);
  if (!entry) return null;
  if (
    !Number.isFinite(entry?.expiresAt) ||
    entry.expiresAt <= Date.now() ||
    entry.expiresAt > Date.now() + COMMENT_CACHE_TTL_MS ||
    !Array.isArray(entry.rows) ||
    entry.rows.length > 40 ||
    !entry.rows.every(
      row =>
        row &&
        typeof row.id === "string" &&
        row.content_id === id &&
        typeof row.message === "string" &&
        typeof row.created_at === "string" &&
        (row.emoji === null || typeof row.emoji === "string") &&
        (row.nickname === null || typeof row.nickname === "string") &&
        (row.status === "approved" ||
          (row.status === "pending" && row.isOwn === true)) &&
        typeof row.isOwn === "boolean" &&
        typeof row.has_reacted === "boolean" &&
        typeof row.author_participating === "boolean" &&
        Number.isInteger(row.interaction_count) &&
        row.interaction_count! >= 0
    )
  ) {
    removeStoredValue(key);
    return null;
  }
  const safe = {
    expiresAt: entry.expiresAt,
    rows: entry.rows.map(projectComment),
  };
  remember(key, safe);
  return safe;
}

function writeCachedEntry(scope: string, id: string, entry: CommentCacheEntry) {
  const key = cacheKey(scope, id);
  const safe = {
    expiresAt: entry.expiresAt,
    rows: entry.rows.map(projectComment),
  };
  remember(key, safe);
  if (!writeStoredJson(key, safe)) return;
  const indexKey = `${COMMENT_CACHE_PREFIX}:index:${encodeURIComponent(scope)}`;
  const storedIndex = readStoredJson(indexKey);
  const ids: string[] = Array.isArray(storedIndex)
    ? storedIndex.filter(value => typeof value === "string" && value !== id)
    : [];
  ids.push(id);
  while (ids.length > 100) removeStoredValue(cacheKey(scope, ids.shift()!));
  writeStoredJson(indexKey, ids);
}

async function invalidateComments(id: string, token: string) {
  mutationVersion++;
  const scope = await getCacheScope(token);
  if (!scope) return;
  cache.delete(cacheKey(scope, id));
  removeStoredValue(cacheKey(scope, id));
}

export async function getCachedDiaryComments(
  id: string
): Promise<DiaryComment[] | null> {
  const scope = await getCacheScope();
  return scope ? (readCachedEntry(scope, id)?.rows ?? null) : null;
}
type CommentWaiter = {
  resolve: (rows: DiaryComment[]) => void;
  reject: (error: Error) => void;
};
const queue = new Map<string, CommentWaiter[]>();
let timer: ReturnType<typeof setTimeout> | undefined;
let emojiUserHash: string | undefined;
function enqueue(id: string, waiters: CommentWaiter[]) {
  queue.set(id, [...(queue.get(id) ?? []), ...waiters]);
  timer ??= setTimeout(() => void flush(), 20);
}
function getEmojiUserHash() {
  return (emojiUserHash ??= generateUserHash());
}
async function flush() {
  timer = undefined;
  const batch = [...queue.entries()].slice(0, 50);
  batch.forEach(([id]) => queue.delete(id));
  if (queue.size) timer = setTimeout(() => void flush(), 20);
  const version = mutationVersion;
  let received = false;
  try {
    const ownerToken = getCommentOwnerToken();
    const scope = await getCacheScope(ownerToken);
    const userHash = getEmojiUserHash();
    const response = await invokeComment({
      action: "list",
      content_ids: batch.map(([id]) => id),
      emoji_user_hash: userHash,
      ...(ownerToken ? { owner_token: ownerToken } : {}),
    });
    // A write or credential change makes the earlier read obsolete. Rebatch its
    // callers instead of restoring deleted comments or outdated interaction state.
    if (version !== mutationVersion || ownerToken !== getCommentOwnerToken()) {
      batch.forEach(([id, waiters]) => enqueue(id, waiters));
      return;
    }
    received = true;
    const hasEmojis = Array.isArray(response?.emoji_reactions);
    for (const [id] of batch) {
      emojiErrors.delete(id);
      emojiErrors.set(
        id,
        hasEmojis
          ? ""
          : response?.emoji_error ||
              "互动服务尚未更新，请部署新版 diary-comment"
      );
      if (hasEmojis) {
        const rows = (response.emoji_reactions as ReactionRow[])
          .filter(row => row.content_id === id)
          .map(row => ({
            content_id: row.content_id,
            emoji: row.emoji,
            count: row.count,
            is_active: row.is_active === true,
          }));
        setCachedContentReactions(id, userHash, rows);
      }
    }
    while (emojiErrors.size > 100)
      emojiErrors.delete(emojiErrors.keys().next().value!);
    if (!Array.isArray(response?.comments))
      throw new Error(
        response?.comment_error || "互动服务尚未更新，请部署新版 diary-comment"
      );
    for (const [id, waiters] of batch) {
      // Explicit projection: email and moderation metadata never enter client state.
      const rows = (response.comments as DiaryComment[])
        .filter(
          row =>
            row.content_id === id &&
            (row.status === "approved" ||
              (row.status === "pending" && row.isOwn))
        )
        .map(projectComment);
      if (scope)
        writeCachedEntry(scope, id, {
          expiresAt: Date.now() + COMMENT_CACHE_TTL_MS,
          rows,
        });
      waiters.forEach(waiter => waiter.resolve(rows));
    }
  } catch (error) {
    if (!received) {
      for (const [id] of batch) {
        emojiErrors.delete(id);
        emojiErrors.set(id, "表情暂时无法加载");
      }
      while (emojiErrors.size > 100)
        emojiErrors.delete(emojiErrors.keys().next().value!);
    }
    batch.forEach(([, waiters]) =>
      waiters.forEach(waiter =>
        waiter.reject(
          error instanceof Error ? error : new Error("评论暂时无法加载")
        )
      )
    );
  }
}
export async function getDiaryComments(
  id: string,
  refresh = false
): Promise<DiaryComment[]> {
  const cached = refresh ? null : await getCachedDiaryComments(id);
  if (cached !== null) return cached;
  const scope = await getCacheScope();
  const key = scope
    ? cacheKey(scope, id)
    : `${getCommentOwnerToken() ?? "anonymous"}:${id}`;
  const existing = pending.get(key);
  if (existing?.version === mutationVersion) return existing.request;
  const request = new Promise<DiaryComment[]>((resolve, reject) =>
    enqueue(id, [{ resolve, reject }])
  );
  pending.set(key, { version: mutationVersion, request });
  try {
    return await request;
  } finally {
    if (pending.get(key)?.request === request) pending.delete(key);
  }
}

/** One batched request supplies both parts of the diary interaction toolbar. */
export async function getDiaryInteractions(id: string, refresh = false) {
  const userHash = getEmojiUserHash();
  let comments: DiaryComment[] | null = null;
  let commentError = "";
  try {
    comments = await getDiaryComments(
      id,
      refresh ||
        getCachedContentReactions(id, userHash) === null ||
        Boolean(emojiErrors.get(id))
    );
  } catch (error) {
    commentError = error instanceof Error ? error.message : "评论暂时无法加载";
  }
  const rows = getCachedContentReactions(id, userHash);
  const emojiData = rows === null ? null : { userHash, rows };
  const emojiError =
    emojiErrors.get(id) || (rows === null ? "表情暂时无法加载" : "");
  return { comments, emojiData, error: commentError || emojiError };
}
async function invokeComment(body: Record<string, unknown>) {
  if (!supabase) throw new Error("评论暂时不可用");
  const action = body.action ?? "submit";
  if (action === "submit" || action === "react") {
    const cooldown = getDiaryCommentCooldown(action);
    if (cooldown)
      throw new DiaryCommentRateLimitError(cooldown.message, cooldown.until);
  }
  const { data, error } = await supabase.functions.invoke("diary-comment", {
    body,
  });
  if (error) {
    let message = "评论暂时无法操作，请稍后再试";
    let limited: DiaryCommentCooldown | null = null;
    if ("context" in error && error.context instanceof Response) {
      try {
        const response = await error.context.json();
        if (typeof response.error === "string") message = response.error;
        if (
          error.context.status === 429 &&
          (action === "submit" || action === "react") &&
          response.rate_limit?.scope === action &&
          Number.isInteger(response.rate_limit.retry_after) &&
          response.rate_limit.retry_after > 0 &&
          response.rate_limit.retry_after <= 86400
        )
          limited = rememberCooldown(
            action,
            message,
            response.rate_limit.retry_after
          );
      } catch {
        /* Keep the public fallback; never expose provider diagnostics. */
      }
    }
    if (limited) throw new DiaryCommentRateLimitError(message, limited.until);
    throw new Error(message);
  }
  return data;
}
export async function submitDiaryComment(
  input: CommentInput
): Promise<"approved"> {
  const payload = validateComment(input);
  const ownerToken = getCommentOwnerToken(true);
  const data = await invokeComment({ ...payload, owner_token: ownerToken });
  if (data?.status !== "approved")
    throw new Error("评论暂时无法提交，请稍后再试");
  await invalidateComments(input.content_id, ownerToken!);
  return data.status;
}

export async function removeDiaryComment(comment: DiaryComment): Promise<void> {
  const ownerToken = getCommentOwnerToken();
  if (!ownerToken || !comment.isOwn) throw new Error("只能撤回自己的评论");
  const data = await invokeComment({
    action: "remove",
    comment_id: comment.id,
    owner_token: ownerToken,
  });
  if (data?.removed !== true) throw new Error("评论暂时无法撤回，请稍后再试");
  await invalidateComments(comment.content_id, ownerToken);
}

export async function toggleDiaryCommentReaction(
  comment: DiaryComment
): Promise<DiaryCommentReaction> {
  if (comment.status === "pending") throw new Error("只能互动已发表的评论");
  const previousScope = await getCacheScope();
  const previous = previousScope
    ? readCachedEntry(previousScope, comment.content_id)
    : null;
  const ownerToken = getCommentOwnerToken(true);
  const data = await invokeComment({
    action: "react",
    comment_id: comment.id,
    owner_token: ownerToken,
  });
  if (
    !Number.isInteger(data?.interaction_count) ||
    data.interaction_count < 0 ||
    typeof data.is_active !== "boolean" ||
    typeof data.author_participating !== "boolean" ||
    typeof data.requires_delete_confirmation !== "boolean" ||
    (data.requires_delete_confirmation &&
      (!comment.isOwn ||
        data.interaction_count !== 0 ||
        !data.is_active ||
        !data.author_participating))
  )
    throw new Error("互动暂时不可用，请稍后再试");
  mutationVersion++;
  const scope = await getCacheScope(ownerToken);
  const cached = scope
    ? (readCachedEntry(scope, comment.content_id) ?? previous)
    : null;
  if (cached && scope)
    writeCachedEntry(scope, comment.content_id, {
      ...cached,
      rows: cached.rows.map(row =>
        row.id === comment.id
          ? {
              ...row,
              interaction_count: data.interaction_count,
              has_reacted: data.is_active,
              author_participating: data.author_participating,
            }
          : row
      ),
    });
  return {
    interaction_count: data.interaction_count,
    is_active: data.is_active,
    author_participating: data.author_participating,
    requires_delete_confirmation: data.requires_delete_confirmation,
  };
}
