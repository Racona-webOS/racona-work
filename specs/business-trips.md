# Kiküldetések

> Státusz: 1. fázis kész (élesítés előtt) · Utolsó módosítás: 2026-09-11

Ma a dolgozó havonta egy Excel-táblát tölt ki (`kikuldetesi_rendelveny_<rendszám>_<monogram>_<ééééhh>.xlsx`). A táblában kézzel írja be az utakat, a kilométert, a NAV üzemanyagárat és a fogyasztási normát, majd kinyomtatja és aláíratja. A cél, hogy a dolgozó a rendszerben rögzítse az utakat. A kilométert **útvonaltervező számolja** (kiindulópont, cél, visszaút), az összeget a rendszer számolja jogszabály szerint. A havi rendelvényt a HR hagyja jóvá, és a rendszer **a mai xlsx-szel azonos formában** és nyomtatható formában is előállítja.

## 1. Hatókör

**Benne van**

- A dolgozó autóinak kezelése (rendszám, típus, hengerűrtartalom, üzemanyag).
- Utak rögzítése: honnan, hova, köztes megállók, visszaút (a kiindulópontra, máshová vagy nincs), időpont, cél. A távolságot az útvonaltervező adja, a dolgozó indoklással módosíthatja.
- Mentett helyek: lakcím, munkahely, gyakori célok.
- NAV üzemanyagárak havi nyilvántartása (a HR rögzíti).
- Havi kiküldetési rendelvény dolgozónként és autónként: számítás, beküldés, jóváhagyás, kifizetettnek jelölés.
- A hiányzó adatok ellenőrzése és jelzése a rendelvényen.
- **xlsx-rendelvény a mai minta alapján készült sablonból**, és nyomtatható változat (PDF-be menthető).
- A rendelvényhez szükséges fix mezők a dolgozó és a szervezet adatlapján.
- A HR mindenki útjait, autóit és rendelvényeit látja.
- Térképes útvonal-előnézet.
- Üzemanyag: az 1. fázisban benzin és gázolaj. Az adatmodell és a számítás az LPG-, CNG-, hibrid- és elektromos autókra is fel van készítve.

**Nincs benne**

- Céges autó útnyilvántartása (céges autónál nincs költségtérítés, az más dokumentum).
- Munkába járás költségtérítése.
- Külföldi kiküldetés (devizás napidíj, más szabályok).
- Tömegközlekedés, repülő, taxi elszámolása.
- Tényleges tankolási számla alapján történő elszámolás (csak NAV-ár + norma).
- Bérszámfejtési vagy könyvelési rendszerbe küldés.

## 2. A mai rendelvény

Minta: `racona-stuff/kikuldetesi_rendelveny_MXA752_szb_202508.xlsx`. Egy fájl egy dolgozó, egy autó és egy hónap.

| Rendelvény mező | Honnan jön a rendszerben |
|---|---|
| Biz.szám | A rendszer sorszámozza jóváhagyáskor, szervezetenként és évente (D20) |
| Év, hónap | A rendelvény időszaka |
| Munkáltató neve, címe | A szervezet adatlapja (`organizations.name`, `organizations.address`) |
| Munkáltató adószáma | **Új mező a szervezet adatlapján:** `organizations.tax_number` |
| Munkavállaló neve | `auth.users.full_name` |
| Lakcím | **Új fix mező a dolgozó adatlapján:** `employees.home_address` |
| Születési idő | `employees.birth_date` (már van) |
| Születési hely | **Új fix mező:** `employees.birth_place` |
| Anyja neve | **Új fix mező:** `employees.mother_name` |
| Adóazonosító jel | **Új fix mező:** `employees.tax_id` |
| Rendszám, típus, cm³, üzemanyag | `trip_vehicles` |
| Fogyasztási norma | A rendszer számolja a hengerűrtartalomból és az üzemanyagból |
| Sorok: kezdete, vége | `trips.started_at`, `trips.ended_at` |
| Útvonala és célja | `trips.waypoints` (a teljes útvonal, a kiindulóponttal együtt) és `trips.purpose` |
| Elrendelő aláírása | `trips.ordered_by_user_id`: a dolgozó adja meg utanként, a HR módosíthatja (D14). Nevet írunk, aláírásvonal marad. |
| Futásteljesítmény (km) | `trips.distance_km` |
| NAV üzemanyagár (Ft/l) | `trip_fuel_prices` (hónap és ártípus szerint) |
| Utazási költségtérítés (Ft) | Számított |
| Napidíj, szállás, reggeli levonása | 2. fázis (ma mindenhol 0) |
| Összesen, kerekítés, mindösszesen | Számított |
| Kelt | A beküldés dátuma |
| Igazolta, utalványozta | A jóváhagyó és a kifizetést jelölő neve és dátuma, mellettük aláírásvonal |

**Hibák a mai táblában, amelyeket a rendszer kivált:**

- **Rossz hónap a fejlécben.** A fejlécben „2025. július” áll, a sorok augusztusiak (másolásos hiba). A rendszerben a fejléc az időszakból jön.
- **Pontatlan normatábla.** Az „APEH norma” lap kerekített, elavult értékeket tartalmaz (pl. dízel 2000 cm³ → 7). A rendelet szerint ez 6,7, és a számoló lap is 6,7-tel számol. Nálunk a norma a rendelet táblázatából jön.
- **Kézzel beírt ár és norma.** A NAV-árat soronként kézzel kell beírni. A normát a szövegbe és a képletbe is be kell írni (a képletben a 6,7 és a 15 beégetett érték). Nálunk a HR havonta egyszer rögzíti az árat, a normát pedig a rendszer adja.
- **Hiányzó kiindulópont.** Az „Útvonala és célja” oszlopban csak a cél áll. A mintában ugyanaz a cél (Martonvásár) egyszer 62, egyszer 88 km: egyszer otthonról, egyszer a munkahelyről indult az út. Ez a nyomtatványból nem derül ki, pedig az ellenőrzéshez éppen ez kell. Nálunk minden sorban ott lesz a teljes útvonal: honnan, merre, hova érkezett vissza.

## 3. Jogszabályi háttér

| Tétel | Szabály | Bemenet |
|---|---|---|
| Költségtérítés saját autóval | A kiküldetési rendelvény alapján igazolás nélkül elszámolható: **km × (NAV üzemanyagár × norma / 100 + általános személygépkocsi-normaköltség)** (Szja tv. 3. számú melléklet) | km, ár, norma |
| Üzemanyag-fogyasztási alapnorma | A hengerűrtartalom és az üzemanyag szerint (60/1992. (IV. 1.) Korm. rendelet, lásd a táblázatot lent) | cm³, üzemanyag |
| NAV üzemanyagár | A NAV havonta közzéteszi (benzin, gázolaj, keverék, LPG stb.). Az út hónapjának ára számít. | hónap, ártípus |
| Általános személygépkocsi-normaköltség | Jelenleg **15 Ft/km** (a mai tábla is ezzel számol). Beállításban módosítható. | – |
| Rendelvény kötelező tartalma | A dolgozó neve és adóazonosító jele, a rendszám, a kiküldetés célja, időtartama és útvonala, a megtett km | – |
| Megőrzés | Számviteli bizonylat, 8 évig meg kell őrizni (Számv. tv. 169. §) | – |

**Alapnorma (l/100 km), 60/1992. Korm. rendelet**

| Hengerűrtartalom | Benzin | Gázolaj |
|---|---|---|
| 1000 cm³-ig | 7,6 | 5,7 (1500-ig) |
| 1001–1500 cm³ | 8,6 | 5,7 |
| 1501–2000 cm³ | 9,5 | 6,7 |
| 2001–3000 cm³ | 11,4 | 7,6 |
| 3000 cm³ felett | 13,3 | 9,5 |

**Más üzemanyagok.** Az LPG-, CNG-, hibrid- és elektromos autók normáját és árát (melyik NAV-ár, literben, kg-ban vagy kWh-ban) szakmailag ellenőrizni kell. Ezért az 1. fázisban csak benzin és gázolaj választható. A számítás üzemanyagonkénti szabályokra épül (9. fejezet), így egy új üzemanyag bekapcsolása egy szabály és egy választható érték felvétele, migráció nélkül.

### Példa (a minta rendelvény)

Autó: Audi A4, 2000 cm³, gázolaj → norma **6,7 l/100 km**. NAV-ár 2025. augusztus, gázolaj: 600 Ft/l.

- Km-díj: 600 × 6,7 / 100 + 15 = 40,2 + 15 = **55,2 Ft/km**.
- Utak, mindhárom oda-vissza:
  - lakcím (XI. ker.) → Martonvásár → lakcím: 62 km;
  - ugyanez még egyszer: 62 km;
  - munkahely (XIII. ker.) → Martonvásár → munkahely: 88 km.
- Összesen 212 km.
- Soronként: 3 422,4 + 3 422,4 + 4 857,6 = 11 702,4 Ft.
- Kerekítés: −0,4 → **mindösszesen 11 702 Ft**.

## 4. Térkép és útvonaltervezés: mit ad a core?

A Térkép app (`racona-core/apps/web/src/apps/map/index.svelte`) **három külön szolgáltatást** használ:

| Feladat | Mivel | Hogyan éri el |
|---|---|---|
| Térkép megjelenítése | `svelte-maplibre-gl` (maplibre-gl 5) | npm csomag a core-ban |
| Térképcsempék, stílus | CARTO Voyager (`basemaps.cartocdn.com`) | A maplibre tölti be a stílus URL-je alapján |
| Címkeresés | Nominatim (`nominatim.openstreetmap.org`) | **Az app maga hívja** `fetch`-csel a böngészőből |
| Útvonal és távolság | Valhalla (`valhalla1.openstreetmap.de/route`) | **Az app maga hívja** `fetch`-csel a böngészőből |

