# Szabadságnapok és szabadságnaptár

> Státusz: 1–3. fázis kész · Utolsó módosítás: 2026-09-11

Ma a szabadság egyetlen igazságforrása a szabadságkérelem (`leave_requests`): egy intervallum és egy `days` szám. Ebből nem lehet utólag egy napot kivenni, és a HR nem látja napokra bontva, ki mikor van szabadságon. A cél, hogy a kérelem **beadott, utólag nem módosuló meta sor** maradjon, a tényleges szabadság viszont **napszinten** legyen tárolva. A napok táblája lesz az igazságforrás a szabadságok mutatásához, a keretek terheléséhez és a naptárhoz. A nyilvántartó oldalon a kérelmek listája alá naptárnézet kerül, amiben a HR napokat vehet fel és törölhet.

## 1. Hatókör

**Benne van**

- Új tábla a jóváhagyott szabadságnapoknak (`leave_days`), a kérelemhez kötve.
- Jóváhagyáskor a munkanapok egyesével bekerülnek; a kérelem törlésekor a napjai is törlődnek.
- Minden számítás átáll a napokra: éves keret felhasználása, áthozott napok, betegszabadság, apasági és szülői keret, fizetés nélküli szabadság, dashboard.
- Átfedés-ellenőrzés: egy dolgozónak egy napra egy szabadsága lehet.
- A meglévő jóváhagyott kérelmek napjainak legenerálása migrációval.
- Naptárnézet a nyilvántartó oldalon havi bontásban, dolgozószűrővel.
- Szerkesztés a naptárban (kiválasztott dolgozóval): nap felvétele és törlése, mentés egy lépésben.
- A felvett napokból összefüggő szakaszonként egy-egy, rögtön jóváhagyott kérelem.
- Értesítések a dolgozónak a törölt és a felvett napokról (rendszeren belül és emailben).
- A kérelmek listájában a rögzítés dátuma.

**Nincs benne**

- Fél napok és órában mért szabadság (a nap marad az egység).
- A kérelem utólagos szerkesztése (dátum, típus, indoklás). A kérelem beadás után nem változik (D1).
- A dolgozó saját naptáras szerkesztése: a dolgozó továbbra is kérelmet ad be.
- Éves naptárnézet, csapatnézet, exportok (későbbi fázis).
- A szabadság kiadásának szabályai (Mt. 122–123. §: közlési határidők, 14 egybefüggő nap).

## 2. A mai működés

- `createLeaveRequest`: a munkanapokat a szervezet munkanaptárával számolja (`calculateWorkingDays`), éves szabadságnál a keretet ellenőrzi, `pending` státusszal ment, értesíti a beállításokban megjelölt dolgozókat.
- `approveLeaveRequest`: újraszámolja a napokat az akkori naptárral, éves szabadságnál `leave_balances.used_days`-t növeli, fizetés nélkülinél újraszámolja a keretet, értesíti a dolgozót.
- `deleteLeaveRequest`: jóváhagyott éves szabadságnál visszaadja a napokat a keretbe, törli a kérelmet, értesít.
- A kérelmek intervallumából számol: `dashboard.ts` (e havi szabin lévők), `leave-carry-over.ts` (áthozott napok felhasználása), `leave-allowances.ts` (betegszabadság, gyerekes keretek), `leave-profile.ts` (fizetés nélküli szabadság mint távollét).
- Átfedő kérelmeket semmi nem tilt.

## 3. Döntések

