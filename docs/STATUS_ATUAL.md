# Estado do sistema (atualizado em 20/10/2026)

| Área | Estado |
|---|---|
| Esquemas 2D dos 3 pisos | Aprovados 1º; 2º e 3º entregues para conferência (canvas de design) |
| Banco (esquema v2, UUID) | Escrito e **aplicado e testado em PostgreSQL 16 local de teste** |
| Semente: edição, 3 pisos, 29 ambientes | Implementada (todos ativos, nenhum obrigatório) |
| Entrada do visitante (nome completo, ID, avatar, token) | Implementada e testada |
| Retomada por nome + IP (janela de 6 h) e teto de 60 perfis/h por IP | Implementada e testada |
| Estado do evento (antes/aberto/pausado/encerrado, modo de teste) | Implementado e testado; `GET /api/event` |
| `GET /api/me` com progresso (obrigatórios ativos; zero = erro de configuração) | Implementado e testado |
| Limpeza de retenção (30 dias) | Script com simulação por padrão; não automático |
| Frontend refeito (entrada só com nome completo, "É você?", mapa dos 3 pisos, lista, detalhe da sala, progresso) | Implementado; testado no navegador (390 px, 23 verificações) e com 18 testes unitários |
| `GET /api/map` (pisos e ambientes, visitados do perfil) | Implementado e testado |
| QR por sala: versões (pendente/ativa/substituída), ativação atômica, token e código manual derivados de `QR_SECRET` | Implementado e testado |
| Etiquetas em PDF: A6 (uma por página) e A4 (4 por folha, linhas de corte), por linha de comando (`npm run qr`) | Implementado; conferido (tamanho, páginas, código impresso) |
| Visita por QR (`POST /api/visits`) e por código manual (`POST /api/visits/manual`) | Implementado e testado: fase do evento, QR desatualizado, repetição, ambiente inativo, 5 erros = 5 min |
| Leitor de QR pela câmera, link `/q/<token>` da câmera nativa, tela de confirmação | Implementado; testado no navegador com câmera simulada lendo a etiqueta impressa |
| Fragmentos do puzzle (imagem, divisão, exibição da coleção) | **Pendente** (a visita já libera a "peça" na contagem, mas a ilustração ainda não existe) |
| Painel STAFF (CRUD, QR por tela, evento, relatórios, importação, auditoria) | Pendente. QR é gerado por linha de comando; tabelas `admin_accounts` e `audit_log` existem |
| Datas/horários do evento, nome oficial na tela, avatares finais, imagem do puzzle | Aguardando definição |
| Deploy, HTTPS, carga, acessibilidade | Pendente |

Testes: `npm test` (frontend) e `cd server && npm test` (exige `DATABASE_URL` de um banco com "test" no nome e `IP_HASH_SECRET`).

## Atualização: vista 3D e coleção em peças

- Vista 3D (isométrica em SVG) nos três pisos, botão "3D" ao lado de Mapa e Lista (`src/components/IsoMap.tsx`). Usa a mesma geometria de `floorplans.ts`.
- Coleção: a ilustração `public/puzzle.svg` (provisória) é dividida em N peças, N = ambientes obrigatórios ativos (`src/puzzle.ts`). Cada visita nova em ambiente obrigatório revela uma peça; ao completar, a imagem inteira aparece. Para trocar a imagem, substitua `public/puzzle.svg` mantendo a proporção 4:3.
- Pendente: envio da imagem pela equipe no painel (travado durante o evento) e a imagem oficial.

## Atualização: painel da equipe (/admin)

- API `/api/admin/*` (login com sessão de 30 min de inatividade, ambientes, evento, QR, participantes, CSV, histórico) e telas em `src/admin/`.
- Migração `003_painel_staff.sql` (sessões e bloqueio por tentativas). Contas por `npm run admin`.
- Ainda não existe: troca da imagem da coleção pelo painel, importação CSV/XLSX de ambientes, exportação PDF/XLSX, criação/remoção de ambientes e pisos pela tela.

