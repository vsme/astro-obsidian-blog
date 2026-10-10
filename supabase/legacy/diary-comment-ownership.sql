-- Apply after diary-comments.sql. Original comment/reaction scripts stay unchanged.
begin;

alter table diary_private.diary_comment_details
  add column if not exists owner_hash text
  check (owner_hash ~ '^[a-f0-9]{64}$');
create index if not exists diary_comment_details_owner
  on diary_private.diary_comment_details(owner_hash, comment_id)
  where owner_hash is not null;

create or replace function public.save_owned_diary_comment(
  p_content_id text, p_message text, p_emoji text, p_nickname text,
  p_email text, p_status text, p_model text, p_review jsonb, p_owner_hash text
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if p_owner_hash is null or p_owner_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid comment owner';
  end if;
  if p_status not in ('approved', 'pending') then raise exception 'invalid review status'; end if;
  insert into public.diary_comments(content_id, message, emoji, nickname, status)
    values(p_content_id, p_message, p_emoji, p_nickname, p_status) returning id into v_id;
  insert into diary_private.diary_comment_details(comment_id, email, moderation_model, moderation, owner_hash)
    values(v_id, p_email, p_model, p_review, p_owner_hash);
  return v_id;
end;
$$;

create or replace function public.get_owned_diary_comments(p_content_ids text[], p_owner_hash text)
returns table(id uuid, content_id text, message text, emoji text, nickname text, created_at timestamptz, status text)
language sql stable security invoker set search_path = '' as $$
  select ranked.id, ranked.content_id, ranked.message, ranked.emoji, ranked.nickname, ranked.created_at, ranked.status
  from (
    select c.id, c.content_id, c.message, c.emoji, c.nickname, c.created_at, c.status,
      row_number() over (partition by c.content_id order by c.created_at desc, c.id desc) as position
    from public.diary_comments c
    join diary_private.diary_comment_details d on d.comment_id = c.id
    where d.owner_hash = p_owner_hash
      and p_owner_hash ~ '^[a-f0-9]{64}$'
      and c.content_id = any(p_content_ids[1:50])
      and c.status in ('approved', 'pending')
  ) ranked where ranked.position <= 20
  order by ranked.created_at desc, ranked.id desc;
$$;

create or replace function public.delete_owned_diary_comment(p_comment_id uuid, p_owner_hash text)
returns boolean
language sql volatile security invoker set search_path = '' as $$
  with removed as (
    delete from public.diary_comments c
    using diary_private.diary_comment_details d
    where c.id = p_comment_id and d.comment_id = c.id
      and d.owner_hash = p_owner_hash
      and p_owner_hash ~ '^[a-f0-9]{64}$'
    returning c.id
  ) select exists(select 1 from removed);
$$;

-- Explicitly revoke all three: Supabase may grant anon/authenticated directly.
revoke all on function public.save_owned_diary_comment(text,text,text,text,text,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.get_owned_diary_comments(text[],text) from public, anon, authenticated;
revoke all on function public.delete_owned_diary_comment(uuid,text) from public, anon, authenticated;
grant execute on function public.save_owned_diary_comment(text,text,text,text,text,text,text,jsonb,text) to service_role;
grant execute on function public.get_owned_diary_comments(text[],text) to service_role;
grant execute on function public.delete_owned_diary_comment(uuid,text) to service_role;
commit;
