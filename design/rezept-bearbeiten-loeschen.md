# Rezepte bearbeiten und löschen

Spezifikation für den offenen Punkt „Rezepte bearbeiten und löschen“ aus `TODO.md`. Der klickbare Prototyp liegt
unter `design/prototypes/fuxis-plan-rezept-bearbeiten.html`. Er ist verbindlich für Aufbau, Texte und Verhalten.
Farben, Schriften und Komponenten kommen weiterhin aus `src/styles.scss` und den bestehenden Komponenten
(`recipe-detail`, `recipe-create`). Der Prototyp nutzt dieselben Tokens wie `recipe-detail.scss`.

Prototyp testen: Datei im Browser öffnen. Oben wechselt man zwischen den Screens 1 · Rezept, 2 · Bearbeiten und
3 · Löschen. „Menüplan“ schaltet zwischen einem Rezept mit und ohne Mahlzeiten um. Rechts oben wechselt man zwischen
Eltern- und Kinder-Login.

## Ziel

- Eltern können ein Rezept nach dem Import korrigieren: Name, Link, Bild, Zutaten und „Zutaten im Haus?“.
- Zutaten-Änderungen bleiben als Abweichung vom Original sichtbar, wie es `recipe_ingredients` heute schon vorsieht:
  „statt …“, „ergänzt“, „weggelassen“.
- Eltern können ein Rezept endgültig löschen, aber nur, solange es nie auf dem Menüplan stand.
  Hat es Mahlzeiten (geplant oder gekocht), ist Löschen gesperrt.
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
- **Sichtbarkeit:** Die ganze Zeile nur bei Eltern-Login (`TaskPool.isParent()`). Bei Kinder-Login fehlt sie,
  die Detailansicht sieht dann aus wie heute.
- „Löschen“ ist auch bei einem Rezept mit Mahlzeiten sichtbar und aktiv. Der Dialog erklärt dann, warum es nicht
  geht (Abschnitt 3).
- Die sticky Aktionsleiste unten (Einplanen / Heute gekocht) und die übrigen Bereiche bleiben unverändert.
- Mindesthöhe der Buttons: 44 px.

## 2. Rezept bearbeiten (`/essen/rezept/:id/bearbeiten`, neu)

- **Route:** eigene Seite (kein Overlay) mit `authGuard` und `parentGuard`, gleich aufgebaut wie `/essen/neu`
  (`recipe-create`).
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

### „Rezept löschen“-Box

- Weiße Karte mit hellrotem Rand in der rechten Spalte, auf dem Handy unter der Vorschau.
- Inhalt: „Rezept löschen“, „Geht nur, solange das Rezept nie auf dem Menüplan stand.“ und der Button
  „🗑️ Rezept löschen…“ (rot umrandet). Er öffnet denselben Dialog wie in der Detailansicht.

## 3. Rezept löschen (Dialog, nur Eltern)

- **Form:** `role="alertdialog"`. Handy: Bottom-Sheet. Ab 768 px: zentriert (wie der Kauf-Dialog bei den
  Belohnungen). Esc, Klick auf den Scrim und der zweite Button schließen ihn. Der Fokus startet auf dem zweiten
  Button („Schliessen“ bzw. „Abbrechen“).
- **Regel:** Ein Rezept lässt sich nur löschen, wenn es **keine einzige Mahlzeit** in `meals` hat, weder geplante
  (ab heute) noch gekochte (vor heute). Beim Öffnen des Dialogs wird das frisch geprüft.

### Variante A: Rezept hat Mahlzeiten → gesperrt

- **Kopf:** Vorschaubild 64 × 64, Titel „Löschen geht nicht“, darunter „„Spaghetti Bolognese“ steht auf dem
  Menüplan.“
- **Gelbe Box** (`--bernstein-hell`, nicht rot, weil nichts passiert). Nur Zeilen, die zutreffen:
  - 📅 „**2 geplante Mahlzeiten** (Do Mittag, Sa Abend)“
  - ✓ „**7× gekocht**“
- **Text:** „Ein Rezept mit Mahlzeiten bleibt erhalten, damit Wochenplan und Verlauf stimmen. Nimm es zuerst aus dem
  Wochenplan heraus.“
- **Buttons:**
  - „📅 Zum Wochenplan“ (primär): führt zu `/essen/wochenplan`.
  - „Schliessen“.

### Variante B: keine Mahlzeiten → löschen

- **Kopf:** Vorschaubild, Titel „Rezept löschen?“, darunter „„Spaghetti Bolognese“ ist danach für die ganze Familie
  weg.“
- **Hellrote Box** mit dem, was mitgelöscht wird. Nur Zeilen, die zutreffen:
  - 🧺 „Zutaten und Abweichungen“
  - 👍 „Bewertungen und Wünsche von 3 Personen“
  - 🖼️ „Das gespeicherte Foto“: nur wenn das Bild im Bucket `recipe-images` liegt.
