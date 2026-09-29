-- Checks for supabase/migrations/20260929150000_rewards.sql and 20260930090000_parents_redeem_rewards.sql.
--
-- Run against a local database with all migrations applied (never production):
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rewards_test.sql
-- Everything runs in one transaction that is rolled back at the end.
-- Prints "rewards_test: ok" on success, stops at the first failed check.

begin;

-- Two accounts: a parent and a kid with their own login, plus a kid without one.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'parent@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'kid@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'stranger@test.local');

insert into public.families (id, name) values ('10000000-0000-0000-0000-000000000001', 'Test');
insert into public.family_members (id, family_id, user_id, name, emoji, color, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Mama', '🌻', 'lemon', 'parent'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Mia', '🦊', 'mint', 'child'),
  ('20000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', null, 'Leo', '🐻', 'sky', 'child');

-- Mia earns 30 stars with a repeatable task (3 × 10).
insert into public.tasks (id, user_id, family_id, title, reward, is_repeatable)
values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'Zähne putzen', 10, true);
insert into public.task_completions (task_id, member_id)
select '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b' from generate_series(1, 3);
-- Mama earns 10.
insert into public.task_completions (task_id, member_id)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a');

insert into public.rewards (id, family_id, title, emoji, category, price, unit_amount, unit_label, max_quantity) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Tabletzeit', '📱', 'screen', 5, 5, 'Minuten', 6),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Serienfolge', '📺', 'screen', 10, 1, 'Folge', 3);
insert into public.rewards (id, family_id, title, emoji, category, price, description, is_active) values
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Kinobesuch', '🍿', 'fun', 200, 'mit Mama', false);

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
-- As Mia (kid login)
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

select pg_temp.check((select balance from public.member_balance where member_id = '20000000-0000-0000-0000-00000000000b') = 30, 'Mia starts with 30');

-- 3 × 5 Minuten = 15 ⭐
select pg_temp.check(public.redeem_reward('20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000001', 3) is not null, 'Mia buys tablet time');
select pg_temp.check((select label from public.reward_purchases) = 'Tabletzeit · 15 Minuten', 'label with amount');
select pg_temp.check((select cost from public.reward_purchases) = 15, 'cost copied');
select pg_temp.check((select balance from public.member_balance where member_id = '20000000-0000-0000-0000-00000000000b') = 15, 'balance drops right away');

-- Not enough stars, too many units, archived reward, someone else, direct writes.
select pg_temp.expect_error($$select public.redeem_reward('20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000002', 2)$$, 'Nicht genug Sterne');
select pg_temp.expect_error($$select public.redeem_reward('20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000001', 7)$$, 'Menge');
select pg_temp.expect_error($$select public.redeem_reward('20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000003', 1)$$, 'gibt es nicht mehr');
select pg_temp.expect_error($$select public.redeem_reward('20000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-000000000001', 1)$$, 'nur für dich selbst');
select pg_temp.expect_error($$select public.redeem_reward('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 1)$$, 'nur für dich selbst');
select pg_temp.expect_error($$insert into public.reward_purchases (family_id, member_id, title, emoji, color, quantity, label, cost) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b', 'x', 'x', 'peach', 1, 'x', 1)$$, 'permission denied');
select pg_temp.expect_error($$update public.reward_purchases set redeemed_at = now()$$, 'permission denied');
select pg_temp.expect_error($$insert into public.rewards (family_id, title, price) values ('10000000-0000-0000-0000-000000000001', 'Eis', 10)$$, 'row-level security');

-- 1 Folge for 10 ⭐ (singular), then only 5 ⭐ left.
select public.redeem_reward('20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000002', 1);
select pg_temp.check((select count(*) from public.reward_purchases where label = 'Serienfolge · 1 Folge') = 1, 'singular unit');

-- Kids can't confirm or cancel.
select pg_temp.check(not public.confirm_redemption((select id from public.reward_purchases where cost = 15)), 'kid cannot confirm');
select pg_temp.check(not public.cancel_purchase((select id from public.reward_purchases where cost = 15)), 'kid cannot cancel');

-- ---------------------------------------------------------------------------
-- As a stranger (no family)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
select pg_temp.check((select count(*) from public.rewards) = 0, 'strangers see no rewards');
select pg_temp.check((select count(*) from public.reward_purchases) = 0, 'strangers see no purchases');
select pg_temp.expect_error($$select public.redeem_reward('20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000001', 1)$$, 'gibt es nicht');

-- ---------------------------------------------------------------------------
-- As Mama (parent login)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

-- Parents buy for themselves too (20260930090000_parents_redeem_rewards.sql).
select pg_temp.check(public.redeem_reward('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', 1) is not null, 'Mama buys for herself');
select pg_temp.check((select balance from public.member_balance where member_id = '20000000-0000-0000-0000-00000000000a') = 5, 'Mama''s balance drops');
select pg_temp.expect_error($$select public.redeem_reward('20000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000002', 1)$$, 'Nicht genug Sterne');
select pg_temp.expect_error($$select public.redeem_reward('20000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-000000000001', 1)$$, 'Nicht genug Sterne');

select pg_temp.check(public.confirm_redemption((select id from public.reward_purchases where cost = 15)), 'parent confirms');
select pg_temp.check((select redeemed_by from public.reward_purchases where cost = 15) = '20000000-0000-0000-0000-00000000000a', 'redeemed_by = Mama');
select pg_temp.check(not public.confirm_redemption((select id from public.reward_purchases where cost = 15)), 'confirm only once');
select pg_temp.check(not public.cancel_purchase((select id from public.reward_purchases where cost = 15)), 'redeemed purchases stay');

select pg_temp.check(public.cancel_purchase((select id from public.reward_purchases where cost = 10)), 'parent cancels');
select pg_temp.check((select balance from public.member_balance where member_id = '20000000-0000-0000-0000-00000000000b') = 15, 'stars come back');

-- Rewards: parents write, one active title per family (case-insensitive).
insert into public.rewards (family_id, title, price) values ('10000000-0000-0000-0000-000000000001', 'Eis', 10);
select pg_temp.expect_error($$insert into public.rewards (family_id, title, price) values ('10000000-0000-0000-0000-000000000001', 'tabletzeit', 10)$$, 'rewards_family_title_active_idx');
select pg_temp.expect_error($$insert into public.rewards (family_id, title, price, unit_amount) values ('10000000-0000-0000-0000-000000000001', 'Halb', 10, 5)$$, 'check');
select pg_temp.expect_error($$insert into public.rewards (family_id, title, price, max_quantity) values ('10000000-0000-0000-0000-000000000001', 'Viel', 10, 3)$$, 'check');
update public.rewards set price = 7 where title = 'Tabletzeit';
select pg_temp.check((select cost from public.reward_purchases where cost = 15) = 15, 'price change keeps purchases');

-- Negative balance after a parent removes an entry: shown, but buying is blocked.
select public.remove_done_entry((select id from public.task_completions limit 1));
select pg_temp.check((select balance from public.member_balance where member_id = '20000000-0000-0000-0000-00000000000b') = 5, 'balance after removal');
select public.remove_done_entry((select id from public.task_completions where removed_at is null limit 1));
select pg_temp.check((select balance from public.member_balance where member_id = '20000000-0000-0000-0000-00000000000b') = -5, 'negative balance');
select pg_temp.expect_error($$select public.redeem_reward('20000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000001', 1)$$, 'Nicht genug Sterne');

reset role;
select 'rewards_test: ok';
rollback;
