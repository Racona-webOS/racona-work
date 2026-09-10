# Szabadságkeret-számítás

> Státusz: 1–3. fázis kész (a dolgozói adatbejelentés hátravan) · Utolsó módosítás: 2026-09-10

A HR-es ma dolgozónként és évente kézzel írja be a szabadságkeretet (`leave_balances.total_days`). A cél, hogy a rendszer a dolgozó adataiból (születési dátum, gyerekek, belépés/kilépés, egyéb jogosultságok) a Munka törvénykönyve szerint **kiszámolja a javasolt keretet**, amit a HR-es indoklással korrigálhat.

## 1. Hatókör

**Benne van**

- A számításhoz szükséges dolgozói adatok rögzítése (csak HR).
- Éves szabadságkeret kiszámítása tételes bontással és § hivatkozással.
- HR korrekció (± nap, indoklással), a keret zárolása.
- Automatikus újraszámolás, ha változik egy bemenő adat.
- Tömeges éves keretgenerálás és áthozatal (2. fázis).

**Nincs benne**

- Szabadság órákban (egyenlőtlen munkaidő-beosztás).
- Fél napok (a `days` mező egész szám marad).
- A szabadság kiadásának szabályai (7 nap a dolgozó kérésére, 15 napos előzetes közlés, 14 egybefüggő nap).
- Bérszámfejtési átadás.

## 2. Jogszabályi háttér (Mt. – 2012. évi I. törvény)

Az életkor és a gyerek kora **az adott naptári évben betöltött kor** szerint számít, nem a pontos születésnap szerint.

| Tétel | Szabály | Bemenet |
|---|---|---|
| Alapszabadság – 116. § | 20 munkanap | – |
| Életkor – 117. § | A tárgyév és a születési év különbsége (kor) szerint:<br>25 → +1, 28 → +2, 31 → +3, 33 → +4, 35 → +5, 37 → +6, 39 → +7, 41 → +8, 43 → +9, 45 → +10 | születési dátum |
| Gyermek – 118. § (1) | 16 évesnél fiatalabb gyerek után: 1 gyerek +2, 2 gyerek +4, kettőnél több összesen +7 | gyerekek születési dátuma |
| Fogyatékos gyermek – 118. § (2) | fogyatékos gyermekenként további +2 | gyerek jelölője |
| Gyermek figyelembevétele – 118. § (3) | A gyereket a születése évében számoljuk először, utoljára abban az évben, amelyben betölti a 16. életévét. Mindkét szülőnek jár. | – |
| Fiatal munkavállaló – 119. § | +5 nap, utoljára abban az évben, amelyben betölti a 18. életévét | születési dátum |
| Föld alatti munka, ionizáló sugárzás – 119. § | +5 nap | HR jelölő |
| Egészségkárosodott – 120. § | +5 nap: legalább 50%-os egészségkárosodás, fogyatékossági támogatás vagy vakok személyi járadéka esetén | HR jelölő + érvényesség |
| Arányosítás – 121. § | Év közbeni belépésnél vagy kilépésnél az arányos rész jár. A fél napot elérő töredék egész napnak számít. | belépés és kilépés dátuma |
| Céges többlet | Kollektív szerződés vagy belső szabályzat adhat többet | céges szabály |

**Eseti szabadságok.** Ezek nem az éves keret részei, csak a 3. fázisban foglalkozunk velük:

- apasági szabadság: 10 munkanap, ikreknél sem több; a születést követő negyedik hónap végéig, legfeljebb két részletben, nem arányosítjuk (Mt. 118. § (4));
- szülői szabadság: 44 munkanap, a gyerek 3 éves koráig;
- betegszabadság: évi 15 munkanap (126. §).

### Példa (2026)

A dolgozó adatai:

- 1987-ben született → 39 éves → **+7**;
- két gyereke van:
  - a 2012-es gyerek 2026-ban 14 éves, tehát számít;
  - a 2009-es 2025-ben töltötte a 16-ot, tehát már nem számít;
  - így 1 gyerek → **+2**;
- belépés: 2026-03-01.

Számítás:

- teljes évre: 20 + 7 + 2 = 29 nap;
- munkaviszonyban töltött napok: 306 a 365-ből;
- arányosítva: 29 × 306 / 365 = 24,31 → **24 nap**.

## 3. Rögzített döntések

