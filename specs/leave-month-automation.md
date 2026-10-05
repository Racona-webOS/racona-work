# Havi szabadság-ellenőrzés automatizálása

> Státusz: 1. fázis kész · Utolsó módosítás: 2026-10-05 · Előfeltétel: core ütemező (`racona-core/.kiro/specs/plugin-scheduler`)

A havi szabadság-ellenőrzés (specs/leave-month-confirmation.md) ma csak kézzel indul: a HR a csapatnézetben megnyomja a kiküldés gombot, és ha egy dolgozó nem válaszol, a HR-nek kell utánamennie. A cél, hogy a szervezet beállíthassa:

- **a hónap vége előtt N munkanappal az összesítő magától menjen ki**;
- a válaszra várók **naponta emlékeztetőt** kapjanak a hónap **zárásáig**;
- a zárás napján (alapból a hónap utolsó 2 munkanapja közül az elsőn) a szabadságkezelők **összesítőt** kapjanak a hónap állapotáról, hogy a maradék munkanapokon továbbíthassák a bérszámfejtő cégnek.

Az időzítést a core ütemezője végzi: a plugin egy napi feladatot deklarál, amely minden reggel 7-kor végignézi a szervezeteket, és a beállításaik alapján eldönti, van-e aznap teendő. A kiküldés ugyanazt a logikát használja, mint a gomb, tehát idempotens, és a kézi és az automatikus kiküldés nem zavarja egymást.

## 1. Hatókör

**Benne van**

- Napi ütemezett feladat (`server/jobs.ts`), 07:00-kor, budapesti idő szerint.
- Szervezeti beállítás a Szabadság beállítások oldalon:
  - automatikus kiküldés (be/ki, hány nappal a hónap vége előtt, munkanap vagy naptári nap, megjegyzés);
  - emlékeztetők (be/ki, első emlékeztető hány nap után, milyen gyakran, csak munkanapon);
  - zárás (hány munkanappal a hónap vége előtt, összesítő a szabadságkezelőknek be/ki).
- A kiküldés szétválasztása: felhasználói (gomb) és rendszer (ütemező) ág, közös belső logikával.
- Emlékeztető rendszeren belül és emailben, a válaszolási határidővel.
- Zárási összesítő a Szabadság beállításoknál kijelölt értesítendőknek.
- Megjelenítés: az automatikusan kiküldött tételek jelölése, a kiküldés és a zárás napja, az emlékeztetők száma a HR blokkban.
- Dev-server: az ütemezett feladat kézi futtatása megadott „mai” dátummal.

**Nincs benne**

- Automatikus elfogadás határidő után.
- A változott (stale) tételek automatikus újraküldése (később, lásd 9. fejezet).
- A hónap tényleges zárolása (a „zárás” itt csak az emlékeztetők leállása és az összesítő).
- Más modulok automatizmusai (kiküldetés-elszámolás, év nyitása). Ezek ugyanerre a napi feladatra vagy újabb feladatra épülhetnek később.

## 2. Döntések