| # | Kérdés | Döntés | Állapot |
|---|---|---|---|
| D1 | Módosul-e a kérelem utólag? | **Nem.** A kérelem beadott meta sor: a kért időszak, a kért napok száma, a státusz és a döntés nyoma. A napok törlése és felvétele csak a `leave_days` táblát érinti. Ha egy kérelem minden napját törlik, a kérelem `approved` marad, de nincs érvényes napja. | **eldöntve** |
| D2 | Mi az igazságforrás? | A `leave_days` tábla. Minden keret-, felhasználás- és naptárszámítás ebből dolgozik. A kérelem `days` mezője a beadáskor kért napok száma marad, tájékoztató érték. | **eldöntve** |
| D3 | Mikor kerül be egy nap? | **Jóváhagyáskor.** A függő kérelem napjai nincsenek a táblában; a naptár a kérelem intervallumából mutatja őket halványan. | javasolt |
| D4 | Honnan jön a nap típusa? | A naptól, nem a kérelemtől: a `leave_days.leave_type` a kérelemből másolódik, hogy a lekérdezéseknek ne kelljen JOIN-olni. | javasolt |
| D5 | Lehet-e nap kérelem nélkül? | **Nem.** A naptárban felvett napokhoz is kérelem készül (D7), ezért a `leave_request_id` kötelező. | javasolt |
| D6 | Átfedés | Egy dolgozónak egy napon egy szabadsága lehet (`UNIQUE (employee_id, day)`). Beadáskor és jóváhagyáskor a szerver ellenőrzi, a naptárban a foglalt nap nem vehető fel újra. | javasolt |
| D7 | Mi számít összefüggőnek a naptárban? | A felvett napokat **munkanapok szerint** bontjuk szakaszokra: két felvett nap egy szakaszban van, ha köztük csak nem munkanap (hétvége, munkaszüneti nap) áll. Péntek és a következő hétfő így egy kérelem (péntek–hétfő, 2 munkanap), ahogy egy kézzel beadott kérelemnél is. Június 4–6, július 3–4 és augusztus 10 három kérelem. | javasolt |
| D8 | A naptárból készült kérelem | `status = 'approved'`, `approved_by` a HR dolgozói sora, `reason` üres, `start_date` és `end_date` a szakasz első és utolsó felvett napja, `days` a felvett napok száma. Új-kérelem értesítés nincs. | **eldöntve** |
| D9 | Milyen típus vehető fel a naptárban? | Típusválasztó a naptár fölött: éves, betegszabadság, fizetés nélküli, egyéb. Alapértelmezés az éves. Az apasági és a szülői szabadság kimarad, mert gyereket kell hozzá választani; azt kérelemként kell rögzíteni. | javasolt |
| D10 | Mentés | A törlések és a felvételek **egy tranzakcióban** futnak. Ha bármelyik ellenőrzés elbukik (keret, átfedés, ismeretlen nap), semmi nem mentődik, a hiba megnevezi az okot. | javasolt |
| D11 | Keret a mentésnél | Az éves szabadságnapok együttes száma nem lépheti túl a maradék keretet, a törölt napokkal együtt számolva (aki 3 napot töröl és 3-at felvesz, annak nem kell plusz keret). Évenként külön. | javasolt |
| D12 | Éves keret terhelése | `leave_balances.used_days` = az adott év jóváhagyott éves szabadságnapjainak száma a `leave_days` táblából, **minden változás után újraszámolva**, nem növelve és csökkentve. A nap éve számít, nem a kérelem kezdőnapjáé: az évet átlépő kérelem két keretet terhel. | javasolt |
| D13 | Ki látja a naptárat? | Aki `leave.request` joggal belép az oldalra, látja, ki mikor van távol (név, típus nélkül). A típust a `leave.approve` jog adja, meg a dolgozó a saját napjainál; a szerkesztést csak a `leave.approve`. A betegszabadság egészségügyi adat, ezért a kollégák nem látják a típust. | javasolt |
| D14 | Kérelem törlése | A HR mostani „Törlés” művelete marad: a kérelem és a napjai (CASCADE) törlődnek, a dolgozó értesítést kap. Ez az egyetlen eset, amikor egy beadott kérelem eltűnik. | javasolt |
| D15 | Migráció | A meglévő `approved` kérelmek napjait SQL generálja a munkanaptár figyelembevételével. Ha két kérelem átfed, a korábban beadott nyer, a másik napjai kimaradnak (naplózva). A `used_days` a migráció végén újraszámolódik. | javasolt |
| D17 | Céges kötelező szabadság | Új típus (`company_mandatory`), pl. a két ünnep közötti napok vagy a nyári leállás. A munkáltató által kiadott éves szabadság (Mt. 122. §), ezért **az éves keretet terheli**, mint az éves szabadság. Csak a jóváhagyó rögzítheti (kérelemként és a naptárból is), a dolgozó nem adhatja be. | javasolt |
| D18 | Év lezárása | A HR (`leave.balance.manage`) lezárhat egy évet: arra és a korábbi évekre nem lehet szabadságot beadni, jóváhagyni, törölni vagy a naptárban módosítani. A beállítás a legutolsó lezárt év (`settings:leave_closed_year:org_<id>`); jövő év nem zárható; az újranyitás egy évvel visszalép. A függő kérelem visszavonása lezárt évben is lehet. | javasolt |
| D16 | Értesítés a naptáras mentésről | Mentésenként egy-egy összefoglaló: a törölt napokról és a felvett szakaszokról, rendszeren belül és emailben. Nem kérelmenként, hogy három szakasz ne legyen három email. Ha a HR a saját napjait szerkeszti, nem kap értesítést (mint ma). | javasolt |

