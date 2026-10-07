-- Racona Work Plugin - Alapszerepek: a szervezet adminisztrátor minden képességet megkap
--
-- A leave.calendar.manage (Munkanaptár kezelése) és a project.view.own (Saját
-- projektek megtekintése) hiányzott az org_admin definíciójából
-- (SYSTEM_ROLE_DEFINITIONS). A munkanaptárat így a 006 után létrehozott
-- szervezetekben senki nem érte el, és a szerepek szerkesztésének felső
-- korlátja miatt (csak a saját képességeit adhatja tovább) a szervezet
-- adminisztrátor egyiket sem tudta megadni, csak a core admin. Mostantól a
-- definícióban is benne vannak; ez a meglévő org_admin szerepeket pótolja.
--
-- A HR felelős szerep nem kap szabadságkérelem-jogot: a szabadság-nyilvántartó
-- most a jóváhagyóknak és a HR-nek is betölt (server/permissions.ts,
-- LEAVE_VIEW_CAPABILITIES), ehhez adatváltozás nem kell.

INSERT INTO app__racona_work.wp_role_capabilities (role_id, capability)
SELECT r.id, c.capability
FROM app__racona_work.wp_roles r
CROSS JOIN (VALUES ('leave.calendar.manage'), ('project.view.own')) AS c(capability)
WHERE r.key = 'org_admin' AND r.is_system = TRUE
ON CONFLICT DO NOTHING;