| # | Kérdés | Döntés |
|---|---|---|
| D1 | Hogyan korrigál a HR? | **± nap a számított értékhez képest**, kötelező indoklással. Nem teljes felülírás. |
| D2 | Mikor számolunk újra? | **Automatikusan**, amikor változik egy bemenő adat. A korrekció megmarad. A keret zárolható, zárolt keretet nem számolunk újra. |
| D3 | Ki viszi fel az adatokat? | Az 1. fázisban **csak a HR** (`leave.balance.manage`). A dolgozói bejelentés a 3. fázisba kerül. |
| D4 | Áthozatal az előző évből | **2. fázis.** Külön mező (`carried_over_days`), csak számított keretnél. Javaslat: az előző év maradéka; a HR írja át. Az előző évi keretet nem módosítjuk, csak jelezzük rajta, mennyit vittünk át. |
| D5 | Ki hozza létre az új év kereteit? | **A HR generálja.** A rendszer magától nem hoz létre keretet. Az újraszámolás csak már létező kereteket érint. |
| D6 | Mit tárolunk a gyerekekről? | Gyerekenként a születési dátumot és a fogyatékos jelölőt, **darabszámot nem**. Így minden évre magától kijön, hány gyerek számít. |
| D7 | Arányosítás alapja | Naptári napok (365/366). A teljes éves összeget arányosítjuk, nem tételenként. Kerekítés: a fél nap felfelé. |

## 4. Követelmények

**K1. Adatok rögzítése.** A `leave.balance.manage` joggal rendelkező felhasználó a dolgozó adatlapján rögzítheti és módosíthatja:

- a születési dátumot;
- a belépés dátumát (ma nem szerkeszthető, és létrehozáskor mindig az aznapi dátum lesz);
- a kilépés dátumát;
- a gyerekeket: megnevezés (nem kötelező), születési dátum, fogyatékos-e;
- az egyéb pótszabadságokat: fajta, napok, érvényesség kezdete és vége, megjegyzés.

**K2. Számítás előnézete.** Bármely dolgozóra és évre lekérhető a számítás:

- tételes bontás § hivatkozással;
- arányosítás;
- végösszeg;
- figyelmeztetések (pl. hiányzó születési dátum).

**K3. Keret létrehozása számításból.** A HR egy dolgozónak, egy adott évre létrehozhatja a keretet a számítás alapján, opcionális korrekcióval. A tömeges változat a 2. fázisban jön.

**K4. Korrekció.** A HR megadhat egy ± napos korrekciót, ami mellé kötelező indoklást írni. A keret összege: `számított + korrekció`.

**K5. Zárolás.** A HR zárolhat egy keretet. Zárolt keretet az automatikus újraszámolás nem módosít, de a felület jelzi, ha a számított érték eltér tőle.

**K6. Automatikus újraszámolás.** K1 bármely adatának mentésekor, és a céges szabály változásakor, a rendszer újraszámolja a dolgozó érintett kereteit (lásd a 7. pontot). A választ, hogy melyik év kerete mennyiről mennyire változott, a felület üzenetben mutatja.

**K7. Átlátható bontás.**

- A HR a dolgozó adatlapján, a dolgozó a saját irányítópultján látja a keret bontását.
- Más dolgozó keretét csak `leave.balance.manage` joggal lehet látni.

**K8. Régi, kézi keretek.** A migráció előtti keretek „kézi” módban maradnak, változatlan összeggel. A HR egy gombbal átállíthatja őket számított módra. Előtte látja az eltérést, és választhat:

- korrekció nélkül veszi át a számított értéket;
- vagy korrekcióval, így az összeg nem változik.

**K9. Figyelmeztetés az ellenőrizetlen belépési dátumra.** A belépés dátuma létrehozáskor mindig az aznapi dátum lett, így a mostani dolgozóknál nem a valódi belépést mutatja, ami rossz arányosítást okoz. Amíg a HR el nem menti a Szabadság-adatok kártyán (`employees.hire_date_confirmed`), a felület figyelmeztet.

## 5. Adatmodell – `migrations/007_leave_entitlement.sql`