## 4. Folyamat

```
Kérelem (leave_requests)            Napok (leave_days)

 beadás ──▶ pending ──jóváhagyás──▶ approved ──▶ munkanaponként egy sor
               │                       │
               ├──elutasítás──▶ rejected           HR naptár: nap törlése ──▶ a sor törlődik,
               └──visszavonás (a dolgozó)──▶ withdrawn
                                                   a kérelem nem változik (D1)
 HR naptár: nap felvétele ──▶ szakaszonként új approved kérelem ──▶ napok
 HR: kérelem törlése ──▶ a kérelem és a napjai törlődnek (D14)
```

**Mentés a naptárban (`saveLeaveCalendar`), egy tranzakcióban:**

1. Jog: `leave.approve`. A dolgozó a szervezet tagja.
2. A törlendő napok léteznek és a dolgozóhoz tartoznak. A felveendő napok munkanapok a munkanaptár szerint, nincs rajtuk szabadság, és nem szerepelnek a törlendők között.
3. Törlés: `DELETE FROM leave_days`. A kérelem nem változik.
4. Felvétel: a napok szakaszokra bontása (D7), szakaszonként `INSERT` a `leave_requests` táblába `approved` státusszal (D8), majd a napok beszúrása.
5. Keret: éves szabadságnál évenként ellenőrzés (D11), utána `used_days` újraszámolása (D12). Fizetés nélkülinél a keret újraszámolása (`recalculateEmployeeBalances`).
6. `COMMIT`, utána értesítések (D16), best-effort.

## 5. Követelmények

**K1. Napok a jóváhagyásból.** Jóváhagyáskor a szerver a kérelem időszakának munkanapjait (a jóváhagyáskori munkanaptárral) egyesével a `leave_days` táblába írja. Ha bármelyik nap már foglalt, a jóváhagyás hibával áll le és megnevezi a napot.

**K2. Átfedés beadáskor.** Beadáskor a szerver elutasítja a kérelmet, ha az időszak munkanapjai közül bármelyik már foglalt, vagy egy másik függő kérelem időszakába esik.

**K3. Számítások a napokból.** A következők a `leave_days` táblából dolgoznak:

- `leave_balances.used_days`: az év éves szabadságnapjai (D12);
- áthozott napok felhasználása (`enrichCarryOver`): a határidő előtti napok száma naponként;
- betegszabadság felhasználása: az év betegszabadság-napjai; a függő rész a függő kérelmek `days` mezőjéből marad;
- apasági és szülői keret: a gyerekhez kötött napok száma és a részletek száma (a kérelmek száma marad a részletek alapja);
- fizetés nélküli szabadság mint távollét: a napokból összefüggő időszakok (a naptári napok szerint), a mostani `approvedUnpaid` helyett;
- dashboard: „e havi szabin lévők” a hónap napjaiból.

**K4. Kérelem törlése.** A kérelem törlése a napjait is törli, utána a `used_days` és a fizetés nélküli keret újraszámolódik.

**K5. Naptár lekérdezése.** Egy időszakra (jellemzően egy hónap) visszaadja a napokat dolgozónként: nap, dolgozó, típus (csak `leave.approve` joggal), kérelem azonosító; és a függő kérelmek munkanapjait külön listában (D3).

**K6. Naptárnézet.** A nyilvántartó oldalon a kérelmek listája alatt, „Naptár” címmel: havi rács hétfői kezdéssel, előző és következő hónap, „ma” gomb. Nem munkanapok (hétvége, munkaszüneti nap) szürkék. Szűrő nélkül minden cellában a távol lévők neve (legfeljebb három név, utána „+N”, a teljes lista tooltipben). Függő kérelmek halványan, „függőben” jelöléssel.

