# Dolgozói dokumentumok

> Státusz: kész (0.12.0) · Utolsó módosítás: 2026-10-06

A dolgozókhoz ma nem lehet iratot csatolni. A cél: a dolgozói adatlapon dokumentumokat lehessen nyilvántartani (munkaszerződés, munkaköri leírás, orvosi alkalmassági, erkölcsi bizonyítvány, végzettség stb.), fájllal vagy fájl nélkül, érvényességi idővel. A lejáró és a hiányzó kötelező iratokról a HR értesítést kap, a dolgozó pedig látja a saját dokumentumait.

**Előfeltétel:** a core plugin fájltárolása (`racona-core/.kiro/specs/plugin-file-storage/`). A fájlok a lemezen vannak, az adatbázisban csak a hivatkozásuk.

## 1. Hatókör

**Benne van**

- Szervezetenkénti dokumentumtípus-katalógus, alapértelmezett típusokkal.
- „Dokumentumok” fül a dolgozói adatlapon: felvétel, szerkesztés, fájlok feltöltése, előnézet, letöltés, törlés, új verzió.
- Fájl nélküli nyilvántartás (pl. erkölcsi bizonyítvány: csak a bemutatás ténye és ideje).
- Lejárat-figyelés: napi ütemezett feladat, értesítés és email a HR-nek; Dashboard kártya; szervezeti áttekintő oldal (lejáró, lejárt, hiányzó).
- A dolgozó látja a saját dokumentumait (típusonként állítható).
- Szervezeti kapcsoló: a dolgozó feltölthet-e ellenőrzésre (alapból ki).
- Belsős és külsős dolgozóra egyaránt, ugyanazokkal a típusokkal.
- Napló: ki, mikor, mit csinált (felvétel, megtekintés, letöltés, törlés, döntés).

**Nincs benne**

- Titkosítás tároláskor.
- Dokumentum generálása sablonból (pl. munkaszerződés kitöltése).
- Megőrzési idő utáni automatikus törlés, ZIP-letöltés kilépéskor (későbbi ütem).
- A szabadságkérelmek igazolásainak átköltöztetése az új tárolóba (maradnak `BYTEA`-ban).
- Külsős dolgozóknak külön típusok.

## 2. Döntések

| # | Kérdés | Döntés | Állapot |
|---|---|---|---|
| D1 | Hol tároljuk a fájlokat? | Fájlrendszerben, a core `context.files` szolgáltatásán át (`uploads/plugin-files/racona-work/...`). Az adatbázisban csak a `file_id`. | **eldöntve** |
| D2 | Erkölcsi bizonyítvány | A típusnál beállítható a fájlkezelés: kötelező / opcionális / **nincs fájl**. Az erkölcsi bizonyítvány alapból „nincs fájl”: csak a bemutatás dátuma, az érvényesség és a rögzítő kerül be. | **eldöntve** |
| D3 | Látja-e a dolgozó? | Igen, a saját dokumentumait, típusonként kapcsolható (`visible_to_employee`, alapból be). | **eldöntve** |
| D4 | Feltölthet-e a dolgozó? | Szervezeti kapcsoló (`employeeUploadEnabled`, alapból **ki**). Bekapcsolva a dolgozó azokhoz a típusokhoz tölthet fel, ahol a típus engedi; a feltöltés HR-jóváhagyásra vár. | **eldöntve** |
| D5 | Mérethatár | Fájlonként 10 MB, dokumentumonként legfeljebb 5 fájl. Engedett formátum: PDF, JPG, PNG, WEBP, DOCX, XLSX, ODT, ODS. | **eldöntve** |
| D6 | Mennyiség | Dolgozónként 5–10 dokumentum: a fülön nem kell lapozás, egy lista elég típus szerint csoportosítva. | **eldöntve** |
| D7 | Külsős dolgozók | Ugyanazok a típusok és a kötelező jelölés is rájuk vonatkozik. | **eldöntve** |
| D8 | Titkosítás | Nincs. | **eldöntve** |
| D9 | Plugin eltávolítása | A fájlok a lemezen maradnak (a core nem törli őket); a plugin sémája a core szokásos módján törlődik. | **eldöntve** |
| D10 | Hol jelenik meg? | Az adatlap fülekre bomlik: „Adatlap” (a mostani tartalom változatlanul) és „Dokumentumok”, a `ProjectDetail` mintájára. | **eldöntve** |
| D11 | Törlés | A dokumentum törlése a fájlokat is törli a lemezről (`files.delete`); a naplóbejegyzés megmarad a dokumentum nevével. Új verziónál a régi „archivált” lesz, nem törlődik. | **eldöntve** |
| D12 | Képességek | `employee.documents.view` (mindenki dokumentumainak olvasása), `employee.documents.manage` (felvétel, szerkesztés, törlés, típusok, döntés), `employee.documents.own` (saját dokumentumok). Az `employee.view` **nem** ad hozzáférést. | **eldöntve** |

