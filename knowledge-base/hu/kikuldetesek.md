---
title: Kiküldetések és utak rögzítése
category: racona-work
tags: [kiküldetés, út, utazás, hivatali út, autó, gépjármű, saját autó, rendszám, fogyasztási norma, útvonal, távolság, km, kilométer, megálló, visszaút, elrendelő, lakcím, munkahely, céges hely]
aliases: [céges út, saját autós út, útnyilvántartás, útnyilvántartó, kilométer elszámolás, km elszámolás, autóim, utaim, útvonaltervező, menetlevél, új út, út rögzítése]
last_updated: 2026-10-07
---

# Kiküldetések és utak rögzítése

## Rövid összefoglaló
A Kiküldetések menüben a dolgozók a saját autóval tett hivatali útjaikat rögzítik. Előbb az autót kell felvenni (Autóim), utána lehet utakat rögzíteni (Utaim). A távolságot a beépített útvonaltervező számolja ki. A hónap útjaiból autónként havi kiküldetési rendelvény készül, ezt a Rendelvények útmutató írja le.

## Elérés
**Elérési út:** Work → Kiküldetések → Autóim, Utaim, Rendelvények
**Ki használhatja:** a „Saját utak és rendelvények” joggal rendelkezők. Alapból minden szerepben benne van, kivéve a Projektkezelőt: a Dolgozó, a HR felelős és a Szervezet adminisztrátor megkapja. A külsős dolgozó nem kap kiküldetés-funkciókat. A Racona rendszergazdája (core admin) mindent megtehet.

## Autó felvétele (Autóim)
Utat csak felvett autóval lehet rögzíteni. Az autót így veszed fel:
1. Nyisd meg: Work → Kiküldetések → **Autóim**.
2. Kattints az **+ Új autó** gombra.
3. Töltsd ki: **Rendszám**, **Típus** (pl. Audi A4), **Hengerűrtartalom (cm³)**, **Üzemanyag** (benzin vagy gázolaj).
4. Ha ezzel az autóval utazol a legtöbbet, pipáld be: **Ez az alapértelmezett autóm**. Új útnál ez lesz előre kiválasztva.
5. Kattints a **Mentés** gombra.

Egy rendszám dolgozónként csak egyszer vehető fel. Jelenleg csak benzines és gázolajos autó választható.

## Az autó fogyasztási normája
Az autó fogyasztási normáját a rendszer a hengerűrtartalomból és az üzemanyagból számolja a 60/1992. Korm. rendelet szerint. Az űrlap alján rögtön látszik, például: „Fogyasztási norma: 9,5 l/100 km (60/1992. Korm. rendelet)”.

| Hengerűrtartalom | Benzin (l/100 km) | Gázolaj (l/100 km) |
|---|---|---|
| 1000 cm³-ig | 7,6 | 5,7 |
| 1001–1500 cm³ | 8,6 | 5,7 |
| 1501–2000 cm³ | 9,5 | 6,7 |
| 2001–3000 cm³ | 11,4 | 7,6 |
| 3000 cm³ felett | 13,3 | 9,5 |

**Egyedi fogyasztás (csak HR):** a „Kiküldetések kezelése” joggal rendelkező az autó szerkesztésekor egyedi értéket is megadhat (Érték / 100 km), de ehhez indoklás kell. Az autó kártyáján ilyenkor az „egyedi érték” felirat látszik. Ha egy autónak nincs normája, a kártyán „Nincs fogyasztási norma” áll, és a rendelvényén nem lesz összeg.

## Autó szerkesztése, törlése, archiválása
Az Autóim oldalon az autó kártyáján a **Szerkesztés** gombbal módosíthatsz. Ha az autóval még nincs út, a **Törlés** gomb végleg törli. Ha már vannak vele utak, csak **Archiválás** lehetséges: az archivált autóval új út nem rögzíthető, de a régi utak és rendelvények megmaradnak. Az archivált autók az **Archiváltak is** jelölővel jelennek meg, és a **Visszaállítás** gombbal újra használhatók.

## Új út rögzítése (Utaim)
1. Nyisd meg: Work → Kiküldetések → **Utaim**.
2. Kattints az **+ Új út** gombra. Ha még nincs autód, a rendszer az Autóim oldalra küld („Előbb vegyél fel autót az Autóim oldalon.”).
3. Válaszd ki az **Autó**t, és add meg az út **Kezdete** és **Vége** időpontját (dátum és óra).
4. Az **Útvonal** részben add meg a **Honnan** és a **Hova** pontot. Gyors indulás: **Otthonról** vagy **A munkahelyről**.
5. Szükség esetén a **+ Köztes megálló** gombbal adj hozzá megállókat (legfeljebb 8).
6. Válaszd ki a **Visszaút** módját: **Vissza a kiindulópontra**, **Máshová** (ilyenkor add meg: Hova érkeztél vissza), vagy **Csak odaút**.
7. Ha kell, pipáld be: **Fizetős utak (autópálya) elkerülése**.
8. Ellenőrizd a **Távolság** részt: az útvonaltervező kiszámolja a km-t és mutatja a térképet.
9. Ha szeretnéd, írd be **A kiküldetés célja (nem kötelező)** mezőbe az út célját (pl. ügyféltalálkozó), és válaszd ki az **Elrendelő**t.
10. Kattints a **Mentés** gombra.

