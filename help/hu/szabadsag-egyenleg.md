---
title: Szabadság egyenleg
description: A szervezet szabadságfelhasználása, státuszok és a felhasználási terv
sidebar:
  order: 10
---

A **Szabadság egyenleg** oldal megmutatja, hogyan használja a szervezet a szabadságkeretét az év során: mennyi szabadság maradt összesen és dolgozónként, és ki gyűjti a szabadságát év végére, illetve kinél fogy túl gyorsan. A számokat egy évenkénti felhasználási tervhez méri. A terv tájékoztató, semmit nem tilt és nem ír elő.

> **Hol találod?** **Idő és szabadság → Szabadság egyenleg**. A „Szabadságkérelmek jóváhagyása” vagy a „Szabadságkeret kezelése” jog kell hozzá (alapból HR felelős és Szervezet adminisztrátor). A saját keretét minden dolgozó az Irányítópulton látja.

## Év és szűrő

Az oldal tetején, jobbra:

- **Év:** azok az évek, amelyekre van szabadságkeret, és az idei év.
- **Munkatársak:** „Mindenki”, „Projekt nélkül” (akinek nincs futó projektje), vagy egy projekt. A **Lezárt projektek is** kapcsolóval a lezárt projektek is választhatók.

A választott szűrőt a böngésző szervezetenként megjegyzi. Az oldal tetején egy sor jelzi, melyik felhasználási terv érvényes, és mekkora a tűrés és a kritikus küszöb.

## Mutatók

- **Összesen fennmaradó:** a még ki nem vett napok összege, és a változás az előző hónap végéhez képest.
- **Munkatársak száma:** hány dolgozó szerepel, ebből hány „rendben” és hány „figyelmet igényel”.
- **Felhasználási arány:** a kivett napok aránya a keretek összegéhez.
- **Átlagos fennmaradó:** egy dolgozóra jutó fennmaradó nap, és a terv szerinti cél.

## Burn-down grafikon

A grafikon hónapról hónapra mutatja a fennmaradó szabadságnapokat: a tényleges értéket a mai napig, a terv szerinti értéket, a tűréssávot, és a lefoglalt (jóváhagyott, jövőbeli) napok levonása utáni értéket. A jobb felső sarokban egy dolgozó is választható; ugyanezt teszi, ha a táblázatban a dolgozó sorára kattintasz.

## A munkatársak táblázata

Oszlopok: Munkatárs, Projektek, Éves keret, Kivett, Lefoglalt, Fennmaradó, Tervezett (mai dátummal), Eltérés, Státusz, Trend, Műveletek.

- **Kivett:** a már elmúlt szabadságnapok.
- **Lefoglalt:** a jóváhagyott, de még jövőbeli szabadságnapok.
- **Eltérés:** a fennmaradó napok mínusz a terv szerint ma fennmaradó napok.

A **Műveletek** menüben: **Adatlap** (a dolgozó adatlapja) és **Szabadságnaptár** (a Szabadság nyilvántartó naptára erre a dolgozóra szűrve).

## Mit jelentenek a státuszok?

- **Rendben:** a dolgozó a terv szerint halad (a tűrésen belül).
- **Enyhén magas:** a szabad napjai a tűrésnél többel haladják meg a tervet, vagyis gyűjti a szabadságát.
- **Túl magas:** a kritikus küszöbnél is többel van a terv felett.
- **Gyorsan fogy:** a tűrésnél többel kevesebb szabadsága maradt, mint a terv szerint kellene.
- **Nincs keret:** a dolgozó éves kerete 0 nap.

A „magas” státuszoknál a lefoglalt napok is levonódnak, mert aki előre lefoglalta a szabadságát, az nem gyűjtöget. A „Gyorsan fogy” csak a már kivett napokat nézi. A függő kérelmek egyik státuszba sem számítanak bele.

## A felhasználási terv beállítása

> **Hol találod?** **Beállítások → Szabadság → Szabadságfelhasználási terv**. A „Szabadságkeret kezelése” jog kell hozzá.

1. Válaszd ki az évet.
2. Hónaponként add meg, hogy az éves keret hány százalékát célszerű a hónap végéig kivenni. Az érték 0 és 100 közötti egész, és nem lehet kevesebb az előző hónapnál.
3. Gyors kitöltés: **Egyenletes eloszlás**, vagy egy korábbi év tervének átvétele.
4. Add meg a **Tűrés**t és a **Kritikus küszöb**öt, mindkettőt az éves keret százalékában (alapérték: 10% és 20%).
5. Kattints a **Terv mentése** gombra.

Ha egy évnek nincs saját terve, a legutóbbi korábbi év terve érvényes, ha az sincs, az egyenletes eloszlás. Lezárt év terve nem módosítható.

## Gyakori kérdések

**Miért nem szerepel minden dolgozó?**
Csak azok, akiknek van kerete a kiválasztott évre. A táblázat alatt látszik, hánynak nincs; az [Éves szabadságkeretek](./szabadsagkeretek.md) oldalon létrehozhatod a hiányzókat.

**Exportálható az egyenleg?**
Itt nincs export. Táblázatos kimutatás a [Szabadság nyilvántartó](./szabadsag-nyilvantarto.md#összesítő-és-excel-export) oldalon tölthető le Excelbe.

**Miért „Enyhén magas” egy dolgozó, aki már beadott egy kérelmet?**
A függő kérelmek nem számítanak bele, csak a jóváhagyott napok. Jóváhagyás után a státusz frissül.

**Projektenként eltérő terv adható meg?**
Nem, a felhasználási terv céges szintű, évente egy.