```sql
-- Dolgozó: születési és kilépési dátum, ellenőrzött-e a belépés (K9)
ALTER TABLE app__racona_work.employees
    ADD COLUMN IF NOT EXISTS birth_date DATE,
    ADD COLUMN IF NOT EXISTS employment_end_date DATE,
    ADD COLUMN IF NOT EXISTS hire_date_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

-- Gyerekek (a darabszám évenként a születési dátumokból jön)
CREATE TABLE IF NOT EXISTS app__racona_work.employee_children (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    label VARCHAR(255),
    birth_date DATE NOT NULL,
    is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_children_employee
    ON app__racona_work.employee_children(employee_id);

-- Egyéb pótszabadság-jogosultságok (csak jelölő, diagnózis nem!)
CREATE TABLE IF NOT EXISTS app__racona_work.employee_extra_leave (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    kind VARCHAR(50) NOT NULL
        CHECK (kind IN ('health_impaired', 'underground_radiation', 'custom')),
    days INTEGER NOT NULL CHECK (days > 0),
    valid_from DATE,
    valid_to DATE,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_extra_leave_employee
    ON app__racona_work.employee_extra_leave(employee_id);

-- Keret: számított érték, korrekció, zárolás, számítási pillanatkép
ALTER TABLE app__racona_work.leave_balances
    ADD COLUMN IF NOT EXISTS calculated_days INTEGER,          -- NULL = kézi keret
    ADD COLUMN IF NOT EXISTS adjustment_days INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS adjustment_note TEXT,
    ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS calculation JSONB,                -- EntitlementResult + bemenetek
    ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Számított módban a total_days mindig számított + korrekció
ALTER TABLE app__racona_work.leave_balances
    ADD CONSTRAINT leave_balances_total_consistent
    CHECK (calculated_days IS NULL OR total_days = calculated_days + adjustment_days);

ALTER TABLE app__racona_work.leave_balances
    ADD CONSTRAINT leave_balances_adjustment_note
    CHECK (adjustment_days = 0 OR length(trim(coalesce(adjustment_note, ''))) > 0);
```

A két `ADD CONSTRAINT` nem idempotens. `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint ...)` blokkba kell tenni, a meglévő migrációk mintájára.

**Miért marad a `total_days`?** A kérelem létrehozásakor és jóváhagyásakor a mostani ellenőrzések a `remaining_days`-t olvassák (`createLeaveRequest`, `approveLeaveRequest`). Ha a `total_days` a ténylegesen érvényes összeg marad, ezekhez a kódrészekhez nem kell nyúlni. A szerver írja; a számított módban a CHECK constraint őrzi a konzisztenciát.

**Negatív maradék.** Előfordulhat, például kilépés miatti arányosításnál, hogy a keret a már felhasznált napok alá csökken. Ezt engedjük, a felület jelzi („túlvett szabadság”). Új kérelmet a mostani ellenőrzés úgysem enged.

## 6. Számítómotor – `server/leave-entitlement.ts`

Egyetlen függvény, mellékhatás és adatbázis-hozzáférés nélkül. A dátumok `YYYY-MM-DD` formájúak, UTC-ben számolunk, ahogy a `calculateWorkingDays` is.

```ts
export const RULE_SET = 'hu-mt@1';

export type ExtraLeaveKind = 'health_impaired' | 'underground_radiation' | 'custom';

export interface EntitlementInput {
    year: number;
    birthDate: string | null;
    hireDate: string | null;
    employmentEndDate: string | null;
    children: { birthDate: string; isDisabled: boolean }[];
    extras: { kind: ExtraLeaveKind; days: number; validFrom: string | null; validTo: string | null; note?: string }[];
    policy: { extraDaysForAll: number; extraDaysLabel?: string };
}

export type EntitlementItemCode =
    | 'base' | 'age' | 'children' | 'disabled_children' | 'youth'
    | 'health_impaired' | 'underground_radiation' | 'custom' | 'policy';

export interface EntitlementItem {
    code: EntitlementItemCode;
    days: number;
    legalRef?: string;                   // pl. 'Mt. 117. §'
    params?: Record<string, unknown>;    // i18n-hez: { age: 39 }, { count: 1 } …
}

export type EntitlementWarningCode =
    | 'missing_birth_date' | 'missing_hire_date' | 'not_employed_in_year'
    | 'end_before_hire';

export interface EntitlementResult {
    ruleSet: string;
    year: number;
    items: EntitlementItem[];
    fullYearDays: number;        // a tételek összege
    daysInYear: number;          // 365 / 366
    employedDays: number;        // munkaviszonyban töltött naptári napok a tárgyévben
    totalDays: number;           // arányosított, kerekített végösszeg
    warnings: { code: EntitlementWarningCode; params?: Record<string, unknown> }[];
}

export function calculateAnnualLeave(input: EntitlementInput): EntitlementResult;
```

### Algoritmus

1. **Alapszabadság:** `base` = 20.
2. **Életkor.** Ha van születési dátum, a kor `year − birthYear`.
   - Az `age` a 117. § táblázatából jön; 0 napos tételt nem veszünk fel.
   - A `youth` = 5, ha a kor legfeljebb 18.
   - Ha nincs születési dátum: `missing_birth_date` figyelmeztetés, és mindkét tétel kimarad.
3. **Gyerekek.**
   - Az évben számít minden gyerek, akire `birthYear ≤ year ≤ birthYear + 16`.
   - A tárgyév után született gyerek nem számít. Jövőbeli születési dátumot a szerver mentéskor elutasít.
   - `children`: 1 gyerek → 2, 2 gyerek → 4, 3 vagy több → 7.
   - `disabled_children`: a beszámító fogyatékos gyerekek száma × 2.
