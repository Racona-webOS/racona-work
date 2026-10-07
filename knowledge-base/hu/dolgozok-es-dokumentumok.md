---
title: Dolgozók és dolgozói dokumentumok
category: racona-work
tags: [dolgozó, dolgozók, adatlap, új dolgozó, felvétel, külsős, külsős dolgozó, dokumentum, dokumentumok, lejárat, lejáró dokumentum, hiányzó dokumentum, dokumentumtípus, feltöltés, munkaszerződés, orvosi alkalmassági, erkölcsi bizonyítvány, inaktív]
aliases: [munkavállaló, kolléga, alvállalkozó, szerződéses, iratok, papírok, HR iratok, személyi anyag, orvosi, alkalmassági, dokumentumteendők, saját dokumentumaim]
last_updated: 2026-10-07
---

# Dolgozók és dolgozói dokumentumok

## Rövid összefoglaló
A Dolgozók menüben a szervezet dolgozóinak listája és adatlapja található. Itt lehet új dolgozót felvenni, a dolgozót külsősnek jelölni, és a dolgozókhoz iratokat (munkaszerződés, orvosi alkalmassági vélemény, erkölcsi bizonyítvány stb.) nyilvántartani lejárati idővel. A lejáró és hiányzó dokumentumokat a Dokumentumteendők oldal gyűjti össze, a dolgozó pedig a Saját dokumentumaim oldalon látja a sajátjait.

## Elérés
**Elérési út:** Work → Dolgozók; Work → Dokumentumteendők; Work → Saját dokumentumaim; Work → Beállítások → Dokumentumtípusok
**Ki használhatja:**
- Dolgozók lista, dolgozó felvétele és szerkesztése: „Dolgozók kezelése” jog (alapból Szervezet adminisztrátor, HR felelős).
- Dokumentumok fül és Dokumentumteendők: „Dolgozói dokumentumok megtekintése”; felvétel, szerkesztés, törlés és elbírálás: „Dolgozói dokumentumok kezelése (és a típusok)” (alapból Szervezet adminisztrátor, HR felelős).
- Saját dokumentumaim: „Saját dokumentumok megtekintése” (alapból Dolgozó, Szervezet adminisztrátor; külsős dolgozónak is).

## Dolgozók lista
A Work → Dolgozók oldalon táblázatban látszanak a dolgozók: Név, Email, Státusz (Aktív, Inaktív, Szabadságon), Szerepkör, Felvétel dátuma. A külsős dolgozó neve mellett „Külsős” jelvény áll. Kereshetsz név vagy email alapján.

Ha dokumentumokhoz is van jogod, a listában Dokumentumok oszlop is van: „lejárt”, „lejáró”, „hiányzó” vagy „ellenőrzésre vár” jelvény, illetve „Rendben”. A „Csak dokumentumhiánnyal” jelölővel csak a problémás dolgozók maradnak a listában.

A sor műveleteiből nyílik a **Dolgozó adatlap**, illetve itt van a **Tag eltávolítása** is.

## Új dolgozó felvétele
1. Work → Dolgozók → **+ Új dolgozó**.
2. Válassz:
   - **Meglévő felhasználó összekapcsolása**: a rendszerben már létező felhasználót választod ki, és megadhatod a Beosztást.
   - **Új felhasználó létrehozása**: Név és Email kötelező, Beosztás nem kötelező.
3. Mentés.

Új felhasználónál a dolgozó üdvözlő emailt kap, benne a jelszó beállításának módjával (ha az „Üdvözlő email új dolgozónak” értesítés be van kapcsolva). Az új dolgozó automatikusan megkapja a Dolgozó szerepet.

## Dolgozó adatlap
Az adatlap „Adatlap” fülén az **Alapadatok** (Beosztás, Belépés dátuma, Kilépés dátuma, Státusz) és a kategóriák (Személyes adatok, Munkaügyi adatok, Elérhetőségek, Egyéb) láthatók. A „Dolgozók kezelése” joggal az Alapadatoknál **Szerkesztés**, a kategóriáknál **Adat hozzáadása** gomb van. A személyes adatokat csak a dolgozó maga és a HR látja.