**K6/b. Éves nézet és csapatnézet.** A naptár fölött nézetváltó: Hónap, Év, Csapat. Az éves nézet tizenkét kis havi rács; szűrő nélkül a cellában a távol lévők száma, szűrővel a nap típusának színe. Szerkeszteni a havi és az éves nézetben lehet. A csapatnézet a hónap napjai oszloponként, soronként egy aktív dolgozó (szűrővel csak ő), a cella a típus színét kapja, a függő kérelem szaggatott; a sor végén a hónap jóváhagyott napjainak száma. Csak olvasásra. Saját nézetben nincs csapatnézet.

**K6/c. Napi részletek.** Szerkesztés nélkül (nincs kiválasztott dolgozó, vagy nincs jóváhagyó jog) a havi és az éves nézetben a napra kattintva a nap mellett felugró doboz mutatja a nap összes bejegyzését: név és típus (a típus csak a jóváhagyónak), a függő kérelmek külön jelölve. Ugyanarra a napra kattintva, kívülre kattintva vagy Escape-re bezárul; jobbra nyílik, ha nem fér ki, balra.

**K7. Dolgozószűrő.** A naptár fölött dolgozóválasztó (a szervezet aktív dolgozói). Kiválasztott dolgozóval csak az ő napjai látszanak, típusonként színezve (jelmagyarázattal).

**K8. Szerkesztés.** Csak `leave.approve` joggal és kiválasztott dolgozóval. Üres munkanapra kattintva a nap „felveendő” (a kiválasztott típussal, D9), meglévő napra kattintva „törlendő”; ugyanarra a napra újra kattintva a jelölés visszavonódik. A függő módosítások láthatóan eltérnek (szaggatott keret, áthúzás). Nem munkanapra és függő kérelem napjára nem lehet kattintani. Az összegzősáv mutatja: N nap felvétele (szakaszok száma), M nap törlése, és éves típusnál a maradék keretet a módosítás után. „Mentés” és „Elvetés” gomb; hónapváltáskor a jelölések megmaradnak. Ha van mentetlen jelölés, a dolgozószűrő váltása előtt megerősítést kérünk.

**K9. Mentés.** A 4. fejezet folyamata. Siker után a naptár és a kérelmek listája frissül, a HR visszajelzést kap (hány nap, hány kérelem). Hiba esetén a jelölések megmaradnak, a hiba megjelenik.

**K10. Rögzítés dátuma.** A kérelmek listájában új „Rögzítve” oszlop (`created_at`, dátum és idő), rendezhető. Alapértelmezett rendezés marad a rögzítés szerint csökkenő.

**K10/b. Ebből érvényes.** A kérelmek listájában a kért napok mellett külön oszlop mutatja, hány nap tartozik ma a kérelemhez a `leave_days` táblából. Jóváhagyott kérelemnél, ha kevesebb a kértnél (a HR a naptárban törölt belőle), kiemelve, a tooltip megmondja, hány napot töröltek. Függő és elutasított kérelemnél üres.

**K12/b. Függő kérelem visszavonása.** A dolgozó a saját függő kérelmét visszavonhatja: a saját naptárban a kérelem napjára kattintva (megerősítés után), vagy a kérelmek listájának műveletéből. A kérelem `withdrawn` státuszba kerül, nem törlődik. Aki a beadásról értesült, rendszeren belüli értesítést kap a visszavonásról; email nincs.

**K13. Év lezárása.** A munkanaptár oldalon a megjelenített évhez „{év} lezárása” gomb (`leave.balance.manage`), megerősítéssel. Lezárt évnél „Lezárt év” jelvény és magyarázat; a legutolsó lezárt év újranyitható. A szerver a kérelem beadásakor, jóváhagyásakor, törlésekor és a naptáras mentésnél ellenőrzi; a szabadságnaptár a lezárt évek napjait nem engedi jelölni és jelzi a lezárást.

**K14. Áthelyezett napok szinkronja.** A munkanaptár figyelmeztet, ha az évben az áthelyezett munkanapok és a máskor ledolgozott szabadnapok száma nem egyezik. Csak jelzés, nem tilt.

