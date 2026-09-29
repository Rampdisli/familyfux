# Rezepte bearbeiten und löschen

Spezifikation für den offenen Punkt „Rezepte bearbeiten und löschen“ aus `TODO.md`. Der klickbare Prototyp liegt
unter `design/prototypes/fuxis-plan-rezept-bearbeiten.html`. Er ist verbindlich für Aufbau, Texte und Verhalten.
Farben, Schriften und Komponenten kommen weiterhin aus `src/styles.scss` und den bestehenden Komponenten
(`recipe-detail`, `recipe-create`). Der Prototyp nutzt dieselben Tokens wie `recipe-detail.scss`.

Prototyp testen: Datei im Browser öffnen. Oben wechselt man zwischen den Screens 1 · Rezept, 2 · Bearbeiten und
3 · Löschen. Rechts oben schaltet man zwischen Eltern- und Kinder-Login um.

## Ziel

- Ein Rezept lässt sich nach dem Import korrigieren: Name, Link, Bild, Zutaten und „Zutaten im Haus?“.
- Zutaten-Änderungen bleiben als Abweichung vom Original sichtbar, wie es `recipe_ingredients` heute schon vorsieht:
  „statt …“, „ergänzt“, „weggelassen“.
- Eltern können ein Rezept löschen. Vorher zeigt ein Dialog, was dabei verloren geht.
- Neue Screens gibt es nur für Bearbeiten und Löschen. In der Rezeptliste ändert sich nichts.

## 1. Detailansicht (`/essen/rezept/:id`): neue Buttons

- **Ort:** im `.head` direkt unter den drei Kennzahlen (gekocht / geplant / mögen es), als eigene Zeile
  `.recipe-tools`.
  - Handy: im Creme-Sheet über „Zutaten“.
  - Ab 768 px: in der linken Spalte über „Einplanen“ / „Heute gekocht“.
- **Buttons:**
  - `✏️ Bearbeiten`: breit (`flex: 1`), weiß mit Rand `--rand`. Führt zu `/essen/rezept/:id/bearbeiten`.
  - `🗑️ Löschen`: schmal, Text in Rot (`--danger`), Hover mit rotem Rand und hellrotem Hintergrund.
    Öffnet den Lösch-Dialog (Abschnitt 3). `aria-label="Rezept löschen"`.
- **Sichtbarkeit:**
  - „Bearbeiten“ für alle Familienmitglieder (die Update-Policy für `recipes` gilt heute schon für alle Mitglieder).
  - „Löschen“ nur bei Eltern-Login (`TaskPool.isParent()`). Bei Kinder-Login fehlt der Button, „Bearbeiten“ nimmt
    dann die ganze Breite ein.
- Die sticky Aktionsleiste unten (Einplanen / Heute gekocht) und die übrigen Bereiche bleiben unverändert.
- Mindesthöhe der Buttons: 44 px.

## 2. Rezept bearbeiten (`/essen/rezept/:id/bearbeiten`, neu)

- **Route:** eigene Seite (kein Overlay) mit `authGuard`, gleich aufgebaut wie `/essen/neu` (`recipe-create`).
  - Neue Komponente `recipe-edit`.
  - Das Formular am besten als gemeinsame Komponente aus `recipe-create` herauslösen, z. B. `recipe-form`
    (wie bei `reward-form`).
- **Kopf:**
  - Link „← Zurück zum Rezept“ zurück zur Detailansicht.
  - Titel „Rezept bearbeiten“, Untertitel „Änderungen gelten sofort für die ganze Familie“.
- **Layout:**
  - Ab 900 px zweispaltig: links das Formular in einer weißen Karte, rechts sticky „Vorschau“ (die Rezeptkarte,
    live aktualisiert) und darunter die „Rezept löschen“-Box.
  - Auf dem Handy steht alles untereinander.

### Felder

| Feld | Eingabe | Regeln |
|---|---|---|
| Name des Rezepts | Textfeld, vorbelegt | Pflicht. Leer: Hinweis „Bitte einen Namen eingeben.“, Speichern deaktiviert |
| Link zum Rezept | URL-Feld, optional | wie in `recipe-create`: nur `https?://`, sonst „Bitte einen vollständigen Link mit https:// eingeben.“ |
| Bild | Vorschaubild 96 × 96 plus Feld „Bild-Link“ und Button „✕ Bild entfernen“ | wie in `recipe-create`: nur `https?://`. Entfernen leert das Feld und zeigt „Kein Foto“ |
| Zutaten | Zeilen Menge + Zutat, „+ Zutat“ | siehe unten |
| Zutaten im Haus? | `segmented`: „✓ Alles da“ / „Fehlt was“ | |

