import test from "node:test";
import assert from "node:assert/strict";
import {
  validateComment,
  countCharacters,
  normalizeNickname,
} from "../src/utils/commentRules.mjs";
import {
  makeReviewRequest,
  decideReview,
  reviewWithJev,
} from "../supabase/functions/diary-comment/jev.mjs";
import { createCommentHandler } from "../supabase/functions/diary-comment/handler.mjs";
import { getCommentOwnerToken } from "../src/utils/commentOwner.mjs";
const input = {
  content_id: "emoji-reactions-2026-10-07-12-00",
  message: "喜欢这几条小鱼",
  emoji: "❤️",
  nickname: "小鱼",
  email: "test@example.com",
};
const ownerToken = "a".repeat(64);
test("浏览器归属凭证持久保存；存储不可用时不伪造临时所有权", () => {
  const previousWindow = globalThis.window,
    previousStorage = globalThis.localStorage;
  const storage = new Map();
  try {
    globalThis.window = {};
    globalThis.localStorage = {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    };
    assert.equal(getCommentOwnerToken(), null);
    const token = getCommentOwnerToken(true);
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(getCommentOwnerToken(true), token);
    storage.clear();
    assert.notEqual(getCommentOwnerToken(true), token);
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    assert.equal(getCommentOwnerToken(), null);
    assert.throws(() => getCommentOwnerToken(true), /撤回凭证/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});
const clear = {
  type: "choice",
  choice: "clear",
  confidence: 0.98,
  probabilities: { clear: 0.99, violation: 0.005, uncertain: 0.005 },
};
const response = answers => ({
  model: "jev-1.13.0",
  answers: {
    profanity: clear,
    politics: clear,
    political_nickname: clear,
    ...answers,
  },
});
test("20字边界和组合表情一致，服务器拒绝第21字", () => {
  assert.equal(countCharacters("👨‍👩‍👧‍👦"), 1);
  assert.equal(countCharacters("e\u0301"), 1);
  assert.equal(
    validateComment({ ...input, message: "鱼".repeat(20) }).message.length,
    20
  );
  assert.throws(
    () => validateComment({ ...input, message: "鱼".repeat(21) }),
    /20/
  );
  assert.equal(
    countCharacters(
      validateComment({ ...input, message: "👨‍👩‍👧‍👦".repeat(20) }).message
    ),
    20
  );
});
test("所有选填字段可空；图标也可单独发表", () => {
  assert.deepEqual(
    validateComment({ content_id: input.content_id, message: "好看" }),
    {
      content_id: input.content_id,
      message: "好看",
      emoji: null,
      nickname: null,
      email: null,
    }
  );
  assert.equal(
    validateComment({ content_id: input.content_id, emoji: "👍" }).message,
    ""
  );
  assert.throws(
    () => validateComment({ content_id: input.content_id }),
    /写一句/
  );
});
test("昵称长度、非法字段类型、图标、邮箱和非日志ID由服务器检验", () => {
  for (const invalid of [
    { nickname: "鱼".repeat(21) },
    { message: [] },
    { emoji: "<svg>" },
    { email: "invalid" },
    { content_id: "footprint-1" },
    { message: "hello\u202e" },
  ])
    assert.throws(() => validateComment({ ...input, ...invalid }));
});
test("去音调、空白、大小写和分隔符的昵称，不发送邮箱", () => {
  assert.equal(normalizeNickname("Xí Jìn-Píng"), "xijinping");
  const payload = makeReviewRequest(input);
  assert.deepEqual(Object.keys(payload.questions), [
    "profanity",
    "politics",
    "political_nickname",
  ]);
  assert.equal(payload.model, "jev-1.13.0");
  assert.ok(!JSON.stringify(payload).includes("test@example.com"));
  assert.ok(!JSON.stringify(payload).includes(input.content_id));
  assert.match(
    payload.questions.political_nickname.instructions,
    /pinyin.*tones/
  );
});
test("只保留自动通过和拒绝，不再产生人工审核状态", () => {
  assert.equal(decideReview(response()).status, "approved");
  assert.equal(
    decideReview(response({ politics: { ...clear, confidence: 0.6 } })).status,
    "rejected"
  );
  assert.equal(
    decideReview(
      response({
        profanity: {
          type: "choice",
          choice: "violation",
          confidence: 0.98,
          probabilities: { clear: 0.005, violation: 0.99, uncertain: 0.005 },
        },
      })
    ).status,
    "rejected"
  );
  assert.equal(
    decideReview(
      response({
        political_nickname: {
          type: "choice",
          choice: "uncertain",
          confidence: 0.98,
          probabilities: { clear: 0.005, violation: 0.005, uncertain: 0.99 },
        },
      })
    ).status,
    "rejected"
  );
});
test("缺字段、NaN、乱填概率和矛盾选择都不能通过", () => {
  for (const answer of [
    {},
    { ...clear, confidence: NaN },
    { ...clear, probabilities: { clear: 0.6, violation: 0.6, uncertain: 0.6 } },
    { ...clear, choice: "invalid" },
    {
      ...clear,
      probabilities: { clear: 0.05, violation: 0.9, uncertain: 0.05 },
    },
  ])
    assert.throws(() => decideReview(response({ politics: answer })));
  assert.throws(() => decideReview({ model: "jev-1.13.0", answers: {} }));
});
test("按官方Jev协议调用，失败封闭，不使用聊天补全接口", async () => {
  let called = false;
  const decision = await reviewWithJev(input, {
    apiKey: "fake-key",
    fetcher: async (url, options) => {
      called = true;
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.equal(options.headers.Authorization, "Bearer fake-key");
      assert.equal(JSON.parse(options.body).state.nickname, "小鱼");
      assert.ok(!options.body.includes(input.email));
      return Response.json(response());
    },
  });
  assert.ok(called);
  assert.equal(decision.status, "approved");
  await assert.rejects(() =>
    reviewWithJev(input, {
      apiKey: "fake",
      fetcher: async () => new Response("", { status: 529 }),
    })
  );
});
const setup = (overrides = {}) => {
  const saved = [];
  let reviews = 0;
  const handler = createCommentHandler({
    origins: ["https://site.example.test"],
    apiKeys: ["fake-public"],
    configured: true,
    reserve: async () => ({ allowed: true }),
    review: async () => {
      reviews++;
      return decideReview(response());
    },
    save: async (c, r, ownerHash) => {
      saved.push({ c, r, ownerHash });
      return { allowed: true };
    },
    list: async () => [],
    remove: async () => false,
    ...overrides,
  });
  return {
    handler,
    saved,
    get reviews() {
      return reviews;
    },
  };
};
const request = (body = input, options = {}) =>
  new Request("https://example.test/diary-comment", {
    method: "POST",
    headers: {
      origin: "https://site.example.test",
      apikey: "fake-public",
      "content-type": "application/json",
      ...options.headers,
    },
    body:
      typeof body === "string"
        ? body
        : JSON.stringify({ owner_token: ownerToken, ...body }),
  });
test("通过后原子保存所需私有字段，响应没有邮箱和审核详情", async () => {
  const s = setup(),
    r = await s.handler(request());
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { status: "approved" });
  assert.equal(s.saved[0].c.email, input.email);
  assert.match(s.saved[0].ownerHash, /^[a-f0-9]{64}$/);
  assert.notEqual(s.saved[0].ownerHash, ownerToken);
  assert.ok(!JSON.stringify(s.saved[0].c).includes(ownerToken));
});

test("缺失或伪造归属凭证不能发表，归属不由昵称/邮箱决定", async () => {
  for (const req of [
    request(JSON.stringify(input)),
    request({ ...input, owner_token: "fake" }),
  ]) {
    const s = setup(),
      r = await s.handler(req);
    assert.equal(r.status, 400);
    assert.equal(s.saved.length, 0);
    assert.equal(s.reviews, 0);
  }
});

test("只返回凭证所属评论；响应投影不含邮箱、审核或所有者哈希", async () => {
  let called;
  const s = setup({
    list: async (ids, hash) => {
      called = { ids, hash };
      return [
        {
          id: "own-id",
          content_id: input.content_id,
          message: "自己的评论",
          emoji: null,
          nickname: null,
          created_at: "2026-10-09T00:00:00Z",
          status: "pending",
          is_own: true,
          interaction_count: 0,
          has_reacted: false,
          email: "private@example.test",
          owner_hash: hash,
          moderation: {},
        },
      ];
    },
  });
  const r = await s.handler(
    request({ action: "list", content_ids: [input.content_id] })
  );
  assert.equal(r.status, 200);
  assert.deepEqual(called.ids, [input.content_id]);
  assert.match(called.hash, /^[a-f0-9]{64}$/);
  const result = await r.json();
  assert.equal(result.comments[0].status, "pending");
  assert.deepEqual(
    Object.keys(result.comments[0]).sort(),
    [
      "id",
      "content_id",
      "message",
      "emoji",
      "nickname",
      "created_at",
      "status",
      "isOwn",
      "interaction_count",
      "has_reacted",
    ].sort()
  );
  assert.equal(s.reviews, 0);
});

test("已知评论ID和相同昵称不足以撤回；正确私有凭证才允许撤回", async () => {
  const expected = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(ownerToken)
      )
    ),
    byte => byte.toString(16).padStart(2, "0")
  ).join("");
  const commentId = "00000000-0000-4000-8000-000000000001";
  const s = setup({
    configured: false,
    storageConfigured: true,
    remove: async (id, hash) => id === commentId && hash === expected,
  });
  const denied = await s.handler(
    request({
      action: "remove",
      comment_id: commentId,
      owner_token: "b".repeat(64),
      nickname: input.nickname,
      email: input.email,
      isOwn: true,
    })
  );
  assert.equal(denied.status, 404);
  const removed = await s.handler(
    request({ action: "remove", comment_id: commentId })
  );
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { removed: true });
  assert.equal(s.reviews, 0);
  assert.equal(s.saved.length, 0);
});