## 3. Követelmények

**K1. Dokumentumtípusok.** Beállítások → Dokumentumtípusok oldal (`employee.documents.manage`). Mezők: név, leírás, fájlkezelés (`required` / `optional` / `none`), van-e lejárata, alapértelmezett érvényesség (hónap), emlékeztetők (napok a lejárat előtt, alapból 30 és 7), kötelező-e, látja-e a dolgozó, tölthet-e fel a dolgozó. Típus nem törölhető, csak archiválható, ha van hozzá dokumentum. Az oldal tetején a szervezeti beállítás („A dolgozók is feltölthetnek dokumentumot”, D4, kv_store `settings:documents:org_<id>`); a típusnál „A dolgozó maga is feltöltheti” csak látható, fájlos típusnál állítható.

**K2. Alapértelmezett típusok.** Új szervezetnél és a migrációban minden meglévő szervezetnél:

| Típus | Fájl | Lejárat | Kötelező | Dolgozó látja |
|---|---|---|---|---|
| Munkaszerződés | kötelező | nincs | igen | igen |
| Munkaköri leírás | kötelező | nincs | nem | igen |
| Orvosi alkalmassági vélemény | kötelező | 12 hónap | igen | igen |
| Erkölcsi bizonyítvány | nincs | van, alapérték nélkül | nem | igen |
| Végzettséget igazoló okirat | opcionális | nincs | nem | igen |
| Egyéb | opcionális | nincs | nem | igen |

**K3. Dokumentumok fül.** `employee.documents.view` joggal látható, belsős és külsős dolgozónál is. Típus szerint csoportosított lista: megnevezés, kiállítás / bemutatás dátuma, érvényesség vége, állapot jelvény (érvényes, hamarosan lejár, lejárt, ellenőrzésre vár), fájlok száma. Fent a hiányzó kötelező típusok („Hiányzik: Orvosi alkalmassági vélemény” + Felvétel gomb). `employee.documents.manage` joggal: felvétel, szerkesztés, törlés, új verzió, archivált verziók megjelenítése.

**K4. Felvétel és feltöltés.** Egy párbeszédablak: típus, megnevezés (alapból a típus neve), dátumok (az érvényesség vége a típus alapértékéből előtöltve), megjegyzés, fájlok (húzással vagy tallózással, haladásjelzővel). Mentéskor előbb a dokumentum jön létre, utána fájlonként: `prepareDocumentUpload` → `sdk.files.upload` → `attachDocumentFile`. Ha egy fájl feltöltése elbukik, a dokumentum megmarad, és a fájl újrapróbálható; „nincs fájl” típusnál nincs fájlválasztó. Kötelező fájlú típusnál a fájl nélküli dokumentum „Fájl hiányzik” figyelmeztetést kap.

**K5. Előnézet és letöltés.** PDF és kép új lapon nyílik (`inline`), a többi letöltődik (`attachment`). A link a `getDocumentFileUrl` hívással készül, 60 mp-ig érvényes. Minden megnyitás naplózódik.

