-- When a member rated a recipe, for "Wer mag's? — seit 5. Jul 2026" in the
-- recipe details. Existing ratings stay NULL (their date isn't known); new
-- ones get the time they were given, and changing 👍 ↔ 👎 updates it.

alter table public.recipe_ratings add column rated_at timestamptz;
alter table public.recipe_ratings alter column rated_at set default now();

/** A changed rating counts from now on. */
create function private.recipe_ratings_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rating is distinct from old.rating then
    new.rated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.recipe_ratings_touch() from public, anon, authenticated;

create trigger recipe_ratings_touch
  before update on public.recipe_ratings
  for each row execute function private.recipe_ratings_touch();