4. **Egyéb pótszabadságok.** Minden `extras` elem beszámít a saját `days` értékével, ha az érvényessége átfed a tárgyévvel. Ha nincs `valid_from` vagy `valid_to`, azt nyitott intervallumnak vesszük.
5. **Céges többlet.** `policy` = `extraDaysForAll`, ha az nagyobb nullánál.
6. **Arányosítás.**
   - A munkaviszony a tárgyévben: `[max(hireDate, jan. 1.), min(employmentEndDate, dec. 31.)]`.
   - `employedDays` = ennek a hossza napokban, a két végpontot is beleszámolva.
   - Ha nincs belépési dátum: `missing_hire_date` figyelmeztetés, és a teljes évvel számolunk.
   - Ha a munkaviszony nem érinti a tárgyévet: `not_employed_in_year` figyelmeztetés, `totalDays` = 0.
   - Kerekítés egész számokkal (a fél nap felfelé):
     `totalDays = floor((2 × fullYearDays × employedDays + daysInYear) / (2 × daysInYear))`
     Teljes év esetén ez pontosan `fullYearDays`.

### Tesztesetek – `tests/leave-entitlement.test.ts` (`bun test`)

A teszt a gyökérben lévő `tests/` mappába kerül, nem a `server/` alá, mert a `server/` teljes egészében bekerül a csomagba. Új script a `package.json`-ba: `"test": "bun test"`.

- **Életkor:** 24 → 0, 25 → +1, 44 → +9, 45 → +10, 60 → +10.
- **Fiatal munkavállaló:** 17 és 18 éves → +5, 19 éves → 0.
- **Gyerek 2026-ban:**
  - 2010-es (idén tölti a 16-ot) → számít;
  - 2009-es → nem számít;
  - 2026-ban született → számít;
  - a születés előtti évben → nem számít.
- **Gyerekek száma:** 3 → +7, 4 → +7; 1 fogyatékos gyerek → 2 + 2 = 4; 3 gyerek, ebből 1 fogyatékos → 7 + 2 = 9.
- **Arányosítás:**
  - belépés 2026-03-01, 29 napos teljes keret → 24;
  - belépés 2026-12-31 → 0;
  - belépés és kilépés ugyanabban az évben;
  - szökőév (2028, 366 nap);
  - fél nap felfelé kerekül: 31 nap × 183/366 = 15,5 → 16.
- **Nincs munkaviszony a tárgyévben:** 0, `not_employed_in_year` figyelmeztetés.
- **Egyéb pótszabadság:** az idén érvényes egészségkárosodás → +5; a tavaly lejárt → 0.
- **Hiányzó születési dátum:** csak az alap, a gyerek- és az egyéb tételek, `missing_birth_date` figyelmeztetéssel.

## 7. Automatikus újraszámolás (D2)

**Mikor fut.**

- K1 bármely mentésekor, azaz ezeknél a függvényeknél: `saveLeaveProfile`, `saveEmployeeChild`, `deleteEmployeeChild`, `saveExtraLeave`, `deleteExtraLeave`.
- A céges szabály mentésekor, ekkor a cég összes dolgozójára.

**Mely kereteket érinti.** A dolgozó azon meglévő kereteit, amelyekre mind igaz:

- `year ≥ aktuális év`, ahol az aktuális év az Europe/Budapest időzóna szerint értendő;
- `calculated_days IS NOT NULL`, vagyis nem kézi keret;
- `is_locked = false`.

**Mit csinál.**

- Frissíti a `calculated_days`, `calculation`, `calculated_at`, `updated_by` és `total_days` mezőt. A `total_days` = `calculated_days + adjustment_days`.
- **Új keretet nem hoz létre** (D5). Múltbeli évekhez nem nyúl.

**Mit ad vissza.** `recalculated: { year, from, to }[]`, ezt a felület üzenetben mutatja meg.

Mindez egy közös belső helperben legyen: `recalculateEmployeeBalances(ctx, employeeId)`. Ezt **nem** exportáljuk a `functions.ts`-ből.

## 8. Szerver API – `server/leave-profile.ts`

Az új függvényeket a `server/functions.ts`-ből exportáljuk. Jogosultság-ellenőrzés: `requireCapability`, illetve az új `requireSelfOrCapability` (`permissions.ts`), ami a saját dolgozói rekordot képesség nélkül is engedi.

Validáció: a dátumok `YYYY-MM-DD` formájú, létező napok. Születési dátum és gyerek születési dátuma nem lehet a jövőben. A kilépés nem lehet korábbi a belépésnél. A törvényi pótszabadságoknál a napok száma rögzített 5, az egyedinél 1–60 nap és kötelező a megnevezés.