**A `svelte-maplibre-gl` nem használja a Nominatimot és a Valhallát.** Ez csak megjelenítő könyvtár: térkép, jelölők, vonalak, vezérlők. Címkeresést és útvonaltervezést nem tud, a maplibre-gl sem. A `GeolocateControl` a böngésző helymeghatározását használja, nem címkeresést. A Térkép app a két szolgáltatást a saját komponensében hívja (`search()`, `geocode()`, `fetchRoute()`), és ezeket a core sehol nem teszi elérhetővé.

**Ami az SDK-ból elérhető: a megjelenítés.**

- A pluginok ugyanazt a `svelte-maplibre-gl` modult kapják meg `sdk.libs.maplibre` néven (`packages/sdk/src/runtime/services/SharedLibrariesService.ts`).
- Mintapélda: `racona-core/examples/plugins/map-example/`.
- Saját maplibre-t nem csomagolhatunk: a core kódellenőrzője (`CodeScanner.ts`) elutasítja a `.innerHTML =` mintát, és a maplibre-gl kódjában ilyen van. Ezért a megosztott modult kell használni.

**Ami nem érhető el: a címkeresés és az útvonaltervezés.** Ezt a pluginnak magának kell megoldania.

**Megoldás az 1. fázisra: saját geo modul a plugin szerverén (`server/geo.ts`).**

- A plugin szerverfüggvényei a core folyamatában futnak, és hívhatnak külső HTTP-t (30 s időkorlát).
- Két függvény: `searchPlaces` (Nominatim) és `calculateRoute` (Valhalla). A Térkép app `fetchRoute` és `decodePolyline` függvénye mintának átvehető.
- A szolgáltatások címe beállításból jön, nem beégetett. Így cserélhető saját üzemeltetésű vagy fizetős szolgáltatóra, és a kódellenőrző sem akad fenn rajta (az csak a `fetch('https://…')` literált tiltja).
- Miért szerveroldalon, és nem a böngészőben:
  - **Hiteles km.** A számított távolságot a szerver kéri le és tárolja, a kliens nem tudja „beküldeni”. Ha a dolgozó eltér tőle, azt indokolnia kell, és a HR látja.
  - **Gyorsítótár.** Ugyanaz az útvonal (pl. lakcím → Martonvásár) havonta tucatszor ismétlődik.
  - **Szolgáltatói szabályok.** A Nominatim előírja az azonosító User-Agentet, legfeljebb 1 kérést másodpercenként, és tiltja a gépelés közbeni automatikus kiegészítést. Ezt egy helyen, a szerveren tudjuk betartani.
- A modul egy szűk interfész (`GeoProvider`) mögött van, hogy később átállhassunk a core szolgáltatására (16. fejezet).

**Élesben is a nyilvános szolgáltatások maradnak (D22).** Amit ehhez betartunk:

- Egyik sem ad garanciát (SLA), csak méltányos használatot engednek. A mi forgalmunk kicsi (néhány keresés és útvonal dolgozónként és hónaponként), és a gyorsítótár tovább csökkenti.
- Nominatim: azonosító User-Agent, legfeljebb 1 kérés másodpercenként, nincs gépelés közbeni kiegészítés, a találatok gyorsítótárazva.
- Forrásmegjelölés: a címkeresőnél és a térképen „© OpenStreetMap közreműködők” (az OSM-adatok licence, ODbL, ezt előírja).
- Ha a szolgáltatás nem elérhető, az út kézi km-rel is rögzíthető (K5), a munka nem áll meg.
- A cím beállítható marad, így ha később mégis kell, saját üzemeltetésre (Nominatim és Valhalla Dockerben) vagy kulcsos szolgáltatóra kódmódosítás nélkül át lehet állni.
- A cím, köztük a dolgozó lakcíme, harmadik félhez (FOSSGIS, Németország) kerül. Lásd az adatvédelmi fejezetet.

## 5. Döntések

| # | Kérdés | Döntés | Állapot |
|---|---|---|---|
| D1 | Mi egy rendelvény? | **Egy dolgozó, egy autó, egy naptári hónap**, mint ma. Ha valaki egy hónapban két autóval utazott, két rendelvénye lesz. | javasolt |
| D2 | Honnan jön a km? | A **szerveroldali útvonaltervező** adja (`routed_km`). Az elszámolt km (`distance_km`) alapértelmezésben ennek kerekítése. Eltérés csak **kötelező indoklással** lehetséges, és a HR jelölve látja. | javasolt |
| D3 | Hogyan számoljuk a visszautat? | Három lehetőség: **vissza a kiindulópontra**, **máshová** (pl. a munkahelyről indul, haza érkezik), **csak odaút**. Az útvonaltervező mindig a teljes pontsort kapja (A → megállók → B → vissza), nem kétszerezünk. Így az egyirányú utcák és a más visszaút is benne van, szakaszonként mutatjuk. | javasolt |
| D4 | Km-kerekítés | Egész km-re, a fél felfelé kerekedik. | javasolt |
| D5 | Összeg-kerekítés | A soronkénti összeg két tizedesre marad, a végösszeg egész forintra kerekedik, a különbség a „Kerekítés” sorba kerül (mint ma). | javasolt |
| D6 | Honnan jön a norma? | A 60/1992. rendelet táblázatából, a hengerűrtartalom és az üzemanyag alapján. Egyedi értéket csak a HR adhat meg indoklással. | javasolt |
| D7 | Ki rögzíti a NAV-árat? | **A HR, havonta**, szervezetenként (`trip_fuel_prices`), kézzel vagy **félautomata lekéréssel** a NAV oldaláról (K14). Ütemezett letöltés nincs. Ha a NAV egy hónapra két árat közöl (védett vagy hatósági és piaci), egyet tárolunk: a HR a lekéréskor ártípusonként kiválasztja az elsődleges és a tartalék NAV-oszlopot, alapból a védett ár az elsődleges. | **eldöntve** |
| D8 | Jóváhagyási lépések | Beküldés → **jóváhagyás** („Igazolta”) → **kifizetve** („Utalványozta”). Utanként nincs előzetes jóváhagyás. | javasolt |
| D9 | Ki hagy jóvá? | Aki `trip.approve` joggal rendelkezik, szervezeti szinten (mint a szabadságkérelmeknél). Vezetőnkénti útvonal nincs, mert nincs vezető-dolgozó kapcsolat az adatmodellben. | javasolt |
| D10 | Mi zárolódik? | Beküldés után az adott dolgozó, autó és hónap útjai nem szerkeszthetők. A dolgozó a jóváhagyásig visszavonhatja a beküldést. A HR a kifizetésig visszanyithatja. Kifizetés után semmi nem módosítható. | javasolt |
| D11 | Mit őrzünk meg? | Beküldéskor a rendelvény teljes tartalmát pillanatképbe mentjük: fejléc, sorok, számítás. Jóváhagyáskor frissítjük. Utána a nyomtatás és az xlsx a pillanatképből dolgozik, így a későbbi adatváltozás (új lakcím, eladott autó) nem írja át a régi bizonylatot. | javasolt |
| D12 | Autó törlése | Ha már van rá út, csak archiválható. | javasolt |
| D13 | Kimenet | **xlsx a mai mintából készült sablonból** (10. fejezet), és **nyomtatható nézet** (A4 álló, mint a mai űrlap; PDF-be menthető). | **eldöntve** |
| D14 | Elrendelő | **Utanként** választja a dolgozó a szervezet tagjai közül, nem kötelező. **A HR felülbírálhatja**: soronként vagy egy lépésben a rendelvény minden sorára, beküldött rendelvénynél is, visszaküldés nélkül. A felülbírálás nyoma (ki és mikor) megmarad. A nyomtatványon a neve jelenik meg, mellette aláírásvonal. | **eldöntve** |
| D15 | Menü | A Kiküldetések menücsoport lesz, alpontokkal: Utaim, Rendelvények, Autóim. A HR-es alpontok jogosultsághoz kötöttek. | javasolt |
| D16 | Személyes adatok a rendelvényhez | A lakcím, a születési hely, az anyja neve és az adóazonosító jel **fix, nem kötelező mező a dolgozó adatlapján**, nem a szabad kulcs–érték részletek között. Az adószám fix mező a szervezet adatlapján. | **eldöntve** |
| D17 | Mi van, ha adat hiányzik? | **Figyelmeztetünk, nem tiltunk.** A rendelvény megmondja, mi hiányzik, és ki pótolhatja. A beküldés, a nyomtatás és az xlsx így is működik, a hiányzó cella üres marad. Kivétel a NAV-ár: nélküle nincs összeg, ezért jóváhagyni nem lehet. | **eldöntve** |
| D18 | Üzemanyagok | Az 1. fázisban **benzin és gázolaj**. Az adatbázis, a számítás és a nyomtatvány a többire is fel van készítve (üzemanyagonkénti szabály, ártípus, mértékegység). | **eldöntve** |
| D19 | Hol készül az xlsx? | **A böngészőben**, a `fflate` csomaggal (zip), a szerver pillanatképéből. A plugin szerverkódja nem használhat npm-csomagot (a `server/` mappa forrásként kerül a csomagba, ma is csak relatív importja van). Az ExcelJS túl nagy (~950 KB), és `new Function(` van benne, ezért a kódellenőrző elutasítaná. A SheetJS ingyenes változata írás közben elhagyja a formázást. A `fflate` ~8 KB, és átmegy a kódellenőrzőn (ellenőriztem). | javasolt |
| D20 | Bizonylatszám | **A rendszer sorszámozza**, szervezetenként és évente, hézag nélkül: `KR-2025-0001` (az előtag beállítható). A számot a **jóváhagyás** kapja, hogy a visszaküldött és visszavont rendelvények ne hagyjanak lyukat. Az év a rendelvény időszakának éve. Visszanyitáskor a szám megmarad, újra jóváhagyáskor nem kap újat. Kézzel nem írható át. | **eldöntve** |
| D21 | Ki bírálhatja felül az elrendelőt? | Aki `trip.approve` joggal rendelkezik (a jóváhagyó a rendelvény átnézése közben javíthat), `draft` és `submitted` állapotban. Jóváhagyott rendelvénynél csak visszanyitás után. | javasolt |
| D22 | Címkeresés és útvonal élesben | **A nyilvános Nominatim és Valhalla marad.** A szolgáltató címe beállításban marad, hogy szükség esetén kódmódosítás nélkül cserélhető legyen. | **eldöntve** |

