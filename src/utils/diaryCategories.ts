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

export function entryMatchesDiaryCategory(
  entry: CategorizedEntry,
  category: DiaryCategory
) {
  if (category === "daily") {
    return entry.timeBlocks.every(block => !block.mediaCards?.length);
  }

  return entry.timeBlocks.some(block =>
    block.mediaCards?.some(card => {
      if (category === "reading") return card.type === "book";
      if (category === "watching") {
        return card.type === "movie" || card.type === "tv";
      }
      return card.type === "music";
    })
  );
}
