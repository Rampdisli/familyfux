-- Last step of parking the current schema under `old_`: the functions, the
-- constraints and the indexes. After this the unprefixed namespace in `public`
-- (and the helpers in `private`) is free for the new schema.
--
--   functions    all 32 functions in public and private are renamed to old_*.
--                Triggers and RLS policies point at them by OID and follow.
--                What does not follow is a call written in another function's
--                source (`private.is_family_parent(...)`, `perform
--                private.ensure_occurrence(...)`, …): the 15 functions below
--                that call another one are re-created with those calls
--                renamed and an otherwise unchanged body.
--   constraints  renamed with the same prefix, so a new table `tasks` can get
--                its own `tasks_pkey` / `tasks_family_id_fkey`. Renaming a
--                primary-key or unique constraint renames its index with it.
--   indexes      the standalone ones (not backing a constraint) likewise.
--
-- The app and the MCP server call the renamed functions through
-- `supabase.rpc('old_…')` from the same commit on.

-- ---------------------------------------------------------------------------
-- Functions: rename
-- ---------------------------------------------------------------------------

alter function private.can_act_for(uuid, uuid)                      rename to old_can_act_for;
alter function private.ensure_occurrence(public.old_tasks)         rename to old_ensure_occurrence;
alter function private.is_family_member(uuid)                       rename to old_is_family_member;
alter function private.is_family_parent(uuid)                       rename to old_is_family_parent;
alter function private.meal_member_row_before_insert()              rename to old_meal_member_row_before_insert;
alter function private.meals_before_insert()                        rename to old_meals_before_insert;
alter function private.recipe_ingredients_before_insert()           rename to old_recipe_ingredients_before_insert;
alter function private.recipe_ingredients_sync_text()               rename to old_recipe_ingredients_sync_text;
alter function private.recipe_ratings_touch()                       rename to old_recipe_ratings_touch;
alter function private.recipes_split_text_ingredients()             rename to old_recipes_split_text_ingredients;
alter function private.task_assignees_after_write()                 rename to old_task_assignees_after_write;
alter function private.task_assignees_before_insert()               rename to old_task_assignees_before_insert;
alter function private.task_claims_after_write()                    rename to old_task_claims_after_write;
alter function private.task_claims_before_write()                   rename to old_task_claims_before_write;
alter function private.task_completions_before_insert()             rename to old_task_completions_before_insert;
alter function private.task_due_on(public.old_tasks, date)          rename to old_task_due_on;
alter function private.tasks_after_insert()                         rename to old_tasks_after_insert;
alter function private.tasks_after_update()                         rename to old_tasks_after_update;

alter function public.cancel_purchase(uuid)                         rename to old_cancel_purchase;
alter function public.confirm_redemption(uuid)                      rename to old_confirm_redemption;
alter function public.create_recipe(text, text, text, boolean, jsonb) rename to old_create_recipe;
alter function public.family_member_accounts()                      rename to old_family_member_accounts;
alter function public.link_member_account(uuid, text)               rename to old_link_member_account;
alter function public.plan_meal(date, text, uuid, uuid)             rename to old_plan_meal;
alter function public.redeem_reward(uuid, uuid, integer)            rename to old_redeem_reward;
alter function public.refresh_task_pool()                           rename to old_refresh_task_pool;
alter function public.remove_done_entry(uuid)                       rename to old_remove_done_entry;
alter function public.split_ingredient(text)                        rename to old_split_ingredient;
alter function public.split_ingredients(text[])                     rename to old_split_ingredients;
alter function public.tasks_before_write()                          rename to old_tasks_before_write;
alter function public.unlink_member_account(uuid)                   rename to old_unlink_member_account;
alter function public.update_recipe(uuid, text, text, text, boolean, jsonb) rename to old_update_recipe;

