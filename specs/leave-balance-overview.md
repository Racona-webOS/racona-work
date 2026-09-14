# Szabadság egyenleg

> Státusz: 0–2. fázis kész · Utolsó módosítás: 2026-09-14

A HR és a jóváhagyók ma dolgozónként, az adatlapon vagy az Éves szabadságkeretek oldalon látják, kinek mennyi szabadsága maradt. Nem látszik, hogy a szervezet vagy egy projekt **jó ütemben** használja-e a keretét: ki gyűjti a szabadságot év végére, és ki fogyasztja túl gyorsan. A cél egy **„Szabadság egyenleg”** oldal (mutatók, burn-down grafikon, dolgozói táblázat), és a Beállításokban egy **évenkénti felhasználási terv**: melyik hónap végéig a keret hány százalékát célszerű kivenni, és mekkora eltérés még rendben.

A terv tervezési és figyelmeztetési referencia, nem kötelezettség: nem tilt, nem ír elő kiadást (a kiadás szabályai: Mt. 122–123. §).

Látványterv: `specs/szabadsag_egyenleg_terv.webp` (a mintaadatai nem konzisztensek, a számítást ez a dokumentum írja le).

## 1. Hatókör

**Benne van**

- A dolgozó szabad szöveges „Részleg” mezőjének megszüntetése (0. fázis).
- Évenkénti szabadságfelhasználási terv a Beállítások → Szabadság oldalon: 12 havi halmozott százalék, tűrés és kritikus küszöb.
- A terv átvétele az évnyitáskor.
- „Szabadság egyenleg” oldal az Idő és szabadság menüben: mutatók, burn-down grafikon (tényleges, tervezett, tűréssáv, lefoglalt), dolgozói táblázat státusszal és trenddel.
- Szűrés: mindenki, egy projekt tagjai, projekt nélküliek.
- Hozzáférés: HR (`leave.balance.manage`) és jóváhagyók (`leave.approve`).

**Nincs benne**

- Csapat vagy szervezeti egység mint új fogalom. A csoportosítás a meglévő projekttagságra épül (D1).
- Projektenként vagy csoportonként eltérő terv (D5).
- Hozzáférés a projektvezetőknek jóváhagyó jog nélkül (D10).
- Automatikus emlékeztető a dolgozóknak (a pluginnak nincs ütemezője).
- Export (xlsx, PDF).
- Tagsági előzmény: a projektszűrő a mostani tagsággal számol (D2).

## 2. Döntések