- Hinweis unter dem Bild: „Neuen Link einfügen ersetzt das Bild. Ein Bild aus dem Import wird dabei aus dem Speicher
  gelöscht.“

### Zutaten mit Abweichungen

- **Gelber Hinweis** über der Liste: „✎ Das Originalrezept bleibt gespeichert. Änderungen erscheinen in der Ansicht
  als „statt …“, „ergänzt“ oder „weggelassen“.“
- **Zusammenfassung** rechts neben „Zutaten“, live: „2 angepasst · 1 ergänzt · 1 weggelassen“ bzw.
  „wie im Original“. Gleiche Logik wie `deviations()` in `recipe-detail.ts`.
- **Status pro Zeile** wie die Spalte `status`, live beim Tippen berechnet:
  - **original:** zwei Eingabefelder und `×`.
  - **angepasst:** oranger Punkt, zartoranger Hintergrund. Darunter „statt ~~200 ml Rahm~~“ und der Link
    „↺ wie im Original“, der Menge und Zutat zurücksetzt.
  - **ergänzt** (kein Original): grüner Punkt, zartgrüner Hintergrund, darunter „ergänzt“.
  - **weggelassen:** keine Eingabefelder mehr, sondern die durchgestrichene Originalzeile, „weggelassen“ und
    „↺ zurückholen“.
- **`×`:**
  - bei einer Zeile aus dem Original: die Zeile wird **weggelassen**
    (`name = null`, `quantity = null`; das Original bleibt). Title „Weglassen (Original bleibt sichtbar)“.
  - bei einer ergänzten Zeile: die Zeile wird wirklich entfernt.
- **„+ Zutat“** hängt eine leere, ergänzte Zeile an und setzt den Fokus in „Menge“. Enter im Feld „Zutat“ fügt wie
  in `recipe-create` eine neue Zeile an.
- **Leere Felder beim Speichern:**
  - Ergänzte Zeilen ohne Zutat werden ignoriert.
  - Eine Zeile aus dem Original mit leerer Zutat gilt als weggelassen.
- Reihenfolge = Position. Sortieren per Drag & Drop ist nicht Teil dieses Schritts.
- Die Legende „angepasst · ergänzt · weggelassen“ steht unter der Liste, wie in der Detailansicht.
- **Eigene Rezepte** (ohne Link): Das Original ist, wie beim ersten Erfassen eingegeben. Das Verhalten ist dasselbe.

### Buttons und Zustand

- „Speichern“ (primär, orange) und „Abbrechen“ (zurück zur Detailansicht, ohne Rückfrage).
- „Speichern“ ist deaktiviert, solange nichts geändert wurde oder ein Pflichtfeld/Link ungültig ist.
  Während des Speicherns zeigt der Button „Speichere…“.
- Sobald etwas geändert ist, steht rechts „● Ungespeicherte Änderungen“.
- **Nach dem Speichern:** zurück zur Detailansicht, Toast „✓ Rezept gespeichert“.
  `Meals` lädt die Rezepte neu (wie nach `create`).
- **Fehler:** wie in `recipe-create`: „Konnte das Rezept nicht speichern: …“ über den Buttons.

### „Rezept löschen“-Box (nur Eltern)

- Weiße Karte mit hellrotem Rand in der rechten Spalte, auf dem Handy unter der Vorschau.
- Inhalt: „Rezept löschen“, „Entfernt das Rezept samt Bewertungen und Menüplan-Einträgen für die ganze Familie.“
  und der Button „🗑️ Rezept löschen…“ (rot umrandet). Er öffnet denselben Dialog wie in der Detailansicht.

## 3. Rezept löschen (Dialog, nur Eltern)

- **Form:** `role="alertdialog"`. Handy: Bottom-Sheet. Ab 768 px: zentriert (wie der Kauf-Dialog bei den
  Belohnungen). Esc, Klick auf den Scrim und „Abbrechen“ schließen ihn. Der Fokus startet auf „Abbrechen“.
- **Kopf:** Vorschaubild 64 × 64, Titel „Rezept löschen?“, darunter „„Spaghetti Bolognese“ verschwindet für die
  ganze Familie.“
