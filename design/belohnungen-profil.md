# Belohnungen, Profil und Personenwahl

Spezifikation für die nächste Ausbaustufe von Fuxis Plan. Der klickbare Prototyp liegt unter
`design/prototypes/fuxis-plan-belohnungen.html`. Er ist verbindlich für Aufbau, Texte und Verhalten.
Farben, Schriften und Komponenten kommen weiterhin aus `src/styles.scss` und den bestehenden
Komponenten. Die CSS-Klassen im Prototyp sind bewusst gleich benannt wie in der App
(`fam-chip`, `task-card`, `assigned-card`, `task-row`, `stat-tile`, `segmented` usw.).

Prototyp testen: Datei im Browser öffnen. Standard ist ein Eltern-Login (Mama).
Mit `#mia` oder `#leo` am Ende der Adresse sieht man den Kinder-Login.

## Ziel

- Kinder können gesammelte Sterne gegen Belohnungen eintauschen, z. B. 20 ⭐ für 5 Minuten Tabletzeit.
- Jeder Kauf wird festgehalten und erscheint im Profil der Person als Abzug.
- Ein Elternteil hakt ab, wenn die Belohnung eingelöst wurde.
- Eltern pflegen Belohnungen und Preise in der App („Belohnungen verwalten“) oder per Claude über den MCP-Server.
- Eine Personenwahl oben ersetzt die Familien-Chips und macht die Seiten persönlich.

## 1. Navigation

- Menüpunkte (oben als Pills, auf dem Handy als Bottom-Bar):
  `🗂️ Aufgaben-Pool` (`/tasks`), `🎁 Belohnungen` (`/belohnungen`), `👤 Profil` (`/profil`), `🍝 Essen` (`/essen`).
- **Kalender entfernen:** Menüpunkt und Route `/kalender` fallen weg (Redirect auf `/tasks`).
- **Badge an „Belohnungen“:** Nur für Eltern-Logins. Zeigt die Anzahl gekaufter, noch nicht eingelöster Belohnungen der ganzen Familie.
- Rechts bleiben `🔒 Familie verwalten` (nur Eltern) und `👋 Abmelden`. Es gibt keine Anzeige des angemeldeten Kontos.

## 2. Personenwahl (braune Leiste)

- Neue Leiste ganz oben, über der Navigation. Klebt beim Scrollen oben: `position: sticky; top: env(safe-area-inset-top, 0px)`.
- **Hintergrund und Pills:** Hintergrund `var(--brown)`. Die Pills stehen in einer halbtransparenten Gruppe; die aktive Pill ist weiß.
- **Inhalt:** `Alle` (👨‍👩‍👧‍👦, ohne Zahl), danach jedes Familienmitglied in `sort_order`.
- **Aufbau einer Pill:** Emoji-Avatar in der Personenfarbe (`av-*`). Rechts davon zwei Zeilen: Name, darunter `85 ⭐`.
  - Die Zahl ist für **alle** das Guthaben: Summe aller je verdienten Sterne minus eingelöste Belohnungen (siehe 6.3).
  - Keine weiteren Texte (kein „Wer ist dran?“, kein „Guthaben“, kein „ganze Familie“).
- **Handy:** Die Leiste scrollt seitlich. Die aktive Pill wird nach jedem Wechsel ins Sichtfeld gescrollt.
- **Rolle kommt vom Login** (`TaskPool.me()` bzw. `family_members.user_id = auth.uid()`). Keine PIN.
  - **Eltern-Login:**
    - Freier Wechsel zwischen `Alle` und allen Personen, auch wenn gerade ein Kind gewählt ist.
    - Die Eltern-Funktionen (abhaken, stornieren, verwalten, neue Aufgabe) bleiben aktiv, auch wenn ein Kind gewählt ist.
  - **Kinder-Login:**
    - Die Leiste zeigt nur die eigene Pill, ohne Klick.
    - Kein `Alle`, kein Wechsel.
    - Die Auswahl ist fest das eigene Mitglied.
- **Zustand:** Die gewählte Person liegt in einem Signal, z. B. `selectedMemberId: Signal<string | null>`, `null` = Alle. Pro Gerät in `localStorage` merken; bei Kinder-Login ignorieren.

## 3. Aufgaben-Pool (`/tasks`)