| # | Kérdés | Döntés | Állapot |
|---|---|---|---|
| D1 | Mi a „csapat”? | **A projekt.** Egy dolgozó több projektben is lehet (`project_members`), ezért a szűrő egy dolgozói halmazt választ, nem kizárólagos besorolást. Nincs új csapat-entitás. | **eldöntve** |
| D2 | Projekttagság időben | A mostani tagság számít, az év minden hónapjára. Aki júliusban került a projektre, annak a januári adatai is a projekt görbéjében vannak. | **eldöntve** |
| D3 | A „Részleg” mező | **Megszűnik**, egy lépésben: a felületről, az API-ból, az üdvözlő emailből és az adatbázisból is (`DROP COLUMN`). A beosztás (`position`) marad. | **eldöntve** |
| D4 | Terv évenként | A terv évhez kötött. Ha egy évnek nincs saját terve, a legközelebbi korábbi év terve érvényes, ha az sincs, az egyenletes eloszlás. Évnyitáskor az éppen érvényes terv saját tervként átmásolódik az új évre, hogy egy későbbi módosítás a régi évet ne írja át. | **eldöntve** |
| D5 | Kinek szól a terv? | Céges szintű, egy terv évente. Projektenként nem lehet, mert egy dolgozó több projektben is benne van, és nem lenne eldönthető, melyik terv vonatkozik rá. | **eldöntve** |
| D6 | Mihez mérjük a tűrést? | Az **éves keret százalékában** (25 napos keretnél a 10% 2,5 nap), nem a tervezett maradékhoz: a tervezett maradék év végére 0, amihez viszonyítva minden eltérés végtelen lenne. Csoportnál a keretek összegéhez. | **eldöntve** |
| D7 | Státuszok | Rendben · Enyhén magas (a maradék a tűrésnél többel a terv felett) · Túl magas (a kritikus küszöbnél többel) · Gyorsan fogy (a tűrésnél többel a terv alatt). Két beállítás: tűrés és kritikus küszöb. | **eldöntve** |
| D8 | Mi számít felhasználtnak? | A **grafikon** és a „Fennmaradó” a ténylegesen kivett napokból számol (a nap ≤ a vonatkozási nap). A **„magas maradék”** a jóváhagyott jövőbeli (lefoglalt) napokat is levonja, mert aki előre lefoglalta a szabadságát, nem gyűjtöget. A **„gyorsan fogy”** csak a kivett napokból számol, hogy egy előre lefoglalt nyári szabadság márciusban ne riasszon. A függő kérelmek egyikbe sem számítanak, csak tájékoztatásként látszanak. | **eldöntve** |
| D9 | Év közbeni belépés és kilépés | A terv a munkaviszony hónapjaira skálázódik: a belépés hónapjától indul, és kilépésnél a kilépés hónapjára éri el a 100%-ot (4.2). A keret amúgy is arányosított. | **eldöntve** |
| D10 | Ki látja? | `leave.balance.manage` vagy `leave.approve` joggal az egész szervezetet. A projektvezető jóváhagyó jog nélkül nem látja. A menüpont `leave.approve`-hoz kötött (a menü egy képességet fogad; a rendszer szerepek közül akinek `leave.balance.manage` joga van, annak `leave.approve` is van). | **eldöntve** |
| D11 | Mit lát a jóváhagyó? | A keret összegét, a kivett, lefoglalt és függő napokat. A keret **bontását** (életkor, gyerekek, egészségkárosodás) nem: az továbbra is csak saját vagy `leave.balance.manage` joggal érhető el (specs/leave-entitlement.md, K7). | javasolt |
| D12 | Kik szerepelnek? | A szervezet nem kilépett (`status <> 'inactive'`) dolgozói, akiknek van keretük az évre. Akinek nincs, az nem számít bele az összegekbe; az oldal jelzi, hány ilyen dolgozó van, és linkel az Éves szabadságkeretek oldalra. | javasolt |
| D13 | Melyik típus fogyasztja a keretet? | Ami a `used_days`-t is: `BALANCE_LEAVE_TYPES` (éves és céges kötelező szabadság). A keret a `leave_balances.total_days` (benne az áthozatal és a korrekció). | javasolt |
| D14 | Hol számolunk? | A szerver dolgozónként a nyers havi adatokat adja egy hívásban (keret, havi kivett napok, lefoglalt, függő, munkaviszony, projektek, terv). A szűrést, az összesítést, a görbét és a státuszt egy **tiszta modul** számolja, amit a kliens is importál. Így a szűrőváltás nem hív szervert, és a képletek egy helyen, tesztelve vannak. | javasolt |
| D15 | Lezárt év terve | Lezárt év (specs/leave-days.md, D18) terve nem módosítható. | javasolt |
| D16 | Grafikon | Saját SVG, könyvtár nélkül: a plugin buildje a külső csomagot a saját bundle-jébe tenné, és egy vonal-, sáv- és pontgrafikonhoz nem éri meg. | javasolt |

## 3. Fogalmak

| Jelölés | Jelentés |
|---|---|
| Y | a kiválasztott év |
| t | vonatkozási nap: a mai nap (Europe/Budapest) az évre szorítva; múltbeli évnél dec. 31., jövőbelinél jan. 1. |
| K | a dolgozó kerete az évre (`total_days`) |
| kivett(d) | a dolgozó keretet terhelő `leave_days` napjainak száma Y-ban, `day ≤ d` |
| lefoglalt | a keretet terhelő `leave_days` napok száma Y-ban, `day > t` |
| függő | a keretet terhelő függő kérelmek Y-ba eső munkanapjai (az irányítópult keret-dobozának mintájára, specs/leave-days.md K16) |
| P[m] | a terv: az m. hónap végéig kivenni javasolt halmozott arány, `P[0] = 0` |

## 4. Számítás

A képletek a `server/leave-usage-plan-utils.ts` tiszta függvényei (7. fejezet).

### 4.1 A terv

- 12 egész szám 0 és 100 között, hónapról hónapra nem csökkenhet. A december lehet 100-nál kevesebb (ha a cég számol áthozatallal); ezt a felület jelzi, de engedi.
- **Egyenletes eloszlás:** `P[m] = round(100 · m / 12)` → 8, 17, 25, 33, 42, 50, 58, 67, 75, 83, 92, 100.
- Tűrés és kritikus küszöb: egész százalékok, `1 ≤ tűrés < kritikus ≤ 100`. Alapérték: 10 és 20.

### 4.2 A dolgozó terve (D9)

A munkaviszony Y-ban: `s` a kezdő hónap (a belépés hónapja, ha Y-ba esik, különben 1), `e` az utolsó hónap (a kilépés hónapja, ha Y-ba esik, különben 12).

```
cél  = a kilépés Y-ba esik ? 100 : P[12]
a    = P[s − 1],  b = P[e]

arány(m) = 0                                      ha m < s
         = cél                                    ha m ≥ e
         = (P[m] − a) / (b − a) · cél             ha b > a
         = (m − s + 1) / (e − s + 1) · cél        ha b = a (a terv ebben az időszakban lapos)
```

Teljes évre (`s = 1`, `e = 12`) `arány(m) = P[m]`.