| # | Kérdés | Döntés | Állapot |
|---|---|---|---|
| D1 | Alapértelmezés | Minden automatizmus **alapból ki van kapcsolva**. A plugin frissítése után semmi nem megy ki magától, amíg a szervezet be nem kapcsolja. | elfogadva |
| D2 | Mikor menjen ki? | Alapból **5 munkanappal** a hónap vége előtt: a hónap utolsó 5 munkanapja közül az elsőn (a szervezet munkanaptára szerint). Beállítható 1–15 napra, és választható naptári nap is (a hónap utolsó napja mínusz N nap; ha az nem munkanap, az előtte lévő utolsó munkanap). Példa, 2026. október (okt. 23. ünnep, 31. szombat): okt. 26. (az utolsó öt munkanap: 26–30.). | egyeztetve |
| D3 | Pótlás | A feltétel nem „ma van a kiküldés napja”, hanem „**ma ≥ kiküldés napja**, és ebben a hónapban még nem volt automatikus kiküldés”. Így ha a szerver épp nem futott, a következő reggel pótolja. A hónap vége után az előző hónapot nem pótolja (a HR kézzel küldheti). | elfogadva |
| D4 | Mit küld ki? | Pontosan azt, amit a gomb a folyó hónapra a teljes szervezetnek (D2, D6 a havi ellenőrzés specben): új tételt, akinek nincs, újraküldést, akinél változott az adat. A kézzel már kiküldött, érintetlen tételek kimaradnak. Havonta egyszer fut (a szervezet állapotában megjegyzi). | elfogadva |
| D5 | Ki a küldő? | Senki: `sent_by = NULL`, `send_source = 'automatic'`. A felületen „Automatikusan kiküldve” jelenik meg a küldő neve helyett. A megjegyzés a beállításban megadott szöveg (nem kötelező). | elfogadva |
| D6 | Eltérés automatikus kiküldés után | Az eltérésről a küldő helyett csak a Szabadság beállításoknál **kijelölt értesítendők** kapnak jelzést. A felület figyelmeztet, ha nincs kijelölt értesítendő. | elfogadva |
| D7 | Kit emlékeztet? | A `pending` állapotú, **nem változott** tételek dolgozóit (a változott tételt nem lehet elfogadni, ott a HR-en a sor). Eltérést jelzett, elfogadott, lezárt tételnél nincs emlékeztető. A kézzel kiküldött tételekre is vonatkozik, de **csak a bekapcsolás után kiküldöttekre** (`sent_at >= reminders.enabledAt`), hogy a bekapcsolás ne indítson emlékeztető-áradatot a régi tételekre. | elfogadva |
| D8 | Mikor emlékeztet? | A kiküldés másnapjától **naponta**, csak munkanapon, **a tétel hónapjának zárásáig** (a zárás napján már nem). Darabszám-korlát nincs: a zárás állítja le. Az első emlékeztető napja és a gyakoriság beállítható (alapból 1 és 1). Az emlékeztető tartalmazza a válaszolási határidőt (a zárás előtti utolsó munkanap). A napokat budapesti dátum szerint számolja. | egyeztetve |
| D9 | Lezárt év | Lezárt évre sem kiküldés, sem emlékeztető, sem összesítő nem megy (a havi ellenőrzés D3 szabálya). | elfogadva |
| D10 | Zárás és összesítő | A zárás napja alapból a hónap utolsó **2 munkanapja** közül az első (beállítható 1–10). Ekkor leállnak az emlékeztetők, és a **Szabadság beállításoknál kijelölt értesítendők** összesítőt kapnak a hónapról: hányan fogadták el, ki nem válaszolt, ki jelzett eltérést, kinek változtak a napjai, ki nem kapta meg, és zárható-e a hónap. Szervezetenként és hónaponként egyszer; ha a szerver épp nem futott, a hónapon belül pótolja. Ha a hónapra semmi nem ment ki, nincs összesítő. Példa, 2026. október: kiküldés 26., emlékeztető 27. és 28., zárás és összesítő 29., a HR-nek 29–30. marad. | egyeztetve |
| D11 | Ki állíthatja be? | `leave.approve`: ugyanaz a jog, amely a kiküldést engedi. A blokk a Szabadság beállítások oldalon van, és csak `leave.approve` joggal látszik. | elfogadva |
| D12 | Rendszer-kontextus | Az ütemezett futásnak nincs hívó felhasználója (`userId: null`). A feladat nem hív jogosultsághoz kötött remote függvényt, hanem a belső, jogosultság-ellenőrzés nélküli függvényeket. Ezek a `functions.ts`-ből **nem** exportálhatók. | elfogadva |
| D13 | Hibák | Szervezetenként külön: egy szervezet hibája nem állítja le a többit. A futás összegzése (kiküldött, emlékeztetett, összesítők, hibás szervezetek) a core futásnaplójába kerül; hiba esetén a futás `failed`, így a core 3 egymást követő hiba után szól a rendszergazdának. | elfogadva |
| D14 | Időpont | Minden nap 07:00, budapesti idő (a manifestben rögzítve, szervezetenként nem állítható). | egyeztetve |

## 3. Folyamat