## 6. Folyamat

```
Rendelvény állapotai:

 (nincs sor) ──beküldés──▶ submitted ──jóváhagyás──▶ approved ──kifizetve──▶ paid
                              │  ▲                      │
          visszavonás / ◀─────┘  └──újraküldés──┐       │ HR visszanyitás
          HR visszaküldés                       │       ▼
                              draft ◀───────────┴──────┘
```

- **draft:** a rendelvényt a dolgozó visszavonta, vagy a HR visszaküldte (megjegyzéssel). Az utak szerkeszthetők.
- **submitted:** az utak zárolva, a HR-nél jóváhagyásra vár.
- **approved:** igazolva, kifizetésre vár. Csak a HR nyithatja vissza.
- **paid:** lezárva.

Rendelvénysor csak az első beküldéskor jön létre. Addig a havi nézet élő előnézet az utakból.

## 7. Követelmények

**K1. Autók.** A dolgozó felveheti, szerkesztheti és archiválhatja az autóit:

- rendszám (nagybetűsítve, szóközök nélkül tárolva; a formátumot nem ellenőrizzük, a külföldi rendszám is jó);
- típus (szabad szöveg, pl. „Audi A4”);
- hengerűrtartalom (cm³);
- üzemanyag (1. fázis: benzin, gázolaj);
- egy autó alapértelmezettnek jelölhető.

A norma a felvételkor azonnal látszik („6,7 l/100 km a 60/1992. Korm. rendelet szerint”). A HR bármelyik dolgozó autóit kezelheti, és egyedi fogyasztási értéket adhat meg indoklással.

**K2. Mentett helyek.**

- Mindig választható kiindulópont: a dolgozó **lakcíme** és a **munkahely** (alapból a szervezet címe). Ez a kettő a leggyakoribb, és ugyanarra a célra más km-t ad, ezért az űrlap tetején egy kattintással váltható („Otthonról” / „A munkahelyről”).
- Ha a munkahely nem a szervezet címe (pl. a székhely máshol van), a HR egy céges helyet megjelölhet munkahelyként.
- Céges helyek (pl. partnerek telephelyei): a HR kezeli, mindenki látja.
- Saját helyek: a dolgozó kezeli, csak ő látja.
- Egy út célja egy kattintással elmenthető saját helyként.

**K3. Címkeresés.** A mező gombra vagy Enterre keres (gépelés közben nem, a Nominatim szabályai miatt). Legfeljebb 5 találatot mutat, a dolgozó kiválasztja a jót. A kiválasztott hely neve és koordinátái mentődnek.

**K4. Út rögzítése.** Mezők:

- autó (alapértelmezés: az alapértelmezett autó);
- kezdete és vége (dátum és idő);
- honnan (alapértelmezés: amit a dolgozó legutóbb kiindulópontnak választott; első alkalommal a lakcím);
- köztes megállók (0–8);
- hova;
- visszaút (alapértelmezés: vissza a kiindulópontra):
  - vissza a kiindulópontra;
  - máshová, ekkor egy további helyválasztó jelenik meg (pl. a munkahelyről indult, haza érkezett);
  - csak odaút;
- cél (kötelező szöveg, pl. „Ügyféltalálkozó, rendszerbevezetés”);
- elrendelő (nem kötelező; alapértelmezés: a dolgozó előző útjának elrendelője).

**K5. Távolság.**

- A „Távolság számítása” gomb, illetve a pontok változása után a szerver útvonalat tervez.
- Megjelenik az útvonaltervező szerinti táv (pl. „61,7 km, kb. 45 perc”), a szakaszok (oda 30,9 km, vissza 30,8 km) és az útvonal a térképen.
- Az elszámolt km (62) szerkeszthető. Ha eltér a kerekített tervezett értéktől, az indoklás kötelező (pl. „terelés az M7-en”).
- Ha az útvonaltervező nem elérhető, az út kézi km-rel is menthető, kötelező indoklással, „kézi” jelöléssel.

**K6. Ellenőrzések mentéskor.**

- A vége a kezdete után van.
- Ugyanannak a dolgozónak az útjai nem fedhetik egymást.
- Az elszámolt km 1 és 5000 között van.
- Az autó a dolgozóé, nincs archiválva, és az üzemanyaga engedélyezett.
- Az adott dolgozó, autó és hónap rendelvénye nincs zárolva (D10).
- A hónapot a kezdés napja határozza meg, budapesti idő szerint.

**K7. Út másolása.** Egy meglévő utat új dátummal lehet másolni (ugyanaz az útvonal, cél és km). A tervezett táv a gyorsítótárból jön, nem kér újra.

**K8. Havi nézet (Utaim).**

- Hónapválasztó, autónkénti bontás.
- Soronként: dátum, útvonal a kiindulóponttal, cél, km, becsült összeg.
- Havi összesítő: km, km-díj, összeg.
- Ha nincs még NAV-ár a hónapra, az összeg helyén „NAV-ár még nincs rögzítve” áll.
- Ha a rendelvényhez adat hiányzik, figyelmeztető sáv (K15).

**K9. Beküldés.**

- A dolgozó a havi nézetből autónként beküldi a rendelvényt.
- Ha adat hiányzik, a beküldő ablak felsorolja, és „Beküldöm így is” gombbal folytatható (D17).
- Beküldéskor elkészül a pillanatkép (D11), a figyelmeztetésekkel együtt.

**K10. Jóváhagyás (HR).**

- Lista szűrőkkel: hónap, dolgozó, állapot.
- A rendelvény részletei a sorokkal, az eltérő km-ek kiemelve, az indoklásuk mellettük.
- A hiányzó adatok listája, mindegyik mellett közvetlen link a pótláshoz (a dolgozó adatlapja, a szervezet adatlapja, a NAV-árak).
- Az elrendelő soronként módosítható, vagy egy lépésben a rendelvény minden sorára beállítható („Elrendelő minden sorra”). A felülbírált sorokon jelölés látszik (kitől mire, ki és mikor módosította); a dolgozó is látja.
- Jóváhagyás vagy visszaküldés kötelező megjegyzéssel. Jóváhagyáskor a rendelvény megkapja a következő bizonylatszámot (D20), ha még nincs neki.
- Jóváhagyáskor a pillanatképet frissítjük: a közben pótolt adatok, az aktuális NAV-ár és az újraszámolt összeg. Ha a NAV-ár hiányzik, a jóváhagyás hibát ad.

**K11. Kifizetés.** A HR kifizetettnek jelöli (dátummal). Ezzel a rendelvény végleg lezárul.

**K12. Nyomtatás.**

- Bármely rendelvény nyomtatható, a draft előnézetként, „Nem beküldött” vízjellel.
- A nyomtatvány a mai űrlap szerkezetét követi (2. fejezet). Az „Útvonala és célja” oszlopban a teljes útvonal szerepel a kiindulóponttal (pl. „Munkahely (1135 Budapest, Kisgömb u. 25–27.) → Martonvásár, Brunszvik u. 2. → vissza”), alatta a cél.

**K13. HR áttekintés.** A HR a szervezet összes dolgozójának útjait, autóit és rendelvényeit látja. Bármelyik dolgozó nevében rögzíthet utat.

**K14. NAV-árak.** A HR évenkénti táblázatban rögzíti a havi árakat ártípusonként (1. fázis: benzin, gázolaj). A rögzített ár módosítható, amíg nincs rá jóváhagyott rendelvény.

- **Félautomata lekérés.** A „Lekérés a NAV-tól” gomb a szerveren letölti a kiválasztott év NAV-oldalát, és előnézetet mutat. A NAV-nak nincs API-ja, az árak egy HTML-táblázatban vannak (`nav.gov.hu/ugyfeliranytu/uzemanyag`). Az év oldalát a gyűjtőoldal, régebbi évnél a „Korábbi években” oldal linkjeiből keressük ki, mert az URL évente más.
- **Oszlop-hozzárendelés.** A NAV táblázatának oszlopai évről évre változnak (2022: hatósági és piaci árszabás, 2026: védett ár és piaci árszabás). Ártípusonként a HR kiválaszt egy elsődleges és egy tartalék NAV-oszlopot: ha az elsődlegesben nincs ár az adott hónapra, a tartalékból töltünk. A javaslat a fejlécek alapján készül, a védett vagy hatósági ár az elsődleges. A választást a beállításokban megjegyezzük (`navPriceMapping`); ha a következő évben az oszlop már nincs meg, újra javaslatot adunk, és jelezzük, hogy ellenőrizni kell.
- **Kitöltés.** Az üres hónapokat kitöltjük. Az eltérő árat csak bejelölve írjuk felül: a korábban is NAV-ból jött árak alapból be vannak jelölve, a kézzel beírtak nem. Jóváhagyott rendelvény árát nem módosítjuk. A kitöltött ár forrása `nav` lesz; ha a HR átírja, `manual`. A táblázatban a NAV-ból jött árak jelölve vannak.
- **Hiba esetén nem írunk semmit.** Ha a táblázat nem ismerhető fel (nincs hónapsor, összevont cellák, más év), a lekérés hibát ad, az árakat kézzel kell rögzíteni. Az értelmezhetetlen cellát (szöveg szám helyett, 0 vagy 10 000 Ft fölötti ár) hibásnak jelöljük, és nem lépünk tovább a tartalék oszlopra.
- **Egy adat az előnézetre és a kitöltésre.** A letöltött táblázat 10 percig a szerver közös gyorsítótárában marad. A kitöltés a táblázat ujjlenyomatával (`version`) ellenőrzi, hogy ugyanarra az adatra vonatkozik, amit a HR az előnézetben látott. Az árat a szerver számolja a NAV adataiból, a klienstől nem fogad el árat.