**Hónapon belül** a vonatkozási nap arányosan: ha t az m. hónap d. napja, és a hónap D napos,
`arány(t) = arány(m − 1) + (arány(m) − arány(m − 1)) · d / D`.

**Tervezett maradék:** `tervezett(t) = K · (1 − arány(t) / 100)`.

### 4.3 A dolgozó értékei

```
fennmaradó  = K − kivett(t)
eltérés     = fennmaradó − tervezett(t)          (a táblázat „Eltérés” oszlopa, a grafikonnal egyező)
szabad      = K − kivett(t) − lefoglalt
tűrés_nap   = K · tűrés / 100,  kritikus_nap = K · kritikus / 100
```

**Státusz (D7, D8)**, az első teljesülő:

1. `K = 0` → nincs státusz („—”).
2. `szabad − tervezett > kritikus_nap` → **Túl magas**
3. `szabad − tervezett > tűrés_nap` → **Enyhén magas**
4. `fennmaradó − tervezett < −tűrés_nap` → **Gyorsan fogy**
5. egyébként → **Rendben**

A határon (pontosan a tűrés) még Rendben. Mivel `szabad ≤ fennmaradó`, a „magas” és a „gyorsan fogy” nem teljesülhet egyszerre.

**Trend:** az eltérés az utolsó legfeljebb hat hónap végén (az év elejéig visszamenve), az utolsó pont a vonatkozási nap. A vonal színe a mostani státuszé.

### 4.4 Csoport (a szűrt dolgozók)

Minden összeg a szűrt dolgozókon fut; egy dolgozó egy nézetben egyszer számít (D1).

- **Grafikon pontjai:** 13 pont, `i = 0` az év eleje, `i = 1…12` a hónapok vége.
  - tényleges: `Σ (K − kivett(hónap vége))`, csak a vonatkozási napig; a folyamatban lévő hónap pontja a vonatkozási nap.
  - tervezett: `Σ tervezett(hónap vége)`.
  - tűréssáv: `tervezett ± Σ K · tűrés / 100`, nullánál nem kisebb.
  - lefoglalt: a tényleges görbe utolsó pontjától halvány pontozott vonal: `Σ (K − kivett(hónap vége) − lefoglalt napok a hónap végéig)`.
- **Mutatók:**
  - Összesen fennmaradó: `Σ fennmaradó`; alatta a változás az előző hónap végéhez képest („12 nappal kevesebb, mint augusztus végén”).
  - Munkatársak: a dolgozók száma; „N rendben · M figyelmet igényel” (minden, ami nem Rendben és van státusza).
  - Felhasználási arány: `Σ kivett / Σ K`; „192 / 283 nap felhasználva”.
  - Átlagos fennmaradó: `Σ fennmaradó / n`; „Cél: Σ tervezett / n”, információs ikon a magyarázattal.

### 4.5 Példa

Egyenletes terv, t = 2026-09-14, K = 25, 14 nap kivett, 3 nap lefoglalt.

- `arány = 67 + (75 − 67) · 14 / 30 = 70,7%` → tervezett maradék `25 · 0,293 = 7,3` nap.
- fennmaradó 11, eltérés +3,7; szabad 8.
- `szabad − tervezett = 0,7 ≤ 2,5` → **Rendben**. Lefoglalt napok nélkül `3,7 > 2,5` → Enyhén magas lenne.

Belépés 2026-09-01, K = 10: `s = 9`, `a = 67`, `b = 100`, `cél = 100` → `arány(9) = 8 / 33 · 100 = 24,2%`, szept. 14-én `24,2 · 14 / 30 = 11,3%` → tervezett maradék 8,9 nap.

Kilépés 2026-06-30: `e = 6`, `b = P[6] = 50`, `cél = 100` → `arány(m) = 2 · P[m]`, június végén 100%.

## 5. Követelmények

### 0. fázis – a Részleg megszüntetése

**K1. Adatbázis.** Új migráció: `020_drop_employee_department.sql`, `ALTER TABLE app__racona_work.employees DROP COLUMN IF EXISTS department`. A fejléckomment megmondja, hogy a meglévő értékek elvesznek.

**K2. Szerver.** A `department` kikerül:

- `employees.ts`: `createEmployeeFromUser`, `createEmployeeWithUser` (paraméter, INSERT, válasz, üdvözlő email adatai), `getEmployees` (lista és a rendezési kulcs), `getEmployeeDetails`, `updateEmployee` (paraméter, a „legalább egy mező” hibaüzenet), `getMyEmployee`, az `Employee` típus;
- `organizations.ts`: tagok listája (`employeeDepartment`), dolgozó átvétele másik szervezetbe (az INSERT … SELECT), elérhető dolgozók listája;
- `projects.ts`: `listProjectMembers` és a `ProjectMemberRow` típus;
- `leave-profile.ts`: a tömeges keret-előnézet sora.