test("非法删除ID、未知操作和超长归属查询在数据库操作前拒绝", async () => {
  for (const body of [
    { action: "remove", comment_id: "fake" },
    { action: "admin", comment_id: "fake" },
    { action: "mine", content_ids: [input.content_id] },
    { action: "list", content_ids: Array(51).fill(input.content_id) },
    { action: "list", content_ids: ["post-1"] },
  ]) {
    let touched = false;
    const s = setup({
      list: async () => {
        touched = true;
      },
      remove: async () => {
        touched = true;
      },
    });
    assert.equal((await s.handler(request(body))).status, 400);
    assert.equal(touched, false);
  }
});
test("审核器返回非法pending状态时不可保存或伪装成审核通过", async () => {
  const s = setup({
    review: async () => ({
      status: "pending",
      model: "jev-1.13.0",
      results: [],
    }),
  });
  const r = await s.handler(request());
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /暂时不可用/);
  assert.equal(s.saved.length, 0);
});
test("明确拒绝不保存邮箱或评论", async () => {
  const s = setup({
      review: async () => ({
        status: "rejected",
        reason: "political_nickname",
      }),
    }),
    r = await s.handler(request());
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /昵称/);
  assert.equal(s.saved.length, 0);
});
test("审核故障和非法结果、保存故障不对外泄露服务诊断", async () => {
  for (const overrides of [
    {
      review: async () => {
        throw new Error("secret provider log");
      },
    },
    { review: async () => ({ status: "fake" }) },
    {
      save: async () => {
        throw new Error("database secret");
      },
    },
  ]) {
    const s = setup(overrides),
      r = await s.handler(request());
    assert.equal(r.status, 503);
    assert.ok(!(await r.text()).includes("secret"));
  }
});
test("来源、apikey、格式、体积和限流在模型调用前拦截", async () => {
  for (const [req, expected] of [
    [request(input, { headers: { origin: "https://evil.test" } }), 403],
    [request(input, { headers: { apikey: "fake" } }), 401],
    [request({ ...input, message: "鱼".repeat(21) }), 400],
    [request("not-json"), 400],
    [request("x".repeat(2049)), 413],
  ]) {
    const s = setup(),
      r = await s.handler(req);
    assert.equal(r.status, expected);
    assert.equal(s.reviews, 0);
    assert.equal(s.saved.length, 0);
  }
  const s = setup({
      reserve: async () => ({
        allowed: false,
        reason: "ip_minute",
        limit: 5,
        used: 5,
        retry_after: 30,
        resets_at: new Date(Date.now() + 30_000).toISOString(),
      }),
    }),
    r = await s.handler(request());
  assert.equal(r.status, 429);
  assert.equal(s.reviews, 0);
});
test("分钟与每日限额明确返回等待时间；审核后并发满额也不得显示发表成功", async () => {
  const daily = {
    allowed: false,
    reason: "ip_day",
    limit: 100,
    used: 100,
    retry_after: 3600,
    resets_at: "2026-10-10T00:00:00.000Z",
    private_key: "never-expose",
  };
  for (const stage of ["reserve", "save"]) {
    const s = setup({ [stage]: async () => daily });
    const r = await s.handler(request());
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("Retry-After"), "3600");
    assert.equal(r.headers.get("Access-Control-Expose-Headers"), "Retry-After");
    const body = await r.json();
    assert.match(body.error, /100 条/);
    assert.match(body.error, /北京时间.*08:00/);
    assert.equal(body.rate_limit.reason, "ip_day");
    assert.equal(body.rate_limit.scope, "submit");
    assert.equal(body.status, undefined);
    assert.ok(!JSON.stringify(body).includes("never-expose"));
    assert.equal(s.reviews, stage === "reserve" ? 0 : 1);
    assert.equal(s.saved.length, 0);
  }
  for (const [reason, limit, message] of [
    ["ip_minute", 5, /本分钟/],
    ["global_minute", 30, /当前评论提交较多/],
  ]) {
    const s = setup({
      reserve: async () => ({
        ...daily,
        reason,
        limit,
        used: limit,
        retry_after: 30,
      }),
    });
    const r = await s.handler(request());
    assert.equal(r.status, 429);
    assert.match((await r.json()).error, message);
  }
  const invalid = setup({
    reserve: async () => ({ ...daily, retry_after: -1 }),
  });
  assert.equal((await invalid.handler(request())).status, 503);
  assert.equal(invalid.reviews, 0);
});

