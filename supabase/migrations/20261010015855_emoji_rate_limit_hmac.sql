-- Apply after supabase-schema.sql. Deploy diary-comment and the new frontend
-- together with this upgrade: the old browser-write RPC is intentionally closed.
begin;
lock table public.rate_limit_records in access exclusive mode;

-- Retire plaintext-IP buckets. Keep valid new buckets when this file is reapplied.
-- This resets only legacy limiter counters, never user reactions or their counts.
delete from public.rate_limit_records
where key_type <> 'ip_hmac' or key_value !~ '^[a-f0-9]{64}$';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.rate_limit_records'::regclass and conname='rate_limit_records_hmac_only') then
    alter table public.rate_limit_records add constraint rate_limit_records_hmac_only
      check (key_type = 'ip_hmac' and key_value ~ '^[a-f0-9]{64}$');
  end if;
end $$;

create or replace function public.toggle_emoji_reaction_hmac(
  p_content_id text, p_emoji text, p_user_hash text, p_ip_hash text
) returns jsonb
language plpgsql security invoker set search_path = '' set timezone = 'UTC' as $$
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
$$;

grant select,insert,update on public.user_reactions to service_role;
grant select,insert,update,delete on public.rate_limit_records to service_role;
grant select on public.emoji_stats_cache to service_role;
revoke all on public.rate_limit_records from public,anon,authenticated;
revoke all on function public.toggle_emoji_reaction_hmac(text,text,text,text) from public,anon,authenticated;
grant execute on function public.toggle_emoji_reaction_hmac(text,text,text,text) to service_role;
revoke execute on function public.toggle_emoji_reaction(text,text,text) from public,anon,authenticated,service_role;

-- Some online schemas contain both the three- and four-argument legacy helpers.
-- Explicit role grants must be revoked too; revoking PUBLIC alone is insufficient.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='enforce_rate_limit'
  loop
    execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
  end loop;
end $$;
comment on column public.rate_limit_records.key_value is 'Server-generated IP HMAC-SHA256 only; raw IP addresses are rejected.';
commit;