**K3. Felület.** Kikerül az új dolgozó két űrlapjáról és az adatlap „Alapadatok” kártyájáról. A Dolgozók listájában és az Éves szabadságkeretek oldalon a név alatt csak a beosztás marad.

**K4. Email.** Az `employee_welcome` sablonból kikerül a „Részleg:” sor (HTML és szöveges, hu és en) és a `departmentHtml`, `departmentText` adat.

**K5. Takarítás.** Dev seed (`migrations/dev/001_org_seed.sql`), locale (`employeeDetail.department`).

### 1. fázis – felhasználási terv

**K6. Tárolás.** `kv_store`, kulcs: `settings:leave_usage_plan:org_<id>:<év>`, érték: `{ months: number[12], tolerancePct, criticalPct }`.

**K7. Érvényes terv (D4).** Egy év terve: a saját, ha van; különben a legközelebbi korábbi évé; különben az egyenletes eloszlás 10/20 küszöbbel. A válasz megmondja a forrást (`own | inherited | default`, örökölt terv esetén az évet).

**K8. Évnyitás.** Az `openLeaveYear` ugyanabban a tranzakcióban saját tervként elmenti az új évre az éppen érvényes tervet, ha az évnek még nincs sajátja. Az évnyitás előnézete egy sorban jelzi: „Felhasználási terv: a 2026-os terv átvétele” (vagy „egyenletes eloszlás”).

**K9. Beállítások.** A Beállítások → Szabadság oldalon új szakasz, „Szabadságfelhasználási terv” címmel:

- Évválasztó: a legutolsó megnyitott év és az előző két év, valamint a következő év. Örökölt vagy alapértelmezett tervnél tájékoztató: „Ennek az évnek nincs saját terve, a 2025-ös terv érvényes.”
- Táblázat 12 sorral: hónap; halmozott százalék (számmező); a havi növekmény („+8%”); egy 25 napos példakeret tervezett maradéka a hónap végén.
- Gombok: „Egyenletes eloszlás” és „Előző év tervének átvétele” (csak kitöltik a mezőket, mentés nélkül).
- Tűrés és kritikus küszöb (%, rövid magyarázattal: „az éves keret százalékában; 25 napnál a 10% 2,5 nap”).
- Előnézeti mini-grafikon: a 25 napos példakeret tervezett görbéje a tűréssávval, a mezők változására frissül.
- Hibák a mező mellett: 0–100 közötti egész, nem csökkenhet, a küszöbök sorrendje. Decemberi 100% alatti értéknél figyelmeztetés: „Év végére a keret egy része megmarad; ez áthozatallal számol.”
- Lezárt évnél csak olvasható, „Lezárt év” jelvénnyel (D15).
- „Mentés” gomb, visszajelzés.

### 2. fázis – egyenleg oldal

**K10. Menü és hozzáférés (D10).** Új menüpont az Idő és szabadság alatt, az „Éves szabadságkeretek” után: „Szabadság egyenleg”, `#leave-balance`, ikon: `ChartLine` (vagy `TrendingDown`), `requiredCapability: leave.approve`. Az oldal jog nélkül az `AccessDenied` komponenst mutatja; a szerver `leave.approve` vagy `leave.balance.manage` jogot kér.

**K11. Fejléc.** Cím és alcím („Kövesd, hogyan használja a szervezet a szabadságkeretét az év során.”). Jobb oldalon évválasztó (azok az évek, amelyekre van keret; alapból az idei év) és a szűrő (K12).

**K12. Szűrő (D1).** Kereshető választó:

- „Mindenki” (alapértelmezett);
- „Projekt nélkül”: akinek nincs futó projektje;
- *Projektek* csoport: a futó (`active`, `paused`) projektek ABC-sorrendben, a tagok számával;
- „Lezárt projektek is” kapcsoló a lista alján (`completed`, `archived`).

A projektek listáját az egyenleg-hívás adja (csak név és státusz), mert a jóváhagyónak nem feltétlenül van projekt-láthatósági joga. A választás a böngészőben megmarad (localStorage, a meglévő összecsukás-mintával).

**K13. Mutatók.** Négy kártya (4.4): Összesen fennmaradó, Munkatársak, Felhasználási arány, Átlagos fennmaradó. Keskeny kijelzőn kettesével, telefonon egymás alatt.

**K14. Burn-down grafikon.** „Szabadság burn-down” cím, „Tényleges és tervezett fennmaradó szabadságnapok (összesen)” alcím.

