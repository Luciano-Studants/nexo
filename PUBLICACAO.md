# NEXO — publicação online (do ZIP até o ar)

Caminho recomendado (custo zero): **GitHub + Render (servidor) + Neon (banco)**. Um único endereço serve o site e a API. Tempo: cerca de 30 minutos.

> Este caminho foi preparado e testado em modo de produção no computador (site e API juntos, login do staff, leitor de QR, PDF). A publicação no Render em si não foi executada por quem escreveu este guia: se algum passo divergir da tela, siga a mensagem do Render ou peça ajuda.

## 0. Antes de começar
- Conta no **GitHub** e no **Render** (https://render.com; entre com o GitHub).
- **Git** e **Node 22** instalados no computador (https://git-scm.com, https://nodejs.org).
- Decida a **senha do staff** (mínimo 12 caracteres, misture letras, números e símbolos). Usuário: `admin_procidadan`.

## 1. Extrair o ZIP
1. Salve o `nexoV15.zip` numa pasta de trabalho (ex.: `C:\Projetos`).
2. Clique com o botão direito → **Extrair tudo**. Deve existir a pasta `nexo` contendo `package.json`, `render.yaml`, `server`, `src`, etc.

## 2. (Recomendado) Testar antes no seu computador
Siga `docs/TESTE_LOCAL.md`. Se funcionar aí, funciona online.

## 3. Colocar no GitHub
1. No GitHub: **New repository** → nome `nexo`, **Private**, sem README.
2. No terminal, dentro da pasta `nexo`:
```
git init
git add .
git commit -m "NEXO V15"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/nexo.git
git push -u origin main
```
Confira no GitHub que **não** existe nenhum arquivo `.env` (só `.env.example`).

## 4. Criar o banco grátis e permanente (Neon)
1. Crie conta em https://neon.com (sem cartão) → **New project** → nome `nexo` → região mais próxima (ex.: São Paulo, se disponível).
2. Na tela do projeto, **Connect** → copie a **connection string** (começa com `postgresql://`). Guarde: é uma senha.
3. O plano grátis é permanente (1 GB). O banco "dorme" após 5 minutos sem uso e acorda sozinho em instantes.

## 5. Publicar no Render
1. No Render: **New +** → **Blueprint** → escolha o repositório `nexo` → **Connect**.
2. Ele lê o `render.yaml` e propõe o serviço `nexo` (plano **Free**).
3. Quando pedir: **DATABASE_URL** = a connection string do Neon; **ADMIN_PASSWORD** = a senha do staff. Deixe `PUBLIC_APP_URL` vazio por enquanto.
4. **Apply**. Aguarde o primeiro deploy. Ao terminar, o serviço mostra o endereço, algo como `https://nexo-xxxx.onrender.com`.
5. Abra `https://SEU-ENDEREÇO/api/health`: deve mostrar `"status":"ok"` e `"database":"ok"`.

O que o deploy faz sozinho a cada início: aplica as migrações do banco, cria o evento, os 3 pisos e os 29 ambientes (sem apagar nada que a equipe já editou) e cria/atualiza a conta do staff.

## 5.1 Manter o site acordado (grátis)
O serviço grátis do Render dorme após 15 minutos sem acesso. Para ele não dormir, use um monitor externo gratuito que abra o endereço a cada poucos minutos:
1. Crie conta em https://uptimerobot.com (ou serviço equivalente).
2. **Add New Monitor** → tipo **HTTP(s)** → URL `https://SEU-ENDEREÇO/api/ping` → intervalo de **5 minutos** (ou o menor que o plano grátis permitir; confira, deve ser menor que 15).
3. Use `/api/ping` (e não `/api/health`): ele não acorda o banco, e assim o plano grátis do Neon não gasta suas horas de uso.
4. O plano grátis do Render dá 750 horas por mês, o que cobre um serviço ligado o mês todo. Dormir só volta a acontecer se o monitor parar.
5. **Para segurança extra no evento**, mude o serviço para o plano pago (Starter) só nos dias do evento: **Settings → Instance Type**. Confira o preço atual.

## 6. Informar o endereço público (obrigatório antes de imprimir QR)
1. No Render → serviço `nexo` → **Environment** → `PUBLIC_APP_URL` = `https://SEU-ENDEREÇO` (sem barra no final) → **Save**. O serviço reinicia.
2. Se tiver domínio próprio (recomendado para o evento), configure em **Settings → Custom Domains** e use esse endereço em `PUBLIC_APP_URL`. **Defina o endereço definitivo antes de imprimir**: os QR guardam o endereço.

## 7. Entrar no painel do staff
- Endereço: `https://SEU-ENDEREÇO/admin`
- Usuário: `admin_procidadan` — Senha: a que você digitou no passo 4.

## 8. Onde mudar a senha do staff
- **Online (Render):** serviço `nexo` → **Environment** → edite `ADMIN_PASSWORD` (e, se quiser, `ADMIN_USER`) → **Save**. Ao reiniciar, a senha é atualizada e as sessões abertas são encerradas.
- Para trocar o **usuário**: altere `ADMIN_USER`; isso cria uma conta nova com a senha informada (a antiga continua existindo; para desativá-la é preciso um terminal com acesso ao banco: `npm run admin -- disable usuario-antigo`).
- **No computador (teste local):** `$env:ADMIN_PASSWORD="nova-senha-longa"; npm run admin -- set-password admin_procidadan` (dentro de `server`).
- Nunca envie a senha por e-mail/WhatsApp em texto aberto nem a coloque no repositório.

## 9. Preparar o evento (como staff)
1. **Evento:** confira o nome; defina **início e término** (7 de novembro, horário de Brasília) ou use **Abrir agora**/**Encerrar evento** manualmente.
2. **Ambientes:** marque as salas **obrigatórias** e confirme os nomes/números (só dá para mudar antes da abertura).
3. **Fotos:** envie a foto do interior das salas.
4. **QR Codes:** **Preparar** → baixar o PDF (A6 ou A4) → **Ativar** → imprimir.
5. **QR de entrada:** na mesma aba, baixe o cartaz do QR geral (aponta para o endereço do passo 5).
6. Teste ponta a ponta com um celular real (HTTPS já está ativo no Render, então a câmera funciona).

## 10. Cuidados para o dia do evento
- **Hospedagem grátis:** o Render grátis pode reiniciar a qualquer momento e o primeiro acesso após dormir leva cerca de 1 minuto; o monitor do passo 5.1 reduz isso, mas não é garantia. Para o dia do evento, o plano pago é a opção mais segura.
- **Banco (Neon grátis):** permanente e sem prazo de expiração, mas tem limite de horas de uso por mês; com o monitor em `/api/ping` o consumo é pequeno. Se o limite acabasse, o banco para até o próximo ciclo. **Não há backup automático:** baixe os relatórios (PDF/XLSX) depois do evento.
- **QR_SECRET:** o Render gerou um valor. Copie-o (Environment → mostrar) e guarde num lugar seguro: se o serviço for recriado com outro segredo, todos os QR impressos deixam de valer.
- **Carga:** o sistema ainda **não passou por teste de carga** (meta: 150–200 acessos simultâneos). Faça um ensaio com várias pessoas antes, no mesmo local/Wi-Fi.
- **Privacidade (LGPD):** defina com a instituição o texto de privacidade e o prazo de retenção (hoje 30 dias) antes de abrir ao público.
- **Atualizações:** cada `git push` na branch `main` publica de novo automaticamente.

## Alternativas
- **Mais controle e sem dormir, de graça:** uma máquina virtual do Oracle Cloud "Always Free" (exige cartão e que você administre servidor, HTTPS e atualizações; o limite gratuito foi reduzido em 2026, confira). Roda o mesmo sistema com Docker ou Coolify, com PostgreSQL na própria máquina.
- **Pago e simples:** Render pago + Neon (ou o banco do Render pago, com backup).
- Qualquer hospedagem com Node 22 serve: build `npm install --include=dev && npm run build && cd server && npm install`, início `cd server && npm run start:prod`, variáveis do `server/.env.example`.
- **Vercel/Netlify/Cloudflare** não servem para o servidor (funções que sobem e descem a cada acesso); só para um site estático.

## Problemas comuns
| Sintoma | O que fazer |
|---|---|
| Deploy falha no build | Veja o log no Render; confirme que o `render.yaml` está na raiz do repositório. |
| `/api/health` mostra `database: error` | Banco ainda iniciando ou `DATABASE_URL` errada: aguarde e reinicie o serviço. |
| Não consigo entrar no `/admin` | Confira `ADMIN_USER`/`ADMIN_PASSWORD` no Environment e o log de início ("Conta de staff … criada/atualizada"). 5 erros seguidos bloqueiam por 15 min. |
| QR impresso abre endereço errado | `PUBLIC_APP_URL` estava vazio/errado ao preparar: corrija e prepare novas versões dos QR. |
| Site lento no primeiro acesso | Serviço dormindo: confira o monitor (passo 5.1). |
| `/api/health` com `database: error` no primeiro acesso | O Neon estava acordando; tente de novo em alguns segundos. Se persistir, confira `DATABASE_URL` e `DATABASE_SSL=true`. |