## Dolgozó eltávolítása vagy kiléptetése
Dolgozó csak akkor távolítható el a szervezetből (Tag eltávolítása), ha nincsenek megőrzendő adatai (szabadság, munkanapló, kiküldetés, dokumentum). Ha vannak, a kilépett dolgozót az adatlapon az Alapadatoknál állítsd **Inaktív** státuszra, és add meg a Kilépés dátumát.

## Külsős dolgozó jelölése
Külsős dolgozó (pl. alvállalkozó) csak a projektekben vesz részt: projekttag lehet, munkát rögzíthet, és a saját dokumentumait látja. A szabadság, a kiküldetések és a többi funkció nem vonatkozik rá, és a szervezeti listákból kimarad.

1. Nyisd meg a dolgozó adatlapját.
2. Alapadatok → **Szerkesztés**.
3. Pipáld be a **Külsős dolgozó** jelölőt, majd Mentés.

A jelölés csak felvétel után, az adatlapon állítható. Visszavonható: a korábbi szabadság- és kiküldetési adatai megmaradnak, és újra látszanak. A külsős dolgozó Irányítópultján „Külsős dolgozó vagy” tájékoztatás és **Projektjeim megnyitása** gomb jelenik meg.

## Dolgozói dokumentumok: Dokumentumok fül
A dolgozó adatlapján a **Dokumentumok** fülön a dolgozó iratai típusonként csoportosítva látszanak: megnevezés, kiállítás vagy bemutatás napja, érvényesség vége, állapot (pl. „Lejárt”, „14 nap múlva lejár”, „Ma lejár”, „Fájl hiányzik”, „Ellenőrzésre vár”), és a csatolt fájlok. Fent a „Hiányzó kötelező dokumentumok:” sor mutatja, melyik kötelező típus hiányzik; rákattintva rögtön felveheted.

Dokumentum felvétele („Dolgozói dokumentumok kezelése” joggal):
1. Dokumentumok fül → **+ Dokumentum**.
2. Add meg a Típust, a Megnevezést, a Kiállítás napját és az Érvényesség végét (ha a típusnak van alapértelmezett érvényessége, ezt a rendszer kiszámolja; átírhatod), és ha kell, Megjegyzést.
3. **Fájlok kiválasztása**: PDF, kép (JPG, PNG, WEBP), Word, Excel vagy OpenDocument; fájlonként legfeljebb 10 MB, dokumentumonként 5 fájl.
4. Mentés.

Fájl nélküli típusnál (pl. Erkölcsi bizonyítvány) nincs fájlválasztó: csak a bemutatás napja és az érvényesség kerül be.

## Dokumentum szerkesztése, új verzió, törlés
- **Szerkesztés**: az adatok javítása.
- **Új verzió**: ha a dolgozó új iratot hozott (pl. megújított orvosi alkalmassági), a régi „Korábbi verzió” lesz, és már nem kap emlékeztetőt. A **Korábbi verziók** jelölővel ezek is megjeleníthetők.
- **Törlés**: a dokumentum a csatolt fájlokkal együtt véglegesen törlődik.
- Fájlnév kattintás: megnyitás (PDF, kép); **Letöltés**: letöltés.
- A fül alján a **Napló** mutatja, ki mikor mit csinált (felvétel, megnyitás, letöltés, törlés).

## Dokumentumteendők oldal
A Work → Dokumentumteendők oldal a szervezet aktív dolgozóinak lejárt, hamarosan lejáró és hiányzó dokumentumait gyűjti egy listába. Szűrők: Mind, Lejárt, Hamarosan lejár, Hiányzik, Fájl hiányzik, Ellenőrzésre vár; kereshetsz név vagy típus alapján. A sorra kattintva a dolgozó adatlapja nyílik meg. Ugyanez röviden az Irányítópulton is látszik egy „Dokumentumteendők” kártyán.

