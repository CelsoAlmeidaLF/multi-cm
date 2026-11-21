---
tipo: threat-model
titulo: Threat model - sincronização entre celulares do BarGestão (sessão ponto a ponto)
projeto: BarGestão (stk-app-multi-cm)
autor: Pedro (Cyber Security)
data: 2026-10-21
status: rascunho para decisão do Celso; antes de qualquer código
metodologia: STRIDE por componente + CVSS 3.1 (estimativa de projeto, a recalcular com o código real)
base: main v3.1.0 e PR #13 (v3.2.0, equipe/perfis/remover usuário)
relacionados: docs/sync/SPEC-sync-celulares.md, docs/sync/ADR-001-sync-relay-cifrado.md (Paulo; não existiam na data da escrita)
---

# Threat model: sincronização entre celulares (BarGestão)

## 0. Decisão vigente e premissas

Decisão do Celso (21/10/2026, refinada): cada funcionário usa o próprio celular, vinculado ao aparelho; todos veem as mesmas comandas, estoque e caixa; remover o usuário bloqueia o celular. **O Firebase NÃO guarda dado do bar, nem cifrado.** Os dados passam direto entre os aparelhos numa **sessão** aberta. Custo zero e local-first.

Desenho assumido (o ADR do Paulo ainda não existia; onde o ADR divergir, este documento deve ser revisado):

- Transporte: WebRTC DataChannel entre os celulares. Firestore só para **sinalização efêmera** (oferta, resposta, ICE), apagada ao conectar ou por TTL. Alternativas aceitas: mesma rede local; QR code.
- Cada celular mantém o próprio cofre local (OPFS, chave dos dados embrulhada pela senha do usuário, `deviceSeal`) e sua cópia completa dos dados. Não há cópia "na nuvem": a verdade é a união dos aparelhos.
- Sem servidor próprio e sem Cloud Functions (plano gratuito): nada no servidor valida assinatura ou papel. Toda a confiança é verificada nos aparelhos.

Mudança de natureza do risco: sem relé que guarde dado, somem as ameaças de "vazamento de histórico no servidor" e "ex-funcionário lê o relé". Em troca, a segurança passa a depender de (a) autenticação mútua dos pares independente do Firestore, (b) integridade e papel das operações aplicadas, (c) o que cada celular guarda e por quanto tempo, (d) revogação sem servidor central (o aparelho roubado nunca é "desligado"; só deixa de ser aceito pelos outros).

## 1. Veredito

**Dá para fazer com segurança, desde que o SPEC garanta as condições C1 a C8 (seção 6).** Sem elas, a feature vira a maior superfície de ataque do app: um aparelho de ex-funcionário ou um intruso na sinalização poderia injetar oferta, entrar na sessão e ler ou adulterar comandas, estoque e caixa.

O modelo P2P é melhor que o relé cifrado para o objetivo do Celso (nada fica em servidor de terceiros). Os custos reais: (1) sincroniza só quando há conexão entre aparelhos; em 4G/CGNAT sem TURN pode simplesmente não conectar; (2) sem servidor, revogação é por convergência dos pares, com janela de exposição; (3) todo celular com acesso tem cópia integral dos dados e não há como apagá-la à distância.

## 2. Ativos, atores e fronteiras de confiança

**Ativos:** comandas e vendas; estoque; caixa e turnos (fraude financeira); cadastro de usuários e perfis; identidade do aparelho (chave); raiz de confiança do estabelecimento (quem assina o cadastro de aparelhos); fingerprints DTLS e segredos de sessão; trilha de auditoria.

**Atores:** gerente (confiável, mas pode perder o celular); operador (confiável parcialmente: pode ser fraudador interno); ex-funcionário com celular ainda vinculado; ladrão com celular desbloqueado ou bloqueado; atacante de rede na mesma Wi-Fi; atacante remoto com ID de sessão vazado; operador do Firebase/Google (curioso, não adversário ativo); atacante de cota (esgotar plano gratuito).

**Fronteiras:** celular <-> celular (DTLS); celular <-> Firestore (sinalização); celular <-> STUN; cofre local <-> código JS (mesma origem); backup (arquivo) <-> celular.

### Componente raiz: o que prova que um aparelho é "do estabelecimento"

Como não há servidor, é preciso uma raiz de confiança do estabelecimento: um par de chaves de assinatura (raiz) que **só aparelhos de gerente** usam. O gerente assina o **cadastro de aparelhos (roster)** e **certificados de aparelho de validade curta**. O UID de governança do estabelecimento NÃO serve como credencial entre aparelhos (é identificador semipúblico, lido por id nas regras atuais).

---

