#!/usr/bin/env bash
# Requires PostgreSQL client/server binaries in PATH; never connects to a real DB.
set -euo pipefail
task_repo_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$task_repo_root"
for task_binary in initdb pg_ctl psql pg_dump node; do
  command -v "$task_binary" >/dev/null || { echo "Missing test dependency: $task_binary" >&2; exit 1; }
done
task_pg_root=$(mktemp -d "${TMPDIR:-/tmp}/astro-paper-schema.XXXXXX")
trap 'pg_ctl -D "$task_pg_root/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$task_pg_root"' EXIT
mkdir "$task_pg_root/socket"
initdb -D "$task_pg_root/db" -U postgres --no-locale -E UTF8 -A trust >/dev/null
pg_ctl -D "$task_pg_root/db" -l "$task_pg_root/log" -o "-k $task_pg_root/socket -p 55441 -c listen_addresses=''" -w start >/dev/null
task_psql=(-X -v ON_ERROR_STOP=1 -h "$task_pg_root/socket" -p 55441 -U postgres)
psql "${task_psql[@]}" -d postgres <<'SQL' >/dev/null
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create database upgraded;
create database fresh;
SQL
for task_database in upgraded fresh; do
 psql "${task_psql[@]}" -d "$task_database" <<'SQL' >/dev/null
-- Emulate Supabase's grants to ensure REVOKE PUBLIC alone cannot pass these tests.
alter default privileges in schema public grant execute on functions to anon,authenticated;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
SQL
done
for task_sql in supabase/legacy/supabase-schema.sql supabase/legacy/diary-comments.sql supabase/legacy/diary-comment-ownership.sql supabase/legacy/diary-comment-reactions.sql supabase/migrations/20261009235246_diary_comment_rate_limits.sql supabase/migrations/20261010015855_emoji_rate_limit_hmac.sql; do
 psql "${task_psql[@]}" -d upgraded -f "$task_sql" >/dev/null
done
psql "${task_psql[@]}" -d upgraded -f tests/sql/interaction-schema-fixtures.sql >/dev/null
psql "${task_psql[@]}" -d upgraded -f supabase/migrations/20261010022122_interaction_schema_cleanup.sql >/dev/null
psql "${task_psql[@]}" -d upgraded <<'SQL' >/dev/null
do $$ declare baseline record; actual jsonb; begin
 for baseline in select * from schema_test.viewer_results loop
  select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc),'[]'::jsonb) into actual
  from public.get_diary_comments_for_viewer(array['emoji-reactions-2026-10-10-12-00'],baseline.actor) v;
  assert actual=baseline.rows, 'viewer merge changed public/owned/pending/reaction state';
 end loop;
 assert (select count(*) from public.diary_comments)=47, 'comment data lost';
 assert (select count(*) from diary_private.diary_comment_details)=47, 'private data lost';
 assert (select count(*) from diary_private.diary_comment_reactions)=1, 'reaction data lost';
 assert (select count(*) from public.user_reactions)=1, 'emoji data lost';
end $$;
SQL
for task_sql in supabase/migrations/*.sql; do
 if [[ "$task_sql" > "supabase/migrations/20261010022122_interaction_schema_cleanup.sql" ]]; then
  psql "${task_psql[@]}" -d upgraded -f "$task_sql" >/dev/null
 fi
done
psql "${task_psql[@]}" -d upgraded -f tests/sql/interaction-schema-checks.sql >/dev/null
psql "${task_psql[@]}" -d upgraded -f supabase/migrations/20261010022122_interaction_schema_cleanup.sql >/dev/null
# Export the final schema without fixture data, ACL defaults, or unrelated schemas.
pg_dump -h "$task_pg_root/socket" -p 55441 -U postgres -d upgraded --schema-only --no-owner --no-privileges --no-comments --schema=public --schema=diary_private > "$task_pg_root/schema.sql"
psql "${task_psql[@]}" -d upgraded -At -c "select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','diary_private') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') order by n.nspname,p.proname;" > "$task_pg_root/functions.txt"
if [[ "${1:-}" == "--write-init" ]]; then
 node --input-type=module - "$task_pg_root/schema.sql" "$task_pg_root/functions.txt" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
let schema = readFileSync(process.argv[2], 'utf8').split('\n').filter(line =>
 !line.startsWith('--') && !line.startsWith('\\') && !line.startsWith('SET ') &&
 !line.startsWith('SELECT pg_catalog.set_config') && line !== 'CREATE SCHEMA public;'
).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const functions = readFileSync(process.argv[3], 'utf8').trim().split('\n')
 .map(signature => signature.startsWith('diary_private.') ? signature : 'public.' + signature);
const header = `-- Current interaction schema for EMPTY projects only; not an online upgrade.
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
`;
const grants = `
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
` + functions.map(signature =>
 `revoke all on function ${signature} from public,anon,authenticated;\ngrant execute on function ${signature} to service_role;`
).join('\n') + `
grant execute on function public.get_content_reactions(text,text),public.get_content_reactions_many(text[],text) to anon,authenticated;
commit;
`;
writeFileSync('supabase/initialize.sql', header + '\n' + schema + '\n' + grants);
JS
fi
psql "${task_psql[@]}" -d fresh -f supabase/initialize.sql >/dev/null
psql "${task_psql[@]}" -d fresh -f tests/sql/interaction-schema-checks.sql >/dev/null
# A full initialization must refuse an existing project before touching its data.
if psql "${task_psql[@]}" -d upgraded -f supabase/initialize.sql > "$task_pg_root/guard.txt" 2>&1; then
 echo 'Initialization unexpectedly accepted an existing project' >&2; exit 1
fi
rg -q 'Interaction schema already exists' "$task_pg_root/guard.txt"
# Compare schema definitions after upgrade and clean initialization; ignore owners/OIDs.
for task_database in upgraded fresh; do
 psql "${task_psql[@]}" -d "$task_database" -At -f tests/sql/interaction-schema-catalog.sql > "$task_pg_root/$task_database.json"
done
cmp "$task_pg_root/upgraded.json" "$task_pg_root/fresh.json"
printf '%s\n' 'Schema checks passed: role denial, service writes, list equivalence, historical data, retired functions, repeat upgrade, clean initialization, existing-project guard, and schema equivalence.'
