# Havi szabadság-ellenőrzés

> Státusz: 1. fázis kész · Utolsó módosítás: 2026-09-15

A HR a hónap végén bérszámfejtéshez zárja a szabadságokat. Ma nincs nyoma annak, hogy a dolgozó látta és rendben lévőnek találta a hónapra rögzített szabadságait; ha utólag derül ki, hogy egy nap hiányzott vagy rossz típussal került be, a zárást újra kell nyitni. A cél: a szabadság-nyilvántartó csapatnézetéből a HR egy gombbal kiküldi minden érintett dolgozónak a hónap összesítőjét (emailben és rendszeren belül), a dolgozó az irányítópulton **elfogadja** vagy **eltérést jelez**, és a HR a naptár alatt látja, kinél zárható a hónap.

## 1. Hatókör

**Benne van**

- „Értesítés küldése hónap végi ellenőrzés céljából” gomb a csapatnézet alatt, a megjelenített hónapra.
- Új tábla: a kiküldött ellenőrzés-kérelmek, a kiküldéskori pillanatképpel és a dolgozó válaszával.
- Összesítő emailben és rendszeren belüli értesítésként.
- Tétel az irányítópulton a dolgozónak: elfogadás vagy eltérés jelzése tételesen.
- A HR nézete a csapatnézetben: állapot dolgozónként, az eltérések listája, újraküldés, lezárás elfogadás nélkül.
- Változásfigyelés: ha a HR a kiküldés után módosít a hónapon, a tétel „változott” jelzést kap.

**Nincs benne**

- A hónap tényleges lezárása (zárolás az év lezárásához hasonlóan). Most csak jelzés, hogy a hónap zárható.
- Határidő, automatikus emlékeztető, automatikus elfogadás.
- A manageri irányítópult összesítője az ellenőrzésekről.
- A dolgozó a naptárban nem javíthat. Az eltérést a HR rögzíti.

## 2. Döntések

| # | Kérdés | Döntés | Állapot |
|---|---|---|---|
| D1 | Ki küldheti? | `leave.approve` (aki a naptárat szerkeszti és a csapatnézetet látja). | javasolt |
| D2 | Kik kapják? | A szervezet aktív dolgozói, **a szabadság nélküliek is**: a hiányzó nap épp náluk derül ki. Kimarad, akinek a megerősített belépési dátuma a hónap utáni. Dolgozószűrővel csak a kiválasztott dolgozó. | javasolt |
| D3 | Melyik hónap? | A csapatnézetben megjelenített hónap. Folyó hónapra is küldhető (a hónap utolsó napjaiban), jövőbelire nem. Lezárt évre nem, mert ott az eltérés már nem javítható. | javasolt |
| D4 | Mit fogad el a dolgozó? | A **kiküldéskori pillanatképet**: a hónap munkanapjai, a jóváhagyott napok típussal, tájékoztatásul a függő kérelmek napjai. Az elfogadás a pillanatképre vonatkozik; a táblában megmarad, mit látott a dolgozó. | javasolt |
| D5 | Változás a kiküldés után | A jóváhagyott napok ujjlenyomata (`nap:típus` rendezve) összevethető a mostani állapottal. Eltérésnél a tétel „változott”: a dolgozó nem fogadhatja el (a felület jelzi, hogy frissített összesítő jön), a HR-nél újraküldésre vár. Az elfogadott tétel elfogadva marad, de „változott” jelzéssel, és a hónap nem zárható, amíg újra ki nem küldik. | javasolt |
| D6 | A gomb többszöri megnyomása | Idempotens: új tételt kap, akinek még nincs, és akinél az adat változott. Az érintetlen függő, elfogadott vagy lezárt tétel kimarad. Az eltérést jelzett tételt csak egyenként lehet kezelni (D9). A kiküldés előtt a felület megmutatja, hányan kapnak újat, hány újraküldés lesz és hányan maradnak ki. | javasolt |
| D7 | Függő kérelmek a hónapban | Nem részei az elfogadásnak (még nem szabadság). Az összesítő tájékoztatásul felsorolja őket, a kiküldés előtti megerősítés figyelmeztet, hogy a hónapra van függő kérelem. | javasolt |
| D8 | Az eltérés jelzése | Tételesen, napra: **nem voltam szabadságon** (rögzített napra), **más a típusa** (rögzített napra, a helyes típussal), **hiányzik** (a hónap egy rögzítetlen munkanapjára, a típussal). Mellé szabad szöveges megjegyzés. A „rossz helyen van” egy plusz és egy hiányzó nap. Legalább egy tétel vagy megjegyzés kell. A választ csak a dolgozó adhatja meg, a HR nem a nevében. | javasolt |
| D9 | Az eltérés kezelése | A HR a naptárban javít, majd **újraküld**: új változat készül a mostani adatokkal, a régi `superseded` lesz, a dolgozónak újra el kell fogadnia. Ha az adat nem változott (a HR szerint a rögzítés helyes), az újraküldéshez kötelező a válasz a dolgozónak. A HR **lezárhatja elfogadás nélkül** is, kötelező indoklással; ez függő tételre is működik (pl. tartósan távol lévő dolgozó). A dolgozó mindkét esetben értesítést kap. | javasolt |
| D10 | Mikor zárható a hónap? | Ha minden címzettnél van tétel, mindegyik elfogadott vagy lezárt, és egyik sem „változott”. Csak jelzés. | javasolt |
| D11 | Előzmények | A felülírt változatok megmaradnak (`superseded`, `previous_id`), dolgozónként és hónaponként egyszerre egy él. | javasolt |
| D12 | Értesítések | Kiküldés és újraküldés: a dolgozó, rendszeren belül és emailben (`leave.monthConfirmationRequested`, alapból be, mert az összesítő emailje a funkció lényege). Eltérés: a kiküldő és a Szabadságkérelem beállításoknál kijelöltek (`leave.monthConfirmationDisputed`, alapból be). Lezárás elfogadás nélkül: a dolgozó (`leave.monthConfirmationClosed`, alapból ki). Az elfogadásról nincs értesítés, a HR a csapatnézetben látja. | javasolt |