```
Minden nap 07:00 (core ütemező) ──▶ runLeaveMonthAutomation
   minden szervezetre (külön try/catch):
     1. beállítás betöltése; ha minden ki van kapcsolva → tovább
     2. automatikus kiküldés  (D2–D5)
          ma ≥ kiküldés napja ∧ ma ≤ hónap vége ∧ nincs még erre a hónapra ∧ nem lezárt év
          → performMonthConfirmationSend(actor = null, source = 'automatic')
          → állapot: lastAutoSend = { year, month, at, sent, resent, skipped }
     3. emlékeztetők  (D7–D9)
          pending ∧ nem változott ∧ sent_at ≥ enabledAt ∧ ma < a tétel hónapjának zárása
          ∧ ma munkanap ∧ esedékes (első: kiküldés + X nap, utána Y naponta)
          → atomikus foglalás (UPDATE … RETURNING) → értesítés + email a határidővel
     4. zárási összesítő  (D10)
          ma ≥ zárás napja ∧ ma ≤ hónap vége ∧ nincs még erre a hónapra ∧ van tétel a hónapra
          → összesítő a kijelölt értesítendőknek
          → állapot: lastClosingNotice = { year, month, at }
   visszaadja: { summary, data: { organizations, autoSent, reminders, closingNotices, failed } }
```

## 4. Követelmények

**K1. Beállítások.** A Szabadság beállítások oldalon új blokk: „Havi ellenőrzés automatizálása”. Mezők:

- „Automatikus kiküldés a hónap végén” jelölőnégyzet; „Hány nappal a hónap vége előtt” (1–15); „Számítás”: munkanap / naptári nap; „Megjegyzés a dolgozóknak” (nem kötelező);
- „Emlékeztető a válaszra váróknak” jelölőnégyzet; „Első emlékeztető (nap a kiküldés után)”; „Utána ennyi naponta”; „Csak munkanapon”;
- „Összesítő a szabadságkezelőknek a hónap zárásakor” jelölőnégyzet; „Zárás: hány munkanappal a hónap vége előtt” (1–10).

A blokk alján tájékoztatás: a következő automatikus kiküldés napja, a hónap zárásának napja és az utolsó automatikus kiküldés. Figyelmeztetés, ha nincs kijelölt értesítendő (D6, D10), és ha munkanap szerinti kiküldésnél a zárás nem a kiküldés után van (akkor egy emlékeztető sem menne ki). Mentés `leave.approve` joggal.

**K2. Automatikus kiküldés.** A napi futás a D2–D5 szabály szerint kiküldi a folyó hónapot. Az értesítés és az email ugyanaz, mint kézi kiküldésnél. A „HR” megjegyzés helyén a beállított szöveg áll, ha van.

**K3. Emlékeztető a dolgozónak.** Rendszeren belül: „Emlékeztető: havi szabadság-ellenőrzés”, „{hónap}: még nem válaszoltál a havi szabadság-összesítőre. Válaszolási határidő: {dátum}”. Emailben: a hónap, a szakaszok és összesen (a kiküldéskori pillanatképből), „Ez az {n}. emlékeztető. Válaszolási határidő: {dátum}” és az irányítópultra mutató gomb.

**K4. Zárási összesítő.** Rendszeren belül: „Havi szabadság-ellenőrzés: zárás”, „{hónap}: elfogadta {a}, nem válaszolt {p}, eltérést jelzett {d}. (A hónap zárható.)”. Emailben soronként:
- „Elfogadta: {n} dolgozó”;
- „HR lezárta elfogadás nélkül: {n}”;
- „Nem válaszolt ({n}): nevek”;
- „Eltérést jelzett ({n}): nevek”;
- „Változott a kiküldés óta, újra kell küldeni ({n}): nevek”;
- „Nem kapta meg ({n}): nevek”;
- „A hónap zárható” vagy „A hónap még nem zárható”.

Az üres csoportok kimaradnak. A levél a csapatnézetre és a bérszámfejtésnek való továbbításra utal.

**K5. Megjelenítés a HR blokkban.**

