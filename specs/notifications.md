# Email értesítések beállítása

> Státusz: kész · Utolsó módosítás: 2026-09-11

Ma az emailek fixen mennek: a szabadság-események egy része emailt is küld, a többi esemény (visszavonás, adatbejelentés, kiküldetési rendelvény) csak rendszeren belül értesít. A cél: a Beállítások → **Értesítések** oldalon a szervezet eldönthesse, mely eseményekről menjen email, és a küldés ehhez igazodjon.

## 1. Hatókör

**Benne van**

- Szervezet szintű beállítás: eseményenként egy kapcsoló, hogy menjen-e email.
- Email a most csak rendszeren belül értesítő eseményekhez is (új sablonok).
- Az üdvözlő email (új dolgozó felvétele) is kikapcsolható.

**Nincs benne**

- A rendszeren belüli értesítések kikapcsolása: azok továbbra is mindig mennek.
- Dolgozónkénti (személyes) leiratkozás.
- A címzettek módosítása: az új kérelem értesítettjeit továbbra is a Szabadság beállításoknál kell kijelölni, a többi címzett a jogosultságból vagy az érintett dolgozóból adódik.
- Az email nyelve: továbbra is magyar (a felhasználóknak nincs tárolt nyelvi beállítása).

## 2. Döntések

| # | Kérdés | Döntés | Állapot |
|---|---|---|---|
| D1 | Hol tárolódik? | kv_store, `settings:notifications:org_<id>`, értéke `{ email: { <esemény>: boolean } }`. A hiányzó esemény az alapértékét kapja. | **eldöntve** |
| D2 | Alapértékek | Ami eddig emailt küldött, alapból be van kapcsolva; az új emailek alapból ki. Így a telepítés után a működés nem változik. | **eldöntve** |
| D3 | Ki állíthatja? | `org.manage`. Olvasni is ezzel a joggal lehet; a küldés jogosultság-ellenőrzés nélkül olvassa. | **eldöntve** |
| D4 | Csoportosítás | Egy esemény = egy kapcsoló, a hasonló lépéseket összevonva (pl. jóváhagyás és elutasítás). A kötelező szabadság kiírása külön kapcsoló, mert évnyitáskor egyszerre sok dolgozónak megy. | **eldöntve** |
| D5 | Sablonok | Eseményenként külön sablon, a meglévők mintájára (a core adminja sablononként szerkesztheti). | **eldöntve** |

## 3. Események

| Kulcs | Esemény | Címzett | Sablon | Alap |
|---|---|---|---|---|
| `employee.welcome` | Új dolgozó felvétele | az új dolgozó | `employee_welcome` | be |
| `leave.requestCreated` | Új szabadságkérelem | a Szabadság beállításoknál kijelöltek | `leave_request_new` | be |
| `leave.requestWithdrawn` | Kérelem visszavonása | ugyanők | `leave_request_withdrawn` | ki |
| `leave.requestDecided` | Kérelem jóváhagyása vagy elutasítása | a dolgozó | `leave_request_status` | be |
| `leave.deleted` | Függő kérelem vagy jóváhagyott szabadság törlése | a dolgozó | `leave_request_status`, `leave_deleted` | be |
| `leave.calendarChanged` | A HR a naptárban rögzített vagy törölt napokat | a dolgozó | `leave_days_added`, `leave_days_removed` | be |
| `leave.mandatoryAssigned` | Kötelező szabadság kiírása (évnyitás, ellenőrzés) | az érintett dolgozók | `leave_days_added` | be |
| `leave.dataRequestCreated` | Új adatbejelentés | `leave.balance.manage` joggal rendelkezők | `leave_data_request_new` | ki |
| `leave.dataRequestDecided` | Adatbejelentés elbírálása | a dolgozó | `leave_data_request_status` | ki |
| `leave.monthConfirmationRequested` | Havi szabadság-ellenőrzés kiküldése, újraküldése | az érintett dolgozók | `leave_month_confirmation_request` | be |
| `leave.monthConfirmationDisputed` | Eltérés a havi összesítőben | a kiküldő és a Szabadság beállításoknál kijelöltek | `leave_month_confirmation_disputed` | be |
| `leave.monthConfirmationClosed` | Havi ellenőrzés lezárása elfogadás nélkül | a dolgozó | `leave_month_confirmation_closed` | ki |
| `trip.settlementSubmitted` | Beküldött kiküldetési rendelvény | `trip.approve` joggal rendelkezők | `trip_settlement_submitted` | ki |
| `trip.settlementStatus` | Rendelvény jóváhagyása, visszaküldése, kifizetése, visszanyitása | a dolgozó | `trip_settlement_status` | ki |
| `trip.ordererChanged` | Az elrendelő felülbírálása | a dolgozó | `trip_orderer_changed` | ki |

A műveletet végző felhasználó a saját lépéséről továbbra sem kap értesítést, és az email cím nélküli címzett kimarad.

## 4. Szerver API

| Függvény | Jog | Leírás |
|---|---|---|
| `getNotificationSettings({ organizationId })` | `org.manage` | `{ email: Record<esemény, boolean> }`, a hiányzók az alapértékkel. |
| `saveNotificationSettings({ organizationId, email })` | `org.manage` | Csak az ismert eseményeket menti; a visszaadott érték a teljes, normalizált beállítás. |

## 5. Feladatok

- [x] `notification-settings.ts`: események, alapértékek, betöltés és mentés (D1–D3)
- [x] `notification-email.ts`: közös email-küldés, ami a beállítást ellenőrzi
- [x] A szabadság-, adatbejelentés-, kiküldetés- és üdvözlő email a beállításhoz igazodik
- [x] Új sablonok: visszavonás, adatbejelentés (új, elbírálás), rendelvény (beküldés, állapot), elrendelő (D5)
- [x] Beállítások → Értesítések oldal
- [x] Tesztek a normalizálásra
