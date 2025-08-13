import { getImage } from "astro:assets";
// 导入所有支持的图片格式
const images = import.meta.glob(
  "../data/attachment/**/*.{jpg,jpeg,png,gif,webp,svg}",
  { eager: true }
);

// 图片优化缓存
const imageCache = new Map<string, OptimizedImageInfo>();

/**
 * 图片优化配置接口
 */
export interface ImageOptimizeOptions {
  thumbnailSize?: number; // 缩略图最大尺寸，默认400
  keepOriginalSize?: boolean; // 是否保持原始尺寸，默认false
  quality?: number; // 图片质量，默认80
}

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
 * @param options 优化选项
 * @returns 优化后的图片信息
 */
export async function optimizeImage (
  imagePath: string,
  options: ImageOptimizeOptions = {}
): Promise<OptimizedImageInfo> {
  const {
    thumbnailSize = 400,
    keepOriginalSize = false,
    quality = 80
  } = options;
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

  // 生成缓存键，包含选项信息
  const cacheKey = `${imagePath}_${thumbnailSize}_${keepOriginalSize}_${quality}`;

  // 检查缓存
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey)!;
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
    return {
      thumbnail: imagePath,
      original: imagePath,
      width: 400,
      height: 300,
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imageModule = images[imageKey] as { default: any };
    const originalImage = imageModule.default;

    // 获取原始图片尺寸（如果可用）
    const originalWidth =
      originalImage.width || originalImage.naturalWidth || 800;
    const originalHeight =
      originalImage.height || originalImage.naturalHeight || 600;

    // 计算缩略图尺寸，保持原始比例
    const aspectRatio = originalWidth / originalHeight;
    let thumbnailWidth, thumbnailHeight;

    if (keepOriginalSize) {
      // 保持原始尺寸
      thumbnailWidth = originalWidth;
      thumbnailHeight = originalHeight;
    } else {
      // 按指定尺寸缩放
      if (aspectRatio > 1) {
        // 横向图片
        thumbnailWidth = thumbnailSize;
        thumbnailHeight = Math.round(thumbnailSize / aspectRatio);
      } else {
        // 纵向图片
        thumbnailHeight = thumbnailSize;
        thumbnailWidth = Math.round(thumbnailSize * aspectRatio);
      }
    }

    // 生成缩略图
    const thumbnailImage = await getImage({
      src: originalImage,
      width: thumbnailWidth,
      height: thumbnailHeight,
      format: "webp",
      quality: quality,
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
    imageCache.set(cacheKey, result);

    return result;
  } catch {
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
export async function optimizeImages (
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
export async function optimizeImageThumbnail (
  imagePath: string
): Promise<string> {
  const result = await optimizeImage(imagePath);
  return result.thumbnail;
}

/**
 * 清除图片缓存
 */
export function clearImageCache (): void {
  imageCache.clear();
}