**K15. Hiányzó adatok ellenőrzése.** A rendszer minden rendelvényre kiszámolja a figyelmeztetések listáját (`warnings`):

| Hiányzó adat | Ki pótolhatja | Hatás |
|---|---|---|
| A dolgozó lakcíme, születési dátuma, születési helye, anyja neve, adóazonosító jele | HR (`employee.manage`) a dolgozó adatlapján | figyelmeztetés, üres cella |
| A szervezet címe, adószáma | aki a szervezetet szerkesztheti (ma a rendszergazda), a szervezet adatlapján | figyelmeztetés, üres cella |
| Az autó fogyasztási normája (egyedi érték nélküli, jogszabályi norma nélküli üzemanyag) | HR az autónál | nincs összeg, **nem hagyható jóvá** |
| Elrendelő az utaknál („3 útnál nincs elrendelő”) | a dolgozó az útnál, vagy a HR felülbírálással | figyelmeztetés |
| NAV-ár a hónapra és ártípusra | HR a NAV-árak táblában | nincs összeg, **nem hagyható jóvá** |

- Megjelenik a havi nézetben (sáv), a beküldő ablakban, a HR részletes nézetében, és a nyomtatás és az xlsx előtt (megerősítő ablak: „Hiányzó adatok: … Folytatod?”).
- A dolgozó nem szerkesztheti a saját személyes adatait, ezért neki a szöveg: „Ezeket a HR tudja pótolni.”
- Ugyanez a lista a pillanatképben is tárolódik, így a HR látja, mi hiányzott beküldéskor.

**K16. xlsx letöltése.** Bármely rendelvény letölthető xlsx-ben, a 10. fejezetben leírt sablonból. A fájl Excelben szerkeszthető, a képletek élők.

**K17. Dolgozói adatlap.** A „Személyes” kártyán, a születési dátum mellett, ugyanazzal a fix sor mintával:

- **Lakcím.** Mentéskor a szerver geokódolja, és kiírja, mit talált („Térképen: 1111 Budapest, Példa utca 1.”), hogy a HR ellenőrizhesse. Ha nem találja, figyelmeztet, de ment.
- **Születési hely.**
- **Anyja neve.**
- **Adóazonosító jel.** 10 számjegy, 8-cal kezdődik, a 10. az ellenőrző jegy (az 1–9. jegyek helyi értékkel, 1-től 9-ig szorzott összegének 11-es maradéka). Hibás formátum vagy ellenőrző jegy esetén hiba. Figyelmeztetés, ha a 2–6. jegy (az 1867. 01. 01. óta eltelt napok száma) nem egyezik a születési dátummal.

Mind nem kötelező. Láthatóság: mint a születési dátumnál (a dolgozó maga, `employee.manage`, `leave.balance.manage`). Szerkesztés: `employee.manage`.

**K18. Szervezet adatlapja.** A „Szervezet szerkesztése” ablakban (`Organizations.svelte`) a Cím alatt új mező: **Adószám** (`12345678-1-12` formátum, nem kötelező). A cím mentésekor a szerver geokódol, ez lesz a „munkahely” kiindulópont. Ha a címet nem találja, figyelmeztet: „A címet nem találtuk a térképen, ezért »A munkahelyről« indulásnál nem tudunk távolságot számolni.”

## 8. Adatmodell

Új migráció: `015_business_trips.sql`, a meglévő konvenciókkal (idempotens, `SERIAL`, magyar fejléckomment, `idx_<tábla>_<oszlopok>`).

```sql
-- Szervezet: a rendelvény fejlécéhez és a munkahely kiindulóponthoz
ALTER TABLE app__racona_work.organizations
    ADD COLUMN IF NOT EXISTS tax_number  VARCHAR(13),     -- 12345678-1-12
    ADD COLUMN IF NOT EXISTS address_lat NUMERIC(9,6),
    ADD COLUMN IF NOT EXISTS address_lng NUMERIC(9,6);
-- CHECK (tax_number IS NULL OR tax_number ~ '^\d{8}-\d-\d{2}$')

-- Dolgozó: fix, nem kötelező mezők (D16)
ALTER TABLE app__racona_work.employees
    ADD COLUMN IF NOT EXISTS home_address TEXT,
    ADD COLUMN IF NOT EXISTS home_lat     NUMERIC(9,6),
    ADD COLUMN IF NOT EXISTS home_lng     NUMERIC(9,6),
    ADD COLUMN IF NOT EXISTS birth_place  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS mother_name  VARCHAR(150),
    ADD COLUMN IF NOT EXISTS tax_id       VARCHAR(10);
-- CHECK (tax_id IS NULL OR tax_id ~ '^8\d{9}$'); az ellenőrző jegyet a szerver nézi

CREATE TABLE IF NOT EXISTS app__racona_work.trip_vehicles (
    id               SERIAL PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    employee_id      INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    plate_number     VARCHAR(16) NOT NULL,          -- nagybetűs, szóköz nélkül
    model            VARCHAR(100) NOT NULL,         -- "Audi A4"
    engine_cc        INTEGER CHECK (engine_cc BETWEEN 50 AND 10000),  -- elektromosnál NULL
    -- petrol | diesel | lpg | cng | hybrid | electric
    -- Az 1. fázisban csak petrol és diesel engedélyezett (FUEL_RULES, 9. fejezet)
    fuel_type        VARCHAR(16) NOT NULL
        CHECK (fuel_type IN ('petrol', 'diesel', 'lpg', 'cng', 'hybrid', 'electric')),
    -- Egyedi fogyasztás az üzemanyag mértékegységében (l, kg vagy kWh / 100 km), csak HR
    consumption_override        NUMERIC(5,2),
    consumption_override_reason TEXT,
    is_default       BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, plate_number)
);

-- Mentett helyek: employee_id NULL = céges hely (HR kezeli)
CREATE TABLE IF NOT EXISTS app__racona_work.trip_places (
    id               SERIAL PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    employee_id      INTEGER REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    label            VARCHAR(100) NOT NULL,         -- "Martonvásár – partner"
    address          TEXT NOT NULL,
    lat              NUMERIC(9,6) NOT NULL,
    lng              NUMERIC(9,6) NOT NULL,
    is_workplace     BOOLEAN NOT NULL DEFAULT FALSE, -- céges helynél: ez a munkahely kiindulópont (K2)
    created_by       INTEGER REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app__racona_work.trips (
    id               SERIAL PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    employee_id      INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE CASCADE,
    vehicle_id       INTEGER NOT NULL REFERENCES app__racona_work.trip_vehicles(id),
    started_at       TIMESTAMPTZ NOT NULL,
    ended_at         TIMESTAMPTZ NOT NULL,
    purpose          TEXT NOT NULL,
    -- [{ label, address, lat, lng }], sorrendben: kiindulópont, megállók, cél,
    -- 'other' visszaútnál a végén a visszaérkezés helye
    waypoints        JSONB NOT NULL,
    -- origin: vissza a kiindulópontra | other: máshová | none: csak odaút
    return_mode      VARCHAR(8) NOT NULL DEFAULT 'origin'
        CHECK (return_mode IN ('origin', 'other', 'none')),
    routed_km        NUMERIC(8,1),                  -- útvonaltervező szerint; NULL = kézi
    route_legs_km    JSONB,                         -- [30.9, 30.8]
    route_geometry   TEXT,                          -- encoded polyline6, a térképhez
    distance_km      INTEGER NOT NULL CHECK (distance_km BETWEEN 1 AND 5000),
    distance_reason  TEXT,                          -- kötelező, ha eltér a tervezettől
    ordered_by_user_id INTEGER REFERENCES auth.users(id),
    -- HR-felülbírálás nyoma (D14, D21); NULL, ha a dolgozó választása érvényes
    ordered_by_overridden_by INTEGER REFERENCES auth.users(id),
    ordered_by_overridden_at TIMESTAMPTZ,
    created_by       INTEGER REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ended_at > started_at)
);
CREATE INDEX IF NOT EXISTS idx_trips_employee_started
    ON app__racona_work.trips(employee_id, started_at);
CREATE INDEX IF NOT EXISTS idx_trips_org_started
    ON app__racona_work.trips(organization_id, started_at);

CREATE TABLE IF NOT EXISTS app__racona_work.trip_settlements (
    id               SERIAL PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    employee_id      INTEGER NOT NULL REFERENCES app__racona_work.employees(id) ON DELETE RESTRICT,
    vehicle_id       INTEGER NOT NULL REFERENCES app__racona_work.trip_vehicles(id),
    year             SMALLINT NOT NULL,
    month            SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    -- draft | submitted | approved | paid
    status           VARCHAR(16) NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'paid')),
    document_number  VARCHAR(32),                   -- Biz.szám, jóváhagyáskor kapja (D20)
    total_km         INTEGER NOT NULL,
    total_amount     INTEGER,                       -- Ft, kerekítve; NULL, ha nincs NAV-ár
    snapshot         JSONB NOT NULL,                -- fejléc + sorok + számítás + warnings (D11)
    note             TEXT,                          -- visszaküldés oka
    submitted_at     TIMESTAMPTZ,
    approved_by      INTEGER REFERENCES auth.users(id),
    approved_at      TIMESTAMPTZ,
    paid_by          INTEGER REFERENCES auth.users(id),
    paid_at          DATE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, vehicle_id, year, month),
    UNIQUE (organization_id, document_number)
);
CREATE INDEX IF NOT EXISTS idx_trip_settlements_org_status
    ON app__racona_work.trip_settlements(organization_id, status);

-- Bizonylatszám-számláló szervezetenként és évente (D20). Jóváhagyáskor, ugyanabban
-- a tranzakcióban: UPDATE … SET last_number = last_number + 1 … RETURNING.
-- A sorzár miatt két egyszerre jóváhagyott rendelvény nem kaphat azonos számot.
CREATE TABLE IF NOT EXISTS app__racona_work.trip_document_counters (
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    year             SMALLINT NOT NULL,
    last_number      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, year)
);

-- NAV-árak ártípusonként. A mértékegységet az ártípus adja (9. fejezet):
-- petrol, diesel, mixed, lpg: Ft/l · cng: Ft/kg · electricity: Ft/kWh
CREATE TABLE IF NOT EXISTS app__racona_work.trip_fuel_prices (
    organization_id  INTEGER NOT NULL REFERENCES app__racona_work.organizations(id) ON DELETE CASCADE,
    year             SMALLINT NOT NULL,
    month            SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    price_type       VARCHAR(16) NOT NULL
        CHECK (price_type IN ('petrol', 'diesel', 'mixed', 'lpg', 'cng', 'electricity')),
    price_huf        NUMERIC(8,2) NOT NULL CHECK (price_huf > 0),
    source           VARCHAR(8) NOT NULL DEFAULT 'manual'   -- 018: kézzel vagy a NAV-tól (K14)
        CHECK (source IN ('manual', 'nav')),
    updated_by       INTEGER REFERENCES auth.users(id),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, year, month, price_type)
);

-- Címkeresés és útvonal gyorsítótára (szervezetfüggetlen)
CREATE TABLE IF NOT EXISTS app__racona_work.geo_cache (
    cache_key        CHAR(64) PRIMARY KEY,          -- sha256(kind + normalizált kérés)
    kind             VARCHAR(8) NOT NULL CHECK (kind IN ('search', 'route')),
    response         JSONB NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

A migráció a meglévő szerepköröknek is kiosztja az új jogokat, ahogy a `006_work_calendar.sql` tette (lásd a 11. fejezetet).

**Miért fix oszlop a személyes adat, és nem `employee_details`?** A rendelvény név szerint hivatkozik rájuk, validálni kell őket (adóazonosító), és a hiányukat jelezni. A szabad kulcs–érték sorokra erre nem lehet építeni. Ugyanez az oka a `birth_date` oszlopnak is.

**Miért van bővebb `CHECK` az üzemanyagra, mint amit az 1. fázis enged?** Hogy egy új üzemanyag bekapcsolásához ne kelljen migráció. Az engedélyezést a kód végzi (`FUEL_RULES`), a szerver elutasítja a nem engedélyezett értéket.

**Miért nincs FK az út és a rendelvény között?** Az út a dolgozó, az autó és a kezdés hónapja alapján tartozik egy rendelvényhez. Így nem kell kapcsolatot karbantartani, amikor a dolgozó autót vagy dátumot vált egy draft időszakban. A zárolást (D10) mentéskor ellenőrizzük.

**Miért `ON DELETE RESTRICT` a rendelvénynél?** Számviteli bizonylat, 8 évig meg kell őrizni. Rendelvénnyel rendelkező dolgozó nem törölhető, csak inaktiválható (ez ma is a szokásos út).

**Miért van a munkahelynek is koordinátája?** Hogy kiindulópontként ne kelljen minden útnál újra geokódolni. Mentéskor egyszer kérjük le, ugyanúgy, mint a lakcímnél.

## 9. Számítás

Tiszta modul, a kliens is importálja: `server/trip-calc.ts`. Teszt: `tests/business-trips.test.ts`.

```ts
type FuelType = 'petrol' | 'diesel' | 'lpg' | 'cng' | 'hybrid' | 'electric';
type PriceType = 'petrol' | 'diesel' | 'mixed' | 'lpg' | 'cng' | 'electricity';