- Tengelyek: a napok (0-tól kerek léptékkel) és a hónapok.
- Tényleges görbe (folytonos, pontokkal), tervezett (szaggatott), tűréssáv (halvány kitöltés), lefoglalt (halvány pontozott folytatás).
- Függőleges jelölő a vonatkozási napon.
- A pontra vagy a hónapra mutatva tooltip: hónap; tényleges; tervezett; eltérés („+8 nap, több a tervezettnél”); lefoglalt, ha van.
- Jelmagyarázat a grafikon alatt.
- A kártya jobb felső sarkában választó: „Összesítve” vagy egy dolgozó a szűrt listából. Dolgozónál a görbék az ő értékei, a sáv az ő tűrése. A táblázat sorára kattintva is ő lesz kiválasztva; „Összesítve” vissza.
- Jövőbeli évnél nincs tényleges görbe, csak a terv és a lefoglalt napok.

**K15. Táblázat.** „Munkatársak szabadság státusza” cím, keresőmező (név) és rendezés.

| Oszlop | Tartalom |
|---|---|
| Munkatárs | profilkép (vagy monogram), név, alatta a beosztás |
| Projektek | futó projektek címkéi, legfeljebb kettő, utána „+N”, a teljes lista tooltipben |
| Éves keret | K |
| Kivett | kivett(t) |
| Lefoglalt | lefoglalt; ha van függő kérelem, tooltip: „+3 nap függőben” |
| Fennmaradó | fennmaradó |
| Tervezett ({hónap}) | tervezett(t), egy tizedesre |
| Eltérés | előjellel; a státusz színével |
| Státusz | címke: Rendben (zöld), Enyhén magas (sárga), Túl magas (piros), Gyorsan fogy (kék); tooltipben a szabály számokkal („8 szabad nap, a terv 7,3; tűrés 2,5”) |
| Trend | mini vonal (4.3) |
| Műveletek | menü: „Adatlap” (a dolgozó adatlapja, mint az Éves szabadságkeretek oldalon), „Szabadságnaptár” (a nyilvántartó oldal naptára a dolgozóra szűrve, K16) |

- Rendezés: státusz súlyossága szerint (Túl magas, Enyhén magas, Gyorsan fogy, Rendben), azon belül az eltérés abszolút értéke szerint csökkenő (alapértelmezett); név; fennmaradó; kivett; eltérés.
- Év közben belépett vagy kilépő dolgozónál a név mellett kis címke: „belépett: szept. 1.”, „kilép: jún. 30.”.
- A táblázat alatt, ha van: „3 dolgozónak nincs kerete 2026-ra” link az Éves szabadságkeretek oldalra (D12).
- Telefonon a táblázat vízszintesen görgethető; a Munkatárs oszlop rögzített.

**K16. Naptár a dolgozóra szűrve.** A szabadság-nyilvántartó oldal fogad egy dolgozó-paramétert a hash-ben (`#leave-requests?employee=<id>`), és a naptár dolgozószűrőjét erre állítja. Ha a hívónak nincs `leave.approve` joga, a paramétert figyelmen kívül hagyja.

**K17. Üres és hibás állapotok.** Nincs kerettel rendelkező dolgozó a szűrésben: „Ebben a nézetben nincs kerettel rendelkező dolgozó.” Betöltés közben vázlat (skeleton), hibánál a hibaüzenet és „Újra” gomb.

## 6. Adatmodell

**Új tábla nincs.** A terv a `kv_store`-ban él (K6), a számítás a meglévő `leave_balances`, `leave_days`, `leave_requests`, `employees`, `project_members` és `projects` táblákból dolgozik.

**Migráció:** `020_drop_employee_department.sql` (K1).

Az egyenleg lekérdezéséhez a meglévő indexek elegendők: `idx_leave_days_employee_type_day`, `idx_leave_days_org_day`, `idx_project_members_employee_id`.

## 7. Szerver API

**Tiszta modul:** `server/leave-usage-plan-utils.ts` (adatbázis nélkül, a kliens is importálja, mint a `leave-day-utils.ts`).

| Függvény | Leírás |
|---|---|
| `uniformPlan()` | Az egyenletes eloszlás (4.1). |
| `validatePlan(input)` | A terv és a küszöbök ellenőrzése; hibakódok listája mezőnként. |
| `employeePlanShare(plan, employment, year, isoDay)` | A dolgozó tervezett aránya a napon (4.2). |
| `employeeFigures(row, plan, refDay)` | Fennmaradó, tervezett, eltérés, szabad, státusz, trend (4.3). |
| `aggregate(rows, plan, year, refDay)` | Mutatók és a grafikon pontjai (4.4). |
| `referenceDay(year, today)` | A vonatkozási nap (3. fejezet). |

**Szerver modul:** `server/leave-usage-plan.ts`; a hívható függvényeket a `server/functions.ts` exportálja újra.

