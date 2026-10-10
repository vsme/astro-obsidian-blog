-- Fictional fixtures only; run in the temporary database created by the test runner.
create schema schema_test;
create table schema_test.viewer_results(actor text, rows jsonb);
insert into public.diary_comments(id,content_id,message,nickname,status,created_at)
select md5('comment-'||i)::uuid,'emoji-reactions-2026-10-10-12-00','fixture '||i,'test','approved',
  '2026-10-10 00:00:00+00'::timestamptz+i*interval '1 minute'
from generate_series(1,45) i;
insert into diary_private.diary_comment_details(comment_id,email,moderation_model,moderation,owner_hash)
select id,'private@example.test','test','[]',case when message ~ '[13579]$' then repeat('a',64) else repeat('b',64) end
from public.diary_comments;
insert into public.diary_comments(id,content_id,message,status,created_at)
values(md5('pending-owner')::uuid,'emoji-reactions-2026-10-10-12-00','pending-own','pending','2026-10-10 01:00:00+00'),
(md5('pending-other')::uuid,'emoji-reactions-2026-10-10-12-00','pending-other','pending','2026-10-10 02:00:00+00');
insert into diary_private.diary_comment_details(comment_id,moderation_model,moderation,owner_hash)
values(md5('pending-owner')::uuid,'test','[]',repeat('a',64)),(md5('pending-other')::uuid,'test','[]',repeat('b',64));
insert into public.user_reactions(content_id,emoji,user_hash)
values('emoji-reactions-footprint-fixture','👍','historical-viewer');
set role service_role;
select public.toggle_diary_comment_reaction(md5('comment-45')::uuid,repeat('c',64));
reset role;
insert into schema_test.viewer_results
select actor,coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc)
 from public.get_diary_comments_for_viewer(array['emoji-reactions-2026-10-10-12-00'],actor) v),'[]'::jsonb)
from (values(null::text),(repeat('a',64)),(repeat('b',64)),(repeat('c',64)),('invalid')) as actors(actor);
-- Emulate Supabase's explicit function grants and the online legacy overload.
create function public.enforce_rate_limit(text,text,integer,text) returns void language sql security definer
as 'select public.enforce_rate_limit($1,$2,$3)';
grant execute on function public.enforce_rate_limit(text,text,integer,text) to anon,authenticated;
grant execute on function public.cleanup_expired_rate_limits(),public.rebuild_emoji_stats_cache(),public.fn_update_emoji_stats_cache(text,text) to anon,authenticated;
