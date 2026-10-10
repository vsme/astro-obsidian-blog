-- Upgrade after diary-comments.sql and diary-comment-ownership.sql.
-- Existing schemas and functions stay intact. Old ':day' attempt counters are not
-- used for publishing quota; ':approved-day' counts only successful new saves.
begin;

create or replace function diary_private.diary_comment_rate_result(
  p_reason text, p_limit integer, p_used integer, p_resets_at timestamptz
) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'allowed', false, 'reason', p_reason, 'limit', p_limit, 'used', p_used,
    'retry_after', greatest(1, ceil(extract(epoch from p_resets_at - now()))::integer),
    'resets_at', p_resets_at
  );
$$;

create or replace function public.reserve_diary_comment_action(p_key text, p_action text)
returns jsonb language plpgsql security invoker set search_path = '' set timezone = 'UTC' as $$
declare
  v_minute timestamptz := date_trunc('minute', now());
  v_day timestamptz := date_trunc('day', now());
  v_hits integer;
  v_blocked record;
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_action is null or p_action not in ('submit','react') then
    raise exception 'invalid rate request';
  end if;
  if p_action = 'react' then
    if public.reserve_diary_comment_reaction(p_key) then
      return jsonb_build_object('allowed', true);
    end if;
    select b.reason,b.quota,r.hits,b.resets_at into v_blocked
    from (values
      ('global_minute','reaction:all:minute',v_minute,120,v_minute+interval '1 minute'),
      ('ip_minute','reaction:'||p_key||':minute',v_minute,30,v_minute+interval '1 minute'),
      ('ip_day','reaction:'||p_key||':day',v_day,500,v_day+interval '1 day')
    ) as b(reason,key,window_start,quota,resets_at)
    join diary_private.diary_comment_rate_limits r on r.key=b.key and r.window_start=b.window_start
    where r.hits > b.quota order by b.resets_at desc limit 1;
    if not found then raise exception 'inconsistent reaction rate state'; end if;
    return diary_private.diary_comment_rate_result(v_blocked.reason,v_blocked.quota,v_blocked.hits,v_blocked.resets_at);
  end if;

  -- Do not spend minute budgets when the daily publication quota is exhausted.
  select hits into v_hits from diary_private.diary_comment_rate_limits
    where key=p_key||':approved-day' and window_start=v_day;
  if v_hits >= 100 then
    return diary_private.diary_comment_rate_result('ip_day',100,v_hits,v_day+interval '1 day');
  end if;
  delete from diary_private.diary_comment_rate_limits where window_start < now()-interval '2 days';

  insert into diary_private.diary_comment_rate_limits as limits(key,window_start,hits)
    values(p_key||':minute',v_minute,1)
    on conflict(key,window_start) do update set hits=limits.hits+1 where limits.hits<5
    returning hits into v_hits;
  if v_hits is null then
    select hits into v_hits from diary_private.diary_comment_rate_limits where key=p_key||':minute' and window_start=v_minute;
    return diary_private.diary_comment_rate_result('ip_minute',5,v_hits,v_minute+interval '1 minute');
  end if;
  insert into diary_private.diary_comment_rate_limits as limits(key,window_start,hits)
    values('all:minute',v_minute,1)
    on conflict(key,window_start) do update set hits=limits.hits+1 where limits.hits<30
    returning hits into v_hits;
  if v_hits is null then
    select hits into v_hits from diary_private.diary_comment_rate_limits where key='all:minute' and window_start=v_minute;
    return diary_private.diary_comment_rate_result('global_minute',30,v_hits,v_minute+interval '1 minute');
  end if;
  return jsonb_build_object('allowed',true);
end;
$$;

create or replace function public.publish_owned_diary_comment(
  p_key text, p_content_id text, p_message text, p_emoji text, p_nickname text,
  p_email text, p_model text, p_review jsonb, p_owner_hash text
) returns jsonb
language plpgsql security invoker set search_path = '' set timezone = 'UTC' as $$
declare v_day timestamptz := date_trunc('day',now()); v_hits integer;
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' then raise exception 'invalid rate key'; end if;
  -- This row lock serializes concurrent approved saves. If saving fails, the
  -- counter increment is rolled back together with the comment and private data.
  insert into diary_private.diary_comment_rate_limits as limits(key,window_start,hits)
    values(p_key||':approved-day',v_day,1)
    on conflict(key,window_start) do update set hits=limits.hits+1 where limits.hits<100
    returning hits into v_hits;
  if v_hits is null then
    select hits into v_hits from diary_private.diary_comment_rate_limits where key=p_key||':approved-day' and window_start=v_day;
    return diary_private.diary_comment_rate_result('ip_day',100,v_hits,v_day+interval '1 day');
  end if;
  perform public.save_owned_diary_comment(p_content_id,p_message,p_emoji,p_nickname,p_email,'approved',p_model,p_review,p_owner_hash);
  return jsonb_build_object('allowed',true);
end;
$$;

revoke all on function diary_private.diary_comment_rate_result(text,integer,integer,timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_diary_comment_action(text,text) from public, anon, authenticated;
revoke all on function public.publish_owned_diary_comment(text,text,text,text,text,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function diary_private.diary_comment_rate_result(text,integer,integer,timestamptz) to service_role;
grant execute on function public.reserve_diary_comment_action(text,text) to service_role;
grant execute on function public.publish_owned_diary_comment(text,text,text,text,text,text,text,jsonb,text) to service_role;
commit;
