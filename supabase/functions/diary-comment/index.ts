import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createCommentHandler } from "./handler.mjs";
import { reviewWithJev } from "./jev.mjs";

const env = (key: string) => Deno.env.get(key) ?? "";
const url = env("SUPABASE_URL"),
  serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const key = env("TYPESAFE_API_KEY");
const db =
  url && serviceKey
    ? createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
let publishable: string[] = [];
try {
  publishable = Object.values(
    JSON.parse(env("SUPABASE_PUBLISHABLE_KEYS") || "{}")
  );
} catch {
  /* Legacy anon key remains supported. */
}
const origins = env("COMMENT_ALLOWED_ORIGINS")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);
const rateKeys = new WeakMap<Request, Map<string, Promise<string>>>();
function getRateKey(request: Request, purpose = "diary-comment") {
  let keys = rateKeys.get(request);
  if (!keys) {
    keys = new Map();
    rateKeys.set(request, keys);
  }
  let cached = keys.get(purpose);
  if (!cached) {
    cached = (async () => {
      // Global budget also bounds cost when an anonymous visitor spoofs IP headers.
      const ip =
        request.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ||
        request.headers.get("cf-connecting-ip")?.trim() ||
        request.headers.get("x-real-ip")?.trim() ||
        "unknown";
      // Derive a purpose-specific key from the server-only Supabase credential.
      // Project salt and HKDF info keep these hashes separate from other uses.
      const material = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(serviceKey),
        "HKDF",
        false,
        ["deriveKey"]
      );
      const hmac = await crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: new TextEncoder().encode(url),
          info: new TextEncoder().encode(
            `astro-paper/${purpose}/rate-limit/v1`
          ),
        },
        material,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign"]
      );
      const digest = await crypto.subtle.sign(
        "HMAC",
        hmac,
        new TextEncoder().encode(ip)
      );
      const hash = Array.from(new Uint8Array(digest), value =>
        value.toString(16).padStart(2, "0")
      ).join("");
      return hash;
    })();
    keys.set(purpose, cached);
  }
  return cached;
}
const handler = createCommentHandler({
  origins,
  apiKeys: [env("SUPABASE_ANON_KEY"), ...publishable].filter(Boolean),
  configured: !!db && !!key,
  storageConfigured: !!db,
  emojiToggle: async (
    request: Request,
    contentId: string,
    emoji: string,
    userHash: string
  ) => {
    const { data, error } = await db!.rpc("toggle_emoji_reaction_hmac", {
      p_content_id: contentId,
      p_emoji: emoji,
      p_user_hash: userHash,
      p_ip_hash: await getRateKey(request, "emoji"),
    });
    if (error) throw new Error("Emoji toggle unavailable");
    return data;
  },
  reserve: async (request: Request, action = "submit") => {
    const { data, error } = await db!.rpc("reserve_diary_comment_action", {
      p_key: await getRateKey(request),
      p_action: action,
    });
    if (error) throw new Error("Rate limit unavailable");
    return data;
  },
  review: (comment: { message: string; nickname: string | null }) =>
    reviewWithJev(comment, {
      apiKey: key,
      model: env("TYPESAFE_MODEL") || "jev-1.13.0",
    }),
  save: async (
    comment: {
      content_id: string;
      message: string;
      emoji: string | null;
      nickname: string | null;
      email: string | null;
    },
    result: { status: string; model: string; results: unknown },
    ownerHash: string,
    request: Request
  ) => {
    const { data, error } = await db!.rpc("publish_owned_diary_comment", {
      p_key: await getRateKey(request),
      p_content_id: comment.content_id,
      p_message: comment.message,
      p_emoji: comment.emoji,
      p_nickname: comment.nickname,
      p_email: comment.email,
      p_model: result.model,
      p_review: result.results,
      p_owner_hash: ownerHash,
    });
    if (error) throw new Error("Comment save failed");
    return data;
  },
  remove: async (commentId: string, ownerHash: string) => {
    const { data, error } = await db!.rpc("delete_owned_diary_comment", {
      p_comment_id: commentId,
      p_owner_hash: ownerHash,
    });
    if (error) throw new Error("Comment removal unavailable");
    return data === true;
  },
  react: async (commentId: string, actorHash: string) => {
    const { data, error } = await db!.rpc("toggle_diary_comment_reaction", {
      p_comment_id: commentId,
      p_actor_hash: actorHash,
    });
    if (error) throw new Error("Comment reaction failed");
    return data?.[0] ?? null;
  },
  list: async (contentIds: string[], actorHash: string | null) => {
    const { data, error } = await db!.rpc("get_diary_comments_for_viewer", {
      p_content_ids: contentIds,
      p_actor_hash: actorHash,
    });
    if (error) throw new Error("Comment list unavailable");
    return data ?? [];
  },
  emojiList: async (contentIds: string[], userHash: string) => {
    const { data, error } = await db!.rpc("get_content_reactions_many", {
      p_content_ids: contentIds,
      p_user_hash: userHash,
    });
    if (error) throw new Error("Emoji list unavailable");
    return data ?? [];
  },
});
Deno.serve(handler);