| Függvény | Jogosultság | Leírás |
|---|---|---|
| `getLeaveProfile({ employeeId })` | saját vagy `leave.balance.manage` | Születési, belépési és kilépési dátum, gyerekek, egyéb pótszabadságok, `hireDateConfirmed` (K9). |
| `saveLeaveProfile({ employeeId, birthDate, hireDate, employmentEndDate })` | `leave.balance.manage` | Mentés + újraszámolás. |
| `saveEmployeeChild({ employeeId, id?, label?, birthDate, isDisabled })` | `leave.balance.manage` | Létrehozás vagy módosítás + újraszámolás. |
| `deleteEmployeeChild({ id })` | `leave.balance.manage` | Törlés + újraszámolás. |
| `saveExtraLeave({ employeeId, id?, kind, days, validFrom?, validTo?, note? })` | `leave.balance.manage` | Létrehozás vagy módosítás + újraszámolás. |
| `deleteExtraLeave({ id })` | `leave.balance.manage` | Törlés + újraszámolás. |
| `previewLeaveEntitlement({ employeeId, year })` | saját vagy `leave.balance.manage` | Egy `EntitlementResult` és a meglévő keret, ha van. |
| `createLeaveBalanceFromCalculation({ employeeId, year, adjustmentDays?, adjustmentNote? })` | `leave.balance.manage` | K3. Hibát dob, ha az évre már van keret. |
| `setLeaveBalanceAdjustment({ balanceId, adjustmentDays, adjustmentNote, isLocked })` | `leave.balance.manage` | K4, K5. |
| `applyCalculationToBalance({ balanceId, keepTotal })` | `leave.balance.manage` | K8: kézi vagy zárolt keret átállítása számított módra. `keepTotal` esetén a korrekció = régi összeg − számított. |
| `getLeavePolicy({ organizationId })` | `employee.view` | Céges szabály, kv_store kulcs: `settings:leave_policy:org_<id>`. |
| `saveLeavePolicy({ organizationId, extraDaysForAll, extraDaysLabel? })` | `org.manage` | Mentés + a cég dolgozóinak újraszámolása. |

**Meglévő függvények változásai**

- `getLeaveBalances`: **szigorítás.** Csak a saját keretet, illetve `leave.balance.manage` joggal másokét lehessen lekérni. Az új mezőket is visszaadja: `calculatedDays`, `adjustmentDays`, `adjustmentNote`, `isLocked`, `calculation`.
  - Jelenleg bármelyik tag bárki keretét lekérheti. A bontásban benne lesz a gyerekek száma és az egészségkárosodás ténye, ezért ez **az 1. fázisban kötelező**.
  - A mostani hívók a saját keretet kérik (irányítópult) vagy HR-ként kérik le (adatlap), ezért a szigorítás őket nem töri el.
- `setLeaveBalance`: kézi módban megmarad, a meglévő hívások miatt. A felületről kivezetjük.

## 9. Felület

**Dolgozó adatlapja – `EmployeeDetail.svelte`**

- **Új „Szabadság-adatok” kártya**, csak `leave.balance.manage` joggal látszik.
  - Mezők: születési dátum, belépés és kilépés dátuma. Natív dátummező, mert a születési dátumot a naptárban lapozva kényelmetlen kiválasztani, begépelni viszont gyors.
  - K9 figyelmeztetés, amíg a belépés dátuma nincs ellenőrizve.
  - **Gyerekek** lista, soronként:
    - megnevezés, születési dátum, fogyatékos jelölő;
    - állapot az idei évre: „Idén beszámít” vagy „Idén már nem számít”.
  - **Egyéb pótszabadság** lista.
- **A „Szabadságkeret” kártya átalakítása.**
  - Évenkénti sorok: összes, felhasznált, maradék. Kinyitva a bontás:
    `Alap 20 · Életkor +7 · Gyermek +2 · Arányosítás −5 → Számított 24 · Korrekció +1 (indok) → Összesen 25`
  - Címkék: *Számított*, *Kézi*, *Zárolt*, *Eltér a számítottól (±n)*.
  - Műveletek:
    - **Keret létrehozása {év}-re**: előnézettel, opcionális korrekcióval;
    - **Korrekció**: ablakban ± nap, indoklás, zárolás;
    - **Számítás alkalmazása**: kézi vagy eltérő keretnél, K8.
  - A kártya most beégetett magyar szövegeit i18n-re cseréljük (`locales/hu.json` és `en.json`).
- Az automatikus újraszámolás eredménye üzenetben jelenik meg, pl. „A 2026-os keret 28 → 30 napra változott”.

