---
title: Rendelvények
description: Kiküldetési rendelvény beküldése, jóváhagyása, kifizetése, NAV-árak
sidebar:
  order: 13
---

A kiküldetési rendelvény egy dolgozó egy autóval egy hónapban tett útjainak elszámolása. Az utakból magától áll össze: a dolgozó beküldi, a jóváhagyó jóváhagyja, végül a pénzügy kifizetettnek jelöli. Az összeget a rendszer a NAV üzemanyagárból, az autó fogyasztási normájából és a normaköltségből számolja.

> **Hol találod?** **Kiküldetések → Rendelvények**, illetve **Kiküldetések → Utaim → Rendelvény** gomb.
>
> - **Saját utak és rendelvények:** a saját rendelvény megtekintése, beküldése, visszavonása.
> - **Rendelvények jóváhagyása:** jóváhagyás, visszaküldés, az elrendelő javítása (alapból HR felelős, Szervezet adminisztrátor).
> - **Kiküldetések kezelése:** kifizetés, visszanyitás, beállítások (alapból HR felelős, Szervezet adminisztrátor).

## A rendelvény megnyitása

Külön rendelvény készül minden dolgozónak, autónként és hónaponként.

1. Nyisd meg a **Kiküldetések → Utaim** oldalt, és lapozz a kívánt hónapra.
2. Az autó csoportjának alján kattints a **Rendelvény** gombra.

A rendelvényen látszik a munkáltató, a munkavállaló, az autó (norma és km-díj), az utak listája (időpont, útvonal és cél, elrendelő, km, összeg), alul az összesen, a kerekítés és a mindösszesen. Beküldésig ez élő előnézet: minden új vagy módosított út azonnal megjelenik benne.

## Hiányzó adatok

A rendelvény jelzi, ha hiányzik valami: a dolgozó lakcíme, születési adatai, anyja neve, adóazonosító jele, a munkáltató címe, adószáma, vagy hogy hány útnál nincs elrendelő. Ezek nem akadályozzák a beküldést; a jogosult vezetők **pótlás** linket kapnak, ami a megfelelő oldalra visz.

Két hiány piros, mert nélkülük nincs összeg, és a rendelvény nem hagyható jóvá:

- **Az autónak nincs fogyasztási normája:** a HR az autónál egyedi fogyasztást adhat meg.
- **Nincs rögzítve NAV-ár:** a HR rögzíti a Beállítások → Kiküldetések oldalon (lásd lejjebb).

## Beküldés

1. Nyisd meg a hónap rendelvényét (**Utaim → Rendelvény**).
2. Ellenőrizd az utakat és az összeget.
3. Kattints a **Beküldés** gombra.

Beküldés után az állapot **Jóváhagyásra vár**, a hónap útjai ezzel az autóval zárolódnak, a jóváhagyók értesítést kapnak. Amíg nem bírálták el, a **Beküldés visszavonása** gombbal visszavonhatod, javíthatod az utakat, majd újra beküldheted.

## A rendelvény állapotai

- **Nincs beküldve:** még nem küldték be, vagy visszavonták, visszaküldték, visszanyitották. Az utak szerkeszthetők.
- **Jóváhagyásra vár:** beküldve, az utak zárolva.
- **Jóváhagyva:** igazolva, kifizetésre vár. Ekkor kap bizonylatszámot.
- **Kifizetve:** lezárva, semmi nem módosítható.

Ha a rendelvényt visszaküldték vagy visszanyitották, az indoklás a rendelvény tetején és az Utaim oldalon is látszik.

## Rendelvények listája

A **Kiküldetések → Rendelvények** oldalon a dolgozó a saját, már beküldött rendelvényeit látja. A jóváhagyók és a HR alapból a **Mindenki** nézetet kapják, a **Jóváhagyásra vár** szűrővel. Szűrhetsz állapotra, évre és dolgozóra; egy sorra kattintva nyílik meg a rendelvény.

## Jóváhagyás és visszaküldés

A „Rendelvények jóváhagyása” joggal:

1. A **Rendelvények** oldalon, a Jóváhagyásra vár szűrőben kattints a rendelvényre.
2. Nézd át az utakat. Ahol a km eltér a tervezettől, ott látszik az eltérés oka.
3. Szükség esetén javítsd az elrendelőt soronként, vagy az **Elrendelő minden sorra** választóval egyszerre. A javított sor mellett „HR” jelölés látszik, és a dolgozó értesítést kap.
4. Kattints a **Jóváhagyás** vagy a **Visszaküldés** gombra. Visszaküldésnél meg kell adni az okát, a dolgozó ezt látja.

