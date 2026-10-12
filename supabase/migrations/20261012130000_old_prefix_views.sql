-- The seven views get the same `old_` prefix as the tables did in
-- 20261012120000_old_prefix_tables.sql: they are part of the schema that is
-- being replaced and should read as such. A view rename keeps its definition,
-- grants and the views built on it (member_balance and member_week_stars read
-- claim_rewards by OID), so only the names change.
--
-- The one piece of SQL text that spells out a view name is redeem_reward
-- (`from public.claim_rewards`); it is re-created below with the new name and
-- an otherwise unchanged body. The app and the MCP server read `old_*` from
-- the same commit on.

alter view public.task_pool              rename to old_task_pool;
alter view public.claim_rewards          rename to old_claim_rewards;
alter view public.member_balance         rename to old_member_balance;
alter view public.member_week_stars      rename to old_member_week_stars;
alter view public.recipe_stats           rename to old_recipe_stats;
alter view public.recipe_wishes_today    rename to old_recipe_wishes_today;
alter view public.task_completions_today rename to old_task_completions_today;

-- public.redeem_reward: same body, reads old_claim_rewards
create or replace function public.redeem_reward(p_member_id uuid, p_reward_id uuid, p_quantity int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m        public.old_family_members;
  r        public.old_rewards;
  unit     text;
  total    int;
  balance  numeric;
  new_id   uuid;
begin
  select * into m from public.old_family_members where id = p_member_id for update;

  if m.id is null or not private.is_family_member(m.family_id) then
    raise exception 'Dieses Familienmitglied gibt es nicht.';
  end if;

  if not private.can_act_for(m.family_id, m.id) then
    raise exception 'Du kannst nur für dich selbst einlösen.';
  end if;

  select * into r from public.old_rewards where id = p_reward_id and family_id = m.family_id;

  if r.id is null or not r.is_active then
    raise exception 'Diese Belohnung gibt es nicht mehr.';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > r.max_quantity then
    raise exception 'Menge muss zwischen 1 und % liegen.', r.max_quantity;
  end if;

  select coalesce(sum(stars), 0) into balance
  from public.old_claim_rewards
  where member_id = m.id and is_done;

  balance := balance - coalesce((select sum(cost) from public.old_reward_purchases where member_id = m.id), 0);

  if balance < r.price * p_quantity then
    raise exception 'Nicht genug Sterne: % kostet % ⭐, Guthaben % ⭐.',
      r.title, r.price * p_quantity, rtrim(to_char(balance, 'FM999999990.##'), '.');
  end if;

  -- "Tabletzeit · 15 Minuten"; "Folge" → "Folgen" like the app.
  if r.unit_amount is not null then
    total := r.unit_amount * p_quantity;
    unit := case when total = 1 then r.unit_label when r.unit_label ~ 'e$' then r.unit_label || 'n' else r.unit_label end;
  end if;

  insert into public.old_reward_purchases (family_id, member_id, reward_id, title, emoji, color, quantity, label, cost)
  values (
    m.family_id, m.id, r.id, r.title, r.emoji, r.color, p_quantity,
    case when r.unit_amount is null then r.title else r.title || ' · ' || total || ' ' || unit end,
    r.price * p_quantity
  )
  returning id into new_id;

  return new_id;
end;
$$;
