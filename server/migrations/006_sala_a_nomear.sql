-- Mantém SAAD como ambiente próprio e recria A nomear como sala independente no 1º piso.
-- A migração 005 já converteu o registro original em SAAD; esta inclusão não altera fotos,
-- QR Codes, visitas ou auditoria vinculados ao SAAD.
INSERT INTO rooms (floor_id, slug, name, room_number)
SELECT f.id, 'a-nomear-topo-direita', 'A nomear', NULL
  FROM floors f
  JOIN events e ON e.id = f.event_id
 WHERE e.slug = 'procidadania-ceumap'
   AND f.sort_order = 1
   AND NOT EXISTS (
     SELECT 1 FROM rooms r
      WHERE r.floor_id = f.id
        AND r.slug = 'a-nomear-topo-direita'
   );
