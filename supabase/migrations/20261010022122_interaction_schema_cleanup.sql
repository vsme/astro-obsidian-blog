-- Apply after both the successful-publication quota and emoji HMAC upgrades.
-- No data is deleted. Never use CASCADE when retiring obsolete routines.
begin;
do $$ begin
  if to_regprocedure('public.publish_owned_diary_comment(text,text,text,text,text,text,text,jsonb,text)') is null
    or to_regprocedure('public.toggle_emoji_reaction_hmac(text,text,text,text)') is null then
    raise exception 'Apply the comment quota and emoji HMAC upgrades first';
  end if;
end $$;

-- Trigger and management routines execute with the caller's privileges. The new
-- emoji write path already uses service_role, so no RLS bypass is needed here.
alter function public.fn_set_updated_at() security invoker;
alter function public.fn_set_updated_at() set search_path = '';
alter function public.fn_update_emoji_stats_cache(text,text) security invoker;
alter function public.fn_update_emoji_stats_cache(text,text) set search_path = '';
alter function public.fn_trg_sync_emoji_stats() security invoker;
alter function public.fn_trg_sync_emoji_stats() set search_path = '';
alter function public.cleanup_expired_rate_limits() security invoker;
alter function public.cleanup_expired_rate_limits() set search_path = '';
alter function public.rebuild_emoji_stats_cache() security invoker;
alter function public.rebuild_emoji_stats_cache() set search_path = '';
grant select,insert,update,delete,truncate on public.emoji_stats_cache to service_role;

-- Public emoji readers still need controlled RLS bypass. Their table references
-- are qualified, and clearing search_path prevents untrusted name resolution.
alter function public.get_content_reactions(text,text) set search_path = '';
alter function public.get_content_reactions_many(text[],text) set search_path = '';

-- Consolidate the two old list helpers into the sole viewer-aware reader.
-- Keep the same per-diary limits: 20 public rows plus 20 owned rows, deduplicated.
create or replace function public.get_diary_comments_for_viewer(p_content_ids text[], p_actor_hash text default null)
returns table(id uuid, content_id text, message text, emoji text, nickname text, created_at timestamptz, status text, interaction_count integer, is_own boolean, has_reacted boolean)
language sql stable security invoker set search_path = '' as $$
  with visible as (
    select c.id,row_number() over(partition by c.content_id order by c.created_at desc,c.id desc) as position
    from public.diary_comments c
    where c.status='approved' and c.content_id=any(p_content_ids[1:50])
  ), owned as (
    select c.id,row_number() over(partition by c.content_id order by c.created_at desc,c.id desc) as position
    from public.diary_comments c join diary_private.diary_comment_details d on d.comment_id=c.id
    where d.owner_hash=p_actor_hash and c.status in ('approved','pending')
      and c.content_id=any(p_content_ids[1:50])
  ), eligible as (
    select v.id from visible v where v.position<=20
    union select o.id from owned o where o.position<=20
  )
  select c.id,c.content_id,c.message,c.emoji,c.nickname,c.created_at,c.status,c.interaction_count,
    coalesce(d.owner_hash=p_actor_hash,false),
    exists(select 1 from diary_private.diary_comment_reactions r where r.comment_id=c.id and r.actor_hash=p_actor_hash)
  from eligible e join public.diary_comments c on c.id=e.id
  left join diary_private.diary_comment_details d on d.comment_id=c.id
  where p_actor_hash is null or p_actor_hash ~ '^[a-f0-9]{64}$'
  order by c.created_at desc,c.id desc;
$$;

-- Known legacy entry points have no callers in the current frontend/Edge code.
drop function if exists public.get_diary_comment_reaction_state(text[],text);
drop function if exists public.get_diary_comments_many(text[]);
drop function if exists public.get_diary_comments_with_reactions_many(text[]);
drop function if exists public.get_owned_diary_comments(text[],text);
drop function if exists public.save_diary_comment(text,text,text,text,text,text,text,jsonb);
drop function if exists public.reserve_diary_comment(text);
drop function if exists public.toggle_emoji_reaction(text,text,text);
drop function if exists public.enforce_rate_limit(text,text,integer,text);
drop function if exists public.enforce_rate_limit(text,text,integer);
drop function if exists public.get_request_ip();

-- Clear PUBLIC as well as Supabase's explicit anon/authenticated defaults.
-- Only the two public emoji read APIs are allowed back to browser roles.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname in (
      'fn_set_updated_at','fn_update_emoji_stats_cache','fn_trg_sync_emoji_stats',
      'cleanup_expired_rate_limits','rebuild_emoji_stats_cache',
      'get_content_reactions','get_content_reactions_many','toggle_emoji_reaction_hmac',
      'get_diary_comments_for_viewer','save_owned_diary_comment','delete_owned_diary_comment',
      'toggle_diary_comment_reaction','reserve_diary_comment_reaction',
      'reserve_diary_comment_action','publish_owned_diary_comment'
    )) or (n.nspname='diary_private' and p.proname='diary_comment_rate_result')
  loop
    execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
grant execute on function public.get_content_reactions(text,text),public.get_content_reactions_many(text[],text) to anon,authenticated;
commit;
