# Aufgabenliste

Offene Punkte aus der Arbeit am Bereich „Essen“ (Branch `Essen`).

## Offen

- [ ] **Rezepte bearbeiten und löschen** — zurückgestellt. Braucht ein Bearbeiten-Formular
      (Basis: `/essen/neu`) und in Supabase eine Delete-Policy samt Grant für `recipes`.
- [ ] **Idee (nicht beauftragt):** Rezept-Import liest Titel, Bild und Zutaten automatisch aus
      dem Fooby-/Cookidoo-Link, z. B. über eine Supabase Edge Function.

## Erledigt

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
