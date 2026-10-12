-- Every table gets an `old_` prefix: the schema is about to be rebuilt, and the
-- current tables stay around under their new names until then. Views, policies,
-- triggers, foreign keys, indexes and grants are bound to the tables by OID, so
-- they follow the rename on their own (the views keep their names and now read
-- from the old_* tables).
--
-- What does NOT follow a rename is every name written out in SQL text: the
-- bodies of the plpgsql / sql functions below (`public.tasks` → `public.old_tasks`),
-- the row-type variables (`t public.tasks`), and the two `tg_table_name`
-- comparisons in meal_member_row_before_insert. They are re-created here with
-- the same bodies as before and only the table names changed. The function
-- parameters typed `tasks` (ensure_occurrence, task_due_on) follow the row type
-- automatically; they are re-created anyway so the source reads right.
--
-- The app and the MCP server read `old_*` from the same commit on, with the
-- embedded resources aliased back to their old keys (`recipe_ingredients:old_recipe_ingredients(...)`)
-- so the response shape is unchanged.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

alter table public.families           rename to old_families;
alter table public.family_members     rename to old_family_members;
alter table public.tasks              rename to old_tasks;
alter table public.task_occurrences   rename to old_task_occurrences;
alter table public.task_claims        rename to old_task_claims;
alter table public.task_assignees     rename to old_task_assignees;
alter table public.task_completions   rename to old_task_completions;
alter table public.recipes            rename to old_recipes;
alter table public.recipe_ingredients rename to old_recipe_ingredients;
alter table public.recipe_ratings     rename to old_recipe_ratings;
alter table public.recipe_wishes      rename to old_recipe_wishes;
alter table public.meals              rename to old_meals;
alter table public.meal_wishers       rename to old_meal_wishers;
alter table public.rewards            rename to old_rewards;
alter table public.reward_purchases   rename to old_reward_purchases;

-- ---------------------------------------------------------------------------
-- Functions whose source names a table (same bodies, new names)
-- ---------------------------------------------------------------------------

-- private.is_family_member (last defined in 20260925180000_families_and_task_pool.sql)
create or replace function private.is_family_member(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.old_family_members
    where family_id = fid and user_id = auth.uid()
  );
$$;

-- public.tasks_before_write (last defined in 20260927200000_task_schedules_and_occurrences.sql)
create or replace function public.tasks_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.family_id is null then
    select family_id into new.family_id
    from public.old_family_members
    where user_id = new.user_id
    order by created_at
    limit 1;

    if new.family_id is null then
      raise exception 'User % is not a member of any family', new.user_id;
    end if;
  end if;

  return new;
end;
$$;

-- private.is_family_parent (last defined in 20260927180000_parents_manage_family_members.sql)
create or replace function private.is_family_parent(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.old_family_members
    where family_id = fid and user_id = auth.uid() and role = 'parent'
  );
$$;

-- private.task_due_on (last defined in 20260927200000_task_schedules_and_occurrences.sql)
create or replace function private.task_due_on(t public.old_tasks, d date)
returns boolean
language sql
stable
set search_path = ''
as $$
  with m as (
    select
      extract(day from d)::int as day,
      extract(day from date_trunc('month', d) + interval '1 month - 1 day')::int as last_day,
      extract(isodow from d)::smallint as isodow
  )
  select d >= t.start_date and case t.schedule
    when 'once'           then d = t.start_date
    when 'daily'          then true
    when 'weekly'         then m.isodow = any (t.weekdays)
    when 'weekdays'       then m.isodow = any (t.weekdays)
    when 'every_x_days'   then (d - t.start_date) % t.repeat_every = 0
    when 'monthly'        then m.day = least(t.month_day, m.last_day)
    when 'every_x_weeks'  then m.isodow = any (t.weekdays)
      and ((date_trunc('week', d)::date - date_trunc('week', t.start_date)::date) / 7) % t.repeat_every = 0
    when 'every_x_months' then m.day = least(t.month_day, m.last_day)
      and ((extract(year from d) * 12 + extract(month from d))
         - (extract(year from t.start_date) * 12 + extract(month from t.start_date)))::int % t.repeat_every = 0
    when 'yearly'         then extract(month from d) = t.month and m.day = least(t.month_day, m.last_day)
    else false
  end
  from m;
$$;

-- private.ensure_occurrence (last defined in 20260929100000_repeatable_tasks.sql)
create or replace function private.ensure_occurrence(t public.old_tasks)
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
    where private.task_due_on(t, g.d::date);

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

-- public.refresh_task_pool (last defined in 20260927200000_task_schedules_and_occurrences.sql)
create or replace function public.refresh_task_pool()
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
    where archived_at is null and private.is_family_member(family_id)
  loop
    perform private.ensure_occurrence(t);
  end loop;
end;
$$;

