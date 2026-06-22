import {
  optimizeImage,
  type ImageOptimizeOptions,
} from "@/utils/optimizeImages";
import { getVideoPath } from "@/utils/videoUtils";
import { processLink } from "@/utils/linkProcessor";
import { extractUrl, extractImplicitPoster } from "@/utils/urlExtractor";
import type { CollectionEntry } from "astro:content";

// 通用的poster路径优化函数
async function optimizePosterPath(
  posterPath: string | undefined,
  options?: ImageOptimizeOptions
): Promise<string | undefined> {
  if (!posterPath) return posterPath;

  try {
    const optimizedInfo = await optimizeImage(posterPath, options);
    return optimizedInfo.thumbnail;
  } catch {
    // 失败时使用原始路径
    return posterPath;
  }
}

// 本地电影数据接口
interface LocalMovieData {
  id?: number;
  title: string;
  release_date?: string;
  region?: string;
  rating?: number;
  runtime?: number;
  genres?: string;
  overview?: string;
  poster?: string;
  source?: string;
  external_url?: string;
}

// 本地TV数据接口
interface LocalTVData {
  id?: string;
  title: string;
  release_date?: string;
  region?: string;
  rating?: number;
  genres?: string;
  overview?: string;
  poster?: string;
  source?: string;
  external_url?: string;
}

// 本地书籍数据接口
interface LocalBookData {
  id?: string;
  title: string;
  release_date?: string;
  author?: string;
  rating?: number;
  genres?: string;
  overview?: string;
  poster?: string;
  external_url?: string;
}

// 本地音乐数据接口
interface LocalMusicData {
  title: string;
  author?: string;
  album?: string;
  duration?: number;
  genres?: string;
  poster?: string;
  url?: string;
}

