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
- Preise und Belohnungen werden über den MCP-Server gepflegt.
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
  - Kinder: Zahl = Guthaben (siehe 6.3).
  - Eltern: Zahl = Sterne dieser Woche (`member_week_stars`).
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
- **Kategorien:** `segmented` mit Alle / Bildschirm / Essen / Erlebnisse. Für Eltern steht rechts der Hinweis „Preise ändern: über Claude (MCP)“.
- **Karten-Raster:** Karte mit Emoji-Kachel (`tile-*`), Name, Einheit/Beschreibung und Preis-Pill „20 ⭐“. Reicht das Guthaben nicht, ist die Karte gedimmt und zeigt „noch 65 ⭐“.
- **Dialog** (Handy: Bottom-Sheet, Desktop: zentriert):
  - Inhalt: Emoji, Name, „5 Minuten für 20 ⭐“, Chip „für Mia“.
  - Bei stapelbaren Belohnungen ein Stepper wie `app-reward-stepper` (1–6), darunter „= 15 Minuten Tabletzeit“.
  - Danach eine Box „Kostet 60 ⭐“ und „Danach bleiben 25 ⭐“ bzw. rot „Es fehlen noch … ⭐“.
  - Button „Einlösen“ (deaktiviert, wenn nicht genug Sterne) und „Abbrechen“.
- **Nach dem Kauf:**
  - Anzeige „Gekauft!“ mit „15 Minuten Tabletzeit für Mia“.
  - Hinweis „Einlösen, sobald Mama oder Papa es in Mias Profil abhakt.“ und das neue Guthaben.
  - Buttons „Super!“ und „Zu Mias Profil“.
- **Wer darf kaufen:** Kinder für sich selbst. Eltern für ein gewähltes Kind (gemeinsames Gerät).

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
  - Statistik ohne Guthaben (drei Kacheln).
  - Diagramm.
  - Verlauf nur mit verdienten Sternen.
- **Bei „Alle“:**
  - Brauner Hero „Wessen Profil?“ / „Wähl oben in der braunen Leiste eine Person aus.“
  - Darunter „Offene Belohnungen der Kinder“.

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
| `unit_amount` | int null | z. B. `5` (nur stapelbar) |
| `unit_label` | text | „Minuten“, „Folge“ oder Beschreibung wie „beim Abendessen“ |
| `stackable` | bool | Menge 1–6 im Dialog |
| `is_active` | bool default true | archivierte Belohnungen ausblenden |
| `sort_order` | int | |
| `created_at` | timestamptz | |

- **RLS lesen:** Familienmitglieder (`public.is_family_member`).
- **RLS schreiben:** nur Eltern (`private.is_family_parent`).

**Startdaten (Beispiele):**

| Belohnung | Menge | Preis |
|---|---|---|
| 📱 Tabletzeit | 5 Minuten | 20 |
| 🎮 Gamezeit | 10 Minuten | 40 |
| 📺 Serienfolge | 1 Folge | 30 |
| 🍨 Dessert aussuchen | – | 25 |
| 🍕 Wunsch-Menü | – | 45 |
| 🌙 Länger aufbleiben | 15 Minuten | 35 |
| 🎬 Filmabend | – | 60 |
| 🏞️ Ausflug wählen | – | 150 |

Nur „Tabletzeit 20 ⭐ = 5 Minuten“ ist fest vorgegeben. Die übrigen Preise sind Beispiele.

### 6.2 `public.reward_purchases`

| Spalte | Typ | Hinweis |
|---|---|---|
| `id` | uuid pk | |
| `family_id` | uuid | |
| `member_id` | uuid → family_members | Wer eingelöst hat |
| `reward_id` | uuid → rewards, null bei Löschung | |
| `title`, `emoji`, `color` | text | Kopie zum Kaufzeitpunkt |
| `quantity` | int 1–6 | |
| `label` | text | z. B. „Tabletzeit · 15 Minuten“ |
| `cost` | int > 0 | Kopie: `price × quantity` |
| `purchased_at` | timestamptz default now() | |
| `redeemed_at` | timestamptz null | gesetzt beim Abhaken |
| `redeemed_by` | uuid → family_members null | Elternteil, das abgehakt hat |

- **RLS lesen:** Familienmitglieder.
- **Schreiben:** nur über die Funktionen unten (kein direktes insert/update/delete für `authenticated`).
- **Stornieren** löscht den Kauf (analog `remove_done_entry`), dadurch kommen die Sterne zurück.

### 6.3 Guthaben

- **View `public.member_balance`** (`security_invoker = true`):
  `sum(claim_rewards.stars where is_done)` über **alle Zeit** minus `sum(reward_purchases.cost)` pro Mitglied.
  `claim_rewards` enthält bereits die „Immer wieder“-Erledigungen und lässt gelöschte Einträge weg.