- A `MonthConfirmationPanel` az automatikus kiküldésnél a küldő neve helyett az „Automatikusan kiküldve” feliratot mutatja.
- Bekapcsolt automatizmusnál: „Automatikus kiküldés: {dátum}.” (vagy „Ebben a hónapban már ment automatikus kiküldés.”), „A válaszra várók naponta emlékeztetőt kapnak a zárásig ({dátum}).”, „Zárás {dátum}: a szabadságkezelők összesítőt kapnak.”.
- A válaszra váró tételek listájában az emlékeztetők száma és az utolsó emlékeztető ideje („2 emlékeztető, utoljára okt. 28.”).
- A csapattáblázat állapotjelének tooltipje is tartalmazza ezt.

**K6. Megjelenítés a dolgozónak.** Az irányítópult kártyáján az automatikusan kiküldött tételnél nincs küldő név. A kártya nem változik az emlékeztetők miatt.

**K7. Futási összegzés.** A napi feladat visszatérési értéke és naplósorai olvashatók a core Plugin kezelőjében, például: „3 szervezet · kiküldve: 42 · emlékeztető: 7 · zárási összesítő: 1 · hiba: 0”.

## 5. Adatmodell

Új migráció: `024_leave_month_automation.sql`.

```sql
ALTER TABLE app__racona_work.leave_month_confirmations
    ADD COLUMN IF NOT EXISTS send_source         VARCHAR(16) NOT NULL DEFAULT 'manual',  -- manual | automatic (D5)
    ADD COLUMN IF NOT EXISTS reminder_count      INTEGER     NOT NULL DEFAULT 0,         -- D8
    ADD COLUMN IF NOT EXISTS last_reminded_at    TIMESTAMPTZ;                             -- D8
-- + CHECK (send_source IN ('manual', 'automatic')), részleges index a pending tételekre
```

Beállítás a `kv_store`-ban, `settings:leave_month_automation:org_<id>` kulccsal:

```jsonc
{
  "autoSend":  { "enabled": false, "daysBeforeMonthEnd": 5, "dayKind": "working", "note": null },
  "reminders": { "enabled": false, "enabledAt": null, "firstAfterDays": 1, "intervalDays": 1, "workingDaysOnly": true },
  "closing":   { "workingDaysBeforeMonthEnd": 2, "notifyHr": false }
}
```

- Az `enabledAt` mezőt a mentés tölti ki, amikor az emlékeztető kikapcsolt állapotból bekapcsol (D7).
- Normalizálás a meglévő `normalizeNotificationSettings` mintájára: az ismeretlen kulcs kimarad, a hiányzó vagy érvénytelen érték alapértéket kap, a számok a határok közé szorulnak.

Állapot a `kv_store`-ban, `state:leave_month_automation:org_<id>` kulccsal:

```jsonc
{
  "lastAutoSend":      { "year": 2026, "month": 10, "at": "2026-10-26T05:00:12Z", "sent": 40, "resent": 2, "skipped": 0 },
  "lastClosingNotice": { "year": 2026, "month": 10, "at": "2026-10-29T05:00:10Z" }
}
```

## 6. Szerver

### Tiszta rész

Új fájl: `server/leave-month-automation-utils.ts`; a kliens is importálja. Tesztek: `tests/leave-month-automation.test.ts`.

| Függvény | Leírás |
|---|---|
| `normalizeAutomationSettings(raw)` | Teljes, határok közé szorított beállítás. |
| `automationActive(settings)` | Fut-e bármi a szervezetben. |
| `autoSendDay(year, month, settings, workingDays)` | D2: egy nap N nappal a hónap vége előtt (munkanap vagy naptári nap). Munkanap nélküli hónapban `null`. |
| `closingDay(year, month, closing, workingDays)` | D10: a hónap utolsó N munkanapja közül az első. |
| `responseDeadline(closing, workingDays)` | A zárás előtti utolsó munkanap (a dolgozó válaszolási határideje). |
| `shouldAutoSend(...)` | D3, D4, D9. |
| `shouldSendClosingNotice(...)` | D10: a zárás napján vagy utána, a hónapon belül, havonta egyszer. |
| `reminderDue(...)` | D7, D8: ma esedékes-e az emlékeztető (a zárás napjától nem). |
| `doneThisMonth(last, year, month)` | Volt-e már ebben a hónapban (kiküldés vagy összesítő). |
| `budapestDay(isoTimestamp)` | Időbélyegből budapesti dátum. |

