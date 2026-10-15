# BarGestão Standard

PWA local-first para bares, lanchonetes e adegas: comandas, estoque, caixa e auditoria, com os dados cifrados no próprio aparelho (AES-256-GCM, chave derivada por PBKDF2).

## Executar

```bash
npm start   # http://localhost:8080
npm test    # roda todos os runners em tests/
```

## Estrutura

```
src/js/
├── App.js                      # Orquestrador: sessão, cofre, commit transacional, navegação
├── domain/                     # Entidades e portas (inclui IGovernancePort)
├── application/services/       # Regras de negócio (Auth, Order, Stock, Cash, Shift, Recovery, Governance)
├── infrastructure/adapters/    # WebCrypto, Storage (OPFS/IndexedDB), Export, FirebaseGovernanceAdapter (REST)
└── ui/
    ├── adapters/               # DomRenderer, DomEventHandler, TypedSecrets (senhas só digitadas)
    └── controllers/            # Sales, Stock, Cash, Security, Governance (telas extraídas do App.js)
src/css/kit-aero.css            # ponte entre os tokens do kit de segurança e o visual Aero
src/stk-pkg-*                   # cópias de PACOTES/stk-pkg-security (cofre, Configurações, ícones, BIP39-pt); não editar aqui
src/stk-pkg-governanca/         # cópias de PACOTES/stk-pkg-governanca (contrato, cliente, Firestore REST, config); não editar aqui
```

## Integração com a Governança Systekna

O processo de permissão vem do pacote `PACOTES/stk-pkg-governanca` (fonte única, também usada pelo painel Governança). O teste `tests/stk-pkg-governanca.test.mjs` confere se a cópia em `src/stk-pkg-governanca/` é idêntica ao pacote.

Fluxo: **usuário se cadastra no app → é gerada a impressão digital (UID) → a solicitação vai ao Firebase com esse UID → a Governança aprova ou não** e libera/bloqueia funcionalidades no tenant de mesmo UID. As permissões vêm sempre do Firebase.

- **Impressão digital (UID):** SHA-256 de um segredo aleatório de 256 bits + dados do cadastro, truncado em 128 bits (32 hex). É o id da solicitação (`solicitacoes_governanca/{uid}`) e da licença (`tenants_governanca/{uid}`), e aparece para o usuário e no painel como `3F2A-9C01-…`. O segredo não é guardado.
- **Usar o app (sim/não):** sem aprovação vinda do Firebase o app não abre — nem o login. Pendente mostra "Cadastro em análise"; reprovado, bloqueado ou licença expirada mostra **"Sem permissão"** com o motivo, o UID, "Verificar novamente" e "Exportar backup criptografado" (o arquivo continua cifrado). Instalações antigas também precisam se cadastrar.
- **Funcionalidades:** `permiteMesas` liga/desliga as mesas; `permiteExportacaoXlsx` a exportação em Excel; `limiteProdutos` o teto de produtos. Planos aplicados pelo painel: starter (50 produtos, 2 usuários, sem Excel), pro (1.000/10) e enterprise (100.000/100, com impressora térmica).
- **Nome na barra:** o título mostra o estabelecimento cadastrado na governança (padrão: BarGestão).
- **Sem esperar novo login:** com o app aberto, a Governança é reconsultada ao voltar para a tela, ao reconectar e a cada 15 minutos. Perdeu a permissão → a sessão é encerrada e aparece "Sem permissão"; liberou → a tela de espera segue sozinha.
- **Offline:** falha de rede ou resposta indeterminada mantêm o último estado (nunca liberam); sem confirmar a licença por mais de 14 dias, vale "Sem permissão" até reconectar.
- **Telemetria e feedback:** erros e feedbacks vão sanitizados para `telemetria_erros` e `feedbacks_usuarios`, com o UID do cadastro.
- **App Check:** o projeto `systekna-feedback` exige App Check; o token (reCAPTCHA Enterprise, SDK oficial da gstatic) vai no cabeçalho `X-Firebase-AppCheck` de cada chamada REST.

O app não autentica no Firebase: o que ele pode gravar e ler é definido pelas regras em `PACOTES/stk-pkg-doacao/firestore.rules`. O enforcement no aparelho impede o uso normal, mas quem controla o próprio navegador consegue contorná-lo — a autoridade final é o Firestore e o contrato.

## Segurança local

Duas camadas desde a v2.6.0, no padrão Systekna:

1. **Cofre do aparelho (kit `stk-pkg-security`, por fora):** abre antes do app com o PIN FINANC, biometria, 12 palavras (BIP39-pt) ou certificado. `data-vault-app="multi-cm"` usa o FINANC ID compartilhado da mesma origem, e `App.init` espera `window.vaultReady`. O kit registra o `sw.js`. O menu ⋮ do kit fica na barra de título (`data-vault-profile-slot`); no celular o cadeado sai da barra e fica em Mais → Bloquear o aplicativo.
2. **Equipe (por dentro):** gerente e funcionários entram com senha e PIN próprios, **só digitados** (`FinancTyped` do kit): sem colar nem autofill de gerenciador de senhas.

O kit usa `--surface`, `--surface-2` e `--ink-dim`; `src/css/kit-aero.css` liga esses tokens aos do Aero, sem editar a cópia do kit. O teste SEG-12 exige que todo token de cor do kit tenha valor no app.

- **PIN (v2):** o PIN deriva uma chave (PBKDF2, 650 mil iterações) que embrulha a chave do cofre, e esse embrulho fica selado pela chave do aparelho. Sem o PIN o cofre não abre, mesmo com acesso ao código da página. Após 5 erros o PIN é apagado e só a senha mestra entra. PINs configurados em versões anteriores são desativados no primeiro uso e precisam ser recriados.
- **Restauração de backup:** o arquivo é validado e só é gravado se a senha de um usuário do backup abrir o cofre contido nele. Se o aparelho já tiver cadastro, é preciso também a senha de um gerente atual; o cadastro anterior fica guardado em `private/auth-previous`. O backup leva o registro de governança e, restaurado, só volta a lançar depois de revalidar a licença.
- **Frase de recuperação (BG12):** o botão baixa um arquivo `.txt` com as 12 palavras e a chave. Guarde offline e apague do aparelho. Desde a v2.6.0 as frases novas saem em BIP39-pt; as antigas, em inglês, continuam valendo (a lista antiga tinha 2.047 palavras, e "undefined" é aceito como índice 2047).

## Versões

| Versão | O que mudou |
| --- | --- |
| 2.4.0 | Versão do app e especificações do sistema em Configurações |
| 2.5.0 | Integração com a Governança: acesso e funcionalidades por UID vindos do Firebase, telemetria e feedback |
| 2.6.0 | Padrão de segurança Systekna (cofre do kit por fora + equipe por dentro), senhas só digitadas, BG12 em BIP39-pt, `stk-pkg-governanca`, service worker v6 |
| 2.6.1 | Cofre do kit legível no visual Aero (`kit-aero.css`) |
| 2.6.2 | Menu do kit dentro da barra de título; nome do estabelecimento no título |

Ao mudar arquivos do app, troque `VERSION` em `src/js/App.js`, `data-vault-version` e os textos de versão no `index.html`, `version` no `package.json` e a constante `CACHE` do `sw.js`.