**Irányítópult – `Dashboard.svelte`**

- A saját keret kártyáján kinyitható a bontás, csak olvasásra.

**Beállítások – `LeaveSettings.svelte`** (a menüpont `org.manage` joghoz kötött)

- Új „Céges többletnap” szakasz: napok száma mindenkinek, és ennek megnevezése (pl. „KSZ szerinti többlet”).

**Éves keretek – `LeaveEntitlements.svelte`** (2. fázis, új menüpont, `requiredCapability: leave.balance.manage`)

- Évválasztó, és egy táblázat az aktív dolgozókról, oszlopok:
  - dolgozó;
  - előző évi keret és maradék;
  - számított keret;
  - korrekció (szerkeszthető);
  - áthozott napok (szerkeszthető);
  - figyelmeztetések.
- A figyelmeztetésekre szűrni lehet (pl. „hiányzó születési dátum”).
- Csak azok a dolgozók szerepelnek, akiknek még nincs keretük az adott évre. A **Keretek létrehozása** gomb egyben menti őket.

## 10. Adatvédelem

- A születési dátum és a gyerekek adatai személyes adatok. Az egészségkárosodás egészségügyi adat, vagyis a GDPR 9. cikke szerinti különleges adat. Ezért:
  - diagnózist, százalékot vagy okiratot **nem** tárolunk, csak a jogosultság tényét (`kind`, `days`) és az érvényességét;
  - a gyerekeknél csak a számításhoz szükséges adatot tároljuk, a megnevezés nem kötelező.
- Hozzáférés:
  - olvasni a dolgozó a saját adatait, illetve `leave.balance.manage` joggal lehet;
  - írni csak `leave.balance.manage` joggal lehet.
- Az új végpontok **nem** követhetik a `getEmployeeDetails` mintáját, mert az `employee.view` joggal elérhető, ami minden dolgozónak megvan.
- A dolgozó és a cég törlésekor az új táblák adatai is törlődnek (`ON DELETE CASCADE`).

## 11. Fázisok és feladatok

### 1. fázis – adatok, számítás, dolgozói szintű keret ✅

- [x] `migrations/007_leave_entitlement.sql` (5. pont), idempotens constraint-blokkokkal.
- [x] Dev seed (`migrations/dev/002_leave_entitlement_seed.sql`): a dev user születési dátuma és két gyereke. A dev seedek a migrációk előtt futnak, ezért csak akkor tölt, ha a 007 már lefutott.
- [x] Dev szerver: a `kv_store` táblát a core PluginInstaller mintájára létrehozza (élesben a core csinálja).
- [x] `server/leave-entitlement.ts`: számítómotor.
- [x] `tests/leave-entitlement.test.ts` (43 teszt) és `"test": "bun test"` script.
- [x] `server/leave-profile.ts`: a 8. pont függvényei, a `recalculateEmployeeBalances` helper, és a `functions.ts` exportok.
- [x] `getLeaveBalances` szigorítása és az új mezők; `setLeaveBalance` kézi módba teszi a keretet.
- [x] `EmployeeDetail.svelte`: a `leave-entitlement/` mappa kártyái (`LeaveBalanceCard`, `LeaveProfileCard`, `EntitlementBreakdown`), i18n-nel. A régi kézi keret-űrlap kikerült.
- [x] `Dashboard.svelte`: a saját keret bontása („Hogyan jön ki?”).
- [x] `LeaveSettings.svelte`: céges többletnap szakasz.
- [x] `locales/hu.json` és `en.json`: új kulcsok.
- [x] Verzióemelés (`manifest.json`).

### 2. fázis – éves keretgenerálás és áthozatal ✅

- [x] `migrations/008_leave_carry_over.sql`: `leave_balances.carried_over_days` (alapértéke 0).
  - A CHECK constraint: `total_days = calculated_days + adjustment_days + carried_over_days`.
  - Új szabály: az áthozatal nem negatív, és kézi keretnél 0 (a kézi összeg már mindent tartalmaz; a `setLeaveBalance` nullázza).
- [x] Az áthozatal minden keretműveletben megmarad: újraszámolás, korrekció (`setLeaveBalanceAdjustment` új `carriedOverDays` paramétere; ha nincs megadva, a meglévő marad), számítás alkalmazása.
- [x] `previewLeaveEntitlement` visszaadja az előző évi keretet és az áthozatal-javaslatot; a `createLeaveBalanceFromCalculation` fogad áthozatalt.
- [x] `previewBulkEntitlements({ organizationId, year })`:
  - a szervezet nem kilépett (`status <> 'inactive'`) dolgozói, akiknek még nincs keretük az évre;
  - soronként a számítás, az előző évi keret, az áthozatal-javaslat és hogy ellenőrzött-e a belépés;
  - a dolgozók adatait kötegelten tölti (három lekérdezés, nem dolgozónként).
