# Mobil képernyők

> Státusz: kész (0.14.0) · Utolsó módosítás: 2026-10-06

A cél, hogy a dolgozó telefonon gyorsan elintézze a gyakori teendőit: szabadságot kérjen, a havi szabadság-összesítőjét elfogadja vagy kifogásolja, és rögzítse a napi munkáját. A Racona core mobil kerete (1.C–1.D, racona-core `feature/mobile-view`) a manifest `mobile.entries` bejegyzéseit gyors műveletként mutatja a kezdőképernyőn; mindegyik egy önálló, telefonra készült komponens.

## 1. Hatókör

**Benne van**

- Három mobil bejegyzés (`manifest.json` → `mobile.entries`):
  - `leave` → `MobileLeaveRequest`: idei keret, saját kérelmek (függő visszavonása), új kérelem havi naptárral.
  - `month` → `MobileMonthConfirmation`: a havi szabadság-összesítő elfogadása vagy eltérés jelzése (a meglévő `MyMonthConfirmations` kártya).
  - `worklog` → `MobileWorkLog`: egy nap saját bejegyzései az összes projektből, rögzítés, szerkesztés, törlés.
- Értesítésekből és e-mailekből közvetlenül a megfelelő képernyő nyílik (lásd 3.).

**Nincs benne**

- HR- és vezetői funkciók (kérelmek elbírálása, havi összesítők kiküldése és lezárása): ezek asztali nézetben maradnak.
- A teljes app (menü, oldalsáv) mobilon: csak a bejegyzések érhetők el.
- A szervezetváltó külön mobil változata: a core a plugin oldalsáv-elemét (OrganizationSwitcher) a képernyő tetején mutatja.

## 2. Döntések

| # | Kérdés | Döntés |
|---|---|---|
| D1 | Új szerverfüggvény kell? | Nem. A képernyők a meglévőket hívják: `getMyEmployee`, `getLeaveBalances`, `getLeaveRequests`, `withdrawLeaveRequest`, `getLeaveCalendar`, `getLeaveAllowances`, `previewLeaveRequestBatch`, `submitLeaveRequestBatch`, `getMyMonthConfirmations`, `respondMonthConfirmation`, `listWorkEntries` (projekt nélkül, `scope: 'mine'`), `listProjects`, `getWorkEntryCategories`, `createWorkEntry`, `updateWorkEntry`, `deleteWorkEntry`. |
| D2 | Szabadságkérés | Ugyanaz a kérelem, mint az asztali naptár kérelmező módjában: kijelölt napok, szakaszonként egy függő kérelem. A naptár havi, a kijelölés hónapok között lapozva megmarad. A céges kötelező szabadság nem kérhető (`REQUEST_CALENDAR_LEAVE_TYPES`). |
| D3 | Munkanapló projektlistája | A hívó által látható, nyitott projektek (`listProjects`, lezárt kiszűrve). A legutóbb használt projekt előre kiválasztva (a böngészőben megjegyezve); egyetlen projektnél az. |
| D4 | Közös keret | `mobile/MobileScreen.svelte`: szervezet és saját dolgozói rekord betöltése, képesség-ellenőrzés (`leave.request`, `work.log`), külsős dolgozó és hiányzó dolgozói rekord kezelése. |
| D5 | Stílus | `styles/mobile.css`: nagy érintési felületek, 16 px-es beviteli mezők (iPhone-on kisebbnél fókuszáláskor ránagyít). |

## 3. Értesítések és e-mailek

- A dolgozónak szóló rendszeren belüli értesítések `data.mobileEntry` mezőt kapnak (`server/mobile.ts`), a mobil keret ez alapján nyitja meg a képernyőt:
  - kérelem elbírálása vagy törlése → `leave`;
  - havi összesítő kiküldése, emlékeztető, HR-lezárás → `month`;
  - hiányzó munkanapló → `worklog` (a `days` adatból a legkorábbi hiányzó nappal nyílik).
- A dolgozónak szóló e-mailek gombja közvetlen linket kap: `{{appUrl}}/admin?app=racona-work&entry=<bejegyzés>` (`leave_request_status`, `leave_month_confirmation_request`, `leave_month_confirmation_reminder`, `work_log_missing_employee`). Telefonon a bejegyzés, asztalon a bejegyzés képernyője nyílik meg az app ablakában; kijelentkezve előbb a belépés.

## 4. Közben javítva

- A munkabejegyzések listája és a projektriport a napot `YYYY-MM-DD` szövegként adja (`to_char`). Korábban időbélyeg ment ki (a budapesti éjfél UTC-ben, pl. `2026-10-05T22:00:00.000Z`), és az asztali szerkesztő űrlap meg a CSV-export az előző napot mutatta; szerkesztés után a bejegyzés egy nappal korábbra került.
