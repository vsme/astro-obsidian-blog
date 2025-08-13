import React from "react";
import TimelineItemReact from "./TimelineItemReact";

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
  region?: string;
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

export interface TimeBlock {
  time: string;
  text?: string;
  images?: Array<{ alt: string; src: string; title?: string }>;
  htmlContent?: string;
  movieData?: LocalMovieData;
  tvData?: LocalTVData;
  bookData?: LocalBookData;
  musicData?: LocalMusicData;
}

export interface DiaryEntryProps {
  date: string;
  timeBlocks: TimeBlock[];
}

const DiaryEntryReact: React.FC<DiaryEntryProps> = ({ date, timeBlocks }) => {
  // 格式化日期显示
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const diffTime = today.getTime() - date.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "今天";
    if (diffDays === 1) return "昨天";
    if (diffDays === 2) return "前天";

    return date.toLocaleDateString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
    });
  };

  return (
    <div className="date-group mb-16">
      {/* 优化的日期显示 */}
      <div className="mb-8">
        <div className="flex items-baseline gap-3">
          <div className="text-skin-accent text-3xl leading-none font-bold">
            {formatDate(date)}
          </div>
          <div className="flex flex-col">
            <div className="text-skin-base text-base leading-tight font-medium">
              {new Date(date).toLocaleDateString("zh-CN", { weekday: "short" })}
            </div>
            <div className="text-skin-base/70 text-sm leading-tight">
              {new Date(date).toLocaleDateString("zh-CN", {
                year: "numeric",
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 时间块列表 */}
      <div className="space-y-0">
        {timeBlocks.map((block, index) => (
          <TimelineItemReact
            key={`${block.time}-${index}`}
            time={block.time}
            text={block.text}
            images={block.images}
            htmlContent={block.htmlContent}
            movieData={block.movieData}
            tvData={block.tvData}
            bookData={block.bookData}
            musicData={block.musicData}
          />
        ))}
      </div>
    </div>
  );
};

export default DiaryEntryReact;
