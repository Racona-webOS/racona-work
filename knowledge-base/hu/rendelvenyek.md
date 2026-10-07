---
title: Kiküldetési rendelvények, jóváhagyás és kifizetés
category: racona-work
tags: [rendelvény, kiküldetési rendelvény, költségtérítés, km-díj, beküldés, jóváhagyás, visszaküldés, kifizetés, visszanyitás, bizonylatszám, NAV, üzemanyagár, normaköltség, nyomtatás, xlsx, céges helyek, kiküldetés beállítások]
aliases: [útelszámolás, kilométerpénz, km pénz, km-térítés, üzemanyag elszámolás, NAV ár, NAV üzemanyagár, rendelvény jóváhagyása, rendelvény kifizetése, havi rendelvény, Igazolta, Utalványozta]
last_updated: 2026-10-07
---

# Kiküldetési rendelvények, jóváhagyás és kifizetés

## Rövid összefoglaló
A kiküldetési rendelvény egy dolgozó egy autóval egy hónapban tett útjainak elszámolása. A rendelvény az utakból magától áll össze, a dolgozó beküldi, a jóváhagyó jóváhagyja, végül a pénzügy kifizetettnek jelöli. Az összeget a rendszer a NAV üzemanyagárból, az autó fogyasztási normájából és a normaköltségből számolja.

## Elérés
**Elérési út:** Work → Kiküldetések → Rendelvények, illetve Work → Kiküldetések → Utaim → **Rendelvény** gomb
**Ki használhatja:**
- **Saját utak és rendelvények:** a saját rendelvény megtekintése, beküldése, visszavonása (alapból Dolgozó, HR felelős, Szervezet adminisztrátor).
- **Rendelvények jóváhagyása:** jóváhagyás, visszaküldés, az elrendelő javítása (alapból HR felelős, Szervezet adminisztrátor).
- **Kiküldetések kezelése (mindenki útja, kifizetés, NAV-árak):** kifizetés, visszanyitás, beállítások (alapból HR felelős, Szervezet adminisztrátor).

A külsős dolgozónak nincs rendelvénye. A Racona rendszergazdája (core admin) mindent megtehet.

## A rendelvény összeállítása
Külön rendelvény készül minden dolgozónak, autónként és hónaponként. Ha valaki egy hónapban két autóval utazott, két rendelvénye lesz. A rendelvény megnyitása:
1. Work → Kiküldetések → **Utaim**, lapozz a kívánt hónapra.
2. Az autó csoportjának alján kattints a **Rendelvény** gombra.

A **Kiküldetési rendelvény** ablakban látszik a Munkáltató, a Munkavállaló, az Autó (norma és km-díj), az utak listája (Időpont, Útvonal és cél, Elrendelő, km, Összeg), alul az **Összesen**, a **Kerekítés** és a **Mindösszesen**. Beküldésig ez élő előnézet: minden új vagy módosított út azonnal megjelenik benne.

## Hiányzó adatok a rendelvényen
A rendelvény jelzi, ha hiányzik valami („Hiányzó adatok a rendelvényen:”): a dolgozó lakcíme, születési dátuma, születési helye, anyja neve, adóazonosító jele, a munkáltató címe, adószáma, vagy hogy hány útnál nincs elrendelő. Ezek nem akadályozzák a beküldést. A dolgozó ilyenkor ezt látja: „Ezeket a HR tudja pótolni.” A jogosult vezetők **pótlás** linket kapnak, ami a megfelelő oldalra visz (dolgozói adatlap, Szervezetek, Autóim, Beállítások).

Két hiány piros, mert nélkülük nincs összeg, és a rendelvény nem hagyható jóvá:
- „Az autónak nincs fogyasztási normája”: a HR az autónál egyedi fogyasztást adhat meg.
- „Nincs rögzítve NAV-ár”: a HR rögzíti a Beállítások → Kiküldetések oldalon.

## Rendelvény beküldése
1. Nyisd meg a hónap rendelvényét (Utaim → **Rendelvény**).
2. Ellenőrizd az utakat és az összeget.
3. Kattints a **Beküldés** gombra. Üzenet: „Rendelvény beküldve”.

Beküldés után az állapot **Jóváhagyásra vár**, a hónap útjai ezzel az autóval zárolódnak. A jóváhagyók értesítést kapnak. Amíg nem bírálták el, a **Beküldés visszavonása** gombbal visszavonhatod, javíthatod az utakat, majd újra beküldheted. A „Kiküldetések kezelése” joggal rendelkező más nevében is beküldheti a rendelvényt, visszavonni viszont csak a dolgozó tudja. Ha a HR-nek kell javíttatnia, a **Visszaküldés** gombbal küldi vissza, indoklással.

