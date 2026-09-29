-- Rewards ("Belohnungen"): kids trade the stars they earned for rewards,
-- e.g. 20 ⭐ for 5 minutes of tablet time. See design/belohnungen-profil.md.
--
--   rewards            what the family offers and what it costs; parents
--                      manage them ("Belohnungen verwalten" or the MCP server)
--   reward_purchases   one row per purchase, with a copy of title / price at
--                      that time; a parent ticks it off once it's redeemed
--   member_balance     stars ever earned minus purchases, for every member
--
-- Purchases are only written through the functions below, which check the
-- balance on the server: redeem_reward, confirm_redemption, cancel_purchase.

-- ---------------------------------------------------------------------------
-- Rewards
-- ---------------------------------------------------------------------------

create table public.rewards (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families (id) on delete cascade,
  title        text not null check (length(trim(title)) between 1 and 40),
  emoji        text not null default '🎁',
  color        text not null default 'peach' check (color in ('mint', 'lilac', 'sky', 'rose', 'peach', 'lemon')),
  category     text not null default 'fun' check (category in ('screen', 'food', 'fun')),
  -- Stars per unit ("In Einheiten") or per purchase ("Pro Kauf").
  price        int not null check (price between 1 and 999),
  -- Set = "In Einheiten" (e.g. 5 Minuten), null = "Pro Kauf".
  unit_amount  int check (unit_amount is null or unit_amount between 1 and 999),
  unit_label   text check (unit_label is null or length(trim(unit_label)) between 1 and 20),
  -- e.g. "beim Abendessen" ("Pro Kauf" only).
  description  text check (description is null or length(description) <= 40),
  max_quantity int not null default 1 check (max_quantity between 1 and 10),
  -- Archived rewards leave the shop; their purchases stay.
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  check ((unit_amount is null) = (unit_label is null)),
  check (unit_amount is not null or max_quantity = 1)
);

create index rewards_family_id_idx on public.rewards (family_id);
create unique index rewards_family_title_active_idx on public.rewards (family_id, lower(title)) where is_active;

alter table public.rewards enable row level security;

revoke all on public.rewards from anon, authenticated;
grant select, delete on public.rewards to authenticated;
grant insert (family_id, title, emoji, color, category, price, unit_amount, unit_label, description, max_quantity, sort_order)
  on public.rewards to authenticated;
grant update (title, emoji, color, category, price, unit_amount, unit_label, description, max_quantity, is_active, sort_order)
  on public.rewards to authenticated;

create policy "Members can view their family's rewards"
  on public.rewards for select
  to authenticated
  using (private.is_family_member(family_id));

create policy "Parents can add rewards to their family"
  on public.rewards for insert
  to authenticated
  with check (private.is_family_parent(family_id));

create policy "Parents can update their family's rewards"
  on public.rewards for update
  to authenticated
  using (private.is_family_parent(family_id))
  with check (private.is_family_parent(family_id));

create policy "Parents can delete their family's rewards"
  on public.rewards for delete
  to authenticated
  using (private.is_family_parent(family_id));

-- ---------------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------------

create table public.reward_purchases (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families (id) on delete cascade,
  -- Who bought it; set null: removing a member keeps the reward's history.
  member_id    uuid references public.family_members (id) on delete set null,
  reward_id    uuid references public.rewards (id) on delete set null,
  -- Copies at the time of the purchase, so editing the reward later doesn't
  -- rewrite anybody's history (or balance).
  title        text not null,
  emoji        text not null,
  color        text not null,
  quantity     int not null check (quantity between 1 and 10),
  -- "Tabletzeit · 15 Minuten", or just the title for "Pro Kauf".
  label        text not null,
  cost         int not null check (cost > 0),
  purchased_at timestamptz not null default now(),
  -- Set when a parent ticks it off.
  redeemed_at  timestamptz,
  redeemed_by  uuid references public.family_members (id) on delete set null
);

create index reward_purchases_member_id_idx on public.reward_purchases (member_id, purchased_at);
create index reward_purchases_reward_id_idx on public.reward_purchases (reward_id, purchased_at);
create index reward_purchases_open_idx on public.reward_purchases (family_id) where redeemed_at is null;

alter table public.reward_purchases enable row level security;

-- Read only: writes go through redeem_reward / confirm_redemption / cancel_purchase.
revoke all on public.reward_purchases from anon, authenticated;
grant select on public.reward_purchases to authenticated;

create policy "Members can view their family's purchases"
  on public.reward_purchases for select
  to authenticated
  using (private.is_family_member(family_id));

-- ---------------------------------------------------------------------------
-- Balance
-- ---------------------------------------------------------------------------

/**
 * Stars per member: everything ever earned (claim_rewards, which already has
 * the repeatable tasks and leaves removed entries out) minus all purchases.
 * Can go negative when a parent removes an entry later; buying is blocked then.
 */
create view public.member_balance
with (security_invoker = true)
as
select
  m.id        as member_id,
  m.family_id,
  coalesce(e.stars, 0)                        as earned,
  coalesce(s.cost, 0)                         as spent,
  coalesce(e.stars, 0) - coalesce(s.cost, 0)  as balance
from public.family_members m
left join (
  select member_id, sum(stars) as stars
  from public.claim_rewards
  where is_done
  group by member_id
) e on e.member_id = m.id
left join (
  select member_id, sum(cost) as cost
  from public.reward_purchases
  group by member_id
) s on s.member_id = m.id;

grant select on public.member_balance to authenticated;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

/**
 * Buys a reward for a kid: p_quantity units ("In Einheiten") or once ("Pro Kauf").
 * Kids buy for themselves, parents for any kid of their family. The balance is
 * checked while the member row is locked, so two purchases at once can't both
 * spend the same stars. Resolves to the new purchase's id.
 */
create function public.redeem_reward(p_member_id uuid, p_reward_id uuid, p_quantity int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m        public.family_members;
  r        public.rewards;
  amount   int;
  unit     text;
  total    int;
  balance  numeric;
  new_id   uuid;
begin
  select * into m from public.family_members where id = p_member_id for update;

  if m.id is null or not private.is_family_member(m.family_id) then
    raise exception 'Dieses Familienmitglied gibt es nicht.';
  end if;

  if m.role <> 'child' then
    raise exception 'Belohnungen können nur Kinder einlösen.';
  end if;

  if not private.is_family_parent(m.family_id) and m.user_id is distinct from (select auth.uid()) then
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

/** Parents tick a purchase off once the kid got it. False if it's gone, already redeemed or not allowed. */
create function public.confirm_redemption(p_purchase_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.reward_purchases p
  set redeemed_at = now(),
      redeemed_by = (
        select id from public.family_members
        where family_id = p.family_id and user_id = (select auth.uid())
        limit 1
      )
  where p.id = p_purchase_id
    and p.redeemed_at is null
    and private.is_family_parent(p.family_id);
  return found;
end;
$$;

/** Parents cancel a purchase that wasn't redeemed yet; its stars come back. */
create function public.cancel_purchase(p_purchase_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.reward_purchases
  where id = p_purchase_id
    and redeemed_at is null
    and private.is_family_parent(family_id);
  return found;
end;
$$;

revoke execute on function public.redeem_reward(uuid, uuid, int) from public, anon;
revoke execute on function public.confirm_redemption(uuid) from public, anon;
revoke execute on function public.cancel_purchase(uuid) from public, anon;
grant execute on function public.redeem_reward(uuid, uuid, int) to authenticated;
grant execute on function public.confirm_redemption(uuid) to authenticated;
grant execute on function public.cancel_purchase(uuid) to authenticated;
