-- The triggers get the `old_` prefix too, so everything that belongs to the
-- parked schema reads the same way in the catalog. Trigger names are scoped to
-- their table, so this is cosmetic rather than a namespace requirement: a new
-- `tasks` table could carry its own `tasks_before_write` without a clash. The
-- trigger functions were renamed in 20261012140000_old_prefix_functions.sql;
-- a trigger points at its function by OID, so nothing else changes.

alter trigger meal_wishers_before_insert        on public.old_meal_wishers       rename to old_meal_wishers_before_insert;
alter trigger meals_before_insert               on public.old_meals              rename to old_meals_before_insert;
alter trigger recipe_ingredients_before_insert  on public.old_recipe_ingredients rename to old_recipe_ingredients_before_insert;
alter trigger recipe_ingredients_sync_text      on public.old_recipe_ingredients rename to old_recipe_ingredients_sync_text;
alter trigger recipe_ratings_before_insert      on public.old_recipe_ratings     rename to old_recipe_ratings_before_insert;
alter trigger recipe_ratings_touch              on public.old_recipe_ratings     rename to old_recipe_ratings_touch;
alter trigger recipe_wishes_before_insert       on public.old_recipe_wishes      rename to old_recipe_wishes_before_insert;
alter trigger recipes_split_text_ingredients    on public.old_recipes            rename to old_recipes_split_text_ingredients;
alter trigger task_assignees_after_write        on public.old_task_assignees     rename to old_task_assignees_after_write;
alter trigger task_assignees_before_insert      on public.old_task_assignees     rename to old_task_assignees_before_insert;
alter trigger task_claims_after_write           on public.old_task_claims        rename to old_task_claims_after_write;
alter trigger task_claims_before_write          on public.old_task_claims        rename to old_task_claims_before_write;
alter trigger task_completions_before_insert    on public.old_task_completions   rename to old_task_completions_before_insert;
alter trigger tasks_after_insert                on public.old_tasks              rename to old_tasks_after_insert;
alter trigger tasks_after_update                on public.old_tasks              rename to old_tasks_after_update;
alter trigger tasks_before_write                on public.old_tasks              rename to old_tasks_before_write;
