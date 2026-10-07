---
title: Havi szabadság-összesítő
description: A hónap végi szabadság-ellenőrzés kiküldése, elfogadása és automatizálása
sidebar:
  order: 8
---

A hónap végén a HR kiküldi minden dolgozónak a hónapra rögzített szabadságainak összesítőjét, emailben és rendszeren belüli értesítésként. A dolgozó elfogadja, vagy jelzi, ha valami nem stimmel. A HR látja, ki válaszolt, és mikor zárható a hónap a bérszámfejtéshez.

> **Hol találod?**
> - **HR:** **Idő és szabadság → Szabadság nyilvántartó → Naptár → Csapat** nézet, „Havi ellenőrzés – {hónap}” blokk. A „Szabadságkérelmek jóváhagyása” jog kell hozzá.
> - **Dolgozó:** az **Irányítópult** tetején, telefonon a **Havi szabadság-összesítő** gyorsművelet.
> - **Automatizálás:** **Beállítások → Szabadság → Havi ellenőrzés automatizálása**.

## Az összesítő elfogadása (dolgozó)

Az Irányítópult tetején megjelenik az „Ellenőrizd a szabadságaidat – {hónap}” kártya: a hónap szabadságai időszakonként, „Összesen N munkanap”, a függő kérelmeid külön, és a HR megjegyzése. Ha minden rendben, kattints a **Rendben, elfogadom** gombra. A függő kérelmek nincsenek benne, ezeket nem kell elfogadni.

## Eltérés jelzése (dolgozó)

1. A kártyán kattints az **Eltérést jelzek** gombra.
2. A „Rögzített napok” között minden napnál válaszd ki: Rendben, Nem voltam szabadságon, vagy Más a típusa (a helyes típussal).
3. A „Hiányzó napok” résznél vedd fel azt a napot, amikor szabadságon voltál, de nincs rögzítve: válassz napot és típust, majd **Hozzáadás**.
4. Írhatsz megjegyzést, majd kattints az **Eltérés beküldése** gombra.

Legalább egy tételt vagy megjegyzést meg kell adni. A naptárban a dolgozó nem javíthat, a javítást a HR végzi.

## Az összesítő kiküldése (HR)

1. Nyisd meg a Szabadság nyilvántartó naptárát, és válts **Csapat** nézetre.
2. Lapozz a kívánt hónapra. A táblázat alatt megjelenik a „Havi ellenőrzés – {hónap}” blokk.
3. Kattints az **Értesítés küldése hónap végi ellenőrzés céljából** gombra.
4. A megerősítő sáv mutatja, hány dolgozó kap új összesítőt, hány újraküldés lesz, és kik maradnak ki. Figyelmeztet, ha a hónapra még függő kérelem van: ezeket érdemes előbb elbírálni.
5. Írhatsz megjegyzést a dolgozóknak, majd kattints a **Kiküldés** gombra.

A gomb többször is megnyomható: csak az kap újat, akinek még nincs, vagy akinél a kiküldés óta változtak a napok. Jövőbeli hónapra és lezárt évre nem küldhető.

Az összesítőt a szervezet minden aktív, nem külsős dolgozója megkapja, azok is, akiknek nincs szabadságuk a hónapban (náluk derülhet ki egy hiányzó nap). Kimarad, aki a hónap után lépett be.

## A havi ellenőrzés állapota

A blokk számlálói: Elfogadta, Válaszra vár, Eltérést jelzett, HR lezárta, Változott a kiküldés óta, Nincs kiküldve. Ha mindenki elfogadta vagy a HR lezárta, megjelenik **A hónap zárható** jelzés.

A Csapat táblázatban a név mellett kis jel mutatja az állapotot: ✓ elfogadta, szürke ✓ HR lezárta, … válaszra vár, ! eltérést jelzett, ↻ változott, ○ nincs kiküldve.

## Eltérések kezelése (HR)

A blokk „Eltérések” listájában látod a dolgozó tételeit és megjegyzését. Műveletek:

- **Megnyitás a naptárban:** havi nézet a dolgozóra szűrve, hogy javíthasd a napokat.
- **Újraküldés:** friss összesítőt küld, amit a dolgozónak újra el kell fogadnia.
- **Lezárás elfogadás nélkül:** kötelező indoklással; a dolgozó megkapja. A „Válaszra vár” tételeknél is elérhető (pl. tartósan távol lévő dolgozónál).

A saját összesítődet nem zárhatod le, azt egy másik jóváhagyó teheti meg.

Ha a HR a kiküldés után módosít a hónap szabadságain, a tétel „Változott a kiküldés óta” jelzést kap. A dolgozó ilyenkor nem tud válaszolni; a HR a kiküldés gombbal küldi ki a frissített összesítőt.

## Automatizálás

> **Hol találod?** **Beállítások → Szabadság → Havi ellenőrzés automatizálása**. Aki a Szabadság beállításokat eléri, és „Szabadságkérelmek jóváhagyása” joga is van.

Minden automatizmus alapból ki van kapcsolva. A rendszer minden reggel 7-kor nézi meg, van-e teendő.

- **Automatikus kiküldés a hónap végén:** a folyó hónap összesítője magától kimegy. Beállítható, hány nappal a hónap vége előtt (1–15, alapból 5), munkanapban vagy naptári napban számolva, és megjegyzés is adható.
- **Emlékeztető a válaszra váróknak:** a kiküldés után naponta (beállítható az első emlékeztető napja és a gyakoriság), alapból csak munkanapon, a zárás napjáig.
- **Összesítő a szabadságkezelőknek a hónap zárásakor:** a zárás napján leállnak az emlékeztetők, és a kijelölt értesítendők összesítőt kapnak: ki fogadta el, ki nem válaszolt, ki jelzett eltérést, és zárható-e a hónap.

**Példa:** alapbeállítással, 2026 októberében (október 23. munkaszüneti nap): kiküldés október 26-án, emlékeztető 27-én és 28-án, zárás és összesítő 29-én, így a HR-nek 29–30. marad a bérszámfejtésre.

## Gyakori kérdések

**Nincs teendőm, mit látok telefonon?**
„Nincs ellenőrzésre váró havi összesítőd.”

**Lezárja a rendszer a hónapot?**
Nem, „A hónap zárható” csak jelzés. Automatikus elfogadás sincs.

**Miért nem kap emlékeztetőt egy dolgozó?**
Már válaszolt, a tétele változott, a zárás napja elérkezett, vagy a tételt az emlékeztető bekapcsolása előtt küldték ki.

**Ki kapja az eltérést automatikus kiküldés után?**
A Beállítások → Szabadság oldalon kijelölt „Szabadságkérelem értesítendők”. Ha nincs kijelölve senki, az oldal figyelmeztet.