- Die bisherige Familien-Chip-Reihe (`family-strip`) wird entfernt.
- **Auswahl „Alle“:** Die Seite bleibt wie heute: Titel „Aufgaben-Pool“, alle Karten, „Ich mach’s!“/„+ Mitmachen“ mit Personenauswahl, „Immer wieder“, Eltern-Buttons „Verwalten“ und „+ Neue Aufgabe“.
- **Person gewählt:** Drei Bereiche untereinander.
  1. **„Mias Aufgaben“** (Genitiv wie `possessive()` in `progress.ts`)
     - Untertitel: „übernommen — abhaken, wenn’s erledigt ist“.
     - Inhalt: alle Einträge, bei denen die Person Teilnehmer ist, auch bereits erledigte (bis sie nach `DONE_VISIBLE_MS` verschwinden).
     - Leer: „Noch nichts übernommen — nimm dir unten eine freie Aufgabe 🦊“.
  2. **„Noch frei“** (Icon 🙋)
     - Untertitel: „noch niemand hat sie genommen — tipp auf „Ich mach’s!““.
     - Inhalt: alle Einträge ohne Teilnehmer.
     - „Ich mach’s!“ übernimmt **direkt** für die gewählte Person, ohne Auswahl-Popup.
     - Leer: „Alles vergeben — super! 🎉“.
  3. **„Immer wieder“:** alle wiederholbaren Aufgaben.
     - „✓ Erledigt!“ zählt direkt für die gewählte Person.
     - „↩︎“ nimmt deren letzte Erledigung von heute zurück.
- **„+ Mitmachen“:** Wird nur bei „Alle“ angezeigt.
- **Kinder-Login, geteilte Aufgaben:** Nur der eigene Teil lässt sich abhaken oder verlassen. Die Teile der anderen sind sichtbar, aber deaktiviert.
- Die Aufgabenkarten selbst bleiben unverändert: Avatare oben rechts, gestrichelter Rahmen für freie Aufgaben, Teilnehmer-Buttons.

## 4. Belohnungen (`/belohnungen`, neu)

- **Kopf:** Titel „Belohnungen“, Untertitel „Tausche deine Sterne ein“.
- **Hero** (Verlauf `amber → orange`, Fuxi-Avatar):
  - Kind gewählt: „Mia hat 85 ⭐“ und ein Fuxi-Satz zur nächsten, noch nicht erreichbaren Belohnung, z. B. „Noch 65 ⭐ bis Ausflug wählen!“. Wenn alles erreichbar ist: „Du kannst dir alles aussuchen!“.
  - `Alle` oder Elternteil gewählt: brauner Hero „Wer möchte einlösen?“ / „Wähl oben in der braunen Leiste ein Kind aus.“ Die Karten sind dann nur zur Ansicht, nicht klickbar.
- **Eltern-Buttons im Kopf** (wie im Aufgaben-Pool): „Verwalten“ → `/belohnungen/verwalten`, „+ Neue Belohnung“ → `/belohnungen/neu`.
- **Kategorien:** `segmented` mit Alle / Bildschirm / Essen / Erlebnisse. Angezeigt werden nur aktive Belohnungen.
- **Karten-Raster:** Karte mit Emoji-Kachel (`tile-*`), Name, Einheit/Beschreibung und Preis-Pill „20 ⭐“. Reicht das Guthaben nicht, ist die Karte gedimmt und zeigt „noch 65 ⭐“.
- **Dialog** (Handy: Bottom-Sheet, Desktop: zentriert):
  - Inhalt: Emoji, Name, „5 Minuten für 20 ⭐“, Chip „für Mia“.
  - Bei Belohnungen „in Einheiten“ ein Stepper wie `app-reward-stepper` (1 bis `max_quantity`), darunter „= 15 Minuten“.
  - Danach eine Box „Kostet 60 ⭐“ und „Danach bleiben 25 ⭐“ bzw. rot „Es fehlen noch … ⭐“.
  - Button „Einlösen“ (deaktiviert, wenn nicht genug Sterne) und „Abbrechen“.
- **Nach dem Kauf:**
  - Anzeige „Gekauft!“ mit „15 Minuten Tabletzeit für Mia“.
  - Hinweis „Einlösen, sobald Mama oder Papa es in Mias Profil abhakt.“ und das neue Guthaben.
  - Buttons „Super!“ und „Zu Mias Profil“.
