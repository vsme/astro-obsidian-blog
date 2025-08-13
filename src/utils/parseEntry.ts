import { optimizeImage } from "@/utils/optimizeImages";
import { getVideoPath } from "@/utils/videoUtils";
import type { CollectionEntry } from "astro:content";

// 通用的poster路径优化函数
async function optimizePosterPath(posterPath: string | undefined): Promise<string | undefined> {
  if (!posterPath) return posterPath;
  
  try {
    const optimizedInfo = await optimizeImage(posterPath);
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
  const content = entry.body || '';
  const timeBlocks = [];

  // 使用正则表达式匹配时间块
  const timeRegex = /## (\d{2}:\d{2})([\s\S]*?)(?=## \d{2}:\d{2}|$)/g;
  let match;

  while ((match = timeRegex.exec(content)) !== null) {
    const time = match[1];
    const blockContent = match[2];

    // 提取文本内容（在```imgs、```html、```card-之前的部分）
  const textMatch = blockContent.match(/^([\s\S]*?)(?=```imgs|```html|```card-|$)/);
    let text = textMatch ? textMatch[1].trim() : blockContent.trim();
    
    // 移除代码块标识
    text = text.replace(/```(imgs|html|card-[\s\S]*?)[\s\S]*?```/g, '').trim();
    
    // 解析 Markdown 链接为 HTML 链接
    text = text.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-skin-accent font-semibold underline decoration-2 underline-offset-2 hover:decoration-4 hover:text-skin-accent-2 transition-all duration-200">$1</a>');

    // 提取图片并优化
    const images = [];
    const imgMatches = blockContent.match(/```imgs([\s\S]*?)```/);
    if (imgMatches) {
      const imgContent = imgMatches[1];
      const imgRegex = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)"|\s+\'([^\']*)\')?\)/g;
      let imgMatch;
      while ((imgMatch = imgRegex.exec(imgContent)) !== null) {
        const src = imgMatch[2];
        const title = imgMatch[3] || imgMatch[4] || ''; // 支持双引号或单引号的title

        // 处理相对路径的图片
        try {
          // 使用完整的优化函数，获取包含尺寸信息的对象
          const optimizedInfo = await optimizeImage(src);
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
    
    // 处理HTML中的video标签src属性包含attachment的情况
    if (htmlContent) {
      const videoRegex = /<video([^>]*?)src="([^"]*attachment[^"]*?)"([^>]*?)>/g;
      const videoMatches = [...htmlContent.matchAll(videoRegex)];
      
      for (const match of videoMatches) {
        const [fullMatch, beforeSrc, src, afterSrc] = match;
        // 使用动态路径匹配获取正确的视频路径
        const optimizedSrc = getVideoPath(src);
        const newVideoTag = `<video${beforeSrc}src="${optimizedSrc}"${afterSrc}>`;
        htmlContent = htmlContent.replace(fullMatch, newVideoTag);
      }
    }

    // 提取电影卡片数据
    let movieData: LocalMovieData | undefined = undefined;
    const cardMovieMatches = blockContent.match(/```card-movie([\s\S]*?)```/);
    if (cardMovieMatches) {
      const cardContent = cardMovieMatches[1].trim();

      // 解析电影信息
      const parseField = (field: string): string | undefined => {
        const match = cardContent.match(new RegExp(`${field}:\s*(.+)`, 'm'));
        return match ? match[1].trim() : undefined;
      };
      
      const parseNumber = (field: string): number | undefined => {
        const value = parseField(field);
        return value ? parseFloat(value) : undefined;
      };

      const title = parseField('title');
      if (title) {
        const optimizedPoster = await optimizePosterPath(parseField('poster'));
        
        movieData = {
          id: parseNumber('id'),
          title,
          release_date: parseField('release_date'),
          region: parseField('region'),
          rating: parseNumber('rating'),
          runtime: parseNumber('runtime'),
          genres: parseField('genres'),
          overview: parseField('overview'),
          poster: optimizedPoster,
          source: parseField('source'),
          external_url: parseField('external_url')
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
        const match = cardContent.match(new RegExp(`${field}:\s*(.+)`, 'm'));
        return match ? match[1].trim() : undefined;
      };
      
      const parseNumber = (field: string): number | undefined => {
        const value = parseField(field);
        return value ? parseFloat(value) : undefined;
      };

      const title = parseField('title');
      if (title) {
        const optimizedPoster = await optimizePosterPath(parseField('poster'));
        
        tvData = {
          id: parseField('id'),
          title,
          release_date: parseField('release_date'),
          region: parseField('region'),
          rating: parseNumber('rating'),
          genres: parseField('genres'),
          overview: parseField('overview'),
          poster: optimizedPoster,
          source: parseField('source'),
          external_url: parseField('external_url')
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
        const match = cardContent.match(new RegExp(`${field}:\s*(.+)`, 'm'));
        return match ? match[1].trim() : undefined;
      };
      
      const parseNumber = (field: string): number | undefined => {
        const value = parseField(field);
        return value ? parseFloat(value) : undefined;
      };

      const title = parseField('title');
      if (title) {
        const optimizedPoster = await optimizePosterPath(parseField('poster'));
        
        bookData = {
          id: parseField('id'),
          title,
          release_date: parseField('release_date'),
          author: parseField('author'),
          rating: parseNumber('rating'),
          genres: parseField('genres'),
          overview: parseField('overview'),
          poster: optimizedPoster,
          external_url: parseField('external_url')
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
        const match = cardContent.match(new RegExp(`${field}:\s*(.+)`, 'm'));
        return match ? match[1].trim() : undefined;
      };
      
      const parseNumber = (field: string): number | undefined => {
        const value = parseField(field);
        return value ? parseFloat(value) : undefined;
      };

      const title = parseField('title');
      if (title) {
        const optimizedPoster = await optimizePosterPath(parseField('poster'));
        
        musicData = {
          title,
          author: parseField('author'),
          album: parseField('album'),
          duration: parseNumber('duration'),
          genres: parseField('genres'),
          poster: optimizedPoster,
          url: parseField('url')
        };
      }
    }

    if (text || images.length > 0 || htmlContent || movieData || tvData || bookData || musicData) {
      timeBlocks.push({ time, text, images, htmlContent, movieData, tvData, bookData, musicData });
    }
  }

  // 按时间倒序排列时间块（最新的时间在前）
  timeBlocks.sort((a, b) => {
    const timeA = a.time.replace(':', '');
    const timeB = b.time.replace(':', '');
    return timeB.localeCompare(timeA);
  });

  return {
    date,
    timeBlocks,
  };
}