## 3. STRIDE por componente

Legenda: Prob = probabilidade (B/M/A). CVSS 3.1 estimado. Sev = Crítica/Alta/Média/Baixa.

### 3.1 Sinalização (Firestore efêmero)

Estado atual das regras (`PACOTES/stk-pkt-doacao/firestore.rules`): o BarGestão **não usa Firebase Auth**; a proteção é App Check (imposto no projeto, não nas regras) + esquema + "ler por id". Não há hoje coleção de sessão. Qualquer coleção nova de sinalização herdaria esse modelo fraco (qualquer cliente com App Check válido cria documentos).

| ID | STRIDE | Cenário | Impacto | Prob | CVSS | Sev | Controle |
|---|---|---|---|---|---|---|---|
| SG-01 | Spoofing / Tampering (MITM) | Atacante que conhece o ID da sessão (vazou, adivinhou, ou é o próprio Google) lê a oferta e posta uma **resposta falsa** (ou troca a oferta) com o DTLS fingerprint dele. O celular conecta no atacante, que repassa para o par real (MITM completo) ou entrega snapshot falso. | Leitura e adulteração de comandas, estoque e caixa; fraude | M | 8.1 (AV:N/AC:H/PR:N/UI:N/C:H/I:H/A:N) | Alta | **Autenticação dos pares independente do Firestore**: cada lado assina (chave do aparelho, certificado do roster) o par de fingerprints DTLS (local+remoto) + ID da sessão + nonces de ambos. O par verifica contra o roster que ele próprio tem. Oferta/resposta sem assinatura válida de aparelho vinculado é descartada. Reforço: confirmação visual de código curto (SAS) no vínculo inicial. A sinalização é tratada como canal **não confiável** por definição. |
| SG-02 | Info disclosure | ICE/SDP no Firestore expõe IP privado (LAN), IP público, portas, tipo de rede de cada aparelho, a quem tem o ID (e ao Google). | Mapeia rede do bar; facilita ataque local | A | 5.3 | Média | Cifrar SDP/ICE com chave derivada do segredo da sessão (>= 128 bits, via QR/código), não com código curto. Usar candidatos mDNS do Chrome; não enviar candidatos `host` brutos se evitável. O que sobra inevitável: existência, tamanho, horário e IP de origem das gravações (ver 3.1.1). |
| SG-03 | Spoofing | Enumeração de IDs de sessão curtos (ex.: 6 dígitos) por `get`. | Descobre sessões ativas; esgota cota de leitura | M | 5.3 | Média | ID de sessão >= 80 bits aleatórios (8 palavras BIP39-pt reaproveitam o pacote existente), negar `list`. Código curto numérico só como SAS de confirmação, nunca como chave de busca ou de cifra. |
| SG-04 | DoS / abuso de cota | Script com token App Check válido (reCAPTCHA Enterprise não impede automação em browser real) cria milhares de documentos de sinalização. Plano gratuito: cota diária de escritas/leituras (verificar valores vigentes no console; ordem de 20 mil escritas e 50 mil leituras por dia). | **Mesmo projeto `systekna-feedback` serve governança, kill-switch e feedback dos outros apps**: cota estourada derruba tudo, inclusive licença do BarGestão | M | 7.5 (A:H) | Alta | **Projeto Firebase separado só para sinalização** (isola a cota; Spark não cobra, só bloqueia). Regras: criar-apenas, tamanho máx. (ex. <= 4 KB), `expiresAt` obrigatório curto, `request.time` coerente, ID formato fixo, sem update. TTL do Firestore **não é imediato**: o cliente apaga ao conectar e a regra impede leitura após expirar. Orçamento por sessão (nº de docs) e backoff exponencial no cliente. Alarme de cota no console (manual). |
| SG-05 | Tampering | Qualquer portador do ID apaga ou sobrescreve a sinalização de outra sessão (DoS dirigido). | Sessão não abre | B | 4.3 | Baixa | Sem `update`; `delete` só do criador (token de posse dentro do documento, comparado nas regras) ou só por TTL. Aceitar DoS local como baixo: o atacante precisa do ID. |
| SG-06 | Repudiation | Não há prova de quem abriu a sessão. | Sem rastro | B | - | Baixa | Auditoria local assinada no aparelho (quem entrou, quando, com qual certificado). O Firebase não é fonte de auditoria. |
| SG-07 | EoP | Alguém reaproveita as regras de sinalização para gravar nas coleções de governança. | Elevação | B | - | Baixa | Coleções e funções de regra isoladas; teste de regras no emulador (a suíte `rulestest` já existe) cobrindo "sinalização não toca governança". Isto é só especificação: não alterar regras agora. |

