---
title: Szabadság nyilvántartó és szabadságnaptár
category: racona-work
tags: [szabadság nyilvántartó, szabadságnaptár, naptár, kérelmek listája, csapatnézet, éves nézet, szabadság rögzítése, szabadság törlése, szabadságnapok, összesítő, export, xlsx, excel, ki van szabadságon]
aliases: [szabadságnaptár, ki van szabin, távollétek, szabadságok listája, csapatnaptár, szabadság excel, szabadság kimutatás, hr naptár]
last_updated: 2026-10-07
---

# Szabadság nyilvántartó és szabadságnaptár

## Rövid összefoglaló
A Szabadság nyilvántartó oldalon két rész van: a **Kérelmek** listája és alatta a **Naptár**. A dolgozó itt látja a saját kérelmeit és azt, hogy a kollégák közül ki mikor van távol. A HR itt bírálja el a kérelmeket, a naptárban közvetlenül rögzíthet vagy törölhet szabadságnapokat, és táblázatos összesítőt menthet Excelbe.

## Elérés
**Elérési út:** Work → Idő és szabadság → Szabadság nyilvántartó
**Ki használhatja:** a „Szabadságkérelem beadása” joggal rendelkezők. A HR-funkciókhoz (jóváhagyás, rögzítés a naptárban, összesítő) a „Szabadságkérelmek jóváhagyása” jog kell. Külsős dolgozóknak az oldal nem érhető el.

A „Kérelmek” és a „Naptár” rész a címükre kattintva összecsukható, a böngésző megjegyzi a beállítást.

## A Kérelmek lista
A jóváhagyó a lista fölött válthat a **Saját** és az **Összes** nézet között; a dolgozó csak a saját kérelmeit látja. Oszlopok: Dolgozó, Típus, Kezdő dátum, Záró dátum, Napok, Ebből érvényes, Státusz, Rögzítve.
- **Napok:** a beadáskor kért munkanapok száma.
- **Ebből érvényes:** hány nap tartozik ma ténylegesen a jóváhagyott kérelemhez. Ha kevesebb, kiemelve látszik: a HR a naptárban törölt belőle napot.
- **Státusz:** Függőben, Jóváhagyva, Elutasítva, Visszavonva.
- **Rögzítve:** a beadás dátuma és ideje.

A sor műveletei: függő kérelemnél Jóváhagyás és Elutasítás (jóváhagyónak), saját függő kérelemnél Visszavonás, jóváhagyott kérelemnél Törlés (jóváhagyónak).

## A szabadságnaptár nézetei
A naptár fölött a lapozó (előző, következő, **Ma**) és a nézetváltó van:
- **Hónap:** havi rács. Szűrő nélkül minden napon a távol lévők neve (legfeljebb három, utána „+N”).
- **Év:** tizenkét kis havi rács; szűrő nélkül a napon a távol lévők száma.
- **Csapat:** a hónap napjai oszloponként, soronként egy dolgozó, a sor végén a hónap szabadságnapjainak száma. Csak olvasásra.

A szürke nap nem munkanap, a halvány, szaggatott jelölés függő kérelem. Egy napra kattintva felugró doboz mutatja a nap összes bejegyzését; Escape-pel vagy mellé kattintva bezárul.

## Ki mit lát a szabadságnaptárban
- **Dolgozó:** látja, ki mikor van szabadságon, de a kollégák szabadságának típusát nem (a betegszabadság egészségügyi adat). Függő kérelmekből csak a sajátjait látja.
- **Jóváhagyó (HR):** minden szabadságot típussal lát, a **Dolgozó** szűrővel egy dolgozóra szűrhet, ilyenkor a napok típusonként színezve, jelmagyarázattal látszanak.

## Szabadság rögzítése és törlése a naptárban (HR)
**Ki teheti:** a „Szabadságkérelmek jóváhagyása” joggal rendelkezők.
1. A naptár fölötti **Dolgozó** mezőben válaszd ki a dolgozót (Hónap vagy Év nézetben).
2. A **Felvett napok típusa** mezőben válaszd ki a típust. Itt minden típus választható, a Céges kötelező szabadság is; apasági és szülői szabadságnál a gyereket is.
3. Üres munkanapra kattintva a nap **Felveendő** lesz, meglévő szabadságnapra kattintva **Törlendő**. Újabb kattintás visszavonja a jelölést.
4. Az alsó sáv mutatja: „N nap felvétele M kérelemben”, „K nap törlése”, és éves szabadságnál a keretet a módosítás után. Indoklás is adható.
5. Kattints a **Mentés** gombra, vagy az **Elvetés** gombbal dobd el a jelöléseket.

A felvett napokból összefüggő szakaszonként egy-egy, rögtön jóváhagyott kérelem készül. A napok törlése nem változtatja meg az eredeti kérelmet, csak az „Ebből érvényes” szám csökken. A dolgozó értesítést kap a felvett és a törölt napokról. Függő kérelem napjára és nem munkanapra nem lehet jelölni. A saját naptáradat így nem szerkesztheted: magadnak az „Új szabadság” gombbal kérj.

## Jóváhagyott szabadság törlése a listából
A „Kérelmek” listában a jóváhagyott kérelem sorában a **Törlés** művelet a kérelmet és minden napját törli, a keret visszaáll, a dolgozó értesítést kap. Lejárt szabadságnál a rendszer külön rákérdez, hogy biztosan visszamenőleg törlöd-e. Ha csak néhány napot kell kivenni, azt a naptárban tedd meg.

## Összesítő táblázat és Excel export
A jóváhagyó a naptár alatt „Összesítő – {időszak}” táblázatot lát dolgozónként: a szabadságnapok típusonként, Összesen és a Függő napok. Éves nézetben az Éves keret és a Maradék is látszik. A Dolgozó szűrő a táblázatra is vonatkozik. Az **Export (XLSX)** gomb ugyanezt Excel-fájlba menti (pl. szabadsagok-2026-09.xlsx, éves nézetben szabadsagok-2026.xlsx).

## Gyakori kérdések
**Miért nem látom a kollégám szabadságának típusát?** A típust csak a jóváhagyók látják, a dolgozók csak azt, hogy a kolléga távol van.

**Miért nem tudok a naptárban napot felvenni?** Szerkeszteni csak jóváhagyóként, kiválasztott dolgozóval, Hónap vagy Év nézetben lehet. Lezárt vagy még meg nem nyitott évben nem lehet rögzíteni.

**Miért kevesebb az „Ebből érvényes”, mint a „Napok”?** A HR a naptárban törölt napokat a kérelemből. Ha több, akkor a munkanaptár változott a beadás óta.

**HR felelős vagyok, mégis hibát kapok az oldalon.** Az oldal a „Szabadságkérelem beadása” jogot is igényli, ami a HR felelős szerepben alapból nincs benne. Kérd, hogy a Dolgozó szerepet is megkapd.