-- private.tasks_after_update (last defined in 20260929100000_repeatable_tasks.sql)
create or replace function private.tasks_after_update()
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
    perform private.ensure_occurrence(new);
  elsif old.archived_at is not null and new.archived_at is null then
    perform private.ensure_occurrence(new);
  end if;

  if (new.reward, new.reward_mode) is distinct from (old.reward, old.reward_mode) then
    update public.old_task_occurrences set reward = new.reward, reward_mode = new.reward_mode
    where task_id = new.id and not is_done;
  end if;

  return null;
end;
$$;

-- private.task_claims_before_write (last defined in 20260928110000_shared_claims.sql)
create or replace function private.task_claims_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select family_id into new.family_id from public.old_task_occurrences where id = new.occurrence_id;

    if not exists (
      select 1 from public.old_family_members where id = new.member_id and family_id = new.family_id
    ) then
      raise exception 'Member % is not part of this family', new.member_id;
    end if;

    new.done_at := case when new.is_done then now() end;
  elsif new.is_done is distinct from old.is_done then
    new.done_at := case when new.is_done then now() end;
  end if;

  return new;
end;
$$;

-- private.task_claims_after_write (last defined in 20260928110000_shared_claims.sql)
create or replace function private.task_claims_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  occ uuid := coalesce(new.occurrence_id, old.occurrence_id);
  all_done boolean;
  last_done timestamptz;
begin
  select coalesce(bool_and(is_done), false), max(done_at) into all_done, last_done
  from public.old_task_claims
  where occurrence_id = occ;

  update public.old_task_occurrences
  set is_done = all_done, done_at = case when all_done then last_done end
  where id = occ and (is_done, done_at) is distinct from (all_done, case when all_done then last_done end);

  return null;
end;
$$;

-- private.task_assignees_before_insert (last defined in 20260928120000_task_assignees.sql)
create or replace function private.task_assignees_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select family_id into new.family_id from public.old_tasks where id = new.task_id;

  if not exists (
    select 1 from public.old_family_members where id = new.member_id and family_id = new.family_id
  ) then
    raise exception 'Member % is not part of this family', new.member_id;
  end if;

  return new;
end;
$$;

-- private.task_assignees_after_write (last defined in 20260928120000_task_assignees.sql)
create or replace function private.task_assignees_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.old_task_claims (occurrence_id, member_id)
    select o.id, new.member_id
    from public.old_task_occurrences o
    where o.task_id = new.task_id and not o.is_done
    on conflict (occurrence_id, member_id) do nothing;
  else
    delete from public.old_task_claims c
    using public.old_task_occurrences o
    where o.id = c.occurrence_id
      and o.task_id = old.task_id
      and not o.is_done
      and c.member_id = old.member_id
      and not c.is_done;
  end if;

  return null;
end;
$$;

-- private.meal_member_row_before_insert (last defined in 20260929090000_meals.sql)
create or replace function private.meal_member_row_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_family uuid;
  tz            text;
begin
  if tg_table_name = 'old_meal_wishers' then
    select family_id into parent_family from public.old_meals where id = new.meal_id;
  else
    select family_id into parent_family from public.old_recipes where id = new.recipe_id;
  end if;

  if parent_family is null then
    raise exception 'Recipe or meal not found';
  end if;

  if not exists (
    select 1 from public.old_family_members where id = new.member_id and family_id = parent_family
  ) then
    raise exception 'Member % is not part of this family', new.member_id;
  end if;

  new.family_id := parent_family;

  if tg_table_name = 'old_recipe_wishes' then
    select timezone into tz from public.old_families where id = parent_family;
    new.wish_date := (now() at time zone tz)::date;
  end if;

  return new;
end;
$$;

-- private.meals_before_insert (last defined in 20260929090000_meals.sql)
create or replace function private.meals_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select family_id into new.family_id from public.old_recipes where id = new.recipe_id;

  if new.family_id is null then
    raise exception 'Recipe % not found', new.recipe_id;
  end if;

  return new;
end;
$$;