#### 3.1.1 O que a sinalização ainda expõe (inevitável)

Para o Firebase/Google e qualquer portador do ID: existência e duração da sessão; horários de abertura (padrão de funcionamento do bar); quantos documentos (tamanho aproximado = nº de aparelhos); IP público e user agent de cada aparelho que grava (inclui reCAPTCHA Enterprise, que já vê o dispositivo/navegador); sinais de rede. **Não vê** conteúdo, produtos, valores. Dado pessoal (IP de funcionário) é tratado pelo Google: tema LGPD para o Celso (ver seção 7). Se a sinalização trafegar só por QR/LAN, esta exposição some.

### 3.2 Entrada na sessão (autorização)

| ID | STRIDE | Cenário | Impacto | Prob | CVSS | Sev | Controle |
|---|---|---|---|---|---|---|---|
| EN-01 | Spoofing/EoP | Aparelho removido, ex-funcionário ou desconhecido tenta entrar na sessão com o código válido. | Acesso total aos dados | A | 8.8 | Alta | O código de sessão é só rendezvous. Entrada exige: certificado de aparelho assinado pela raiz do estabelecimento, **não revogado e não expirado**, aparelho com chave privada que assina o handshake. Sem isso a conexão é encerrada antes de qualquer dado. |
| EN-02 | Spoofing | Código/QR da sessão fotografado, vazado no grupo de WhatsApp ou visto por cliente. | Atacante tenta entrar | M | 4.0 | Média | Código com validade curta (ex. 2 a 5 min), uso único por aparelho, fecha após o último par esperado. Mesmo vazado, não basta (EN-01). Gerente vê "aparelho X pede entrada" e aprova no caso de aparelho novo. |
| EN-03 | EoP | **Vínculo de aparelho novo**: atacante em pé ao lado do gerente / vínculo remoto interceptado. | Aparelho malicioso vira confiável | M | 8.1 | Alta | Vínculo só presencial por padrão: o aparelho novo mostra QR com fingerprint da sua chave pública; o gerente escaneia no celular DELE e aprova (assina o certificado, perfil `operador` ou `gerente`). Vínculo remoto só com SAS lido por voz e janela curta. Aprovação **só em aparelho de gerente**, com PIN reconfirmado. Quantidade máxima de aparelhos por usuário = 1 (decisão do Celso); trocar de celular = novo vínculo aprovado. |
| EN-04 | Tampering | Operador malicioso modifica o app (DevTools) e se auto-promove a `gerente` nas mensagens. | Aprova aparelhos, ajusta caixa | M | 8.1 | Alta | Perfil **não é afirmado pelo remetente**: vem do certificado assinado pela raiz. Receptores verificam que o tipo da operação é permitido ao perfil do autor (gerente-only: vincular, remover, fechar caixa, ajustes, importar backup). Aplicação client-side apenas não basta: **todo par reaplica a regra**. |
| EN-05 | Info disclosure (insider) | Todo operador recebe todos os dados (caixa, estoque, custos), por decisão. | Leitura ampla por operador | A | 5.5 | Média | Aceito por design; reduzir com retenção local mínima no operador (ver LP-02) e canais separados por papel (caixa/relatórios só com gerente) se o Celso decidir. |

### 3.3 Canal entre pares (DataChannel) e integridade das operações