test("未配置审核不保存；预检不调用数据库与Jev", async () => {
  const s = setup({ configured: false });
  assert.equal((await s.handler(request())).status, 503);
  assert.equal(s.saved.length, 0);
  const r = await s.handler(
    new Request("https://example.test", {
      method: "OPTIONS",
      headers: { origin: "https://site.example.test" },
    })
  );
  assert.equal(r.status, 204);
  assert.equal(
    r.headers.get("Access-Control-Allow-Origin"),
    "https://site.example.test"
  );
  assert.equal(s.reviews, 0);
});

test("评论互动使用服务端凭证和独立限流，不调用审核；只返回计数和当前互动状态", async () => {
  let reservedScope, actor;
  const s = setup({
    configured: false,
    storageConfigured: true,
    reserve: async (_request, scope) => {
      reservedScope = scope;
      return { allowed: true };
    },
    react: async (id, hash) => {
      actor = { id, hash };
      return { interaction_count: 2, is_active: true, owner_hash: hash };
    },
  });
  const id = "00000000-0000-4000-8000-000000000001";
  const r = await s.handler(
    request({ action: "react", comment_id: id, owner_token: "b".repeat(64) })
  );
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { interaction_count: 2, is_active: true });
  assert.equal(reservedScope, "react");
  assert.equal(actor.id, id);
  assert.match(actor.hash, /^[a-f0-9]{64}$/);
  assert.notEqual(actor.hash, "b".repeat(64));
  assert.equal(s.reviews, 0);
  assert.equal(s.saved.length, 0);
});
test("服务端拒绝互动自己/未公开/不存在的评论；限流和非法结果不伪装成功", async () => {
  const body = {
    action: "react",
    comment_id: "00000000-0000-4000-8000-000000000001",
  };
  for (const [overrides, status] of [
    [{ react: async () => null }, 409],
    [
      {
        reserve: async () => ({
          allowed: false,
          reason: "ip_minute",
          limit: 5,
          used: 5,
          retry_after: 30,
          resets_at: new Date(Date.now() + 30_000).toISOString(),
        }),
      },
      429,
    ],
    [{ react: async () => ({ interaction_count: -1, is_active: true }) }, 503],
    [{ react: async () => ({ interaction_count: 1, is_active: "true" }) }, 503],
  ])
    assert.equal(
      (await setup(overrides).handler(request(body))).status,
      status
    );
  assert.equal(
    (await setup().handler(request({ ...body, comment_id: "bad" }))).status,
    400
  );
});

