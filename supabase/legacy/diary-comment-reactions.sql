-- Apply after diary-comments.sql and diary-comment-ownership.sql.
begin;
alter table public.diary_comments add column if not exists interaction_count integer not null default 0 check (interaction_count >= 0);
-- The invoker reader filters by status; RLS still only permits approved rows.
grant select(status, interaction_count) on public.diary_comments to anon, authenticated;

create table if not exists diary_private.diary_comment_reactions (
  comment_id uuid not null references public.diary_comments(id) on delete cascade,
  actor_hash text not null check (actor_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key(comment_id, actor_hash)
);
alter table diary_private.diary_comment_reactions enable row level security;
revoke all on diary_private.diary_comment_reactions from public, anon, authenticated;
grant all on diary_private.diary_comment_reactions to service_role;

create or replace function public.get_diary_comments_with_reactions_many(p_content_ids text[])
returns table(id uuid, content_id text, message text, emoji text, nickname text, created_at timestamptz, interaction_count integer)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.content_id, r.message, r.emoji, r.nickname, r.created_at, r.interaction_count
  from (
    select c.id, c.content_id, c.message, c.emoji, c.nickname, c.created_at, c.interaction_count,
      row_number() over (partition by c.content_id order by c.created_at desc, c.id desc) as position
    from public.diary_comments c
    where c.status = 'approved' and c.content_id = any(p_content_ids[1:50])
  ) r where r.position <= 20 order by r.created_at desc, r.id desc;
$$;
revoke all on function public.get_diary_comments_with_reactions_many(text[]) from public, anon, authenticated;
grant execute on function public.get_diary_comments_with_reactions_many(text[]) to anon, authenticated, service_role;

create or replace function public.get_diary_comment_reaction_state(p_content_ids text[], p_actor_hash text)
returns table(id uuid, interaction_count integer, has_reacted boolean)
language sql stable security invoker set search_path = '' as $$
  with visible as (
    select c.id, row_number() over (partition by c.content_id order by c.created_at desc, c.id desc) as position
    from public.diary_comments c where c.status = 'approved' and c.content_id = any(p_content_ids[1:50])
  ), owned as (
    select c.id, row_number() over (partition by c.content_id order by c.created_at desc, c.id desc) as position
    from public.diary_comments c join diary_private.diary_comment_details d on d.comment_id = c.id
    where d.owner_hash = p_actor_hash and c.status in ('approved','pending') and c.content_id = any(p_content_ids[1:50])
  ), eligible as (
    select id from visible where position <= 20 union select id from owned where position <= 20
  )
  select c.id, c.interaction_count,
    exists(select 1 from diary_private.diary_comment_reactions v where v.comment_id=c.id and v.actor_hash=p_actor_hash)
  from eligible e join public.diary_comments c on c.id=e.id
  where p_actor_hash ~ '^[a-f0-9]{64}$';
$$;

create or replace function public.toggle_diary_comment_reaction(p_comment_id uuid, p_actor_hash text)
returns table(interaction_count integer, is_active boolean)
language plpgsql security invoker set search_path = '' as $$
declare v_status text; v_owner text; v_removed integer; v_count integer; v_active boolean;
begin
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then return; end if;
  -- Serialize all actors on this comment before counting, preventing lost updates.
  select c.status, d.owner_hash into v_status, v_owner
    from public.diary_comments c left join diary_private.diary_comment_details d on d.comment_id=c.id
    where c.id=p_comment_id for update of c;
  if not found or v_status <> 'approved' or v_owner = p_actor_hash then return; end if;
  delete from diary_private.diary_comment_reactions where comment_id=p_comment_id and actor_hash=p_actor_hash;
  get diagnostics v_removed = row_count;
  v_active := v_removed = 0;
  if v_active then
    insert into diary_private.diary_comment_reactions(comment_id, actor_hash) values(p_comment_id,p_actor_hash);
  end if;
  select count(*)::integer into v_count from diary_private.diary_comment_reactions where comment_id=p_comment_id;
  update public.diary_comments set interaction_count=v_count where id=p_comment_id;
  return query select v_count, v_active;
end;
$$;

-- One service-only query returns the public list plus this browser's own state.
create or replace function public.get_diary_comments_for_viewer(p_content_ids text[], p_actor_hash text default null)
returns table(id uuid, content_id text, message text, emoji text, nickname text, created_at timestamptz, status text, interaction_count integer, is_own boolean, has_reacted boolean)
language sql stable security invoker set search_path = '' as $$
  with eligible as (
    select v.id from public.get_diary_comments_with_reactions_many(p_content_ids) v
    union select o.id from public.get_owned_diary_comments(p_content_ids,p_actor_hash) o
  )
  select c.id,c.content_id,c.message,c.emoji,c.nickname,c.created_at,c.status,c.interaction_count,
    coalesce(d.owner_hash=p_actor_hash,false),
    exists(select 1 from diary_private.diary_comment_reactions v where v.comment_id=c.id and v.actor_hash=p_actor_hash)
  from eligible e join public.diary_comments c on c.id=e.id
  left join diary_private.diary_comment_details d on d.comment_id=c.id
  where p_actor_hash is null or p_actor_hash ~ '^[a-f0-9]{64}$'
  order by c.created_at desc,c.id desc;
$$;

create or replace function public.reserve_diary_comment_reaction(p_key text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare v_minute timestamptz := date_trunc('minute',now()); v_day timestamptz := date_trunc('day',now()); v_hits integer; v_allowed boolean := true;
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' then return false; end if;
  delete from diary_private.diary_comment_rate_limits where window_start < now() - interval '2 days';
  insert into diary_private.diary_comment_rate_limits as limits(key,window_start,hits) values('reaction:all:minute',v_minute,1)
    on conflict(key,window_start) do update set hits=limits.hits+1 returning hits into v_hits;
  v_allowed := v_allowed and v_hits <= 120;
  insert into diary_private.diary_comment_rate_limits as limits(key,window_start,hits) values('reaction:'||p_key||':minute',v_minute,1)
    on conflict(key,window_start) do update set hits=limits.hits+1 returning hits into v_hits;
  v_allowed := v_allowed and v_hits <= 30;
  insert into diary_private.diary_comment_rate_limits as limits(key,window_start,hits) values('reaction:'||p_key||':day',v_day,1)
    on conflict(key,window_start) do update set hits=limits.hits+1 returning hits into v_hits;
  return v_allowed and v_hits <= 500;
end;
$$;

revoke all on function public.get_diary_comment_reaction_state(text[],text) from public, anon, authenticated;
revoke all on function public.toggle_diary_comment_reaction(uuid,text) from public, anon, authenticated;
revoke all on function public.reserve_diary_comment_reaction(text) from public, anon, authenticated;
revoke all on function public.get_diary_comments_for_viewer(text[],text) from public, anon, authenticated;
grant execute on function public.get_diary_comment_reaction_state(text[],text) to service_role;
grant execute on function public.toggle_diary_comment_reaction(uuid,text) to service_role;
grant execute on function public.reserve_diary_comment_reaction(text) to service_role;
grant execute on function public.get_diary_comments_for_viewer(text[],text) to service_role;
commit;
