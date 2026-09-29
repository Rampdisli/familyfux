-- Checks for supabase/migrations/20260930100000_recipe_edit_delete.sql
-- (design/rezept-bearbeiten-loeschen.md, 4.3).
--
-- Run against a local database with all migrations applied (never production):
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/recipes_edit_test.sql
-- Everything runs in one transaction that is rolled back at the end.
-- Prints "recipes_edit_test: ok" on success, stops at the first failed check.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'parent@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'kid@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'stranger@test.local');

insert into public.families (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Test'),
  ('10000000-0000-0000-0000-000000000002', 'Other');
insert into public.family_members (id, family_id, user_id, name, emoji, color, role) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Mama', '🌻', 'lemon', 'parent'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Mia', '🦊', 'mint', 'child'),
  ('20000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'Other', '🐼', 'rose', 'parent');

-- Spaghetti: never on the plan, three original ingredients, rated and wished for.
-- Curry: cooked three days ago. Pizza: planned in two days.
insert into public.recipes (id, family_id, title, url) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Spaghetti', 'https://fooby.ch/spaghetti'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Curry', null),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Pizza', null);
insert into public.recipe_ingredients (id, recipe_id, position, quantity, name, original_quantity, original_name) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 0, '500 g', 'Spaghetti', '500 g', 'Spaghetti'),
  ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 1, '200 ml', 'Rahm', '200 ml', 'Rahm'),
  ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 2, '1', 'Zwiebel', '1', 'Zwiebel'),
  ('60000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002', 0, '1', 'Kokosmilch', '1', 'Kokosmilch');
insert into public.recipe_ratings (recipe_id, member_id, rating) values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'up'),
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b', 'down');
insert into public.recipe_wishes (recipe_id, member_id) values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000b');
insert into public.meals (day, meal, recipe_id) values
  (current_date - 3, 'dinner', '50000000-0000-0000-0000-000000000002'),
  (current_date + 2, 'lunch', '50000000-0000-0000-0000-000000000003');

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
-- As Mia (kid login): only "Zutaten da / fehlt was" and new recipes
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

select pg_temp.expect_error($$select public.update_recipe('50000000-0000-0000-0000-000000000001', 'Pasta', null, null, true, '[]')$$, 'Nur Eltern');
select pg_temp.expect_error($$update public.recipes set title = 'Pasta' where id = '50000000-0000-0000-0000-000000000001'$$, 'permission denied');
select pg_temp.expect_error($$update public.recipes set image_url = 'https://x.test/a.jpg' where id = '50000000-0000-0000-0000-000000000001'$$, 'permission denied');

delete from public.recipes where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.recipes) = 3, 'kids cannot delete recipes');
update public.recipe_ingredients set name = 'Milch' where id = '60000000-0000-0000-0000-000000000002';
delete from public.recipe_ingredients where id = '60000000-0000-0000-0000-000000000003';
select pg_temp.check((select name from public.recipe_ingredients where id = '60000000-0000-0000-0000-000000000002') = 'Rahm', 'kids cannot change ingredients');
select pg_temp.check((select count(*) from public.recipe_ingredients where recipe_id = '50000000-0000-0000-0000-000000000001') = 3, 'kids cannot delete ingredients');

update public.recipes set ingredients_available = false where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.check(not (select ingredients_available from public.recipes where id = '50000000-0000-0000-0000-000000000001'), 'kids toggle "Zutaten da"');

select pg_temp.check(public.create_recipe('Pfannkuchen', null, null, true, '[{"quantity": "3", "name": "Eier", "original_quantity": "3", "original_name": "Eier"}]') is not null, 'kids still add recipes');
select pg_temp.check((select count(*) from public.recipe_ingredients i join public.recipes r on r.id = i.recipe_id where r.title = 'Pfannkuchen') = 1, 'with their ingredients');

-- ---------------------------------------------------------------------------
-- As a parent of another family
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);

select pg_temp.check((select count(*) from public.recipes) = 0, 'strangers see no recipes');
select pg_temp.expect_error($$select public.update_recipe('50000000-0000-0000-0000-000000000001', 'Pasta', null, null, true, '[]')$$, 'Nur Eltern');
delete from public.recipes where id = '50000000-0000-0000-0000-000000000001';
update public.recipe_ingredients set name = 'Milch' where id = '60000000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------------------
-- As Mama (parent login)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

select pg_temp.check((select count(*) from public.recipes where id = '50000000-0000-0000-0000-000000000001') = 1, 'strangers could not delete');
select pg_temp.check((select name from public.recipe_ingredients where id = '60000000-0000-0000-0000-000000000002') = 'Rahm', 'nor change ingredients');