**K6. Új verzió.** Egy meglévő dokumentumnál „Új verzió”: ugyanazzal a típussal új dokumentum jön létre, a régi `archived` lesz (`replaced_by_id`), és nem kap több emlékeztetőt.

**K7. Saját dokumentumok.** „Saját dokumentumaim” menüpont (`employee.documents.own`): a dolgozó a saját, `visible_to_employee` típusú, nem archivált dokumentumait látja, előnézettel és letöltéssel. Ha D4 be van kapcsolva, az engedett típusokhoz „Dokumentum feltöltése” gomb; az így felvett dokumentum `pending`. A beküldés lépései: `submitMyDocument` → fájlok (a saját függő dokumentumhoz a dolgozó is csatolhat) → `confirmMyDocumentSubmission` (legalább egy fájl kell; ekkor kap értesítést a HR). A függő beküldést a dolgozó visszavonhatja, az elutasítottat törölheti.

**K8. Jóváhagyás (D4 bekapcsolva).** A `pending` dokumentum a dolgozó Dokumentumok fülén és az áttekintő oldalon „Ellenőrzésre vár” jelvénnyel jelenik meg (az áttekintő listájának elején). `employee.documents.manage` joggal elfogadható (→ `active`, a dátumok javíthatók; alapból a típus korábbi aktív dokumentuma archivált lesz, mint egy új verziónál) vagy elutasítható; az elutasítás indoklása kötelező, a dolgozó látja, a fájlok törlődnek. Mindkét eseményről értesítés megy.

**K9. Lejárat-figyelés.** Napi ütemezett feladat (`employee-document-reminders`, 07:15, Europe/Budapest; a havi szabadság-automatizmus 07:00-kor fut). Az aktív, lejárattal rendelkező dokumentumokra a típus emlékeztető napjain és a lejárat napján egyszer értesítést küld az `employee.documents.manage` joggal rendelkezőknek, és ha a típus látható a dolgozónak, a dolgozónak is. Egy dokumentum adott emlékeztetője csak egyszer megy ki (`employee_document_reminders`). Inaktív dolgozóra nem megy emlékeztető.

**K10. Áttekintés.** Dokumentumok oldal (a menüben a Dolgozók alatt, `DocumentOverview`) (`employee.documents.view`): szűrhető lista a szervezet összes aktív dolgozójáról: lejárt, 30 napon belül lejár, hiányzó kötelező, ellenőrzésre vár. A sorra kattintva a dolgozó Dokumentumok füle nyílik. A Dashboardon `employee.documents.view` joggal „Dokumentumok” kártya a számokkal (a `CarryOverAlerts` mintájára).

**K11. Dolgozólista.** Új oszlop: jelvény, ha a dolgozónak lejárt vagy hiányzó kötelező dokumentuma van; szűrő ugyanerre. A számítás közös (`server/document-overview.ts`): az áttekintő oldal, a Dashboard kártya és a `getEmployees({ withDocumentIssues, documentIssuesOnly })` is ezt használja; a kilépett (inaktív) dolgozók kimaradnak.

**K12. Napló.** Minden művelet bekerül az `employee_document_events` táblába. A Dokumentumok fül alján összecsukható „Napló” (`employee.documents.manage`).

## 4. Adatmodell

`025_employee_documents.sql` (az alaptípusokat a `seed_document_types(org_id)` SQL függvény hozza létre: a migráció a meglévő, a `createOrganization` az új szervezeteknek):