### Belső kiküldés és állapot

A `server/leave-month-confirmations.ts`-ben:

- `performMonthConfirmationSend(context, { organizationId, year, month, employeeId, note, actorUserId, source, today?, now? })`: a kiküldés belső része, jogosultság-ellenőrzés nélkül. A `sendMonthConfirmations` remote függvény a jogosultság-ellenőrzés után ezt hívja.
- `loadMonthOverview(context, organizationId, year, month, employeeId?, ownEmployeeId?)`: a hónap állapota jogosultság-ellenőrzés nélkül. A `getMonthConfirmations` és a zárási összesítő is ezt használja.
- Az `insertConfirmation` `userId: number | null`, `source` és `sentAt` paramétert kap. A `MonthConfirmation` bővül: `sendSource`, `reminderCount`, `lastRemindedAt`. A `MonthConfirmationOverview` bővül: `automation` (K5).

### Kontextus

`server/context.ts`:

- `RemoteContext.userId: string | number | null`, valamint új mezők: `trigger?`, `logger?`, `signal?`.
- Új segédfüggvény: `isSystemContext(context)`, ami akkor igaz, ha `userId === null`.
- A `resolveUserId` rendszer-kontextusban egyértelmű hibát dob: „Ütemezett futásban nincs felhasználó”.
- A `hasCapability` rendszer-kontextusban `false`-t ad.

### Automatizmus

Új fájl: `server/leave-month-automation.ts`.

| Függvény | Jog | Leírás |
|---|---|---|
| `getLeaveMonthAutomation({ organizationId })` | `leave.approve` | A beállítás, a következő kiküldés és zárás napja, az utolsó automatikus kiküldés, van-e kijelölt értesítendő. |
| `saveLeaveMonthAutomation({ organizationId, settings })` | `leave.approve` | Normalizálva menti, kitölti az `enabledAt` mezőt (D7). |
| `processOrganization(context, organizationId, today, now)` | belső | A 3. fejezet lépései egy szervezetre. Visszaadja: `{ autoSent, reminders, closingNotice }`. |
| `runLeaveMonthAutomationForAll(context, today, now)` | belső | Minden szervezetre, szervezetenkénti hibakezeléssel (D13). |
| `loadMonthAutomationStatus(...)` | belső | A HR blokk automatizmus-állapota a megjelenített hónapra (K5). |

Új fájl: `server/jobs.ts`, a core ütemező belépési pontja: `runLeaveMonthAutomation(params, context)`. Dev módban a `params.today` szimulált nap; ilyenkor a futás ideje annak reggele.

### Értesítések

A `server/leave-month-confirmation-notifications.ts` bővül:

- `notifyMonthConfirmationReminder(context, { ref, snapshot, reminderNumber, deadline })`: K3.
- `notifyMonthConfirmationClosingSummary(context, { organizationId, year, month, overview })`: K4. Címzett: a kijelölt értesítendők (aktív, nem külsős dolgozók). Visszaadja, ment-e ki.

A `notifyMonthConfirmationDisputed` változatlan: `sent_by = NULL` esetén csak a kijelölt értesítendőknek megy (D6).

### Manifest

```jsonc
"permissions": ["database", "remote_functions", "notifications", "scheduler"],
"scheduledJobs": [{
	"id": "leave-month-automation",
	"handler": "runLeaveMonthAutomation",
	"schedule": "0 7 * * *",
	"timezone": "Europe/Budapest",
	"description": { "hu": "Havi szabadság-ellenőrzés: automatikus kiküldés és emlékeztetők",
	                 "en": "Monthly leave check: automatic sending and reminders" },
	"timeoutSeconds": 900,
	"catchUp": "once"
}]
```

A régi core a `scheduler` jogot nem ismeri, ezért ezt a pluginverziót elutasítja (a `minWebOSVersion` a core-ban nincs ellenőrizve).

## 7. Felület

