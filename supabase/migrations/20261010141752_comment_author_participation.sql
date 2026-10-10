-- Persist the author's implicit participation separately from other reactions.
-- Apply after interaction cleanup and footprint comments. No comments are removed.
begin;
alter table diary_private.diary_comment_details
  add column if not exists author_participating boolean not null default true;

drop function if exists public.get_diary_comments_for_viewer(text[],text);
create function public.get_diary_comments_for_viewer(p_content_ids text[], p_actor_hash text default null)
returns table(id uuid, content_id text, message text, emoji text, nickname text, created_at timestamptz, status text, interaction_count integer, is_own boolean, has_reacted boolean, author_participating boolean)
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
    case when d.owner_hash=p_actor_hash then d.author_participating
      else exists(select 1 from diary_private.diary_comment_reactions r where r.comment_id=c.id and r.actor_hash=p_actor_hash) end,
    coalesce(d.author_participating,true)
  from eligible e join public.diary_comments c on c.id=e.id
  left join diary_private.diary_comment_details d on d.comment_id=c.id
  where p_actor_hash is null or p_actor_hash ~ '^[a-f0-9]{64}$'
  order by c.created_at desc,c.id desc;
$$;

drop function if exists public.toggle_diary_comment_reaction(uuid,text);
create function public.toggle_diary_comment_reaction(p_comment_id uuid, p_actor_hash text)
returns table(interaction_count integer, is_active boolean, author_participating boolean, requires_delete_confirmation boolean)
language plpgsql security invoker set search_path = '' as $$
declare v_status text; v_owner text; v_author boolean; v_removed integer; v_count integer; v_active boolean;
begin
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then return; end if;
  -- All participation and deletion changes lock this same comment first.
  select c.status into v_status from public.diary_comments c where c.id=p_comment_id for update;
  if not found or v_status<>'approved' then return; end if;
  -- Read private state after acquiring the lock to avoid a stale joined snapshot.
  select d.owner_hash,d.author_participating into v_owner,v_author
    from diary_private.diary_comment_details d where d.comment_id=p_comment_id;
  v_author:=coalesce(v_author,true);
  if v_owner=p_actor_hash then
    if v_author and not exists(select 1 from diary_private.diary_comment_reactions r where r.comment_id=p_comment_id) then
      return query select 0,true,true,true;
      return;
    end if;
    v_author:=not v_author;
    update diary_private.diary_comment_details set author_participating=v_author where comment_id=p_comment_id;
    v_active:=v_author;
  else
    delete from diary_private.diary_comment_reactions r where r.comment_id=p_comment_id and r.actor_hash=p_actor_hash;
    get diagnostics v_removed=row_count;
    v_active:=v_removed=0;
    if v_active then
      insert into diary_private.diary_comment_reactions(comment_id,actor_hash) values(p_comment_id,p_actor_hash);
    end if;
  end if;
  select count(*)::integer into v_count from diary_private.diary_comment_reactions r where r.comment_id=p_comment_id;
  update public.diary_comments set interaction_count=v_count where id=p_comment_id;
  return query select v_count,v_active,v_author,false;
end;
$$;

create or replace function public.delete_owned_diary_comment(p_comment_id uuid, p_owner_hash text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_owner text; v_author boolean;
begin
  if p_owner_hash is null or p_owner_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  select c.id into v_id from public.diary_comments c where c.id=p_comment_id for update;
  if not found then return false; end if;
  select d.owner_hash,d.author_participating into v_owner,v_author
    from diary_private.diary_comment_details d where d.comment_id=p_comment_id;
  if v_owner is distinct from p_owner_hash or not coalesce(v_author,false)
    or exists(select 1 from diary_private.diary_comment_reactions r where r.comment_id=p_comment_id) then
    return false;
  end if;
  delete from public.diary_comments where id=p_comment_id;
  return true;
end;
$$;

revoke all on function public.get_diary_comments_for_viewer(text[],text),public.toggle_diary_comment_reaction(uuid,text),public.delete_owned_diary_comment(uuid,text) from public,anon,authenticated;
grant execute on function public.get_diary_comments_for_viewer(text[],text),public.toggle_diary_comment_reaction(uuid,text),public.delete_owned_diary_comment(uuid,text) to service_role;
commit;
