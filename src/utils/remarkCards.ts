import { visit } from "unist-util-visit";
import type { Root, Code } from "mdast";
import type { Plugin } from "unified";
import { valueToEstree } from "estree-util-value-to-estree";

type SupportedType = "movie" | "tv" | "book" | "music";

export interface MediaData {
  id?: number | string;
  title: string;
  release_date?: string;
  region?: string;
  rating?: number;
  runtime?: number;
  genres?: string | string[];
  overview?: string;
  poster?: string; // 兼容字段
  author?: string;
  album?: string;
  duration?: number;
  url?: string;
  source?: string; // "douban" | "tmdb" | ...
  external_url?: string;
  publisher?: string;
  isbn?: string;
  pages?: number;
  // 其他字段也允许：插件不会强杀未知键
  [k: string]: unknown;
}

export interface RemarkCardsOptions {
  /**
   * 支持的类型（可扩展）
   */
  types?: SupportedType[];
  /**
   * 将哪些字段作为“标量属性”摊平到 JSX 上（可根据你组件 props 需要自定义）
   */
  flattenKeys?: string[];
}

/** 工具：去掉包裹的引号与多余空白 */
function stripQuotes(s: string) {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/** 解析 card 配置文本：key: value 行为主；支持数组、数字、布尔、多行文本 */
function parseKVBlock(raw: string): Record<string, unknown> {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: Record<string, unknown> = {};
  let lastKey: string | null = null;
  let collectingBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 空行直接跳过，但如果在多行文本中则保留
    if (!collectingBlock && !line.trim()) continue;

    // 多行文本：以两格或四格缩进继续拼接
    if (collectingBlock) {
      const m = line.match(/^(\s+)(.*)$/);
      if (m) {
        out[lastKey!] = String(out[lastKey!]) + "\n" + m[2];
        continue;
      } else {
        // 结束多行块，回退一行重试解析为新的 key
        collectingBlock = false;
        lastKey = null;
        i--;
        continue;
      }
    }

    // key: value
    const m = line.match(/^\s*([A-Za-z0-9_\-]+)\s*:\s*(.*)\s*$/);
    if (!m) continue;

    const key = m[1];
    const val = m[2];

    // YAML 风格 “|” 开启多行块
    if (val === "|" || val === ">" || val === "''" || val === '""') {
      out[key] = "";
      lastKey = key;
      collectingBlock = true;
      continue;
    }

    // 逗号数组
    if (val.includes(",") && !/^https?:\/\//i.test(val)) {
      const arr = val
        .split(/[,，]/)
        .map(s => stripQuotes(s).trim())
        .filter(Boolean);
      out[key] = arr;
      continue;
    }

    // 标量：尝试转成 number / boolean
    const v = stripQuotes(val);
    if (/^\d+(\.\d+)?$/.test(v)) {
      out[key] = Number(v);
    } else if (/^(true|false)$/i.test(v)) {
      out[key] = v.toLowerCase() === "true";
    } else {
      out[key] = v;
    }
  }

  return out;
}

/** 将配置折叠为 MediaData，处理兼容字段与命名统一 */
function normalizeToMediaData(
  obj: Record<string, unknown>,
  type: SupportedType
): MediaData | null {
  const title = String(obj.title ?? "").trim();
  if (!title) return null;

  const out: MediaData = {
    title,
  };

  // 允许的常见键位（保持与你仓库的数据结构一致）
  const passthroughKeys = [
    "id",
    "release_date",
    "region",
    "rating",
    "runtime",
    "genres",
    "overview",
    "author",
    "album",
    "duration",
    "url",
    "source",
    "external_url",
    "publisher",
    "isbn",
    "pages",
  ];

  for (const k of passthroughKeys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }

  // 类型特定补充：可根据需要做校验
  if ((type === "movie" || type === "tv") && typeof out.runtime === "string") {
    const num = Number(out.runtime);
    if (!Number.isNaN(num)) out.runtime = num;
  }
  if (type === "music" && typeof out.duration === "string") {
    const num = Number(out.duration);
    if (!Number.isNaN(num)) out.duration = num;
  }
  if (typeof out.rating === "string") {
    const num = Number(out.rating);
    if (!Number.isNaN(num)) out.rating = num;
  }
  if (typeof out.pages === "string") {
    const num = Number(out.pages);
    if (!Number.isNaN(num)) out.pages = num;
  }

  return out;
}

/** 生成 MDX JSX 节点（将常用标量摊平，同时提供 mediaData 表达式） */
function createMdxJsx(
  media: MediaData,
  cardType: SupportedType,
  flattenKeys: string[]
) {
  // 标量摊平（string/number/boolean）
  const flattened = Object.fromEntries(
    Object.entries(media).filter(([, v]) =>
      ["string", "number", "boolean"].includes(typeof v)
    )
  );

  const attrs = [
    { type: "mdxJsxAttribute", name: "type", value: cardType },
    // 摊平的标量字段（仅取配置的键，避免把大段 overview 以外的未知键都摊进来）
    ...flattenKeys.flatMap(k => {
      const v = flattened[k];
      if (v === undefined) return [];
      return [{ type: "mdxJsxAttribute", name: k, value: String(v) }];
    }),
    // 完整对象：用表达式传 mediaData（让组件拿到原始结构）
    {
      type: "mdxJsxAttribute",
      name: "mediaData",
      value: {
        type: "mdxJsxAttributeValueExpression",
        value: "",
        data: {
          estree: {
            type: "Program",
            sourceType: "module",
            body: [
              {
                type: "ExpressionStatement",
                expression: valueToEstree(media), // ✅ 合法 ObjectExpression
              },
            ],
          },
        },
      },
    },
  ];

  return {
    type: "mdxJsxFlowElement",
    name: "MediaCard",
    attributes: attrs,
    children: [],
  };
}

const remarkCards: Plugin<[RemarkCardsOptions?], Root> = options => {
  const types: SupportedType[] = options?.types ?? [
    "movie",
    "tv",
    "book",
    "music",
  ];
  const flattenKeys = options?.flattenKeys ?? [
    "title",
    "release_date",
    "region",
    "rating",
    "runtime",
    "genres",
    "author",
    "album",
    "duration",
    "publisher",
    "isbn",
    "pages",
    "url",
    "source",
    "external_url",
  ];

  return tree => {
    // 处理 ```card-xxx``` 代码块
    visit(tree, "code", (node: Code, index, parent) => {
      if (!parent || index == null) return;
      const lang = node.lang || "";
      if (!lang.startsWith("card-")) return;

      const t = lang.slice("card-".length) as SupportedType;
      if (!types.includes(t)) return;

      const conf = parseKVBlock(node.value || "");
      const media = normalizeToMediaData(conf, t);
      if (!media) return;

      parent.children[index] = createMdxJsx(media, t, flattenKeys);
    });
  };
};

export default remarkCards;
