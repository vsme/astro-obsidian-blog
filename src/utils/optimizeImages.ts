import { getImage } from "astro:assets";
// 导入所有支持的图片格式
const images = import.meta.glob(
  "../data/attachment/**/*.{jpg,jpeg,png,gif,webp,svg}",
  { eager: true }
);

// 图片优化缓存
const imageCache = new Map<string, OptimizedImageInfo>();

/**
 * 图片信息接口
 */
export interface OptimizedImageInfo {
  thumbnail: string; // 缩略图路径
  original: string; // 原始尺寸图片路径
  width: number; // 原始宽度
  height: number; // 原始高度
}

/**
 * 优化图片并返回缩略图和原始图片信息
 * @param imagePath 原始图片路径
 * @returns 优化后的图片信息
 */
export async function optimizeImage(
  imagePath: string
): Promise<OptimizedImageInfo> {
  // 如果 http 开头，尝试从 URL 中提取尺寸信息
  if (imagePath.startsWith("http")) {
    const result = {
      thumbnail: imagePath,
      original: imagePath,
      width: 800,
      height: 600,
    };
    return result;
  }

  // 检查缓存
  if (imageCache.has(imagePath)) {
    return imageCache.get(imagePath)!;
  }

  // 从图片路径中提取文件名
  let fileName = "";
  if (imagePath.includes("attachment")) {
    fileName =
      imagePath.split("attachment/")[1] || imagePath.split("attachment\\")[1];
  }

  // 在导入的图片中查找匹配的图片
  const imageKey = Object.keys(images).find(key => key.includes(fileName));

  if (!imageKey) {
    console.error(`Image not found in imports: ${fileName}`);
    return {
      thumbnail: imagePath,
      original: imagePath,
      width: 400,
      height: 300,
    };
  }

  try {
    const imageModule = images[imageKey] as any;
    const originalImage = imageModule.default;

    // 获取原始图片尺寸（如果可用）
    let originalWidth =
      originalImage.width || originalImage.naturalWidth || 800;
    let originalHeight =
      originalImage.height || originalImage.naturalHeight || 600;

    // 计算缩略图尺寸，保持原始比例
    const maxThumbnailSize = 400;
    const aspectRatio = originalWidth / originalHeight;
    let thumbnailWidth, thumbnailHeight;

    if (aspectRatio > 1) {
      // 横向图片
      thumbnailWidth = maxThumbnailSize;
      thumbnailHeight = Math.round(maxThumbnailSize / aspectRatio);
    } else {
      // 纵向图片
      thumbnailHeight = maxThumbnailSize;
      thumbnailWidth = Math.round(maxThumbnailSize * aspectRatio);
    }

    // 生成缩略图
    const thumbnailImage = await getImage({
      src: originalImage,
      width: thumbnailWidth,
      height: thumbnailHeight,
      format: "webp",
      quality: 80,
    });

    // 生成原始尺寸的优化图片（用于放大展示）
    const fullSizeImage = await getImage({
      src: originalImage,
      format: "webp",
      quality: 90, // 更高质量用于放大展示
    });

    const result = {
      thumbnail: thumbnailImage.src,
      original: fullSizeImage.src,
      width: originalWidth,
      height: originalHeight,
    };

    // 缓存结果
    imageCache.set(imagePath, result);

    return result;
  } catch (error) {
    console.error(`Failed to optimize image ${fileName}:`, error);
    return {
      thumbnail: imagePath,
      original: imagePath,
      width: 400,
      height: 300,
    };
  }
}

/**
 * 批量优化图片
 * @param imagePaths 图片路径数组
 * @returns 优化后的图片信息数组
 */
export async function optimizeImages(
  imagePaths: string[]
): Promise<OptimizedImageInfo[]> {
  const promises = imagePaths.map(path => optimizeImage(path));
  return Promise.all(promises);
}

/**
 * 向后兼容：只返回缩略图路径
 * @param imagePath 原始图片路径
 * @returns 缩略图路径
 */
export async function optimizeImageThumbnail(
  imagePath: string
): Promise<string> {
  const result = await optimizeImage(imagePath);
  return result.thumbnail;
}

/**
 * 清除图片缓存
 */
export function clearImageCache(): void {
  console.log("Clearing image cache...");
  imageCache.clear();
}