## 3. Folyamat

```
HR: kiküldés ──▶ pending ──elfogad (a dolgozó)──▶ accepted
                   │  ╲
                   │   ╲──eltérés (a dolgozó)──▶ disputed ──HR: újraküldés──▶ superseded + új pending
                   │                                 └──HR: lezárás──▶ closed
                   └──HR: lezárás elfogadás nélkül──▶ closed

HR módosít a hónapban ──▶ „változott” (pending, accepted, closed) ──HR: kiküldés újra──▶ superseded + új pending
```

## 4. Követelmények

**K1. Gomb és megerősítés.** A csapatnézet alatt „Havi ellenőrzés – {hónap}” blokk (`leave.approve`, nem kérelmező módban). A gomb szövege: „Értesítés küldése hónap végi ellenőrzés céljából”. Megnyomásra megerősítő sáv: hány dolgozó kap új összesítőt, hány újraküldés lesz (változott az adat), hányan maradnak ki; figyelmeztetés, ha a hónapra van függő kérelem; nem kötelező megjegyzés a dolgozóknak; „Mégse” és „Kiküldés”. Ha senkinek nem menne, a gomb le van tiltva, és a blokk megmondja, miért. Jövőbeli hónapnál és lezárt évnél a gomb le van tiltva, indoklással.

**K2. Állapot a csapatnézetben.** A blokkban számlálók: elfogadta, válaszra vár, eltérést jelzett, változott, nincs kiküldve; „A hónap zárható” jelvény (D10). A csapattáblázatban a név mellett kis jel mutatja a dolgozó állapotát, tooltippel.

**K3. Eltérések a HR-nek.** A blokkban az eltérést jelzett tételek: név, a válasz ideje, a tételek („szept. 12., éves szabadság: nem volt szabadságon”), a megjegyzés. Műveletek: „Megnyitás a naptárban” (havi nézet a dolgozóra szűrve), „Újraküldés” (válasz mezővel; ha az adat nem változott, kötelező), „Lezárás elfogadás nélkül” (indoklás kötelező). A válaszra váró tételek összecsukott listában, lezárás művelettel.

**K4. Összesítő a dolgozónak.** Rendszeren belül: „Ellenőrizd a havi szabadságaidat”, a hónap, a napok száma típusonként, és hogy az irányítópulton válaszolhat. Emailben: a hónap szakaszai (időszak, típus, munkanapok), összesen típusonként, a függő kérelmek külön, a HR megjegyzése, gomb az apphoz. Szabadság nélkül: „Erre a hónapra nincs rögzített szabadságod”.