- **Wer darf kaufen:** Kinder für sich selbst. Eltern für sich selbst und für ein gewähltes Kind (gemeinsames Gerät). Nur bei „Alle“ sind die Karten zur Ansicht.

## 5. Profil (`/profil`, ersetzt `/fortschritt/:memberId`)

- `/fortschritt/:memberId` leitet auf `/profil` weiter und setzt dabei die Personenwahl auf dieses Mitglied (bestehende Links funktionieren weiter).
- Das Profil zeigt immer die in der braunen Leiste gewählte Person. Es gibt keine eigene Personenauswahl und keinen „Zurück“-Link.
- **„Zugewiesene Aufgaben“ entfällt** (steht im Aufgaben-Pool).
- **Aufbau bei einem Kind:**
  1. **Kopf:** Avatar, Name, Untertitel „Sterne, Aufgaben und Belohnungen im Überblick“.
  2. **„Offene Belohnungen“:** gekaufte, noch nicht eingelöste Käufe als `assigned-card`: Emoji, Titel, „−60 ⭐ · heute“.
     - Eltern-Login: runder ✓-Button wie `a-check`. Beim Klick verschwindet die Karte animiert (`leaving`) und der Kauf gilt als eingelöst.
     - Kinder-Login: Text „wartet auf Mama/Papa“.
     - Leer: „Keine offenen Belohnungen 🎁“.
  3. **„Statistik“:** vier Kacheln: **Guthaben** (goldene Kachel), Sterne diese Woche, Aufgaben erledigt, Bester Tag.
  4. **„Verdiente Sterne“:** Diagramm unverändert.
  5. **„Sterne-Verlauf“** (bisher „Erledigte Aufgaben“):
     - `segmented` mit Alle / Verdient / Eingelöst.
     - Die bisherigen Einträge „+2 ⭐“ bleiben, gemischt mit den Käufen, nach Zeit sortiert und nach Tag gruppiert.
     - Kauf-Zeile: Emoji, Titel „Tabletzeit · 15 Minuten“, „gekauft um 14:10 Uhr · noch nicht eingelöst“ (orange) oder „✓ eingelöst, abgehakt von Mama“ (grün). Rechts „−60 ⭐“ in Braun.
     - Eltern: `🗑️` bei verdienten Einträgen wie bisher. Bei noch nicht eingelösten Käufen `↩️` zum Stornieren, mit zwei Klicks wie `t-remove` („Storno?“, rot). Beim Stornieren kommen die Sterne zurück.
- **Aufbau bei einem Elternteil:**
  - Kopf.
  - „Offene Belohnungen der Kinder“: alle Kinder, mit „🦊 Mia · −60 ⭐ · heute“, abhakbar.
  - Statistik mit allen vier Kacheln (auch Guthaben).
  - Diagramm.
  - Verlauf nur mit verdienten Sternen.
- **Bei „Alle“:**
  - Brauner Hero „Wessen Profil?“ / „Wähl oben in der braunen Leiste eine Person aus.“
  - Darunter „Offene Belohnungen der Kinder“.

## 5a. Belohnungen verwalten (neu, nur Eltern)

Aufbau und Verhalten 1:1 wie „Aufgaben verwalten“ (`task-admin`) und „Neue Aufgabe“ (`task-create`).
Beide Routen mit `authGuard` und `parentGuard`.

### `/belohnungen/verwalten`

- „← Zurück zu den Belohnungen“, Titel „Belohnungen verwalten“, Untertitel „Preise, Einheiten und bisherige Einlösungen“, rechts „🔒 Nur für Eltern sichtbar“.
- Filter-Tabs Alle / Aktiv / Archiviert und rechts „+ Neue Belohnung“.
- Hinweis darunter: „💬 Geht auch mit Claude: „Leg eine Belohnung an: 10 Minuten Gamezeit für 40 Sterne.““
- **Zeile pro Belohnung:**
  - Links: Emoji-Kachel, Name und Badges (Kategorie, „In Einheiten“, „Archiviert“).
  - Darunter: „bis 6× pro Kauf · 14× eingelöst“ bzw. die Beschreibung.
  - Rechts: „20 ⭐“ mit „pro 5 Minuten“ bzw. „pro Kauf“.
