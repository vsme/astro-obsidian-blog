-- Assertions shared by the upgraded database and clean initialize.sql database.
do $$ declare f record; begin
  for f in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','diary_private')
      and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
  loop
    assert has_function_privilege('service_role',f.oid,'EXECUTE'), 'service_role cannot execute '||f.proname;
    if f.proname in ('get_content_reactions','get_content_reactions_many') then
      assert f.prosecdef, 'public reader requires controlled RLS bypass';
      assert has_function_privilege('anon',f.oid,'EXECUTE');
      assert has_function_privilege('authenticated',f.oid,'EXECUTE');
    else
      assert not f.prosecdef, 'unnecessary SECURITY DEFINER: '||f.proname;
      assert not has_function_privilege('anon',f.oid,'EXECUTE'), 'anon can execute '||f.proname;
      assert not has_function_privilege('authenticated',f.oid,'EXECUTE'), 'authenticated can execute '||f.proname;
    end if;
    assert f.proconfig @> array['search_path=""'], 'search_path not empty: '||f.proname;
  end loop;
  assert to_regprocedure('public.toggle_emoji_reaction(text,text,text)') is null;
  assert to_regprocedure('public.enforce_rate_limit(text,text,integer)') is null;
  assert to_regprocedure('public.enforce_rate_limit(text,text,integer,text)') is null;
  assert to_regprocedure('public.get_request_ip()') is null;
  assert to_regprocedure('public.save_diary_comment(text,text,text,text,text,text,text,jsonb)') is null;
  assert to_regprocedure('public.reserve_diary_comment(text)') is null;
  assert to_regprocedure('public.get_diary_comments_many(text[])') is null;
  assert to_regprocedure('public.get_diary_comment_reaction_state(text[],text)') is null;
  assert to_regprocedure('public.get_owned_diary_comments(text[],text)') is null;
  assert to_regprocedure('public.get_diary_comments_with_reactions_many(text[])') is null;
end $$;
-- Denial must be enforced, rather than just inferred from catalog flags.
set role anon;
do $$ begin
  begin perform public.rebuild_emoji_stats_cache(); raise exception 'anonymous rebuild allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.cleanup_expired_rate_limits(); raise exception 'anonymous cleanup allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.fn_update_emoji_stats_cache('emoji-reactions-footprint-fixture','👍'); raise exception 'anonymous mutation allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.toggle_emoji_reaction_hmac('emoji-reactions-fixture','👍','viewer',repeat('f',64)); raise exception 'anonymous HMAC write allowed';
  exception when insufficient_privilege then null; end;
  begin perform * from diary_private.diary_comment_details; raise exception 'private details exposed';
  exception when insufficient_privilege then null; end;
  assert not exists(select 1 from public.diary_comments where status<>'approved');
  perform * from public.get_content_reactions_many(array['emoji-reactions-footprint-fixture'],'historical-viewer');
end $$;
reset role;
set role service_role;
do $$ declare r jsonb; comment_id uuid; invalid_id text; begin
  r:=public.toggle_emoji_reaction_hmac('emoji-reactions-test-cleanup','❤️','viewer',repeat('f',64));
  assert (r->>'allowed')::boolean and (r->>'new_count')::integer=1;
  r:=public.toggle_emoji_reaction_hmac('emoji-reactions-test-cleanup','❤️','viewer',repeat('f',64));
  assert not (r->>'is_active')::boolean and (r->>'new_count')::integer=0;
  perform public.rebuild_emoji_stats_cache();
  perform public.cleanup_expired_rate_limits();
  r:=public.reserve_diary_comment_action(repeat('d',64),'submit');
  assert (r->>'allowed')::boolean;
  r:=public.publish_owned_diary_comment(repeat('d',64),'emoji-reactions-2026-10-10-14-00','fresh fixture',null,'test','private@example.test','test','[]',repeat('d',64));
  assert (r->>'allowed')::boolean;
  select id into comment_id from public.diary_comments where message='fresh fixture';
  assert not public.delete_owned_diary_comment(comment_id,repeat('e',64));
  assert (select interaction_count from public.toggle_diary_comment_reaction(comment_id,repeat('e',64)))=1;
  assert (select interaction_count from public.toggle_diary_comment_reaction(comment_id,repeat('e',64)))=0;
  assert public.delete_owned_diary_comment(comment_id,repeat('d',64));
  r:=public.publish_owned_diary_comment(repeat('d',64),'emoji-reactions-footprint-2026-01-01-example','footprint fixture',null,null,null,'test','[]',repeat('d',64));
  assert (r->>'allowed')::boolean;
  select id into comment_id from public.diary_comments where message='footprint fixture';
  assert (select count(*) from public.get_diary_comments_for_viewer(array['emoji-reactions-footprint-2026-01-01-example'],repeat('d',64)) where is_own)=1;
  assert not public.delete_owned_diary_comment(comment_id,repeat('e',64));
  assert (select interaction_count from public.toggle_diary_comment_reaction(comment_id,repeat('e',64)))=1;
  assert not public.delete_owned_diary_comment(comment_id,repeat('d',64));
  assert (select interaction_count from public.toggle_diary_comment_reaction(comment_id,repeat('e',64)))=0;
  assert public.delete_owned_diary_comment(comment_id,repeat('d',64));
  foreach invalid_id in array array['emoji-reactions-footprint-','emoji-reactions-footprint-'||repeat('a',181),'emoji-reactions-footprint-../private'] loop
    begin
      insert into public.diary_comments(content_id,message,status) values(invalid_id,'invalid fixture','approved');
      raise exception 'invalid footprint ID accepted';
    exception when check_violation then null; end;
  end loop;
end $$;
reset role;
