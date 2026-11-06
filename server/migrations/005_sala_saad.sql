-- O ambiente do topo à direita do 1º piso, que entrou na semente como "A nomear", é o SAAD.
-- Renomeia o registro existente (mesmo id): fotos, QR, visitas e auditoria continuam ligados a ele.
-- Em banco novo não há nada a renomear; a semente já cria o ambiente como "saad".
-- Se a sala já tinha QR ativo, a etiqueta impressa ficou com o nome antigo: gere a versão pendente com
--   npm run qr -- prepare --slugs saad
UPDATE rooms r
   SET slug = 'saad', name = 'SAAD', updated_at = now()
  FROM floors f
 WHERE f.id = r.floor_id
   AND r.slug = 'a-nomear-topo-direita'
   AND NOT EXISTS (SELECT 1 FROM rooms x WHERE x.floor_id = r.floor_id AND x.slug = 'saad');