**K15. Kérelem a saját naptárból.** A dolgozó a saját naptárában (alapból az éves nézetben) üres munkanapokra kattintva jelöli ki a kért napokat; a jóváhagyott és függő napjai látszanak, azokra nem lehet jelölni. Az összegzősáv a szerver előnézetéből mutatja, hány kérelem lesz (az összefüggő napok egy kérelem, mint a HR-nél), és a keretet a módosítás után: **a maradékból a függő kérelmek napjai is le vannak vonva**, ennél többet nem jelölhet. Típus: éves, betegszabadság, fizetés nélküli, egyéb (a gyerekhez kötött típusok az űrlapon maradnak). A beküldés egy tranzakcióban szakaszonként egy függő kérelmet hoz létre, és a beadásról egy összevont értesítés megy a megjelölt dolgozóknak (az időszakok felsorolva). Az űrlap megmarad.

**K11. Értesítések.** A dolgozó értesítést kap a naptárból törölt napokról (a napok listájával) és a felvett szakaszokról (időszakonként a munkanapok számával), rendszeren belül és emailben (D16). A műveletet végző HR nem kap értesítést a saját napjairól.

**K12. Migráció.** A meglévő jóváhagyott kérelmek napjai legenerálódnak (D15). A migráció idempotens (`ON CONFLICT DO NOTHING`).

## 6. Adatmodell

Új migráció: `016_leave_days.sql`, a meglévő konvenciókkal (idempotens, `SERIAL`, magyar fejléckomment, `idx_<tábla>_<oszlopok>`).

```sql
CREATE TABLE IF NOT EXISTS app__racona_work.leave_days (
    id               SERIAL PRIMARY KEY,
    employee_id      INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    leave_request_id INTEGER NOT NULL REFERENCES app__racona_work.leave_requests(id) ON DELETE CASCADE,
    day              DATE NOT NULL,
    -- A kérelemből másolva (D4): annual | sick | paternity | parental | unpaid | other
    leave_type       VARCHAR(50) NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, day)
);

CREATE INDEX IF NOT EXISTS idx_leave_days_org_day
    ON app__racona_work.leave_days(organization_id, day);
CREATE INDEX IF NOT EXISTS idx_leave_days_request
    ON app__racona_work.leave_days(leave_request_id);
CREATE INDEX IF NOT EXISTS idx_leave_days_employee_type_day
    ON app__racona_work.leave_days(employee_id, leave_type, day);
```

**Visszatöltés a meglévő kérelmekből** (D15): `generate_series(start_date, end_date)` a jóváhagyott kérelmekre, a `work_calendar_days` szerinti felülírással, egyébként a hétvége-szabállyal; `ORDER BY created_at, id` és `ON CONFLICT (employee_id, day) DO NOTHING`, hogy átfedésnél a korábbi kérelem nyerjen. A kimaradt napokat a migráció `RAISE NOTICE`-szal jelzi. A végén `used_days` frissítése évenként a napok számából.

**A `leave_requests` tábla nem változik.** Az `approved_by` mezőt a naptáras kérelmeknél töltjük ki (ma a jóváhagyás sem tölti; a mostani jóváhagyás is töltse, hogy a naptáras és a kézi kérelem egyformán nézzen ki).

**A `leave_balances.used_days`** marad tárolt oszlop (a `remaining_days` generált oszlop ebből számol), de az értékét a szerver minden változás után a `leave_days` táblából állítja be (D12).

## 7. Szerver API

Új modul: `server/leave-days.ts`. A hívható függvényeket a `server/functions.ts` exportálja újra. Új jog nem kell.

**Tiszta segédfüggvények** (tesztelhetők, `tests/leave-days.test.ts`):

| Függvény | Leírás |
|---|---|
| `listWorkingDays(startDate, endDate, overrides)` | A munkanapok listája ISO napokként. A `calculateWorkingDays` ennek a hosszát adja vissza (a mostani logika, egy helyen). |
| `groupIntoRuns(days, isWorkingDay)` | A felvett napok szakaszokra bontása (D7): `{ startDate, endDate, days: string[] }[]`. A bemenet rendezetlen és duplikált is lehet. |
| `daysToPeriods(days)` | Naptári napok szerint összefüggő időszakok (`from`, `to`) a fizetés nélküli távolléthez (K3). |

**Hívható függvények:**

