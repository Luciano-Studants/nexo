# Migrações PostgreSQL

1. Configure `DATABASE_URL` localmente em `server/.env` (não compartilhe nem versione o arquivo).
2. Revise `001_initial_schema.sql` antes de aplicar em qualquer banco.
3. Execute o SQL no editor SQL do provedor ou com uma ferramenta de migração aprovada.
4. Confirme a execução e faça backup antes de qualquer mudança destrutiva.

Ainda não há executor automático de migrações. O esquema é uma base inicial e não significa que os fluxos de autenticação, QR, visitas ou administração já estejam implementados.
