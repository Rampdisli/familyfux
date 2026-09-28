-- "Essen": the family's recipes and the weekly meal plan.
--
--   recipes          the family's recipe collection (link, picture, ingredients,
--                    whether the ingredients are in the house)
--   recipe_ratings   👍 / 👎 per member and recipe; recipes most of the family
--                    turned down stop being suggested (decided in the app)
--   recipe_wishes    "Das will ich!" — who wishes for a recipe, per day
--   meals            one recipe per day and meal (lunch / dinner)
--   meal_wishers     who is looking forward to a planned meal ("+ Ich auch")
--
-- How often a recipe was cooked is never stored: it's the number of planned
-- meals up to today (recipe_stats view).
--
-- Like the task pool, every member can act for every other member of the
-- family (kids usually don't have their own login).

-- ---------------------------------------------------------------------------
-- Recipes
-- ---------------------------------------------------------------------------

create table public.recipes (
  id                    uuid primary key default gen_random_uuid(),
  family_id             uuid not null references public.families (id) on delete cascade,
  title                 text not null check (length(trim(title)) > 0),
  -- Fooby / Cookidoo / any other page; null for own recipes
  url                   text check (url ~* '^https?://'),
  image_url             text check (image_url ~* '^https?://'),
  ingredients           text[] not null default '{}',
  ingredients_available boolean not null default true,
  created_by            uuid references auth.users (id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now()
);

create index recipes_family_id_idx on public.recipes (family_id);

alter table public.recipes enable row level security;

revoke all on public.recipes from anon, authenticated;
grant select on public.recipes to authenticated;
grant insert (family_id, title, url, image_url, ingredients, ingredients_available)
  on public.recipes to authenticated;
grant update (title, url, image_url, ingredients, ingredients_available)
  on public.recipes to authenticated;

create policy "Members can view their family's recipes"
  on public.recipes for select
  to authenticated
  using (private.is_family_member(family_id));

create policy "Members can add recipes to their family"
  on public.recipes for insert
  to authenticated
  with check (private.is_family_member(family_id));

create policy "Members can update their family's recipes"
  on public.recipes for update
  to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

-- ---------------------------------------------------------------------------
-- Shared trigger: family_id from the parent row, member must belong to it
-- ---------------------------------------------------------------------------

/**
 * Before insert on recipe_ratings / recipe_wishes / meal_wishers: fills
 * family_id from the recipe (or meal) and checks the member belongs to that
 * family. recipe_wishes also get today's date in the family's time zone.
 */
create function private.meal_member_row_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_family uuid;
  tz            text;
begin
  if tg_table_name = 'meal_wishers' then
    select family_id into parent_family from public.meals where id = new.meal_id;
  else
    select family_id into parent_family from public.recipes where id = new.recipe_id;
  end if;

  if parent_family is null then
    raise exception 'Recipe or meal not found';
  end if;

  if not exists (
    select 1 from public.family_members where id = new.member_id and family_id = parent_family
  ) then
    raise exception 'Member % is not part of this family', new.member_id;
  end if;

  new.family_id := parent_family;

  if tg_table_name = 'recipe_wishes' then
    select timezone into tz from public.families where id = parent_family;
    new.wish_date := (now() at time zone tz)::date;
  end if;

  return new;
end;
$$;

revoke execute on function private.meal_member_row_before_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ratings
-- ---------------------------------------------------------------------------

create table public.recipe_ratings (
  recipe_id  uuid not null references public.recipes (id) on delete cascade,
  member_id  uuid not null references public.family_members (id) on delete cascade,
  family_id  uuid not null references public.families (id) on delete cascade,
  rating     text not null check (rating in ('up', 'down')),
  primary key (recipe_id, member_id)
);

create index recipe_ratings_family_id_idx on public.recipe_ratings (family_id);

create trigger recipe_ratings_before_insert
  before insert on public.recipe_ratings
  for each row execute function private.meal_member_row_before_insert();

alter table public.recipe_ratings enable row level security;

revoke all on public.recipe_ratings from anon, authenticated;
grant select, delete on public.recipe_ratings to authenticated;
grant insert (recipe_id, member_id, rating) on public.recipe_ratings to authenticated;
grant update (rating) on public.recipe_ratings to authenticated;

create policy "Members can view their family's ratings"
  on public.recipe_ratings for select
  to authenticated
  using (private.is_family_member(family_id));

-- The before-insert trigger fills family_id before this check runs.
create policy "Members can rate their family's recipes"
  on public.recipe_ratings for insert
  to authenticated
  with check (private.is_family_member(family_id));

create policy "Members can change their family's ratings"
  on public.recipe_ratings for update
  to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

-- Also "Wieder vorschlagen": clears a hidden recipe's ratings.
create policy "Members can remove their family's ratings"
  on public.recipe_ratings for delete
  to authenticated
  using (private.is_family_member(family_id));

-- ---------------------------------------------------------------------------
-- Wishes ("Das will ich!")
-- ---------------------------------------------------------------------------

create table public.recipe_wishes (
  recipe_id  uuid not null references public.recipes (id) on delete cascade,
  member_id  uuid not null references public.family_members (id) on delete cascade,
  family_id  uuid not null references public.families (id) on delete cascade,
  -- Filled by the trigger: today in the family's time zone.
  wish_date  date not null,
  primary key (recipe_id, member_id, wish_date)
);

create index recipe_wishes_family_id_idx on public.recipe_wishes (family_id, wish_date);

create trigger recipe_wishes_before_insert
  before insert on public.recipe_wishes
  for each row execute function private.meal_member_row_before_insert();

alter table public.recipe_wishes enable row level security;

revoke all on public.recipe_wishes from anon, authenticated;
grant select, delete on public.recipe_wishes to authenticated;
grant insert (recipe_id, member_id) on public.recipe_wishes to authenticated;

create policy "Members can view their family's wishes"
  on public.recipe_wishes for select
  to authenticated
  using (private.is_family_member(family_id));

create policy "Members can wish for their family's recipes"
  on public.recipe_wishes for insert
  to authenticated
  with check (private.is_family_member(family_id));

create policy "Members can take back their family's wishes"
  on public.recipe_wishes for delete
  to authenticated
  using (private.is_family_member(family_id));

/** Today's wishes (family time zone). */
create view public.recipe_wishes_today
with (security_invoker = true)
as
select w.recipe_id, w.member_id, w.family_id, w.wish_date
from public.recipe_wishes w
join public.families f on f.id = w.family_id
where w.wish_date = (now() at time zone f.timezone)::date;

-- ---------------------------------------------------------------------------
-- Meal plan
-- ---------------------------------------------------------------------------

create table public.meals (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,
  day        date not null,
  meal       text not null check (meal in ('lunch', 'dinner')),
  recipe_id  uuid not null references public.recipes (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (family_id, day, meal)
);

create index meals_recipe_id_idx on public.meals (recipe_id);

/** family_id comes from the recipe, so a meal can't point at another family's recipe. */
create function private.meals_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select family_id into new.family_id from public.recipes where id = new.recipe_id;

  if new.family_id is null then
    raise exception 'Recipe % not found', new.recipe_id;
  end if;

  return new;
end;
$$;

revoke execute on function private.meals_before_insert() from public, anon, authenticated;

create trigger meals_before_insert
  before insert on public.meals
  for each row execute function private.meals_before_insert();

alter table public.meals enable row level security;

revoke all on public.meals from anon, authenticated;
grant select, delete on public.meals to authenticated;
grant insert (day, meal, recipe_id) on public.meals to authenticated;

create policy "Members can view their family's meals"
  on public.meals for select
  to authenticated
  using (private.is_family_member(family_id));

create policy "Members can plan their family's meals"
  on public.meals for insert
  to authenticated
  with check (private.is_family_member(family_id));

create policy "Members can remove their family's meals"
  on public.meals for delete
  to authenticated
  using (private.is_family_member(family_id));

create table public.meal_wishers (
  meal_id    uuid not null references public.meals (id) on delete cascade,
  member_id  uuid not null references public.family_members (id) on delete cascade,
  family_id  uuid not null references public.families (id) on delete cascade,
  primary key (meal_id, member_id)
);

create index meal_wishers_family_id_idx on public.meal_wishers (family_id);

create trigger meal_wishers_before_insert
  before insert on public.meal_wishers
  for each row execute function private.meal_member_row_before_insert();

alter table public.meal_wishers enable row level security;

revoke all on public.meal_wishers from anon, authenticated;
grant select, delete on public.meal_wishers to authenticated;
grant insert (meal_id, member_id) on public.meal_wishers to authenticated;

create policy "Members can view their family's meal wishers"
  on public.meal_wishers for select
  to authenticated
  using (private.is_family_member(family_id));

create policy "Members can join their family's meals"
  on public.meal_wishers for insert
  to authenticated
  with check (private.is_family_member(family_id));

create policy "Members can leave their family's meals"
  on public.meal_wishers for delete
  to authenticated
  using (private.is_family_member(family_id));

/**
 * Puts a recipe on a day's lunch or dinner, replacing what was planned there.
 * The member who picked it is its first wisher. Runs as the caller, so RLS
 * applies as for the single statements.
 */
create function public.plan_meal(p_day date, p_meal text, p_recipe_id uuid, p_member_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fam    uuid;
  new_id uuid;
begin
  select family_id into fam from public.recipes where id = p_recipe_id;
  if fam is null then
    raise exception 'Recipe % not found', p_recipe_id;
  end if;

  delete from public.meals where family_id = fam and day = p_day and meal = p_meal;

  insert into public.meals (day, meal, recipe_id)
  values (p_day, p_meal, p_recipe_id)
  returning id into new_id;

  if p_member_id is not null then
    insert into public.meal_wishers (meal_id, member_id) values (new_id, p_member_id);
  end if;

  return new_id;
end;
$$;

revoke execute on function public.plan_meal(date, text, uuid, uuid) from public, anon;
grant execute on function public.plan_meal(date, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Stats
-- ---------------------------------------------------------------------------

/** How often a recipe was cooked: planned meals up to today (family time zone). */
create view public.recipe_stats
with (security_invoker = true)
as
select
  r.id as recipe_id,
  r.family_id,
  count(m.id)::int as cook_count,
  max(m.day)       as last_cooked_on
from public.recipes r
join public.families f on f.id = r.family_id
left join public.meals m
  on m.recipe_id = r.id
 and m.day <= (now() at time zone f.timezone)::date
group by r.id, r.family_id;

grant select on public.recipe_wishes_today, public.recipe_stats to authenticated;