// 解析日记条目的函数
export async function parseEntry(entry: CollectionEntry<"diary">) {
  const date = entry.id.replace(".md", "");

  // 解析markdown内容，提取时间段和内容
  const content = entry.body || "";
  const timeBlocks = [];

  // 使用正则表达式匹配时间块
  const timeRegex = /## (\d{2}:\d{2})([\s\S]*?)(?=## \d{2}:\d{2}|$)/g;
  let match;

  while ((match = timeRegex.exec(content)) !== null) {
    const time = match[1];
    const blockContent = match[2];

    // 提取文本内容（在```imgs、```html、```card-之前的部分）
    const textMatch = blockContent.match(
      /^([\s\S]*?)(?=```imgs|```html|```card-|$)/
    );
    let text = textMatch ? textMatch[1].trim() : blockContent.trim();

    // 先保护代码块内容，避免被其他解析影响
    const codeBlocks: { lang: string; code: string }[] = [];
    text = text.replace(
      /```(\w+)?\n?([\s\S]*?)```/g,
      (match, lang = "text", code) => {
        const placeholder = `\n++PROTECTED_CODE_BLOCK_${codeBlocks.length}_PROTECTED++\n`;
        codeBlocks.push({ lang, code: code.trim() });
        return placeholder;
      }
    );

    // 移除其他类型的代码块标识（imgs、html、card-等）
    text = text.replace(/```(imgs|html|card-[\s\S]*?)[\s\S]*?```/g, "").trim();

    // 解析 Markdown 行内代码为 HTML code 标签
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

    // 解析 Markdown 加粗语法为 HTML strong mark 标签
    // 处理 **text** 格式
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // 处理 __text__ 格式
    text = text.replace(
      /__([^_]+)__/g,
      "<mark class='bg-accent/20 text-foreground px-0.5'>$1</mark>"
    );

    // 解析 Markdown 链接为 HTML 链接，并处理相对路径
    text = text.replace(
      /\[([^\]]+)\]\(([^\)]+)\)/g,
      (match, linkText, href) => {
        const processedHref = processLink(href);
        console.log(href, processedHref);
        const isInternal = processedHref.startsWith("/");
        return `<a href="${processedHref}" ${isInternal ? "" : 'target="_blank" rel="noopener noreferrer" '}class="text-skin-accent font-semibold underline decoration-2 underline-offset-2 hover:decoration-4 hover:text-skin-accent-2 transition-all duration-200">${linkText}</a>`;
      }
    );

    // 解析 Markdown 无序列表为 HTML ul/li
    text = text.replace(/((?:^- .+(?:\n|$))+)/gm, match => {
      const items = match
        .split("\n")
        .filter(line => line.trim().startsWith("- "))
        .map(
          line => `<li class="ml-4 list-disc">${line.substring(2).trim()}</li>`
        )
        .join("");
      return `<ul class="mt-1 mb-2 pl-2">${items}</ul>`;
    });

    // 解析 Markdown 有序列表为 HTML ol/li
    text = text.replace(/((?:^\d+\. .+(?:\n|$))+)/gm, match => {
      const items = match
        .split("\n")
        .filter(line => /^\d+\. /.test(line.trim()))
        .map(
          line =>
            `<li class="ml-4 list-decimal">${line.replace(/^\d+\. /, "").trim()}</li>`
        )
        .join("");
      return `<ol class="mt-1 mb-2 pl-2">${items}</ol>`;
    });

    // 解析 Markdown 引用文本为 HTML blockquote
    text = text.replace(/((?:^> .*(?:\n|$))+)/gm, match => {
      const lines = match
        .split("\n")
        .filter(line => line.trim().startsWith("> "))
        .map(line => {
          const content = line.substring(2).trim(); // 移除 "> " 前缀
          return content || "&nbsp;"; // 如果内容为空，使用不间断空格
        })
        .map(line => `<p class="mb-1 last:mb-0">${line}</p>`)
        .join("");
      return `<blockquote class="px-3 py-2 my-2 italic text-foreground/80 relative"><span class="text-4xl text-foreground/30 absolute -left-1 -top-1">“</span>${lines}<span class="text-4xl text-foreground/30 absolute -right-0 -bottom-2">”</span></blockquote>`;
    });

    // 提取图片并优化
    const images = [];
    const imgMatches = blockContent.match(/```imgs([\s\S]*?)```/);
    if (imgMatches) {
      const imgContent = imgMatches[1];
      const imgRegex =
        /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)"|\s+\'([^\']*)\')?\)/g;
      let imgMatch;
      while ((imgMatch = imgRegex.exec(imgContent)) !== null) {
        const src = imgMatch[2];
        const title = imgMatch[3] || imgMatch[4] || ""; // 支持双引号或单引号的title

        // 处理相对路径的图片
        try {
          // 使用完整的优化函数，获取包含尺寸信息的对象
          const optimizedInfo = await optimizeImage(src, {
            needFullSize: true,
          });
          images.push({
            alt: imgMatch[1],
            src: optimizedInfo.thumbnail,
            original: optimizedInfo.original,
            title: title,
            width: optimizedInfo.width,
            height: optimizedInfo.height,
          });
        } catch {
          // 失败时使用原始路径和默认尺寸
          images.push({
            alt: imgMatch[1],
            original: src,
            src: src,
            title: title,
            width: 400,
            height: 300,
          });
        }
      }
    }

    // 提取HTML内容并处理其中的attachment路径
    const htmlMatches = blockContent.match(/```html([\s\S]*?)```/);
    let htmlContent = htmlMatches ? htmlMatches[1].trim() : "";

    // 处理HTML中包含attachment路径的媒体文件
    if (htmlContent) {
      // 处理所有包含attachment路径的媒体属性（src和poster）
      const mediaAttributeMatches = [
        ...htmlContent.matchAll(
          /(src|poster)="((?!http)[^"]*attachment\/[^"]*?)"/gi
        ),
      ];

      for (const match of mediaAttributeMatches) {
        const [fullMatch, attribute, src] = match;

        if (
          src.match(
            /\.(mp4|webm|ogg|avi|mov|wmv|flv|mkv|mp3|wav|ogg|aac|flac|m4a)$/i
          )
        ) {
          // 视频和音频文件使用getVideoPath处理
          const videoPath = getVideoPath(src);
          htmlContent = htmlContent.replace(
            fullMatch,
            `${attribute}="${videoPath}"`
          );
        } else if (
          src.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg|ico|tiff|tif)$/i)
        ) {
          // 图片文件使用optimizeImage处理
          try {
            const isPoster = attribute.toLowerCase() === "poster";
            const optimizedInfo = await optimizeImage(
              src,
              isPoster ? { keepOriginalSize: true, quality: 50 } : undefined
            );
            htmlContent = htmlContent.replace(
              fullMatch,
              `${attribute}="${optimizedInfo.thumbnail}"`
            );
          } catch {
            // 失败时保持原始路径
          }
        }
      }
    }

    // 提取电影卡片数据
    let movieData: LocalMovieData | undefined = undefined;
    const cardMovieMatches = blockContent.match(/```card-movie([\s\S]*?)```/);
    if (cardMovieMatches) {
      const cardContent = cardMovieMatches[1].trim();

      // 解析电影信息
      const parseField = (field: string): string | undefined => {
        const match = cardContent.match(new RegExp(`${field}:\\s*(.+)`, "m"));
        let value = match ? match[1].trim() : undefined;
        if (
          value &&
          (field === "poster" ||
            field === "external_url" ||
            field === "url" ||
            field === "douban_url")
        ) {
          value = extractUrl(value);
          if (field !== "poster") {
            if (
              !value.match(/^https?:\/\//i) &&
              !value.match(/\.[a-zA-Z0-9]+$/)
            ) {
              value += ".md";
            }
            value = processLink(value);
          }
        }
        return value;
      };

      const parseNumber = (field: string): number | undefined => {
        const value = parseField(field);
        return value ? parseFloat(value) : undefined;
      };

      const title = parseField("title");
      if (title) {
        const posterStr =
          parseField("poster") || extractImplicitPoster(cardContent);
        const optimizedPoster = await optimizePosterPath(posterStr);

        movieData = {
          id: parseNumber("id"),
          title,
          release_date: parseField("release_date"),
          region: parseField("region"),
          rating: parseNumber("rating"),
          runtime: parseNumber("runtime"),
          genres: parseField("genres"),
          overview: parseField("overview"),
          poster: optimizedPoster,
          source: parseField("source"),
          external_url: parseField("external_url"),
        };
      }
    }

    // 提取TV剧集卡片数据
    let tvData: LocalTVData | undefined = undefined;
    const cardTVMatches = blockContent.match(/```card-tv([\s\S]*?)```/);
    if (cardTVMatches) {
      const cardContent = cardTVMatches[1].trim();

      // 解析TV信息
      const parseField = (field: string): string | undefined => {
        const match = cardContent.match(new RegExp(`${field}:\\s*(.+)`, "m"));
        let value = match ? match[1].trim() : undefined;
        if (
          value &&
          (field === "poster" ||
            field === "external_url" ||
            field === "url" ||
            field === "douban_url")
        ) {
          value = extractUrl(value);
          if (field !== "poster") {
            if (
              !value.match(/^https?:\/\//i) &&
              !value.match(/\.[a-zA-Z0-9]+$/)
            ) {
              value += ".md";
            }
            value = processLink(value);
          }
        }
        return value;
      };

      const parseNumber = (field: string): number | undefined => {
        const value = parseField(field);
        return value ? parseFloat(value) : undefined;
      };

      const title = parseField("title");
      if (title) {
        const posterStr =
          parseField("poster") || extractImplicitPoster(cardContent);
        const optimizedPoster = await optimizePosterPath(posterStr);

        tvData = {
          id: parseField("id"),
          title,
          release_date: parseField("release_date"),
          region: parseField("region"),
          rating: parseNumber("rating"),
          genres: parseField("genres"),
          overview: parseField("overview"),
          poster: optimizedPoster,
          source: parseField("source"),
          external_url: parseField("external_url"),
        };
      }
    }

    // 提取书籍卡片数据
    let bookData: LocalBookData | undefined = undefined;
    const cardBookMatches = blockContent.match(/```card-book([\s\S]*?)```/);
    if (cardBookMatches) {
      const cardContent = cardBookMatches[1].trim();

      // 解析书籍信息
      const parseField = (field: string): string | undefined => {
        const match = cardContent.match(new RegExp(`${field}:\\s*(.+)`, "m"));
        let value = match ? match[1].trim() : undefined;
        if (
          value &&
          (field === "poster" ||
            field === "external_url" ||
            field === "url" ||
            field === "douban_url")
        ) {
          value = extractUrl(value);
          if (field !== "poster") {
            if (
              !value.match(/^https?:\/\//i) &&
              !value.match(/\.[a-zA-Z0-9]+$/)
            ) {
              value += ".md";
            }
            value = processLink(value);
          }
        }
        return value;
      };

      const parseNumber = (field: string): number | undefined => {
        const value = parseField(field);
        return value ? parseFloat(value) : undefined;
      };

      const title = parseField("title");
      if (title) {
        const posterStr =
          parseField("poster") || extractImplicitPoster(cardContent);
        const optimizedPoster = await optimizePosterPath(posterStr);

        bookData = {
          id: parseField("id"),
          title,
          release_date: parseField("release_date"),
          author: parseField("author"),
          rating: parseNumber("rating"),
          genres: parseField("genres"),
          overview: parseField("overview"),
          poster: optimizedPoster,
          external_url: parseField("external_url"),
        };
      }
    }

    // 提取音乐卡片数据
    let musicData: LocalMusicData | undefined = undefined;
    const cardMusicMatches = blockContent.match(/```card-music([\s\S]*?)```/);
    if (cardMusicMatches) {
      const cardContent = cardMusicMatches[1].trim();

      // 解析音乐信息
      const parseField = (field: string): string | undefined => {
        const match = cardContent.match(new RegExp(`${field}:\\s*(.+)`, "m"));
        let value = match ? match[1].trim() : undefined;
        if (
          value &&
          (field === "poster" ||
            field === "external_url" ||
            field === "url" ||
            field === "douban_url")
        ) {
          value = extractUrl(value);
          if (field !== "poster") {
            if (
              !value.match(/^https?:\/\//i) &&
              !value.match(/\.[a-zA-Z0-9]+$/)
            ) {
              value += ".md";
            }
            value = processLink(value);
          }
        }
        return value;
      };

      const parseNumber = (field: string): number | undefined => {
        const value = parseField(field);
        return value ? parseFloat(value) : undefined;
      };

      const title = parseField("title");
      if (title) {
        const posterStr =
          parseField("poster") || extractImplicitPoster(cardContent);
        const optimizedPoster = await optimizePosterPath(posterStr);

        musicData = {
          title,
          author: parseField("author"),
          album: parseField("album"),
          duration: parseNumber("duration"),
          genres: parseField("genres"),
          poster: optimizedPoster,
          url: parseField("url"),
        };
      }
    }

    // 最后处理：将每个换行转换为独立的p段落
    // 先标记已处理的ul、ol块，避免内部换行被处理
    const htmlBlockRegex = /<(ul|ol)\b[^>]*>[\s\S]*?<\/\1>/g;
    const htmlBlocks: string[] = [];
    let blockIndex = 0;

    // 用占位符替换HTML块
    text = text.replace(htmlBlockRegex, match => {
      // 为HTML块前后添加换行符
      const placeholder = `\n++HTML_BLOCK_${blockIndex}++\n`;
      htmlBlocks[blockIndex] = match;
      blockIndex++;
      return placeholder;
    });

    // 处理剩余文本的换行
    text = text
      .split("\n")
      .filter(line => line.trim() !== "") // 过滤空行
      .map(line => {
        const trimmedLine = line.trim();
        // 检查是否为占位符
        if (
          trimmedLine.includes("++HTML_BLOCK_") ||
          trimmedLine.includes("++PROTECTED_CODE_BLOCK_")
        ) {
          return trimmedLine;
        }
        return `<p class="mb-2">${trimmedLine}</p>`;
      })
      .join("");

    // 渲染代码块并恢复到文本中
    // todo: 高亮处理
    for (let i = 0; i < codeBlocks.length; i++) {
      const { lang, code } = codeBlocks[i];
      // 使用简单的HTML pre/code结构，配合Astro的CSS样式
      const escapedCode = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

      const html = `<pre class="mb-2" data-language="${lang}"><code>${escapedCode}</code></pre>`;
      text = text.replace(`++PROTECTED_CODE_BLOCK_${i}_PROTECTED++`, html);
    }

    // 恢复HTML块
    htmlBlocks.forEach((block, index) => {
      text = text.replace(`++HTML_BLOCK_${index}++`, block);
    });

    if (
      text ||
      images.length > 0 ||
      htmlContent ||
      movieData ||
      tvData ||
      bookData ||
      musicData
    ) {
      timeBlocks.push({
        time,
        text,
        images,
        htmlContent,
        movieData,
        tvData,
        bookData,
        musicData,
      });
    }
  }

  // 按时间倒序排列时间块（最新的时间在前）
  timeBlocks.sort((a, b) => {
    const timeA = a.time.replace(":", "");
    const timeB = b.time.replace(":", "");
    return timeB.localeCompare(timeA);
  });

  return {
    date,
    timeBlocks,
  };
}