```sql
CREATE TABLE app__racona_work.document_types (
  id                       serial PRIMARY KEY,
  organization_id          integer NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
  name                     varchar(100) NOT NULL,
  description              text,
  file_mode                varchar(10) NOT NULL DEFAULT 'optional'
                             CHECK (file_mode IN ('required', 'optional', 'none')),
  has_expiry               boolean NOT NULL DEFAULT false,
  default_validity_months  integer CHECK (default_validity_months BETWEEN 1 AND 240),
  reminder_days            integer[] NOT NULL DEFAULT '{30,7}',
  is_required              boolean NOT NULL DEFAULT false,
  visible_to_employee      boolean NOT NULL DEFAULT true,
  employee_can_upload      boolean NOT NULL DEFAULT false,
  sort_order               integer NOT NULL DEFAULT 0,
  system_key               varchar(40),          -- az alaptípusok azonosítója
  archived_at              timestamptz,
  created_at, updated_at   timestamptz NOT NULL DEFAULT now()
);
-- egyedi név szervezetenként az aktív típusok között: (organization_id, lower(name)) WHERE archived_at IS NULL

CREATE TABLE app__racona_work.employee_documents (
  id                serial PRIMARY KEY,
  organization_id   integer NOT NULL,
  employee_id       integer NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
  type_id           integer NOT NULL REFERENCES app__racona_work.document_types(id),
  title             varchar(200) NOT NULL,
  issued_on         date,                         -- kiállítás vagy bemutatás napja
  valid_until       date,
  note              text,
  status            varchar(10) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'pending', 'rejected', 'archived')),
  replaced_by_id    integer REFERENCES app__racona_work.employee_documents(id) ON DELETE SET NULL,
  created_by        integer,
  reviewed_by       integer,
  reviewed_at       timestamptz,
  review_note       text,
  created_at, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app__racona_work.employee_document_files (
  id             serial PRIMARY KEY,
  document_id    integer NOT NULL REFERENCES app__racona_work.employee_documents(id) ON DELETE CASCADE,
  file_id        uuid NOT NULL UNIQUE,            -- platform.plugin_files.id
  original_name  varchar(255) NOT NULL,
  mime_type      varchar(100) NOT NULL,
  size           bigint NOT NULL,
  uploaded_by    integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app__racona_work.employee_document_events (
  id               bigserial PRIMARY KEY,
  organization_id  integer NOT NULL,
  employee_id      integer NOT NULL,
  document_id      integer,                       -- nincs FK: törlés után is megmarad
  action           varchar(20) NOT NULL,          -- create, update, file_add, file_delete, view, download, delete, approve, reject, archive
  actor_user_id    integer,                       -- NULL: ütemezett feladat
  details          jsonb,                         -- pl. { "title": ..., "fileName": ... }
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app__racona_work.employee_document_reminders (
  document_id  integer NOT NULL REFERENCES app__racona_work.employee_documents(id) ON DELETE CASCADE,
  offset_days  integer NOT NULL,                  -- 0 = a lejárat napja
  sent_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, offset_days)
);
```

- Az állapot jelvény számolt: `valid_until < ma` → lejárt; `valid_until - ma <= max(reminder_days)` → hamarosan lejár.
- A `file_id` mentése előtt a szerver `files.claim(fileId, { ref: 'employee-document:<id>' })`-t hív; ha a beszúrás elbukik, `files.delete(fileId)`.
- Szervezeti beállítás: kv_store `settings:documents:org_<id>` → `{ employeeUploadEnabled: boolean }`.
- A meglévő szervezetek rendszer-szerepeit a migráció bővíti: `org_admin` mindhárom, `hr_manager` `view` + `manage`, `employee` `own`. Az új szervezetekre a `permissions.ts` rendszer-szerep definíciói.
- `EXTERNAL_CAPABILITIES` kiegészül az `employee.documents.own`-nal.

## 5. Szerverfüggvények (`server/employee-documents.ts`, `server/document-types.ts`)