| ID | STRIDE | Cenário | Impacto | Prob | CVSS | Sev | Controle |
|---|---|---|---|---|---|---|---|
| CN-01 | Tampering/Replay | Aparelho (ou MITM que falhou SG-01) reenvia operação antiga ("pagar comanda", "baixar estoque") ou a duplica. | Receita/estoque duplicados ou perdidos | M | 7.1 | Alta | Cada operação: `{id aparelho, contador monotônico por aparelho, hash da anterior, relógio lógico híbrido}`, assinada pelo aparelho **autor** (não pelo host) sobre o corpo. Receptor guarda o maior contador visto por aparelho; repetição é descartada (idempotente); salto ou contador repetido com conteúdo diferente = fork -> alerta ao gerente. Nonce AEAD por mensagem de canal vem de contador, não aleatório. |
| CN-02 | Tampering | Dados de outro celular com conteúdo hostil: payload gigante, `__proto__`, campos inesperados, string com HTML. | **XSS entre pares** em PWA cuja origem guarda o cofre = comprometimento total do aparelho; DoS | M | 8.8 | Alta | Validação de esquema estrita e tamanho antes de aplicar (reuso do padrão de `BackupService.parse`). Somente `textContent`/nós DOM; hoje existem 4 usos de `innerHTML` (`CashController.js`, `App.js`): auditar para que nenhum receba dado remoto. Rejeitar chaves proibidas. Limite de taxa por par. Nota: CSP `connect-src` **não cobre WebRTC**; um XSS exfiltraria por DataChannel/ICE sem barreira de CSP. Logo, prevenção de XSS passa a ser a única barreira. |
| CN-03 | Tampering | Relógio do celular adulterado (data futura) para vencer conflito "última escrita ganha" e sobrescrever vendas dos outros ou backdatar caixa. | Fraude silenciosa | M | 6.5 | Média | HLC com limite de deriva (rejeitar timestamps além de ± X min da média dos pares); resolução por regras de domínio (comanda fechada não reabre sem gerente; estoque por **movimentos** somados, nunca por valor absoluto). Fechamento de caixa só gerente. |
| CN-04 | Tampering | Operação destrutiva legítima mas perigosa ou maliciosa: apagar comanda, zerar estoque, "importar backup", reset. | Perda de dados em todos os aparelhos | M | 7.5 | Alta | Exclusões como tombstone reversível; operações em massa e import só `gerente`; **snapshot local automático antes de aplicar lote remoto grande**, com desfazer; nada apaga histórico de caixa. |
| CN-05 | Info disclosure | Canal sem confidencialidade dupla. | - | B | - | Baixa | DTLS do DataChannel já cifra e autentica o transporte, **desde que a identidade do par esteja amarrada ao fingerprint** (SG-01). Camada de aplicação com chave de sessão (ECDH efêmero + HKDF ligado aos fingerprints) é recomendada para dar forward secrecy por sessão e antirreplay no nível da mensagem. |
| CN-06 | DoS | Par autenticado inunda o canal. | Celular trava (bar em horário de pico) | B | 4.3 | Baixa | Quotas por par, tamanho máx. de mensagem, backpressure do DataChannel. |

### 3.4 Host da sessão comprometido

Se houver um host (o aparelho que abre a sessão, ou o "mais atualizado"), ele é o ponto único de confiança prática.

| ID | STRIDE | Cenário | Impacto | Prob | CVSS | Sev | Controle |
|---|---|---|---|---|---|---|---|
| HO-01 | Tampering | Host adulterado (operador malicioso ou celular infectado) envia **snapshot inicial falso** ou altera operações ao retransmitir. | Todos adotam estado fraudulento | B-M | 8.1 | Alta | Host é **retransmissor**, nunca autor da verdade: operações carregam assinatura do aparelho autor (CN-01), então o host não consegue forjar nem alterar, só omitir/atrasar/reordenar. Snapshots: assinados pelo gerente (checkpoint periódico) ou conferidos por hash de cabeça da cadeia com >= 2 pares; divergência -> alerta e bloqueio. Preferir malha completa (todos conectam a todos; até ~5 a 8 aparelhos é viável) a estrela. |
| HO-02 | DoS | Host sai, bloqueia ou omite operações (censura). | Parte do bar sem dado novo | M | 5.3 | Média | Qualquer par pode virar anfitrião; reconciliação por vetor de versões; indicador "atualizado até" visível ao usuário. |
| HO-03 | Elevation | O host também é quem recebe o pedido de entrada do aparelho novo. | Aprovação indevida | B | 6.5 | Média | Aprovação de aparelho novo só por assinatura de gerente; o host sem papel de gerente não consegue validar entrada. |

### 3.5 Aparelho do funcionário e cofre local

Fatos do código: cofre por usuário com chave dos dados embrulhada pela senha (PBKDF2); PIN com `deviceSeal` por chave não extraível do aparelho; contador de falhas do PIN dentro dos dados selados; achado em aberto da reavaliação de 14/10: o PIN não entra na derivação (só `deviceSeal`), e importação de backup sem autenticação forte (`SecurityController` ~327). O modelo do Celso para o PIN é "olhares curiosos". Para sync isso não basta sozinho, por isso o aparelho vira **membro de uma rede de confiança**.