## A rendelvény állapotai
- **Nincs beküldve:** még nem küldték be, vagy visszavonták, visszaküldték, visszanyitották. Az utak szerkeszthetők.
- **Jóváhagyásra vár:** beküldve, az utak zárolva.
- **Jóváhagyva:** igazolva, kifizetésre vár. Ekkor kap bizonylatszámot.
- **Kifizetve:** lezárva, semmi nem módosítható.

Ha a rendelvényt visszaküldték vagy visszanyitották, az indoklás „Megjegyzés:” címmel a rendelvény tetején és az Utaim oldalon is látszik.

## Rendelvények listája
Work → Kiküldetések → **Rendelvények**. A dolgozó itt a saját, már beküldött rendelvényeit látja. A jóváhagyók és a HR alapból a **Mindenki** nézetet kapják, a **Jóváhagyásra vár** szűrővel. Szűrők: Mind, Jóváhagyásra vár, Jóváhagyva, Kifizetve, Nincs beküldve; év; dolgozó. Egy sorra kattintva nyílik meg a rendelvény.

## Jóváhagyás és visszaküldés
**Ki:** a „Rendelvények jóváhagyása” joggal rendelkezők.
1. Work → Kiküldetések → **Rendelvények**, a Jóváhagyásra vár szűrőben kattints a rendelvényre.
2. Nézd át az utakat. Ahol a km eltér a tervezettől, ott látszik az eltérés oka.
3. Szükség esetén javítsd az **Elrendelő**t soronként, vagy az **Elrendelő minden sorra:** választóval és a **Beállítás** gombbal egyszerre. A javított sor mellett „HR” jelölés látszik, és a dolgozó értesítést kap.
4. Kattints a **Jóváhagyás** gombra, vagy a **Visszaküldés** gombra. Visszaküldésnél meg kell adni az okát („Miért küldöd vissza? A dolgozó ezt látja.”).

A Jóváhagyás gomb nem működik, ha hiányzik a NAV-ár vagy a fogyasztási norma. A saját rendelvényedet nem hagyhatod jóvá és nem jelölheted kifizetettnek: ehhez másik jóváhagyó vagy a rendszergazda kell.

## Bizonylatszám
A bizonylatszámot a rendelvény jóváhagyáskor kapja, szervezetenként és évente folyamatos sorszámmal, például KR-2025-0001. Az előtag a Beállítások → Kiküldetések oldalon állítható. Előtte a rendelvényen ez áll: „bizonylatszámot jóváhagyáskor kap”. Visszanyitás után a szám megmarad, újbóli jóváhagyáskor nem kap újat.

## Kifizetés és visszanyitás
**Ki:** a „Kiküldetések kezelése (mindenki útja, kifizetés, NAV-árak)” joggal rendelkezők.
1. Nyisd meg a **Jóváhagyva** állapotú rendelvényt.
2. Állítsd be a kifizetés dátumát (alapból a mai nap, jövőbeli nem lehet).
3. Kattints a **Kifizetve** gombra. Ezután a rendelvény lezárul.

Ha egy jóváhagyott rendelvényben hibát találsz, a kifizetés előtt a **Visszanyitás** gombbal visszaállíthatod „Nincs beküldve” állapotba. Ehhez meg kell adni az okát. A dolgozó értesítést kap, javíthatja az utakat, és újra beküldheti. Kifizetett rendelvény nem nyitható vissza.

A saját rendelvényedet nem jelölheted kifizetettnek és nem nyithatod vissza: ehhez másik, „Kiküldetések kezelése” joggal rendelkező kolléga vagy a rendszergazda kell.

## Nyomtatás és xlsx letöltése
A rendelvény ablakának alján a **Nyomtatás** gomb nyomtatható (PDF-be is menthető) nézetet nyit, az **xlsx letöltése** gomb Excel-fájlt készít. A rendelvényen a kelt a beküldés napja, alul az „Igazolta” (jóváhagyó) és az „Utalványozta” (kifizetést jelölő) neve és dátuma. A jóváhagyás előtti nyomtatványon „NEM JÓVÁHAGYOTT” vízjel látszik.

## Hogyan számolódik a költségtérítés?
A km-díj képlete: **km-díj = NAV-ár × norma / 100 + általános személygépkocsi-normaköltség**.
- **NAV-ár:** az út hónapjára rögzített benzin- vagy gázolajár (Ft/l).
- **Norma:** az autó fogyasztási normája (l/100 km), a hengerűrtartalom alapján, vagy a HR által megadott egyedi érték.
- **Normaköltség:** Ft/km, alapból 15 Ft/km.

