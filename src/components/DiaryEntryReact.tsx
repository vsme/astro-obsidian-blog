import React from "react";
import TimelineItemReact from "./TimelineItemReact";
import { SITE } from "../config";

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
  hideYear?: boolean;
  timeBlocks: TimeBlock[];
}

const TZ = SITE.timezone;

// 将 Date -> "YYYY-MM-DD"（按指定时区），便于比较"今天/昨天/前天"
function toYMD(d: Date, timeZone = TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // en-CA 会输出 2025-08-17
}

// 解析 "YYYY-MM-DD" 为一个 UTC 的 00:00:00 时间点，避免本地时区干扰
function ymdToUTC(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const DiaryEntryReact: React.FC<DiaryEntryProps> = ({
  date,
  hideYear = false,
  timeBlocks,
}) => {
  // 1) 先准备稳定的 SSR 文案：绝对日期 (MM/DD) + 固定时区的星期/年份
  const entryDateUTC = ymdToUTC(date);

  const absoluteLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ,
    month: "2-digit",
    day: "2-digit",
  }).format(entryDateUTC); // 如 "08/17"

  const weekdayLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ,
    weekday: "short",
  }).format(entryDateUTC); // 如 "周日"

  const yearLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ,
    year: "numeric",
  }).format(entryDateUTC); // 如 "2025"

  // 2) 客户端再计算"今天/昨天/前天"，并替换显示
  const [relativeLabel, setRelativeLabel] = React.useState<string | null>(null);

  React.useLayoutEffect(() => {
    const now = new Date();
    // 当天(按 TZ) 与条目日期(按 TZ) 的日历日
    const todayYMD = toYMD(now, TZ);
    const entryYMD = toYMD(entryDateUTC, TZ);

    // 把 "YYYY-MM-DD" 转为 UTC 00:00 计算"整日"差
    const todayUTC = ymdToUTC(todayYMD);
    const entryUTC = ymdToUTC(entryYMD);

    const diffDays = Math.floor(
      (todayUTC.getTime() - entryUTC.getTime()) / 86400000
    );

    if (diffDays === 0) setRelativeLabel("今天");
    else if (diffDays === 1) setRelativeLabel("昨天");
    else if (diffDays === 2) setRelativeLabel("前天");
    else setRelativeLabel(null); // 超过范围就用 SSR 的 absoluteLabel
  }, [date]);

  return (
    <div className="date-group mb-16">
      <div className="mb-8">
        <div className="flex items-baseline gap-3">
          <div className="text-skin-accent text-3xl leading-none font-bold">
            {/* SSR 时渲染 absoluteLabel；CSR 完成后若有相对文案则替换。
               suppressHydrationWarning 防止首帧文本差异触发水合警告 */}
            <span suppressHydrationWarning>
              {relativeLabel ?? absoluteLabel}
            </span>
          </div>
          <div className="flex flex-col">
            <div className="text-skin-base text-base leading-tight font-medium">
              {weekdayLabel}
            </div>
            {!hideYear && (
              <div className="text-skin-base/70 text-sm leading-tight">
                {yearLabel}
              </div>
            )}
          </div>
        </div>
      </div>

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
