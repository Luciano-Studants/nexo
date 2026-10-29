# NEXO — como testar no seu computador

Passo a passo para rodar o sistema inteiro localmente (banco, servidor e site). Os comandos são para **Windows (PowerShell)**; em Mac/Linux muda só a variável de senha (indicado no passo 5).

## O que instalar antes (uma vez)
1. **Node.js 22 LTS** — https://nodejs.org (confira com `node -v`).
2. **Docker Desktop** — https://www.docker.com/products/docker-desktop (abra-o e espere iniciar).
3. **Git** — https://git-scm.com
4. (Opcional) VS Code.

## 1. Baixar o projeto
```powershell
git clone <ENDEREÇO-DO-REPOSITÓRIO>
cd nexo
```

## 2. Ligar o banco de dados
Na pasta `nexo`:
```powershell
docker compose up -d
```
Espere ~10 segundos. Se você já testou uma versão antiga e der erro `relation "events" already exists`, apague o banco local e recrie (**apaga os dados de teste**):
```powershell
docker compose down -v
docker compose up -d
```

## 3. Configurar e preparar o servidor
```powershell
cd server
npm install
npm run setup:env
npm run db:seed
```
- `setup:env` cria o arquivo `server/.env` com segredos aleatórios. Ele não vai para o repositório e **nunca deve ser enviado a ninguém**.
- `db:seed` cria as tabelas e os dados do evento (3 pisos, 29 ambientes). Pode repetir sem problema.

## 4. Criar o acesso do staff
```powershell
$env:ADMIN_PASSWORD="escolha-uma-senha-de-12-ou-mais-caracteres"
npm run admin -- create equipe
```
Mac/Linux: `ADMIN_PASSWORD='sua-senha-longa' npm run admin -- create equipe`

## 5. Ligar o servidor (deixe este terminal aberto)
```powershell
npm run dev
```
Teste: abra http://localhost:3000/api/health no navegador.

## 6. Ligar o site (abra um segundo terminal, na pasta `nexo`)
```powershell
npm install
npm run dev
```

## 7. Abrir
- Visitante: http://localhost:5173
- Staff: http://localhost:5173/admin (usuário `equipe` e a senha do passo 4)

## 8. Preparar o evento (faça uma vez, como staff)
1. Aba **Ambientes**: marque quais salas são **obrigatórias** (isso define as peças do quebra-cabeça). Só dá para mudar antes do evento abrir.
2. Aba **QR Codes**: selecione as salas, **Preparar**, baixe o PDF das etiquetas e depois **Ativar**.
3. Aba **Evento**: ative o **modo de teste** (ou toque em **Abrir agora**) para liberar as visitas.
4. (Opcional) Aba **Fotos**: envie a foto do interior de uma sala.

## 9. Roteiro de teste para os colegas
Marque o que funcionou e anote o que não:
- [ ] Entrar com nome e sobrenome; recebe avatar e vai ao mapa.
- [ ] Nome só com um nome (sem sobrenome) é recusado com mensagem clara.
- [ ] Trocar de piso no mapa; abrir as visões **Mapa**, **3D** e **Lista**; tocar numa sala e ver os detalhes (e a foto, se houver).
- [ ] Registrar visita por **código manual** (o código impresso na etiqueta): "Ler QR Code" → "Digitar código".
- [ ] Registrar visita lendo o **QR** (a câmera só funciona em `localhost` neste computador; em outro aparelho exige HTTPS).
- [ ] Ler o mesmo QR duas vezes: não conta de novo.
- [ ] Peça do quebra-cabeça liberada; progresso e percentual atualizados em "Sua coleção".
- [ ] Visitar todas as salas obrigatórias: aparece a imagem completa e a mensagem de parabéns.
- [ ] Fechar a aba, reabrir e entrar de novo com o mesmo nome: oferece retomar o perfil.
- [ ] No staff: pausar e retomar o evento; encerrar e reabrir; conferir que visita é bloqueada quando pausado/encerrado.
- [ ] No staff: aba **Relatórios** com números e download de **PDF** e **XLSX**.
- [ ] Usar no celular pelo navegador do computador reduzido (F12 → modo celular) e conferir se nada fica cortado.

Ao reportar um problema, envie: o que fez, o que esperava, o que aconteceu, o navegador e, se houver, a mensagem exibida no terminal do servidor.

## Problemas comuns
| Sintoma | Causa e solução |
|---|---|
| `docker compose` falha | Docker Desktop fechado: abra e espere iniciar. |
| `relation "events" already exists` | Banco antigo: `docker compose down -v` e `up -d` (passo 2). |
| Porta 5432 ocupada | Outro PostgreSQL local: pare-o ou feche o outro projeto. |
| Porta 3000 ou 5173 ocupada | Feche o outro programa ou reinicie os terminais. |
| Site abre mas dá erro ao entrar | O servidor (passo 5) não está rodando. |
| "Visitas ainda não abertas" | Ative o modo de teste ou **Abrir agora** (passo 8). |
| Câmera não abre | Permita a câmera no navegador e use `localhost`; ou use o código manual. |
| Esqueci a senha do staff | `$env:ADMIN_PASSWORD="nova-senha-longa"; npm run admin -- set-password equipe` (em `server`). |

## Rodar os testes automáticos (opcional)
- Site: na pasta `nexo`, `npm test`.
- Servidor: exige um banco separado com "test" no nome; veja o README.
