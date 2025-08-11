import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { getImage } from "astro:assets";
import { getPath } from "@/utils/getPath";
import getSortedPosts from "@/utils/getSortedPosts";
import { generateOgImageForPost } from "@/utils/generateOgImages";
import { SITE } from "@/config";

export async function GET() {
  const posts = await getCollection("blog");
  const sortedPosts = getSortedPosts(posts);

  // 为每篇文章创建RSS项目
  const rssItems = await Promise.all(
    sortedPosts.slice(0, 6).map(async post => {
      let thumbnailUrl = "";
      let imageType = "image/webp";
      let imageLength = 0;

      // 检测图片类型的辅助函数
      const getImageType = (url: string) => {
        if (url.endsWith(".png")) return "image/png";
        if (url.endsWith(".jpg") || url.endsWith(".jpeg")) return "image/jpeg";
        if (url.endsWith(".webp")) return "image/webp";
        return "image/webp"; // 默认webp
      };

      // 优先使用文章中的ogImage
      if (post.data.ogImage) {
        try {
          if (typeof post.data.ogImage === "string") {
            // 如果是字符串，检查是否为相对路径
            if (post.data.ogImage.startsWith("http")) {
              thumbnailUrl = post.data.ogImage;
              imageType = getImageType(post.data.ogImage);
            } else {
              // 相对路径，转换为绝对URL
              thumbnailUrl = new URL(post.data.ogImage, SITE.website).href;
              imageType = getImageType(post.data.ogImage);
            }
          } else if (post.data.ogImage?.src) {
            // 如果是图片对象，使用Astro压缩
            const optimizedImage = await getImage({
              src: post.data.ogImage,
              width: 400,
              height: 400,
              format: "webp",
              quality: 80,
            });
            thumbnailUrl = new URL(optimizedImage.src, SITE.website).href;
            imageType = "image/webp";
          }
        } catch (error) {
          console.warn(
            `Failed to optimize image for post ${post.data.title}:`,
            error
          );
          // 回退到原始图片
          if (typeof post.data.ogImage === "string") {
            thumbnailUrl = post.data.ogImage.startsWith("http")
              ? post.data.ogImage
              : new URL(post.data.ogImage, SITE.website).href;
            imageType = getImageType(post.data.ogImage);
          } else if (post.data.ogImage?.src) {
            thumbnailUrl = new URL(post.data.ogImage.src, SITE.website).href;
            imageType = getImageType(post.data.ogImage.src);
          }
        }
      }

      // 如果没有ogImage，则生成动态OG图片
      if (!thumbnailUrl) {
        const ogImageBuffer = await generateOgImageForPost(post);
        thumbnailUrl = `data:image/png;base64,${ogImageBuffer.toString("base64")}`;
        imageType = "image/png";
        imageLength = ogImageBuffer.length;
      }

      return {
        link: getPath(post.id, post.filePath),
        title: post.data.title,
        description: post.data.description,
        pubDate: new Date(post.data.modDatetime ?? post.data.pubDatetime),
        content: post.rendered?.html || "",
        customData: `<enclosure url="${thumbnailUrl}" type="${imageType}" ${imageLength > 0 ? `length="${imageLength}"` : ""} />`,
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
