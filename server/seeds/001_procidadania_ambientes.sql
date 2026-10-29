-- Semente de desenvolvimento: edição, 3 pisos e 29 ambientes conforme as plantas aprovadas.
-- Idempotente. Todos os ambientes entram ativos e NÃO obrigatórios: o staff define o que vale no evento.

INSERT INTO events (slug, name, edition_label)
VALUES ('procidadania-ceumap', 'PROCIDADANIA CEUMAP', 'Edição do evento')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO floors (event_id, name, sort_order)
SELECT e.id, f.name, f.ord
FROM events e,
     (VALUES ('1º piso', 1), ('2º piso', 2), ('3º piso', 3)) AS f(name, ord)
WHERE e.slug = 'procidadania-ceumap'
ON CONFLICT (event_id, sort_order) DO NOTHING;

INSERT INTO rooms (floor_id, slug, name, room_number)
SELECT fl.id, r.slug, r.name, r.num
FROM floors fl
JOIN events e ON e.id = fl.event_id AND e.slug = 'procidadania-ceumap'
JOIN (VALUES
    -- 1º piso (7). O ambiente do topo à direita ainda não tem nome.
    (1, 'tecnicas-radiologicas',  'Técnicas Radiológicas',          NULL),
    (1, 'laboratorio-anatomia',   'Laboratório de Anatomia',        NULL),
    (1, 'laboratorio-enfermagem', 'Laboratório de Enfermagem',      NULL),
    (1, 'direcao',                'Direção',                        NULL),
    (1, 'laboratorio-multidisciplinar', 'Laboratório Multidisciplinar', NULL),
    (1, 'biblioteca',             'Biblioteca',                     NULL),
    (1, 'a-nomear-topo-direita',  'A nomear',                       NULL),
    -- 2º piso (10)
    (2, 'sala-201',               'Sala 201',                       '201'),
    (2, 'sala-202',               'Sala 202',                       '202'),
    (2, 'circuitos',              'Circuitos',                      NULL),
    (2, 'laboratorio-desenvolvimento', 'Laboratório de Desenvolvimento', NULL),
    (2, 'programacao-1',          'Programação 1',                  NULL),
    (2, 'sala-de-jogos',          'Sala de Jogos',                  NULL),
    (2, 'imagem',                 'Imagem',                         NULL),
    (2, 'laboratorio-desenvolvimento-internet', 'Laboratório de Desenvolvimento para Internet', NULL),
    (2, 'infraestrutura',         'Infraestrutura',                 NULL),
    (2, 'programacao-2',          'Programação 2',                  NULL),
    -- 3º piso (12)
    (3, 'sala-301',               'Sala 301',                       '301'),
    (3, 'sala-302',               'Sala 302',                       '302'),
    (3, 'sala-303',               'Sala 303',                       '303'),
    (3, 'sala-304',               'Sala 304',                       '304'),
    (3, 'sala-305',               'Sala 305',                       '305'),
    (3, 'sala-306',               'Sala 306',                       '306'),
    (3, 'sala-300',               'Sala 300',                       '300'),
    (3, 'nde-e-cpa',              'NDE e CPA',                      NULL),
    (3, 'sala-de-ti',             'Sala de TI',                     NULL),
    (3, 'auditorio',              'Auditório',                      NULL),
    (3, 'laboratorio-fisica',     'Laboratório de Física',          NULL),
    (3, 'sala-dos-professores',   'Sala dos Professores',           NULL)
) AS r(ord, slug, name, num) ON r.ord = fl.sort_order
ON CONFLICT (floor_id, slug) DO NOTHING;