## Lejárati emlékeztetők
Lejáró dokumentumoknál a rendszer minden reggel ellenőriz, és a típusnál megadott napokkal a lejárat előtt (alapból 30 és 7 nappal), valamint a lejárat napján értesítést küld:
- a dokumentumokat kezelőknek (HR) rendszeren belüli értesítést és napi összesítő emailt;
- a dolgozónak rendszeren belüli értesítést, ha a típust látja (emailt csak akkor, ha a „Lejáró saját dokumentum” email be van kapcsolva).

Inaktív (kilépett) dolgozóra és korábbi verzióra nem megy emlékeztető.

## Saját dokumentumaim
A Work → Saját dokumentumaim oldalon a dolgozó a nála nyilvántartott, neki látható dokumentumokat nézheti meg és töltheti le. Ha a szervezet engedi, **Dokumentum feltöltése** gombbal maga is feltölthet iratot (legalább egy fájl kell); ez „Ellenőrzésre vár” állapotba kerül, és a HR elbírálja. A függő feltöltést a dolgozó **Visszavonás** gombbal visszavonhatja, az elutasítottat törölheti; az elutasítás indoklását látja.

## Feltöltött dokumentum elbírálása
A dolgozó által feltöltött iratnál a HR a Dokumentumok fülön az **Elbírálás** gombot látja. Az ablakban a dátumok javíthatók, majd **Elfogadás** vagy **Elutasítás**. Elutasításnál az indoklás kötelező. Elfogadáskor az új irat a típus korábbi dokumentumának helyére lép.

## Dokumentumtípusok beállítása
Work → Beállítások → Dokumentumtípusok („Dolgozói dokumentumok kezelése” joggal). Alapból: Munkaszerződés (kötelező), Munkaköri leírás, Orvosi alkalmassági vélemény (kötelező, 12 hónapig érvényes), Erkölcsi bizonyítvány (fájl nélkül, lejár), Végzettséget igazoló okirat, Egyéb.

**+ Új típus** vagy **Szerkesztés**: Név, Leírás, Fájl (Fájl kötelező / Fájl opcionális / Nincs fájl), Van lejárata, Alapértelmezett érvényesség (hónap), Emlékeztetők (nappal előtte, vesszővel, pl. 30, 7), Minden dolgozónak kötelező, A dolgozó látja a saját dokumentumát, A dolgozó maga is feltöltheti.

Az oldal tetején kapcsolható be: **A dolgozók is feltölthetnek dokumentumot** (alapból ki). Dokumentum nélküli típus törölhető, a használt típus csak **Archiválás**-sal vonható ki, és **Visszaállítás**-sal hozható vissza.

## Gyakori kérdések
**Miért nem látom a Dolgozók menüt?** Ehhez „Dolgozók kezelése” jog kell (alapból HR felelős és Szervezet adminisztrátor).

**Miért nem látom a Dokumentumok fület az adatlapon?** Ehhez „Dolgozói dokumentumok megtekintése” vagy „kezelése” jog kell; a „Dolgozók megtekintése” jog nem elég.

**Hogyan rögzítem az erkölcsi bizonyítványt másolat nélkül?** Válaszd az Erkölcsi bizonyítvány típust: ehhez nem tartozik fájl, csak a bemutatás napját és az érvényességet rögzíted.

**Miért nem tudok dokumentumot feltölteni a Saját dokumentumaim oldalon?** A feltöltést a HR-nek kell engedélyeznie a Dokumentumtípusok oldalon, a szervezetre és az adott típusra is.

**Miért nem tudom eltávolítani a kilépett dolgozót?** Mert vannak megőrzendő adatai. Állítsd Inaktívra, és add meg a Kilépés dátumát.