- **Text:** „Das lässt sich nicht rückgängig machen. Das Originalrezept auf Fooby bleibt bestehen.“ Den zweiten Satz
  nur, wenn ein Link gesetzt ist.
- **Buttons:**
  - „Endgültig löschen“ (rot, gefüllt): wird während des Löschens deaktiviert und zeigt „Lösche…“.
  - „Abbrechen“.
- **Nach dem Löschen:** zurück zu `/essen` (die Liste), Toast „🗑️ „Spaghetti Bolognese“ gelöscht“.
  Es gibt **kein Rückgängig**; das Rezept ist weg.
- **Fehler:** Der Dialog bleibt offen und zeigt „Konnte das Rezept nicht löschen: …“.
  - Ist inzwischen eine Mahlzeit dazugekommen, antwortet die Datenbank mit einem Fehler (siehe 4.1).
    Der Dialog wechselt dann auf Variante A.

## 4. Datenmodell (neue Supabase-Migration)

Heute gilt für alle Mitglieder:

- Sie dürfen `recipes` lesen, anlegen und ändern, aber nicht löschen.
- Sie dürfen alle Zutaten ändern und löschen.

Die Kind-Tabellen (`recipe_ingredients`, `recipe_ratings`, `recipe_wishes`, `meals` → `meal_wishers`) hängen mit
`on delete cascade` an `recipes`.

### 4.1 Löschen: nur Eltern, nur ohne Mahlzeiten

- `grant delete on public.recipes to authenticated;`
- Policy „Parents can delete their family's recipes“:
  `for delete using (private.is_family_parent(family_id))`.
- **Mahlzeiten sperren das Löschen:** Der Fremdschlüssel `meals.recipe_id` wechselt von `on delete cascade` auf
  `on delete restrict`.
  - Dann schlägt ein Löschen mit Mahlzeiten auf jeden Fall fehl, auch direkt über die API oder den MCP-Server
    (Fehlercode `23503`).
  - Die App übersetzt ihn in Variante A.
  - Die übrigen Kind-Tabellen bleiben `on delete cascade`.
- Das Bild im Storage löscht die App nach dem erfolgreichen Löschen der Zeile. Das gilt nur, wenn `image_url` auf den
  Bucket `recipe-images` zeigt: Pfad `<family_id>/<datei>` aus der URL lesen, dann
  `supabase.storage.from('recipe-images').remove([pfad])`. Die Storage-Policy dafür existiert schon.
  Schlägt das fehl, bleibt nur die Datei liegen; das Rezept gilt trotzdem als gelöscht.

### 4.2 Bearbeiten: nur Eltern

**Rechte anpassen:**
- `recipes`:
  - Das Update-Grant für `authenticated` wird auf `ingredients_available` beschränkt
    (`revoke update … ; grant update (ingredients_available) …`).
  - Grund: Den Schalter „Zutaten da / fehlt was“ in der Rezeptliste (`Meals.setAvailable`) dürfen weiterhin alle
    Mitglieder bedienen.
  - Name, Link und Bild ändert nur noch `update_recipe`.
- `recipe_ingredients`:
  - Die Policies für update und delete werden auf `private.is_family_parent(family_id)` umgestellt.
  - Insert bleibt für alle Mitglieder, weil `create_recipe` beim Anlegen Zutaten einfügt.

**Funktion `public.update_recipe(...)`:** `security definer`, `set search_path = ''`. Sie prüft selbst, dass der
Aufrufer Elternteil in der Familie des Rezepts ist; sonst gibt es den Fehler „Nur Eltern können Rezepte bearbeiten.“

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
  - Eintrag **mit `id`** (muss zum Rezept gehören): `position`, `quantity`, `name` setzen. `name = null` heißt
    weggelassen. Die `original_*`-Spalten bleiben unangetastet.
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
  - **Kinder-Konto:**
    - `update_recipe` schlägt fehl.
    - Title per `update` direkt schlägt fehl.
    - Löschen schlägt fehl.
    - `ingredients_available` umschalten geht weiterhin.
  - **Elternteil, Rezept ohne Mahlzeiten:** Löschen geht; Zutaten, Bewertungen und Wünsche verschwinden mit.
  - **Elternteil, Rezept mit einer vergangenen oder geplanten Mahlzeit:** Löschen schlägt fehl (`23503`), nichts
    ist weg.
  - `update_recipe` setzt geänderte, ergänzte und weggelassene Zeilen richtig, und `original_*` bleibt gleich.
  - Fremde Familie: kein Zugriff.
  - `create_recipe` funktioniert für Kinder weiterhin.

## 5. App