interface FuelRule {
  enabled: boolean;                    // 1. fázis: csak petrol és diesel
  priceType: PriceType;                // melyik NAV-árral számolunk
  unit: 'l' | 'kg' | 'kWh';            // a norma és az ár mértékegysége
  /** Alapnorma / 100 km; null = nincs jogszabályi norma, egyedi érték kell. */
  norm(vehicle: { engineCc: number | null }): number | null;
}

const FUEL_RULES: Record<FuelType, FuelRule> = {
  petrol: { enabled: true, priceType: 'petrol', unit: 'l', norm: petrolNorm },  // 60/1992
  diesel: { enabled: true, priceType: 'diesel', unit: 'l', norm: dieselNorm },  // 60/1992
  lpg:      { enabled: false, ... },   // 17. fejezet: szakmai ellenőrzés után
  cng:      { enabled: false, ... },
  hybrid:   { enabled: false, ... },
  electric: { enabled: false, ... },
};

/** A jármű fogyasztása: egyedi érték, különben a szabály normája. */
function vehicleConsumption(vehicle): { value: number | null; unit: string; source: 'regulation' | 'override' };

/** Ft/km, két tizedesre kerekítve. */
function ratePerKm(input: { price: number; consumption: number; normCostPerKm: number }): number;

interface SettlementCalc {
  consumption: number;        // 6.7
  unit: 'l' | 'kg' | 'kWh';   // a nyomtatványon: "liter/100 km"
  price: number | null;       // 600
  normCostPerKm: number;      // 15
  ratePerKm: number | null;   // 55.2
  rows: { tripId: number; km: number; amount: number | null }[];  // 3422.4
  totalKm: number;            // 212
  subtotal: number | null;    // 11702.4
  rounding: number | null;    // -0.4
  total: number | null;       // 11702
}
function calculateSettlement(...): SettlementCalc;

type SettlementWarning =
  | { kind: 'employee_field'; field: 'home_address' | 'birth_date' | 'birth_place' | 'mother_name' | 'tax_id' }
  | { kind: 'organization_field'; field: 'address' | 'tax_number' }
  | { kind: 'missing_ordered_by'; tripCount: number }
  | { kind: 'missing_fuel_price'; priceType: PriceType; year: number; month: number };  // blokkolja a jóváhagyást
function settlementWarnings(...): SettlementWarning[];

