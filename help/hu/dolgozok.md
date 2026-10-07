---
title: Dolgozók
description: Dolgozói lista, új dolgozó felvétele, adatlap, kiléptetés
sidebar:
  order: 2
---

A Dolgozók menüben a szervezet dolgozóinak listája és adatlapja található. Itt veheted fel az új dolgozókat, itt kezeled az adataikat, és itt jelölheted, ha valaki külsős.

> **Hol találod?** **Dolgozók** menü. A „Dolgozók kezelése” jog kell hozzá (alapból a Szervezet adminisztrátornak és a HR felelősnek van meg).

## A dolgozói lista

A táblázatban látszik a dolgozók neve, emailje, státusza (Aktív, Inaktív, Szabadságon), szerepköre és a felvétel dátuma. A külsős dolgozó neve mellett „Külsős” jelvény áll. Kereshetsz név vagy email alapján.

Ha a dokumentumokhoz is van jogod, a listában **Dokumentumok** oszlop is van: „lejárt”, „lejáró”, „hiányzó” vagy „ellenőrzésre vár” jelvény, illetve „Rendben”. A **Csak dokumentumhiánnyal** jelölővel csak a problémás dolgozók maradnak a listában.

A sor műveleteiből nyílik a **Dolgozó adatlap**, és itt van a **Tag eltávolítása** is.

## Új dolgozó felvétele

1. Kattints az **+ Új dolgozó** gombra.
2. Válaszd ki a módját:
   - **Meglévő felhasználó összekapcsolása:** a rendszerben már létező felhasználót választod ki, és megadhatod a beosztását.
   - **Új felhasználó létrehozása:** a név és az email kötelező, a beosztás nem.
3. Mentsd.

Új felhasználónál a dolgozó üdvözlő emailt kap, benne a jelszó beállításának módjával (ha az „Üdvözlő email új dolgozónak” értesítés be van kapcsolva). Az új dolgozó automatikusan megkapja a Dolgozó szerepet.

## A dolgozó adatlapja

Az **Adatlap** fülön az **Alapadatok** (beosztás, belépés és kilépés dátuma, státusz) és a kategóriák (Személyes adatok, Munkaügyi adatok, Elérhetőségek, Egyéb) láthatók. A „Dolgozók kezelése” joggal az Alapadatoknál **Szerkesztés**, a kategóriáknál **Adat hozzáadása** gomb van.

A személyes adatokat csak a dolgozó maga és a HR látja. Az adatlapon vannak a szabadságkeret számításához szükséges adatok is (születési dátum, gyerekek, egyéb pótszabadság), lásd: [Éves szabadságkeretek](./szabadsagkeretek.md#a-keret-számításához-szükséges-adatok). A dolgozó iratait a **Dokumentumok** fül mutatja, lásd: [Dolgozói dokumentumok](./dokumentumok.md).

## Külsős dolgozó jelölése

A külsős dolgozó (pl. alvállalkozó) csak a projektekben vesz részt: projekttag lehet, munkát rögzíthet (telefonon is), és a saját dokumentumait látja. A szabadság, a kiküldetések és a többi funkció nem vonatkozik rá, és a szervezeti listákból kimarad.

1. Nyisd meg a dolgozó adatlapját.
2. Az Alapadatoknál kattints a **Szerkesztés** gombra.
3. Pipáld be a **Külsős dolgozó** jelölőt, majd mentsd.

A jelölés csak felvétel után, az adatlapon állítható. Visszavonható: a korábbi szabadság- és kiküldetési adatai megmaradnak, és újra látszanak.

## Dolgozó eltávolítása vagy kiléptetése

Dolgozót csak akkor lehet eltávolítani a szervezetből (**Tag eltávolítása**), ha nincsenek megőrzendő adatai (szabadság, munkanapló, kiküldetés, dokumentum). Ha vannak, a kilépett dolgozót az adatlapon az Alapadatoknál állítsd **Inaktív** státuszra, és add meg a kilépés dátumát.

## Gyakori kérdések

**Miért nem látom a Dolgozók menüt?**
Ehhez a „Dolgozók kezelése” jog kell (alapból a HR felelősnek és a Szervezet adminisztrátornak van meg).

**Miért nem tudom eltávolítani a kilépett dolgozót?**
Mert vannak megőrzendő adatai. Állítsd Inaktívra, és add meg a kilépés dátumát.

**Nem kapott üdvözlő emailt az új dolgozó. Miért?**
Valószínűleg ki van kapcsolva az „Üdvözlő email új dolgozónak” értesítés a [Beállítások → Értesítések](./ertesitesek.md) oldalon.