| Függvény | Jogosultság | Leírás |
|---|---|---|
| `getLeaveUsagePlan({ organizationId, year })` | `leave.approve` vagy `leave.balance.manage` | Az érvényes terv (K7): `{ year, months, tolerancePct, criticalPct, source, inheritedFromYear, closed }`. |
| `saveLeaveUsagePlan({ organizationId, year, months, tolerancePct, criticalPct })` | `leave.balance.manage` | `validatePlan`, a lezárt év tiltása (D15), legfeljebb a jövő év. Felülírja az év saját tervét. |
| `getLeaveBalanceOverview({ organizationId, year })` | `leave.approve` vagy `leave.balance.manage` | Egy hívásban (D14): `refDay`, `plan` (mint fent), `projects: { id, name, status }[]`, `employees: { employeeId, name, image, position, hireDate, employmentEndDate, totalDays, takenByMonth: number[12], takenThroughRef, booked, bookedByMonth: number[12], pending, projectIds: number[] }[]`, `missingBalance: { employeeId, name }[]`. |

A `getLeaveBalanceOverview` lekérdezései (dolgozónként nem kérdez külön):

1. dolgozók és keretek: `employees` ⟕ `leave_balances` (az évre), `status <> 'inactive'`;
2. napok: `leave_days` a szervezetre és az évre, `leave_type = ANY(BALANCE_LEAVE_TYPES)`, `GROUP BY employee_id, hónap, (day <= refDay)`;
3. függő kérelmek: a keretet terhelő `pending` kérelmek, a munkanapok a munkanaptárral, az évre vágva (`listWorkingDays`);
4. projekttagság és projektek: `project_members` ⋈ `projects`, a szervezetre.

**Módosuló meglévő függvények:**

- `openLeaveYear` és `previewOpenLeaveYear`: a terv átvétele (K8).
- A 0. fázis függvényei (K2).

## 8. Felület

**`src/components/LeaveSettings.svelte`** — új szakasz (K9), a meglévő `settings-section` mintájára. A táblázat és a mini-grafikon külön komponens: `src/components/leave-balance/UsagePlanEditor.svelte`.

**`src/components/LeaveBalance.svelte`** (új oldal) és a `src/components/leave-balance/` mappa:

| Komponens | Tartalom |
|---|---|
| `BalanceKpis.svelte` | a négy mutató (K13) |
| `BurndownChart.svelte` | SVG grafikon: tengelyek, görbék, sáv, jelölő, tooltip, jelmagyarázat (K14); a beállítások mini-grafikonja is ezt használja egyszerűsített módban |
| `BalanceTable.svelte` | táblázat, keresés, rendezés, műveletek (K15) |
| `Sparkline.svelte` | trend-vonal |
| `ProjectFilter.svelte` | szűrő (K12) |

- A grafikon a szülő szélességéhez igazodik (`ResizeObserver`), a színek CSS-változók, sötét módban a `:global(.dark)` mintával.
- A jelölések (Set, Map) minden változásnál újra létrehozva, `svelte/reactivity` nélkül (specs/leave-days.md, 3. fázis megjegyzése).

**`menu.json`**, **`src/main.ts`**: az új oldal regisztrálása (K10).

**`LeaveRequests.svelte` / `LeaveCalendar.svelte`**: a hash-paraméter (K16).

**Locale** (hu, en): `menu.leaveBalance`, `leaveBalance.*` (fejléc, szűrő, mutatók, grafikon, táblázat, státuszok, tooltipek, üres állapotok), `settings.leaveUsagePlan.*`, `yearOpening.usagePlan.*`.

**Szóhasználat:** „kivett” a már elmúlt szabadságnap, „lefoglalt” a jóváhagyott jövőbeli, „függő” a még el nem bírált kérelem napja. A felület a „burn-down” szót csak a grafikon címében használja.

## 9. Tesztek

`tests/leave-usage-plan.test.ts` (`bun test`):

- Egyenletes terv: a 12 érték.
- Validáció: 12 elem, 0–100 közötti egész, csökkenő érték hiba, küszöbök sorrendje, decemberi 100 alatti érték nem hiba.
- Dolgozó terve: teljes év = P[m]; belépés szeptemberben (4.5); kilépés júniusban (100% június végén); belépés és kilépés ugyanabban a hónapban; lapos terv a munkaviszony idejére (lineáris); a belépés előtti hónapokban 0.
- Hónapon belüli arányosítás: a hónap első és utolsó napja, szökőév februárja.
- Státusz: a 4.5 példája lefoglalttal és anélkül; pontosan a tűrésen Rendben; kritikus küszöb felett Túl magas; lefoglalt nap nem okoz Gyorsan fogyt; K = 0 nincs státusz.
- Vonatkozási nap: múlt, jelen, jövő év.
- Összesítés: két dolgozó összegei, egy dolgozó egyszer számít; mutatók; tűréssáv nulla alá nem megy; jövő évnél nincs tényleges pont.

## 10. Fázisok és feladatok

### 0. fázis: a Részleg megszüntetése ✅