- **Aktionen:**
  - ✏️ Bearbeiten: Die Zeile klappt inline zum Formular auf, wie bei den Aufgaben.
  - 🗄️ Archivieren: zwei Klicks wie beim Löschen von Aufgaben (erst rot „✓“). Archivierte verschwinden aus dem Shop, Käufe bleiben erhalten.
  - ↩️ Wiederherstellen: bei archivierten Belohnungen.
  - ▾ Einlösungen: klappt eine Liste auf mit Person, Menge, Zeitpunkt, Status und Kosten der letzten 30 Tage.

### `/belohnungen/neu`

- Zweispaltig: links das Formular in einer Karte, rechts „Vorschau im Shop“ (die Shop-Karte, live aktualisiert). Auf dem Handy steht die Vorschau oben.

### Formular (neu und bearbeiten gleich)

| Feld | Eingabe | Regeln |
|---|---|---|
| Name der Belohnung | Textfeld | Pflicht, 1–40 Zeichen, pro Familie eindeutig unter den aktiven |
| Symbol | Emoji-Swatches wie bei Aufgaben (Kachel in gewählter Farbe) | Auswahl: 📱 🎮 📺 🎧 🍨 🍕 🧁 🍿 🌙 🎬 🏞️ 🎲 🎨 ⚽ 🏊 🎁 |
| Farbe | 6 Farbkreise (`mint` … `lemon`) | |
| Kategorie | `segmented`: Bildschirm / Essen / Erlebnisse | |
| Preis | Stepper −/+ **in 5er-Schritten**, Zahl direkt eintippbar | ganze Zahl 1–999 |
| Art | zwei Karten wie „Aufgabentyp“: **Pro Kauf** / **In Einheiten** | |
| Menge pro Einheit | Zahl (nur „In Einheiten“) | 1–999, z. B. 5 |
| Einheit | Text (nur „In Einheiten“) | Pflicht, z. B. „Minuten“, „Folge“ (Mehrzahl: „Folge“ → „Folgen“) |
| Höchstens pro Kauf | Stepper 1–10 (nur „In Einheiten“) | Standard 6 |
| Beschreibung | Text, optional (nur „Pro Kauf“) | bis 40 Zeichen, z. B. „beim Abendessen“ |

- **Zusammenfassung unter den Feldern**, gelb hinterlegt, live, z. B. „Im Shop: 20 ⭐ für 5 Minuten · bis 6× pro Kauf = 30 Minuten für 120 ⭐.“
- **Hinweis beim Bearbeiten:** „Neue Preise gelten ab sofort für neue Käufe. Bereits gekaufte Belohnungen behalten ihren Preis.“
- **Buttons:** „Belohnung erstellen“ bzw. „Speichern“ (deaktiviert, solange Pflichtfelder fehlen) und „Abbrechen“.

## 6. Datenmodell (neue Supabase-Migration)

### 6.1 `public.rewards`

| Spalte | Typ | Hinweis |
|---|---|---|
| `id` | uuid pk | |
| `family_id` | uuid → families | |
| `title` | text | „Tabletzeit“ |
| `emoji` | text | „📱“ |
| `color` | text | wie `tasks.color` (`mint`…`lemon`) |
| `category` | text | `screen` \| `food` \| `fun` |
| `price` | int > 0 | Sterne pro Einheit |
| `unit_amount` | int null | z. B. `5`; gesetzt = Art „In Einheiten“, null = „Pro Kauf“ |
| `unit_label` | text null | „Minuten“, „Folge“ (nur bei Einheiten) |
| `description` | text null | z. B. „beim Abendessen“ (nur „Pro Kauf“) |
| `max_quantity` | int 1–10 default 1 | bei Einheiten Standard 6, sonst 1 |
| `is_active` | bool default true | archivierte Belohnungen ausblenden |
| `sort_order` | int | |
| `created_at` | timestamptz | |

- **RLS lesen:** Familienmitglieder (`public.is_family_member`).
- **RLS schreiben:** nur Eltern (`private.is_family_parent`).
- Checks in der Tabelle: `price between 1 and 999`, `unit_amount is null or unit_amount between 1 and 999`, `(unit_amount is null) = (unit_label is null)`, `max_quantity between 1 and 10`, bei `unit_amount is null` gilt `max_quantity = 1`.
- Eindeutiger Index auf `(family_id, lower(title)) where is_active`.

