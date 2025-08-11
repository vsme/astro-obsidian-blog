// 导入所有 MP4 视频文件
const videos = import.meta.glob(
  "../data/attachment/**/*.mp4",
  { eager: true }
);

/**
 * 获取视频路径
 * @param videoPath 原始视频路径
 * @returns 处理后的视频路径
 */
export function getVideoPath(videoPath: string): string {
  // 如果是 http 开头的 URL，直接返回
  if (videoPath.startsWith("http")) {
    return videoPath;
  }

  // 从视频路径中提取文件名
  let fileName = "";
  if (videoPath.includes("attachment")) {
    fileName = videoPath.split("attachment/")[1] || videoPath.split("attachment\\")[1];
  }

  // 在导入的视频中查找匹配的视频
  const videoKey = Object.keys(videos).find(key => key.includes(fileName));

  if (videoKey) {
    // 找到匹配的视频，返回处理后的路径
    const videoModule = videos[videoKey] as { default?: string };
    return videoModule.default || videoKey;
  }

  // 如果没有找到，使用回退逻辑
  // 将 ../attachment 转换为 /attachment（相对于 public 目录）
  if (videoPath.startsWith("../")) {
    return videoPath.replace("../", "/");
  }

  // 如果路径不是以 ../ 开头，但包含 attachment，尝试转换
  if (videoPath.includes("attachment")) {
    const pathParts = videoPath.split("attachment");
    if (pathParts.length > 1) {
      return "/attachment" + pathParts[1];
    }
  }

  // 默认返回原路径
  return videoPath;
}

/**
 * 获取所有视频文件的键
 * @returns 所有视频文件的键数组
 */
export function getAllVideoKeys(): string[] {
  return Object.keys(videos);
}

/**
 * 检查给定路径是否为视频文件
 * @param filePath 文件路径
 * @returns 是否为视频文件
 */
export function isVideoFile(filePath: string): boolean {
  const videoExtensions = [".mp4", ".webm", ".ogg", ".mov", ".avi"];
  return videoExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
}

/**
 * 视频文件信息接口
 */
export interface VideoInfo {
  src: string;
  type: string;
}

/**
 * 获取视频信息
 * @param videoPath 视频路径
 * @returns 视频信息
 */
export function getVideoInfo(videoPath: string): VideoInfo {
  const processedPath = getVideoPath(videoPath);
  
  // 根据文件扩展名确定 MIME 类型
  let type = "video/mp4"; // 默认类型
  if (processedPath.endsWith(".webm")) {
    type = "video/webm";
  } else if (processedPath.endsWith(".ogg")) {
    type = "video/ogg";
  } else if (processedPath.endsWith(".mov")) {
    type = "video/quicktime";
  } else if (processedPath.endsWith(".avi")) {
    type = "video/x-msvideo";
  }

  return {
    src: processedPath,
    type: type
  };
}