import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { getPath } from "@/utils/getPath";
import getSortedPosts from "@/utils/getSortedPosts";
import { optimizeImage } from "@/utils/optimizeImages";
import { SITE } from "@/config";
import * as cheerio from "cheerio";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import remarkWrap from "../../src/utils/remarkWrap";
import { remarkMediaCard } from "../../src/utils/remarkMediaCard";
import remarkToc from "remark-toc";
import rehypeFigure from "rehype-figure";
import rehypeSlug from "rehype-slug";

const renderMarkdown = async (markdown: string) => {
  const processed = await unified()
    .use(remarkMediaCard)
    .use(remarkParse)
    .use(remarkRehype)
    .use(remarkWrap)
    .use(remarkToc)
    .use(rehypeSlug)
    .use(rehypeFigure)
    .use(rehypeStringify)
    .process(markdown);
  return processed.toString();
};

// 处理 html 内容中的图片引用，转换为实际图片URL
// 支持 Astro图片格式: <img __ASTRO_IMAGE_="{&#x22;src&#x22;:&#x22;../attachment/blog/IMG_6128.jpg&#x22;,&#x22;alt&#x22;:&#x22;帅气的小伙子和他美丽的夫人&#x22;,&#x22;index&#x22;:0}">
async function processHtmlImages(
  content: string,
  isMDX = false
): Promise<string> {
  if (!content) return content;

  const $ = cheerio.load(content);

  // 去除目录部分
  const tocHeading = $("#目录");
  const nextDiv = tocHeading.next("div.article-toc-nav");
  nextDiv.remove();
  tocHeading.remove();

  // 删除所有 link 标签
  $("link").remove();

  const typeMap: Record<string, string> = {
    BOOK: "查看书籍",
    MOVIE: "查看电影",
    TV: "查看剧集",
    MUSIC: "去听歌曲",
  };

  // 把文章中的卡片 .media-card 只保留 a 链接
  $("a.media-card").each((_, mediaCard) => {
    const $link = $(mediaCard);
    const h3 = $link.find("h3").text();
    const type = $link.attr("data-media-type")?.toUpperCase();
    const label = type ? typeMap[type] : "";
    const linkHtml = label ? `${label}：《${h3}》` : `《${h3}》`;
    $link.html(linkHtml);
    $link.wrap("<p></p>");
  });

  // 处理Astro图片标签格式
  const astroImages = isMDX
    ? $("*:not(code img[src])")
    : $("img[__astro_image_]");
  for (let i = 0; i < astroImages.length; i++) {
    const img = $(astroImages[i]);
    try {
      const astroImageData = isMDX
        ? img.attr("src")
        : img.attr("__astro_image_");
      if (!astroImageData) continue;

      let imagePath = "";
      let altText = "";

      if (!isMDX) {
        const decodedData = astroImageData
          .replace(/&#x22;/g, '"')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");

        // 解析JSON数据
        const imageData = JSON.parse(decodedData);
        imagePath = imageData.src;
        altText = imageData.alt;
      } else {
        imagePath = astroImageData;
        altText = img.attr("alt") || "";
      }

      // 检查是否是相对路径的图片
      if (imagePath && imagePath.includes("attachment")) {
        // 使用optimizeImage函数优化图片
        const optimizedImageInfo = await optimizeImage(imagePath, {
          thumbnailSize: 900,
        });

        // 将优化后的图片路径转换为绝对URL
        const optimizedImageUrl = new URL(
          optimizedImageInfo.thumbnail,
          SITE.website
        ).href;

        // 更新img标签属性
        img.attr("src", optimizedImageUrl);
        img.attr("alt", altText);
        img.attr("width", optimizedImageInfo.width.toString());
        img.attr("height", optimizedImageInfo.height.toString());
        img.removeAttr("__astro_image_");
      }
    } catch (error) {
      console.error("Error processing Astro image:", error);
    }
  }

  // 在非代码块区域去除所有的 style 属性
  $("*:not(pre *):not(code *)").removeAttr("style");

  // 在非代码块区域去除所有的 class 属性
  $("*:not(pre *):not(code *)").removeAttr("class");

  // 处理代码块，简化其中的span标签
  $("pre").each((_, preElement) => {
    const $pre = $(preElement);
    try {
      // 提取pre标签上的data-language属性
      const language = $pre.attr("data-language");

      // 移除pre标签的属性tabindex、data-language、class
      ["tabindex", "data-language", "class"].forEach(attr => {
        $pre.removeAttr(attr);
      });

      // 移除代码块中的所有span标签
      $pre.find("span").each((_, span) => {
        const $span = $(span);
        $span.replaceWith($span.text());
      });
      // 如果有语言属性，添加到code标签上
      if (language) {
        const $code = $pre.find("code");
        $code.attr("class", `language-${language}`);
      }
    } catch (error) {
      console.warn("Failed to process code block:", error);
    }
  });

  // 去除所有标题标签内部的hash链接
  $("h1, h2, h3, h4, h5, h6").each((_, heading) => {
    const $heading = $(heading);
    $heading.find('a[href^="#"]').remove();
  });

  $("*")
    .contents()
    .each((_, content) => {
      if (content.type !== "text") return;
      // 祖先检查
      if ($(content).parents("pre,code,script,style,textarea").length) return;

      const s = content.data ?? "";
      // 只处理纯空白
      if (/^[ \t\r\n\f]+$/.test(s)) {
        $(content).remove();
      }
    });

  return $.html();
}

export async function GET() {
  const posts = await getCollection("blog");
  const sortedPosts = getSortedPosts(posts);

  // 为每篇文章创建RSS项目
  const rssItems = await Promise.all(
    sortedPosts.slice(0, 7).map(async post => {
      let thumbnailUrl = "";
      if (typeof post.data.ogImage === "string") {
        const optimizedImageInfo = await optimizeImage(post.data.ogImage, {
          thumbnailSize: 1200,
        });
        thumbnailUrl = new URL(optimizedImageInfo.thumbnail, SITE.website).href;
      } else if (post.data.ogImage?.src) {
        thumbnailUrl = new URL(post.data.ogImage.src, SITE.website).href;
      }

      // 处理文章内容中的图片 - 使用原始markdown内容
      let processedContent = await processHtmlImages(post.rendered?.html || "");

      if (!post.rendered?.html) {
        const md = post.body || "";
        const html = await renderMarkdown(md);
        processedContent = await processHtmlImages(html, true);
      }

      return {
        link: getPath(post.id, post.filePath),
        title: post.data.title,
        description: post.data.description,
        pubDate: new Date(post.data.modDatetime ?? post.data.pubDatetime),
        content: processedContent,
        customData: `<enclosure url="${thumbnailUrl}" type="image/webp" length="0" />`,
      };
    })
  );

  return rss({
    title: SITE.title,
    description: SITE.desc,
    site: SITE.website,
    items: rssItems,
  });
}
