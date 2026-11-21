---
tipo: adr
titulo: "ADR-001: Sincronização entre celulares por sessão WebRTC P2P, com Firestore só como sinalização efêmera"
projeto: BarGestão (stk-app-multi-cm)
autor: Paulo (Tech Lead)
data: 2026-10-21
status: Proposto (aguardando o Celso)
substitui: proposta inicial de relé cifrado no Firestore (descartada no mesmo dia, ver Contexto)
relacionados: docs/sync/SPEC-sync-celulares.md, docs/sync/threat-model-sync.md
revisao: 2026-12-15, ou ao fim da F0 se o gate falhar
---

# ADR-001: Sincronização entre celulares por sessão WebRTC P2P

**Data:** 2026-10-21
**Autor:** Paulo
**Status:** Proposto
**Projeto:** BarGestão (stk-app-multi-cm), base v3.2.0, alvo v4.0.0

## Contexto

O Celso decidiu em 21/10/2026 (opção C) que cada funcionário usa o **próprio celular**, vinculado ao aparelho, e que todos veem as mesmas comandas, o mesmo estoque e o mesmo caixa. Remover o usuário bloqueia o celular dele. Ele rejeitou dados separados por celular.

A primeira versão desta decisão usava o Firestore como **relé de pacotes cifrados** (log de eventos guardado no servidor, ilegível para ele). No mesmo dia o Celso refinou: *"Eu não quero usar o Firebase para armazenar estes dados, apenas transferir os dados! E abrir uma sessão."* Com isso, qualquer armazenamento no servidor, mesmo cifrado e temporário como fila, fica proibido.

Forças em jogo:

- **Custo zero:** Firebase Spark, sem Cloud Functions, sem servidor próprio, sem TURN pago. Publicação por push do `src` no gh-pages.
- **Local-first:** o app precisa funcionar offline. O Android suspende a aba com a tela apagada, então cair e voltar é o caso comum.
- **Domínio com dinheiro:** duas pessoas na mesma comanda, estoque concorrente e fechamento de caixa não toleram perda silenciosa.
- **Segurança (Pedro):** sem servidor, toda autorização acontece nos aparelhos. O Pedro definiu 8 condições bloqueantes (C1 a C8) e os requisitos R-SYNC-01 a R-SYNC-20.
- **Código atual:** snapshot único cifrado, mutação por closure em `App._commit`, cadeia de auditoria linear, cofre com chave única embrulhada pela senha de cada usuário (v3.2.0).

## Decisão

1. **Transporte:** WebRTC DataChannel entre os celulares, dentro de uma **sessão do turno** aberta pelo gerente. Topologia em **estrela** no MVP, com o celular do gerente como host (ponto de encontro e retransmissor). Malha fica para depois do MVP.
2. **Sinalização:** Firestore, num **projeto Spark separado** (`systekna-bargestao-sinal`), só com oferta e resposta (SDP compacto com candidatos, sem trickle), **cifradas** com chave derivada do segredo da sessão (128 bits, passado por QR). Os documentos vivem no máximo 5 minutos e são apagados ao conectar. As regras permitem só criar, ler por ID e apagar, sem `list`, sem `update`, com limite de tamanho e com App Check imposto. Nenhum dado do bar, nome ou UID de governança vai para o Firestore.
3. **Dados:** **log de operações append-only assinadas por aparelho** (contador monotônico, cadeia de hash, HLC), com projeção determinística por regras de domínio: comanda como conjunto de itens com lápide, estoque por soma de movimentos, catálogo com LWW por campo, caixa congelado na fronteira assinada pelo gerente. A sincronização é anti-entropia por vetor de versões a cada conexão, seguida de difusão ao vivo.
4. **Verdade:** nenhum aparelho é dono da verdade. Ela é a união convergente dos logs assinados. O host só retransmite (não consegue forjar). O gerente tem autoridade sobre **regras** (roster, fechamento, ajustes), não sobre o estado.
5. **Identidade e revogação:** chave P-256 não extraível por aparelho; vínculo presencial por QR com SAS aprovado pelo gerente; roster assinado e encadeado por aparelhos de gerente; certificado de aparelho com validade de 7 dias; recuperação da raiz pelas 12 palavras. Remover o usuário é uma operação de roster que revoga o aparelho, e o host passa a recusá-lo no handshake. A troca de chave local da v3.2.0 é reaproveitada só onde o removido tinha credencial.
6. **Sem segredo de dados compartilhado de longa duração.** Cada celular mantém o próprio cofre local. A confidencialidade em trânsito vem de DTLS mais uma chave de canal efêmera amarrada aos fingerprints.
7. **Conectividade sem custo:** Wi-Fi da equipe sem isolamento, ou o **hotspot do celular do gerente**. Em 4G com 4G a sincronização é melhor esforço. Sem TURN.