- [x] `020_drop_employee_department.sql` (K1)
- [x] Szerver: `employees.ts`, `organizations.ts`, `projects.ts`, `leave-profile.ts` (K2)
- [x] Felület: `EmployeeList.svelte`, `EmployeeDetail.svelte`, `LeaveEntitlements.svelte` (K3)
- [x] `employee_welcome` sablon (K4)
- [x] Dev seed, locale (K5)
- [x] Ellenőrzés a dev szerveren: a migráció lefutott, az oszlop eltűnt; a `getEmployees`, `getEmployeeDetails`, `updateEmployee`, `getMyEmployee`, `getOrganizationMembers`, `getAvailableEmployeesForOrganization`, `previewBulkEntitlements`, `listProjectMembers` válaszában nincs részleg; az új dolgozó űrlapján nincs Részleg mező; tesztek és build rendben
- [ ] Élesítés előtt: az üdvözlő email kiküldése és a dolgozó átvétele másik szervezetbe (a dev szerveren nincs email-küldés, az átvételt nem futtattuk), a sablon frissülése csomagtelepítéskor (11. fejezet)

### 1. fázis: felhasználási terv ✅

- [x] `server/leave-usage-plan-utils.ts`: `uniformPlan`, `validatePlan`, `employeePlanShare`, `referenceDay`
- [x] `tests/leave-usage-plan.test.ts`: a terv, a validáció, a dolgozó terve, a vonatkozási nap (21 teszt)
- [x] `server/leave-usage-plan.ts`: `getLeaveUsagePlan`, `saveLeaveUsagePlan` (K6, K7, D15), `functions.ts` exportok
- [x] Évnyitás: a terv átvétele és az előnézet sora (K8)
- [x] `UsagePlanEditor.svelte` és a szakasz a `LeaveSettings.svelte`-ben (K9)
- [x] Locale (hu, en)
- [x] Ellenőrzés a dev szerveren: alapértelmezett, saját és örökölt terv; hibás bevitel (csökkenő hónap, küszöbök sorrendje, két évnél későbbi év) a szerveren és a felületen; mentés a felületről; az évnyitás előnézetében a terv sora; az átmásolás visszagörgetett tranzakcióban (az örökölt tervből saját lesz, a korábbi év későbbi módosítása nem hat rá, a második másolás nem ír felül)
- [ ] Lezárt év terve: a mentés tiltása a dev adatbázisban nem volt kipróbálható (nincs lezárt év)

**Megvalósítás, eltérések a tervtől**

- A `getLeaveUsagePlan` a megnyitott és a lezárt évet is visszaadja, így a szerkesztőnek nem kell külön hívás az évválasztóhoz.
- Az évválasztóban a legutolsó megnyitott év, az előző kettő és a következő, valamint az idei év szerepel, legfeljebb a jövő év.
- Az évnyitás előnézetének szövegei a meglévő `workCalendar.opening.*` kulcsok mellé kerültek (`workCalendar.opening.usagePlan.*`), nem új `yearOpening.*` csoportba.
- A szerver a validáció első hibáját magyar üzenettel dobja (`planErrorMessage`); a felület a hibakódokat a locale fájlból fordítja.
- A mini-grafikon a szerkesztő saját, egyszerű SVG-je (terv és tűréssáv); a 2. fázisban a `BurndownChart` válthatja.
- A szerkesztő a közös `shared.css`-t importálja, és konténer-lekérdezéssel (`@container`) vált egyoszlopos elrendezésre, mert a plugin ablakának szélessége nem a képernyőé.

### 2. fázis: egyenleg oldal ✅

- [x] Tiszta modul (`server/leave-balance-utils.ts`): `employeeFigures`, `classifyStatus`, `filterRows`, `aggregate`; `tests/leave-balance.test.ts` (17 teszt: státusz a határon, lefoglalt napok, belépő, trend, szűrés, összesítés, múlt, jelen és jövő év, üres szűrés)
- [x] `getLeaveBalanceOverview` (`server/leave-balance-overview.ts`, D12–D14)
- [x] Menüpont és oldal, jogosultság (K10, K11)
- [x] `ProjectFilter.svelte` (K12)
- [x] `BalanceKpis.svelte` (K13)
- [x] `BurndownChart.svelte`, dolgozóválasztó, sorra kattintás (K14)
- [x] `BalanceTable.svelte`, `Sparkline.svelte`, keresés, rendezés, műveletek (K15)
- [x] Naptár a dolgozóra szűrve (K16)
- [x] Üres és hibás állapotok, sötét mód, keskeny kijelző (K17)
- [x] Locale (hu, en), verzióemelés (`manifest.json`, `public/manifest.json`: 0.8.53)
- [x] Ellenőrzés a dev szerveren: a lekérdezés három évre (2026, a keret nélküli 2025, a jövő évi 2027); a dolgozók számai kézzel visszaszámolva (belépő a terv skálázásával, Gyorsan fogy és Túl magas); a Mindenki, a Projekt nélkül és a projekt szűrő, a szűrő megjegyzése; a grafikon tooltipje; a grafikon dolgozóra váltása (a sorra kattintva is, újrakattintva vissza); a sor műveleti menüje (az utolsó sornál felfelé nyílik), a „Szabadságnaptár” a `navigateTo('LeaveRequests', { employeeId })` hívást indítja (a dev felület csak naplózza); a jövő év (nincs tényleges görbe, a terv szerinti státusz); az oldal nem görget vízszintesen, a táblázat a saját sávjával
- [ ] Élesben ellenőrizendő: a sor műveleteinek navigációja a core-ban (az adatlap megnyílik, a naptár a dolgozóra szűrve nyílik); csak `leave.approve` joggal, jog nélkül és csak `project.manage` joggal (a dev mód minden jogot megad); a sötét mód látványa

