-- Ingredients get their own table: quantity and name in separate fields, and
-- next to them what the original recipe said, so the app can show where the
-- family's version differs ("Milch statt Rahm", added, left out).
--
--   quantity / name                    how the family cooks it; name null = left out
--   original_quantity / original_name  as in the original recipe; null = added by the family
--   status                             original | changed | added | removed (generated)
--
-- For an own recipe (no link) the original is how it was first entered.
-- Originals can't be updated, so the difference is kept for good.
--
-- Transition: recipes.ingredients (text[]) stays for now as a copy kept in
-- sync from this table, so app 0.2.0 and MCP server 0.5.0 keep working until
-- the new images run. Recipes those old versions insert with text lines are
-- split into this table. A later migration drops the column.

-- ---------------------------------------------------------------------------
-- Splitting "200 g Spaghetti" into quantity and name
-- ---------------------------------------------------------------------------

/**
 * Splits an ingredient line into quantity and name: "200 g Spaghetti" →
 * ("200 g", "Spaghetti"), "1 Prise Salz" → ("1 Prise", "Salz"), "2 Eier" →
 * ("2", "Eier"), "Salz" → (null, "Salz"). Also ranges ("1-2 EL"), fractions
 * ("½ TL", "1/2 l"), "ca." and "etwas" / "wenig" / "einige" / "ein paar".
 */