test("一次批量列表接口支持匿名访问和凭证归属，响应不包含私有信息", async () => {
  const seen = [];
  const s = setup({
    configured: false,
    storageConfigured: true,
    list: async (ids, hash) => {
      seen.push({ ids, hash });
      return [
        {
          id: "visible",
          content_id: input.content_id,
          message: "公开评论",
          emoji: null,
          nickname: null,
          created_at: "2026-10-09T00:00:00Z",
          status: "approved",
          interaction_count: 2,
          is_own: false,
          has_reacted: Boolean(hash),
          owner_hash: hash,
          email: "private@example.test",
        },
      ];
    },
  });
  const anon = await s.handler(
    request(JSON.stringify({ action: "list", content_ids: [input.content_id] }))
  );
  assert.equal(anon.status, 200);
  assert.equal(seen[0].hash, null);
  const anonBody = await anon.json();
  assert.equal(anonBody.comments[0].interaction_count, 2);
  assert.equal(anonBody.comments[0].isOwn, false);
  assert.equal(anonBody.comments[0].has_reacted, false);
  assert.ok(!JSON.stringify(anonBody).includes("private@example.test"));
  assert.ok(!JSON.stringify(anonBody).includes("owner_hash"));
  const owner = await s.handler(
    request({ action: "list", content_ids: [input.content_id] })
  );
  assert.equal(owner.status, 200);
  assert.match(seen[1].hash, /^[a-f0-9]{64}$/);
  assert.equal(s.reviews, 0);
  assert.equal(s.saved.length, 0);
});

