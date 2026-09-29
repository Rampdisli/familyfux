-- Checks for supabase/migrations/20260929160000_child_logins.sql.
--
-- Run against a local database with all migrations applied (never production):
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/child_logins_test.sql
-- Everything runs in one transaction that is rolled back at the end.
-- Prints "child_logins_test: ok" on success, stops at the first failed check.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'parent@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'Mia@Test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'other@test.local');

insert into public.families (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Test'),
  ('10000000-0000-0000-0000-000000000002', 'Other');
insert into public.family_members (id, family_id, user_id, name, emoji, color, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Mama', '🌻', 'lemon', 'parent'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', null, 'Mia', '🦊', 'mint', 'child'),
  ('20000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', null, 'Leo', '🐻', 'sky', 'child'),
  ('20000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'Other', '🐼', 'rose', 'parent');

-- A one-off task in the pool and a repeatable one.
insert into public.tasks (id, user_id, family_id, title, reward, schedule, start_date)
values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'Tisch decken', 2, 'once', current_date);
insert into public.tasks (id, user_id, family_id, title, reward, is_repeatable)
values ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'Zähne putzen', 1, true);

create function pg_temp.expect_error(sql text, pattern text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm not like '%' || pattern || '%' then
      raise exception 'expected an error matching "%", got: %', pattern, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected an error matching "%" from: %', pattern, sql;
end;
$$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'check failed: %', what;
  end if;
end;
$$;

grant execute on function pg_temp.expect_error(text, text), pg_temp.check(boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Mama links Mia's account
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

select pg_temp.expect_error($$select public.link_member_account('20000000-0000-0000-0000-00000000000b', 'nobody@test.local')$$, 'kein Konto');
select pg_temp.expect_error($$select public.link_member_account('20000000-0000-0000-0000-00000000000b', 'other@test.local')$$, 'schon zu einer Familie');
select pg_temp.expect_error($$select public.link_member_account('20000000-0000-0000-0000-00000000000d', 'mia@test.local')$$, 'Nur Eltern');
select public.link_member_account('20000000-0000-0000-0000-00000000000b', ' mia@test.local ');
select pg_temp.check((select user_id from public.family_members where name = 'Mia') = '00000000-0000-0000-0000-00000000000b', 'linked, email case-insensitive');
select pg_temp.expect_error($$select public.link_member_account('20000000-0000-0000-0000-00000000000b', 'mia@test.local')$$, 'schon mit einem Konto');
select pg_temp.check((select count(*) from public.family_member_accounts()) = 2, 'parent sees the linked emails of the family');
select pg_temp.expect_error($$update public.family_members set user_id = null where name = 'Mia'$$, 'permission denied');
select pg_temp.check(not public.unlink_member_account('20000000-0000-0000-0000-00000000000a'), 'parents cannot unlink themselves');

-- Parents still act for everybody.
insert into public.task_claims (occurrence_id, member_id)
select id, '20000000-0000-0000-0000-00000000000c' from public.task_occurrences;
insert into public.task_completions (task_id, member_id) values ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000c');

-- ---------------------------------------------------------------------------
-- As Mia (kid login): only herself
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

select pg_temp.check((select count(*) from public.family_member_accounts()) = 0, 'kids see no emails');
select pg_temp.expect_error($$select public.link_member_account('20000000-0000-0000-0000-00000000000c', 'other@test.local')$$, 'Nur Eltern');

insert into public.task_claims (occurrence_id, member_id)
select id, '20000000-0000-0000-0000-00000000000b' from public.task_occurrences;
select pg_temp.expect_error($$insert into public.task_claims (occurrence_id, member_id) select id, '20000000-0000-0000-0000-00000000000a' from public.task_occurrences$$, 'row-level security');

-- Leo's part stays as it is; Mia ticks off her own.
update public.task_claims set is_done = true where member_id = '20000000-0000-0000-0000-00000000000c';
update public.task_claims set is_done = true where member_id = '20000000-0000-0000-0000-00000000000b';
select pg_temp.check((select is_done from public.task_claims where member_id = '20000000-0000-0000-0000-00000000000b'), 'Mia ticks off her part');
select pg_temp.check(not (select is_done from public.task_claims where member_id = '20000000-0000-0000-0000-00000000000c'), 'but not Leo''s');
delete from public.task_claims where member_id = '20000000-0000-0000-0000-00000000000c';
select pg_temp.check((select count(*) from public.task_claims where member_id = '20000000-0000-0000-0000-00000000000c') = 1, 'nor steps him out');

insert into public.task_completions (task_id, member_id) values ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$insert into public.task_completions (task_id, member_id) values ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000c')$$, 'row-level security');
delete from public.task_completions where member_id = '20000000-0000-0000-0000-00000000000c';
select pg_temp.check((select count(*) from public.task_completions where member_id = '20000000-0000-0000-0000-00000000000c') = 1, 'kids cannot undo others');
delete from public.task_completions where member_id = '20000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from public.task_completions where member_id = '20000000-0000-0000-0000-00000000000b') = 0, 'kids undo their own');

-- ---------------------------------------------------------------------------
-- Mama unlinks Mia again
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select pg_temp.check(public.unlink_member_account('20000000-0000-0000-0000-00000000000b'), 'parent unlinks');
select pg_temp.check((select user_id from public.family_members where name = 'Mia') is null, 'unlinked');

reset role;
select 'child_logins_test: ok';
rollback;