| Függvény | Jog |
|---|---|
| `listDocumentTypes`, `saveDocumentType`, `archiveDocumentType` | olvasás: `view` vagy `own`; írás: `manage` |
| `getDocumentSettings`, `saveDocumentSettings` | `manage` |
| `listEmployeeDocuments({ employeeId })` | `view`, vagy saját (`own`, csak látható típusok) |
| `saveEmployeeDocument({ id?, employeeId, typeId, ..., replacesId? })` | `manage`; saját feltöltés: `own` + D4 + típus engedi → `pending` |
| `prepareDocumentUpload({ documentId })` | mint a mentés; ellenőrzi a `file_mode`-ot és az 5 fájlos korlátot |
| `attachDocumentFile({ documentId, fileId })` | mint a mentés |
| `deleteDocumentFile({ fileRowId })`, `deleteEmployeeDocument({ id })` | `manage`; saját `pending` dokumentumnál a feltöltő is |
| `getDocumentFileUrl({ fileRowId, disposition })` | mint a lista; naplóz |
| `reviewEmployeeDocument({ id, decision, note?, ... })` | `manage` |
| `getMyDocuments({ organizationId })` | `own` |
| `getDocumentOverview({ organizationId, filter })`, `getDocumentAlerts` | `view` |
| `runEmployeeDocumentReminders` (`server/jobs.ts`) | rendszer-kontextus |

## 6. Értesítések

Új események a `NOTIFICATION_EVENT_DEFAULTS`-ban (rendszeren belüli értesítés mindig megy, az email kapcsolható):

| Kulcs | Esemény | Címzett | Sablon | Alap |
|---|---|---|---|---|
| `document.expiring` | Dokumentum lejár / lejárt | `employee.documents.manage` jogúak | `document_expiring` | be |
| `document.expiringEmployee` | Saját dokumentum lejár / lejárt | a dolgozó (ha látja a típust) | `document_expiring_employee` | ki |
| `document.submitted` | Dolgozó feltöltött dokumentumot | `employee.documents.manage` jogúak | `document_submitted` | ki |
| `document.reviewed` | Feltöltött dokumentum elfogadva / elutasítva | a dolgozó | `document_reviewed` | ki |

A HR-nek szóló lejárati email naponta egy összesítő levél (nem dokumentumonként egy). Ha a feladat kimaradt, a legsürgősebb elért eltolásról megy egy jelzés, a korábbiak is küldöttnek számítanak; a rendszeren belüli értesítés mindig megy, az email az eseménykapcsolótól függ.

## 7. Manifest

- `permissions`: `file_access` hozzáadása.
- `scheduledJobs`: `employee-document-reminders`, `0 7 * * *`, Europe/Budapest, `catchUp: once`.
- A plugin új verziója csak a `file_access`-t támogató core-ral működik; a kiadási jegyzetben jelezni.

## 8. Ütemezés

1. **Alap:** migráció, típusok és beállítás oldal, képességek, Dokumentumok fül (K1–K6), napló (K12). **Kész** (0.10.0). Dokumentummal rendelkező dolgozó nem távolítható el a szervezetből (inaktívra kell állítani); szervezet törlésekor a fájlok a core tárolójából is törlődnek.
2. **Lejárat és hiányzók:** ütemezett feladat, értesítések és sablonok (K9), áttekintő oldal és Dashboard kártya (K10), dolgozólista oszlop (K11). **Kész** (0.11.0).
3. **Dolgozói nézet:** Saját dokumentumaim (K7), feltöltés és jóváhagyás (K8). **Kész** (0.12.0).

## 9. Tesztek

- Jogosultság: `employee.view`-val nem olvasható más dokumentuma; `own`-nal csak a saját, látható típusú; külsős dolgozó látja a sajátját.
- Feltöltés: „nincs fájl” típusnál `prepareDocumentUpload` hibát ad; 6. fájl elutasítva; claim nélküli `fileId` másik felhasználótól elutasítva.
- Törlés: a dokumentummal a core fájl is törlődik; a napló megmarad.
- Emlékeztető: adott eltolásra csak egyszer megy; archivált és inaktív dolgozó dokumentumára nem megy; lejárati nap (0) is megy.
- Új verzió: a régi archivált, és nem jelenik meg a lejáró listában.