test(
  "表情与评论在一次列表请求中并行读取，只返回公开投影",
  { timeout: 2000 },
  async () => {
    let releaseComments, releaseEmojis, commentsStarted, emojisStarted;
    const commentReady = new Promise(resolve => {
      commentsStarted = resolve;
    });
    const emojiReady = new Promise(resolve => {
      emojisStarted = resolve;
    });
    const s = setup({
      list: (ids, hash) => {
        assert.deepEqual(ids, [input.content_id]);
        assert.match(hash, /^[a-f0-9]{64}$/);
        commentsStarted();
        return new Promise(resolve => {
          releaseComments = resolve;
        });
      },
      emojiList: (ids, hash) => {
        assert.deepEqual(ids, [input.content_id]);
        assert.equal(hash, "browser-emoji-id");
        emojisStarted();
        return new Promise(resolve => {
          releaseEmojis = resolve;
        });
      },
    });
    const response = s.handler(
      request({
        action: "list",
        content_ids: [input.content_id],
        emoji_user_hash: "browser-emoji-id",
      })
    );
    await Promise.all([commentReady, emojiReady]);
    releaseComments([]);
    releaseEmojis([
      {
        content_id: input.content_id,
        emoji: "👍",
        count: 2,
        is_active: true,
        user_hash: "private-hash",
        email: input.email,
      },
    ]);
    const r = await response;
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      comments: [],
      emoji_reactions: [
        {
          content_id: input.content_id,
          emoji: "👍",
          count: 2,
          is_active: true,
        },
      ],
    });
    assert.equal(s.reviews, 0);
    assert.equal(s.saved.length, 0);
  }
);

