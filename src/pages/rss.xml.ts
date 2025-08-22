import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { getPath } from "@/utils/getPath";
import getSortedPosts from "@/utils/getSortedPosts";
import { optimizeImage } from "@/utils/optimizeImages";
import { SITE } from "@/config";

// 处理 html 内容中的图片引用，转换为实际图片URL
// 支持 Astro图片格式: <img __ASTRO_IMAGE_="{&#x22;src&#x22;:&#x22;../attachment/blog/IMG_6128.jpg&#x22;,&#x22;alt&#x22;:&#x22;帅气的小伙子和他美丽的夫人&#x22;,&#x22;index&#x22;:0}">
async function processHtmlImages(content: string): Promise<string> {
  if (!content) return content;

  let processedContent = content;

  // 处理Astro图片标签格式
  const astroImageRegex = /<img __ASTRO_IMAGE_="([^"]+)"[^>]*>/g;
  let astroMatch;
  while ((astroMatch = astroImageRegex.exec(content)) !== null) {
    try {
      // 解码HTML实体
      const decodedData = astroMatch[1]
        .replace(/&#x22;/g, '"')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");

      // 解析JSON数据
      const imageData = JSON.parse(decodedData);
      const imagePath = imageData.src;
      const altText = imageData.alt || "";

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

        // 构建新的HTML img标签，包含尺寸信息
        const newImgTag = `<img src="${optimizedImageUrl}" alt="${altText}" width="${optimizedImageInfo.width}" height="${optimizedImageInfo.height}">`;

        // 替换原始的Astro图片标签
        processedContent = processedContent.replace(astroMatch[0], newImgTag);
      }
    } catch (error) {
      console.error("Error processing Astro image:", error);
    }
  }

  // 去除所有的 style= 和 class=
  processedContent = processedContent.replace(/ style="[^"]*"/g, "");
  processedContent = processedContent.replace(/ class="[^"]*"/g, "");

  // 去除标签间的空白字符，但保留代码块内的换行
  // 先临时替换代码块，避免处理其内容
  const CODE_BLOCK_PREFIX = "__CODE_BLOCK_";
  const CODE_BLOCK_SUFFIX = "__";
  const codeBlockMap = new Map<string, string>();
  let codeBlockIndex = 0;

  // 提取并临时替换所有代码块
  processedContent = processedContent.replace(
    /<pre[^>]*>[\s\S]*?<\/pre>/g,
    match => {
      const placeholder = `${CODE_BLOCK_PREFIX}${codeBlockIndex}${CODE_BLOCK_SUFFIX}`;
      codeBlockMap.set(placeholder, match);
      codeBlockIndex++;
      return placeholder;
    }
  );

  // 在非代码块区域去除标签间的空白字符
  processedContent = processedContent.replace(/\>\s+\</g, "><");

  // 恢复代码块，并简化其中的span标签
  codeBlockMap.forEach((block, placeholder) => {
    try {
      // 移除代码块中的所有span标签（开始和结束标签一次性处理）
      const simplifiedBlock = block.replace(/<\/?span[^>]*>/g, "");
      processedContent = processedContent.replace(placeholder, simplifiedBlock);
    } catch (error) {
      console.warn(`Failed to process code block: ${placeholder}`, error);
      // 如果处理失败，恢复原始代码块
      processedContent = processedContent.replace(placeholder, block);
    }
  });

  // 去除 <h2 id="目录">目录<a href="#目录"><span aria-hidden="true">#</span></a></h2><div><ul> ... </ul></div> 目录
  processedContent = processedContent.replace(
    new RegExp(
      '<h2 id="目录">目录<a href="#目录"><span aria-hidden="true">#</span></a></h2><div><ul>.*?</ul></div>',
      "s"
    ),
    ""
  );

  return processedContent;
}

export async function GET() {
  const posts = await getCollection("blog");
  const sortedPosts = getSortedPosts(posts);

  // 为每篇文章创建RSS项目
  const rssItems = await Promise.all(
    sortedPosts.slice(0, 6).map(async post => {
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
      const processedContent = await processHtmlImages(
        post.rendered?.html || ""
      );

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