- **Folgen** (hellrote Box). Nur Zeilen, die zutreffen:
  - 📅 „**2 geplante Mahlzeiten** (Do Mittag, Sa Abend) werden aus dem Wochenplan entfernt.“
    Das sind Mahlzeiten ab heute, wie `planned()` in der Detailansicht.
  - ✓ „**7× gekocht** — dieser Verlauf geht verloren.“
  - 👍 „Bewertungen und Wünsche von 3 Personen werden gelöscht.“
  - 🖼️ „Das gespeicherte Foto wird gelöscht.“ Nur wenn das Bild im Bucket `recipe-images` liegt.
- **Unter der Box:** „Das Originalrezept auf Fooby bleibt natürlich bestehen. Löschen lässt sich nicht rückgängig
  machen.“ Der Satz zum Original nur, wenn ein Link gesetzt ist.
- **Buttons:**
  - „Endgültig löschen“ (rot, gefüllt): wird während des Löschens deaktiviert und zeigt „Lösche…“.
  - „Abbrechen“.
- **Nach dem Löschen:** zurück zu `/essen` (die Liste), Toast „🗑️ „Spaghetti Bolognese“ gelöscht“.
  Es gibt **kein Rückgängig**.
- **Fehler:** Der Dialog bleibt offen und zeigt „Konnte das Rezept nicht löschen: …“.

## 4. Datenmodell (neue Supabase-Migration)

Heute dürfen Mitglieder `recipes` lesen, anlegen und ändern, aber nicht löschen. Die Kind-Tabellen
(`recipe_ingredients`, `recipe_ratings`, `recipe_wishes`, `meals` → `meal_wishers`) hängen bereits mit
`on delete cascade` an `recipes`.

### 4.1 Löschen

- `grant delete on public.recipes to authenticated;`
- Policy „Parents can delete their family's recipes“: `for delete using (private.is_family_parent(family_id))`.
- Das Bild im Storage löscht die App nach dem erfolgreichen Löschen der Zeile. Das gilt nur, wenn `image_url` auf den
  Bucket `recipe-images` zeigt: Pfad `<family_id>/<datei>` aus der URL lesen, dann
  `supabase.storage.from('recipe-images').remove([pfad])`. Die Storage-Policy dafür existiert schon.
  Schlägt das fehl, bleibt nur die Datei liegen; das Rezept gilt trotzdem als gelöscht.

### 4.2 Bearbeiten: `public.update_recipe(...)`

Atomar wie `create_recipe`, `security invoker` (RLS greift), `set search_path = ''`.

```
update_recipe(
  p_recipe_id             uuid,
  p_title                 text,
  p_url                   text,
  p_image_url             text,
  p_ingredients_available boolean,
  p_ingredients           jsonb   -- [{id?, quantity, name}, …] in Anzeigereihenfolge
) returns void
```

- Aktualisiert `title`, `url`, `image_url`, `ingredients_available` der Zeile.
- **Zutaten** (leere Strings zählen als fehlend):
  - Eintrag **mit `id`**: `position`, `quantity`, `name` setzen. `name = null` heißt weggelassen.
    Die `original_*`-Spalten bleiben unangetastet (dafür gibt es ohnehin keinen Grant).
  - Eintrag **ohne `id`**: neu einfügen mit `original_* = null`, also ergänzt.
  - **Bestehende Zeile, die im Array fehlt:**
    - Hat sie ein Original, wird sie auf weggelassen gesetzt (`name = null`, `quantity = null`).
    - Ist sie ergänzt, wird sie gelöscht.
    - So kann das Original nie verloren gehen.
  - Zeilen ohne `id` und ohne `name` werden übersprungen.
- Der Sync-Trigger `recipe_ingredients_sync_text` hält `recipes.ingredients` wie bisher nachgeführt.
- `revoke … from public, anon; grant execute … to authenticated;`
- **Altes Bild ersetzen oder entfernen:** Wenn sich `image_url` ändert und das alte Bild im Bucket `recipe-images`
  lag, löscht die App nach dem erfolgreichen Speichern die alte Datei (gleiche Hilfsfunktion wie beim Löschen).

### 4.3 Test

- Neuer SQL-Test `supabase/tests/recipes_edit_test.sql`, im Stil von `rewards_test.sql`:
  - Kind darf nicht löschen.
  - Elternteil darf löschen; Zutaten, Bewertungen und Mahlzeiten verschwinden mit.
  - `update_recipe` setzt geänderte, ergänzte und weggelassene Zeilen richtig, und `original_*` bleibt gleich.
  - Fremde Familie: kein Zugriff.