test("合并读取的一部分故障不隐藏另一部分；限制批量大小和表情标识", async () => {
  const body = {
    action: "list",
    content_ids: [input.content_id],
    emoji_user_hash: "browser-emoji-id",
  };
  const brokenComments = setup({
    list: async () => {
      throw new Error("private database details");
    },
    emojiList: async () => [],
  });
  const emojiResponse = await brokenComments.handler(request(body));
  assert.equal(emojiResponse.status, 200);
  assert.deepEqual(await emojiResponse.json(), {
    comment_error: "评论暂时无法加载",
    emoji_reactions: [],
  });
  const brokenEmojis = setup({
    list: async () => [],
    emojiList: async () => {
      throw new Error("private database details");
    },
  });
  const commentResponse = await brokenEmojis.handler(request(body));
  assert.deepEqual(await commentResponse.json(), {
    comments: [],
    emoji_error: "表情暂时无法加载",
  });
  for (const hash of ["", "x".repeat(129), 123, "bad\nidentifier"])
    assert.equal(
      (await brokenEmojis.handler(request({ ...body, emoji_user_hash: hash })))
        .status,
      400
    );
  assert.equal(
    (
      await brokenEmojis.handler(
        request({ ...body, content_ids: Array(51).fill(input.content_id) })
      )
    ).status,
    400
  );
});

test("赞叹口语牛逼不按人身辱骂处理，截图评分可直接通过", () => {
  const request = makeReviewRequest({
    ...input,
    message: "牛逼",
    nickname: "vsme",
  });
  assert.equal(request.state.comment, "牛逼");
  assert.match(request.questions.profanity.instructions, /Positive praise/);
  assert.match(
    request.questions.profanity.instructions,
    /targeted abusive insults/
  );
  assert.match(
    request.questions.profanity.instructions,
    /牛逼 on its own is clear/
  );
  const decision = decideReview(
    response({
      profanity: {
        ...clear,
        confidence: 0.69,
        probabilities: { clear: 0.79, violation: 0.1, uncertain: 0.11 },
      },
      political_nickname: {
        ...clear,
        confidence: 0.91,
        probabilities: { clear: 0.94, violation: 0.01, uncertain: 0.05 },
      },
    })
  );
  assert.equal(decision.status, "approved");
  assert.deepEqual(decision.reasons, []);
});
test("降低通过门槛后，两张截图的昵称通过和疑似违规分支仍区分", () => {
  const accepted = decideReview(
    response({
      political_nickname: {
        ...clear,
        confidence: 0.89,
        probabilities: { clear: 0.93, violation: 0.01, uncertain: 0.06 },
      },
    })
  );
  assert.equal(accepted.status, "approved");
  const denied = decideReview(
    response({
      political_nickname: {
        ...clear,
        choice: "violation",
        confidence: 0.82,
        probabilities: { clear: 0.08, violation: 0.88, uncertain: 0.04 },
      },
    })
  );
  assert.equal(denied.status, "rejected");
  assert.deepEqual(denied.reasons, ["political_nickname"]);
});
test("新门槛边界与稍低结果保持一致：没有低分或uncertain漏进approved", () => {
  const acceptable = {
    ...clear,
    confidence: 0.6,
    probabilities: { clear: 0.75, violation: 0.1, uncertain: 0.15 },
  };
  assert.equal(
    decideReview(response({ profanity: acceptable })).status,
    "approved"
  );
  assert.equal(
    decideReview(response({ profanity: { ...acceptable, confidence: 0.59 } }))
      .status,
    "rejected"
  );
  assert.equal(
    decideReview(
      response({
        profanity: {
          ...acceptable,
          probabilities: { clear: 0.74, violation: 0.11, uncertain: 0.15 },
        },
      })
    ).status,
    "rejected"
  );
  const political = {
    ...clear,
    confidence: 0.75,
    probabilities: { clear: 0.8, violation: 0.1, uncertain: 0.1 },
  };
  assert.equal(
    decideReview(response({ politics: political })).status,
    "approved"
  );
  assert.equal(
    decideReview(response({ political_nickname: political })).status,
    "approved"
  );
  for (const id of ["politics", "political_nickname"])
    assert.equal(
      decideReview(
        response({
          [id]: {
            ...political,
            probabilities: { clear: 0.79, violation: 0.1, uncertain: 0.11 },
          },
        })
      ).status,
      "rejected"
    );
  assert.equal(
    decideReview(response({ politics: { ...political, confidence: 0.74 } }))
      .status,
    "rejected"
  );
});
test("不通过时前端得到明确的原因，多个检查失败都提示且不保存", async () => {
  const s = setup({
    review: async () => ({
      status: "rejected",
      reason: "profanity",
      reasons: ["profanity", "political_nickname"],
      model: "test",
      results: [],
    }),
  });
  const r = await s.handler(request());
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.match(body.error, /用语审核/);
  assert.match(body.error, /昵称/);
  assert.deepEqual(body.reason_codes, ["profanity", "political_nickname"]);
  assert.equal(s.saved.length, 0);
});

