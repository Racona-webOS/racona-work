---
title: Éves szabadságkeretek
description: A keret számítása, létrehozása, korrekciója, áthozott napok, évnyitás és évzárás
sidebar:
  order: 9
---

Az éves szabadságkeret azt mutatja, hány nap szabadság jár egy dolgozónak egy naptári évre. A Work a dolgozó adataiból a Munka törvénykönyve szerint kiszámolja a keretet, amit a HR indoklással korrigálhat. Egy év szabadságkezelése az évnyitással indul, a maradék napok áthozhatók a következő évre, a lezárt évre pedig már nem lehet szabadságot rögzíteni.

> **Hol találod?**
> - **Idő és szabadság → Éves szabadságkeretek:** egy év kereteinek létrehozása egyben.
> - **Dolgozók → a dolgozó neve → Szabadságkeret** kártya: dolgozónként.
> - **Idő és szabadság → Munkanaptár:** évnyitás és évzárás.
>
> A „Szabadságkeret kezelése” jog kell hozzá (alapból HR felelős és Szervezet adminisztrátor). A dolgozó a saját keretét az Irányítópulton látja; a **Hogyan jön ki?** gombbal a bontást is.

## Hogyan számolódik a keret?

A számított keret tételei (Mt. 116–120. §):

- **Alapszabadság:** 20 munkanap.
- **Életkor szerinti pótszabadság:** 25 évesen +1, 28 évesen +2, 31 évesen +3, 33 évesen +4, 35 évesen +5, 37 évesen +6, 39 évesen +7, 41 évesen +8, 43 évesen +9, 45 évestől +10 nap. Az számít, hány éves lesz a dolgozó az adott évben.
- **Gyermek után:** 16 évesnél fiatalabb gyerek után 1 gyereknél +2, 2 gyereknél +4, kettőnél több gyereknél összesen +7 nap. Fogyatékos gyermekenként további +2 nap.
- **Fiatal munkavállaló:** +5 nap, utoljára abban az évben, amelyben a dolgozó betölti a 18. évét.
- **Egyéb pótszabadság:** egészségkárosodás (+5), föld alatti munka / ionizáló sugárzás (+5), vagy egyedi, céges megállapodás szerinti napok.
- **Céges többletnap:** ha a kollektív szerződés vagy belső szabályzat többet ad, minden dolgozó keretébe bekerül (**Beállítások → Szabadság → Céges többletnap**).
- **Arányosítás:** év közbeni belépésnél vagy kilépésnél a munkaviszonyban töltött napok arányában jár a keret; a fél napot elérő töredék egész napnak számít. A nem munkában töltött időszakok (pl. fizetés nélküli szabadság) arányosan csökkentik a keretet.

**Példa:** 39 éves dolgozó, egy 14 éves gyerekkel, március 1-jén lépett be: 20 + 7 + 2 = 29 nap teljes évre, arányosítva 24 nap.

## A keret számításához szükséges adatok

A HR a dolgozó adatlapján rögzíti (**Dolgozók → a dolgozó neve**):

- **Születési dátum:** a Személyes adatok kártyán.
- **Belépés és kilépés dátuma:** az Alapadatok kártyán. Ha a belépés dátuma nincs ellenőrizve, a Work figyelmeztet; ellenőrizd, és kattints „A dátum helyes” gombra, mert ettől függ az arányosítás.
- **Szabadság-adatok** kártya: gyerekek (születési dátum, fogyatékos gyermek, örökbefogadás napja), egyéb pótszabadság (jogcím, érvényesség), nem munkában töltött időszakok.

A dolgozó maga is bejelentheti a változást az Irányítópulton, az „Adataim a szabadságkerethez” dobozban a **Változás bejelentése** gombbal; a HR jóváhagyása után frissül a kerete.

## Keretek létrehozása egyszerre

1. Nyisd meg az **Idő és szabadság → Éves szabadságkeretek** oldalt.
2. Válaszd ki az évet (tavaly, idén vagy jövőre; novembertől alapból a jövő év látszik).
3. A táblázatban azok az aktív dolgozók szerepelnek, akiknek még nincs kerete az évre: előző évi keret és maradék, számított, áthozott, határidő, korrekció, indoklás, összesen.
4. A **Figyelmeztetéssel** szűrővel megnézheted, kinél hiányzik adat (pl. nincs születési dátum).
5. A számított értékre kattintva látod a bontást.
6. Szükség szerint írd át az áthozott napokat és a korrekciót. Korrekcióhoz indoklás kell.
7. Pipáld ki, kiknek készüljön keret, majd kattints a „{szám} keret létrehozása” gombra.

