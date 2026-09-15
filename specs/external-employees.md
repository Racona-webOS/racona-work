# Külsős dolgozók

> Státusz: kész · Utolsó módosítás: 2026-09-15

Egyes projekteken külsős dolgozók is dolgoznak. Ahhoz, hogy a projekthez hozzá lehessen adni őket, ma ugyanúgy fel kell venni őket a szervezet dolgozói közé, így a szabadság, a kiküldetések és a többi szervezeti funkció is rájuk vonatkozna. A cél: a dolgozói adatlapon megjelölhető, hogy a dolgozó **külsős**. A külsős dolgozó a szervezetben csak a projektekben vesz részt (tagság, munkanapló, riport), minden más funkcióból kimarad.

## 1. Hatókör

**Benne van**

- „Külsős dolgozó” jelölés a dolgozói adatlap alapadatai között (`employee.manage`).
- A külsős dolgozó képességei a projekt- és munkanapló-képességekre szűkülnek.
- A szervezeti listákból és összesítőkből kimarad (szabadság, kiküldetések, irányítópult, értesítések címzettjei, dolgozó-választók).
- A rá vonatkozó szabadság- és kiküldetés-műveletek hibát adnak.
- Saját felülete: az irányítópult a projektekhez irányít, a Szabadságkérelmek oldal jelzi, hogy rá nem vonatkozik.

**Nincs benne**

- Külsős jelölés már a dolgozó létrehozásakor (létrehozás után az adatlapon állítható; az üdvözlő email a létrehozáskor kimegy).
- A korábbi szabadság- és kiküldetési adatok törlése, ha egy dolgozót utólag jelölnek külsősnek: megmaradnak, csak nem látszanak. A jelölés visszavonásával újra előkerülnek.
- Külön külsős szerep. A dolgozó szerepei maradnak, csak a projekten kívüli képességeik nem érvényesek.

## 2. Döntések

| # | Kérdés | Döntés | Állapot |
|---|---|---|---|
| D1 | Hol tároljuk? | `employees.is_external` (szervezetenként, mert egy felhasználó több szervezetben is dolgozó lehet). | javasolt |
| D2 | Milyen képességek maradnak? | `project.create`, `project.manage`, `project.close`, `project.view.all`, `project.view.own`, `work.log`, `work.view.all`, ha a szerepei (szervezeti vagy projekt-szintű) megadják. A többit a `getMyCapabilities` kiszűri, a `hasCapability` hamisat ad rá. Így a menüből is eltűnnek a nem rá vonatkozó pontok. | javasolt |
| D3 | Látszik-e a Dolgozók listán? | Igen, „Külsős” jelvénnyel, hogy az adatlapja elérhető legyen. | javasolt |
| D4 | Dolgozó-választók | A projekt tagválasztója, a projekt-szintű jogosultságok és a szervezeti szerepek tagválasztója mutatja a külsősöket. A szabadság (naptár, értesítendők) és a kiküldetések választói nem. A `getEmployees` alapból kihagyja őket, `includeExternal: true` kérésre adja vissza. | javasolt |
| D5 | Irányítópult | A külsős dolgozó rövid tájékoztatót és a Projektek megnyitása gombot kap. A vezetői irányítópult számaiból kimarad. | javasolt |
| D6 | Értesítések | A szabadság értesítendői közé nem menthető, és a képesség alapján kiválasztott címzettek (keretkezelők, rendelvény-jóváhagyók) közül is kimarad. | javasolt |
| D7 | Rendszergazda | A core admin és a dev mód nem külsős, rájuk nem vonatkozik a szűrés. | javasolt |

## 3. Követelmények

**K1. Jelölés.** A dolgozói adatlap alapadatainak szerkesztésekor „Külsős dolgozó” jelölőnégyzet magyarázattal. Külsős dolgozónál a profil alatt „Külsős” jelvény és tájékoztatás; a szabadságkeret oszlop és a belépési dátum figyelmeztetés nem jelenik meg.

**K2. Képességek.** A `getMyCapabilities` a külsősnek csak a D2 szerinti képességeket adja vissza, `isExternal: true` jelzéssel. A `hasCapability` minden más képességre hamis.

**K3. Kimaradás a listákból.** Kimarad: vezetői irányítópult számai és függő kérelmei; szabadságkérelmek listája; szabadságnaptár (napok, függő kérelmek); keretek tömeges kiszámítása és évnyitás, kötelező szabadság; áthozatal figyelmeztetések; szabadság egyenleg; havi ellenőrzés; adatbejelentések; szabadság értesítések címzettjei; utak, autók, rendelvények listái és az elrendelő-választó.

**K4. Elutasítás.** Hibát ad („Külsős dolgozóra ez a funkció nem vonatkozik.”): szabadságkérelem és naptári mentés külsősre, szabadságkeret és a keret számítási adatai, a saját adatokon keresztüli szabadság- és kiküldetés-műveletek (`requireSelfOrCapability`, `requireTripAccess`), értesítendőnek jelölés (csendben kimarad).

**K5. Projektek.** A projekttagság, a munkanapló és a projekt riport a külsősre is változatlanul működik.

## 4. Adatmodell

`employees.is_external BOOLEAN NOT NULL DEFAULT FALSE` (`023_external_employees.sql`). Az `EmployeeRow.isExternal`, az `updateEmployee({ isExternal })` és a `getEmployees({ includeExternal })` hordozza.