test("普通短昵称hh不允许靠首字母猜测政治人物身份", () => {
  const payload = makeReviewRequest({ ...input, nickname: "hh" });
  assert.equal(payload.state.nickname_normalized, "hh");
  assert.match(
    payload.questions.political_nickname.instructions,
    /do not invent name expansions/
  );
  assert.match(
    payload.questions.political_nickname.instructions,
    /hh, haha, lol and vsme are clear/
  );
  assert.match(
    payload.questions.political_nickname.instructions,
    /full pinyin/
  );
  assert.match(
    payload.questions.political_nickname.instructions,
    /well-known political aliases remain violations/
  );
});
test("拒绝结果直接向当前提交者提供真实失败判定、分数和门槛，不泄露输入或私有数据", async () => {
  const decision = decideReview(
    response({
      political_nickname: {
        ...clear,
        confidence: 0.69,
        probabilities: { clear: 0.79, violation: 0.1, uncertain: 0.11 },
      },
    })
  );
  const s = setup({ review: async () => decision });
  const r = await s.handler(request({ ...input, nickname: "hh" }));
  assert.equal(r.status, 422);
  const body = await r.json();
  assert.match(body.error, /倾向通过但把握不足/);
  assert.match(body.error, /0\.69/);
  assert.match(body.error, /79%/);
  assert.deepEqual(body.review_details, [
    {
      id: "political_nickname",
      choice: "clear",
      confidence: 0.69,
      clear_probability: 0.79,
      required_confidence: 0.75,
      required_clear_probability: 0.8,
    },
  ]);
  assert.ok(!JSON.stringify(body).includes(input.email));
  assert.ok(!JSON.stringify(body).includes(ownerToken));
  assert.equal(s.saved.length, 0);
});

test("表情写入不依赖审核密钥或评论归属凭证，支持足迹，拒绝伪造参数且只返回公开状态", async () => {
  const calls = [];
  const s = setup({
    configured: false,
    storageConfigured: true,
    reserve: () => {
      throw new Error("must not spend comment quota");
    },
    emojiToggle: async (req, id, emoji, user) => {
      calls.push({ id, emoji, user });
      return {
        allowed: true,
        emoji,
        new_count: 1,
        is_active: true,
        ip_hash: "private",
        email: "private@example.test",
      };
    },
  });
  const body = {
    action: "emoji",
    content_id: "emoji-reactions-footprint-a-b",
    emoji: "👍",
    emoji_user_hash: "browser-id",
  };
  const r = await s.handler(request(JSON.stringify(body)));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {
    emoji: "👍",
    new_count: 1,
    is_active: true,
  });
  assert.equal(s.reviews, 0);
  assert.equal(s.saved.length, 0);
  for (const bad of [
    { emoji: "invalid" },
    { content_id: "unrelated" },
    { content_id: "emoji-reactions-" + "x".repeat(256) },
    { content_id: "emoji-reactions-bad\n" },
    { emoji_user_hash: null },
    { emoji_user_hash: "" },
    { emoji_user_hash: "x".repeat(129) },
  ])
    assert.equal(
      (await s.handler(request(JSON.stringify({ ...body, ...bad })))).status,
      400
    );
  assert.equal(calls.length, 1);
});
