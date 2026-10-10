import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { getCommentOwnerToken } from "../src/utils/commentOwner.mjs";

test("Client batches emoji and comment reads, keeps ownership private and never falls back to old backends", async () => {
  const folder = await mkdtemp(join(tmpdir(), "astro-paper-comment-client-"));
  const previous = {
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    client: globalThis.__commentClientMock,
    helpers: globalThis.__commentClientHelpers,
  };
  const store = new Map();
  const actions = [];
  const emojiCache = new Map();
  const userHash = "00000000-0000-4000-8000-000000000004";
  globalThis.__commentClientHelpers = {
    generateUserHash: () => userHash,
    getCachedContentReactions: id => emojiCache.get(id) ?? null,
    setCachedContentReactions: (id, hash, rows) => {
      assert.equal(hash, userHash);
      emojiCache.set(id, rows);
    },
  };
  const contentId = "emoji-reactions-2026-10-09-12-00";
  const row = (id, message) => ({
    id,
    content_id: contentId,
    message,
    emoji: null,
    nickname: "相同昵称",
    created_at: "2026-10-09T00:00:00Z",
  });
  const own = row("00000000-0000-4000-8000-000000000001", "自己的评论");
  const other = row("00000000-0000-4000-8000-000000000002", "别人的评论");
  const pending = row("00000000-0000-4000-8000-000000000003", "等待审核");
  let removed = false;
  let reacted = false;
  let holdNextList = false,
    listStarted = () => {},
    releaseList;
  try {
    globalThis.window = {};
    globalThis.localStorage = {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: key => store.delete(key),
    };
    const ownerToken = getCommentOwnerToken(true);
    globalThis.__commentClientMock = {
      rpc: async () => {
        throw new Error("Public fallback must not be called");
      },
      functions: {
        invoke: async (name, { body }) => {
          assert.equal(name, "diary-comment");
          actions.push(body);
          if (body.action === undefined)
            return { data: { status: "approved" }, error: null };
          if (body.action === "list") {
            const result = {
              data: {
                emoji_reactions: [
                  {
                    content_id: contentId,
                    emoji: "👍",
                    count: 2,
                    is_active: true,
                    user_hash: "must-not-leak",
                  },
                ],
                comments: [
                  ...(removed
                    ? []
                    : [{ ...own, status: "approved", isOwn: true }]),
                  { ...other, status: "approved", isOwn: false },
                  { ...pending, status: "pending", isOwn: true },
                ].map(row => ({
                  ...row,
                  interaction_count:
                    row.id === other.id ? (reacted ? 3 : 2) : 0,
                  has_reacted: row.id === other.id && reacted,
                  email: "private@example.test",
                  owner_hash: "secret",
                })),
              },
              error: null,
            };
            if (holdNextList) {
              holdNextList = false;
              listStarted();
              return new Promise(resolve => {
                releaseList = () => resolve(result);
              });
            }
            return result;
          }
          if (body.action === "react" && body.comment_id === other.id) {
            reacted = !reacted;
            return {
              data: { interaction_count: reacted ? 3 : 2, is_active: reacted },
              error: null,
            };
          }
          if (
            body.action === "remove" &&
            body.comment_id === own.id &&
            body.owner_token === ownerToken
          ) {
            removed = true;
            return { data: { removed: true }, error: null };
          }
          return {
            data: null,
            error: {
              context: Response.json(
                { error: "评论不存在或不属于你，无法撤回" },
                { status: 404 }
              ),
            },
          };
        },
      },
    };
    const source = await readFile(
      new URL("../src/db/diaryComments.ts", import.meta.url),
      "utf8"
    );
    const code = ts
      .transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      })
      .outputText.replace(
        /import\s*\{[^}]+\}\s*from\s*["']\.\/supabase["'];/,
        "const supabase=globalThis.__commentClientMock; const {generateUserHash,getCachedContentReactions,setCachedContentReactions}=globalThis.__commentClientHelpers;"
      )
      .replace(/(["'])\.\.\/utils\/([^"']+\.mjs)\1/g, (_match, _quote, name) =>
        JSON.stringify(new URL(`../src/utils/${name}`, import.meta.url).href)
      );
    const path = join(folder, "client.mjs");
    await writeFile(path, code);
    const client = await import(pathToFileURL(path).href);
    const [toolbar, emptyToolbar] = await Promise.all([
      client.getDiaryInteractions(contentId, true),
      client.getDiaryInteractions("emoji-reactions-2026-10-09-13-00", true),
    ]);
    const rows = toolbar.comments;
    const empty = emptyToolbar.comments;
    assert.equal(empty.length, 0);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "list");
    assert.equal(actions[0].content_ids.length, 2);
    assert.equal(actions[0].emoji_user_hash, userHash);
    assert.deepEqual(toolbar.emojiData, {
      userHash,
      rows: [{ content_id: contentId, emoji: "👍", count: 2, is_active: true }],
    });
    assert.deepEqual(emptyToolbar.emojiData.rows, []);
    assert.equal(toolbar.error, "");
    await client.getDiaryInteractions(contentId);
    assert.equal(actions.length, 1);
    assert.equal(rows.length, 3);
    assert.equal(rows.find(r => r.id === own.id).isOwn, true);
    assert.equal(rows.find(r => r.id === other.id).isOwn, false);
    assert.equal(rows.find(r => r.id === pending.id).status, "pending");
    assert.equal(rows.find(r => r.id === own.id).interaction_count, 0);
    assert.equal(rows.find(r => r.id === other.id).interaction_count, 2);
    const storedCommentKeys = () =>
      [...store.keys()].filter(
        key =>
          key.startsWith("astro-paper:diary-comments:v1:") &&
          !key.includes(":index:")
      );
    const persistedKey = storedCommentKeys().find(key =>
      key.endsWith(`:${contentId}`)
    );
    const persisted = JSON.parse(store.get(persistedKey));
    assert.ok(persisted.expiresAt > Date.now() + 299_000);
    assert.ok(persisted.expiresAt <= Date.now() + 300_000);
    assert.ok(!persistedKey.includes(ownerToken));
    assert.ok(!store.get(persistedKey).includes("private@example.test"));
    assert.ok(!store.get(persistedKey).includes("owner_hash"));
    const reload = async name => {
      const reloadPath = join(folder, `${name}.mjs`);
      await writeFile(reloadPath, code);
      return import(pathToFileURL(reloadPath).href);
    };
    const reloaded = await reload("reloaded");
    const beforeRestore = actions.length;
    assert.deepEqual(
      (await reloaded.getDiaryInteractions(contentId)).comments,
      rows
    );
    assert.equal(actions.length, beforeRestore);
    store.delete("astro-paper:diary-comment-owner:v1");
    assert.equal(await reloaded.getCachedDiaryComments(contentId), null);
    store.set("astro-paper:diary-comment-owner:v1", "b".repeat(64));
    assert.equal(await reloaded.getCachedDiaryComments(contentId), null);
    store.set("astro-paper:diary-comment-owner:v1", ownerToken);
    assert.deepEqual(await reloaded.getCachedDiaryComments(contentId), rows);
    await assert.rejects(
      () => client.toggleDiaryCommentReaction(rows.find(r => r.id === own.id)),
      /只能互动别人/
    );
    const added = await client.toggleDiaryCommentReaction(
      rows.find(r => r.id === other.id)
    );
    assert.deepEqual(added, { interaction_count: 3, is_active: true });
    const afterReactionReload = await reload("after-reaction");
    assert.equal(
      (await afterReactionReload.getCachedDiaryComments(contentId)).find(
        row => row.id === other.id
      ).has_reacted,
      true
    );
    assert.equal(
      JSON.parse(store.get(persistedKey)).expiresAt,
      persisted.expiresAt
    );
    assert.equal(
      (await client.getDiaryComments(contentId)).find(r => r.id === other.id)
        .has_reacted,
      true
    );
    const cancelled = await client.toggleDiaryCommentReaction(
      rows.find(r => r.id === other.id)
    );
    assert.deepEqual(cancelled, { interaction_count: 2, is_active: false });
    assert.ok(!JSON.stringify(rows).includes("private@example.test"));
    assert.ok(!JSON.stringify(rows).includes("owner_hash"));
    assert.ok(!JSON.stringify(toolbar).includes("must-not-leak"));
    const before = actions.length;
    await assert.rejects(
      () => client.removeDiaryComment(rows.find(r => r.id === other.id)),
      /只能撤回自己的/
    );
    assert.equal(actions.length, before);
    await assert.rejects(
      () =>
        client.removeDiaryComment({
          ...rows.find(r => r.id === other.id),
          isOwn: true,
        }),
      /不属于你/
    );
    const readsBefore = actions.filter(body => body.action === "list").length;
    const started = new Promise(resolve => {
      listStarted = resolve;
    });
    holdNextList = true;
    const slowRead = client.getDiaryComments(contentId, true);
    await started;
    const concurrentRead = client.getDiaryComments(contentId, true);
    await new Promise(setImmediate);
    assert.equal(
      actions.filter(body => body.action === "list").length,
      readsBefore + 1
    );
    await client.removeDiaryComment(rows.find(r => r.id === own.id));
    assert.equal(removed, true);
    assert.equal(store.has(persistedKey), false);
    const afterDeleteReload = await reload("after-delete");
    assert.equal(
      await afterDeleteReload.getCachedDiaryComments(contentId),
      null
    );
    releaseList();
    const [freshRows, sharedRows] = await Promise.all([
      slowRead,
      concurrentRead,
    ]);
    assert.deepEqual(sharedRows, freshRows);
    assert.ok(!freshRows.some(row => row.id === own.id));
    assert.equal(
      actions.filter(body => body.action === "list").length,
      readsBefore + 2
    );
    assert.ok(
      !(await client.getDiaryComments(contentId)).some(r => r.id === own.id)
    );
    const batchStart = actions.length;
    await Promise.all(
      Array.from({ length: 51 }, (_, i) =>
        client.getDiaryInteractions(
          `emoji-reactions-2026-10-10-${String(Math.floor(i / 60)).padStart(2, "0")}-${String(i % 60).padStart(2, "0")}`,
          true
        )
      )
    );
    assert.deepEqual(
      actions.slice(batchStart).map(body => body.content_ids.length),
      [50, 1]
    );
    assert.ok(
      actions
        .slice(batchStart)
        .every(body => Buffer.byteLength(JSON.stringify(body)) <= 2048)
    );

    const realNow = Date.now;
    try {
      const expiredAt = Date.now() + 300_001;
      Date.now = () => expiredAt;
      const expiredClient = await reload("expired");
      assert.equal(await expiredClient.getCachedDiaryComments(contentId), null);
      const beforeExpired = actions.length;
      await expiredClient.getDiaryInteractions(contentId);
      assert.equal(actions.length, beforeExpired + 1);
      assert.equal(actions.at(-1).action, "list");
    } finally {
      Date.now = realNow;
    }
    await client.getDiaryComments(contentId, true);
    store.set(persistedKey, "{broken json");
    const corruptClient = await reload("corrupt");
    assert.equal(await corruptClient.getCachedDiaryComments(contentId), null);
    assert.equal(store.has(persistedKey), false);
    const workingStorage = globalThis.localStorage;
    try {
      globalThis.localStorage = {
        getItem: key =>
          key === "astro-paper:diary-comment-owner:v1" ? ownerToken : null,
        setItem: () => {
          throw new Error("quota exceeded");
        },
        removeItem: () => {},
      };
      const memoryOnlyClient = await reload("memory-only");
      const beforeMemory = actions.length;
      const memoryRows = await memoryOnlyClient.getDiaryComments(
        contentId,
        true
      );
      assert.deepEqual(
        await memoryOnlyClient.getCachedDiaryComments(contentId),
        memoryRows
      );
      await memoryOnlyClient.getDiaryInteractions(contentId);
      assert.equal(actions.length, beforeMemory + 1);
    } finally {
      globalThis.localStorage = workingStorage;
    }
    await Promise.all(
      Array.from({ length: 105 }, (_, i) =>
        client.getDiaryComments(
          `emoji-reactions-2026-10-11-${String(Math.floor(i / 60)).padStart(2, "0")}-${String(i % 60).padStart(2, "0")}`,
          true
        )
      )
    );
    assert.ok(storedCommentKeys().length <= 100);
    const indexKeys = [...store.keys()].filter(key =>
      key.startsWith("astro-paper:diary-comments:v1:index:")
    );
    assert.ok(indexKeys.every(key => JSON.parse(store.get(key)).length <= 100));
    await client.getDiaryComments(contentId, true);
    assert.equal(store.has(persistedKey), true);
    await client.submitDiaryComment({
      content_id: contentId,
      message: "本地测试发表",
    });
    assert.equal(store.has(persistedKey), false);
    assert.equal(await client.getCachedDiaryComments(contentId), null);
    const afterPublishReload = await reload("after-publish");
    assert.equal(
      await afterPublishReload.getCachedDiaryComments(contentId),
      null
    );

    const incompatibleActions = [];
    let oldResponse = false;
    globalThis.__commentClientMock = {
      rpc: async () => {
        throw new Error("Old public RPC must never be called");
      },
      functions: {
        invoke: async (_name, { body }) => {
          incompatibleActions.push(body.action);
          return oldResponse
            ? { data: { comments: [] }, error: null }
            : {
                data: null,
                error: {
                  context: Response.json(
                    { error: "评论服务暂时不可用" },
                    { status: 503 }
                  ),
                },
              };
        },
      },
    };
    emojiCache.clear();
    const incompatiblePath = join(folder, "incompatible-client.mjs");
    await writeFile(incompatiblePath, code);
    const incompatibleClient = await import(
      pathToFileURL(incompatiblePath).href
    );
    const failed = await incompatibleClient.getDiaryInteractions(
      contentId,
      true
    );
    assert.equal(failed.comments, null);
    assert.equal(failed.emojiData, null);
    assert.match(failed.error, /评论服务暂时不可用/);
    assert.deepEqual(incompatibleActions, ["list"]);
    oldResponse = true;
    const outdated = await incompatibleClient.getDiaryInteractions(
      contentId,
      true
    );
    assert.deepEqual(outdated.comments, []);
    assert.equal(outdated.emojiData, null);
    assert.match(outdated.error, /部署新版 diary-comment/);
    assert.deepEqual(incompatibleActions, ["list", "list"]);
    let submissionMode = "rejected";
    const submissionActions = [];
    globalThis.__commentClientMock = {
      functions: {
        invoke: async (_name, { body }) => {
          submissionActions.push(body.action ?? "submit");
          if (submissionMode === "approved")
            return { data: { status: "approved" }, error: null };
          if (submissionMode === "pending")
            return { data: { status: "pending" }, error: null };
          return {
            data: null,
            error: {
              context: Response.json(
                {
                  error: "昵称未通过审核，请修改昵称或留空后再试",
                  reason_codes: ["political_nickname"],
                },
                { status: 422 }
              ),
            },
          };
        },
      },
    };
    const rejectionPath = join(folder, "rejection-client.mjs");
    await writeFile(rejectionPath, code);
    const rejectionClient = await import(pathToFileURL(rejectionPath).href);
    await assert.rejects(
      () =>
        rejectionClient.submitDiaryComment({
          content_id: contentId,
          message: "新的评论",
        }),
      /昵称未通过审核/
    );
    submissionMode = "pending";
    await assert.rejects(
      () =>
        rejectionClient.submitDiaryComment({
          content_id: contentId,
          message: "新的评论",
        }),
      /评论暂时无法提交/
    );
    submissionMode = "approved";
    assert.equal(
      await rejectionClient.submitDiaryComment({
        content_id: contentId,
        message: "新的评论",
      }),
      "approved"
    );
    assert.deepEqual(submissionActions, ["submit", "submit", "submit"]);
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    await assert.rejects(
      () =>
        incompatibleClient.submitDiaryComment({
          content_id: contentId,
          message: "新的评论",
        }),
      /撤回凭证/
    );
    assert.equal(incompatibleActions.length, 2);

    // A comments-only outage still exposes the emoji result from the same response.
    globalThis.__commentClientMock = {
      rpc: async () => ({ data: null, error: { code: "unavailable" } }),
      functions: {
        invoke: async () => ({
          data: {
            comment_error: "评论暂时无法加载",
            emoji_reactions: [
              { content_id: contentId, emoji: "👍", count: 2, is_active: true },
            ],
          },
          error: null,
        }),
      },
    };
    const partialPath = join(folder, "partial-client.mjs");
    await writeFile(partialPath, code);
    const partialClient = await import(pathToFileURL(partialPath).href);
    const partial = await partialClient.getDiaryInteractions(contentId, true);
    assert.equal(partial.comments, null);
    assert.equal(partial.emojiData.rows[0].count, 2);
    assert.match(partial.error, /评论暂时无法加载/);
    globalThis.localStorage = {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: key => store.delete(key),
    };
    let ratePosts = 0,
      rateLists = 0,
      releaseQuota = false;
    globalThis.__commentClientMock = {
      functions: {
        invoke: async (_name, { body }) => {
          if (body.action === "list") {
            rateLists++;
            return { data: { comments: [], emoji_reactions: [] }, error: null };
          }
          ratePosts++;
          if (releaseQuota)
            return { data: { status: "approved" }, error: null };
          return {
            data: null,
            error: {
              context: Response.json(
                {
                  error:
                    "今日评论发表次数已达上限（100 条），请于北京时间 10月10日 08:00:00 后重试",
                  rate_limit: {
                    scope: "submit",
                    reason: "ip_day",
                    limit: 100,
                    used: 100,
                    retry_after: 30,
                    resets_at: new Date(Date.now() + 30_000).toISOString(),
                  },
                },
                { status: 429 }
              ),
            },
          };
        },
      },
    };
    const rateClient = await reload("rate-client");
    const rateInput = { content_id: contentId, message: "限流测试" };
    await assert.rejects(
      () => rateClient.submitDiaryComment(rateInput),
      rateClient.DiaryCommentRateLimitError
    );
    const cooldown = rateClient.getDiaryCommentCooldown();
    assert.ok(cooldown.until > Date.now());
    await assert.rejects(
      () => rateClient.submitDiaryComment(rateInput),
      /100 条/
    );
    const rateReload = await reload("rate-reload");
    await assert.rejects(
      () => rateReload.submitDiaryComment(rateInput),
      /100 条/
    );
    assert.equal(
      ratePosts,
      1,
      "cooldown and page reload must not issue another POST"
    );
    assert.deepEqual(
      (await rateClient.getDiaryInteractions(contentId, true)).comments,
      []
    );
    assert.equal(
      rateLists,
      1,
      "read requests remain available while publishing is rate limited"
    );
    const cooldownStorageKey = [...store.keys()].find(
      key =>
        key.startsWith("astro-paper:diary-comment-cooldown:v1:") &&
        key.endsWith(":submit")
    );
    const otherTabCooldown = { ...cooldown, until: cooldown.until + 5000 };
    store.set(cooldownStorageKey, JSON.stringify(otherTabCooldown));
    assert.equal(
      rateClient.getDiaryCommentCooldown().until,
      otherTabCooldown.until
    );
    const cooldownNow = Date.now;
    try {
      Date.now = () => otherTabCooldown.until + 1;
      releaseQuota = true;
      assert.equal(rateClient.getDiaryCommentCooldown(), null);
      assert.equal(await rateClient.submitDiaryComment(rateInput), "approved");
      assert.equal(ratePosts, 2);
    } finally {
      Date.now = cooldownNow;
    }
  } finally {
    if (previous.window === undefined) delete globalThis.window;
    else globalThis.window = previous.window;
    if (previous.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous.localStorage;
    if (previous.client === undefined) delete globalThis.__commentClientMock;
    else globalThis.__commentClientMock = previous.client;
    if (previous.helpers === undefined)
      delete globalThis.__commentClientHelpers;
    else globalThis.__commentClientHelpers = previous.helpers;
    await rm(folder, { recursive: true, force: true });
  }
});
