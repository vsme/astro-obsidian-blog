select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'args',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'definer',p.prosecdef,'config',p.proconfig,'body',regexp_replace(regexp_replace(p.prosrc,'(^|\n)[[:space:]]*--[^\n]*','','g'),'[[:space:]]+',' ','g')) order by n.nspname,p.proname)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','diary_private') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')),
 'columns',(select jsonb_agg(jsonb_build_object('table',table_schema||'.'||table_name,'column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) order by table_schema,table_name,ordinal_position)
   from information_schema.columns where table_schema in ('public','diary_private')),
 'constraints',(select jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname)
   from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','diary_private')),
 'indexes',(select jsonb_agg(indexdef order by schemaname,tablename,indexname) from pg_indexes where schemaname in ('public','diary_private')),
 'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by n.nspname,c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','diary_private')),
 'rls',(select jsonb_agg(jsonb_build_object('table',n.nspname||'.'||c.relname,'enabled',c.relrowsecurity) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','diary_private')),
 'policies',(select jsonb_agg(jsonb_build_object('table',schemaname||'.'||tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) order by schemaname,tablename,policyname) from pg_policies where schemaname in ('public','diary_private'))
);
