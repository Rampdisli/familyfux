-- Development data only (never run on production): the example rewards from
-- design/prototypes/fuxis-plan-belohnungen.html for every family that has no
-- rewards yet. Prices are examples; families set their own.
--   psql "$LOCAL_DB_URL" -f supabase/seed.sql
-- (`supabase db reset` runs this file automatically.)

insert into public.rewards (family_id, title, emoji, color, category, price, unit_amount, unit_label, description, max_quantity, sort_order)
select f.id, r.title, r.emoji, r.color, r.category, r.price, r.unit_amount, r.unit_label, r.description, r.max_quantity, r.sort_order
from public.families f
cross join (
  values
    ('Tabletzeit',        '📱', 'peach', 'screen', 20,  5,    'Minuten', null,                  6, 0),
    ('Gamezeit',          '🎮', 'sky',   'screen', 40,  10,   'Minuten', null,                  6, 1),
    ('Serienfolge',       '📺', 'lilac', 'screen', 30,  1,    'Folge',   null,                  3, 2),
    ('Dessert aussuchen', '🍨', 'rose',  'food',   25,  null, null,      'beim Abendessen',     1, 3),
    ('Wunsch-Menü',       '🍕', 'lemon', 'food',   45,  null, null,      'du wählst das Essen', 1, 4),
    ('Länger aufbleiben', '🌙', 'lilac', 'fun',    35,  15,   'Minuten', null,                  2, 5),
    ('Filmabend',         '🎬', 'peach', 'fun',    60,  null, null,      'du wählst den Film',  1, 6),
    ('Ausflug wählen',    '🏞️', 'mint',  'fun',    150, null, null,      'am Wochenende',       1, 7)
) as r (title, emoji, color, category, price, unit_amount, unit_label, description, max_quantity, sort_order)
where not exists (select 1 from public.rewards x where x.family_id = f.id);