## Keret létrehozása egy dolgozónak

1. **Dolgozók → a dolgozó neve → Szabadságkeret** kártya → **+ Keret létrehozása**.
2. Add meg az évet; megjelenik a számítás bontása.
3. Ha kell, add meg az áthozott napokat (a Work megmutatja az előző év maradékát) és a korrekciót indoklással.
4. Kattints a **Létrehozás** gombra.

## Korrekció, zárolás, újraszámolás

- **Korrekció:** a számított kereten ± napot adhatsz hozzá, kötelező indoklással. Itt módosítható az áthozott napok száma és határideje is.
- **Zárolás:** a keret nem számolódik újra, ha a dolgozó adatai változnak; a kártya „Eltér a számítottól” címkével jelzi, ha a friss számítás mást adna.
- **Automatikus újraszámolás:** ha a dolgozó egy számításhoz használt adata változik, a Work az idei és jövőbeli, nem zárolt kereteit magától újraszámolja, és üzenetben jelzi a változást. A múltbeli éveket nem módosítja.
- **Kézi keret:** a régi, kézzel megadott keretek „Kézi” címkét kapnak, és nem számolódnak újra. A **Számítás alkalmazása** gombbal átállíthatók.
- **Előzmények:** a keret minden változása megnézhető (ki, mikor, mit módosított).

## Áthozott szabadság

Az előző év ki nem vett napjai a következő év keretébe „Áthozott” napként kerülhetnek. A Work az előző év maradékát ajánlja fel, de hogy mennyi hozható át, azt a munkáltató dönti el, ezért a HR átírhatja. Az áthozott napokhoz határidő tartozik:

- **Március 31.:** az alapeset.
- **December 31.:** az életkor szerinti pótszabadság, a felek megállapodása alapján.
- **Egyedi dátum:** pl. ha betegség miatt nem lehetett kiadni. Ezt a dolgozó adatlapján lehet megadni.

A szabadság először az áthozott napokból fogy. A határidő lejártával a szabadság nem vész el, ki kell adni. A HR az Irányítópulton a „Lejáró áthozott napok” listában látja ezeket, a dolgozó pedig emlékeztetőt kap, mennyit kell még kivennie és meddig.

## Évnyitás

Egy évre csak akkor lehet szabadságot kérni, rögzíteni vagy jóváhagyni, ha az év meg van nyitva. Az évek sorban nyithatók, legfeljebb a jövő év.

1. Nyisd meg az **Idő és szabadság → Munkanaptár** oldalt, és lapozz a kívánt évre. A meg nem nyitott évnél „Nincs megnyitva” jelzés látszik.
2. Kattints a „{év} megnyitása” gombra.
3. Az előnézet dolgozónként mutatja a keretet és a kiírandó kötelező szabadságokat.
4. Kattints az **Év megnyitása** gombra.

Az évnyitás minden aktív dolgozónak, akinek még nincs kerete, számított keretet hoz létre (áthozatal és korrekció nélkül), és kiírja a [munkanaptár](./munkanaptar.md) kötelező szabadság napjait; a dolgozók értesítést kapnak. Nem vonható vissza.

## Évzárás

A lezárt évre és a korábbi évekre már nem lehet szabadságot beadni, jóváhagyni, törölni vagy módosítani (függő kérelmet visszavonni még lehet).

1. **Idő és szabadság → Munkanaptár**, lapozz a lezárandó évre.
2. Kattints a „{év} lezárása” gombra, és erősítsd meg.

Jövő évet nem lehet lezárni. A legutoljára lezárt év a „{év} újranyitása” gombbal újranyitható.

## Gyakori kérdések

**Miért üres a táblázat az Éves szabadságkeretek oldalon?**
Ott csak azok szerepelnek, akiknek még nincs kerete a kiválasztott évre.

**Miért nem kérhetek szabadságot jövő évre?**
Mert a jövő év még nincs megnyitva. A HR a Munkanaptár oldalon nyithatja meg.

**Miért nem tartalmazza a keret az életkor szerinti pótszabadságot?**
Valószínűleg nincs megadva a születési dátum. Ilyenkor a Work figyelmeztet.

**Elvész a tavalyi szabadságom, ha lejár a határidő?**
Nem. A Work figyelmeztet, de a napokat nem vonja le; egyeztess a HR-rel, mikor veszed ki.
