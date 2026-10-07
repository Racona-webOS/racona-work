---
title: Dolgozói dokumentumok
description: Iratok nyilvántartása lejárattal, emlékeztetők, saját dokumentumok
sidebar:
  order: 3
---

A dolgozókhoz iratokat (munkaszerződés, orvosi alkalmassági vélemény, erkölcsi bizonyítvány stb.) lehet nyilvántartani, lejárati idővel. A lejáró és hiányzó dokumentumokat a **Dokumentumteendők** oldal gyűjti össze, a dolgozó pedig a **Saját dokumentumaim** oldalon látja a sajátjait.

> **Hol találod?**
> - A dolgozó adatlapja → **Dokumentumok** fül, és a **Dokumentumteendők** menü: „Dolgozói dokumentumok megtekintése” jog. Felvételhez, szerkesztéshez, törléshez és elbíráláshoz: „Dolgozói dokumentumok kezelése (és a típusok)” jog (alapból Szervezet adminisztrátor, HR felelős).
> - **Saját dokumentumaim** menü: „Saját dokumentumok megtekintése” jog (alapból Dolgozó, Szervezet adminisztrátor, külsős dolgozónak is).
> - **Beállítások → Dokumentumtípusok:** „Dolgozói dokumentumok kezelése” jog.

## A Dokumentumok fül

A dolgozó adatlapján a **Dokumentumok** fülön az iratok típusonként csoportosítva látszanak: megnevezés, a kiállítás vagy bemutatás napja, az érvényesség vége, az állapot (pl. „Lejárt”, „14 nap múlva lejár”, „Ma lejár”, „Fájl hiányzik”, „Ellenőrzésre vár”) és a csatolt fájlok. Fent a „Hiányzó kötelező dokumentumok:” sor mutatja, melyik kötelező típus hiányzik; rákattintva rögtön felveheted.

## Dokumentum felvétele

1. A **Dokumentumok** fülön kattints a **+ Dokumentum** gombra.
2. Add meg a típust, a megnevezést, a kiállítás napját és az érvényesség végét. Ha a típusnak van alapértelmezett érvényessége, a rendszer kiszámolja; átírhatod. Ha kell, írj megjegyzést.
3. **Fájlok kiválasztása:** PDF, kép (JPG, PNG, WEBP), Word, Excel vagy OpenDocument; fájlonként legfeljebb 10 MB, dokumentumonként legfeljebb 5 fájl.
4. Mentsd.

Fájl nélküli típusnál (pl. Erkölcsi bizonyítvány) nincs fájlválasztó: csak a bemutatás napja és az érvényesség kerül be.

## Szerkesztés, új verzió, törlés

- **Szerkesztés:** az adatok javítása.
- **Új verzió:** ha a dolgozó új iratot hozott (pl. megújított orvosi alkalmassági véleményt), a régi „Korábbi verzió” lesz, és már nem kap emlékeztetőt. A **Korábbi verziók** jelölővel ezek is megjeleníthetők.
- **Törlés:** a dokumentum a csatolt fájlokkal együtt véglegesen törlődik.
- A fájlnévre kattintva megnyílik (PDF, kép), a **Letöltés** gombbal letöltheted.
- A fül alján a **Napló** mutatja, ki mikor mit csinált (felvétel, megnyitás, letöltés, törlés).

## Dokumentumteendők

A **Dokumentumteendők** oldal a szervezet aktív dolgozóinak lejárt, hamarosan lejáró és hiányzó dokumentumait gyűjti egy listába. Szűrők: Mind, Lejárt, Hamarosan lejár, Hiányzik, Fájl hiányzik, Ellenőrzésre vár; kereshetsz név vagy típus alapján. A sorra kattintva a dolgozó adatlapja nyílik meg. Röviden ugyanez az Irányítópulton is látszik, a „Dokumentumteendők” kártyán.

## Lejárati emlékeztetők

A rendszer minden reggel ellenőrzi a lejáró dokumentumokat, és a típusnál megadott napokkal a lejárat előtt (alapból 30 és 7 nappal), valamint a lejárat napján értesítést küld:

- a dokumentumokat kezelőknek (HR) rendszeren belüli értesítést és napi összesítő emailt;
- a dolgozónak rendszeren belüli értesítést, ha a típust látja (emailt csak akkor, ha a „Lejáró saját dokumentum” email be van kapcsolva).

Inaktív (kilépett) dolgozóra és korábbi verzióra nem megy emlékeztető.

## Saját dokumentumaim

A **Saját dokumentumaim** oldalon a nálad nyilvántartott, neked látható dokumentumokat nézheted meg és töltheted le.

Ha a szervezet engedi, a **Dokumentum feltöltése** gombbal te magad is feltölthetsz iratot (legalább egy fájl kell). Ez „Ellenőrzésre vár” állapotba kerül, és a HR elbírálja. A függő feltöltést a **Visszavonás** gombbal visszavonhatod, az elutasítottat törölheted; az elutasítás indoklását látod.

## Feltöltött dokumentum elbírálása (HR)

A dolgozó által feltöltött iratnál a HR a **Dokumentumok** fülön az **Elbírálás** gombot látja. Az ablakban a dátumok javíthatók, majd **Elfogadás** vagy **Elutasítás**. Elutasításnál az indoklás kötelező. Elfogadáskor az új irat a típus korábbi dokumentumának helyére lép.

## Dokumentumtípusok beállítása

> **Hol találod?** **Beállítások → Dokumentumtípusok**

Alapból ezek a típusok vannak: Munkaszerződés (kötelező), Munkaköri leírás, Orvosi alkalmassági vélemény (kötelező, 12 hónapig érvényes), Erkölcsi bizonyítvány (fájl nélkül, lejár), Végzettséget igazoló okirat, Egyéb.

Az **+ Új típus** vagy a **Szerkesztés** gombbal ezeket adhatod meg: név, leírás, fájl (Fájl kötelező / Fájl opcionális / Nincs fájl), van-e lejárata, alapértelmezett érvényesség (hónap), emlékeztetők (hány nappal előtte, vesszővel, pl. 30, 7), minden dolgozónak kötelező-e, a dolgozó látja-e a saját dokumentumát, és feltöltheti-e maga.

Az oldal tetején kapcsolható be: **A dolgozók is feltölthetnek dokumentumot** (alapból ki). A még nem használt típus törölhető, a használt típus csak **Archiválás**-sal vonható ki, és **Visszaállítás**-sal hozható vissza.

## Gyakori kérdések

**Miért nem látom a Dokumentumok fület az adatlapon?**
Ehhez a „Dolgozói dokumentumok megtekintése” vagy „kezelése” jog kell; a „Dolgozók megtekintése” jog nem elég.

**Hogyan rögzítem az erkölcsi bizonyítványt másolat nélkül?**
Válaszd az Erkölcsi bizonyítvány típust: ehhez nem tartozik fájl, csak a bemutatás napját és az érvényességet rögzíted.

**Miért nem tudok dokumentumot feltölteni a Saját dokumentumaim oldalon?**
A feltöltést a HR-nek kell engedélyeznie a Dokumentumtípusok oldalon, a szervezetre és az adott típusra is.
