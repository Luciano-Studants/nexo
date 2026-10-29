# NEXO — arquitetura inicial

## Identidade
- Produto: NEXO
- Edição inicial: PROCDIADAM · Edição do evento
- Frase: “Explore espaços. Descubra possibilidades.”
- Paleta: azul-marinho `#0A0D29`, dourado `#DBB13B`
- Interface: pt-BR, mobile-first e responsiva.

## Componentes
- `src/`: React + TypeScript + Vite; interface de entrada inicial.
- `server/`: API Express + TypeScript; health check e pool PostgreSQL opcional.
- `server/migrations/`: esquema relacional (UUID); `server/seeds/`: edição, 3 pisos e 29 ambientes; `legacy/`: esquemas antigos, só para consulta.
- `docs/`: decisões e lacunas do projeto.

## Regras de segurança a implementar/testar antes de produção
- Senhas do STAFF (quando o painel existir) sempre com hash forte (bcrypt ou Argon2); visitantes não têm senha.
- Visitante: token aleatório no localStorage (decisão do projeto: sem dados sensíveis, só progresso de jogo), enviado em `Authorization: Bearer`; o banco guarda só o hash. Mitigar XSS: CSP do Helmet, sem scripts de terceiros. STAFF: sessão por cookie HttpOnly/Secure/SameSite, expiração de 30 min (a implementar).
- Autenticação, lockout, permissões, validações e transações no servidor.
- Nunca enviar credenciais do banco ao frontend ou versionar `.env`.
- HTTPS obrigatório em produção; revisar CORS, limites de requisição, logs e backups.
- A tabela de auditoria não deve receber senhas, tokens ou segredos.

## Não implementado ainda
Painel administrativo; importação de planilhas; mapas oficiais; leitor QR; geração e impressão de QR; visitas; puzzle; relatórios; exclusão/retensão operacional automatizada; deploy e testes de carga.