**K5. Tétel az irányítópulton.** A dolgozói áttekintés tetején (vezetőknél a saját adatai között is), amíg van válaszra váró vagy eltérést jelzett tétele. Hónaponként egy kártya: a szakaszok, az összesen, a függő kérelmek, a HR megjegyzése. „Rendben, elfogadom” és „Eltérést jelzek”. Ha az adat változott: nincs gomb, a kártya jelzi, hogy frissített összesítő jön. Eltérés után: „Eltérést jeleztél, a HR átnézi”, a jelzett tételekkel.

**K6. Eltérés-űrlap.** A rögzített napok listája, soronként: rendben / nem voltam szabadságon / más a típusa (típusválasztóval). Hiányzó nap felvétele a hónap rögzítetlen munkanapjai közül, típussal. Megjegyzés. Beküldés csak tétellel vagy megjegyzéssel.

**K7. Értesítés a HR-nek.** Eltérésnél a kiküldő és a kijelölt értesítendők (a dolgozót kivéve): rendszeren belül és emailben, a tételekkel és a megjegyzéssel.

**K8. Lezárás értesítése.** A dolgozó rendszeren belül (és bekapcsolt beállításnál emailben) megkapja az indoklást.

## 5. Adatmodell

Új migráció: `021_leave_month_confirmations.sql`.

```sql
CREATE TABLE IF NOT EXISTS app__racona_work.leave_month_confirmations (
    id               SERIAL PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    employee_id      INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    year             INTEGER NOT NULL,
    month            INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    -- pending | accepted | disputed | closed | superseded
    status           VARCHAR(16) NOT NULL DEFAULT 'pending',
    snapshot         JSONB NOT NULL,          -- D4
    fingerprint      TEXT NOT NULL,           -- D5
    hr_note          TEXT,                    -- a kiküldő megjegyzése (újraküldésnél a válasz)
    sent_by          INTEGER REFERENCES auth.users(id),
    sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_by     INTEGER REFERENCES auth.users(id),
    responded_at     TIMESTAMPTZ,
    dispute_items    JSONB,                   -- D8
    employee_note    TEXT,
    resolved_by      INTEGER REFERENCES auth.users(id),
    resolved_at      TIMESTAMPTZ,
    resolution_note  TEXT,
    previous_id      INTEGER REFERENCES app__racona_work.leave_month_confirmations(id) ON DELETE SET NULL
);
-- Dolgozónként és hónaponként egy élő változat (D11)
CREATE UNIQUE INDEX ... ON (employee_id, year, month) WHERE status <> 'superseded';
```

A pillanatkép: `{ from, to, workingDays: string[], days: { day, leaveType }[], pending: { day, leaveType }[] }`.

## 6. Szerver API

Tiszta rész: `server/leave-month-confirmation-utils.ts` (a kliens is importálja; tesztek: `tests/leave-month-confirmation.test.ts`): `monthBounds`, `monthSendBlocker`, `buildMonthSnapshot`, `snapshotFingerprint`, `summarizeSnapshot`, `planSendAction`, `parseDisputeItems`, `isMonthClosable`, `formatMonthLabel`.

Hívható függvények: `server/leave-month-confirmations.ts`.

| Függvény | Jog | Leírás |
|---|---|---|
| `getMonthConfirmations({ organizationId, year, month, employeeId? })` | `leave.approve` | Dolgozónként a mostani napok száma, az élő tétel (állapot, „változott”, eltérés), a tervezett művelet (`send`, `resend`, `none`); a függő kérelmek száma, a kiküldés akadálya, zárható-e. |
| `sendMonthConfirmations({ organizationId, year, month, employeeId?, note? })` | `leave.approve` | D6 szerint, egy tranzakcióban; utána értesítések. Visszaad: `{ sent, resent, skipped }`. |
| `resolveMonthConfirmation({ id, action: 'resend' \| 'close', note })` | `leave.approve` | D9. |
| `getMyMonthConfirmations({ organizationId })` | saját | A hívó válaszra váró és eltérést jelzett tételei, a pillanatképpel és a „változott” jelzéssel. |
| `respondMonthConfirmation({ id, decision: 'accept' \| 'dispute', items?, note? })` | csak a dolgozó | D4, D5, D8. |

## 7. Felület

