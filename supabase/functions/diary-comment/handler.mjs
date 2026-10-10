import {
  validateComment,
  COMMENT_ICONS,
} from "../../../src/utils/commentRules.mjs";
import { APPROVAL_THRESHOLDS } from "./jev.mjs";
export function createCommentHandler({
  origins,
  apiKeys,
  configured,
  storageConfigured = configured,
  reserve,
  review,
  save,
  remove,
  react,
  list,
  emojiToggle = async () => {
    throw new Error("Emoji toggle unavailable");
  },
  emojiList = async () => {
    throw new Error("Emoji list unavailable");
  },
}) {
  return async request => {
    const origin = request.headers.get("origin");
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    const json = (status, body) =>
      new Response(JSON.stringify(body), { status, headers });
    if (!origin || !origins.includes(origin))
      return json(403, { error: "请求来源不允许" });
    Object.assign(headers, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Expose-Headers": "Retry-After",
    });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return json(405, { error: "请使用评论表单提交" });
    if (!apiKeys.length || !apiKeys.includes(request.headers.get("apikey")))
      return json(401, { error: "评论暂时不可用" });
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return json(415, { error: "评论格式不正确" });
    let comment, body, ownerToken, action;
    try {
      // Count actual streamed bytes; Content-Length alone is client-controlled.
      const reader = request.body?.getReader();
      if (!reader) return json(400, { error: "评论不能为空" });
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2048) {
          await reader.cancel();
          return json(413, { error: "评论内容过长" });
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      body = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      );
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Error("评论格式不正确");
      action = body.action ?? "submit";
      if (!["submit", "remove", "react", "list", "emoji"].includes(action))
        throw new Error("评论操作不正确");
      ownerToken = body.owner_token;
      if (
        !(action === "emoji" || (action === "list" && ownerToken == null)) &&
        (typeof ownerToken !== "string" || !/^[a-f0-9]{64}$/.test(ownerToken))
      )
        throw new Error("评论凭证无效，请刷新页面后重试");
      if (action === "submit") comment = validateComment(body);
      if (
        (action === "emoji" ||
          (action === "list" && body.emoji_user_hash != null)) &&
        (typeof body.emoji_user_hash !== "string" ||
          body.emoji_user_hash.length < 1 ||
          body.emoji_user_hash.length > 128 ||
          /[\u0000-\u001f\u007f]/.test(body.emoji_user_hash))
      )
        throw new Error("表情凭证格式不正确");
      if (
        action === "emoji" &&
        (typeof body.content_id !== "string" ||
          !body.content_id.startsWith("emoji-reactions-") ||
          body.content_id.length > 256 ||
          /[\u0000-\u001f\u007f]/.test(body.content_id) ||
          !COMMENT_ICONS.some(icon => icon.emoji === body.emoji))
      )
        throw new Error("请选择有效的日志和表情");
      if (
        action === "list" &&
        (!Array.isArray(body.content_ids) ||
          body.content_ids.length > 50 ||
          !body.content_ids.every(
            id =>
              typeof id === "string" &&
              /^emoji-reactions-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(id)
          ))
      )
        throw new Error("请选择有效的日志");
      if (
        ["remove", "react"].includes(action) &&
        (typeof body.comment_id !== "string" ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
            body.comment_id
          ))
      )
        throw new Error("请选择有效的评论");
    } catch (error) {
      return json(400, {
        error:
          error instanceof SyntaxError || error instanceof TypeError
            ? "评论格式不正确"
            : error.message,
      });
    }
    try {
      if (!(action === "submit" ? configured : storageConfigured))
        return json(503, { error: "评论服务暂时不可用，请稍后再试" });
      const rateResponse = (result, scope) => {
        if (!result || typeof result.allowed !== "boolean")
          throw new Error("Invalid rate result");
        if (result.allowed) return null;
        if (
          !["global_minute", "ip_minute", "ip_day"].includes(result.reason) ||
          !Number.isInteger(result.limit) ||
          result.limit < 1 ||
          !Number.isInteger(result.used) ||
          result.used < result.limit ||
          !Number.isInteger(result.retry_after) ||
          result.retry_after < 1 ||
          result.retry_after > 86400 ||
          typeof result.resets_at !== "string" ||
          !Number.isFinite(Date.parse(result.resets_at))
        )
          throw new Error("Invalid rate details");
        const reset = new Intl.DateTimeFormat("zh-CN", {
          timeZone: "Asia/Shanghai",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).format(new Date(result.resets_at));
        const noun =
          scope === "emoji"
            ? "表情互动"
            : scope === "react"
              ? "评论互动"
              : "评论提交";
        const message =
          result.reason === "ip_day"
            ? `今日${scope === "react" ? "评论互动" : "评论发表"}次数已达上限（${result.limit} ${scope === "react" ? "次" : "条"}）`
            : result.reason === "ip_minute"
              ? `本分钟${noun}次数已达上限（${result.limit} 次）`
              : `当前${noun}较多`;
        headers["Retry-After"] = String(result.retry_after);
        return json(429, {
          error: `${message}，请于北京时间 ${reset} 后重试`,
          rate_limit: {
            scope,
            reason: result.reason,
            limit: result.limit,
            used: result.used,
            retry_after: result.retry_after,
            resets_at: result.resets_at,
          },
        });
      };
      if (action === "emoji") {
        const result = await emojiToggle(
          request,
          body.content_id,
          body.emoji,
          body.emoji_user_hash
        );
        const limited = rateResponse(result, "emoji");
        if (limited) return limited;
        if (
          result.emoji !== body.emoji ||
          !Number.isInteger(result.new_count) ||
          result.new_count < 0 ||
          typeof result.is_active !== "boolean"
        )
          throw new Error("Invalid emoji result");
        return json(200, {
          emoji: result.emoji,
          new_count: result.new_count,
          is_active: result.is_active,
        });
      }
      const digest =
        ownerToken == null
          ? null
          : await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(ownerToken)
            );
      const ownerHash =
        digest === null
          ? null
          : Array.from(new Uint8Array(digest), byte =>
              byte.toString(16).padStart(2, "0")
            ).join("");
      if (action === "list") {
        const includeEmojis = body.emoji_user_hash != null;
        const [comments, emojis] = await Promise.allSettled([
          list(body.content_ids, ownerHash),
          includeEmojis
            ? emojiList(body.content_ids, body.emoji_user_hash)
            : Promise.resolve([]),
        ]);
        if (!includeEmojis && comments.status === "rejected")
          throw comments.reason;
        // A missing comment upgrade must not hide working emoji responses.
        const response = {};
        if (comments.status === "fulfilled")
          response.comments = comments.value.map(row => ({
            id: row.id,
            content_id: row.content_id,
            message: row.message,
            emoji: row.emoji,
            nickname: row.nickname,
            created_at: row.created_at,
            status: row.status,
            interaction_count: row.interaction_count,
            isOwn: row.is_own === true,
            has_reacted: row.has_reacted === true,
          }));
        else response.comment_error = "评论暂时无法加载";
        if (includeEmojis) {
          if (emojis.status === "fulfilled")
            response.emoji_reactions = emojis.value.map(row => ({
              content_id: row.content_id,
              emoji: row.emoji,
              count: row.count,
              is_active: row.is_active === true,
            }));
          else response.emoji_error = "表情暂时无法加载";
        }
        return json(200, response);
      }
      if (action === "react") {
        const limited = rateResponse(await reserve(request, "react"), "react");
        if (limited) return limited;
        const result = await react(body.comment_id, ownerHash);
        if (!result) return json(409, { error: "这条评论无法互动" });
        if (
          !Number.isInteger(result.interaction_count) ||
          result.interaction_count < 0 ||
          typeof result.is_active !== "boolean"
        )
          throw new Error("Invalid reaction result");
        return json(200, {
          interaction_count: result.interaction_count,
          is_active: result.is_active,
        });
      }
      if (action === "remove") {
        const removed = await remove(body.comment_id, ownerHash);
        return removed
          ? json(200, { removed: true })
          : json(404, { error: "评论不存在或不属于你，无法撤回" });
      }
      const limited = rateResponse(await reserve(request, "submit"), "submit");
      if (limited) return limited;
      const result = await review(comment);
      if (result.status === "rejected") {
        const messages = {
          profanity: "评论未通过用语审核，请调整措辞后再试",
          politics: "评论未通过政治内容审核，请修改内容后再试",
          political_nickname: "昵称未通过审核，请修改昵称或留空后再试",
        };
        const reasons = [
          ...new Set(
            (result.reasons ?? [result.reason]).filter(id =>
              Object.hasOwn(messages, id)
            )
          ),
        ];
        const details = reasons.flatMap(id => {
          const check = Array.isArray(result.results)
            ? result.results.find(item => item.id === id)
            : null;
          if (
            !check ||
            !["clear", "violation", "uncertain"].includes(check.choice) ||
            !Number.isFinite(check.confidence) ||
            !Number.isFinite(check.probabilities?.clear)
          )
            return [];
          return [
            {
              id,
              choice: check.choice,
              confidence: check.confidence,
              clear_probability: check.probabilities.clear,
              required_confidence: APPROVAL_THRESHOLDS[id].confidence,
              required_clear_probability: APPROVAL_THRESHOLDS[id].probability,
            },
          ];
        });
        const labels = {
          clear: "倾向通过但把握不足",
          violation: "触发过滤规则",
          uncertain: "不确定",
        };
        const percent = value => `${Math.round(value * 100)}%`;
        return json(422, {
          error: reasons.length
            ? reasons
                .map(id => {
                  const detail = details.find(item => item.id === id);
                  return detail
                    ? `${messages[id]}（模型判定：${labels[detail.choice]}；置信度 ${detail.confidence.toFixed(2)} / 要求 ${detail.required_confidence.toFixed(2)}；通过概率 ${percent(detail.clear_probability)} / 要求 ${percent(detail.required_clear_probability)}）`
                    : messages[id];
                })
                .join("；")
            : "评论未通过审核，请修改内容或昵称后再试",
          reason_codes: reasons,
          review_details: details,
        });
      }
      if (result.status !== "approved")
        throw new Error("Invalid moderation status");
      const publicationLimit = rateResponse(
        await save(comment, result, ownerHash, request),
        "submit"
      );
      if (publicationLimit) return publicationLimit;
      // Only a status leaves the server. No email, review payload or private id.
      return json(201, { status: "approved" });
    } catch {
      return json(503, { error: "评论服务暂时不可用，请稍后再试" });
    }
  };
}