-- public.plan_meal (last defined in 20260929090000_meals.sql)
create or replace function public.plan_meal(p_day date, p_meal text, p_recipe_id uuid, p_member_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fam    uuid;
  new_id uuid;
begin
  select family_id into fam from public.old_recipes where id = p_recipe_id;
  if fam is null then
    raise exception 'Recipe % not found', p_recipe_id;
  end if;

  delete from public.old_meals where family_id = fam and day = p_day and meal = p_meal;

  insert into public.old_meals (day, meal, recipe_id)
  values (p_day, p_meal, p_recipe_id)
  returning id into new_id;

  if p_member_id is not null then
    insert into public.old_meal_wishers (meal_id, member_id) values (new_id, p_member_id);
  end if;

  return new_id;
end;
$$;

-- private.task_completions_before_insert (last defined in 20260929100000_repeatable_tasks.sql)
create or replace function private.task_completions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.old_tasks;
begin
  select * into t from public.old_tasks where id = new.task_id;

  if t.id is null or not t.is_repeatable or t.archived_at is not null then
    raise exception 'Task % is not an active repeatable task', new.task_id;
  end if;

  if not exists (
    select 1 from public.old_family_members where id = new.member_id and family_id = t.family_id
  ) then
    raise exception 'Member % is not part of this family', new.member_id;
  end if;

  new.family_id := t.family_id;
  new.reward := t.reward;
  new.completed_at := now();

  return new;
end;
$$;

-- private.recipe_ingredients_before_insert (last defined in 20260929120000_recipe_ingredients.sql)
create or replace function private.recipe_ingredients_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select family_id into new.family_id from public.old_recipes where id = new.recipe_id;

  if new.family_id is null then
    raise exception 'Recipe % not found', new.recipe_id;
  end if;

  return new;
end;
$$;

-- public.create_recipe (last defined in 20260929120000_recipe_ingredients.sql)
create or replace function public.create_recipe(
  p_title                 text,
  p_url                   text,
  p_image_url             text,
  p_ingredients_available boolean,
  p_ingredients           jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fam    uuid;
  new_id uuid;
begin
  select family_id into fam
  from public.old_family_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if fam is null then
    raise exception 'You are not a member of any family';
  end if;

  insert into public.old_recipes (family_id, title, url, image_url, ingredients_available)
  values (fam, p_title, p_url, p_image_url, coalesce(p_ingredients_available, true))
  returning id into new_id;

  insert into public.old_recipe_ingredients (recipe_id, position, quantity, name, original_quantity, original_name)
  select
    new_id,
    (t.ord - 1)::smallint,
    nullif(btrim(t.item ->> 'quantity'), ''),
    nullif(btrim(t.item ->> 'name'), ''),
    nullif(btrim(t.item ->> 'original_quantity'), ''),
    nullif(btrim(t.item ->> 'original_name'), '')
  from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) with ordinality as t(item, ord);

  return new_id;
end;
$$;

-- private.recipe_ingredients_sync_text (last defined in 20260929120000_recipe_ingredients.sql)
create or replace function private.recipe_ingredients_sync_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid := coalesce(new.recipe_id, old.recipe_id);
begin
  update public.old_recipes r
  set ingredients = coalesce((
    select array_agg(concat_ws(' ', i.quantity, i.name) order by i.position, i.created_at)
    from public.old_recipe_ingredients i
    where i.recipe_id = rid and i.name is not null
  ), '{}')
  where r.id = rid;

  return null;
end;
$$;

-- private.recipes_split_text_ingredients (last defined in 20260929120000_recipe_ingredients.sql)
create or replace function private.recipes_split_text_ingredients()
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
    from public.split_ingredients(new.ingredients) s;
  end if;

  return null;
end;
$$;

-- public.remove_done_entry (last defined in 20260929130000_remove_done_entries.sql)
create or replace function public.remove_done_entry(p_id uuid)
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
    and private.is_family_parent(family_id);
  if found then
    return true;
  end if;

  update public.old_task_completions
  set removed_at = now(), removed_by = (select auth.uid())
  where id = p_id
    and removed_at is null
    and private.is_family_parent(family_id);
  return found;
end;
$$;

-- public.redeem_reward (last defined in 20260930090000_parents_redeem_rewards.sql)
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
  from public.claim_rewards
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

-- public.confirm_redemption (last defined in 20260929150000_rewards.sql)
create or replace function public.confirm_redemption(p_purchase_id uuid)
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
    and private.is_family_parent(p.family_id);
  return found;
end;
$$;

-- public.cancel_purchase (last defined in 20260929150000_rewards.sql)
create or replace function public.cancel_purchase(p_purchase_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.old_reward_purchases
  where id = p_purchase_id
    and redeemed_at is null
    and private.is_family_parent(family_id);
  return found;
end;
$$;

-- public.link_member_account (last defined in 20260929160000_child_logins.sql)
create or replace function public.link_member_account(p_member_id uuid, p_email text)
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

  if m.id is null or not private.is_family_parent(m.family_id) then
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

-- public.unlink_member_account (last defined in 20260929160000_child_logins.sql)
create or replace function public.unlink_member_account(p_member_id uuid)
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
    and private.is_family_parent(family_id);
  return found;
end;
$$;

-- public.family_member_accounts (last defined in 20260929160000_child_logins.sql)
create or replace function public.family_member_accounts()
returns table (member_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, u.email::text
  from public.old_family_members m
  join auth.users u on u.id = m.user_id
  where private.is_family_parent(m.family_id);
$$;

-- private.can_act_for (last defined in 20260929160000_child_logins.sql)
create or replace function private.can_act_for(fid uuid, mid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_family_parent(fid)
      or exists (
        select 1 from public.old_family_members
        where id = mid and family_id = fid and user_id = auth.uid()
      );
$$;

-- public.update_recipe (last defined in 20260930100000_recipe_edit_delete.sql)
create or replace function public.update_recipe(
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

  if r.id is null or not private.is_family_parent(r.family_id) then
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