-- ---------------------------------------------------------------------------
-- Constraints and indexes: rename
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  -- Every constraint on an old_* table that does not carry the prefix yet.
  for r in
    select c.conrelid::regclass as rel, c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname like 'old\_%' and c.conname not like 'old\_%'
    order by 1, 2
  loop
    execute format('alter table %s rename constraint %I to %I', r.rel, r.conname, 'old_' || r.conname);
  end loop;

  -- Standalone indexes (the ones backing a constraint were renamed with it).
  for r in
    select ic.relname as idx
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = ic.relnamespace
    where n.nspname = 'public' and t.relname like 'old\_%' and ic.relname not like 'old\_%'
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
    order by 1
  loop
    execute format('alter index public.%I rename to %I', r.idx, 'old_' || r.idx);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Functions that call another function: same bodies, renamed callees
-- ---------------------------------------------------------------------------

-- private.old_ensure_occurrence (body from 20261012120000_old_prefix_tables.sql, callees renamed)
create or replace function private.old_ensure_occurrence(t public.old_tasks)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tz     text;
  today  date;
  due    date;
  occ_id uuid;
begin
  -- Repeatable tasks have no occurrences: they're ticked off via task_completions.
  if t.archived_at is not null or t.is_repeatable then
    return;
  end if;

  select timezone into tz from public.old_families where id = t.family_id;
  today := (now() at time zone tz)::date;

  if t.schedule = 'after_completion' then
    -- Only once the previous one is done: repeat_every days after it was.
    if exists (select 1 from public.old_task_occurrences where task_id = t.id and not is_done) then
      return;
    end if;

    select max((done_at at time zone tz)::date) + t.repeat_every into due
    from public.old_task_occurrences
    where task_id = t.id and is_done;

    due := coalesce(due, t.start_date);
    if due > today then
      return;
    end if;
  else
    -- Latest matching day; 400 days back covers yearly schedules.
    select max(g.d::date) into due
    from generate_series(greatest(t.start_date, today - 400), today, interval '1 day') as g(d)
    where private.old_task_due_on(t, g.d::date);

    if due is null then
      return;
    end if;
  end if;

  insert into public.old_task_occurrences (task_id, family_id, due_date, reward, reward_mode)
  values (t.id, t.family_id, due, t.reward, t.reward_mode)
  on conflict (task_id, due_date) do nothing
  returning id into occ_id;

  -- A new occurrence starts with the task's assignees as participants.
  if occ_id is not null then
    insert into public.old_task_claims (occurrence_id, member_id)
    select occ_id, a.member_id from public.old_task_assignees a where a.task_id = t.id;
  end if;
end;
$$;

-- public.old_refresh_task_pool (body from 20261012120000_old_prefix_tables.sql, callees renamed)
create or replace function public.old_refresh_task_pool()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.old_tasks;
begin
  for t in
    select * from public.old_tasks
    where archived_at is null and private.old_is_family_member(family_id)
  loop
    perform private.old_ensure_occurrence(t);
  end loop;
end;
$$;

-- private.old_tasks_after_insert (body from 20260927200000_task_schedules_and_occurrences.sql, callees renamed)
create or replace function private.old_tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.old_ensure_occurrence(new);
  return null;
end;
$$;

-- private.old_tasks_after_update (body from 20261012120000_old_prefix_tables.sql, callees renamed)
create or replace function private.old_tasks_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.is_repeatable, new.schedule, new.start_date, new.repeat_every, new.weekdays, new.month_day, new.month)
     is distinct from
     (old.is_repeatable, old.schedule, old.start_date, old.repeat_every, old.weekdays, old.month_day, old.month) then
    delete from public.old_task_occurrences where task_id = new.id and not is_done;
    perform private.old_ensure_occurrence(new);
  elsif old.archived_at is not null and new.archived_at is null then
    perform private.old_ensure_occurrence(new);
  end if;

  if (new.reward, new.reward_mode) is distinct from (old.reward, old.reward_mode) then
    update public.old_task_occurrences set reward = new.reward, reward_mode = new.reward_mode
    where task_id = new.id and not is_done;
  end if;

  return null;