**Megvalósítás, eltérések a tervtől**

- A dolgozói és összesítő számítás külön tiszta modulba került (`server/leave-balance-utils.ts`), a terv segédei a `leave-usage-plan-utils.ts`-ben maradtak.
- A függő napok a függő kérelmek `days` mezőjének összege a kezdőnap éve szerint, ugyanúgy, mint a keret-ellenőrzésnél (nem munkanapokra bontva).
- K16: hash-paraméter helyett a core `navigateTo('LeaveRequests', { employeeId })` hívása; a `LeaveRequests` a propot a naptár új `initialEmployeeId` propjának adja, ami jóváhagyóként erre a dolgozóra szűr.
- K12: a szűrő natív választó csoportokkal (Projektek, Lezárt projektek), nem kereshető; a választás szervezetenként a böngészőben marad.
- K14: a folyamatban lévő hónap tooltipje a mai tényleges értéket a mai tervvel veti össze (nem a hónap végével); kiválasztott dolgozónál az alcím a nevét mutatja. A hónapnevek a hónapok végén állnak.
- K15: a sorra kattintás ki- és bekapcsolja a grafikon dolgozóját; a névre kattintva az adatlap nyílik. A 0 napos kerethez „Nincs keret” címke tartozik.
- K17: betöltéskor a közös töltésjelző (spinner), újratöltéskor a tartalom elhalványul; vázlat (skeleton) nincs.
- Az évválasztóban azok az évek szerepelnek, amelyekre van keret, és az idei év.
- A sor műveleti menüje az utolsó sornál felfelé nyílik, mert lefelé a táblázat görgethető doboza levágná.
- A táblázat görgethető dobozának `position: relative` kell, különben a rejtett (sr-only) fejlécfelirat az oldalt görgeti vízszintesen.

### Későbbi ötletek

- Projektvezetői „ki nincs bent a projektemből” nézet a szabadságnaptárban (jóváhagyó jog nélkül, típus nélkül).
- Emlékeztető a magas maradékú dolgozóknak (ütemező kell hozzá).
- Export (xlsx) a táblázatból.
- A figyelmet igénylő dolgozók száma a vezetői irányítópulton, linkkel az oldalra.

## 11. Kockázatok és ellenőrzendők

- **A Részleg végleg elvész.** A `DROP COLUMN` visszafordíthatatlan. Élesítés előtt mentés, és ha kell, a meglévő értékek lekérdezése (`SELECT id, department FROM employees WHERE department IS NOT NULL`).
- **Az email sablon frissülése.** Ellenőrizendő, hogy a csomag frissítésekor a core felülírja-e a már telepített `employee_welcome` sablont, és nem marad-e a régi, `departmentHtml`-t váró változat.
- **A jóváhagyók a keret összegét látják (D11).** A keret összegéből közvetve következtetni lehet az életkorra vagy a gyerekekre. Ha ez a szervezetnek sok, a D10 szűkíthető `leave.balance.manage` jogra.
- **Tagsági előzmény nincs (D2).** Egy év közben összeállt projekt görbéje az új tagok teljes évét mutatja. A felület a szűrő mellett tooltipben jelzi: „A projekt mostani tagjai, az egész évre.”
- **A terv módosítása visszamenőleg hat** az adott év nézetére (a tervezett görbe és a státuszok újraszámolódnak). Évenkénti tervvel és a lezárt év tiltásával ez az év közbeni módosításra szűkül; ez szándékos.
- **Nagy szervezet.** A D14 szerinti kliensoldali számítás néhány száz dolgozóig gyors. Ha ennél sokkal több, a szűrést és az összesítést a szerverre kell tenni (a tiszta modul ott is fut).
- **Munkaszüneti nap változása.** A kivett napok a `leave_days` táblából jönnek, így követik a naptáras módosításokat; a függő kérelmek munkanapjai a mostani munkanaptárral számolódnak (mint az irányítópulton).