create function public.split_ingredient(line text, out quantity text, out name text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  num  constant text := '(?:ca\.?\s*)?(?:\d+(?:[.,/]\d+)?|[½¼¾⅓⅔⅛])(?:\s*[½¼¾⅓⅔])?'
                     || '(?:\s*(?:-|–|bis)\s*(?:\d+(?:[.,/]\d+)?|[½¼¾⅓⅔]))?';
  unit constant text := '(?:kg|g|mg|ml|cl|dl|l|el|tl|kl|msp|messerspitzen?|prisen?|pck|päckchen|packungen?'
                     || '|bund|dosen?|becher|stk|stück|zehen?|scheiben?|tassen?|gläser|glas|handvoll'
                     || '|zweiglein|zweige?|stängel|stiele?|blätter|blatt|spritzer|schuss|cm|würfel|liter|gramm|kilogramm'
                     || '|esslöffel|teelöffel|stangen?|knollen?|köpfe|kopf|beutel|tropfen)';
  vague constant text := '(?:etwas|wenig|einige|ein paar|eine? handvoll)';
  m text[];
begin
  line := btrim(regexp_replace(coalesce(line, ''), '\s+', ' ', 'g'));
  if line = '' then
    return;
  end if;

  m := regexp_match(line, '^(' || num || '(?:\s*' || unit || '\M\.?)?|' || vague || ')\s+(.+)$', 'i');
  if m is null then
    name := line;
  else
    quantity := m[1];
    name := m[2];
  end if;
end;
$$;

/** split_ingredient for a whole list, in order (used by the MCP recipe import). */
create function public.split_ingredients(lines text[])
returns table (pos int, quantity text, name text)
language sql
immutable
set search_path = ''
as $$
  select (t.ord - 1)::int, s.quantity, s.name
  from unnest(lines) with ordinality as t(line, ord)
  cross join lateral public.split_ingredient(t.line) as s
  where s.name is not null
  order by t.ord;
$$;

revoke execute on function public.split_ingredient(text) from public, anon;
revoke execute on function public.split_ingredients(text[]) from public, anon;
grant execute on function public.split_ingredient(text), public.split_ingredients(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.recipe_ingredients (
  id                uuid primary key default gen_random_uuid(),
  recipe_id         uuid not null references public.recipes (id) on delete cascade,
  family_id         uuid not null references public.families (id) on delete cascade,
  position          smallint not null default 0,
  quantity          text check (length(btrim(quantity)) > 0),
  name              text check (length(btrim(name)) > 0),
  original_quantity text check (length(btrim(original_quantity)) > 0),
  original_name     text check (length(btrim(original_name)) > 0),
  status            text not null generated always as (
    case
      when original_name is null then 'added'
      when name is null then 'removed'
      when (quantity, name) is distinct from (original_quantity, original_name) then 'changed'
      else 'original'
    end
  ) stored,
  created_at        timestamptz not null default now(),
  check (name is not null or original_name is not null),
  -- A left-out ingredient has no quantity of its own; an added one no original quantity.
  check (name is not null or quantity is null),
  check (original_name is not null or original_quantity is null)
);

create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id, position);
create index recipe_ingredients_family_id_idx on public.recipe_ingredients (family_id);

/** family_id comes from the recipe, so an ingredient can't be attached to another family's recipe. */
create function private.recipe_ingredients_before_insert()
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

create trigger recipe_ingredients_before_insert
  before insert on public.recipe_ingredients
  for each row execute function private.recipe_ingredients_before_insert();

alter table public.recipe_ingredients enable row level security;

revoke all on public.recipe_ingredients from anon, authenticated;
grant select, delete on public.recipe_ingredients to authenticated;
grant insert (recipe_id, position, quantity, name, original_quantity, original_name)
  on public.recipe_ingredients to authenticated;
-- No original_*: what the original recipe said stays as it was.
grant update (position, quantity, name) on public.recipe_ingredients to authenticated;

create policy "Members can view their family's ingredients"
  on public.recipe_ingredients for select
  to authenticated
  using (private.is_family_member(family_id));

-- The before-insert trigger fills family_id before this check runs.
create policy "Members can add ingredients to their family's recipes"
  on public.recipe_ingredients for insert
  to authenticated
  with check (private.is_family_member(family_id));

create policy "Members can change their family's ingredients"
  on public.recipe_ingredients for update
  to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

create policy "Members can delete their family's ingredients"
  on public.recipe_ingredients for delete
  to authenticated
  using (private.is_family_member(family_id));

-- ---------------------------------------------------------------------------
-- Creating a recipe with its ingredients in one go
-- ---------------------------------------------------------------------------

/**
 * Saves a recipe of the caller's family with its ingredients, atomically.
 * p_ingredients: [{quantity, name, original_quantity, original_name}, …] in
 * order; empty strings count as missing. Runs as the caller, so RLS applies.
 */
create function public.create_recipe(
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
  from public.family_members
  where user_id = (select auth.uid())
  order by created_at
  limit 1;

  if fam is null then
    raise exception 'You are not a member of any family';
  end if;

  insert into public.recipes (family_id, title, url, image_url, ingredients_available)
  values (fam, p_title, p_url, p_image_url, coalesce(p_ingredients_available, true))
  returning id into new_id;

  insert into public.recipe_ingredients (recipe_id, position, quantity, name, original_quantity, original_name)
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

revoke execute on function public.create_recipe(text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.create_recipe(text, text, text, boolean, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Transition: recipes.ingredients as a copy
-- ---------------------------------------------------------------------------

/** Keeps recipes.ingredients ("200 g Spaghetti", …; left-out ones skipped) in line with the table. */
create function private.recipe_ingredients_sync_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid := coalesce(new.recipe_id, old.recipe_id);
begin
  update public.recipes r
  set ingredients = coalesce((
    select array_agg(concat_ws(' ', i.quantity, i.name) order by i.position, i.created_at)
    from public.recipe_ingredients i
    where i.recipe_id = rid and i.name is not null
  ), '{}')
  where r.id = rid;

  return null;
end;
$$;

create trigger recipe_ingredients_sync_text
  after insert or update or delete on public.recipe_ingredients
  for each row execute function private.recipe_ingredients_sync_text();

/** Old clients (app 0.2.0, MCP 0.5.0) insert text lines: split them into the table, as the original. */
create function private.recipes_split_text_ingredients()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if cardinality(new.ingredients) > 0
     and not exists (select 1 from public.recipe_ingredients where recipe_id = new.id) then
    insert into public.recipe_ingredients (recipe_id, position, quantity, name, original_quantity, original_name)
    select new.id, s.pos::smallint, s.quantity, s.name, s.quantity, s.name
    from public.split_ingredients(new.ingredients) s;
  end if;

  return null;
end;
$$;

create trigger recipes_split_text_ingredients
  after insert on public.recipes
  for each row execute function private.recipes_split_text_ingredients();

revoke execute on function private.recipe_ingredients_before_insert() from public, anon, authenticated;
revoke execute on function private.recipe_ingredients_sync_text() from public, anon, authenticated;
revoke execute on function private.recipes_split_text_ingredients() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Existing recipes: their lines become the original
-- ---------------------------------------------------------------------------

insert into public.recipe_ingredients (recipe_id, family_id, position, quantity, name, original_quantity, original_name)
select r.id, r.family_id, s.pos::smallint, s.quantity, s.name, s.quantity, s.name
from public.recipes r
cross join lateral public.split_ingredients(r.ingredients) s;
