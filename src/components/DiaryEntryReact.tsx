import React from "react";
import TimelineItemReact from "./TimelineItemReact";
import { SITE } from "../config";

import type { MediaCardData, MediaCardType } from "../types/media";

export interface MediaCardItem {
  type: MediaCardType;
  data: MediaCardData;
}

export interface TimeBlock {
  time: string;
  text?: string;
  images?: Array<{ alt: string; src: string; title?: string }>;
  htmlContent?: string;
  mediaCards?: MediaCardItem[];
}

export interface DiaryEntryProps {
  date: string;
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
  timeBlocks,
}) => {
  // 1) 先准备稳定的 SSR 文案：绝对日期 (MM/DD) + 固定时区的星期
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
    <div className="time-river-date-group" data-pagefind-weight="2">
      <header className="time-river-date-header">
        <div className="time-river-date-lockup">
          <h2
            id={`date-${date}`}
            className="text-skin-accent m-0 text-3xl leading-none font-bold"
            aria-label={`${date} ${weekdayLabel} 的日记`}
          >
            {/* SSR 时渲染 absoluteLabel；CSR 完成后若有相对文案则替换。
               suppressHydrationWarning 防止首帧文本差异触发水合警告 */}
            <time dateTime={date} suppressHydrationWarning>
              {relativeLabel ?? absoluteLabel}
            </time>
          </h2>
          <div className="time-river-date-secondary" aria-hidden="true">
            <div className="time-river-date-meta">
              <span>{weekdayLabel}</span>
            </div>
            <div className="time-river-date-times">
              {timeBlocks.map((block, index) => (
                <React.Fragment key={`${block.time}-${index}`}>
                  {index > 0 && <span>·</span>}
                  <time dateTime={`${date}T${block.time}`}>{block.time}</time>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        <div className="sr-only">
          {date} 共有 {timeBlocks.length} 个时间段的记录
        </div>
      </header>

      <div
        id={`content-${date}`}
        className="space-y-0"
        role="group"
        aria-labelledby={`date-${date}`}
      >
        {timeBlocks.map((block, index) => (
          <TimelineItemReact
            key={`${date}-${block.time}-${index}`}
            time={block.time}
            date={date}
            text={block.text}
            images={block.images}
            htmlContent={block.htmlContent}
            mediaCards={block.mediaCards}
          />
        ))}
      </div>
    </div>
  );
};

export default DiaryEntryReact;