- `src/components/leave-calendar/MonthConfirmationPanel.svelte`: a K1–K3 blokk, a `LeaveCalendar.svelte` csapatnézete alatt, az összesítő táblázat előtt. Az állapotjelek a csapattáblázat névoszlopában.
- `src/components/leave-month-confirmation/MyMonthConfirmations.svelte`: a K5–K6 kártyák, a `Dashboard.svelte` saját áttekintésének tetején.
- Beállítások → Értesítések: a három új esemény a Szabadság csoportban.
- Locale (hu, en): `monthConfirmation.*`, `notificationSettings.event.leave.monthConfirmation*`.

## 8. Értesítések és sablonok

| Esemény | Címzett | Rendszeren belül | Sablon |
|---|---|---|---|
| Kiküldés, újraküldés | a dolgozó | „Ellenőrizd a havi szabadságaidat” / „Frissített havi összesítő” | `leave_month_confirmation_request` |
| Eltérés | a kiküldő és a kijelölt értesítendők | „Eltérés a havi szabadság-összesítőben” | `leave_month_confirmation_disputed` |
| Lezárás elfogadás nélkül | a dolgozó | „A HR lezárta a havi ellenőrzést” | `leave_month_confirmation_closed` |

## 9. Feladatok

### 1. fázis

- [x] Spec
- [x] Migráció `021_leave_month_confirmations.sql`
- [x] `leave-month-confirmation-utils.ts` és tesztek
- [x] `leave-month-confirmations.ts`: lekérdezés, kiküldés, válasz, kezelés
- [x] Értesítések, három új esemény és sablon
- [x] HR blokk a csapatnézetben, állapotjelek
- [x] Irányítópult-kártya és eltérés-űrlap
- [x] Locale (hu, en), Értesítések beállítás
- [x] Ellenőrzés a dev szerveren

**Megvalósítás, eltérések a tervtől**

- Az értesítések külön modulban vannak (`server/leave-month-confirmation-notifications.ts`); a kijelölt értesítendők kulcsát a `leave-notifications.ts` exportálja.
- A kiküldés és az újraküldés tanácsadói zárat vesz a szervezet hónapjára (`pg_advisory_xact_lock`), így két egyszerre futó kiküldés nem hoz létre kettős tételt. A tranzakción belül a lekérdezések egymás után futnak (egy kliensen nem futhat egyszerre több).
- A műveletet végző felhasználó a saját tételéről nem kap értesítést (a meglévő szabály); a HR a saját összesítőjét az irányítópulton látja.
- A dolgozó a „változott” tételre sem elfogadást, sem eltérést nem küldhet (a felület elrejti a gombokat, a szerver hibát ad), hogy az eltérés mindig a friss adatra vonatkozzon.
- A csapattáblázat állapotjelei: ✓ elfogadta, szürke ✓ HR lezárta, … válaszra vár, ! eltérést jelzett, ↻ változott, ○ nincs kiküldve.
- Ellenőrizve a dev szerveren: kiküldés megjegyzéssel (email és értesítés adatai, a küldő kimarad), a megerősítő sáv számai, a kártya szakaszai, eltérés mindhárom tétellel és megjegyzéssel, a HR blokk eltérés-listája és állapotjelei, a „változott” jelzés és a tiltott elfogadás, újraküldés változatlan adattal megjegyzés nélkül, lezárás indoklás nélkül, válasz más dolgozó tételére és már megválaszolt tételre (mind hibával áll meg).

### Későbbi ötletek

- Emlékeztető a válaszra várók kiküldése után N nappal, határidő a szervezet beállításaiban.
- A hónap tényleges lezárása: a lezárt hónapra nem lehet napot rögzíteni (az év lezárásának mintájára).
- Összesítő a vezetői irányítópulton: nyitott eltérések száma, link a csapatnézetre.
- Az eltérés tételeiből egy kattintással naptáras javítás (a jelölt napok előkészítve).

## 10. Kockázatok

- **Sok címzett.** Az értesítések a tranzakció után egymás után mennek; 200 dolgozónál ez néhány másodperc. Hiba esetén a tétel megvan, a dolgozó az irányítópulton látja.
- **Kilépett dolgozó.** Az inaktív dolgozó nem kap új tételt; a régi, válaszra váró tételét a HR lezárhatja.
- **Munkanaptár-változás a kiküldés után.** Az ujjlenyomat csak a napokat és típusokat nézi, a munkanaptárat nem; a pillanatkép munkanapjai a kiküldéskoriak maradnak.