- `src/components/leave-settings/LeaveMonthAutomationSettings.svelte` (új): a K1 blokk. A `LeaveSettings.svelte` az értesítendők blokkja után illeszti be, `leave.approve` jog esetén.
- `src/components/leave-calendar/MonthConfirmationPanel.svelte`: K5.
- `src/components/leave-calendar/LeaveCalendar.svelte`: az állapotjel tooltipje az emlékeztetőkkel.
- `src/components/leave-month-confirmation/MyMonthConfirmations.svelte`: K6.
- `NotificationSettings.svelte`: a két új esemény a Szabadság csoportban.
- Locale (hu, en): `settings.leaveMonthAutomation.*`, `monthConfirmation.sentAtAuto`, `monthConfirmation.reminders`, `monthConfirmation.automation.*`, `notificationSettings.event.leave.monthConfirmationReminder*`, `…Summary*`.

## 8. Értesítések és sablonok

| Esemény | Címzett | Rendszeren belül | Sablon | Email alapból |
|---|---|---|---|---|
| Automatikus kiküldés | a dolgozó | ugyanaz, mint a kézi kiküldésnél | `leave_month_confirmation_request` (meglévő) | be (`leave.monthConfirmationRequested`) |
| Emlékeztető | a dolgozó | „Emlékeztető: havi szabadság-ellenőrzés” | `leave_month_confirmation_reminder` (új) | be (`leave.monthConfirmationReminder`, új) |
| Zárási összesítő | a kijelölt értesítendők | „Havi szabadság-ellenőrzés: zárás” | `leave_month_confirmation_summary` (új) | be (`leave.monthConfirmationSummary`, új) |

Az emailek a címzett nyelvén mennek (`RECIPIENT_LOCALE_SQL`, meglévő). Az új eseményekhez csak akkor megy bármi, ha a szervezet az automatizmus beállításában bekapcsolta. Az értesítési beállítás csak az emailt kapcsolja (a meglévő minta).

## 9. Feladatok

### 1. fázis

- [x] Spec, egyeztetés az igénylővel (2026-10-05): munkanap szerinti kiküldés; napi emlékeztető a zárásig; zárás 2 munkanappal a hónap vége előtt, összesítővel a szabadságkezelőknek; 07:00
- [x] Migráció `024_leave_month_automation.sql`
- [x] `leave-month-automation-utils.ts` és tesztek: kiküldési és zárási nap (munkanap és naptári nap, ünnep, hétvége, munkanap nélküli hónap), határidő, pótlás, havonta egyszer, lezárt év, emlékeztető a zárásig, `enabledAt`, munkanap-korlát
- [x] `context.ts`: `userId: null`, `isSystemContext`, `resolveUserId` és `hasCapability` rendszer-ága
- [x] `leave-month-confirmations.ts`: `performMonthConfirmationSend` és `loadMonthOverview` kiemelése, `send_source`, az új mezők a lekérdezésekben
- [x] `leave-month-automation.ts`: beállítás get/save, `processOrganization`, emlékeztetők, zárási összesítő
- [x] `jobs.ts`: `runLeaveMonthAutomation`; a `functions.ts` nem exportálja sem ezt, sem a belső függvényeket
- [x] Értesítések: emlékeztető a határidővel, zárási összesítő; két új email sablon; két új esemény a `notification-settings.ts`-ben
- [x] Manifest: `scheduler` jog, `scheduledJobs`
- [x] Felület: beállítás blokk, HR blokk kiegészítései, irányítópult kártya, értesítési beállítások
- [x] Locale (hu, en)
- [x] `dev-server.ts`: `POST /api/jobs/:jobId/run?today=YYYY-MM-DD` (`userId: null`, `logger`, a manifest `timeoutSeconds`-a után abortáló `signal`, hiba esetén 500); a `000_` dev seedek a migrációk előtt, a többi utánuk fut
- [x] Ellenőrzés a dev szerveren és az élő core-ral (lásd lent)
- [x] A havi ellenőrzés specjének frissítése

**Megvalósítás, eltérések a tervtől**