## Atualização: pilha de andares na vista 3D

- A vista 3D mostra os três pisos empilhados (`src/components/IsoMap.tsx`): o piso escolhido fica em destaque, os de cima sobem e somem, os de baixo aparecem como lajes com etiqueta clicável. O enquadramento dá zoom suave ao piso escolhido e o texto é dimensionado para cerca de 14 px no celular.
- Respeita `prefers-reduced-motion` (sem animação). Só o piso em destaque tem salas tocáveis.

## Atualização: fotos do interior das salas

- Migração `004_fotos_das_salas.sql`; rotas `PUT/DELETE /api/admin/rooms/:id/photo` (painel) e `GET /api/rooms/:id/photo` (público, com ETag). O mapa traz `photoVersion` por ambiente.
- Painel: aba **Fotos** com planta clicável (verde = com foto), envio por arquivo ou câmera, troca e remoção. App: foto no detalhe da sala, com ampliação.
- Pendente: política de privacidade para fotos com pessoas; galeria com várias fotos por sala (hoje é uma).

## Atualização V13: data, início e término do evento

- Aba **Evento**: define início e término (horário de Brasília). No horário de início o evento abre sozinho; no de término encerra sozinho (vale também se foi aberto antes). Sem horário, só abre/encerra pelos botões.
- Controle manual: **Abrir agora**, **Pausar/Retomar**, **Encerrar evento** (imediato, com confirmação), **Voltar para antes da abertura** e novo **Reabrir evento** (desfaz encerramento por engano; bloqueado se o término programado já passou).
- Painel mostra linha do tempo ("Abre sozinho em… faltam…") e valida término depois do início.
- App do visitante atualiza a fase do evento a cada 30 s, sem precisar recarregar.
- A data (7 de novembro de 2026) deve ser informada no painel; nenhum dado de produção foi definido aqui.

## Atualização V14: relatórios completos (PDF e XLSX)

- Nova aba **Relatórios** no painel: resumo (participantes, taxa de conclusão, visitas, progresso médio), por piso, ranking de mais/menos visitados, distribuição do progresso, todos os ambientes e visitas por hora.
- **PDF** (A4, paginado) e **XLSX** (8 abas: Resumo, Por piso, Por ambiente, Ranking, Conclusão, Visitas por hora, Participantes, Visitas detalhe). Rotas `GET /api/admin/reports`, `/reports/export.pdf` e `/reports/export.xlsx`, todas protegidas e registradas no Histórico.
- Contêm nomes de participantes: uso restrito à organização (aviso no rodapé do PDF). Horários em America/Sao_Paulo. Nomes com "=" etc. são gravados como texto no XLSX.
- Conclusão = participante com todos os obrigatórios ativos visitados; zero obrigatórios nunca conta como conclusão.
- Os CSVs anteriores continuam disponíveis em Participantes.

## Atualização V15: pronto para publicar
- O servidor entrega também o site compilado (um endereço só; rotas /admin e /q/... funcionam), com política de segurança (CSP) ajustada para câmera/leitor de QR.
- `npm run start:prod`: aplica migrações, semente (idempotente) e cria/atualiza a conta do staff a partir de `ADMIN_USER`/`ADMIN_PASSWORD`; `render.yaml` para publicar no Render. Guia: docs/PUBLICACAO.md.
- Testado em modo de produção local (site+API, login do staff, leitor de QR, PDF). A publicação real no Render ainda não foi executada.

## Atualização V16: publicação gratuita (Render + Neon)
- Banco no Neon (grátis, permanente); servidor no Render grátis, mantido acordado por monitor externo em `/api/ping` (rota nova, não acessa o banco, para não gastar as horas do Neon).
- `render.yaml` e docs/PUBLICACAO.md atualizados. Tempo de conexão ao banco aumentado para 15 s (o Neon acorda sozinho).
- Não testado na hospedagem real; limites e preços dos serviços devem ser conferidos antes de contratar.