| Függvény | Jogosultság | Leírás |
|---|---|---|
| `getLeaveCalendar({ organizationId, from, to, employeeId? })` | `leave.request` | A `[from, to]` időszak napjai: `{ day, employeeId, employeeName, leaveType, leaveRequestId }[]`; a `leaveType` csak `leave.approve` joggal van kitöltve (D13). Külön `pending` lista a függő kérelmek munkanapjaival. Legfeljebb egy év (366 nap) egy hívásban, az éves nézethez. |
| `saveLeaveCalendar({ organizationId, employeeId, leaveType, addDays, removeDays })` | `leave.approve` | A 4. fejezet folyamata. Visszaad: `{ createdRequests: { id, startDate, endDate, days }[], removedDays: string[] }`. A `leaveType` csak a D9 szerinti típus lehet. |
| `previewLeaveCalendarSave({ organizationId, employeeId, leaveType, addDays, removeDays })` | `leave.approve` | Mentés nélkül: a szakaszok, a törlendő napok, évenként a keret a módosítás után, és a hibák listája (K8 összegzősáv). |

**Módosuló meglévő függvények:**

- `createLeaveRequest`: átfedés-ellenőrzés (K2).
- `approveLeaveRequest`: a napok beszúrása (K1), `approved_by` kitöltése, `used_days` újraszámolása a `+=` helyett, tranzakcióban.
- `deleteLeaveRequest`: a napok CASCADE törlődnek, utána `used_days` újraszámolás (a mostani `GREATEST(0, used_days - days)` helyett).
- `getLeaveRequests`: a `createdAt` már benne van; `sortBy: 'createdAt'` már támogatott.
- `enrichCarryOver`, `getLeaveAllowances` / `loadChildUsage`, `loadProfiles` (`approvedUnpaid`), `getDashboardStats`: a `leave_days` táblából (K3).
- Belső segéd: `syncAnnualUsedDays(client, employeeId, years[])` a `leave-days.ts`-ben; a `leave-profile.ts` újraszámolása (`recalculateEmployeeBalances`) nem nyúl a `used_days`-hez, ez marad így.

## 8. Felület

**`LeaveRequests.svelte`**

- A fejléc alatt „Kérelmek” cím (`leaveRequests.section.requests`), alatta a mostani lista.
- Új oszlop: „Rögzítve” (`createdAt`, `formatDateTime`), rendezhető (K10).
- A lista alatt „Naptár” cím (`leaveRequests.section.calendar`) és az új `LeaveCalendar` komponens. Dolgozói nézetben (`viewMode = 'mine'`) a naptár a saját dolgozóra szűrve, szerkesztés nélkül jelenik meg.

**`src/components/leave-calendar/LeaveCalendar.svelte`** (új; a rács a `WorkCalendar.svelte` `monthGrid` és `isWeekend` mintájára, közös segédbe kiemelve: `src/lib/calendar-grid.ts`)

- Fejléc: előző és következő hónap, hónap neve, „Ma”; dolgozószűrő (kereshető select, „Mindenki”); `leave.approve` joggal és kiválasztott dolgozóval a típusválasztó (D9).
- Rács: hét oszlop hétfővel, a nem munkanap szürke (a `getWorkCalendar` adataiból), a mai nap kiemelve.
- Cella tartalma szűrő nélkül: nevek (K6). Szűrővel: a nap típusának színe és rövid felirata; függő kérelem halványan.
- Szerkesztés (K8): kattintás a cellán, a jelölések `Set<string>`-ben (`toAdd`, `toRemove`), a szakaszok kliensoldalon a `groupIntoRuns` függvénnyel (a `server/leave-days.ts` tiszta része a kliensről is importálható, mint a `leave-types.ts`).
- Összegzősáv a rács alatt: N nap felvétele M kérelemben, K nap törlése, éves típusnál a keret a módosítás után (a `getLeaveBalances` adataiból); „Mentés”, „Elvetés”.
- Jelmagyarázat a típusokhoz és a jelölésekhez.

**Locale** (hu, en): `leaveRequests.section.*`, `leaveRequests.columns.createdAt`, `leaveCalendar.*` (fejléc, szűrő, típus, összegzősáv, jelmagyarázat, hibák, visszajelzés), az értesítések szövegei a `leave-notifications.ts` mintájára a szerverben.

## 9. Értesítések

A `leave-notifications.ts` két új eseménnyel bővül, a mostani mintával (best-effort, a műveletet végző nem kap értesítést):

| Esemény | Címzett | Rendszeren belül | Email sablon |
|---|---|---|---|
| Napok törölve a naptárból | a dolgozó | „Szabadságnapok törölve”, a napok felsorolása | `leave_days_removed` (új): a napok listája, a típus, a szervezet |
| Napok felvéve a naptárból | a dolgozó | „Szabadság rögzítve”, szakaszonként az időszak és a munkanapok száma | `leave_days_added` (új): a szakaszok listája |