- **Negatives Guthaben:** Wenn Eltern nachträglich einen Eintrag löschen, kann das Guthaben negativ werden. Das ist erlaubt und wird angezeigt; Käufe sind dann gesperrt.

### 6.4 Funktionen (security definer, `set search_path = ''`)

- **`redeem_reward(p_member_id uuid, p_reward_id uuid, p_quantity int) returns uuid`**
  - Prüft: gleiche Familie, Belohnung aktiv, Menge 1–6 (bzw. 1, wenn nicht stapelbar).
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

## 7. MCP-Server (`mcp-server/src/index.ts`)

- **Neue Tools**, gleicher Stil wie `create_task` / `list_tasks`, nur für Eltern (Rolle prüfen):
  - `list_rewards`: aktive und optional archivierte Belohnungen mit Preis, Einheit und Kategorie.
  - `upsert_reward`: Belohnung anlegen oder ändern (Titel, Emoji, Farbe, Kategorie, Preis, Einheit, stapelbar).
  - `archive_reward`: Belohnung ausblenden (`is_active = false`). Bestehende Käufe bleiben erhalten.
  - `list_open_redemptions`: gekaufte, noch nicht eingelöste Belohnungen pro Kind (optional, praktisch per Sprache).
- `list_family_members` zusätzlich um das Guthaben ergänzen.
- Server-Version erhöhen, `mcp-server/README.md` ergänzen.
- Kurze, sprechbare Antworten auf Deutsch (siehe Server-Instructions).

## 8. Design-Regeln

- Nur Tokens aus `src/styles.scss`. Fredoka für Titel, Inter für Text, Emojis als Icons (wie in der ganzen App).
- Keine „NEU“-Badges und keine zusätzlichen gestrichelten Umrandungen. Die grauen gestrichelten Rahmen freier Aufgaben und von „+ Mitmachen“ bleiben.
- Buttons mind. 44 px hoch auf dem Handy, echte `<button>`/`<a>`, `aria-pressed` für Auswahl-Pills und Filter, `aria-label` für Icon-Buttons.
- Neue Screens als Standalone-Komponenten mit Signals und `resource()`, wie die bestehenden Features.

## 9. Akzeptanzkriterien

- [ ] Navigation zeigt Aufgaben-Pool, Belohnungen, Profil, Essen; Kalender ist weg.
- [ ] Braune Leiste: Eltern können frei wechseln; Kinder-Login sieht nur sich selbst und kann nicht wechseln.
- [ ] Pills zeigen Namen und darunter die Sterne (Kinder: Guthaben, Eltern: diese Woche).
- [ ] Aufgaben-Pool mit Person: „Mias Aufgaben“ → „Noch frei“ → „Immer wieder“; „Ich mach’s!“ und „Erledigt!“ zählen direkt für die Person.
- [ ] Kauf reduziert das Guthaben sofort und erscheint im Profil unter „Offene Belohnungen“ und im Sterne-Verlauf.
- [ ] Kauf mit zu wenig Sternen ist im UI und in `redeem_reward` unmöglich.
- [ ] Nur Eltern können abhaken und stornieren; Stornieren gibt die Sterne zurück.
- [ ] `/fortschritt/:id` leitet auf das Profil der Person weiter.
- [ ] MCP: Eltern können Belohnungen per Claude anlegen, ändern und archivieren.
- [ ] `npm run build` und die bestehenden Tests laufen durch; Migration ist in `supabase/migrations/` abgelegt; `TODO.md` ist nachgeführt.

## 10. Vorgeschlagene Reihenfolge

1. Migration: `rewards`, `reward_purchases`, `member_balance`, Funktionen, RLS.
2. `TaskPool` bzw. neuer Service: Guthaben, Belohnungen, Käufe, `selectedMemberId`.
3. Personenwahl-Leiste und Navigation (Kalender raus, Belohnungen/Profil rein).
4. Aufgaben-Pool mit den drei Bereichen.
5. Profil (aus `progress` umbauen) und Belohnungen-Seite.
6. MCP-Tools.
7. Kinder-Login (Konto verknüpfen + RLS). Kann als eigener Schritt folgen; bis dahin gilt alles als Eltern-Login.

## Offene Punkte

- Zahl bei Eltern in der Leiste: Sterne dieser Woche (aktuell) oder Summe aller Sterne?
- Preis-Kalibrierung: Aufgaben bringen meist 1–4 ⭐; 20 ⭐ für 5 Minuten Tablet entsprechen etwa einer Woche Arbeit.