/** Adóazonosító jel: formátum és ellenőrző jegy; a születési dátum egyezése külön. */
function validateTaxId(taxId: string, birthDate?: string): { valid: boolean; birthDateMismatch: boolean };
```

**Tesztesetek**

- A minta rendelvény: 62 + 62 + 88 km, dízel 2000 cm³, 600 Ft/l → 55,2 Ft/km, 11 702 Ft, kerekítés −0,4.
- Sávhatárok: benzin 1000/1001, 1500/1501, 2000/2001, 3000/3001 cm³; dízel 1500/1501 stb.
- Egyedi fogyasztás felülírja a táblázatot.
- Nem engedélyezett üzemanyag hibát ad.
- Hiányzó NAV-ár esetén az összegek `null` értékűek, a km összesítés megmarad, és van `missing_fuel_price` figyelmeztetés.
- Kerekítés: x,5 felfelé.
- Adóazonosító: érvényes szám; rossz ellenőrző jegy; 9 jegy; nem 8-cal kezdődik; a születési dátummal nem egyező 2–6. jegy.
- Figyelmeztetések: minden mező megvan → üres lista; hiányzó adószám → `organization_field`.

## 10. xlsx sablon és kitöltés

**A sablon**: `assets/templates/kikuldetesi-rendelveny.xlsx`, a mai mintából készül Excelben:

- A személyes adatok és az értékek törölve, helyükön `{{…}}` jelölők (lásd lent).
- A norma és a normaköltség külön cellába kerül. Ma a norma a szövegben áll („átalány … 6,7 liter/100 km”), a képletben pedig beégetett a 6,7 és a 15. A sablon képletei ezekre a cellákra hivatkoznak.
- Az utakhoz egyetlen mintasor van `{{trip.*}}` jelölőkkel; a kitöltő ezt sokszorozza.
- Az „APEH norma” lap helyére „Alapnorma (60-1992)” lap kerül (a munkalap nevében nem lehet `/`), a helyes táblázattal, tájékoztatásként.
- A bizonylatszám az `I1:L1` összevont cellába kerül („Biz.szám: {{doc.number}}”), mert a mintában a felirat és az érték összefolyt.
- A formázás (összevont cellák, keretek, oszlopszélesség, nyomtatási beállítás) a mintáé marad. Ha a cég űrlapja változik, elég a sablont Excelben átszerkeszteni, amíg a jelölők megmaradnak.

**Jelölők**

| Csoport | Jelölők |
|---|---|
| Bizonylat | `{{doc.number}}` (jóváhagyás előtt üres), `{{period.label}}` („2025. év augusztus hó”), `{{doc.date}}` (kelt) |
| Munkáltató | `{{employer.name}}`, `{{employer.address}}`, `{{employer.taxNumber}}` |
| Munkavállaló | `{{employee.name}}`, `{{employee.address}}`, `{{employee.birth}}` („1990.05.12. Szeged”), `{{employee.motherName}}`, `{{employee.taxId}}` |
| Autó | `{{vehicle.plate}}`, `{{vehicle.model}}`, `{{vehicle.engineCc}}`, `{{vehicle.fuel}}` („gázolaj”), `{{vehicle.consumption}}` (szám), `{{vehicle.consumptionUnit}}` („liter/100 km”) |
| Díjak | `{{rate.normCost}}` (szám), `{{rate.priceUnit}}` („Ft/l”) |
| Út (mintasor) | `{{trip.index}}`, `{{trip.start}}`, `{{trip.end}}`, `{{trip.route}}` (útvonal és cél), `{{trip.orderedBy}}`, `{{trip.km}}`, `{{trip.price}}`, `{{trip.meal}}`, `{{trip.lodging}}`, `{{trip.breakfast}}` (az utolsó három az 1. fázisban 0) |
| Lábléc | `{{total.rounding}}`, `{{approval.by}}`, `{{approval.date}}`, `{{payment.by}}`, `{{payment.date}}` |

A költségtérítés oszlopa és az összesítő sorok a sablonban képletek maradnak, nem jelölők.

**A kitöltés lépései** (`src/xlsx/fill-settlement.ts`, `fflate`):

1. Letöltés: `sdk.assets.getUrl('templates/kikuldetesi-rendelveny.xlsx')`. Relatív URL, a kódellenőrzőn átmegy.
2. Kicsomagolás (`unzipSync`), majd a `xl/sharedStrings.xml`, `xl/worksheets/sheet1.xml`, `xl/workbook.xml` beolvasása.
3. A jelölős cellák átírása szöveggé vagy számmá (inline string / szám). A cella stílusa (`s` attribútum) marad.
4. A mintasor sokszorozása:
   - legalább 13 sor, hogy a nyomtatvány képe a mai maradjon; ha több az út, több sor;
   - az alatta lévő sorok, az összevont cellák (`mergeCells`), az összesítő képletek tartománya (`SUM(G16:G28)`) és a nyomtatási terület (`_xlnm.Print_Area`) eltolása;
   - az üres sorokban a képlet üres eredményt ad, nem 0-t.
5. A képletek mellé a kiszámolt érték is bekerül (`<f>` és `<v>`), és a munkafüzet `fullCalcOnLoad="1"` jelzést kap. Így az előnézet (Mail, Quick Look, Drive) is jó számot mutat, Excelben pedig élő marad a képlet.
6. A dátumok Excel-sorszámként kerülnek be, a mintasor dátumformátumával.
7. Tömörítés (`zipSync`) és letöltés Blob-bal.
8. Fájlnév: `kikuldetesi_rendelveny_<RENDSZÁM>_<monogram>_<ééééhh>.xlsx`, a mai elnevezés szerint. A monogram a magyar kettős betűket egy betűnek veszi (Kovács Zsófia → `kzs`).

A hiányzó adatok cellái üresek maradnak (D17).

**Tesztek** (`tests/business-trips-xlsx.test.ts`):

- A minta adataival kitöltve, majd kicsomagolva a cellák értéke egyezik (időszak, név, rendszám, km, végösszeg).
- 20 úttal a sorok, az összevont cellák és a `SUM` tartományok helyesen tolódnak.
- Hiányzó adószám esetén a cella üres, a fájl érvényes.
- Kézi ellenőrzés egyszer: Excel, LibreOffice, Numbers.

## 11. Szerver API

Új modulok: `server/trips.ts`, `server/trip-vehicles.ts`, `server/trip-settlements.ts`, `server/geo.ts`, `server/trip-calc.ts`. A hívható függvényeket a `server/functions.ts` exportálja újra.

**Új jogok** (`CAPABILITIES`, `SYSTEM_ROLE_DEFINITIONS`, `PermissionsSettings.svelte` csoport, locale):

| Jog | Mit enged | Alapértelmezett szerepkörök |
|---|---|---|
| `trip.record` | Saját autók, saját helyek, saját utak, saját rendelvény beküldése | employee, hr_manager, org_admin |
| `trip.approve` | Minden rendelvény megtekintése, jóváhagyás és visszaküldés | hr_manager, org_admin |
| `trip.manage` | Minden út, autó és rendelvény; más nevében rögzítés; kifizetés; visszanyitás; NAV-árak; céges helyek; beállítások | hr_manager, org_admin |

A „saját vagy HR” elérést a `work-entries.ts` mintája szerint oldjuk meg. `scope: 'mine'` esetén **a szerver maga keresi ki** a hívó dolgozói sorát. `scope: 'all'` esetén emelt jog kell. A `getLeaveRequests` mintáját (kliens által küldött `employeeId` szűrő) nem követjük.

| Függvény | Jogosultság | Leírás |
|---|---|---|
| `searchPlaces({ organizationId, query })` | `trip.record` | Legfeljebb 5 találat (`label`, `lat`, `lng`). Gyorsítótár 90 nap. |
| `calculateRoute({ organizationId, points, returnMode })` | `trip.record` | `{ km, legsKm, durationMin, geometry }`. `origin` esetén a kiindulópontot a pontsor végére teszi. Gyorsítótár 30 nap. |
| `getTripVehicles({ organizationId, scope, employeeId?, includeArchived? })` | saját: `trip.record`; mind: `trip.manage` | Az autók listája, számított fogyasztással és mértékegységgel. |
| `saveTripVehicle({ ... })` | saját vagy `trip.manage` | Felvétel vagy módosítás. Nem engedélyezett üzemanyagot elutasít. `consumption_override` csak `trip.manage` joggal. |
| `archiveTripVehicle({ id })` | saját vagy `trip.manage` | Ha nincs rá út, törli; ha van, archiválja. |
| `getTripPlaces({ organizationId, employeeId? })` | saját: `trip.record`; más dolgozóé: `trip.manage` | A céges és a saját helyek, plusz a lakcím és a munkahely. |
| `getCompanyTripPlaces({ organizationId })` | `trip.record` | Csak a céges helyek (beállítások oldal). |
| `saveTripPlace` / `deleteTripPlace` | saját; céges: `trip.manage` | |
| `getTrips({ organizationId, scope, year, month, employeeId?, vehicleId? })` | saját: `trip.record`; mind: `trip.approve` | Az utak és a sorokra számolt összegek. |
| `saveTrip({ ... })` | saját vagy `trip.manage` | A K6 ellenőrzései. A `routed_km` értéket a szerver a pontokból kéri le (gyorsítótárból), nem a klienstől fogadja el. |
| `deleteTrip({ id })` | saját vagy `trip.manage` | Csak nem zárolt hónapban. |
| `getSettlementPreview({ employeeId, vehicleId, year, month })` | saját vagy `trip.approve` | Élő számítás mentés nélkül, `warnings` listával. |
| `submitSettlement({ employeeId, vehicleId, year, month })` | saját vagy `trip.manage` | Pillanatképet készít a figyelmeztetésekkel, `submitted` állapotba teszi. A figyelmeztetések nem akadályozzák. |
| `withdrawSettlement({ id })` | saját | `submitted` → `draft`. |
| `getSettlements({ organizationId, scope, year?, month?, status?, employeeId? })` | saját: `trip.record`; mind: `trip.approve` | Lapozott lista (`PaginatedResult`), a figyelmeztetések számával. |
| `decideSettlement({ id, decision, note? })` | `trip.approve` | `approve`: bizonylatszám a számlálóból (ha még nincs), a pillanatkép frissítése, NAV-ár kötelező. Egy tranzakcióban. `return`: megjegyzés kötelező, `draft` lesz. Atomikus: `UPDATE … WHERE status='submitted' RETURNING`. |
| `setTripOrderedBy({ tripIds, orderedByUserId })` | `trip.approve` | Az elrendelő felülbírálása egy vagy több úton (D14, D21). Csak `draft` vagy `submitted` rendelvény útjain. Kitölti az `ordered_by_overridden_*` mezőket. A `orderedByUserId` a szervezet tagja kell legyen, vagy `null`. |
| `markSettlementPaid({ id, paidAt })` | `trip.manage` | `approved` → `paid`. |
| `reopenSettlement({ id, note })` | `trip.manage` | `approved` → `draft`. |
| `getSettlementDocument({ id } \| { employeeId, vehicleId, year, month })` | saját vagy `trip.approve` | A nyomtatvány és az xlsx adatai (`SettlementDocument`) a `warnings` listával. Jóváhagyott és kifizetett állapotban a pillanatképből, egyébként élő számítás. |
| `getTripMonth({ organizationId, scope, year, month, employeeId? })` | saját: `trip.record`; mind: `trip.approve` | A havi nézet: az utak, és dolgozónként + autónként a rendelvény összesítője, állapota, figyelmeztetései. |
| `getTrip({ id })` | saját vagy `trip.approve` | Egy út az útvonal-alakkal (a szerkesztő térképéhez). |
| `getSettlementPermissions({ organizationId })` | bárki | A felület gombjaihoz: `canApprove`, `canManage`, a hívó dolgozói azonosítója. |
| `getTripOrderers({ organizationId })` | `trip.record` | A szervezet aktív tagjai az elrendelő választóhoz. |
| `getFuelPrices({ organizationId, year })` / `saveFuelPrice({ ... })` | olvasás: `trip.record`; írás: `trip.manage` | Csak engedélyezett ártípus írható. |
| `getTripPolicy` / `saveTripPolicy` | olvasás: `trip.record`; írás: `trip.manage` | Kulcs: `settings:business_trip_policy:org_<id>`. |
| `previewNavFuelPrices({ organizationId, year, refresh? })` | `trip.manage` | Letölti és feldolgozza a NAV-oldalt (K14). Visszaadja a NAV-táblázatot, a hozzárendelést (a mentett vagy a javasolt), a mostani árakat a forrásukkal és a zárolt hónapokat. |
| `applyNavFuelPrices({ organizationId, year, version, mapping, overwrite })` | `trip.manage` | Egy tranzakcióban kitölti az üres hónapokat és a kijelölt eltérő árakat, a zároltakat kihagyja, és elmenti a hozzárendelést. Ha a NAV-adat közben megváltozott (`version`), hibát ad. |

**A beállítások tartalma (`getTripPolicy`)**

- `normCostPerKm`: 15.
- `documentNumberPrefix`: `'KR'` (a bizonylatszám: `<előtag>-<év>-<négyjegyű sorszám>`). Az előtag módosítása csak az ezután kiadott számokat érinti.
- `geocoder.baseUrl`: a Nominatim címe (alapértelmezés: a nyilvános szerver).
- `geocoder.countryCodes`: `'hu'`.
- `router.baseUrl`: a Valhalla címe.
- `navPriceMapping`: ártípusonként a NAV-oszlopok kulcsa elsőbbségi sorrendben (legfeljebb kettő), a legutóbbi NAV-lekérésből.

**Módosuló meglévő függvények**

- `server/employees.ts`: új `saveEmployeePersonalData({ employeeId, homeAddress, birthPlace, motherName, taxId })`, jog: `employee.manage`. A lakcímet geokódolja és visszaadja, mit talált. Az adóazonosítót `validateTaxId`-vel ellenőrzi. Az adatlap lekérése (`personal`) kiegészül az új mezőkkel, a láthatóság a mostani `canSeePersonalData` szerint.
- `server/organizations.ts`: a `createOrganization` / `updateOrganization` / lekérdezések kiegészülnek a `taxNumber` mezővel (formátumellenőrzéssel). Cím mentésekor geokódolás (hibánál figyelmeztetés, nem hiba).

**A geo modul részletei**

- User-Agent: `racona-work/<verzió>`.
- 1 kérés másodpercenként szolgáltatónként, a modul szintjén sorba állítva.
- 10 s időkorlát hívásonként.
- A gyorsítótár kulcsa a normalizált kérés hash-e (kisbetű, trimelt szöveg; a koordináták 5 tizedesre kerekítve).
- Hiba esetén magyar hibaüzenet: „Az útvonaltervező most nem érhető el. A km-t kézzel is megadhatod, indoklással.”

## 12. Felület

**Menü** (`menu.json`): a Kiküldetések csoport, `Car` ikonnal.

- **Utaim** (`BusinessTrips.svelte`, a mostani helyőrző helyén), `trip.record`.
- **Rendelvények** (`TripSettlements.svelte`), `trip.record`. HR joggal minden dolgozóé.
- **Autóim** (`TripVehicles.svelte`), `trip.record`.
- A Beállítások csoportban: **Kiküldetések** (`TripSettings.svelte`, `#settings/business-trips`), `trip.manage`. Itt vannak a NAV-árak, a céges helyek (munkahely-jelöléssel), a normaköltség és a szolgáltatók.