A kérelem jóváhagyása, elutasítása és törlése a mostani `leave_request_status` sablonnal marad. Az új sablonok a meglévők szerkezetét követik (`requiredData`, `optionalData`, `locales.hu` és `en`, HTML és szöveges változat, a nevek HTML-escape-elve).

## 10. Fázisok és feladatok

### 1. fázis: napok tárolása ✅

- [x] Migráció `016_leave_days.sql`: tábla, indexek, visszatöltés, `used_days` újraszámolás (K12, D15)
- [x] `server/leave-days.ts`: `listWorkingDays`, `groupIntoRuns`, `daysToPeriods`, `syncAnnualUsedDays`; a `calculateWorkingDays` a `listWorkingDays`-re épül
- [x] `tests/leave-days.test.ts`: szakaszolás (hétvége és munkaszüneti nap nem szakít, rendezetlen bemenet, duplikátum), időszakok, munkanaplista
- [x] `approveLeaveRequest`: napok beszúrása tranzakcióban, átfedés-hiba, `approved_by`, `used_days` szinkron (K1)
- [x] `createLeaveRequest`: átfedés-ellenőrzés (K2)
- [x] `deleteLeaveRequest`: `used_days` szinkron (K4)
- [x] Fogyasztók átállítása: `leave-carry-over.ts`, `leave-allowances.ts`, `leave-profile.ts`, `dashboard.ts` (K3)
- [x] „Rögzítve” oszlop a listában, „Kérelmek” cím (K10)
- [x] Locale (hu, en)
- [x] Kézi ellenőrzés a dev adatbázison: évet átlépő éves kérelem két keretet terhel; átfedés jóváhagyott nappal és függő kérelemmel tiltva; törlés után a keret visszaáll; dashboard és keretek a napokból

**Megvalósítás, eltérések a tervtől**

- A jóváhagyás `UPDATE … WHERE status = 'pending'` feltétellel fut a tranzakcióban, így két egyszerre jóváhagyó közül a második hibát kap.
- Az éves keret ellenőrzése beadáskor is a napok éve szerint történik (nem a kezdőnap éve szerint), ezért az évet átlépő kérelemhez mindkét évre kell keret.
- A `calculateWorkingDays` megmaradt exportált függvényként, a `listWorkingDays` hosszát adja.

### 2. fázis: naptárnézet ✅

- [x] `getLeaveCalendar` (K5, D13): legfeljebb 62 nap, a típus csak `leave.approve` joggal, a függő kérelmek munkanapjai a munkanaptárral, a munkanaptár kivételei a válaszban
- [x] `src/lib/calendar-grid.ts` a `WorkCalendar.svelte`-ből kiemelve (`monthGrid`, `isWeekend`, `isoDay`, `monthRange`)
- [x] `LeaveCalendar.svelte` olvasásra: havi rács, nevek (legfeljebb három, utána „+N”, a teljes lista tooltipben), dolgozószűrő, függő kérelmek szaggatott kerettel, jelmagyarázat, mai nap kiemelve (K6, K7)
- [x] Beillesztés a `LeaveRequests.svelte` oldalra „Naptár” címmel; saját nézetben a saját dolgozóra rögzítve, szűrő nélkül; kérelem beadása, jóváhagyása, elutasítása és törlése után újratölt
- [x] Locale (hu, en)
- [x] Kézi ellenőrzés a dev felületen: mindenki nézet, dolgozószűrő típus szerinti jelmagyarázattal, hónapléptetés, függő kérelem napjai

### 3. fázis: szerkesztés a naptárban ✅

