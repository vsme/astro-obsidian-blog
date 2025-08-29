// 媒体卡片数据接口 - 统一类型定义
export interface MediaCardData {
  id?: string | number;
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
  author?: string;
  publisher?: string;
  isbn?: string;
  pages?: number;
  album?: string;
  duration?: number;
  url?: string;
}

// MediaCard 组件的 Props 接口
export interface MediaCardProps {
  mediaData: MediaCardData;
  theme?: "light" | "dark";
  cardType?: "movie" | "tv" | "book" | "music";
}

// remarkMediaCard 插件选项接口
export interface MediaCardOptions {
  enableDebug?: boolean;
}

// 支持的媒体卡片类型
export type MediaCardType = "movie" | "tv" | "book" | "music";

// 主题类型
export type MediaCardTheme = "light" | "dark";