| ID | STRIDE | Cenário | Impacto | Prob | CVSS | Sev | Controle |
|---|---|---|---|---|---|---|---|
| LP-01 | Spoofing/Info | **Celular perdido ou roubado no meio do turno, desbloqueado, com sessão ativa.** | Leitura imediata de tudo e injeção de operações até a revogação | M | 7.6 (AV:P/AC:L/PR:N/UI:N/C:H/I:H) | Alta | Bloqueio automático por inatividade (`BackgroundLockPolicy`) deve **fechar o DataChannel e zerar chaves de sessão**; reentrada exige desbloqueio do cofre. Revogação imediata: gerente remove o aparelho de qualquer celular dele; certificados com validade curta (ex. 7 a 14 dias, renovados em sessão). Peers que receberem a revogação derrubam e rotacionam a chave de sessão. |
| LP-02 | Info disclosure | **Cópia local completa não pode ser apagada à distância** (offline-first). Ladrão mantém o celular fora da rede e extrai dados do cofre (PIN curto, PBKDF2) em ataque offline. Raiz/ADB/DevTools permitem usar a chave não extraível dentro do navegador para testar PINs. | Todo o histórico guardado no celular | M | 6.8 | Média | Minimizar retenção no operador (ex.: comandas abertas + últimos N dias; caixa/relatório históricos só no gerente). Senha forte em aparelhos com perfil gerente (já existe tipo `password` no cofre). Contador de falhas e bloqueio crescente; wipe local opcional após N falhas **(aceitar que atacante offline contorna restaurando o arquivo)**. Exigir bloqueio de tela do Android como pré-requisito declarado. |
| LP-03 | Spoofing | **Clonagem do aparelho**: cópia do perfil do navegador ou restauração de backup do sistema carrega a chave e o certificado para outro celular. | Dois aparelhos com a mesma identidade | B | 6.5 | Média | Contador monotônico por aparelho + detecção de fork (CN-01) revela clone; gerente revoga. Preferir credencial **WebAuthn/passkey** (já há uso de PRF na biometria) como chave do aparelho onde o Android suportar; fallback chave P-256 não extraível. Declarar: web não atesta hardware; "vinculado ao aparelho" é uma garantia **forte, não absoluta**. |
| LP-04 | Repudiation | Funcionário nega ter feito cancelamento ou ajuste. | Disputa trabalhista/fraude | M | - | Média | Operações sensíveis assinadas pelo aparelho autor; auditoria local encadeada (hash) em todos os pares. |
| LP-05 | EoP | O usuário do aparelho edita o app localmente e se dá permissão. | Ver EN-04 | M | 8.1 | Alta | Receptores validam; o app local é não confiável do ponto de vista dos outros pares. |
| LP-06 | Tampering | Remover usuário (v3.2.0 troca a chave do cofre **localmente**) não é o mesmo que revogar o **aparelho**. | Aparelho continua aceito pelos pares | A | 8.1 | Alta | "Remover usuário" no SPEC deve ser uma operação do **roster** (revoga certificado do aparelho + remove o perfil nos pares), assinada pelo gerente, propagada a todos; só então cada par executa a troca local. A UI deve mostrar "revogação pendente em N aparelhos" até confirmar. |

### 3.6 Revogação, aparelho offline que volta, ex-funcionário

Sem servidor, a revogação é **eventual**: um par que estava offline continua aceitando o revogado.

| ID | STRIDE | Cenário | Impacto | Prob | CVSS | Sev | Controle |
|---|---|---|---|---|---|---|---|
| RV-01 | EoP | Ex-funcionário volta com o celular e entra numa sessão com um par que ainda não soube da revogação. | Acesso a dados novos; reinjeção de operações | M | 7.5 | Alta | (a) Roster com **versão monotônica assinada**; no handshake o par com roster mais antigo deve aceitar o mais novo antes de continuar (a revogação "se espalha" por quem se encontra). (b) **Validade curta do certificado** limita a janela do aparelho que ficou offline. (c) Gerente reemite o roster ao abrir sessão. |
| RV-02 | Tampering | Aparelho volta de dias offline e envia operações antigas ou "de fora do contexto". | Sobrescreve estado atual; replay | M | 6.5 | Média | Operações aplicadas por regra de domínio e contador (CN-01); estado de comanda fechada imutável; reconciliar por vetor de versões, nunca por "ganha o mais recente". Operações offline de usuário removido **depois** do fato: política a decidir (rejeitar ou colocar em quarentena para o gerente decidir). |
| RV-03 | Info | Ex-funcionário já tem a cópia dos dados e o backup que ele mesmo fez. | Dados do período em que trabalhou | A | - | - | **Não é mitigável tecnicamente.** Mitigação contratual/LGPD. Risco aceito (seção 7). |
| RV-04 | Tampering | **Rotação de chave**: ao remover alguém, a chave de sessão/identidade continua válida para ele. | Leitura de sessões futuras | M | 7.5 | Alta | A confidencialidade vem de DTLS + chave de sessão efêmera por sessão (não existe chave de estabelecimento de longa duração que precise "rotacionar"). Se o SPEC introduzir segredo de longa duração (ex.: chave de dados compartilhada), ele deve ter época e ser rotacionado a cada remoção, reembrulhado individualmente para cada aparelho restante. Recomendo **não** introduzir segredo compartilhado permanente. A raiz do estabelecimento (assinatura) só muda se o aparelho de gerente for perdido (ver RV-05). |
| RV-05 | EoP | **Celular do gerente (raiz) perdido ou roubado**. | Atacante assina novos aparelhos | B | 9.0 | Crítica | A chave raiz nunca em 1 aparelho só: pelo menos 2 aparelhos de gerente, ou a frase de recuperação (12 palavras) como cópia offline. Procedimento de **recomeço do estabelecimento**: nova raiz, todos os aparelhos re-vinculados presencialmente. A assinatura da raiz exige PIN/biometria recente. Este é o ponto de maior consequência e menor frequência. |