- [x] `saveLeaveCalendar` tranzakcióban (4. fejezet, D7–D12): a dolgozó sorának zárolása, ellenőrzés, törlés, szakaszonként jóváhagyott kérelem, keret szinkron
- [x] `previewLeaveCalendarSave`: a szakaszok, a törlendő napok, az érintett keretek és a hibák mentés nélkül (az összegzősávhoz)
- [x] Szerkesztés a felületen: jelölések, típusválasztó, összegzősáv a szerver előnézetéből, mentés, elvetés, megerősítés szűrőváltásnál (K8, K9)
- [x] Értesítések és a két új email sablon: `leave_days_removed`, `leave_days_added` (K11, D16)
- [x] Locale (hu, en)
- [x] Függő kérelem visszavonása a saját naptárban és a listában (K12/b): `withdrawLeaveRequest`, `withdrawn` státusz
- [x] Kérelem beadása a saját naptárból, szakaszokra bontva, a függő kérelmekkel csökkentett keret ellenőrzésével, összevont értesítéssel (K15)
- [x] Céges kötelező szabadság típus, az éves keretet terheli, csak a jóváhagyó rögzítheti (D17)
- [x] Év lezárása: `leave-closing.ts`, ellenőrzés a beadásnál, jóváhagyásnál, törlésnél és a naptáras mentésnél, gomb a munkanaptáron (K13, D18)
- [x] Áthelyezett napok szinkron-figyelmeztetése a munkanaptáron (K14); a „Ledolgozós munkanap” felirat „Áthelyezett munkanap” lett
- [x] Napi részletek felugró dobozban kattintásra a havi és az éves nézetben (K6/c)
- [x] Éves nézet és csapatnézet (K6/b); a naptár lekérdezése egy évre is engedélyezett
- [x] „Ebből érvényes” oszlop a kérelmek listájában (K10/b): a szerver a `leave_days` számát adja (`effectiveDays`), rendezhető
- [x] Kézi ellenőrzés a dev szerveren: a spec példája három kérelem (péntek és hétfő egy szakasz); nem munkanap, foglalt nap, függő kérelem napja, nem létező nap törlése, tiltott típus, egyszerre felvett és törölt nap, keret túllépése mind hibával áll meg; a kérelem `days` mezője a napok törlése után is változatlan (D1)

**Megvalósítás, eltérések a tervtől**

- A tiszta segédek (`listWorkingDays`, `groupIntoRuns`, `daysToPeriods`, `CALENDAR_LEAVE_TYPES`) a `server/leave-day-utils.ts` fájlba kerültek, mert a `leave-days.ts` szerver modulokat importál, és a kliens csak a tiszta részt húzhatja be. A `leave-days.ts` újraexportálja őket.
- Az összegzősáv szakaszait és keretét a szerver előnézete adja (`previewLeaveCalendarSave`), nem a kliens számolja: így a keret ellenőrzése egy helyen van, és a HR-nek nem kell `leave.balance.manage` jog a keret megjelenítéséhez.
- A mentés a dolgozó sorát zárolja (`FOR UPDATE`), hogy két egyszerre futó mentés egymás után ellenőrizzen.
- A megerősítés szűrőváltásnál a böngésző natív `confirm` ablakával történik.
- A jelölések sima `Set`-ben élnek, minden változásnál újra létrehozva. A `svelte/reactivity` (`SvelteSet`) nem használható a pluginban: a build csak a `svelte` és a `svelte/internal/client` csomagot veszi a core közös runtime-jából, a `svelte/reactivity` a csomagba kerülne a saját runtime-másolatával, és a jelölések nem frissítenék a felületet (dev módban egy runtime van, ott nem látszik).

### Későbbi ötletek

- Figyelmeztetés a kiküldetéseknél, ha az út szabadságos napra esik (a kiküldetés spec 2. fázisa ide kapcsolódik).

## 11. Kockázatok és ellenőrzendők

- **Migráció átfedő adatokon.** Ha az élő adatban van átfedő jóváhagyott kérelem, a második napjai kimaradnak és a `used_days` csökkenhet. A migráció naplóját élesítés előtt át kell nézni.
- **Naptár-változás jóváhagyás után.** Ma a napok a jóváhagyáskori naptárral rögzülnek; ha utána a HR munkaszüneti napot vesz fel, az érintett nap a `leave_days` táblában marad. A HR a naptárban törölheti. Automatikus követés nincs (szándékosan, hogy a rögzített nap ne változzon a háta mögött).
- **Betegszabadság a naptárból.** A naptáras felvétel nem ellenőrzi a 15 napos betegszabadság-keretet (a kérelem-űrlap sem tiltja, csak figyelmeztet). Az összegzősáv jelezze a túllépést, ahogy az űrlap teszi.
- **Adatvédelem.** A típus nélküli naptár a kollégáknak is mutatja, ki van távol. Ha ez a szervezetnek sok, a D13 szűkíthető `leave.approve` jogra beállítás nélkül is (egy feltétel a szerverben).
