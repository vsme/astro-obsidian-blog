-- Current interaction schema for EMPTY projects only; not an online upgrade.
-- Generated from legacy baseline + migrations. Regenerate and verify with:
-- pnpm run supabase:init
begin;
do $$ begin
  if to_regclass('public.user_reactions') is not null
    or to_regclass('public.emoji_stats_cache') is not null
    or to_regclass('public.rate_limit_records') is not null
    or to_regclass('public.diary_comments') is not null
    or to_regnamespace('diary_private') is not null then
    raise exception 'Interaction schema already exists; apply pending migrations instead';
  end if;
end $$;
set local check_function_bodies = false;
set local search_path = '';

CREATE SCHEMA diary_private;

CREATE FUNCTION diary_private.diary_comment_rate_result(p_reason text, p_limit integer, p_used integer, p_resets_at timestamp with time zone) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'allowed', false, 'reason', p_reason, 'limit', p_limit, 'used', p_used,
    'retry_after', greatest(1, ceil(extract(epoch from p_resets_at - now()))::integer),
    'resets_at', p_resets_at
  );
$$;

CREATE FUNCTION public.cleanup_expired_rate_limits() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  DELETE FROM public.rate_limit_records WHERE expires_at < now();
END;
$$;

CREATE FUNCTION public.delete_owned_diary_comment(p_comment_id uuid, p_owner_hash text) RETURNS boolean
    LANGUAGE sql
    SET search_path TO ''
    AS $_$
  with removed as (
    delete from public.diary_comments c
    using diary_private.diary_comment_details d
    where c.id = p_comment_id and d.comment_id = c.id
      and d.owner_hash = p_owner_hash
      and p_owner_hash ~ '^[a-f0-9]{64}$'
    returning c.id
  ) select exists(select 1 from removed);
$_$;