Soronként az összeg = km × km-díj, két tizedesre. A **Mindösszesen** egész forintra kerekedik, a különbség a **Kerekítés** sorba kerül.

Példa: 1600 cm³-es benzines autó (9,5 l/100 km), NAV-ár 600 Ft/l: 600 × 9,5 / 100 + 15 = 72 Ft/km. Egy 120 km-es út 8640 Ft.

Jóváhagyáskor a rendelvény tartalma rögzül, a későbbi változások (új lakcím, eladott autó) már nem írják át.

## Beállítások → Kiküldetések
**Elérési út:** Work → Beállítások → Kiküldetések (Kiküldetések beállításai)
**Ki használhatja:** a „Kiküldetések kezelése” joggal rendelkezők.

- **Költségtérítés:** a **Normaköltség (Ft/km)** és a **Bizonylatszám előtagja** (pl. KR). Mentés a **Mentés** gombbal.
- **NAV üzemanyagárak:** havi táblázat évenként (‹ › lapozás), Benzin és Gázolaj oszloppal. Az árat a cellába írva rögzítheted.
- **Céges helyek:** gyakori célok, mindenki látja őket az utak rögzítésénél. Keresd meg a címet, add meg a nevét, és mentsd. A **Legyen ez a munkahely** gombbal jelölheted meg a munkahelyet, ha az nem a szervezet címe.
- **Címkereső és útvonaltervező:** a külső szolgáltatások címe (alapból az OpenStreetMap ingyenes szerverei). Csak akkor írd át, ha saját vagy fizetős szervert használtok.

## NAV üzemanyagárak rögzítése és lekérése
A NAV havonta közzéteszi az üzemanyagárakat. Az út hónapjának ára számít, ár nélkül a rendelvény nem hagyható jóvá. Automatikus letöltés nincs, a HR rögzíti kézzel vagy lekéréssel:
1. Work → Beállítások → Kiküldetések, a NAV üzemanyagárak résznél válaszd ki az évet.
2. Kattints a **Lekérés a NAV-tól** gombra.
3. A **Melyik NAV-oszlopból töltsük ki?** résznél ártípusonként válaszd ki a **NAV-oszlop**ot és a tartalékot (**Ha abban nincs ár**). A választást a rendszer megjegyzi.
4. Nézd át az **Előnézet**et: új, egyezik, kézi, zárolt, nincs NAV-ár. Eltérő árat csak a **Felülírás** bejelölésével írunk felül.
5. Kattints a **Kitöltés** gombra.

A NAV-tól lekért árak mellett „NAV” jelölés látszik. Ha átírod, kézi ár lesz belőle. Ha egy hónapra már van jóváhagyott rendelvény, annak az ára nem módosítható.

## Gyakori kérdések
**Miért nincs összeg a rendelvényemen?** Még nincs rögzítve a hónap NAV-ára, vagy az autódnak nincs fogyasztási normája. Szólj a HR-nek.

**Hogyan módosíthatok beküldött rendelvényt?** Jóváhagyás előtt nyomd meg a Beküldés visszavonása gombot, javítsd az utakat, majd küldd be újra. Jóváhagyás után a HR-nek kell visszanyitnia.

**Miért nem tudom jóváhagyni, kifizetettnek jelölni vagy visszanyitni a saját rendelvényemet?** Saját ügyet nem bírálhatsz el. Kérj meg egy másik jóváhagyót (kifizetésnél és visszanyitásnál egy másik HR-est) vagy a rendszergazdát.

**Miért nem látom a Beküldés visszavonása gombot egy kolléga rendelvényénél?** A beküldést csak a dolgozó vonhatja vissza. Ha javítani kell, küldd vissza a rendelvényt a **Visszaküldés** gombbal, indoklással: a dolgozó értesítést kap róla.

**Kapok értesítést?** Igen. A jóváhagyók a beküldésről, a dolgozó a jóváhagyásról, visszaküldésről, kifizetésről, visszanyitásról és az elrendelő módosításáról. Az e-mail-értesítéseket a Beállítások → Értesítések oldalon lehet bekapcsolni.

**Hol adom meg a lakcímemet, adóazonosító jelemet?** Ezeket a HR rögzíti a dolgozói adatlapon (Személyes adatok). Egyik sem kötelező, a rendelvény jelzi, ha hiányzik.