### 3.7 STUN/TURN de terceiros

| ID | Cenário | O que o terceiro vê | Controle |
|---|---|---|---|
| ST-01 | STUN público (ex. do Google) para descobrir IP/porta pública | IP público do aparelho, horário, porta; **nenhum conteúdo** (STUN não carrega dados) | Aceitar STUN público; listar servidores configuráveis; sem cookies/credenciais. Em LAN pura, desabilitar STUN (candidatos `host`/mDNS apenas). |
| ST-02 | TURN **fora de escopo** (pago) | Se existisse: veria tráfego DTLS cifrado e metadados | Sem TURN: sincronizar só quando houver caminho direto. Redes móveis (CGNAT) e Wi-Fi com isolamento de clientes podem falhar. Mensagem clara ao usuário; fallback por QR/LAN. **Nunca** usar TURN público gratuito sem decisão do Celso (mesmo com DTLS, vê metadados e pode degradar). |
| ST-03 | Servidor STUN/ICE malicioso responde candidato falso | Pode desviar a conexão (não quebra DTLS se SG-01 estiver ok) | A autenticação por fingerprint assinada (SG-01) torna o desvio apenas DoS. |

Disponibilidade é o custo honesto do desenho: **sem TURN, a sync em 4G entre aparelhos em redes diferentes é "melhor esforço"**.

### 3.8 App Check

| ID | Cenário | Impacto | Controle |
|---|---|---|---|
| AC-01 | App Check (reCAPTCHA Enterprise) atesta "é o meu site", **não** quem é o usuário nem o aparelho. Tokens podem ser obtidos por automação em browser real. | Falsa sensação de autenticação | Tratar App Check apenas como redução de abuso. Não depender dele para autorização. Autorização = assinatura do aparelho verificada pelos pares (SG-01, EN-01). |
| AC-02 | Se o Celso preferir, adicionar Firebase Auth anônimo para amarrar cota/regras a um UID por aparelho | Melhora rastreio de abuso, mas expõe um identificador estável por aparelho ao Firebase | Decisão (seção 7). Recomendo **sem Auth** para minimizar metadado, aceitando regras mais frouxas e o isolamento por projeto separado (SG-04). |

### 3.9 Backups

| ID | STRIDE | Cenário | Impacto | Prob | CVSS | Sev | Controle |
|---|---|---|---|---|---|---|---|
| BK-01 | Spoofing/EoP | Backup restaurado num celular novo "herda" identidade de aparelho e certificado. | Aparelho não aprovado ingressa | M | 7.1 | Alta | Backup **nunca** contém chave privada do aparelho, certificado nem roster confiável (o `BackupService.parse` já remove PIN e `deviceSeal`; incluir o novo material de sync nessa lista). Restaurar dados num aparelho novo = aparelho **não vinculado** até o gerente aprovar. |
| BK-02 | Tampering | Restaurar backup antigo num aparelho já vinculado (rollback) faz contador/estado regredirem e gerar falso fork, ou apagar vendas ao sincronizar. | Perda/duplicidade | M | 6.5 | Média | Import de backup vira uma operação assinada do aparelho (`import`, só gerente), tratada por mesclagem, nunca por substituição do estado; autenticação forte para importar (achado aberto de 14/10). |
| BK-03 | Info | Backup em Drive/WhatsApp contém dados de todos os usuários. | Vazamento | M | 6.5 | Média | Já cifrado; manter senha forte exigida e alertar que backup de gerente contém tudo. |

### 3.10 Mapa de ameaças de metadado e de abuso (resumo)

- **Vazam para o Firebase/Google:** existência, horário e duração das sessões; nº de documentos de sinalização; IP público e user agent; reCAPTCHA. Padrões de horário revelam funcionamento do bar.
- **Não vazam:** produtos, preços, vendas, nomes de usuário, valor do caixa, **tamanho de operações** (o tráfego P2P não passa pelo Firebase). Isto elimina a maior parte do vazamento por tamanho/frequência do desenho de relé.
- **Para STUN:** IP e horário.
- **Cotas:** só a sinalização consome cota; tamanho e frequência controlados; projeto separado.

