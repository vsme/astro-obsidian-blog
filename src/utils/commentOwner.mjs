const STORAGE_KEY = "astro-paper:diary-comment-owner:v1";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

// Anonymous ownership is a private browser capability, never a nickname or IP.
export function getCommentOwnerToken(create = false) {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && TOKEN_PATTERN.test(saved)) return saved;
    if (!create) return null;
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    localStorage.setItem(STORAGE_KEY, token);
    if (localStorage.getItem(STORAGE_KEY) !== token)
      throw new Error("Storage unavailable");
    return token;
  } catch {
    if (create)
      throw new Error("请允许浏览器保存本站数据，才能保留评论撤回凭证");
    return null;
  }
}
