# Projekt lezárása

> Státusz: kész · Utolsó módosítás: 2026-09-15 (zárolás kiterjesztve a projekt adataira, tagjaira és jogosultságaira)

Egy befejezett projekt munkanaplója ma bármikor utólag módosítható: új feladat kerülhet be, a meglévők átírhatók vagy törölhetők, így a projekt elszámolása vagy riportja a lezárás után is elcsúszhat. A cél, hogy megfelelő jogosultsággal a projektet **le lehessen zárni** és szükség esetén **vissza lehessen nyitni**. Lezárt projektnél a feladatok (munkabejegyzések) zárolva vannak.

## 1. Hatókör

**Benne van**

- Lezárás és visszanyitás a projekt adatlap Beállítások fülén, megerősítéssel.
- Új képesség: `project.close`.
- Szerveroldali zárolás: lezárt projekthez nem rögzíthető feladat, a meglévők nem módosíthatók és nem törölhetők; a projekt adatai és tagjai (köztük a projektvezetők) sem módosíthatók.
- A lezárt állapot jelzése a projekt fejlécében, a projektlistán és a munkanaplóban.

**Nincs benne**

- A Riport fül változásai: [project-report.md](project-report.md).
- Automatikus lezárás (pl. a záró dátum után).
- Értesítés a lezárásról.

## 2. Döntések

| # | Kérdés | Döntés | Állapot |
|---|---|---|---|
| D1 | Viszony a `status` mezőhöz | A lezárás külön zárolás (`closed_at`, `closed_by`), a tájékoztató státusz (aktív, szünetel, befejezett, archivált) változatlan és továbbra is szerkeszthető. A lezárt projekt kaphat bármilyen státuszt. | javasolt |
| D2 | Ki zárhat le és nyithat vissza? | Az új `project.close` képesség birtokosa, szervezeti szerepből vagy a projekt projektvezetőjeként (specs/project-lead.md). Alapból a Szervezet adminisztrátor és a Projektkezelő szerepnek van meg; a meglévő szervezetekben a migráció adja hozzá. | javasolt |
| D3 | Mi zárolt? | A projekt munkabejegyzései: létrehozás, módosítás, törlés. A zárolás a core adminra és a dev módra is vonatkozik. | javasolt |
| D4 | Mi marad szerkeszthető? | Semmi: a projekt adatai (név, leírás, státusz, dátumok), és a tagok (köztük a projektvezetők) is zárolva vannak. Lezárt projektnél csak a visszanyitás lehetséges. | javasolt |
| D5 | Törölhető-e a lezárt projekt? | Nem, mert a törlés a feladatokat is törölné. Előbb vissza kell nyitni. | javasolt |
| D6 | Előzmények | Csak az utolsó lezárás ideje és szereplője tárolódik; visszanyitáskor törlődik. | javasolt |

## 3. Követelmények

**K1. Lezárás.** A Beállítások fülön (`project.close`) „Projekt lezárása” blokk magyarázattal és gombbal. Megerősítés után a projekt lezárul, a fejlécben „Lezárva” jelvény jelenik meg, tooltipben a lezáró nevével és idejével.

**K2. Visszanyitás.** Lezárt projektnél ugyanitt „Projekt visszanyitása” blokk: ki és mikor zárta le, gomb megerősítéssel.

**K3. Munkanapló.** Lezárt projektnél a munkanapló tetején figyelmeztető sáv, nincs „Új bejegyzés” gomb, és a bejegyzéseken nincs szerkesztés és törlés. A lista és a szűrők működnek.

**K4. Szerver.** A `createWorkEntry`, `updateWorkEntry` és `deleteWorkEntry` lezárt projektnél hibát ad, írás nélkül. A `closeProject` és `reopenProject` a `project.close` képességet kéri; a már lezárt projekt lezárása és a nyitott visszanyitása hiba. A `deleteProject`, az `updateProject`, az `addProjectMember` és a `removeProjectMember` lezárt projektnél hibát ad. (A korábbi `setProjectUserRoles` helyét a projektvezető vette át: specs/project-lead.md.)

**K6. Adatlap.** Lezárt projektnél az Áttekintés fülön nincs Szerkesztés gomb (lezáráskor a szerkesztés bezárul), a Tagok fülön nincs tag hozzáadása, eltávolítása és szerepváltása; mindenhol rövid tájékoztatás jelzi a lezárást.

**K5. Lista.** A projektlista kártyáján a státusz mellett „Lezárva” jelvény.

## 4. Adatmodell

`projects` tábla (`022_project_closing.sql`):

- `closed_at TIMESTAMPTZ NULL`: a lezárás ideje; kitöltve jelenti a zárolást.
- `closed_by INTEGER NULL → auth.users(id)`: a lezáró felhasználó.

A `ProjectRow` új mezői: `closedAt`, `closedBy`, `closedByName`.

## 5. Remote függvények

| Függvény | Paraméter | Jog | Eredmény |
|---|---|---|---|
| `closeProject` | `{ id }` | `project.close` | a frissített `ProjectRow` |
| `reopenProject` | `{ id }` | `project.close` | a frissített `ProjectRow` |