## 5. App

- `Meals` (`meals.ts`):
  - `updateRecipe(id, form)`: ruft `update_recipe` auf und räumt danach das alte Bild auf.
  - `deleteRecipe(recipe)`: löscht die Zeile, danach das Bild.
  - Beide geben wie die bestehenden Methoden eine Fehlermeldung oder `null` zurück und laden die Rezepte neu.
- **Route** in `app.routes.ts`: `essen/rezept/:id/bearbeiten` mit `authGuard`, `loadComponent` auf `recipe-edit`.
  Kein `parentGuard`, weil Bearbeiten für alle Mitglieder erlaubt ist.
- **Lösch-Dialog:**
  - Als kleine Standalone-Komponente `recipe-delete-dialog`, die Detailansicht und Bearbeiten-Seite beide nutzen.
  - Die Folgen (geplant, gekocht, Bewertungen) kommen aus denselben Daten wie `details` in `recipe-detail.ts`.
    Auf der Bearbeiten-Seite werden sie beim Öffnen geladen.
- **Toast:** Gibt es noch keine gemeinsame Komponente, reicht ein einfacher Status-Text (`role="status"`) auf der
  Zielseite. Die Nachricht wird über den Router-State übergeben.

## 6. MCP-Server (optional, eigener Schritt)

- `update_recipe` und `delete_recipe` analog zu `save_recipe` mit derselben Funktion bzw. Policy.
- `delete_recipe` nur für Eltern („Nur Eltern können Rezepte löschen.“). Vorher kommt eine Rückfrage mit
  denselben Folgen wie im Dialog.

## 7. Design-Regeln

- Nur Tokens aus `src/styles.scss` bzw. denselben Variablen wie `recipe-detail.scss`. Fredoka für Titel, Inter für
  Text, Emojis als Icons.
- Rot (`--danger`) nur für Löschen. Keine „NEU“-Badges; die gelbe gestrichelte Markierung im Prototyp ist nur ein
  Hinweis für die Umsetzung.
- Buttons mind. 44 px hoch, echte `<button>`/`<a>`, `aria-pressed` im `segmented`, `aria-label` für Icon-Buttons
  (`×` mit „Zutat 3 weglassen“ bzw. „Zutat 3 entfernen“).

## 8. Akzeptanzkriterien

- [ ] Detailansicht zeigt „✏️ Bearbeiten“ für alle und „🗑️ Löschen“ nur für Eltern.
- [ ] `/essen/rezept/:id/bearbeiten` lädt das Rezept vorbelegt; Name, Link, Bild, Zutaten und „Zutaten im Haus?“
      lassen sich ändern und speichern.
- [ ] Zutaten-Änderungen erscheinen danach in der Detailansicht als angepasst / ergänzt / weggelassen; das Original
      bleibt in der Datenbank unverändert.
- [ ] Eine weggelassene Original-Zutat lässt sich mit „↺ zurückholen“ wiederherstellen.
- [ ] Löschen zeigt vorher den Dialog mit den zutreffenden Folgen; danach sind Rezept, Zutaten, Bewertungen, Wünsche
      und Mahlzeiten weg, und ein Bild aus `recipe-images` ist gelöscht.
- [ ] Ein Kinder-Konto kann weder über die App noch direkt über die API löschen (RLS).
- [ ] `npm run build` und die bestehenden Tests laufen durch; Migration liegt in `supabase/migrations/`, Test in
      `supabase/tests/`; `TODO.md` ist nachgeführt.

## 9. Vorgeschlagene Reihenfolge

1. Migration: Delete-Grant und -Policy, `update_recipe`, SQL-Test.
2. `Meals`: `updateRecipe`, `deleteRecipe`, Bild-Aufräumen.
3. Formular aus `recipe-create` herauslösen, `recipe-edit` und Route.
4. Lösch-Dialog und Buttons in der Detailansicht.
5. Optional: MCP-Tools.

## Entschieden (Vorschlag, bitte bestätigen)

- Bearbeiten dürfen alle Familienmitglieder, löschen nur Eltern.
- Löschen passiert mit Bestätigungsdialog, ohne Rückgängig. Geplante Mahlzeiten werden mitgelöscht. Der Dialog nennt
  sie ausdrücklich.
- Eine Original-Zutat wird beim Bearbeiten nie gelöscht, nur weggelassen.
