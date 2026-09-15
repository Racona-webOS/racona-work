# Projekt riport: teljes időszak és kezdő dátum

> Státusz: kész · Utolsó módosítás: 2026-09-15

A projekt Riport fülén az „Utolsó 30 nap” grafikon csak a legutóbbi időszakot mutatja, így egy régebbi vagy lezárt projektnél nem látszik, hogyan alakult a munka a tényleges fejlesztés alatt. A cél egy ugyanilyen grafikon a projekt teljes időszakára, az első és az utolsó bejegyzés között. Lezárt projektnél a jelenhez kötött részek (utolsó 30 nap, idővonal) nem mondanak semmit, ezért eltűnnek. Emellett a munkanaplóba nem kerülhet bejegyzés a projekt kezdő dátuma elé.

Kapcsolódó: [project-closing.md](project-closing.md).

## 1. Hatókör

**Benne van**

- „Teljes időszak” grafikon a Riport fülön, az „Utolsó 30 nap” után.
- Lezárt projektnél az „Utolsó 30 nap” grafikon és az „Idővonal” elrejtése.
- Kezdő dátum szabály új és módosított bejegyzésre.

**Nincs benne**

- A kezdő dátum módosításakor a már korábbi napra rögzített bejegyzések ellenőrzése.
- A CSV export változása.

## 2. Döntések

| # | Kérdés | Döntés | Állapot |
|---|---|---|---|
| D1 | Milyen időszakot mutat a teljes grafikon? | Mindig az első és az utolsó bejegyzés napja között, a riport dátumszűrőjétől függetlenül. A bejegyzés nélküli napok 0 órával szerepelnek. | javasolt |
| D2 | Hosszú időszak | Legfeljebb 120 oszlop. Ha a napok száma több, egy oszlop több egymást követő napot összegez (pl. 365 napnál 4-et), a grafikon felett jelezve. A tooltip az oszlop időszakát és óraszámát mutatja. | javasolt |
| D3 | „Utolsó 30 nap” lezárt projektnél | Dátumszűrő nélkül rejtve. Dátumszűrővel a grafikon a szűrt időszak napi bontása („Napi bontás (szűrt időszak)”), ez lezárt projektnél is látszik. | javasolt |
| D4 | „Idővonal” lezárt projektnél | Rejtve (az eltelt és hátralévő napok a mához mérnek). | javasolt |
| D5 | Kezdő dátum: melyik nap számít? | Új bejegyzésnél a megadott nap, módosításnál a módosítás utáni nap. Egy kezdő dátum előtti régi bejegyzés tehát csak úgy módosítható, ha a napját is jóra teszik; a törlése megengedett. | javasolt |
| D6 | Záró dátum | Nincs rá szabály. | javasolt |

## 3. Követelmények

**K1. Teljes időszak grafikon.** A Riport fülön az „Utolsó 30 nap” szekció után „Teljes időszak (első és utolsó bejegyzés között)” szekció, ugyanolyan oszlopdiagrammal, alatta az időszak első és utolsó napjával. Bejegyzés nélküli projektnél üres állapot.

**K2. Lezárt projekt.** Lezárt projektnél nincs „Idővonal” szekció, és dátumszűrő nélkül nincs „Utolsó 30 nap” szekció. A teljes időszak grafikon látszik.

**K3. Kezdő dátum.** Ha a projektnek van kezdő dátuma, a `createWorkEntry` és az `updateWorkEntry` hibát ad, ha a nap korábbi nála. A munkanapló űrlapján a dátummező nem enged korábbi napot, mentéskor a felület is jelez.

## 4. Adat

A `getProjectReport` új mezője:

```ts
lifetime: {
  bucketDays: number;              // hány nap egy oszlop
  points: { date: string; to: string; hours: number; entries: number }[];
}
```

A számítás tiszta függvény (`buildLifetimeSeries` a `server/project-report.ts`-ben), tesztek: `tests/project-report.test.ts`.
