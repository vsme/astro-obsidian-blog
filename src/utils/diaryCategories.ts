import type { MediaCardType } from "@/types/media";

export const DIARY_CATEGORIES = [
  "daily",
  "reading",
  "watching",
  "music",
] as const;

export type DiaryCategory = (typeof DIARY_CATEGORIES)[number];

interface CategorizedEntry {
  timeBlocks: Array<{
    mediaCards?: Array<{ type: MediaCardType }>;
  }>;
}

type CategorizedTimeBlock = CategorizedEntry["timeBlocks"][number];

function timeBlockMatchesDiaryCategory(
  block: CategorizedTimeBlock,
  category: DiaryCategory
) {
  if (category === "daily") return !block.mediaCards?.length;

  return block.mediaCards?.some(card => {
    if (category === "reading") return card.type === "book";
    if (category === "watching") {
      return card.type === "movie" || card.type === "tv";
    }
    return card.type === "music";
  });
}

export function entryMatchesDiaryCategory(
  entry: CategorizedEntry,
  category: DiaryCategory
) {
  return entry.timeBlocks.some(block =>
    timeBlockMatchesDiaryCategory(block, category)
  );
}

export function filterEntryByDiaryCategory<T extends CategorizedEntry>(
  entry: T,
  category: DiaryCategory
): T | null {
  const timeBlocks = entry.timeBlocks.filter(block =>
    timeBlockMatchesDiaryCategory(block, category)
  );

  return timeBlocks.length ? ({ ...entry, timeBlocks } as T) : null;
}