- `Meals` (`meals.ts`):
  - `updateRecipe(id, form)`: ruft `update_recipe` auf und räumt danach das alte Bild auf.
  - `deleteRecipe(recipe)`: löscht die Zeile, danach das Bild.
  - Beide geben wie die bestehenden Methoden eine Fehlermeldung oder `null` zurück und laden die Rezepte neu.
- **Route** in `app.routes.ts`: `essen/rezept/:id/bearbeiten` mit `authGuard` und `parentGuard`,
  `loadComponent` auf `recipe-edit`.
- **Lösch-Dialog:**
  - Als kleine Standalone-Komponente `recipe-delete-dialog`, die Detailansicht und Bearbeiten-Seite beide nutzen.
  - Beim Öffnen lädt er die Mahlzeiten (`meals` für `recipe_id`) und die Bewertungen neu.
  - Sind Mahlzeiten da, kommt Variante A, sonst Variante B.
- **Toast:** Gibt es noch keine gemeinsame Komponente, reicht ein einfacher Status-Text (`role="status"`) auf der
  Zielseite. Die Nachricht wird über den Router-State übergeben.

## 6. MCP-Server (optional, eigener Schritt)

- `update_recipe` und `delete_recipe` analog zu `save_recipe` mit derselben Funktion bzw. Policy.
- Beide Tools nur für Eltern („Nur Eltern können Rezepte bearbeiten.“ / „… löschen.“).
- `delete_recipe` lehnt ein Rezept mit Mahlzeiten mit derselben Erklärung ab wie Variante A. Sonst gibt es vorher
  eine Rückfrage.

## 7. Design-Regeln

- Nur Tokens aus `src/styles.scss` bzw. denselben Variablen wie `recipe-detail.scss`. Fredoka für Titel, Inter für
  Text, Emojis als Icons.
- Rot (`--danger`) nur für Löschen. Keine „NEU“-Badges; die gelbe gestrichelte Markierung im Prototyp ist nur ein
  Hinweis für die Umsetzung.
- Buttons mind. 44 px hoch, echte `<button>`/`<a>`, `aria-pressed` im `segmented`, `aria-label` für Icon-Buttons
  (`×` mit „Zutat 3 weglassen“ bzw. „Zutat 3 entfernen“).

## 8. Akzeptanzkriterien

- [ ] Detailansicht zeigt „✏️ Bearbeiten“ und „🗑️ Löschen“ nur für Eltern; Kinder sehen die Zeile nicht.
- [ ] `/essen/rezept/:id/bearbeiten` ist nur für Eltern erreichbar (`parentGuard`). Die Seite lädt das Rezept
      vorbelegt; Name, Link, Bild, Zutaten und „Zutaten im Haus?“ lassen sich ändern und speichern.
- [ ] Kinder können Rezepte weiterhin anlegen und „Zutaten da / fehlt was“ umschalten, aber nichts anderes ändern
      (auch nicht direkt über die API).
- [ ] Zutaten-Änderungen erscheinen danach in der Detailansicht als angepasst / ergänzt / weggelassen; das Original
      bleibt in der Datenbank unverändert.
- [ ] Eine weggelassene Original-Zutat lässt sich mit „↺ zurückholen“ wiederherstellen.
- [ ] Rezept mit mindestens einer Mahlzeit (geplant oder gekocht): Der Dialog zeigt „Löschen geht nicht“, und auch
      ein direktes `delete` über die API schlägt fehl.
- [ ] Rezept ohne Mahlzeiten: Nach „Endgültig löschen“ sind Rezept, Zutaten, Bewertungen und Wünsche weg, und ein Bild
      aus `recipe-images` ist gelöscht.
- [ ] Ein Kinder-Konto kann weder über die App noch direkt über die API löschen (RLS).
- [ ] `npm run build` und die bestehenden Tests laufen durch; Migration liegt in `supabase/migrations/`, Test in
      `supabase/tests/`; `TODO.md` ist nachgeführt.

## 9. Vorgeschlagene Reihenfolge

1. Migration: Delete-Grant und -Policy, `meals.recipe_id` auf `restrict`, Update-Rechte einschränken,
   `update_recipe`, SQL-Test.
2. `Meals`: `updateRecipe`, `deleteRecipe`, Bild-Aufräumen.
3. Formular aus `recipe-create` herauslösen, `recipe-edit` und Route.
4. Lösch-Dialog und Buttons in der Detailansicht.
5. Optional: MCP-Tools.

## Entschieden

- Bearbeiten und Löschen dürfen nur Eltern. Kinder sehen die Buttons nicht.
- Löschen ist endgültig, ohne Rückgängig.
- Ein Rezept mit Mahlzeiten (geplant oder gekocht) lässt sich nicht löschen. Die Datenbank erzwingt das mit
  `on delete restrict`.
- Eine Original-Zutat wird beim Bearbeiten nie gelöscht, nur weggelassen.
