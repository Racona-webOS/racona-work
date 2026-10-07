---
title: Értesítések
description: Email értesítések be- és kikapcsolása, válaszcím, címzettek
sidebar:
  order: 14
---

A Work az eseményekről (szabadságkérelem, dokumentum lejárata, hiányzó munkanapló stb.) rendszeren belüli értesítést küld, és sok eseményről emailt is. A szervezet eseményenként eldöntheti, menjen-e email, és megadhat válaszcímet.

> **Hol találod?** **Beállítások → Értesítések** (az oldal címe: Email értesítések). A „Szervezet adatainak kezelése” jog kell hozzá (alapból a Szervezet adminisztrátornak van meg).

## Email értesítések beállítása

1. Nyisd meg a **Beállítások → Értesítések** oldalt.
2. Csoportonként (Szabadság, Dolgozók, Dokumentumok, Kiküldetések, Munkanapló) minden eseménynél egy kapcsoló van. Az esemény alatt a „Címzett:” sor mutatja, ki kapja az emailt.
3. Kapcsold be vagy ki a kívánt eseményeket, majd kattints a **Mentés** gombra.

A beállítás az egész szervezetre vonatkozik. A rendszeren belüli értesítések ettől függetlenül mindig megjelennek, csak az email kapcsolható ki. Aki a műveletet végzi, a saját lépéséről nem kap emailt. Személyes, dolgozónkénti leiratkozás nincs.

## Válaszcím (Reply-To)

Minden csoportnál megadható egy **Válaszcím (Reply-To)**: erre a címre érkeznek a válaszok, ha a címzett válaszol a levélre (pl. hr@ceg.hu a Szabadság csoportnál). Egyetlen címet adj meg, név nélkül. Üresen a rendszer alapértelmezett címe érvényes.

## Milyen emailek vannak?

**Szabadság.** Alapból bekapcsolva: új szabadságkérelem, a kérelem jóváhagyása vagy elutasítása, kérelem vagy jóváhagyott szabadság törlése, naptárban rögzített vagy törölt szabadság, kötelező szabadság kiírása, a havi szabadság-ellenőrzés kiküldése, emlékeztetője és zárása, eltérés a havi összesítőben. Alapból kikapcsolva: a kérelem visszavonása, új adatbejelentés, adatbejelentés elbírálása, havi ellenőrzés lezárása elfogadás nélkül.

**Dolgozók és dokumentumok.**

- Üdvözlő email új dolgozónak (alapból be): az új dolgozó kapja a felvételekor, a jelszó beállításához.
- Lejáró és lejárt dokumentumok, napi összesítő (alapból be): a dokumentumokat kezelők (HR).
- Lejáró saját dokumentum (alapból ki): a dolgozó, ha a dokumentum típusa látható neki.
- Dolgozó dokumentumot töltött fel ellenőrzésre (alapból ki): a HR.
- Döntés a feltöltött dokumentumról (alapból ki): a feltöltő dolgozó.

**Kiküldetések** (alapból mind ki): beküldött rendelvény (a jóváhagyóknak), a rendelvény jóváhagyása, visszaküldése, kifizetése, visszanyitása (a dolgozónak), az elrendelő módosítása (az érintett dolgozónak).

**Munkanapló** (alapból mind be): hiányzó bejegyzés (esti emlékeztető a dolgozónak), pótolatlan bejegyzések (eszkaláció a megadott címekre). Ezek csak akkor mennek ki, ha a [munkanapló-figyelés](./munkanaplo.md#hiányzó-bejegyzések-figyelése) be van kapcsolva.

## Ki kapja az értesítéseket?

A címzettek nem itt állíthatók be, hanem az eseményből adódnak:

- új szabadságkérelem és visszavonás: a **Beállítások → Szabadság** oldalon kijelölt dolgozók;
- döntések, törlések, havi összesítő: az érintett dolgozó;
- dokumentumok lejárata és feltöltése: a „Dolgozói dokumentumok kezelése” joggal rendelkezők;
- rendelvények: a „Rendelvények jóváhagyása” joggal rendelkezők;
- munkanapló-eszkaláció: a **Beállítások → Munkanapló** oldalon megadott email címek.

Külsős dolgozó a szabadság- és kiküldetés-értesítések címzettjei közül kimarad. Email cím nélküli felhasználó csak rendszeren belüli értesítést kap.

## Gyakori kérdések

**Miért nem kapok emailt egy eseményről?**
Lehet, hogy az adott esemény emailje ki van kapcsolva, vagy te végezted a műveletet. A rendszeren belüli értesítés ilyenkor is megjelenik.

**Kikapcsolhatom magamnak az emaileket?**
Nem, a beállítás az egész szervezetre vonatkozik; a szervezet adminisztrátora állíthatja.

**Hova mennek a válaszok, ha valaki válaszol az értesítő emailre?**
A csoporthoz megadott válaszcímre, ha nincs megadva, a rendszer alapértelmezett címére.