end;
$$;

-- public.old_split_ingredients (body from 20260929120000_recipe_ingredients.sql, callees renamed)
create or replace function public.old_split_ingredients(lines text[])
returns table (pos int, quantity text, name text)
language sql
immutable
set search_path = ''
as $$
  select (t.ord - 1)::int, s.quantity, s.name
  from unnest(lines) with ordinality as t(line, ord)
  cross join lateral public.old_split_ingredient(t.line) as s
  where s.name is not null
  order by t.ord;
$$;

-- private.old_recipes_split_text_ingredients (body from 20261012120000_old_prefix_tables.sql, callees renamed)
create or replace function private.old_recipes_split_text_ingredients()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if cardinality(new.ingredients) > 0
     and not exists (select 1 from public.old_recipe_ingredients where recipe_id = new.id) then
    insert into public.old_recipe_ingredients (recipe_id, position, quantity, name, original_quantity, original_name)
    select new.id, s.pos::smallint, s.quantity, s.name, s.quantity, s.name
    from public.old_split_ingredients(new.ingredients) s;
  end if;

  return null;
end;
$$;

-- public.old_remove_done_entry (body from 20261012120000_old_prefix_tables.sql, callees renamed)
create or replace function public.old_remove_done_entry(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.old_task_claims
  set removed_at = now(), removed_by = (select auth.uid())
  where id = p_id
    and is_done
    and removed_at is null
    and private.old_is_family_parent(family_id);
  if found then
    return true;
  end if;

  update public.old_task_completions
  set removed_at = now(), removed_by = (select auth.uid())
  where id = p_id
    and removed_at is null
    and private.old_is_family_parent(family_id);
  return found;
end;
$$;

-- public.old_redeem_reward (body from 20261012130000_old_prefix_views.sql, callees renamed)
create or replace function public.old_redeem_reward(p_member_id uuid, p_reward_id uuid, p_quantity int)
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

  if m.id is null or not private.old_is_family_member(m.family_id) then
    raise exception 'Dieses Familienmitglied gibt es nicht.';
  end if;

  if not private.old_can_act_for(m.family_id, m.id) then
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

-- public.old_confirm_redemption (body from 20261012120000_old_prefix_tables.sql, callees renamed)
create or replace function public.old_confirm_redemption(p_purchase_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.old_reward_purchases p
  set redeemed_at = now(),
      redeemed_by = (
        select id from public.old_family_members
        where family_id = p.family_id and user_id = (select auth.uid())
        limit 1
      )
  where p.id = p_purchase_id
    and p.redeemed_at is null
    and private.old_is_family_parent(p.family_id);
  return found;
end;
$$;

-- public.old_cancel_purchase (body from 20261012120000_old_prefix_tables.sql, callees renamed)
create or replace function public.old_cancel_purchase(p_purchase_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.old_reward_purchases
  where id = p_purchase_id
    and redeemed_at is null
    and private.old_is_family_parent(family_id);
  return found;
end;
$$;

-- public.old_link_member_account (body from 20261012120000_old_prefix_tables.sql, callees renamed)
create or replace function public.old_link_member_account(p_member_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m       public.old_family_members;
  account uuid;
begin
  select * into m from public.old_family_members where id = p_member_id for update;

  if m.id is null or not private.old_is_family_parent(m.family_id) then
    raise exception 'Nur Eltern können Konten verknüpfen.';
  end if;

  if m.user_id is not null then
    raise exception '% ist schon mit einem Konto verknüpft.', m.name;
  end if;

  select id into account from auth.users where lower(email) = lower(trim(p_email));

  if account is null then
    raise exception 'Es gibt kein Konto mit dieser E-Mail. Zuerst auf der Anmeldeseite registrieren.';
  end if;

  if exists (select 1 from public.old_family_members where user_id = account) then
    raise exception 'Dieses Konto gehört schon zu einer Familie.';
  end if;

  update public.old_family_members set user_id = account where id = m.id;
end;
$$;

-- public.old_unlink_member_account (body from 20261012120000_old_prefix_tables.sql, callees renamed)
create or replace function public.old_unlink_member_account(p_member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.old_family_members
  set user_id = null
  where id = p_member_id
    and user_id is distinct from (select auth.uid())
    and private.old_is_family_parent(family_id);
  return found;
end;
$$;

-- public.old_family_member_accounts (body from 20261012120000_old_prefix_tables.sql, callees renamed)
create or replace function public.old_family_member_accounts()
returns table (member_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, u.email::text
  from public.old_family_members m
  join auth.users u on u.id = m.user_id
  where private.old_is_family_parent(m.family_id);
$$;

-- private.old_can_act_for (body from 20261012120000_old_prefix_tables.sql, callees renamed)
create or replace function private.old_can_act_for(fid uuid, mid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.old_is_family_parent(fid)
      or exists (
        select 1 from public.old_family_members
        where id = mid and family_id = fid and user_id = auth.uid()
      );
$$;

-- public.old_update_recipe (body from 20261012120000_old_prefix_tables.sql, callees renamed)
create or replace function public.old_update_recipe(
  p_recipe_id             uuid,
  p_title                 text,
  p_url                   text,
  p_image_url             text,
  p_ingredients_available boolean,
  p_ingredients           jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r     public.old_recipes;
  ing   public.old_recipe_ingredients;
  item  jsonb;
  ord   bigint;
  iid   uuid;
  qty   text;
  nam   text;
  kept  uuid[] := '{}';
begin
  select * into r from public.old_recipes where id = p_recipe_id for update;

  if r.id is null or not private.old_is_family_parent(r.family_id) then
    raise exception 'Nur Eltern können Rezepte bearbeiten.';
  end if;

  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'Bitte einen Namen eingeben.';
  end if;

  update public.old_recipes
  set title = btrim(coalesce(p_title, '')),
      url = nullif(btrim(p_url), ''),
      image_url = nullif(btrim(p_image_url), ''),
      ingredients_available = coalesce(p_ingredients_available, r.ingredients_available)
  where id = r.id;

  for item, ord in
    select t.item, t.ord from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) with ordinality as t(item, ord)
  loop
    qty := nullif(btrim(item ->> 'quantity'), '');
    nam := nullif(btrim(item ->> 'name'), '');

    if nullif(item ->> 'id', '') is not null then
      select * into ing from public.old_recipe_ingredients where id = (item ->> 'id')::uuid and recipe_id = r.id;

      if ing.id is null then
        raise exception 'Zutat % gehört nicht zu diesem Rezept.', item ->> 'id';
      end if;

      if nam is null and ing.original_name is null then
        -- An added ingredient without a name is simply gone.
        delete from public.old_recipe_ingredients where id = ing.id;
      else
        update public.old_recipe_ingredients
        set position = (ord - 1)::smallint,
            name = nam,
            -- Left out: no quantity of its own.
            quantity = case when nam is null then null else qty end
        where id = ing.id;
        kept := kept || ing.id;
      end if;
    elsif nam is not null then
      insert into public.old_recipe_ingredients (recipe_id, position, quantity, name)
      values (r.id, (ord - 1)::smallint, qty, nam)
      returning id into iid;
      kept := kept || iid;
    end if;
  end loop;

  -- Rows the form didn't send: originals are left out, added ones deleted.
  update public.old_recipe_ingredients
  set name = null, quantity = null
  where recipe_id = r.id and id <> all (kept) and original_name is not null and name is not null;

  delete from public.old_recipe_ingredients
  where recipe_id = r.id and id <> all (kept) and original_name is null;
end;
$$;

