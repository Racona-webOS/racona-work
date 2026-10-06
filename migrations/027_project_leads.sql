-- Projektvezető a projekt-szintű szerep-felülbírálások helyett (specs/project-lead.md)
--
-- A projektvezető a projekt tagja `role = 'lead'` szereppel; a saját projektjén
-- a project.manage és a project.close jogot kapja. A korábbi felülbírálások
-- (wp_project_member_roles) közül csak ez a kettő hatott projektszinten.
--
-- Átvétel: aki projekttag, és a projektre kapott szerepei között van
-- project.manage, projektvezető lesz. A nem tag felhasználó felülbírálása
-- elvész: a projektet tagság nélkül csak project.view.all joggal láthatta.

UPDATE app__racona_work.project_members pm
   SET role = 'lead'
  FROM app__racona_work.employees e
 WHERE e.id = pm.employee_id
   AND EXISTS (
       SELECT 1
         FROM app__racona_work.wp_project_member_roles pmr
         JOIN app__racona_work.wp_role_capabilities rc ON rc.role_id = pmr.role_id
        WHERE pmr.project_id = pm.project_id
          AND pmr.user_id = e.user_id
          AND rc.capability = 'project.manage'
   );

DROP TABLE IF EXISTS app__racona_work.wp_project_member_roles;