Egy dolgozó útjai időben nem fedhetik egymást. Az út abba a hónapba kerül, amelyikben elkezdődött.

## Helyek kiválasztása az úthoz
A Honnan, Hova és megálló mezőkben a lenyíló listából választhatsz:
- **Lakcím** és **Munkahely**: a saját lakcímed és a munkahely címe.
- **Céges helyek**: a cég által felvett gyakori célok (pl. partnerek telephelyei), mindenki látja őket.
- **Saját helyek**: az általad elmentett helyek.
- **Keresés cím alapján…**: írd be a címet (legalább 3 karakter), majd **Keresés**. Ha nincs találat, próbáld házszám nélkül vagy csak a település nevével.

A keresésből kiválasztott hely a **Mentés saját helyként** lehetőséggel elmenthető, így legközelebb a Saját helyek között megtalálod.

Az **Otthonról** gomb csak akkor működik, ha a lakcímed rögzítve van és a térképen is megtalálható. Ha nincs, ezt látod: „Nincs rögzítve lakcím. A HR tudja pótolni.” A lakcímet a HR a dolgozói adatlapon rögzíti. A munkahely a szervezet címe, vagy a Beállítások → Kiküldetések oldalon munkahelynek jelölt céges hely.

## Távolság és km az úton
Az útvonaltervező közúton számolja ki a távolságot a kiindulópont, a megállók, a cél és a visszaút között. Az **Elszámolt km** mezőbe ez kerül egész km-re kerekítve, mellette a tervezett érték.
- **Eltérő km:** átírhatod az elszámolt km-t, de ekkor kötelező kitölteni **Az eltérés oka** mezőt (pl. terelés az M7-en). Az eltérés a rendelvényen is látszik.
- **Kézi km:** ha az útvonaltervező nem érhető el („Az útvonaltervező most nem érhető el.”), próbáld az **Újra** gombbal, vagy pipáld be a **Kézi km (útvonaltervező nélkül)** lehetőséget. Kézi km-hez is indoklás kell, és a HR látja.

Az elszámolt km 1 és 5000 közötti egész szám lehet.

## Utak megtekintése, szerkesztése, másolása
Az Utaim oldal havi nézet: a hónapot a **‹ ›** nyilakkal lapozod. Az utak autónként csoportosítva jelennek meg, a csoport fejlécében a rendelvény állapota, az összes km és az összeg látszik. Ha még nincs NAV-ár a hónapra, ezt látod: „NAV-ár még nincs rögzítve”.

Soronként a ceruza ikonnal **Szerkesztés**, a × ikonnal **Törlés**, a dupla négyzet ikonnal **Másolás új dátummal** érhető el. A másolás ugyanazt az utat a mai dátummal nyitja meg, így a rendszeres utakat gyorsan rögzítheted.

Szerkeszteni és törölni csak addig lehet, amíg a hónap rendelvényét nem küldted be. Beküldés után a **Beküldés visszavonása** kell hozzá, jóváhagyás után pedig csak a HR nyithatja vissza.

## Ki mit láthat a kiküldetéseknél
- **Saját utak és rendelvények:** a saját autóidat, útjaidat és rendelvényeidet látod és kezeled.
- **Rendelvények jóváhagyása:** az Utaim és a Rendelvények oldalon megjelenik a **Saját / Mindenki** váltó, és a **Minden dolgozó** szűrő, így mindenki útját látod.
- **Kiküldetések kezelése (mindenki útja, kifizetés, NAV-árak):** a Mindenki nézetben bárki nevében rögzíthetsz és javíthatsz utat (előbb válaszd ki a dolgozót a szűrőben), és az Autóim oldalon bármelyik dolgozó autóját kezelheted.

## Gyakori kérdések
**Miért nem tudok utat rögzíteni?** Valószínűleg még nincs felvett autód. Vedd fel a Work → Kiküldetések → Autóim oldalon.

**Miért nem működik az „Otthonról” gomb?** Nincs rögzítve a lakcímed, vagy a rendszer nem találta meg a térképen. Kérd meg a HR-t, hogy javítsa a dolgozói adatlapodon.

**Átírhatom a kiszámolt km-t?** Igen, de indoklást kell írnod Az eltérés oka mezőbe, és a HR ezt látni fogja.

**Miért nem tudom szerkeszteni az utamat?** A hónap rendelvényét már beküldted vagy jóváhagyták. Beküldött rendelvénynél vond vissza a beküldést, jóváhagyottnál kérd a HR-t a visszanyitásra.

**Két autóval utaztam egy hónapban, mi lesz?** Autónként külön rendelvény készül.

**Kötelező az elrendelő?** Nem, de a rendelvény jelzi, ha valamelyik útnál hiányzik. A jóváhagyó utólag is beállíthatja.

**Eladtam az autómat, törölhetem?** Ha már vannak vele utak, csak archiválni lehet. A régi rendelvények megmaradnak.