A saját rendelvényedet nem hagyhatod jóvá és nem jelölheted kifizetettnek: ehhez másik jóváhagyó vagy a rendszergazda kell.

A rendelvény jóváhagyáskor bizonylatszámot kap, szervezetenként és évente folyamatos sorszámmal (pl. KR-2025-0001). Visszanyitás után a szám megmarad.

## Kifizetés és visszanyitás

A „Kiküldetések kezelése” joggal:

1. Nyisd meg a **Jóváhagyva** állapotú rendelvényt.
2. Állítsd be a kifizetés dátumát (alapból a mai nap, jövőbeli nem lehet).
3. Kattints a **Kifizetve** gombra. Ezután a rendelvény lezárul.

Ha egy jóváhagyott rendelvényben hibát találsz, a kifizetés előtt a **Visszanyitás** gombbal visszaállíthatod „Nincs beküldve” állapotba, indoklással. Kifizetett rendelvény nem nyitható vissza.

## Nyomtatás és Excel

A rendelvény alján a **Nyomtatás** gomb nyomtatható (PDF-be is menthető) nézetet nyit, az **xlsx letöltése** gomb Excel-fájlt készít. A jóváhagyás előtti nyomtatványon „NEM JÓVÁHAGYOTT” vízjel látszik.

## Hogyan számolódik a költségtérítés?

**km-díj = NAV-ár × norma / 100 + normaköltség**

- **NAV-ár:** az út hónapjára rögzített benzin- vagy gázolajár (Ft/l).
- **Norma:** az autó fogyasztási normája (l/100 km).
- **Normaköltség:** Ft/km, alapból 15 Ft/km.

Soronként az összeg = km × km-díj. A mindösszesen egész forintra kerekedik, a különbség a kerekítés sorba kerül.

**Példa:** 1600 cm³-es benzines autó (9,5 l/100 km), NAV-ár 600 Ft/l: 600 × 9,5 / 100 + 15 = 72 Ft/km. Egy 120 km-es út 8640 Ft.

## Beállítások → Kiküldetések

> **Hol találod?** **Beállítások → Kiküldetések**. A „Kiküldetések kezelése” jog kell hozzá.

- **Költségtérítés:** a normaköltség (Ft/km) és a bizonylatszám előtagja (pl. KR).
- **NAV üzemanyagárak:** havi táblázat évenként, benzin és gázolaj oszloppal; az árat a cellába írva rögzítheted.
- **Céges helyek:** gyakori célok, mindenki látja őket az utak rögzítésénél. A **Legyen ez a munkahely** gombbal jelölheted meg a munkahelyet, ha az nem a szervezet címe.
- **Címkereső és útvonaltervező:** a külső szolgáltatások címe (alapból az OpenStreetMap ingyenes szerverei). Csak akkor írd át, ha saját vagy fizetős szervert használtok.

### NAV-árak lekérése

Ár nélkül a rendelvény nem hagyható jóvá. Automatikus letöltés nincs, a HR rögzíti kézzel vagy lekéréssel:

1. A NAV üzemanyagárak résznél válaszd ki az évet.
2. Kattints a **Lekérés a NAV-tól** gombra.
3. Ártípusonként válaszd ki, melyik NAV-oszlopból töltsön, és mi legyen a tartalék, ha abban nincs ár. A választást a rendszer megjegyzi.
4. Nézd át az előnézetet. Eltérő árat csak a **Felülírás** bejelölésével ír felül.
5. Kattints a **Kitöltés** gombra.

Ha egy hónapra már van jóváhagyott rendelvény, annak az ára nem módosítható.

## Gyakori kérdések

**Miért nincs összeg a rendelvényemen?**
Még nincs rögzítve a hónap NAV-ára, vagy az autódnak nincs fogyasztási normája. Szólj a HR-nek.

**Hogyan módosíthatok beküldött rendelvényt?**
Jóváhagyás előtt nyomd meg a **Beküldés visszavonása** gombot, javítsd az utakat, majd küldd be újra. Jóváhagyás után a HR-nek kell visszanyitnia.

**Miért nem látom a Beküldés visszavonása gombot egy kolléga rendelvényénél?**
A beküldést csak a dolgozó vonhatja vissza. Ha javítani kell, küldd vissza a rendelvényt a **Visszaküldés** gombbal, indoklással.

**Hol adom meg a lakcímemet, adóazonosító jelemet?**
Ezeket a HR rögzíti a dolgozói adatlapon (Személyes adatok).
