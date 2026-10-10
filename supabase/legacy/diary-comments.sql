-- Standalone additive schema; apply to the existing project, never replace its reaction schema.
begin;
create schema if not exists diary_private;
revoke all on schema diary_private from public, anon, authenticated;
grant usage on schema diary_private to service_role;

create table public.diary_comments (
  id uuid primary key default gen_random_uuid(),
  content_id text not null check (content_id ~ '^emoji-reactions-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}$'),
  message text not null default '' check (char_length(message) <= 320),
  emoji text check (emoji in ('👍','👎','😄','😕','🎉','❤️','🚀','👀')),
  nickname text check (char_length(nickname) <= 160),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  check (message <> '' or emoji is not null)
);
comment on column public.diary_comments.message is 'Edge Function validates at most 20 Unicode grapheme clusters before writing; SQL adds a storage bound.';
create index diary_comments_content_created on public.diary_comments(content_id, created_at desc, id desc) where status = 'approved';
create table diary_private.diary_comment_details (
  comment_id uuid primary key references public.diary_comments(id) on delete cascade,
  email text check (char_length(email) <= 254),
  moderation_model text not null,
  moderation jsonb not null
);
create table diary_private.diary_comment_rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key(key, window_start)
);
alter table public.diary_comments enable row level security;
alter table diary_private.diary_comment_details enable row level security;
alter table diary_private.diary_comment_rate_limits enable row level security;
revoke all on public.diary_comments from public, anon, authenticated;
revoke all on diary_private.diary_comment_details, diary_private.diary_comment_rate_limits from public, anon, authenticated;
grant select(id, content_id, message, emoji, nickname, created_at) on public.diary_comments to anon, authenticated;
grant all on public.diary_comments, diary_private.diary_comment_details, diary_private.diary_comment_rate_limits to service_role;
create policy diary_comments_approved_read on public.diary_comments for select to anon, authenticated using (status = 'approved');

create function public.get_diary_comments_many(p_content_ids text[])
returns table(id uuid, content_id text, message text, emoji text, nickname text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select ranked.id, ranked.content_id, ranked.message, ranked.emoji, ranked.nickname, ranked.created_at
  from (
    select c.id, c.content_id, c.message, c.emoji, c.nickname, c.created_at,
      row_number() over (partition by c.content_id order by c.created_at desc, c.id desc) as position
    from public.diary_comments c where c.content_id = any(p_content_ids[1:50])
  ) ranked where ranked.position <= 20
  order by ranked.created_at desc, ranked.id desc;
$$;
revoke all on function public.get_diary_comments_many(text[]) from public;
grant execute on function public.get_diary_comments_many(text[]) to anon, authenticated;

create function public.reserve_diary_comment(p_key text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare v_minute timestamptz := date_trunc('minute', now()); v_day timestamptz := date_trunc('day', now()); v_hits integer; v_allowed boolean := true;
begin
  if p_key !~ '^[a-f0-9]{64}$' then return false; end if;
  delete from diary_private.diary_comment_rate_limits where window_start < now() - interval '2 days';
  insert into diary_private.diary_comment_rate_limits as limits(key, window_start, hits) values ('all:minute', v_minute, 1)
    on conflict(key, window_start) do update set hits = limits.hits + 1 returning hits into v_hits;
  v_allowed := v_allowed and v_hits <= 30;
  insert into diary_private.diary_comment_rate_limits as limits(key, window_start, hits) values (p_key || ':minute', v_minute, 1)
    on conflict(key, window_start) do update set hits = limits.hits + 1 returning hits into v_hits;
  v_allowed := v_allowed and v_hits <= 5;
  insert into diary_private.diary_comment_rate_limits as limits(key, window_start, hits) values (p_key || ':day', v_day, 1)
    on conflict(key, window_start) do update set hits = limits.hits + 1 returning hits into v_hits;
  return v_allowed and v_hits <= 50;
end;
$$;
revoke all on function public.reserve_diary_comment(text) from public, anon, authenticated;
grant execute on function public.reserve_diary_comment(text) to service_role;

create function public.save_diary_comment(p_content_id text, p_message text, p_emoji text, p_nickname text, p_email text, p_status text, p_model text, p_review jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if p_status not in ('approved', 'pending') then raise exception 'invalid review status'; end if;
  insert into public.diary_comments(content_id, message, emoji, nickname, status)
    values(p_content_id, p_message, p_emoji, p_nickname, p_status) returning id into v_id;
  insert into diary_private.diary_comment_details(comment_id, email, moderation_model, moderation)
    values(v_id, p_email, p_model, p_review);
  return v_id;
end;
$$;
revoke all on function public.save_diary_comment(text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_diary_comment(text,text,text,text,text,text,text,jsonb) to service_role;
commit;
