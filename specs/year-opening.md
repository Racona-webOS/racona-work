# Évnyitás és kötelező szabadságok kiírása

> Státusz: kész · Utolsó módosítás: 2026-09-11

Ma egy évre szabadságot akkor lehet rögzíteni, ha nincs lezárva (specs/leave-days.md, D18). A jövő évre is lehet napot jelölni, a mentés csak a hiányzó keret miatt bukik el. A cél: az év **megnyitásával** kezdődjön a szabadságkezelés. Az évnyitás minden dolgozónak beállítja az év keretét a számítás alapján, és a munkanaptárban kijelölt kötelező szabadság napjait jóváhagyott szabadságként kiírja mindenkinek. Nyitás után a „Kötelező szabadságok ellenőrzése” gomb bármikor újra lefuttatja a kiírást az év közben kijelölt napokra.

## 1. Hatókör

**Benne van**

- Évnyitás a munkanaptár oldalon, előnézettel: keretek és kötelező szabadságok dolgozónként, majd egy gombbal végrehajtva.
- A meg nem nyitott évre nem lehet szabadságot rögzíteni, kérni vagy jóváhagyni; a naptárban a napjaira nem lehet kattintani (mint a lezárt évnél).
- Kötelező szabadságok ellenőrzése és kiírása nyitott évre, előnézettel, bármikor újrafuttatható.
- A kiírt napokról a dolgozó értesítést kap (mint a naptáras rögzítésnél).

**Nincs benne**

- Az évnyitás visszavonása.
- Az áthozott napok évnyitáskor: a keret áthozatal nélkül készül, a HR utólag állítja be a dolgozó adatlapján (D4).
- Ha a HR egy kötelező szabadság napot kivesz a munkanaptárból, a már kiírt szabadság marad; törölni a szabadság-nyilvántartóban lehet.

## 2. Döntések

| # | Kérdés | Döntés | Állapot |
|---|---|---|---|
| D1 | Mi a nyitott év? | A beállítás a legutolsó megnyitott év (`settings:leave_opened_year:org_<id>`). Egy év nyitott, ha nem későbbi a legutolsó megnyitottnál és nincs lezárva. Beállítás nélkül egy év sincs nyitva. | **eldöntve** |
| D2 | Meglévő szervezetek | Migráció: minden meglévő szervezetnél a telepítés évének megfelelő év lesz a legutolsó megnyitott, hogy a mostani működés ne álljon le. | **eldöntve** |
| D3 | Melyik év nyitható? | Sorban: a legutolsó megnyitott utáni év; ha még nincs megnyitott év, bármelyik, ami nincs lezárva. Legfeljebb a jövő év (idén 2027). Joga: `leave.balance.manage` (mint a lezárásnak). | **eldöntve** |
| D4 | Keret évnyitáskor | Minden aktív dolgozónak, akinek még nincs kerete az évre, számított keret készül (mint az „Éves szabadságkeretek” oldalon), **áthozatal és korrekció nélkül**. A meglévő keretet nem írja felül. | **eldöntve** |
| D5 | Kinek jár a kötelező nap? | Az aktív dolgozóknak, és csak a munkaviszonyuk idejére eső napokra (belépés napjától a kilépés napjáig). | **eldöntve** |
| D6 | Mi számít kiírtnak? | Ha a dolgozónak azon a napon már van jóváhagyott szabadsága (bármilyen típusú), a nap rendben van, nem kerül rá új. Ha függő kérelem esik rá, kimarad, és a sor figyelmeztet: elbírálás után az ellenőrzés újra futtatható. | **eldöntve** |
| D7 | Nincs elég keret | Csak annyi napot ír ki, amennyi a maradék keretbe (`remaining_days`) belefér, időrendben az elsőket; a sor figyelmeztet, hány nap maradt ki. Keret nélkül egy nap sem kerül ki. | **eldöntve** |
| D8 | Hogyan kerül be? | Mint a HR naptáras rögzítése (specs/leave-days.md, D7, D8): `company_mandatory` típus, munkanapok szerint összefüggő szakaszonként egy jóváhagyott kérelem, `approved_by` a HR dolgozói sora. Az éves keretet terheli. | **eldöntve** |
| D9 | Tranzakció | Az évnyitás (beállítás, keretek, kiírás) és a kiírás egy-egy tranzakcióban fut; a terv a tranzakción belül készül újra a friss adatokból. Értesítés a véglegesítés után, dolgozónként egy. | **eldöntve** |

