-- Allow footprint comments under the existing, stable emoji content IDs.
-- Existing comments, reactions and ownership rules are unchanged.
begin;
alter table public.diary_comments drop constraint if exists diary_comments_content_id_check;
alter table public.diary_comments add constraint diary_comments_content_id_check
  check (content_id ~ '^emoji-reactions-([0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}|footprint-[A-Za-z0-9][A-Za-z0-9_-]{0,179})$');
commit;
