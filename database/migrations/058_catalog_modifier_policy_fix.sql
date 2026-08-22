DROP POLICY catalog_modifier_groups_visible ON catalog_modifier_groups;
CREATE POLICY catalog_modifier_groups_visible ON catalog_modifier_groups USING(active OR app.has_role('admin'));
