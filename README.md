# NEXO — experiência gamificada de visita ao evento

**NEXO · PROCIDADANIA CEUMAP · Centro Universitário META**
“Explore espaços. Descubra possibilidades.”

Web app mobile-first: o visitante entra só com o nome, explora o mapa dos 3 pisos (2D, 3D e lista), registra visitas lendo o QR de cada sala e revela as peças de uma ilustração. A equipe usa um painel em `/admin` (ambientes, fotos, evento, QR Codes, participantes, relatórios PDF/XLSX).

**Rodar no seu computador:** [docs/TESTE_LOCAL.md](docs/TESTE_LOCAL.md). **Publicar online:** [docs/PUBLICACAO.md](docs/PUBLICACAO.md).

Estado: pronto para testes internos; ainda não publicado. Pendências para produção (domínio/HTTPS, LGPD, testes em aparelhos reais) em [docs/STATUS_ATUAL.md](docs/STATUS_ATUAL.md).

## Requisitos
- Node.js LTS e npm
- VS Code recomendado
- PostgreSQL acessível (por exemplo, um projeto Supabase) para testar a conexão real

## Executar frontend
O Vite repassa `/api` para `http://localhost:3000` (veja `vite.config.ts`); para outra URL, defina `VITE_API_BASE_URL`.

No terminal na raiz:

```powershell
npm install
npm run dev
```

Abra `http://localhost:5173`.

## Executar API
Em outro terminal:

```powershell
cd server
npm install
Copy-Item .env.example .env
npm run dev
```

Abra `http://localhost:3000/api/health`. Sem `DATABASE_URL`, o retorno indica `database: "not-configured"`, o que é esperado.

## Configurar banco e API
1. Em `server/`, copie `.env.example` para `.env` e preencha `DATABASE_URL`, `IP_HASH_SECRET`, `QR_SECRET` (valores longos e aleatórios) e `PUBLIC_APP_URL` no seu computador. Não envie nem versione o `.env`.
2. `cd server && npm install`
3. `npm run db:migrate` aplica `server/migrations`. `npm run db:seed` aplica também a semente (edição, 3 pisos, 29 ambientes). É seguro repetir.
4. `npm run dev` e confira `http://localhost:3000/api/health`.
5. Testes: crie um banco só para testes (nome com "test"), aponte `DATABASE_URL` para ele, rode `npm run db:seed` e depois `npm test`.

### Rotas
- `GET /api/event`: nome, fase e permissões do evento.
- `POST /api/participants` `{ fullName, decision? }`: cria o perfil (201), ou responde `resume_available` (200) se há perfil recente com o mesmo nome e IP; reenviar com `decision: "resume" | "new"`.
- `GET /api/map`: pisos e ambientes (com `visited` se houver token).
- `POST /api/visits` `{ code }` e `POST /api/visits/manual` `{ roomId, code }` (com Bearer): registram a visita. Erros: `VISITS_NOT_OPEN`, `QR_OUTDATED`, `QR_UNKNOWN`, `QR_NOT_ACTIVE`, `ROOM_UNAVAILABLE`, `MANUAL_CODE_INVALID`, `MANUAL_LOCKED`.
- `GET /api/me` com `Authorization: Bearer <token>`: perfil e progresso.

Se o projeto antigo já tinha tabelas no seu banco (participants com senha, login_attempts, participant_sessions), use um banco novo ou apague essas tabelas antes: o esquema novo não converte o antigo.

## QR Codes das salas (linha de comando, até o painel de staff existir)
Em `server/`:

```bash
npm run qr -- prepare --required            # cria a versão PENDENTE (ainda não vale)
npm run qr -- print --status pending --required --format a4   # PDF em server/out/
# imprimir, colar nas salas e conferir; só então:
npm run qr -- activate --required           # ativa e invalida a versão anterior (atômico)
npm run qr -- print --status active --slugs biblioteca --format a6   # reimpressão
```
Seletores: `--required` (obrigatórios ativos), `--all` ou `--slugs a,b,c`. Formatos: `a4` (4 etiquetas por folha, com linhas de corte) e `a6` (10,5 × 14,8 cm, uma por página).

- Cada etiqueta traz o QR (URL `PUBLIC_APP_URL/q/<token>`) e um código manual (ex.: `ABCD-EFGH`). O token e o código são **derivados** de `QR_SECRET`, da sala e da versão; o banco guarda só os hashes. Por isso a reimpressão gera exatamente o mesmo QR.
- **Trocar `QR_SECRET` invalida todos os QR já impressos.** Guarde-o fora do repositório e faça backup.
- Os PDFs em `server/out/` contêm QR válidos: não versionar nem compartilhar.
- A câmera exige **HTTPS** (exceto `localhost`). A hospedagem precisa reescrever `/q/*` para `index.html` (SPA).

## Painel da equipe (`/admin`)

Acesso restrito, separado do visitante. Não há cadastro pela internet: as contas são criadas por linha de comando, a partir de `/server`:

```bash
ADMIN_PASSWORD='uma-senha-longa-de-12-ou-mais' npm run admin -- create equipe   # cria
ADMIN_PASSWORD='nova-senha-longa'              npm run admin -- set-password equipe
npm run admin -- unlock equipe      # tira o bloqueio por tentativas erradas (5 erros = 15 min)
npm run admin -- disable equipe     # desativa e encerra as sessões
npm run admin -- list
```

- Senhas com scrypt; 5 senhas erradas bloqueiam a conta por 15 min; limite de tentativas por IP.
- Sessão encerra após 30 min sem uso (e no máximo 12 h). O token fica só na aba do navegador.
- Telas: Visão geral, Ambientes (ativo/obrigatório, nome, número, descrição), Evento (nome, horários, modo de teste, abrir agora/pausar/retomar/encerrar na hora/reabrir; início e término automáticos com contagem regressiva), QR Codes (preparar → imprimir → ativar), Participantes (busca, CSV), Histórico, Relatórios (resumo na tela; PDF e XLSX completos).
- Renomear um ambiente (ou mudar o número) que já tem QR ativo cria sozinho uma versão **pendente**: a etiqueta impressa fica desatualizada até você reimprimir e ativar.
- O painel não entra no limite geral da API (que pode ser esgotado por visitantes no mesmo Wi-Fi) e se atualiza sozinho a cada 30 s.
- Ativar/desativar e marcar obrigatórios só antes da abertura do evento (o nº de peças da coleção depende disso).
- **Fotos dos ambientes** (aba Fotos): toque numa sala do mapa e envie, troque ou remova a foto do interior (no celular, "Tirar foto agora" abre a câmera). A foto é reduzida (WebP, até 1280 px), perde o GPS/EXIF e fica no banco (`room_photos`). O visitante a vê ao tocar na sala; toque na foto para ampliar. Uma foto por ambiente. Aceita JPEG, PNG e WebP (até 12 MB).
- **QR de entrada** (o que o visitante lê para abrir o app): aba QR Codes → cartaz A4 (PDF) ou só o QR (PNG). Usa `PUBLIC_APP_URL`; confira com um celular antes de imprimir.
- Rotas da API em `/api/admin/*`; toda alteração fica no histórico (`audit_log`).
- Na hospedagem, reescreva também `/admin/*` para `index.html` (como em `/q/*`).
- Exportações (CSV) contêm nomes completos: use só na operação e apague depois.