**`BusinessTrips.svelte` (Utaim)**

- `.page-header` „+ Új út” gombbal, hónapválasztóval és autószűrővel.
- HR-nek „Saját / Mindenki” chip és dolgozóválasztó.
- DataTable, oszlopok: dátum és idő, útvonal a kiindulóponttal együtt („Lakcím → Martonvásár, Brunszvik u. 2. ⇄”, „Munkahely → Martonvásár → Lakcím”), cél, km (eltérés esetén ikon, az indoklás tooltipben), összeg. Műveletek: szerkesztés, másolás, törlés.
- Alul autónként havi összesítő kártya és „Rendelvény beküldése” gomb, illetve a rendelvény állapota chipként.
- Hiányzó adatok esetén figyelmeztető sáv a kártya felett (K15).

**`trips/TripForm.svelte` (modal)**

- Felül az autó, a kezdete és a vége.
- Útvonal blokk: „Otthonról” / „A munkahelyről” gyorsváltó, alatta honnan, megállók, hova. Mindegyik egy `trips/PlacePicker.svelte`:
  - legördülő lista: lakcím, munkahely, mentett helyek;
  - „Keresés…” mező gombbal, 5 találattal.
- Visszaút választó: vissza a kiindulópontra / máshová (plusz egy `PlacePicker`) / csak odaút.
- Távolság blokk: tervezett km és idő, szakaszok, `trips/RouteMap.svelte` térkép, szerkeszthető „Elszámolt km”, eltérés esetén indoklásmező.
- Cél, elrendelő.
- Ha a dolgozónak nincs lakcíme, az „Otthonról” gomb le van tiltva, a magyarázata: „Nincs rögzítve lakcím. A HR tudja pótolni.”

**`trips/RouteMap.svelte`**

- `sdk.libs.maplibre` alapján (MapLibre, Marker, GeoJSONSource, LineLayer), CARTO Voyager stílus. Minta: `racona-core/examples/plugins/map-example/`.
- A Vite configban a `svelte-maplibre-gl` external lesz, vagy futásidőben olvassuk a `sdk.libs`-ből, mint a példa.
- Ha a könyvtár nem érhető el (régebbi core), a térkép helyén csak a km-adatok látszanak.

**`TripSettlements.svelte`**

- Dolgozónak a saját rendelvényei állapottal.
- HR-nek szűrők (hónap, dolgozó, állapot) és a „Jóváhagyásra vár” nézet alapértelmezésben. A listában jelölve, ha egy rendelvénynél adat hiányzik.
- A részletek nézet a nyomtatvány képernyős változata, felül a hiányzó adatok listájával és a pótlási linkekkel.
- A jóváhagyónak az elrendelő oszlop soronként szerkeszthető (tagválasztó), felette „Elrendelő minden sorra” művelet. A felülbírált sor mellett ikon, tooltipben az eredeti választás és a módosító.
- A bizonylatszám a fejlécben; jóváhagyás előtt „Jóváhagyáskor kapja”.
- Műveletek: jóváhagyás, visszaküldés, kifizetve, visszanyitás, **nyomtatás**, **xlsx letöltése**.

**Nyomtatás**

- Rejtett `iframe`-be `srcdoc`-kal betöltött HTML, `@page { size: A4 portrait }`, majd `contentWindow.print()`.
- Nem használ `innerHTML`-t vagy `document.write`-ot, így a kódellenőrzőn átmegy. Új ablakot nem nyit, és nem az egész webOS asztalt nyomtatja.
- Ugyanazt a `getSettlementDocument` adatot használja, mint az xlsx.

**`TripVehicles.svelte`**

- Kártyák vagy lista: rendszám, típus, cm³, üzemanyag, fogyasztás mértékegységgel, alapértelmezett jelölés.
- Az üzemanyag-választóban csak az engedélyezett értékek szerepelnek.
- HR-nek dolgozóválasztó.

**`EmployeeDetail.svelte`**: a „Személyes” kártyán a születési dátum sorának mintájára négy új fix sor: lakcím, születési hely, anyja neve, adóazonosító jel (K17). Üres értéknél „Nincs megadva” szöveg, szerkesztés `employee.manage` joggal.

**`Organizations.svelte`**: a „Szervezet szerkesztése” és az új szervezet ablakban a Cím alatt **Adószám** mező, a részletek nézetben is (K18).

**i18n:** `businessTrips.*`, `tripVehicles.*`, `tripSettlements.*`, `tripWarnings.*`, `capability.trip.*`, `employeeDetail.homeAddress` / `birthPlace` / `motherName` / `taxId`, `organizations.taxNumber`, hu és en.

## 13. Értesítések

A `leave-notifications.ts` mintája: csak alkalmazáson belüli értesítés, legjobb szándékkal küldve, a saját műveletről nincs értesítés.

- Beküldés → a `trip.approve` joggal rendelkezők. Ha adat hiányzik, az értesítés is jelzi („2 hiányzó adat”).
- Jóváhagyás (a bizonylatszámmal), visszaküldés, kifizetés, visszanyitás → a dolgozó.
- Az elrendelő felülbírálása → a dolgozó („A HR 3 útnál módosította az elrendelőt”), műveletenként egy értesítés, nem soronként.

E-mail: `trip_settlement_submitted`, `trip_settlement_status`, `trip_orderer_changed` sablonok, a Beállítások → Értesítések oldalon kapcsolható (specs/notifications.md, alapból ki).

## 14. Adatvédelem

**Új személyes adatok**

- Lakcím és koordinátái.
- Születési hely, anyja neve, adóazonosító jel (a cég rendelvényén szerepelnek, D16).
- Az utak helyadatai (hol járt a dolgozó, mikor).

**Hozzáférés**

- A dolgozó a sajátjait látja.
- A személyes adatokat látja: a dolgozó maga, `employee.manage`, `leave.balance.manage` (mint a születési dátumot). Szerkeszti: `employee.manage`.
- `trip.approve` / `trip.manage`: az utak és a rendelvények, a rendelvényen szereplő személyes adatokkal együtt.
- Más dolgozó nem látja őket.

**Harmadik fél**

