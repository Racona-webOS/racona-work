# Projektvezető

> Státusz: kész · Utolsó módosítás: 2026-10-06

Egy dolgozó egy adott projektet vezethet úgy, hogy a szervezet többi projektjéhez nem kap jogot. Korábban erre a projekt Jogosultságok fülén (és a Projekt jogosultságok menüpontban) bármelyik szervezeti szerepet ki lehetett osztani projektszinten. Ez félrevezető volt: projektszinten csak a `project.manage` és a `project.close` képességet ellenőrizte a rendszer. A HR felelős vagy a Dolgozó szerep így semmit nem adott, a Szervezet adminisztrátor pedig annyit, mint a Projektkezelő. Ráadásul aki nem volt a projekt tagja, a projektet meg sem nyithatta.

## 1. Hatókör

**Benne van**

- A projekttag „Vezető” szerepe (`project_members.role = 'lead'`) „Projektvezető” néven jogot ad: a saját projektjén `project.manage` és `project.close`.
- A Tagok fülön a tag szerepe a listában módosítható (eddig csak törléssel és újrafelvétellel).
- A projekt-szintű szerep-felülbírálások megszűnnek: a Jogosultságok fül, a Projekt jogosultságok menüpont és oldal, a `listProjectRoleOverrides`, `setProjectUserRoles`, `clearProjectUserRoles` függvény és a `wp_project_member_roles` tábla.

**Nincs benne**

- A „Tulajdonos” (a projekt létrehozója) továbbra is csak címke, jogot nem ad.
- A projektvezető a projekt riportján és munkanaplóján túl más (szervezeti) adathoz nem fér hozzá.

## 2. Döntések

| # | Kérdés | Döntés |
|---|---|---|
| D1 | Mit kap a projektvezető? | A saját projektjén a `project.manage` és a `project.close` képességet (`PROJECT_LEAD_CAPABILITIES`): az adatok szerkesztése és a projekt törlése, a tagok és szerepeik kezelése, mások munkanaplójának szerkesztése, a riport, a lezárás és a visszanyitás. Más képességet a projektvezetés nem ad. |
| D2 | Hogyan lesz valaki projektvezető? | A projekt tagjaként, „Projektvezető” szereppel. A láthatósághoz így nem kell külön jog: a tag a saját projektjét látja (`project.view.own`). |
| D3 | Ki jelölhet ki projektvezetőt? | Aki ezen a projekten a `project.manage` mellett a `project.close` joggal is rendelkezik, szervezeti szerepből vagy projektvezetőként. Ugyanez kell a projektvezetés elvételéhez: szerepváltáshoz és a projektvezető eltávolításához. Így senki nem adhat bővebb jogot, mint ami neki van. A többi szerephez elég a `project.manage`. |
| D4 | A meglévő felülbírálások | A migráció (`027_project_leads.sql`) projektvezetővé teszi azt a projekttagot, akinek a projekten kapott szerepei között volt `project.manage`. A nem tag felhasználó felülbírálása elvész: tagság nélkül a projektet csak `project.view.all` joggal láthatta. |
| D5 | A meglévő „Vezető” címkék | A migráció előtt „Vezető” szerepű tagok a frissítéstől projektvezetői jogot kapnak. |

## 3. Megvalósítás

| Elem | Hely |
|---|---|
| Projektszintű ellenőrzés (`hasCapability` projectId-vel), `PROJECT_LEAD_ROLE`, `PROJECT_LEAD_CAPABILITIES` | `server/permissions.ts` |
| A hívó jogai a projekten (`getProject` → `access`), a kijelölés korlátja (`addProjectMember`, `removeProjectMember`) | `server/projects.ts` |
| Átvétel és a régi tábla törlése | `migrations/027_project_leads.sql` |
| Adatlap: a kezelési és lezárási jog a szervezeti szerepből vagy az `access`-ből | `src/components/ProjectDetail.svelte` |
| Tagok: szerepváltás a listában, projektvezető kijelölése | `src/components/project-detail/MembersTab.svelte` |
| Tesztek | `tests/security.test.ts` (projektvezető) |