---

## 4. As 5 ameaças mais graves

1. **SG-01 MITM na sinalização** (CVSS ~8.1): controle = assinatura do fingerprint DTLS por chave de aparelho vinculado, verificada contra o roster; SAS no vínculo.
2. **LP-06 / EN-01 / RV-01 Revogação ineficaz** (aparelho removido continua aceito por pares desatualizados; remover usuário local != revogar aparelho): roster versionado e assinado, validade curta do certificado, propagação no handshake.
3. **CN-02 Dado remoto hostil -> XSS** no PWA que guarda o cofre (CSP não cobre WebRTC): schema estrito, `textContent`, auditoria dos `innerHTML`.
4. **EN-04 / LP-05 Operador adulterado se promove** e aprova aparelhos ou ajusta caixa: perfil só do certificado assinado pela raiz; todos os pares reaplicam as regras.
5. **RV-05 Perda do celular raiz do gerente** (CVSS ~9.0, rara): pelo menos 2 aparelhos de gerente ou recuperação por 12 palavras; procedimento de recomeço com re-vínculo presencial. Menção: **SG-04** (esgotar cota do projeto compartilhado com governança) é a mais provável de acontecer; o controle é projeto Firebase separado.

## 5. Requisitos de segurança para o SPEC

Marcados R-SYNC-nn. "Obrigatório" = bloqueia implementação.

| ID | Requisito | Prioridade |
|---|---|---|
| R-SYNC-01 | Autenticação mútua dos pares independente do Firestore: assinatura do aparelho sobre (fingerprint DTLS local + remoto, ID da sessão, nonces). Sinalização é canal hostil. | Obrigatório |
| R-SYNC-02 | Roster de aparelhos assinado pela raiz do estabelecimento (só gerente), versão monotônica, lista de revogados; certificados de aparelho com validade curta e renovação em sessão. | Obrigatório |
| R-SYNC-03 | Entrada: só aparelho vinculado, não revogado, não expirado; aprovação do gerente com reconfirmação de PIN; código de sessão curto-prazo (2 a 5 min), >= 80 bits para busca, uso único, sem `list`. | Obrigatório |
| R-SYNC-04 | Vínculo de aparelho novo presencial por QR com fingerprint da chave pública; remoto só com SAS verbal. Um aparelho por usuário. | Obrigatório |
| R-SYNC-05 | Operações assinadas pelo autor; contador monotônico por aparelho; cadeia de hash; idempotência; detecção de fork/clone. O host só retransmite. | Obrigatório |
| R-SYNC-06 | Perfil/permissão derivado do certificado, nunca da mensagem; cada par revalida o tipo de operação contra o perfil do autor. Operações exclusivas do gerente enumeradas no SPEC (vincular, revogar, fechar caixa, ajuste, import, reset). | Obrigatório |
| R-SYNC-07 | Validação de esquema, tamanho e chaves proibidas de todo dado remoto antes de tocar no domínio ou na UI; proibido `innerHTML` com dado remoto; teste de segurança dedicado. | Obrigatório |
| R-SYNC-08 | Resolução de conflito por regras de domínio e movimentos (estoque aditivo, comanda fechada imutável, caixa só gerente), com HLC e limite de deriva; nunca "última escrita ganha" por relógio do aparelho. | Obrigatório |
| R-SYNC-09 | Revogação: operação do roster (não só troca local de chave); propagação no handshake; UI de "pendente em N aparelhos"; derrubar e rotacionar chave de sessão ao receber revogação. | Obrigatório |
| R-SYNC-10 | Bloqueio do cofre/inatividade fecha o canal e zera chaves de sessão; reentrada exige desbloqueio. | Obrigatório |
| R-SYNC-11 | Sinalização: projeto Firebase separado; coleção com regras criar-apenas, tamanho máx., `expiresAt` curto, ID de formato fixo, sem update; cliente apaga ao conectar; SDP/ICE cifrados com segredo da sessão; teste de regras no emulador; sem tocar a governança. | Obrigatório |
| R-SYNC-12 | Backup e restore: nunca incluir chave do aparelho, certificado ou roster confiável; restore em aparelho novo = não vinculado; import como operação de gerente, por mesclagem, com autenticação forte. | Obrigatório |
| R-SYNC-13 | Chave do aparelho: WebAuthn/passkey quando disponível, senão P-256 não extraível; assinatura de sessão apenas com cofre desbloqueado. | Recomendado |
| R-SYNC-14 | Segredo de longa duração compartilhado: **evitar**. Se for necessário, época + rotação a cada remoção + reembrulho individual. | Recomendado |
| R-SYNC-15 | Retenção local reduzida no perfil operador (janela configurável) e opção de canal/escopo por papel para caixa e relatórios. | Recomendado (decisão do Celso) |
| R-SYNC-16 | Minimização de metadado: nada de nome de usuário, estabelecimento ou UID de governança na sinalização; sem Firebase Auth por aparelho; limpeza imediata; sem log de ICE. | Recomendado |
| R-SYNC-17 | Auditoria local assinada e encadeada de entradas em sessão, vínculos, revogações, imports e ajustes; sem PII/segredos em log. | Obrigatório |
| R-SYNC-18 | Estado de falha: sessão que não autentica não degrada para "aceitar sem verificar" (sem fail-open, como o kill-switch hoje). Mensagem de erro sem detalhes internos. | Obrigatório |
| R-SYNC-19 | Atualização do CSP do app só com o necessário; registrar que `connect-src` não restringe WebRTC. | Recomendado |
| R-SYNC-20 | Testes: replay, fork, par revogado, roster desatualizado, SDP trocado na sinalização (MITM simulado), mensagem hostil, relógio adulterado, restore de backup antigo, perda do gerente. | Obrigatório |