- Címkereséskor és útvonaltervezéskor a cím, illetve a koordináta a beállított szolgáltatóhoz kerül. Nyilvános szolgáltatónál ez a FOSSGIS (Németország, EU).
- Ezt az adatkezelési tájékoztatóban szerepeltetni kell. A dolgozó neve nem kerül át, csak a cím vagy a koordináta.
- A térképcsempéket a CARTO szolgálja ki. Ő csak azt látja, melyik térképrészletet nézik, címet nem kap.
- Saját üzemeltetésű szolgáltatónál nincs adattovábbítás.

**Megőrzés**

- A jóváhagyott és kifizetett rendelvény és pillanatképe 8 évig megmarad. A dolgozó törlése ezért blokkolva van (`RESTRICT`).
- A draft utak a dolgozóval együtt törlődnek.
- A `geo_cache` személyhez nem kötött, de lakcímet tartalmazhat. 90 nap után törlődik.

## 15. Fázisok és feladatok

### 1. fázis: utak, autók, havi rendelvény ✅

- [x] Migráció `015_business_trips.sql` (táblák, új oszlopok, jogok kiosztása)
- [x] Jogok: `trip.record`, `trip.approve`, `trip.manage` (5 helyen, lásd a 11. fejezetet)
- [x] `server/trip-calc.ts` (üzemanyag-szabályok, számítás, figyelmeztetések, adóazonosító) és tesztek
- [x] `server/geo.ts`: Nominatim, Valhalla, gyorsítótár, sorba állítás, beállítható cím
- [x] Dolgozói adatlap: lakcím, születési hely, anyja neve, adóazonosító jel (K17)
- [x] Szervezet adatlapja: adószám, a cím geokódolása (K18)
- [x] Autók: szerver és `TripVehicles.svelte`
- [x] Mentett helyek, munkahely-jelölés
- [x] Utak: szerver, `BusinessTrips.svelte`, `TripForm`, `PlacePicker`, `RouteMap`
- [x] Rendelvény: előnézet, beküldés, visszavonás, jóváhagyás, visszaküldés, kifizetés, visszanyitás
- [x] Bizonylatszám-számláló jóváhagyáskor (D20); a dev adatbázison kézzel ellenőrizve, hogy két egyszerre jóváhagyott rendelvény különböző számot kap (automata teszt nincs, a szerverfüggvényekhez nincs adatbázisos tesztkörnyezet)
- [x] Az elrendelő HR-felülbírálása soronként és a rendelvény minden sorára (D14, D21)
- [x] Hiányzó adatok ellenőrzése és megjelenítése (K15)
- [x] xlsx sablon a mintából, kitöltő (`fflate`) és tesztek
- [x] Nyomtatható rendelvény
- [x] NAV-árak és beállítások (`TripSettings.svelte`)
- [x] Alkalmazáson belüli értesítések
- [x] `menu.json`: menücsoport, locale (hu, en)
- [x] A core kódellenőrzőjének mintái a buildelt `dist/`-en és a `server/`-en: tiszta (a `svelte-maplibre-gl` nincs a csomagban)
- [ ] Próbatelepítés a core-ba (valódi csomag, migráció, jogok, térkép a core-ból)

**Megvalósítás, eltérések a tervtől**

- A nyomtatvány A4 álló (a mai űrlap is az), nem fekvő.
- A szervezet adatait (cím, adószám) ma a rendszergazda szerkeszti, nem az `org.manage` jog; a figyelmeztetés is ide mutat.
- Új figyelmeztetés: `missing_consumption` — ha az autónak nincs normája (a még nem engedélyezett üzemanyagoknál egyedi érték kell), a rendelvény nem hagyható jóvá.
- A beküldött rendelvény részletei élő számításból jönnek (a HR így látja a közben pótolt adatokat és a felülbírált elrendelőt); a beküldéskori pillanatkép is megmarad. Jóváhagyás után minden a pillanatképből dolgozik (D11).
- A címkereső az azonos feliratú találatokat összevonja (a település határa és pontja ugyanaz a hely).
- A dolgozói adatlap mezőit csak szerveroldalon és fordítással ellenőriztük; a fejlesztői keret nem tud a menün kívüli adatlapra navigálni.

**Fájlok:** `migrations/015_business_trips.sql`; `server/trip-calc.ts`, `polyline.ts`, `trip-access.ts`, `trip-settings.ts`, `geo.ts`, `trip-vehicles.ts`, `trip-places.ts`, `trips.ts`, `trip-settlements.ts`, `trip-notifications.ts`; `src/components/BusinessTrips.svelte`, `TripSettlements.svelte`, `TripVehicles.svelte`, `TripSettings.svelte`, `src/components/trips/*`; `assets/templates/kikuldetesi-rendelveny.xlsx`; tesztek: `tests/business-trips.test.ts`, `tests/business-trips-xlsx.test.ts`.

### 2. fázis: kényelem és kimutatások

- [ ] Napidíj, szállásköltség, reggeli miatti levonás a sorokban (a szabályok szakmai ellenőrzés után)
- [ ] Több napra ismételt út rögzítése egy lépésben
- [ ] Hely választása kattintással a térképen (fordított geokódolás)
- [ ] HR havi összesítő (dolgozónként km és Ft), CSV a bérszámfejtésnek
- [ ] Dashboard: „Saját utak ebben a hónapban”, HR: „Jóváhagyásra váró rendelvények”
- [x] E-mail értesítések (specs/notifications.md)
- [ ] Figyelmeztetés, ha az út szabadságos napra esik
- [ ] A személyes adatok dolgozói bejelentése (a meglévő `leave_data_requests` mechanizmussal, új `kind` értékekkel), hogy a dolgozó maga kérhesse a hiányzó adatok pótlását

### 3. fázis

- [ ] Átállás a core geo szolgáltatására, ha elkészül (16. fejezet)
- [x] A NAV-árak félautomata lekérése oszlop-hozzárendeléssel (`server/nav-fuel.ts`, `server/nav-fuel-import.ts`, `NavPriceImport.svelte`, `migrations/018_fuel_price_source.sql`, teszt: `tests/nav-fuel.test.ts`). Ütemezett letöltés nem kell.
- [ ] LPG, CNG, hibrid és elektromos autók bekapcsolása (szabály, ártípus, választható érték; szakmai ellenőrzés után)

## 16. Javaslatok a core-nak

Nem feltétele az 1. fázisnak, de több plugin és a Térkép app is profitálna belőle.

1. **Geo szolgáltatás a core-ban.**
   - Szerveroldali végpont (`/api/geo/search`, `/api/geo/reverse`, `/api/geo/route`) gyorsítótárral és sorba állítással.
   - A szolgáltató címe `.env`-ből jön (`GEO_NOMINATIM_URL`, `GEO_VALHALLA_URL`).
   - Kliensoldalon `sdk.geo`, a plugin szerverfüggvényeiben `context.geo`.
   - A Térkép app is erre állna át (ma a böngészőből hívja a nyilvános szervereket, a Valhallát beégetett címmel).
2. **Külső hostok deklarálása a manifestben.** Pl. `"externalHosts": ["nominatim.openstreetmap.org"]` a `CodeScanner` literál-URL tiltása helyett. A mostani szabály kijátszható egy változóba tett URL-lel, a jogos használatot viszont megnehezíti.
3. **A `sdk.libs` dokumentálása.** A `maplibre` jelenleg nincs benne a fejlesztői dokumentációban.
4. **npm-függőség a plugin szerverkódjában.** Ma a `server/` forrásként kerül a csomagba, csak relatív importtal működik. Egy szerveroldali bundle-lépés (vagy a függőségek csomagolása) megnyitná az utat a szerveroldali fájlgenerálás előtt.

## 17. Szakmai ellenőrzést igényel

- A 60/1992. Korm. rendelet alapnorma-táblázata és sávhatárai (a fenti értékeket a hatályos szöveggel össze kell vetni).
- Az általános személygépkocsi-normaköltség aktuális összege (a mai tábla 15 Ft/km-rel számol).
- LPG, CNG, hibrid és elektromos autó: milyen normával, melyik NAV-árral és milyen mértékegységben számolható el.
- A papíralapú aláírás szükséges-e még, vagy elég az elektronikus jóváhagyás nyoma (ki és mikor)?
- Az adóazonosító jel hiánya: a jogszabály szerint kötelező tartalom. Most figyelmeztetünk (D17). Kérdés, hogy a jóváhagyást ez is blokkolja-e, mint a NAV-ár.
- Kerekítés: egész km, és a végösszeg egész forint.

## Források

- Minta rendelvény: `racona-stuff/kikuldetesi_rendelveny_MXA752_szb_202508.xlsx`
- Core Térkép app: `racona-core/apps/web/src/apps/map/index.svelte`
- SDK megosztott könyvtárak: `racona-core/packages/sdk/src/runtime/services/SharedLibrariesService.ts`
- SDK asset URL: `racona-core/packages/sdk/src/runtime/services/AssetService.ts`
- Plugin kódellenőrző: `racona-core/apps/web/src/lib/server/plugins/validation/CodeScanner.ts`
- Térképes plugin példa: `racona-core/examples/plugins/map-example/`
- fflate: https://github.com/101arrowz/fflate
- Nominatim használati szabályzat: https://operations.osmfoundation.org/policies/nominatim/
- Valhalla (FOSSGIS): https://valhalla1.openstreetmap.de
- 60/1992. (IV. 1.) Korm. rendelet: https://net.jogtar.hu/jogszabaly?docid=99200060.kor
- NAV üzemanyagárak: https://nav.gov.hu/ugyfeliranytu/uzemanyagarak
