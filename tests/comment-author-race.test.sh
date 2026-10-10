#!/usr/bin/env bash
# Called only by the isolated schema runner; socket and DB are created by it.
set -euo pipefail
task_socket=$1
task_database=$2
task_psql=(-X -v ON_ERROR_STOP=1 -h "$task_socket" -p 55441 -U postgres -d "$task_database")
for task_case in participation deletion; do
 psql "${task_psql[@]}" -c "set role service_role; select public.publish_owned_diary_comment(repeat('7',64),'emoji-reactions-2026-10-10-19-00','race $task_case',null,null,null,'test','[]',repeat('7',64));" >/dev/null
 task_race_id=$(psql "${task_psql[@]}" -At -c "select id from public.diary_comments where message='race $task_case';")
 # Make the other participant's write commit while the author's request waits.
 psql "${task_psql[@]}" -v fixture_id="$task_race_id" <<'SQL' >/dev/null &
begin;
set local role service_role;
select * from public.toggle_diary_comment_reaction(:'fixture_id'::uuid,repeat('6',64));
select pg_advisory_xact_lock(684219);
select pg_sleep(0.5);
commit;
SQL
 task_peer_pid=$!
 task_ready=false
 for task_attempt in {1..40}; do
  if [[ $(psql "${task_psql[@]}" -At -c "select exists(select 1 from pg_locks where locktype='advisory' and objid=684219 and granted);") == t ]]; then
   task_ready=true; break
  fi
  sleep 0.02
 done
 [[ "$task_ready" == true ]] || { wait "$task_peer_pid"; echo 'Race fixture lock was not observed' >&2; exit 1; }
 if [[ "$task_case" == participation ]]; then
  task_result=$(psql "${task_psql[@]}" -At -c "set role service_role; select requires_delete_confirmation::text||':'||author_participating::text||':'||interaction_count::text from public.toggle_diary_comment_reaction('$task_race_id',repeat('7',64));" | tail -1)
  [[ "$task_result" == false:false:1 ]]
 else
  task_result=$(psql "${task_psql[@]}" -At -c "set role service_role; select public.delete_owned_diary_comment('$task_race_id',repeat('7',64));" | tail -1)
  [[ "$task_result" == f ]]
 fi
 wait "$task_peer_pid"
 psql "${task_psql[@]}" -v fixture_id="$task_race_id" <<'SQL' >/dev/null
select 1/(case when exists(select 1 from public.diary_comments where id=:'fixture_id'::uuid)
 and (select count(*) from diary_private.diary_comment_reactions where comment_id=:'fixture_id'::uuid)=1 then 1 else 0 end);
SQL
done
printf '%s\n' 'Author race checks passed: waits for current state; no stale delete or loss of peer reactions.'