## Alternativas consideradas

| Alternativa | Prós | Contras | Veredito |
|---|---|---|---|
| **A. WebRTC P2P + sinalização efêmera no Firestore (escolhida)** | Nada do bar no servidor; sem dependência nova; DTLS nativo; sinalização barata (~7,7% da cota de leitura por bar) | Sem TURN pode não conectar em CGNAT; exige sessão aberta; o host precisa ficar em primeiro plano | Escolhida, com gate na F0 |
| B. Troca local sem internet (SDP por QR na mesma LAN ou hotspot) | Zero servidor, zero metadado ao Google | Cada (re)conexão pede escanear QR nos dois sentidos; inviável quando o celular cai toda hora | **Complemento pós-MVP (F7)** para bar sem internet. Reaproveita o SDP compacto da A. |
| C1. Realtime Database como sinalização (SSE via `fetch`) | Sem polling; o Spark cobra banda, não operação; ~80 bares | 100 conexões simultâneas no Spark; regras novas para o time | **Caminho de escala**: troca só o `ISignalingPort` |
| C2. Pacote de sincronização por arquivo (menu de compartilhar do Android) | Funciona sempre, nada no servidor | Manual; não é tempo real | Contingência pós-MVP |
| C3. Relé cifrado no Firestore (proposta anterior) | Sincroniza sem os aparelhos estarem juntos; independe de NAT | **Armazena dado no servidor**, contra a decisão do Celso; cota cresce com o volume de itens | Rejeitada pelo Celso |
| C4. Web Bluetooth / Web NFC | Sem rede | O Chrome não atua como periférico GATT; o NFC não faz troca entre celulares | Inviável |
| C5. TURN (coturn em VPS, Cloudflare, Metered) | Resolve CGNAT | Pago, ou exige servidor que emita a credencial, ou credencial exposta e metadado a terceiro | Fora (custo zero); só com decisão do Celso |
| C6. Malha completa desde o MVP | Sem ponto único; resiste à queda do host | N(N-1)/2 conexões; sinalização e revogação mais complexas (revogação eventual) | Pós-MVP (F8), com sinalização repassada pelo host |
| D1. CRDT genérico (Automerge/Yjs) para os dados | Fusão pronta | Não conhece invariantes de dinheiro e estoque; dependência (Automerge com WASM de ~1 MB); updates opacos para assinatura e perfil | Rejeitada (nota 62/110 contra 104/110 da escolhida) |
| D2. Último que grava, por campo, sobre o snapshot | Simples | Perde item de comanda e baixa de estoque concorrentes | Rejeitada |

## Consequências

**Positivas**

- Atende literalmente ao Celso: o servidor só ajuda a abrir a conexão e não guarda nada do bar; fechada a sessão, nada fica.
- A cota do Spark deixa de crescer com o movimento do bar (itens trafegam P2P); só conexões e reconexões consomem cota.
- A auditoria fica mais forte: cada operação é assinada pelo autor (não repúdio por aparelho).
- Remover alguém deixa de exigir senha nova para todos, como na v3.2.0.
- O isolamento de cota protege Governança, kill-switch e feedback.

**Negativas e trade-offs aceitos**

- **Disponibilidade:** sem TURN, o sync em 4G entre redes diferentes é melhor esforço. O bar precisa de Wi-Fi da equipe ou do hotspot do gerente.
- **Dependência do host no MVP:** com o celular do gerente fora, os operadores trabalham offline e não sincronizam entre si até a F8.
- **Grande refatoração:** `_commit` com closures vira comandos e operações (F1), com risco de regressão mitigado por teste de equivalência por replay.
- **Cópia local integral** em cada celular, sem apagar à distância (risco aceito, RV-03).
- **Dois projetos Firebase** para manter (governança e sinal), cada um com App Check.
- **Esforço:** cerca de 45 dias-dev (faixa de 38 a 52) até o MVP no DEV.

**Gatilhos de revisão**

- F0: Wi-Fi ou hotspot com menos de 95% de sucesso de conexão → reabrir a decisão com o Celso (o caminho seria QR primeiro ou repensar o desenho).
- Leitura de sinalização acima de 25% da cota diária, ou mais de 5 bares → migrar a sinalização para o Realtime Database (C1).
- Decisão do Celso por operador abrir sessão → antecipar a F8 (malha e certificados curtos em produção).

## Revisão

2026-12-15, ou imediatamente se o gate da F0 falhar.