## 6. Condições para "dá para fazer com segurança" (C1 a C8)

C1 autenticação por assinatura do fingerprint (R-SYNC-01); C2 roster+certificados curtos+revogação propagada (02, 09); C3 vínculo presencial aprovado pelo gerente (03, 04); C4 operações assinadas com anti-replay e perfil pelo certificado (05, 06); C5 validação rígida de dado remoto e fim de `innerHTML` nesses caminhos (07); C6 sinalização em projeto Firebase separado, cifrada, curta, sem `list` (11); C7 backup/restore sem identidade (12); C8 plano de perda do celular raiz (RV-05).

## 7. Riscos que o Celso precisa aceitar ou decidir

1. **Cópia local integral e sem apagar à distância.** Celular roubado/ex-funcionário mantém o que já tinha (RV-03, LP-02). Decidir: reduzir retenção no operador? (R-SYNC-15)
2. **Revogação eventual.** Há uma janela (até o aparelho revogado falar com um par atualizado, ou o certificado expirar). Decidir a validade do certificado (sugestão 7 a 14 dias) e o custo de renovar.
3. **Sem TURN: pode não conectar em 4G/CGNAT ou Wi-Fi com isolamento.** Aceitar sync por melhor esforço, com fallback LAN/QR. Dados não sincronizados ficam só no aparelho que os criou até o próximo encontro; perda do aparelho antes disso = perda dos dados (backup recomendado).
4. **Metadado à Google/STUN:** IP e horário. LGPD: IP de funcionário é dado pessoal; avaliar aviso/consentimento e transferência internacional.
5. **Insider vê tudo**: todo operador recebe caixa e estoque inteiros (EN-05). Aceitar ou separar por papel.
6. **Web não atesta hardware**: "vinculado ao aparelho" é forte mas não absoluto (clone, root/DevTools).
7. **Perda do celular raiz do gerente**: aceitar 2º aparelho de gerente/12 palavras e recomeço presencial.
8. **Projeto Firebase separado para sinalização** (criação e App Check novos; cota isolada). Decidir sim/não. Se não, risco SG-04 sobe para Alta e pode derrubar licença/governança.
9. **PIN como barreira**: o modelo "olhares curiosos" não cobre ladrão persistente. Para aparelhos de gerente recomendo senha (não PIN) e bloqueio de tela do Android como pré-requisito.
10. **Achados em aberto de 14/10** (PIN fora da derivação; import de backup sem autenticação; kill-switch fail-open; regras sem App Check) agravam este desenho e entram como pré-requisito ou risco aceito explícito.

## 8. Pontos a validar na implementação (não afirmados aqui sem teste)

- Valores vigentes das cotas do plano gratuito e comportamento ao exceder (conferir no console/documentação no dia).
- Se o TTL do Firestore e as regras de sinalização funcionam como descrito no emulador (rules unit tests).
- Suporte a WebAuthn/PRF e a chave P-256 não extraível nos Chrome Android alvo; mDNS ICE em redes de bar.
- Que a CSP realmente não restringe `RTCPeerConnection` nas versões alvo (hoje não há diretiva efetiva).

## 9. Fora de escopo deste documento

Código, regras do Firestore, publicação, alteração de PACOTES, escolha final entre malha e estrela (cabe ao Paulo no ADR), escopo fiscal/LGPD formal.