**Startdaten:** Keine festen Werte. Für die Entwicklung genügt ein Seed mit den Beispielen aus dem Prototyp (Tabletzeit, Gamezeit, Serienfolge, Dessert aussuchen, Wunsch-Menü, Länger aufbleiben, Filmabend, Ausflug wählen). Alle Preise sind Beispiele; die Familie legt sie selbst fest.

### 6.2 `public.reward_purchases`

| Spalte | Typ | Hinweis |
|---|---|---|
| `id` | uuid pk | |
| `family_id` | uuid | |
| `member_id` | uuid → family_members | Wer eingelöst hat |
| `reward_id` | uuid → rewards, null bei Löschung | |
| `title`, `emoji`, `color` | text | Kopie zum Kaufzeitpunkt |
| `quantity` | int 1–`max_quantity` | |
| `label` | text | z. B. „Tabletzeit · 15 Minuten“ |
| `cost` | int > 0 | Kopie: `price × quantity` |
| `purchased_at` | timestamptz default now() | |
| `redeemed_at` | timestamptz null | gesetzt beim Abhaken |
| `redeemed_by` | uuid → family_members null | Elternteil, das abgehakt hat |

- **RLS lesen:** Familienmitglieder.
- **Schreiben:** nur über die Funktionen unten (kein direktes insert/update/delete für `authenticated`).
- **Stornieren** löscht den Kauf (analog `remove_done_entry`), dadurch kommen die Sterne zurück.

### 6.3 Guthaben

- **View `public.member_balance`** (`security_invoker = true`), für **alle** Mitglieder (Kinder und Eltern):
  `sum(claim_rewards.stars where is_done)` über **alle Zeit** minus `sum(reward_purchases.cost)` pro Mitglied.
- Dieses Guthaben wird überall angezeigt, wo „Sterne einer Person“ stehen: braune Leiste, Profil-Kachel „Guthaben“, Belohnungen-Hero, MCP `list_family_members`.
  `claim_rewards` enthält bereits die „Immer wieder“-Erledigungen und lässt gelöschte Einträge weg.
- **Negatives Guthaben:** Wenn Eltern nachträglich einen Eintrag löschen, kann das Guthaben negativ werden. Das ist erlaubt und wird angezeigt; Käufe sind dann gesperrt.

### 6.4 Funktionen (security definer, `set search_path = ''`)

- **`redeem_reward(p_member_id uuid, p_reward_id uuid, p_quantity int) returns uuid`**
  - Prüft: gleiche Familie, Belohnung aktiv, Menge 1 bis `max_quantity`.
  - Prüft das Guthaben mit Sperre (`for update` auf das Mitglied), damit es keine Doppelkäufe gibt.
  - Kinder-Login darf nur für sich selbst kaufen; Eltern-Login für jedes Kind.
  - Legt den Kauf an.
- **`confirm_redemption(p_purchase_id uuid) returns boolean`:** Nur Eltern. Setzt `redeemed_at` und `redeemed_by`.
- **`cancel_purchase(p_purchase_id uuid) returns boolean`:** Nur Eltern, nur wenn noch nicht eingelöst. Löscht den Kauf.

### 6.5 Kinder-Login

- Heute haben Kinder kein Konto (`family_members.user_id` ist null).
- Damit der Kinder-Modus greift, muss ein Kind mit einem eigenen Supabase-Konto verknüpft werden können. Das geschieht in „Familie verwalten“ analog zu den Eltern.
- Die Rolle bleibt `family_members.role`.
- **RLS-Anpassung für Kinder-Logins:**
  - Beitreten, Abhaken, Verlassen (`task_claims`) und Erledigen (`task_completions`) nur für das **eigene** Mitglied.
  - Eltern dürfen weiterhin für alle handeln.

## 7. MCP-Server: Belohnungen erfassen (`mcp-server/src/index.ts`)

### 7.1 Allgemein