- [x] `applyLeaveEntitlements({ organizationId, year, rows })`:
  - soronként a HR döntései (korrekció + indoklás, áthozatal); a számítást a szerver újra elvégzi;
  - előbb minden sort ellenőriz, hiba esetén semmit nem ír (a hibaüzenet a dolgozó nevével kezdődik);
  - egy tranzakcióban ír; az időközben már létrehozott kereteket nem írja felül, ezeket `skippedEmployeeIds`-ként adja vissza.
- [x] Áthozatal:
  - javaslatnak az előző év maradéka (legfeljebb 60 nap — ez csak a hibás bevitelt fogja meg);
  - a HR szerkeszti, mert a 123. § szerinti feltételek (pl. október 1. utáni belépés, a munkáltató gazdasági érdeke, a felek megállapodása az életkori pótszabadságról) nem következnek az adatokból.
- [x] `LeaveEntitlements.svelte` és a menüpont (`menu.json`, Idő és szabadság alatt, `leave.balance.manage`).
  - Évválasztó (tavaly, idén, jövőre; novembertől alapból a jövő év).
  - A táblázat soronként: kijelölés, dolgozó (a nevére kattintva az adatlap) és figyelmeztetései, előző évi keret és maradék, számított keret (kattintásra bontás), áthozott, korrekció, indoklás, összesen.
  - Szűrő: mind / figyelmeztetéssel. Akinek az évben nincs munkaviszonya, az alapból nincs kijelölve.
  - A mentés gomb tiltott, amíg egy kijelölt korrekcióhoz hiányzik az indoklás.
- [x] Dolgozó adatlapja: áthozatal a keret létrehozásánál (javaslattal) és a korrekciónál, a bontásban „Áthozott az előző évből” sor, az előző évi kereten „Ebből n napot a következő évbe hoztunk át”.

**Nyitott (későbbre):** az áthozott napokat a törvény szerint jellemzően a következő év március 31-ig kell kiadni. Ezt a határidőt és a „először az áthozottból fogy” sorrendet a rendszer most nem követi.

### 3. fázis – bővítések ✅ (a dolgozói adatbejelentés kivételével)

**Döntések**

| # | Kérdés | Döntés |
|---|---|---|
| D8 | A jóváhagyott fizetés nélküli kérelmek csökkentsék-e a keretet? | **Igen, maguktól.** Jóváhagyáskor és törléskor a nyitott keretek újraszámolódnak. |
| D9 | Mi legyen, ha a betegszabadság túllépi a keretet? | **Csak jelzés.** A 15 napon felüli rész táppénzes keresőképtelenség; a kérelmet nem akadályozza. |
| D10 | Kinek jár apasági szabadság? | **A HR jelöli a gyereknél** (apa vagy örökbefogadó), mert a nemet nem tároljuk. |

**Megvalósítás** — `migrations/009_leave_absences_types_history.sql`

- [x] **Szabadságtípusok egy helyen:** `server/leave-types.ts` (`annual | sick | paternity | parental | unpaid | other`). A szerver elutasítja az ismeretlen típust; az értesítések, a kérelem-űrlap és az irányítópult ugyanezt a listát használja.
- [x] **Nem munkában töltött idő (Mt. 115. §):**
  - új tábla: `employee_absence_periods` (`unpaid_leave | childcare_unpaid_leave | unexcused_absence | other`); az egyébhez kötelező a megjegyzés;
  - a jóváhagyott `unpaid` kérelmek maguktól beszámítanak (`unpaid_request`);
  - a számítás a munkaviszony-időszakból vonja le őket; az átfedő időszakok egyszer számítanak;
  - gyermekgondozási fizetés nélküli szabadságnál az első 6 hónap még munkában töltött idő;
  - a szabálykészlet `hu-mt@2`; a régi pillanatképekben nincs `nonCountingDays` (= 0);
  - a bontásban: „Arányosítás (306/365 nap munkaviszony, ebből 31 nap nem munkában töltött)”.