- Az igénylővel egyeztetett szabályok (D2, D8, D10, D14) a korábbi „legfeljebb N emlékeztető, utána HR-jelzés” modellt váltották fel: az emlékeztetőket a zárás napja állítja le, a HR-jelzés helyett zárási összesítő megy a hónap egészéről.
- A napi futás egyetlen „most” időpontot kap: élesben a valódi időt, a dev-server `?today=` szimulációjában a szimulált nap reggelét (05:00 UTC). Ezt kapja a kiküldés (`sent_at`) és az emlékeztető időbélyege is, így a napok közötti számítás szimulációban is helyes.
- A csapatnézet blokkja a hónap automatizmus-állapotát a `getMonthConfirmations` válaszában kapja (`automation`), külön hívás nélkül.
- Az emlékeztető emailben a sorszám elé a helyes névelő kerül („az 1.”, „az 5.”, egyébként „a”).
- A kijelölt értesítendők mentése után az automatizmus blokk „nincs kijelölt értesítendő” figyelmeztetése csak az oldal újratöltésekor frissül.
- A korábbi hónapok válaszra váró tételei (amelyeknek a zárása elmúlt) nem kapnak emlékeztetőt. A hónap elején kézzel kiküldött tételek viszont a zárásig naponta kapnak; ha ez sok, az első emlékeztető napja vagy a gyakoriság állítható.
- Ellenőrizve a dev szerveren szimulált napokkal (2026. november, kiküldés 24., zárás 27., határidő 26.):
  - 23.: semmi;
  - 24.: 2 automatikus kiküldés;
  - 25.: 2 emlékeztető; ugyanaznap újra futtatva semmi;
  - az egyik dolgozó elfogad; 26.: 1 emlékeztető, „Válaszolási határidő: 2026. november 26.”;
  - 27.: nincs emlékeztető, zárási összesítő a kijelölt értesítendőnek („Elfogadta: 1 dolgozó; Nem válaszolt (1): …; A hónap még nem zárható”); ugyanaznap újra futtatva semmi;
  - 28. (szombat) és 30.: semmi;
  - a korábbi hónap válaszra váró tétele nem kapott emlékeztetőt.
- Ellenőrizve az élő core-ral (0.8.66): a feladat a Plugin kezelőben „Futtatás most”-tal lefut („1 szervezet · kiküldve: 0 · emlékeztető: 0 · zárási összesítő: 0 · hiba: 0”); a migráció és a sablonok települnek; a beállítás blokk megjelenik.

### Későbbi ötletek

- A változott tételek automatikus újraküldése a zárás előtt: a kiküldés után rögzített szabadságok így is bekerülnek.
- A válaszolási határidő az első kiküldés emailjében és az irányítópult kártyáján is.
- Automatikus lezárás elfogadás nélkül a zárás napján, rögzített indoklással.
- Ugyanerre a napi futásra: kiküldetés-elszámolás emlékeztető, év nyitásának emlékeztetője, lejáró dokumentumok.

## 10. Kockázatok

- **Sok email egyszerre.** A core nem korlátozza a küldés ütemét. 200 dolgozós szervezetnél az automatikus kiküldés és az emlékeztetők egymás után mennek, ami percekig tarthat. A 900 másodperces időkorlát erre van méretezve. Ha egy futás időtúllépésbe fut, a már kiküldöttek megmaradnak (a tranzakció a kiküldés előtt lezárul), a többit a következő napi futás pótolja.
- **Nincs kijelölt értesítendő.** Automatikus kiküldés után az eltérésről, és a zárási összesítőt is csak a kijelöltek kapják. Ha nincs ilyen, senki nem kap jelzést. A felület figyelmeztet, és a HR blokkban az állapot továbbra is látszik.
- **Régi core.** A `scheduler` jogot és a `scheduledJobs` mezőt a régi core manifest-ellenőrzése elutasítja, így a plugin nem telepíthető rá. A kiadási jegyzetben jelezni kell, hogy ehhez a pluginverzióhoz core frissítés szükséges.
- **Az `APP_URL` hiánya.** Ütemezett futásnál nincs kérés, amiből az email gomb linkje kiszámolható. Ha a core-ban nincs beállítva sem `APP_URL`, sem `ORIGIN`, a link rossz lehet.
- **Időzóna.** Minden napi döntés budapesti dátum szerint születik (`todayInBudapest`, `budapestDay`). A `sent_at` időbélyeg, ezért az összehasonlítás előtt mindig dátumra kell konvertálni.
