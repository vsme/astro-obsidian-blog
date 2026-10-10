export const COMMENT_LIMIT: number;
export const NICKNAME_LIMIT: number;
export function isCommentContentId(value: unknown): value is string;
export const COMMENT_ICONS: { emoji: string; label: string }[];
export function countCharacters(value: string): number;
export function normalizeNickname(value: string): string;
export interface CommentInput {
  content_id: string;
  message: string;
  emoji?: string | null;
  nickname?: string | null;
  email?: string | null;
}
export function validateComment(input: unknown): Required<CommentInput>;
