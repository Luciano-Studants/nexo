-- Atualiza apenas os nomes exibidos, preservando slugs, IDs e vínculos de QR,
-- fotos, visitas e auditoria. NDE e CPA está cadastrado no 3º piso.
UPDATE rooms r
   SET name = CASE
       WHEN f.sort_order = 1 AND r.slug = 'a-nomear-topo-direita'
           THEN 'Laboratório de Biomedicina'
       WHEN f.sort_order = 3 AND r.slug = 'nde-e-cpa'
           THEN 'Reitoria'
       ELSE r.name
   END,
       updated_at = now()
  FROM floors f
  JOIN events e ON e.id = f.event_id
 WHERE r.floor_id = f.id
   AND e.slug = 'procidadania-ceumap'
   AND (
       (f.sort_order = 1 AND r.slug = 'a-nomear-topo-direita' AND r.name IS DISTINCT FROM 'Laboratório de Biomedicina')
       OR
       (f.sort_order = 3 AND r.slug = 'nde-e-cpa' AND r.name IS DISTINCT FROM 'Reitoria')
   );
