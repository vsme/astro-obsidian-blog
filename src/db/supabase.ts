import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/client";

const supabaseUrl = SUPABASE_URL;
const supabaseKey = SUPABASE_KEY;

// 只有在配置了环境变量时才创建 Supabase 客户端
export const supabase = !!(supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// 用于在未配置时提供友好的日志信息
if (!supabase) {
  console.info("Supabase not configured - emoji reactions will be disabled");
}

// 类型
export interface UserReactionData {
  id?: string;
  content_id: string;
  emoji: string;
  user_hash: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type ReactionRow = {
  content_id?: string; // 批量接口会返回
  emoji: string;
  count: number;
  is_active: boolean;
};

// 环境判断 & 小工具
const isBrowser =
  typeof window !== "undefined" && typeof document !== "undefined";

// 检查 Supabase 是否可用的辅助函数
function checkSupabaseAvailable(): boolean {
  if (!supabase) {
    console.error("Supabase client not initialized");
    return false;
  }
  return true;
}

// 将 rows 以 content_id 分组
function groupByContentId(rows: ReactionRow[]) {
  const map = new Map<string, ReactionRow[]>();
  for (const r of rows) {
    const id = r.content_id!;
    const list = map.get(id) ?? [];
    list.push(r);
    map.set(id, list);
  }
  return map;
}

// ---------------------------------------------
// 批量读取 RPC（数据库已创建 get_content_reactions_many）
// 单条读取默认会走批量器
// ---------------------------------------------

/**
 * 直接单条读取（不经过批量器）
 * 若你想强制一次只打一个 RPC，可调用这个函数。
 */
export async function getContentReactionsDirect(
  contentId: string,
  userHash?: string
) {
  if (!checkSupabaseAvailable()) {
    return [] as ReactionRow[];
  }

  const { data, error } = await supabase!.rpc("get_content_reactions", {
    p_content_id: contentId,
    p_user_hash: userHash ?? null,
  });
  if (error) {
    console.error("Error fetching reactions:", error);
    return [] as ReactionRow[];
  }
  return (data as ReactionRow[]) ?? [];
}

/**
 * 批量读取：一次拿多个 contentId 的汇总
 */
export async function getContentReactionsMany(
  contentIds: string[],
  userHash?: string
) {
  if (!checkSupabaseAvailable()) {
    return [] as ReactionRow[];
  }

  const { data, error } = await supabase!.rpc("get_content_reactions_many", {
    p_content_ids: contentIds,
    p_user_hash: userHash ?? null,
  });
  if (error) {
    console.error("Error fetching reactions (batch):", error);
    return [] as ReactionRow[];
  }
  return (data as ReactionRow[]) ?? [];
}

// 客户端批量器（同一帧内的多个请求合并为一次 RPC）
type Resolver = {
  resolve: (rows: ReactionRow[]) => void;
  reject: (error: Error) => void;
};

class ReactionsBatcher {
  private queues = new Map<
    string /* userHashKey */,
    Map<string /*contentId*/, Resolver[]>
  >();
  private timer: number | undefined;
  // 同一动画帧合并（可调大到 24~32ms 以获得更高合并率）
  private static BATCH_WINDOW_MS = 16;

  /**
   * 收集一个 contentId 请求；按 userHash 维度合并
   */
  load(contentId: string, userHash?: string): Promise<ReactionRow[]> {
    if (!isBrowser) {
      // SSR：直接单条 RPC，避免跨请求共享状态
      return getContentReactionsDirect(contentId, userHash);
    }

    const key = userHash ?? "";
    if (!this.queues.has(key)) this.queues.set(key, new Map());
    const q = this.queues.get(key)!;

    const resolvers = q.get(contentId) ?? [];
    const p = new Promise<ReactionRow[]>((resolve, reject) =>
      resolvers.push({ resolve, reject })
    );
    q.set(contentId, resolvers);

    this.scheduleFlush();
    return p;
  }

  private scheduleFlush() {
    if (this.timer) return;
    this.timer = window.setTimeout(
      () => this.flush(),
      ReactionsBatcher.BATCH_WINDOW_MS
    );
  }

  private async flush() {
    const batches = this.queues;
    this.queues = new Map();
    this.timer = undefined;

    // 如果 Supabase 未配置，直接返回空结果
    if (!checkSupabaseAvailable()) {
      for (const q of batches.values()) {
        for (const resolvers of q.values()) {
          resolvers.forEach(({ resolve }) => resolve([]));
        }
      }
      return;
    }

    await Promise.all(
      [...batches.entries()].map(async ([userKey, q]) => {
        const ids = [...q.keys()];
        try {
          // 调用批量 RPC
          const { data, error } = await supabase!.rpc(
            "get_content_reactions_many",
            {
              p_content_ids: ids,
              p_user_hash: userKey || null,
            }
          );
          if (error) throw error;

          const rows = (data as ReactionRow[]) ?? [];
          const grouped = groupByContentId(rows);

          for (const id of ids) {
            const list = grouped.get(id) ?? [];
            (q.get(id) ?? []).forEach(({ resolve }) => resolve(list));
          }
        } catch (err) {
          // 整批失败：逐个 reject（或回退到单条直调也可）
          for (const resolvers of q.values())
            resolvers.forEach(({ reject }) => reject(err as Error));
        }
      })
    );
  }
}

const reactionsBatcher = new ReactionsBatcher();

/**
 * 对外导出：组件内直接用这个。
 * - 浏览器端：自动合并为一次批量 RPC
 * - SSR：自动回退为单条 RPC
 */
export function getContentReactions(contentId: string, userHash?: string) {
  return reactionsBatcher.load(contentId, userHash);
}

// 写入：切换表情（服务器端限流）
export async function toggleEmojiReaction(
  contentId: string,
  emoji: string,
  userHash: string
) {
  if (!checkSupabaseAvailable()) {
    console.warn("Supabase not configured - emoji reaction toggle skipped");
    return null;
  }

  const { data, error } = await supabase!.rpc("toggle_emoji_reaction", {
    p_content_id: contentId,
    p_emoji: emoji,
    p_user_hash: userHash,
  });

  if (error) {
    // 可根据 errcode 做更友好的提示（例如 22023 = rate limit）
    console.error("Error toggling reaction:", error);
    throw error;
  }

  // 返回单行：{ emoji, new_count, is_active }
  return (
    (data?.[0] as { emoji: string; new_count: number; is_active: boolean }) ??
    null
  );
}

// 生成用户哈希（基于强随机 + localStorage 持久化）
export function generateUserHash(ns = "astro-obsidian-blog"): string {
  if (!isBrowser) return "ssr-default-hash";

  const KEY = `${ns}:uid`;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored;

    // 生成强随机 UUID（现代浏览器）
    const uid = crypto?.randomUUID?.() ?? randomIdFallback();
    localStorage.setItem(KEY, uid);
    return uid;
  } catch {
    // 无法访问 localStorage 时退化为会话级 ID
    return crypto?.randomUUID?.() ?? randomIdFallback();
  }
}

function randomIdFallback(): string {
  // 128bit 随机数（近似 UUIDv4 的强度）
  try {
    const bytes = new Uint8Array(16);
    crypto?.getRandomValues?.(bytes);
    // 设置 v4/variant 位（若 getRandomValues 不可用，这步也安全跳过）
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `uid-${Date.now()}-${(Math.random() * 1000).toFixed()}`;
  }
}