## 3. Követelmények

**K1. Nyitott év ellenőrzése.** A kérelem beadása, jóváhagyása, a naptáras mentés és a dolgozó naptáras kérelme meg nem nyitott évre hibával áll meg: „A(z) 2027. év még nincs megnyitva…”. A jóváhagyott szabadság törlését csak a lezárás tiltja, a meg nem nyitott év nem.

**K2. Naptár.** A `getLeaveCalendar` visszaadja a legutolsó megnyitott évet is. A szabadság-nyilvántartó naptárában a meg nem nyitott év napjaira nem lehet kattintani; a súgó megmondja, hogy az év még nincs megnyitva.

**K3. Munkanaptár eszköztár.** Meg nem nyitott, nyitható évnél „2027 megnyitása” gomb; nyitott, nem lezárt évnél „Kötelező szabadságok ellenőrzése”. A meg nem nyitott évnél tájékoztató sáv: az évre még nem lehet szabadságot rögzíteni, az évnyitás beállítja a kereteket és kiírja a kötelező szabadságokat.

**K4. Előnézet.** Ablak dolgozónként egy sorral: név; évnyitásnál a keret (új, számított nap, vagy „már van: N nap”); a kötelező szabadság teendője („Kiírásra kerül: 3 nap – 2027. dec. 28–30.”, „Minden kötelező nap ki van írva”, „Nincs kötelező nap a munkaviszonya idejére”); figyelmeztetés (kevés keret, nincs keret, függő kérelem). Fölötte az év kötelező napjai. Ha nincs teendő: „Nincs mit kiírni senkinek.”, csak Bezárás gomb.

**K5. Végrehajtás.** Évnyitásnál „Év megnyitása”, ellenőrzésnél „Kiírás (N dolgozó, M nap)”. Utána összegző üzenet, a munkanaptár frissül, az évnyitás gomb helyére az ellenőrzés kerül.

## 4. Szerver API

| Függvény | Jog | Leírás |
|---|---|---|
| `getLeaveClosedYear({ organizationId })` | `leave.request` | Kiegészül: `{ closedYear, openedYear }`. |
| `previewOpenLeaveYear({ organizationId, year })` | `leave.balance.manage` | Nyitható-e (és ha nem, miért), a keretek dolgozónként, a kötelező szabadságok terve a leendő keretekkel. |
| `openLeaveYear({ organizationId, year })` | `leave.balance.manage` | Beállítja a megnyitott évet, létrehozza a hiányzó kereteket, kiírja a kötelező szabadságokat; egy tranzakció. |
| `previewMandatoryLeave({ organizationId, year })` | `leave.balance.manage` | A kötelező szabadságok terve nyitott évre. |
| `applyMandatoryLeave({ organizationId, year })` | `leave.balance.manage` | A terv végrehajtása; jóváhagyott kérelmek és értesítések. |

## 5. Feladatok

- [x] `leave-closing.ts`: megnyitott év betöltése (`loadLeaveYearState`), `isYearOpen`, `lockedDayErrors`; migráció a meglévő szervezeteknek (D1, D2)
- [x] Ellenőrzés a beadásnál, jóváhagyásnál, naptáras mentésnél és kérelemnél (K1)
- [x] `leave-year-opening.ts`: terv, évnyitás, kiírás (D3–D9)
- [x] Munkanaptár: gombok, tájékoztató, előnézeti ablak (K3–K5)
- [x] Szabadság-nyilvántartó naptár: meg nem nyitott év napjai nem kattinthatók (K2)
- [x] Kézi ellenőrzés a dev szerveren
