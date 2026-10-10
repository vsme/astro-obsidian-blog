-- Run in the isolated upgraded/fresh databases, never against production data.
set role service_role;
do $$ declare task_comment_id uuid; r record; begin
  perform public.publish_owned_diary_comment(repeat('9',64),'emoji-reactions-2026-10-10-18-00','author fixture',null,null,null,'test','[]',repeat('9',64));
  select c.id into task_comment_id from public.diary_comments c where c.message='author fixture';
  select * into r from public.toggle_diary_comment_reaction(task_comment_id,repeat('9',64));
  assert r.requires_delete_confirmation and r.author_participating and r.interaction_count=0;
  assert (select count(*) from diary_private.diary_comment_reactions x where x.comment_id=task_comment_id)=0;
  select * into r from public.toggle_diary_comment_reaction(task_comment_id,repeat('8',64));
  assert not r.requires_delete_confirmation and r.author_participating and r.interaction_count=1;
  -- Even an already-open/stale delete confirmation must not delete others' votes.
  assert not public.delete_owned_diary_comment(task_comment_id,repeat('9',64));
  select * into r from public.toggle_diary_comment_reaction(task_comment_id,repeat('9',64));
  assert not r.requires_delete_confirmation and not r.is_active and not r.author_participating and r.interaction_count=1;
  assert (select count(*) from diary_private.diary_comment_reactions x where x.comment_id=task_comment_id)=1;
  assert (select author_participating from public.get_diary_comments_for_viewer(array['emoji-reactions-2026-10-10-18-00'],null))=false;
  assert (select is_own and not has_reacted from public.get_diary_comments_for_viewer(array['emoji-reactions-2026-10-10-18-00'],repeat('9',64)));
  assert not public.delete_owned_diary_comment(task_comment_id,repeat('9',64));
  select * into r from public.toggle_diary_comment_reaction(task_comment_id,repeat('9',64));
  assert r.is_active and r.author_participating and r.interaction_count=1;
  -- Restore/cancel changes only the author's implicit participation, never votes.
  select * into r from public.toggle_diary_comment_reaction(task_comment_id,repeat('9',64));
  select * into r from public.toggle_diary_comment_reaction(task_comment_id,repeat('8',64));
  assert not r.author_participating and not r.is_active and r.interaction_count=0;
  assert exists(select 1 from public.diary_comments c where c.id=task_comment_id);
  assert not public.delete_owned_diary_comment(task_comment_id,repeat('9',64));
  select * into r from public.toggle_diary_comment_reaction(task_comment_id,repeat('9',64));
  assert r.author_participating and r.is_active and not r.requires_delete_confirmation and r.interaction_count=0;
  select * into r from public.toggle_diary_comment_reaction(task_comment_id,repeat('9',64));
  assert r.requires_delete_confirmation;
  assert not public.delete_owned_diary_comment(task_comment_id,repeat('8',64));
  assert public.delete_owned_diary_comment(task_comment_id,repeat('9',64));
end $$;
reset role;
