import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import ts from "typescript";
import { createHmac, hkdfSync } from "node:crypto";
const functions = fileURLToPath(
  new URL("../supabase/functions/diary-comment/", import.meta.url)
);
test("Edge adapter needs no extra rate secret, derives stable private hashes and enforces rate limits", async () => {
  const folder = await mkdtemp(join(tmpdir(), "astro-paper-comment-adapter-"));
  const original = {
    Deno: globalThis.Deno,
    fetch: globalThis.fetch,
    client: globalThis.__commentTestClient,
  };
  const calls = [];
  let allowed = true;
  let reviews = 0;
  let blockedReview = false;
  let emojiAllowed = true;
  let handler;
  const env = {
    SUPABASE_URL: "https://example.test",
    SUPABASE_SERVICE_ROLE_KEY: "fake-server-key",
    SUPABASE_ANON_KEY: "fake-public-key",
    TYPESAFE_API_KEY: "fake-typesafe-key",
    COMMENT_ALLOWED_ORIGINS: "https://site.example.test",
  };
  try {
    globalThis.Deno = {
      env: { get: key => env[key] },
      serve: callback => {
        handler = callback;
      },
    };
    globalThis.__commentTestClient = (url, key) => {
      assert.equal(url, env.SUPABASE_URL);
      assert.equal(key, env.SUPABASE_SERVICE_ROLE_KEY);
      return {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return {
            data:
              name === "reserve_diary_comment_action"
                ? allowed
                  ? { allowed: true }
                  : {
                      allowed: false,
                      reason: "ip_day",
                      limit: 100,
                      used: 100,
                      retry_after: 3600,
                      resets_at: new Date(Date.now() + 3600_000).toISOString(),
                    }
                : name === "publish_owned_diary_comment"
                  ? { allowed: true }
                  : name === "get_diary_comments_for_viewer" ||
                      name === "get_content_reactions_many"
                    ? []
                    : name === "delete_owned_diary_comment"
                      ? true
                      : name === "toggle_diary_comment_reaction"
                        ? [{ interaction_count: 2, is_active: true }]
                        : name === "toggle_emoji_reaction_hmac"
                          ? emojiAllowed
                            ? {
                                allowed: true,
                                emoji: "👍",
                                new_count: 0,
                                is_active: false,
                                ip_hash: "private-data-must-be-omitted",
                              }
                            : {
                                allowed: false,
                                reason: "ip_minute",
                                limit: 60,
                                used: 60,
                                retry_after: 30,
                                resets_at: new Date(
                                  Date.now() + 30_000
                                ).toISOString(),
                              }
                          : "fake-private-id",
            error: null,
          };
        },
      };
    };
    globalThis.fetch = async (url, options) => {
      reviews++;
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.equal(options.headers.Authorization, "Bearer fake-typesafe-key");
      assert.ok(!options.body.includes("private@example.test"));
      const clear = {
        type: "choice",
        choice: "clear",
        confidence: 0.98,
        probabilities: { clear: 0.99, violation: 0.005, uncertain: 0.005 },
      };
      return Response.json({
        model: "jev-1.13.0",
        answers: {
          profanity: clear,
          politics: blockedReview
            ? {
                ...clear,
                choice: "violation",
                probabilities: {
                  clear: 0.005,
                  violation: 0.99,
                  uncertain: 0.005,
                },
              }
            : clear,
          political_nickname: clear,
        },
      });
    };
    const source = await readFile(functions + "index.ts", "utf8");
    const compilation = ts.transpileModule(source, {
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    });
    assert.equal(
      compilation.diagnostics.filter(
        d => d.category === ts.DiagnosticCategory.Error
      ).length,
      0
    );
    const code = compilation.outputText
      .replace(
        /import\s*\{\s*createClient\s*\}\s*from\s*["']npm:[^"']+["'];/,
        "const createClient=globalThis.__commentTestClient;"
      )
      .replaceAll(
        '"./handler.mjs"',
        JSON.stringify(pathToFileURL(functions + "handler.mjs").href)
      )
      .replaceAll(
        '"./jev.mjs"',
        JSON.stringify(pathToFileURL(functions + "jev.mjs").href)
      );
    const module = join(folder, "adapter.mjs");
    await writeFile(module, code);
    await import(pathToFileURL(module).href);
    const request = (body = {}) =>
      new Request("https://example.test/comment", {
        method: "POST",
        headers: {
          origin: "https://site.example.test",
          apikey: "fake-public-key",
          "content-type": "application/json",
          "x-forwarded-for": "test-client-source",
        },
        body: JSON.stringify({
          content_id: "emoji-reactions-2026-10-07-12-00",
          message: "喜欢这些鱼",
          owner_token: "a".repeat(64),
          nickname: "鱼儿",
          email: "private@example.test",
          status: "approved",
          ...body,
        }),
      });
    const response = await handler(request());
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { status: "approved" });
    assert.equal(calls[0].name, "reserve_diary_comment_action");
    assert.match(calls[0].args.p_key, /^[a-f0-9]{64}$/);
    assert.notEqual(calls[0].args.p_key, "test-client-source");
    assert.equal(calls[1].name, "publish_owned_diary_comment");
    assert.equal(calls[1].args.p_status, undefined);
    assert.equal(calls[1].args.p_key, calls[0].args.p_key);
    assert.equal(calls[0].args.p_action, "submit");
    assert.equal(calls[1].args.p_email, "private@example.test");
    assert.equal(calls[1].args.p_model, "jev-1.13.0");
    assert.match(calls[1].args.p_owner_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(calls[1].args.p_owner_hash, "a".repeat(64));
    assert.ok(
      !JSON.stringify(calls[1].args.p_review).includes(
        calls[1].args.p_owner_hash
      )
    );
    assert.ok(!JSON.stringify(calls).includes(env.SUPABASE_SERVICE_ROLE_KEY));
    const repeated = await handler(request());
    assert.equal(repeated.status, 201);
    assert.equal(calls[2].args.p_key, calls[0].args.p_key);
    allowed = false;
    const limited = await handler(request());
    assert.equal(limited.status, 429);
    assert.equal(reviews, 2);
    assert.equal(calls.length, 5);
    const removed = await handler(
      request({
        action: "remove",
        comment_id: "00000000-0000-4000-8000-000000000001",
      })
    );
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), { removed: true });
    assert.equal(calls[5].name, "delete_owned_diary_comment");
    assert.equal(calls[5].args.p_owner_hash, calls[1].args.p_owner_hash);
    allowed = true;
    const reaction = await handler(
      request({
        action: "react",
        comment_id: "00000000-0000-4000-8000-000000000001",
      })
    );
    assert.equal(reaction.status, 200);
    assert.deepEqual(await reaction.json(), {
      interaction_count: 2,
      is_active: true,
    });
    assert.equal(calls[6].name, "reserve_diary_comment_action");
    assert.equal(calls[6].args.p_action, "react");
    assert.equal(calls[7].name, "toggle_diary_comment_reaction");
    assert.equal(calls[7].args.p_actor_hash, calls[1].args.p_owner_hash);
    assert.equal(reviews, 2);
    const listed = await handler(
      request({
        action: "list",
        content_ids: ["emoji-reactions-2026-10-07-12-00"],
      })
    );
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), { comments: [] });
    assert.equal(calls.at(-1).name, "get_diary_comments_for_viewer");
    const before = calls.length;
    const combined = await handler(
      request({
        action: "list",
        content_ids: ["emoji-reactions-2026-10-07-12-00"],
        emoji_user_hash: "00000000-0000-4000-8000-000000000004",
      })
    );
    assert.equal(combined.status, 200);
    assert.deepEqual(await combined.json(), {
      comments: [],
      emoji_reactions: [],
    });
    assert.equal(calls.length, before + 2);
    assert.equal(calls.at(-1).name, "get_content_reactions_many");
    assert.equal(
      calls.at(-1).args.p_user_hash,
      "00000000-0000-4000-8000-000000000004"
    );
    assert.deepEqual(calls.at(-1).args.p_content_ids, [
      "emoji-reactions-2026-10-07-12-00",
    ]);
    assert.equal(reviews, 2);
    blockedReview = true;
    const beforeRejected = calls.length;
    const rejected = await handler(request());
    assert.equal(rejected.status, 422);
    assert.equal(calls.length, beforeRejected + 1);
    assert.equal(calls.at(-1).name, "reserve_diary_comment_action");
    assert.equal(calls.at(-1).args.p_action, "submit");
    assert.equal(reviews, 3);
    const forwarded = request();
    forwarded.headers.delete("x-forwarded-for");
    forwarded.headers.set("cf-connecting-ip", "test-client-source");
    assert.equal((await handler(forwarded)).status, 422);
    assert.equal(calls.at(-1).args.p_key, calls[0].args.p_key);
    const commentHash = calls[0].args.p_key;
    const emojiHash = createHmac(
      "sha256",
      hkdfSync(
        "sha256",
        env.SUPABASE_SERVICE_ROLE_KEY,
        env.SUPABASE_URL,
        "astro-paper/emoji/rate-limit/v1",
        32
      )
    )
      .update("test-client-source")
      .digest("hex");
    assert.notEqual(
      emojiHash,
      commentHash,
      "purpose-specific keys must isolate emoji and comment buckets"
    );
    const emojiBody = {
      action: "emoji",
      emoji: "👍",
      emoji_user_hash: "browser-emoji-id",
      owner_token: null,
      ip: "forged-client-source",
      p_ip_hash: "forged-client-hash",
    };
    const beforeEmoji = calls.length;
    const emojiResponse = await handler(request(emojiBody));
    assert.equal(emojiResponse.status, 200);
    assert.deepEqual(await emojiResponse.json(), {
      emoji: "👍",
      new_count: 0,
      is_active: false,
    });
    assert.equal(calls.length, beforeEmoji + 1);
    assert.equal(calls.at(-1).name, "toggle_emoji_reaction_hmac");
    assert.deepEqual(calls.at(-1).args, {
      p_content_id: "emoji-reactions-2026-10-07-12-00",
      p_emoji: "👍",
      p_user_hash: "browser-emoji-id",
      p_ip_hash: emojiHash,
    });
    assert.equal((await handler(request(emojiBody))).status, 200);
    assert.equal(calls.at(-1).args.p_ip_hash, emojiHash);
    emojiAllowed = false;
    const emojiLimited = await handler(request(emojiBody));
    assert.equal(emojiLimited.status, 429);
    assert.equal(emojiLimited.headers.get("Retry-After"), "30");
    assert.equal((await emojiLimited.json()).rate_limit.scope, "emoji");
    assert.equal(
      reviews,
      4,
      "emoji writes must never invoke paid comment moderation"
    );
    assert.ok(!JSON.stringify(calls).includes("test-client-source"));
    // Rotating the server credential creates new HMAC buckets; no extra secret.
    emojiAllowed = true;
    env.SUPABASE_SERVICE_ROLE_KEY = "fake-rotated-server-key";
    const rotatedModule = join(folder, "rotated-adapter.mjs");
    await writeFile(rotatedModule, code);
    await import(pathToFileURL(rotatedModule).href);
    assert.equal((await handler(request(emojiBody))).status, 200);
    assert.notEqual(calls.at(-1).args.p_ip_hash, emojiHash);
  } finally {
    globalThis.Deno = original.Deno;
    globalThis.fetch = original.fetch;
    globalThis.__commentTestClient = original.client;
    await rm(folder, { recursive: true, force: true });
  }
});