CREATE FUNCTION public.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_trg_sync_emoji_stats() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_update_emoji_stats_cache(NEW.content_id, NEW.emoji);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.fn_update_emoji_stats_cache(OLD.content_id, OLD.emoji);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.fn_update_emoji_stats_cache(NEW.content_id, NEW.emoji);
    IF (OLD.content_id, OLD.emoji) IS DISTINCT FROM (NEW.content_id, NEW.emoji) THEN
      PERFORM public.fn_update_emoji_stats_cache(OLD.content_id, OLD.emoji);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.fn_update_emoji_stats_cache(p_content_id text, p_emoji text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.user_reactions
  WHERE content_id = p_content_id
    AND emoji      = p_emoji
    AND is_active  = true;

  INSERT INTO public.emoji_stats_cache (content_id, emoji, count, last_updated)
  VALUES (p_content_id, p_emoji, v_count, now())
  ON CONFLICT ON CONSTRAINT emoji_stats_cache_content_id_emoji_key
  DO UPDATE SET
     count        = EXCLUDED.count,
     last_updated = now();

  IF v_count = 0 THEN
    DELETE FROM public.emoji_stats_cache
    WHERE content_id = p_content_id AND emoji = p_emoji;
  END IF;
END;
$$;

CREATE FUNCTION public.get_content_reactions(p_content_id text, p_user_hash text DEFAULT NULL::text) RETURNS TABLE(emoji text, count integer, is_active boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    esc.emoji,
    esc.count,
    CASE WHEN p_user_hash IS NOT NULL
         THEN COALESCE(ur.is_active, false)
         ELSE false
    END AS is_active
  FROM public.emoji_stats_cache esc
  LEFT JOIN public.user_reactions ur
    ON  ur.content_id = esc.content_id
    AND ur.emoji      = esc.emoji
    AND ur.user_hash  = p_user_hash
  WHERE esc.content_id = p_content_id
    AND esc.count > 0
  ORDER BY esc.count DESC, esc.emoji;
END;
$$;

CREATE FUNCTION public.get_content_reactions_many(p_content_ids text[], p_user_hash text DEFAULT NULL::text) RETURNS TABLE(content_id text, emoji text, count integer, is_active boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT
    esc.content_id,
    esc.emoji,
    esc.count,
    CASE WHEN p_user_hash IS NOT NULL
         THEN COALESCE(ur.is_active, false)
         ELSE false
    END AS is_active
  FROM public.emoji_stats_cache esc
  LEFT JOIN public.user_reactions ur
    ON  ur.content_id = esc.content_id
    AND ur.emoji      = esc.emoji
    AND ur.user_hash  = p_user_hash
  WHERE esc.content_id = ANY (p_content_ids)
    AND esc.count > 0
  ORDER BY esc.content_id, esc.count DESC, esc.emoji;
$$;

CREATE FUNCTION public.get_diary_comments_for_viewer(p_content_ids text[], p_actor_hash text DEFAULT NULL::text) RETURNS TABLE(id uuid, content_id text, message text, emoji text, nickname text, created_at timestamp with time zone, status text, interaction_count integer, is_own boolean, has_reacted boolean)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $_$
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
$_$;

CREATE FUNCTION public.publish_owned_diary_comment(p_key text, p_content_id text, p_message text, p_emoji text, p_nickname text, p_email text, p_model text, p_review jsonb, p_owner_hash text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    SET "TimeZone" TO 'UTC'
    AS $_$
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
$_$;

CREATE FUNCTION public.rebuild_emoji_stats_cache() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  TRUNCATE public.emoji_stats_cache;
  INSERT INTO public.emoji_stats_cache (content_id, emoji, count, last_updated)
  SELECT
    content_id,
    emoji,
    COUNT(*) AS count,
    now()    AS last_updated
  FROM public.user_reactions
  WHERE is_active = true
  GROUP BY content_id, emoji
  HAVING COUNT(*) > 0;
END;
$$;

CREATE FUNCTION public.reserve_diary_comment_action(p_key text, p_action text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    SET "TimeZone" TO 'UTC'
    AS $_$
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
$_$;

CREATE FUNCTION public.reserve_diary_comment_reaction(p_key text) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
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
$_$;

CREATE FUNCTION public.save_owned_diary_comment(p_content_id text, p_message text, p_emoji text, p_nickname text, p_email text, p_status text, p_model text, p_review jsonb, p_owner_hash text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
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
$_$;

CREATE FUNCTION public.toggle_diary_comment_reaction(p_comment_id uuid, p_actor_hash text) RETURNS TABLE(interaction_count integer, is_active boolean)
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
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
$_$;

CREATE FUNCTION public.toggle_emoji_reaction_hmac(p_content_id text, p_emoji text, p_user_hash text, p_ip_hash text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    SET "TimeZone" TO 'UTC'
    AS $_$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_hits integer;
  v_active boolean;
  v_count integer;
begin
  if p_content_id is null or p_content_id !~ '^emoji-reactions-' or char_length(p_content_id)>256 or p_content_id ~ '[[:cntrl:]]'
    or p_emoji is null or p_emoji not in ('👍','👎','😄','😕','🎉','❤️','🚀','👀')
    or p_user_hash is null or char_length(p_user_hash) not between 1 and 128 or p_user_hash ~ '[[:cntrl:]]'
    or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid emoji request';
  end if;

  delete from public.rate_limit_records where expires_at < now();
  insert into public.rate_limit_records as limits(key_type,key_value,request_count,window_start,expires_at)
    values('ip_hmac',p_ip_hash,1,v_window,v_window+interval '1 minute')
    on conflict on constraint rate_limit_records_key do update
      set request_count=limits.request_count+1 where limits.request_count<60
    returning request_count into v_hits;
  if v_hits is null then
    return jsonb_build_object(
      'allowed',false,'reason','ip_minute','limit',60,'used',60,
      'retry_after',greatest(1,ceil(extract(epoch from v_window+interval '1 minute'-now()))::integer),
      'resets_at',v_window+interval '1 minute'
    );
  end if;

  insert into public.user_reactions as reactions(content_id,emoji,user_hash,is_active)
    values(p_content_id,p_emoji,p_user_hash,true)
    on conflict on constraint user_reactions_content_id_emoji_user_hash_key
    do update set is_active=not reactions.is_active,updated_at=now()
    returning is_active into v_active;
  -- Existing triggers maintain the aggregate cache and remove zero-count rows.
  select coalesce((select count from public.emoji_stats_cache
    where content_id=p_content_id and emoji=p_emoji),0) into v_count;
  return jsonb_build_object('allowed',true,'emoji',p_emoji,'new_count',v_count,'is_active',v_active);
end;
$_$;

CREATE TABLE diary_private.diary_comment_details (
    comment_id uuid NOT NULL,
    email text,
    moderation_model text NOT NULL,
    moderation jsonb NOT NULL,
    owner_hash text,
    CONSTRAINT diary_comment_details_email_check CHECK ((char_length(email) <= 254)),
    CONSTRAINT diary_comment_details_owner_hash_check CHECK ((owner_hash ~ '^[a-f0-9]{64}$'::text))
);

CREATE TABLE diary_private.diary_comment_rate_limits (
    key text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    hits integer DEFAULT 0 NOT NULL
);

CREATE TABLE diary_private.diary_comment_reactions (
    comment_id uuid NOT NULL,
    actor_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT diary_comment_reactions_actor_hash_check CHECK ((actor_hash ~ '^[a-f0-9]{64}$'::text))
);

CREATE TABLE public.diary_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content_id text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    emoji text,
    nickname text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    interaction_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT diary_comments_check CHECK (((message <> ''::text) OR (emoji IS NOT NULL))),
    CONSTRAINT diary_comments_content_id_check CHECK ((content_id ~ '^emoji-reactions-([0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}|footprint-[A-Za-z0-9][A-Za-z0-9_-]{0,179})$'::text)),
    CONSTRAINT diary_comments_emoji_check CHECK ((emoji = ANY (ARRAY['👍'::text, '👎'::text, '😄'::text, '😕'::text, '🎉'::text, '❤️'::text, '🚀'::text, '👀'::text]))),
    CONSTRAINT diary_comments_interaction_count_check CHECK ((interaction_count >= 0)),
    CONSTRAINT diary_comments_message_check CHECK ((char_length(message) <= 320)),
    CONSTRAINT diary_comments_nickname_check CHECK ((char_length(nickname) <= 160)),
    CONSTRAINT diary_comments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

CREATE TABLE public.emoji_stats_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content_id text NOT NULL,
    emoji text NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    last_updated timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.rate_limit_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key_type text NOT NULL,
    key_value text NOT NULL,
    request_count integer DEFAULT 1 NOT NULL,
    window_start timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT rate_limit_records_hmac_only CHECK (((key_type = 'ip_hmac'::text) AND (key_value ~ '^[a-f0-9]{64}$'::text)))
);

CREATE TABLE public.user_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content_id text NOT NULL,
    emoji text NOT NULL,
    user_hash text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY diary_private.diary_comment_details
    ADD CONSTRAINT diary_comment_details_pkey PRIMARY KEY (comment_id);

ALTER TABLE ONLY diary_private.diary_comment_rate_limits
    ADD CONSTRAINT diary_comment_rate_limits_pkey PRIMARY KEY (key, window_start);

ALTER TABLE ONLY diary_private.diary_comment_reactions
    ADD CONSTRAINT diary_comment_reactions_pkey PRIMARY KEY (comment_id, actor_hash);

ALTER TABLE ONLY public.diary_comments
    ADD CONSTRAINT diary_comments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.emoji_stats_cache
    ADD CONSTRAINT emoji_stats_cache_content_id_emoji_key UNIQUE (content_id, emoji);

ALTER TABLE ONLY public.emoji_stats_cache
    ADD CONSTRAINT emoji_stats_cache_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.rate_limit_records
    ADD CONSTRAINT rate_limit_records_key UNIQUE (key_type, key_value, window_start);

ALTER TABLE ONLY public.rate_limit_records
    ADD CONSTRAINT rate_limit_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_reactions
    ADD CONSTRAINT user_reactions_content_id_emoji_user_hash_key UNIQUE (content_id, emoji, user_hash);

ALTER TABLE ONLY public.user_reactions
    ADD CONSTRAINT user_reactions_pkey PRIMARY KEY (id);

CREATE INDEX diary_comment_details_owner ON diary_private.diary_comment_details USING btree (owner_hash, comment_id) WHERE (owner_hash IS NOT NULL);

CREATE INDEX diary_comments_content_created ON public.diary_comments USING btree (content_id, created_at DESC, id DESC) WHERE (status = 'approved'::text);

CREATE INDEX idx_emoji_stats_content_id ON public.emoji_stats_cache USING btree (content_id);

CREATE INDEX idx_emoji_stats_content_id_count_desc ON public.emoji_stats_cache USING btree (content_id, count DESC);

CREATE INDEX idx_rate_limit_expires ON public.rate_limit_records USING btree (expires_at);

CREATE INDEX idx_rate_limit_key ON public.rate_limit_records USING btree (key_type, key_value);

CREATE INDEX idx_user_reactions_active_partial ON public.user_reactions USING btree (content_id, emoji) WHERE (is_active = true);

CREATE INDEX idx_user_reactions_content_id ON public.user_reactions USING btree (content_id);

CREATE INDEX idx_user_reactions_emoji ON public.user_reactions USING btree (emoji);

CREATE INDEX idx_user_reactions_user_hash ON public.user_reactions USING btree (user_hash);

CREATE TRIGGER trg_user_reactions_set_updated_at BEFORE UPDATE ON public.user_reactions FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_user_reactions_sync_stats AFTER INSERT OR DELETE OR UPDATE ON public.user_reactions FOR EACH ROW EXECUTE FUNCTION public.fn_trg_sync_emoji_stats();

ALTER TABLE ONLY diary_private.diary_comment_details
    ADD CONSTRAINT diary_comment_details_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.diary_comments(id) ON DELETE CASCADE;

ALTER TABLE ONLY diary_private.diary_comment_reactions
    ADD CONSTRAINT diary_comment_reactions_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.diary_comments(id) ON DELETE CASCADE;

ALTER TABLE diary_private.diary_comment_details ENABLE ROW LEVEL SECURITY;

ALTER TABLE diary_private.diary_comment_rate_limits ENABLE ROW LEVEL SECURITY;

ALTER TABLE diary_private.diary_comment_reactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.diary_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY diary_comments_approved_read ON public.diary_comments FOR SELECT TO anon, authenticated USING ((status = 'approved'::text));

ALTER TABLE public.emoji_stats_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.rate_limit_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_reactions ENABLE ROW LEVEL SECURITY;

-- Explicit grants override Supabase's automatic public-schema privileges.
revoke all on schema diary_private from public,anon,authenticated;
grant usage on schema diary_private to service_role;
grant usage on schema public to anon,authenticated,service_role;
revoke all on public.user_reactions,public.emoji_stats_cache,public.rate_limit_records,public.diary_comments,
  diary_private.diary_comment_details,diary_private.diary_comment_rate_limits,diary_private.diary_comment_reactions
  from public,anon,authenticated;
grant select,insert,update on public.user_reactions to service_role;
grant select,insert,update,delete,truncate on public.emoji_stats_cache to service_role;
grant select,insert,update,delete on public.rate_limit_records to service_role;
grant all on public.diary_comments,diary_private.diary_comment_details,diary_private.diary_comment_rate_limits,diary_private.diary_comment_reactions to service_role;
grant select(id,content_id,message,emoji,nickname,created_at,status,interaction_count) on public.diary_comments to anon,authenticated;
revoke all on function diary_private.diary_comment_rate_result(text,integer,integer,timestamp with time zone) from public,anon,authenticated;
grant execute on function diary_private.diary_comment_rate_result(text,integer,integer,timestamp with time zone) to service_role;
revoke all on function public.cleanup_expired_rate_limits() from public,anon,authenticated;
grant execute on function public.cleanup_expired_rate_limits() to service_role;
revoke all on function public.delete_owned_diary_comment(uuid,text) from public,anon,authenticated;
grant execute on function public.delete_owned_diary_comment(uuid,text) to service_role;
revoke all on function public.fn_set_updated_at() from public,anon,authenticated;
grant execute on function public.fn_set_updated_at() to service_role;
revoke all on function public.fn_trg_sync_emoji_stats() from public,anon,authenticated;
grant execute on function public.fn_trg_sync_emoji_stats() to service_role;
revoke all on function public.fn_update_emoji_stats_cache(text,text) from public,anon,authenticated;
grant execute on function public.fn_update_emoji_stats_cache(text,text) to service_role;
revoke all on function public.get_content_reactions(text,text) from public,anon,authenticated;
grant execute on function public.get_content_reactions(text,text) to service_role;
revoke all on function public.get_content_reactions_many(text[],text) from public,anon,authenticated;
grant execute on function public.get_content_reactions_many(text[],text) to service_role;
revoke all on function public.get_diary_comments_for_viewer(text[],text) from public,anon,authenticated;
grant execute on function public.get_diary_comments_for_viewer(text[],text) to service_role;
revoke all on function public.publish_owned_diary_comment(text,text,text,text,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.publish_owned_diary_comment(text,text,text,text,text,text,text,jsonb,text) to service_role;
revoke all on function public.rebuild_emoji_stats_cache() from public,anon,authenticated;
grant execute on function public.rebuild_emoji_stats_cache() to service_role;
revoke all on function public.reserve_diary_comment_action(text,text) from public,anon,authenticated;
grant execute on function public.reserve_diary_comment_action(text,text) to service_role;
revoke all on function public.reserve_diary_comment_reaction(text) from public,anon,authenticated;
grant execute on function public.reserve_diary_comment_reaction(text) to service_role;
revoke all on function public.save_owned_diary_comment(text,text,text,text,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_owned_diary_comment(text,text,text,text,text,text,text,jsonb,text) to service_role;
revoke all on function public.toggle_diary_comment_reaction(uuid,text) from public,anon,authenticated;
grant execute on function public.toggle_diary_comment_reaction(uuid,text) to service_role;
revoke all on function public.toggle_emoji_reaction_hmac(text,text,text,text) from public,anon,authenticated;
grant execute on function public.toggle_emoji_reaction_hmac(text,text,text,text) to service_role;
grant execute on function public.get_content_reactions(text,text),public.get_content_reactions_many(text[],text) to anon,authenticated;
commit;
