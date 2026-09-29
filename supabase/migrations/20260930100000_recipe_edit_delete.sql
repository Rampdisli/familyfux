-- Editing and deleting recipes (design/rezept-bearbeiten-loeschen.md): parents only.
--
--   delete    parents delete a recipe of their family, but only while it never
--             was on the meal plan: meals.recipe_id is `on delete restrict`
--             now, so any meal (planned or cooked) makes the delete fail with
--             23503. Ingredients, ratings and wishes still go with the recipe.
--   edit      title, link and picture change only through update_recipe
--             (security definer, checks the parent role). Everybody keeps
--             toggling "Zutaten da / fehlt was" (ingredients_available), and
--             everybody keeps adding recipes (create_recipe inserts ingredients).
--   originals update_recipe never touches original_*: an ingredient from the
--             original is left out (name null) instead of deleted, so the
--             difference to the original recipe is kept for good.
--
-- The picture in the recipe-images bucket is removed by the app after the
-- delete / picture change succeeded (the storage policy for it exists).

-- ---------------------------------------------------------------------------
-- Delete: parents only, only without meals
-- ---------------------------------------------------------------------------

grant delete on public.recipes to authenticated;

create policy "Parents can delete their family's recipes"
  on public.recipes for delete
  to authenticated
  using (private.is_family_parent(family_id));

alter table public.meals
  drop constraint meals_recipe_id_fkey,
  add constraint meals_recipe_id_fkey
    foreign key (recipe_id) references public.recipes (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Edit: parents only
-- ---------------------------------------------------------------------------

-- Title, link and picture only through update_recipe; the "Zutaten da" toggle stays for everybody.
revoke update on public.recipes from authenticated;
grant update (ingredients_available) on public.recipes to authenticated;

-- Adding stays for everybody (create_recipe); changing and removing is for parents.
drop policy "Members can change their family's ingredients" on public.recipe_ingredients;
drop policy "Members can delete their family's ingredients" on public.recipe_ingredients;

create policy "Parents can change their family's ingredients"
  on public.recipe_ingredients for update
  to authenticated
  using (private.is_family_parent(family_id))
  with check (private.is_family_parent(family_id));

create policy "Parents can delete their family's ingredients"
  on public.recipe_ingredients for delete
  to authenticated
  using (private.is_family_parent(family_id));

/**
 * Saves an edited recipe with its ingredients, atomically. Parents only.
 *
 * p_ingredients: [{id?, quantity, name}, …] in display order; empty strings
 * count as missing.
 * - with id (must belong to the recipe): position, quantity and name are set;
 *   name null = left out. original_* stay as they are.
 * - without id: added (original_* null); skipped without a name.
 * - existing rows missing from the array: left out if they come from the
 *   original, deleted if they were added.
 * An added row whose name was emptied is deleted as well (it has no original
 * to fall back to). recipes.ingredients follows via recipe_ingredients_sync_text.
 */
create function public.update_recipe(
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
  r     public.recipes;
  ing   public.recipe_ingredients;
  item  jsonb;
  ord   bigint;
  iid   uuid;
  qty   text;
  nam   text;
  kept  uuid[] := '{}';
begin
  select * into r from public.recipes where id = p_recipe_id for update;

  if r.id is null or not private.is_family_parent(r.family_id) then
    raise exception 'Nur Eltern können Rezepte bearbeiten.';
  end if;

  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'Bitte einen Namen eingeben.';
  end if;

  update public.recipes
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
      select * into ing from public.recipe_ingredients where id = (item ->> 'id')::uuid and recipe_id = r.id;

      if ing.id is null then
        raise exception 'Zutat % gehört nicht zu diesem Rezept.', item ->> 'id';
      end if;

      if nam is null and ing.original_name is null then
        -- An added ingredient without a name is simply gone.
        delete from public.recipe_ingredients where id = ing.id;
      else
        update public.recipe_ingredients
        set position = (ord - 1)::smallint,
            name = nam,
            -- Left out: no quantity of its own.
            quantity = case when nam is null then null else qty end
        where id = ing.id;
        kept := kept || ing.id;
      end if;
    elsif nam is not null then
      insert into public.recipe_ingredients (recipe_id, position, quantity, name)
      values (r.id, (ord - 1)::smallint, qty, nam)
      returning id into iid;
      kept := kept || iid;
    end if;
  end loop;

  -- Rows the form didn't send: originals are left out, added ones deleted.
  update public.recipe_ingredients
  set name = null, quantity = null
  where recipe_id = r.id and id <> all (kept) and original_name is not null and name is not null;

  delete from public.recipe_ingredients
  where recipe_id = r.id and id <> all (kept) and original_name is null;
end;
$$;

revoke execute on function public.update_recipe(uuid, text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.update_recipe(uuid, text, text, text, boolean, jsonb) to authenticated;
