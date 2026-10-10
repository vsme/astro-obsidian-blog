export const COMMENT_LIMIT = 20;
export const NICKNAME_LIMIT = 20;
export const COMMENT_ICONS = [
  { emoji: "👍", label: "赞" },
  { emoji: "👎", label: "不赞同" },
  { emoji: "😄", label: "开心" },
  { emoji: "😕", label: "困惑" },
  { emoji: "🎉", label: "庆祝" },
  { emoji: "❤️", label: "喜欢" },
  { emoji: "🚀", label: "加油" },
  { emoji: "👀", label: "围观" },
];
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
export function countCharacters(value) {
  return Array.from(segmenter.segment(value)).length;
}
export function normalizeNickname(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\p{Z}\p{P}\p{Cf}]/gu, "");
}
export function validateComment(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("评论格式不正确");
  const read = key => {
    if (input[key] == null) return "";
    if (typeof input[key] !== "string") throw new Error("评论格式不正确");
    return input[key].trim().normalize("NFC");
  };
  const content_id = read("content_id"),
    message = read("message"),
    emoji = read("emoji"),
    nickname = read("nickname"),
    email = read("email");
  if (!/^emoji-reactions-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(content_id))
    throw new Error("请选择一条日志");
  if (!message && !emoji) throw new Error("写一句话，或选择一个图标");
  if (countCharacters(message) > COMMENT_LIMIT || message.length > 320)
    throw new Error("评论不能超过 20 个字");
  if (countCharacters(nickname) > NICKNAME_LIMIT || nickname.length > 160)
    throw new Error("昵称不能超过 20 个字");
  if (
    /[\p{Cc}\p{Cf}]/u.test(message.replace(/\u200d/g, "")) ||
    /[\p{Cc}\p{Cf}]/u.test(nickname.replace(/\u200d/g, ""))
  )
    throw new Error("请使用普通文字或表情");
  if (emoji && !COMMENT_ICONS.some(icon => icon.emoji === emoji))
    throw new Error("请选择列表中的图标");
  if (
    email &&
    (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    throw new Error("邮箱格式不正确");
  return {
    content_id,
    message,
    emoji: emoji || null,
    nickname: nickname || null,
    email: email || null,
  };
}