- [x] **Betegszabadság (Mt. 126. §):** évi 15 munkanap, év közbeni belépésnél vagy kilépésnél arányosan. Nem tároljuk, a kérelmekből számoljuk (az év a kérelem kezdő dátuma szerint). A kérelem-űrlap jelzi, hány nap lépné túl.
- [x] **Apasági szabadság (Mt. 118. § (4)):** 10 munkanap gyerekenként, a születést követő negyedik hónap végéig, legfeljebb két részletben. Ellenőrzés beadáskor (a függő kérelmekkel együtt) és jóváhagyáskor.
- [x] **Szülői szabadság (Mt. 128/A. §):** 44 munkanap gyerekenként, a harmadik születésnap előtti napig, egy év munkaviszony után.
- [x] A gyerekhez kötött kérelem hivatkozik a gyerekre (`leave_requests.child_id`); a kérelem-űrlapon gyerekválasztó a maradék napokkal és a határidővel.
- [x] **Egyéb keretek kártya** (`OtherAllowances.svelte`) az adatlapon és a saját irányítópulton; `getLeaveAllowances` — saját, `leave.balance.manage` vagy `leave.approve` joggal.
- [x] **Változásnapló** (`leave_balance_history`, `server/leave-history.ts`): létrehozás, tömeges létrehozás, újraszámolás (ha változott), korrekció, számítás alkalmazása, kézi beállítás — előtte és utána állapottal, a végrehajtóval. A keret-kártyán „Előzmények” ablak; csak `leave.balance.manage` joggal.
- [x] 55 teszt (új: távollétek, 6 hónapos szabály, betegszabadság, határidők).

**Hátravan**

- [ ] A dolgozó bejelentheti az adatait (pl. új gyerek), a HR jóváhagyja.
- [ ] Az áthozott napok március 31-i határideje és a „először az áthozottból fogy” sorrend (2. fázisból).
- [ ] Örökbefogadásnál az apasági határidő az örökbefogadást engedélyező határozattól számít; most a születési dátumtól számolunk.

## 12. Szakmai ellenőrzést igényel

Ezeket bérszámfejtővel vagy munkajogásszal kell átnézetni, mielőtt élesbe megy:

- A teljes éves összeget arányosítjuk (D7). Tételenként ugyanez az eredmény jönne ki, de a kerekítés miatt eltérhet.
- Év közben keletkező egészségkárosodás: az 1. fázisban a teljes 5 nap jár, ha az érvényesség átfed az évvel. A HR korrigálhat.
- Kit tekintünk gyereknek (vér szerinti, örökbe fogadott, nevelt, mostoha, közös háztartás)? Ezt a HR dönti el, a rendszer csak rögzít.
- Részmunkaidő: tudomásunk szerint a szabadság napokban nem csökken, ezért a motor nem kezeli.
- Szülői szabadság: gyerekenként 44 napként kezeljük. Ellenőrizendő, hogy a törvény gyerekenként vagy összesen adja-e.
- Betegszabadság arányosítása: ugyanazzal a kerekítéssel számolunk, mint a szabadságnál (fél nap felfelé).
- A távollétek naptári napokban csökkentik az arányosítás alapját (egy péntektől hétfőig tartó fizetés nélküli szabadság 4 nap).

## 13. Kapcsolódó meglévő hibák (külön feladatok)

- A függőben lévő kérelmek nem foglalják le a napokat, így több kérelem együtt túllépheti a keretet.
- Az évhatáron átnyúló kérelem teljes egészében a kezdő évet terheli (`leave.ts`: `createLeaveRequest`, `approveLeaveRequest`, `deleteLeaveRequest`).
- A `LeaveRequests.svelte` keret-ablaka halott kód: az `openBalanceModal`-t sehol nem hívjuk, és az `organizationId` is hiányzik belőle.
- A `leave_requests.approved_by` mezőt semmi nem tölti ki.
- Az újonnan létrehozott cégek `org_admin` szerepköréből hiányzik a `leave.calendar.manage` (`SYSTEM_ROLE_DEFINITIONS`).

## Források

- [HR Portál – Szabadság számítása 2026](https://www.hrportal.hu/hr/szabadsag-szamitasa-2026-20251219.html)
- [ÁllásKisokos – Pótszabadság életkor szerint 2026](https://www.allaskisokos.hu/potszabadsag-eletkor-szerint-2026)
- [RSM – Szabadság mértéke](https://www.rsm.hu/kisokos/szabadsag-merteke) (az apasági szabadságnál a 2023 előtti állapotot mutatja)
- [Andersen – Mt. 2023-as változásai](https://hu.andersen.com/hu/hirek/a-munka-torvenykonyve-2023-januar-1-tol-hatalyos-valtozasai/)
- [Jogászvilág – Arányosítás év közben](https://jogaszvilag.hu/cegvilag/a-szabadsag-aranyositasa-evkozben-kezdodo-vagy-megszuno-munkaviszonyban/)
- [Szakszervezetek.hu – Gyermekek után járó pótszabadság](https://szakszervezetek.hu/dokumentumok/munkajog/3386-a-gyermekek-utan-jaro-potszabadsag)
