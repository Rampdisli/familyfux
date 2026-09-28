# Aufgabenliste

Offene Punkte aus der Arbeit am Bereich „Essen“ (Branch `Essen`).

## Offen

- [ ] **Migration auf Supabase ausführen:** `supabase/migrations/20260929090000_meals.sql`
      (z. B. mit `supabase db push` oder über den Supabase-Connector). Ohne sie laden die
      Seiten unter `/essen` nicht.
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