- Gleicher Stil wie die bestehenden Tools (`create_task`, `list_tasks`, …): `server.registerTool`, Eingaben mit `zod`, Zugriff mit dem OAuth-Token des Nutzers (RLS greift).
- **Rechte:**
  - Das angemeldete Konto wird über `family_members.user_id` einem Mitglied zugeordnet.
  - Alle schreibenden Tools und `confirm_redemption` sind nur für Eltern erlaubt, sonst Fehler „Nur Eltern können Belohnungen ändern.“ (zusätzlich durch RLS abgesichert).
  - `list_rewards` und `list_open_redemptions` dürfen alle Familienmitglieder.
- **Antworten:** kurz, auf Deutsch, sprechbar (Server-Instructions). Immer mit Emoji, Name, Einheit und Preis, z. B. „Gespeichert: 🎮 Gamezeit — 10 Minuten für 40 ⭐, bis 6× pro Kauf.“
- **Nichts erfinden:** Fehlt der Preis oder der Name, fragt Claude nach. Fehlen nur Emoji, Farbe oder Kategorie, setzt der Server Standardwerte: Emoji nach Kategorie (Bildschirm 📱, Essen 🍨, Erlebnisse 🎁), sonst 🎁, Farbe `peach`, Kategorie `fun`. Die gewählten Werte stehen in der Antwort.
- **Belohnungen per Name finden:** Tools mit `reward` akzeptieren ID oder Namen (Groß-/Kleinschreibung egal). Bei mehreren Treffern kommt eine Rückfrage mit den Kandidaten.

### 7.2 Tools

**`list_rewards`**
- Eingabe: `include_archived?: boolean` (Standard `false`), `category?: 'screen' | 'food' | 'fun'`.
- Ausgabe pro Belohnung: Emoji, Name, Kategorie, Preis, Einheit („pro 5 Minuten, bis 6×“ bzw. „pro Kauf“), Beschreibung, Anzahl Einlösungen der letzten 30 Tage, archiviert ja/nein, ID.

**`create_reward`**
- Eingabe:
  - `title` (Pflicht, 1–40)
  - `price` (Pflicht, ganze Zahl 1–999)
  - `emoji?`, `color?`, `category?`
  - `unit_amount?` (1–999) und `unit_label?` (nur zusammen) für Belohnungen in Einheiten, `max_quantity?` (1–10, Standard 6)
  - `description?` (nur ohne Einheit, bis 40)
- Fehler, wenn eine aktive Belohnung mit gleichem Namen existiert. Die Antwort nennt sie und schlägt `update_reward` vor.
- Beispiele:
  - „Leg eine Belohnung an: 10 Minuten Gamezeit für 40 Sterne.“ → `title: "Gamezeit", price: 40, unit_amount: 10, unit_label: "Minuten", category: "screen"`
  - „Neue Belohnung Pizza-Abend für 80 Sterne.“ → `title: "Pizza-Abend", price: 80, category: "food"`

**`update_reward`**
- Eingabe: `reward` (ID oder Name, Pflicht) plus beliebige Felder aus `create_reward`. Nur die angegebenen Felder werden geändert.
- `unit_amount: null` macht aus einer Einheiten-Belohnung eine „Pro Kauf“-Belohnung (dann `max_quantity = 1`).
- Die Antwort zeigt vorher → nachher, z. B. „Tabletzeit: 20 ⭐ → 25 ⭐ pro 5 Minuten.“
- Bestehende Käufe bleiben unverändert (Preis ist im Kauf gespeichert).

**`archive_reward`** / **`restore_reward`**
- Eingabe: `reward` (ID oder Name).
- Archivieren blendet die Belohnung im Shop aus. Käufe und Verlauf bleiben erhalten.
- Wiederherstellen schlägt fehl, wenn inzwischen eine aktive Belohnung mit gleichem Namen existiert.

**`list_open_redemptions`**
- Eingabe: `member?` (ID oder Name, optional).
- Ausgabe: gekaufte, noch nicht eingelöste Belohnungen pro Kind mit Menge, Kosten und Kaufzeitpunkt, z. B. „🦊 Mia: Tabletzeit · 15 Minuten (−60 ⭐, heute 14:10)“.

**`confirm_redemption`**
- Eingabe: `purchase_id` oder `member` + `reward`.
- Ruft `confirm_redemption()` auf, damit „Mia hat ihre Tabletzeit eingelöst“ per Sprache abgehakt werden kann.
- Gibt es mehrere offene Käufe, wird der älteste abgehakt und die Antwort nennt ihn.

