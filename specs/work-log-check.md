# Hiányzó munkanapló-bejegyzések figyelése

> Státusz: kész (0.13.0) · Utolsó módosítás: 2026-10-06

A cél a napi munkanyilvántartás: minden dolgozónak minden olyan munkanapra legyen munkanapló-bejegyzése, amikor dolgoznia kellett. Ha egy munkanapra egyik projektbe sem rögzített semmit, esténként emlékeztető emailt kap; ha a pótlásra adott idő alatt sem pótolja, a beállított címzettek (jellemzően a projektvezető) jelzést kapnak.

## 1. Hatókör

**Benne van**

- Napi ütemezett feladat 23:55-kor (Europe/Budapest), szervezetenként.
- Beállítás szervezetenként (Beállítások → Munkanapló, `project.manage`): be/ki, figyelt napok száma, az eszkaláció címzettjei, kihagyott dolgozók.
- Esti emlékeztető a dolgozónak (email és rendszeren belüli értesítés).
- Eszkaláció: összesítő email a beállított címekre (és rendszeren belüli értesítés, ha a cím egy felhasználóé).

**Nincs benne**

- Óraszám-ellenőrzés (pl. legalább 8 óra): bármilyen bejegyzés elég.
- A függőben lévő szabadságkérelmek figyelembevétele (csak a jóváhagyott szabadság számít).

## 2. Döntések

| # | Kérdés | Döntés |
|---|---|---|
| D1 | Kit vizsgál? | Az aktív (`status = 'active'`), nem külsős dolgozókat, a kihagyottak kivételével. Külsős dolgozóra nem vonatkozik, a kihagyási listában sem jelenik meg. |
| D2 | Mely napokat? | A szervezet munkanaptára szerinti munkanapokat (hétvége, munkaszüneti nap, áthelyezett munkanap). Kimarad a jóváhagyott szabadság (bármely típus, `leave_days`), a belépés és a rendszerbe vétel közül a későbbi előtti, és a munkaviszony vége utáni nap. |
| D3 | Mi számít bejegyzésnek? | Bármely projektbe, bármekkora óraszámmal rögzített `work_entries` sor az adott napra. |
| D4 | Figyelt napok (N) | Naptári napokban (0–30, alap: 5). Az ablak a futás napja és az előtte lévő N nap: 5 esetén október 6-án este az október 1–6. közötti hiányzó munkanapokról megy emlékeztető. 0 esetén csak a futás napjáról. |
| D5 | Emlékeztető | A dolgozó minden este egy emailt kap az ablak összes még hiányzó munkanapjáról, amíg pótolja őket, vagy amíg kiesnek az ablakból. Nincs nyilvántartva, minden futás újra számol. |
| D6 | Eszkaláció | Ha egy nap úgy esik ki az ablakból, hogy még hiányzik (a futás napja − N − 1), a címzettek egyszer kapnak róla jelzést (`work_log_alerts`). Kimaradt futásnál az előtte lévő 7 napot is pótolja. Csak a bekapcsoláskor már az ablakban lévő napok eszkalálódnak (`enabledOn`), így bekapcsoláskor nem zúdul a címzettre a múlt. |
| D7 | Címzettek | Szabadon megadható email címek (legfeljebb 10); üresen nincs eszkaláció (és a napok sem jelölődnek). Ha a cím egy felhasználóé, az ő nevén és nyelvén megy; egyébként „Címzett” megszólítással, magyarul. |
| D8 | Email kapcsolók | Új értesítési kategória: Munkanapló, saját válaszcímmel. Események: `worklog.missingEntriesEmployee` (dolgozói emlékeztető) és `worklog.missingEntries` (eszkaláció), mindkettő alapból be. Az eszkaláció kikapcsolt emailnél is „elküldöttnek” számít. Az emailek csak bekapcsolt figyelésnél mennek; kikapcsolt figyelésnél az Értesítések oldal Munkanapló blokkja ezt jelzi (`getWorkLogCheckStatus`, `org.manage`). |

## 3. Megvalósítás

| Elem | Hely |
|---|---|
| Tiszta segédek (beállítás, tartomány, hiányzó napok) | `server/work-log-check-utils.ts` |
| Beállítás (`getWorkLogCheck`, `saveWorkLogCheck`), napi futás (`runWorkLogCheckForAll`): emlékeztető és eszkaláció | `server/work-log-check.ts` |
| Ütemezett feladat `work-log-missing-check` → `runWorkLogCheck` | `server/jobs.ts`, `manifest.json` |
| Eszkalált napok nyilvántartása | `migrations/026_work_log_alerts.sql` |
| Email sablonok | `email-templates/work_log_missing_employee.json` (dolgozó), `email-templates/work_log_missing.json` (eszkaláció) |
| Felület | `src/components/WorkLogSettings.svelte`, menü: Beállítások → Munkanapló |
| Tesztek | `tests/work-log-check.test.ts` |

A beállítás a `kv_store`-ban van (`settings:work_log_check:org_<id>`), az utolsó futás eredménye a `state:work_log_check:org_<id>` kulcson. Dev módban a futás szimulált nappal indítható: `POST /api/jobs/work-log-missing-check/run?today=YYYY-MM-DD`.