-- Rahm → Milch (changed), Zwiebel not sent (left out), Karotten added, an empty added row skipped.
select public.update_recipe(
  '50000000-0000-0000-0000-000000000001', ' Spaghetti Bolognese ', 'https://fooby.ch/spaghetti', '', true,
  '[{"id": "60000000-0000-0000-0000-000000000001", "quantity": "500 g", "name": "Spaghetti"},
    {"id": "60000000-0000-0000-0000-000000000002", "quantity": "200 ml", "name": "Milch"},
    {"quantity": "2", "name": "Karotten"},
    {"quantity": "1", "name": ""}]'
);
select pg_temp.check((select title from public.recipes where id = '50000000-0000-0000-0000-000000000001') = 'Spaghetti Bolognese', 'title trimmed and saved');
select pg_temp.check((select image_url is null and ingredients_available from public.recipes where id = '50000000-0000-0000-0000-000000000001'), 'picture removed, available again');
select pg_temp.check((select status from public.recipe_ingredients where id = '60000000-0000-0000-0000-000000000001') = 'original', 'unchanged stays original');
select pg_temp.check((select status = 'changed' and original_name = 'Rahm' and original_quantity = '200 ml' from public.recipe_ingredients where id = '60000000-0000-0000-0000-000000000002'), 'changed, original kept');
select pg_temp.check((select status = 'removed' and quantity is null and original_name = 'Zwiebel' and original_quantity = '1' from public.recipe_ingredients where id = '60000000-0000-0000-0000-000000000003'), 'missing original row is left out, original kept');
select pg_temp.check((select count(*) from public.recipe_ingredients where recipe_id = '50000000-0000-0000-0000-000000000001' and status = 'added' and name = 'Karotten' and position = 2) = 1, 'added row inserted at its position');
select pg_temp.check((select count(*) from public.recipe_ingredients where recipe_id = '50000000-0000-0000-0000-000000000001') = 4, 'empty added row skipped');
select pg_temp.check((select ingredients from public.recipes where id = '50000000-0000-0000-0000-000000000001') = array['500 g Spaghetti', '200 ml Milch', '2 Karotten'], 'text copy follows');

-- Zwiebel back ("↺ zurückholen"), Milch explicitly left out (name empty), Karotten not sent → deleted.
select public.update_recipe(
  '50000000-0000-0000-0000-000000000001', 'Spaghetti Bolognese', 'https://fooby.ch/spaghetti', null, true,
  '[{"id": "60000000-0000-0000-0000-000000000001", "quantity": "500 g", "name": "Spaghetti"},
    {"id": "60000000-0000-0000-0000-000000000002", "quantity": "200 ml", "name": ""},
    {"id": "60000000-0000-0000-0000-000000000003", "quantity": "1", "name": "Zwiebel"}]'
);
select pg_temp.check((select status from public.recipe_ingredients where id = '60000000-0000-0000-0000-000000000003') = 'original', 'left-out original restored');
select pg_temp.check((select status = 'removed' and quantity is null and original_name = 'Rahm' from public.recipe_ingredients where id = '60000000-0000-0000-0000-000000000002'), 'empty name leaves the original out');
select pg_temp.check((select count(*) from public.recipe_ingredients where recipe_id = '50000000-0000-0000-0000-000000000001' and original_name is null) = 0, 'added row not sent is deleted');
select pg_temp.check((select count(*) from public.recipe_ingredients where recipe_id = '50000000-0000-0000-0000-000000000001') = 3, 'originals never deleted');

select pg_temp.expect_error($$select public.update_recipe('50000000-0000-0000-0000-000000000001', 'X', null, null, true, '[{"id": "60000000-0000-0000-0000-000000000004", "name": "Kokosmilch"}]')$$, 'gehört nicht');
select pg_temp.expect_error($$select public.update_recipe('50000000-0000-0000-0000-000000000001', '  ', null, null, true, '[]')$$, 'Namen');
select pg_temp.expect_error($$select public.update_recipe('50000000-0000-0000-0000-000000000001', 'X', 'javascript:alert(1)', null, true, '[]')$$, 'check');

-- Meals block deleting: cooked (past) and planned (future) alike.
select pg_temp.expect_error($$delete from public.recipes where id = '50000000-0000-0000-0000-000000000002'$$, 'foreign key');
select pg_temp.expect_error($$delete from public.recipes where id = '50000000-0000-0000-0000-000000000003'$$, 'foreign key');
select pg_temp.check((select count(*) from public.recipes where id in ('50000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003')) = 2, 'recipes with meals stay');
select pg_temp.check((select count(*) from public.recipe_ingredients where recipe_id = '50000000-0000-0000-0000-000000000002') = 1, 'with their ingredients');
select pg_temp.check((select count(*) from public.meals) = 2, 'and their meals');

-- Without meals: gone, with ingredients, ratings and wishes.
delete from public.recipes where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.recipes where id = '50000000-0000-0000-0000-000000000001') = 0, 'parent deletes a recipe without meals');
select pg_temp.check((select count(*) from public.recipe_ingredients where recipe_id = '50000000-0000-0000-0000-000000000001') = 0, 'ingredients go with it');
select pg_temp.check((select count(*) from public.recipe_ratings where recipe_id = '50000000-0000-0000-0000-000000000001') = 0, 'ratings go with it');
select pg_temp.check((select count(*) from public.recipe_wishes where recipe_id = '50000000-0000-0000-0000-000000000001') = 0, 'wishes go with it');

reset role;
select 'recipes_edit_test: ok';
rollback;
