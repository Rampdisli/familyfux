-- Parents can trade their stars for rewards too.
--
-- Until now redeem_reward only sold rewards to kids, although every member
-- earns stars and has a balance (member_balance). Now anybody in the family
-- can buy: kids for themselves, parents for anybody in their family,
-- themselves included (private.can_act_for, 20260929160000_child_logins.sql).
-- Ticking off and cancelling stay with the parents, their own purchases too.

/**
 * Buys a reward for a family member: p_quantity units ("In Einheiten") or once
 * ("Pro Kauf"). Kids buy for themselves, parents for anybody in their family,
 * themselves included. The balance is checked while the member row is locked,
 * so two purchases at once can't both spend the same stars. Resolves to the
 * new purchase's id.
 */
create or replace function public.redeem_reward(p_member_id uuid, p_reward_id uuid, p_quantity int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m        public.family_members;
  r        public.rewards;
  unit     text;
  total    int;
  balance  numeric;
  new_id   uuid;
begin
  select * into m from public.family_members where id = p_member_id for update;

  if m.id is null or not private.is_family_member(m.family_id) then
    raise exception 'Dieses Familienmitglied gibt es nicht.';
  end if;

  if not private.can_act_for(m.family_id, m.id) then
    raise exception 'Du kannst nur für dich selbst einlösen.';
  end if;

  select * into r from public.rewards where id = p_reward_id and family_id = m.family_id;

  if r.id is null or not r.is_active then
    raise exception 'Diese Belohnung gibt es nicht mehr.';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > r.max_quantity then
    raise exception 'Menge muss zwischen 1 und % liegen.', r.max_quantity;
  end if;

  select coalesce(sum(stars), 0) into balance
  from public.claim_rewards
  where member_id = m.id and is_done;

  balance := balance - coalesce((select sum(cost) from public.reward_purchases where member_id = m.id), 0);

  if balance < r.price * p_quantity then
    raise exception 'Nicht genug Sterne: % kostet % ⭐, Guthaben % ⭐.',
      r.title, r.price * p_quantity, rtrim(to_char(balance, 'FM999999990.##'), '.');
  end if;

  -- "Tabletzeit · 15 Minuten"; "Folge" → "Folgen" like the app.
  if r.unit_amount is not null then
    total := r.unit_amount * p_quantity;
    unit := case when total = 1 then r.unit_label when r.unit_label ~ 'e$' then r.unit_label || 'n' else r.unit_label end;
  end if;

  insert into public.reward_purchases (family_id, member_id, reward_id, title, emoji, color, quantity, label, cost)
  values (
    m.family_id, m.id, r.id, r.title, r.emoji, r.color, p_quantity,
    case when r.unit_amount is null then r.title else r.title || ' · ' || total || ' ' || unit end,
    r.price * p_quantity
  )
  returning id into new_id;

  return new_id;
end;
$$;
