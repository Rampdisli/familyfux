# Aufgabenliste

Offene Punkte aus der Arbeit an Fuxis Plan.

## Offen

- [ ] **Belohnungen anlegen:** Es gibt keine Startdaten; die Familie legt Belohnungen und Preise unter
      „Belohnungen verwalten“ oder per Claude an. `supabase/seed.sql` ist nur für die Entwicklung.

- [ ] **Migration für Rezepte bearbeiten und löschen auf Supabase ausführen** (Projekt `familyfux`), bevor
      App 0.9.0 läuft: `supabase/migrations/20260930100000_recipe_edit_delete.sql`. Danach hier abhaken.

- [ ] **MCP-Tools `update_recipe` und `delete_recipe`** (Abschnitt 6 von `design/rezept-bearbeiten-loeschen.md`),
      nur für Eltern; kommt als eigener Schritt.

- [ ] **Alte Zutaten-Spalte entfernen,** sobald App 0.3.0 und MCP-Server 0.6.0 auf dem NAS laufen:
      `recipes.ingredients` ist nur noch eine automatisch gepflegte Kopie von `recipe_ingredients`
      (siehe `supabase/migrations/20260929120000_recipe_ingredients.sql`). Eine neue Migration
      entfernt dann die Spalte und die Trigger `recipe_ingredients_sync_text` /
      `recipes_split_text_ingredients`.

- [ ] **Eingelöste Belohnungen rückgängig machen können:** Falls eine Belohnung versehentlich als
      eingelöst markiert wurde, sollen Eltern das zurücknehmen können.

- [ ] **Rezepte und Aufgaben auch über den MCP-Server bearbeiten können:** nicht nur anlegen, sondern
      auch bestehende Rezepte und Aufgaben über MCP-Tools ändern.

## Erledigt

- [x] Rezepte bearbeiten und löschen, nur für Eltern (`design/rezept-bearbeiten-loeschen.md`, App 0.9.0):
      `/essen/rezept/:id/bearbeiten` mit Zutaten-Abweichungen (angepasst / ergänzt / weggelassen, das Original
      bleibt), Lösch-Dialog in Detailansicht und Bearbeiten-Seite, gesperrt sobald das Rezept Mahlzeiten hat;
      Bilder aus `recipe-images` werden beim Ersetzen und Löschen aufgeräumt. Migration
      `supabase/migrations/20260930100000_recipe_edit_delete.sql` (Delete nur Eltern, `meals.recipe_id`
      `on delete restrict`, `update_recipe`), SQL-Test `supabase/tests/recipes_edit_test.sql`

- [x] Auch Eltern können ihr Guthaben gegen Belohnungen einlösen (App 0.8.0, MCP-Server 0.8.1);
      Migration `supabase/migrations/20260930090000_parents_redeem_rewards.sql` auf Supabase ausgeführt,
      als Version `20260930090000` registriert

- [x] Belohnungen, Profil und Personenwahl (`design/belohnungen-profil.md`): braune Leiste mit
      Guthaben, Navigation ohne Kalender, Aufgaben-Pool pro Person, `/belohnungen` mit Kauf-Dialog,
      `/profil` statt `/fortschritt/:memberId` (leitet weiter), „Belohnungen verwalten“ und
      „Neue Belohnung“; Migration `supabase/migrations/20260929150000_rewards.sql`, SQL-Test
      `supabase/tests/rewards_test.sql`
- [x] MCP-Server 0.8.0: `list_rewards`, `create_reward`, `update_reward`, `archive_reward`,
      `restore_reward`, `list_open_redemptions`, `confirm_redemption`; `list_family_members` mit
      Guthaben; Skript `npm run smoke:rewards` (lokale Supabase)
- [x] Kinder-Login: Konto in „Familie verwalten“ per E-Mail verknüpfen; Kinder handeln im
      Aufgaben-Pool nur für sich selbst; Migration `supabase/migrations/20260929160000_child_logins.sql`,
      SQL-Test `supabase/tests/child_logins_test.sql`

- [x] Designs Navigation, Rezepte und Wochenplan unter `design/prototypes/` abgelegt
- [x] Essen umgesetzt: Rezepte (`/essen`), Wochenplan (`/essen/wochenplan`),
      Rezept importieren (`/essen/neu`) inkl. neuer Supabase-Tabellen
- [x] `package-lock.json` mit `package.json` synchronisiert (`npm ci` mit npm 10 und 11)
- [x] Rezepte werden erst ausgeblendet, wenn mehr als die Hälfte der Familie 👎 gibt
- [x] Migration `supabase/migrations/20260929090000_meals.sql` auf Supabase (Projekt `familyfux`)
      ausgeführt, als Version `20260929090000` registriert
- [x] Wiederholbare Aufgaben „Immer wieder“ umgesetzt; Migration
      `supabase/migrations/20260929100000_repeatable_tasks.sql` auf Supabase ausgeführt,
      als Version `20260929100000` registriert
- [x] Rezept-Import über den MCP-Server (`read_recipe_page`, `save_recipe`, `list_recipes`);
      Bilder im Supabase-Bucket `recipe-images`, Migration
      `supabase/migrations/20260929110000_recipe_images.sql` ausgeführt
- [x] Zutaten mit Menge und Zutat in getrennten Feldern (`recipe_ingredients`) und Abweichungen vom
      Originalrezept (geändert / ergänzt / weggelassen)
- [x] Eltern können erledigte Aufgaben aus dem Verlauf einer Person löschen (Fortschrittsseite);
      Migration `supabase/migrations/20260929130000_remove_done_entries.sql`
- [x] Rezept-Detailansicht (`/essen/rezept/:id`): Handy Vollbild, Tablet/Desktop Overlay; Zutaten
      mit Abweichungen, geplante und gekochte Termine, wer's mag (seit wann); Migration
      `supabase/migrations/20260929140000_recipe_ratings_rated_at.sql` ausgeführt
