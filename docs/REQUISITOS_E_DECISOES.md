# Requisitos e decisões consolidados — NEXO

## Experiência
- Visitante usa o navegador do próprio celular, sem instalar aplicativo.
- Idioma pt-BR. Interface adaptável a celular, tablet e desktop.
- Navegação prevista: progresso, mapa e coleção; menu complementar com instruções, identidade e saída.
- Mapa visual por andar; lista não substitui o mapa.
- Não inventar planta, posição de sala ou interior. A planta oficial ainda será fornecida.
- A edição inicial é PROCDIADAM; NEXO deve permitir edições futuras.

## Entrada do visitante (decisão vigente, 20/10/2026)
- Entra pelo QR/link geral e informa só o **nome completo** (obrigatório, nome e sobrenome). Sem senha, usuário, e-mail ou verificação.
- O servidor cria um ID interno (UUID) e sorteia um avatar entre 12 chaves temporárias.
- O acesso do aparelho é um token guardado no **localStorage**; o banco guarda apenas o hash do token. Perdendo o aparelho/navegador, o perfil não é recuperável pelo próprio visitante.
- **Retomada:** se existir um perfil do mesmo evento com o **mesmo nome (sem diferenciar caixa/acento), o mesmo IP e atividade nas últimas 6 horas**, a API pergunta "é você?". Se sim, devolve um token novo e invalida o antigo; se não, cria um perfil novo. IP diferente = perfil novo. O staff não junta perfis manualmente.
- **Teto:** no máximo 60 perfis novos por IP por hora (configurável). O IP é guardado só como HMAC.
- Nomes duplicados são permitidos; o ID diferencia.
- Retenção: 30 dias após o evento, sem exclusão automática (`npm run db:purge`, simulação por padrão), pendente de aprovação institucional/LGPD.
- Aviso de privacidade curto na entrada (nome completo é dado pessoal): a implementar no frontend.

## Evento e visitas
- Fuso: America/Sao_Paulo.
- Antes da abertura: cadastro/instruções permitidos, visitas bloqueadas.
- Depois do encerramento: bloquear funcionalidades e mostrar mensagem de evento encerrado.
- QR por sala com token aleatório opaco validado no servidor. Leitura válida registra visita uma única vez e libera uma peça.
- Repetição da mesma sala não gera nova visita/peça.
- Leitor de câmera no navegador com HTTPS e alternativa de código manual.
- Cinco códigos manuais inválidos consecutivos: bloqueio por 5 minutos.
- Sala inativa sai da lista obrigatória; zero salas obrigatórias é erro de configuração.

## Mapa e puzzle
- Material de planta oficial indisponível. Fotografias institucionais existentes são referências visuais, não plantas.
- Usuário fornecerá desenhos por andar com posições reais das salas/corredores.
- Imagem exclusiva do puzzle ainda será definida; uma peça por sala obrigatória ativa.
- Conclusão revela imagem completa e mensagem de parabéns; sem certificado.

## Administração
- Uma conta administrativa compartilhada, criada/configurada com segurança no deployment; sem cadastro público e sem recuperação de senha.
- Sessão administrativa expira após 30 minutos de inatividade.
- CRUD de andares/salas, obrigatoriedade, estado, importação CSV/XLSX com prévia e validação.
- IDs internos imutáveis; preservar histórico. Sala com visitas não pode ser excluída; desativar com confirmação.
- Mudança de nome/andar exige novo QR e invalida versão anterior.
- QR: versão sequencial não reutilizada; status pendente/ativo/substituído/cancelado; no máximo um ativo por sala.
- Preparar/ imprimir/ verificar fisicamente/ ativar QR em fluxo controlado.
- Etiqueta A6 vertical por página e A4 com múltiplas etiquetas e linhas de corte.
- Relatórios por sala/andar, progresso individual, mais/menos visitadas, conclusão; exportação PDF/XLSX.
- Auditoria de ações administrativas, sem segredos.

## Privacidade e retenção
- Meta operacional inicial de até 300–1000 participantes, mais de 100 simultâneos; validar com teste de carga (150–200 simultâneos como alvo inicial).
- Política sugerida mais recente: retenção operacional por 30 dias após evento, mas não automatizar exclusão até aprovação institucional sobre LGPD, obrigações e backups. Relatórios devem ser exportados e preservados antes de qualquer exclusão.
- Aprovação institucional de política de privacidade/LGPD pendente.

## Pendências externas
- Plantas oficiais e posições reais das salas.
- Relação final de salas, andares e responsáveis.
- Imagem final do puzzle.
- Política institucional de privacidade/retenção e credenciais administrativas de deployment.
- Decisão e configuração final do provedor PostgreSQL e hospedagem.