**Bestehende Tools ergänzen**
- `list_family_members`: statt „★ this week“ das Guthaben (Summe aller Sterne minus Belohnungen) und zusätzlich die Sterne dieser Woche.

### 7.3 Sonstiges

- Server-Version erhöhen (`familyfux-tasks` 0.8.0), `mcp-server/README.md` um die Tools und Beispiele ergänzen.
- Tests oder mindestens ein Skript, das create → update → archive → restore gegen eine lokale Supabase durchspielt.

## 8. Design-Regeln

- Nur Tokens aus `src/styles.scss`. Fredoka für Titel, Inter für Text, Emojis als Icons (wie in der ganzen App).
- Keine „NEU“-Badges und keine zusätzlichen gestrichelten Umrandungen. Die grauen gestrichelten Rahmen freier Aufgaben und von „+ Mitmachen“ bleiben.
- Buttons mind. 44 px hoch auf dem Handy, echte `<button>`/`<a>`, `aria-pressed` für Auswahl-Pills und Filter, `aria-label` für Icon-Buttons.
- Neue Screens als Standalone-Komponenten mit Signals und `resource()`, wie die bestehenden Features.

## 9. Akzeptanzkriterien

- [ ] Navigation zeigt Aufgaben-Pool, Belohnungen, Profil, Essen; Kalender ist weg.
- [ ] Braune Leiste: Eltern können frei wechseln; Kinder-Login sieht nur sich selbst und kann nicht wechseln.
- [ ] Pills zeigen Namen und darunter das Guthaben (alle Sterne minus Belohnungen), für Kinder und Eltern.
- [ ] Aufgaben-Pool mit Person: „Mias Aufgaben“ → „Noch frei“ → „Immer wieder“; „Ich mach’s!“ und „Erledigt!“ zählen direkt für die Person.
- [ ] Kauf reduziert das Guthaben sofort und erscheint im Profil unter „Offene Belohnungen“ und im Sterne-Verlauf.
- [ ] Kauf mit zu wenig Sternen ist im UI und in `redeem_reward` unmöglich.
- [ ] Nur Eltern können abhaken und stornieren; Stornieren gibt die Sterne zurück.
- [ ] `/fortschritt/:id` leitet auf das Profil der Person weiter.
- [ ] „Belohnungen verwalten“: anlegen, bearbeiten, archivieren, wiederherstellen und Einlösungen ansehen; nur für Eltern.
- [ ] MCP: `list_rewards`, `create_reward`, `update_reward`, `archive_reward`, `restore_reward`, `list_open_redemptions`, `confirm_redemption` wie in Abschnitt 7; Kinder-Konten bekommen bei schreibenden Tools einen Fehler.
- [ ] `npm run build` und die bestehenden Tests laufen durch; Migration ist in `supabase/migrations/` abgelegt; `TODO.md` ist nachgeführt.

## 10. Vorgeschlagene Reihenfolge

1. Migration: `rewards`, `reward_purchases`, `member_balance`, Funktionen, RLS.
2. `TaskPool` bzw. neuer Service: Guthaben, Belohnungen, Käufe, `selectedMemberId`.
3. Personenwahl-Leiste und Navigation (Kalender raus, Belohnungen/Profil rein).
4. Aufgaben-Pool mit den drei Bereichen.
5. Profil (aus `progress` umbauen) und Belohnungen-Seite.
6. „Belohnungen verwalten“ und „Neue Belohnung“.
7. MCP-Tools.
8. Kinder-Login (Konto verknüpfen + RLS). Kann als eigener Schritt folgen; bis dahin gilt alles als Eltern-Login.

## Entschieden

- Angezeigt wird überall das Guthaben: Summe aller je verdienten Sterne minus eingelöste Belohnungen, für Kinder und Eltern.
- Es gibt keine festen Preise. Alle Belohnungen und Preise im Prototyp sind Beispiele.
- Nachtrag: Auch Eltern können ihr Guthaben einlösen (Migration `20260930090000_parents_redeem_rewards.sql`).
  Abhaken und Stornieren bleiben bei den Eltern, auch für eigene Käufe; „Offene Belohnungen der Kinder“ heißt
  „Offene Belohnungen der Familie“.
