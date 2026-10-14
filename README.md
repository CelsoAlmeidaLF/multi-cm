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
    ├── adapters/               # DomRenderer, DomEventHandler
    └── controllers/            # Sales, Stock, Cash, Security, Governance (telas extraídas do App.js)
```

## Integração com a Governança Systekna

Fluxo: **usuário se cadastra no app → é gerada a impressão digital (UID) → a solicitação vai ao Firebase com esse UID → a Governança aprova ou não** e libera/bloqueia funcionalidades no tenant de mesmo UID. As permissões vêm sempre do Firebase.

- **Impressão digital (UID):** SHA-256 de um segredo aleatório de 256 bits + dados do cadastro, truncado em 128 bits (32 hex). É o id da solicitação (`solicitacoes_governanca/{uid}`) e da licença (`tenants_governanca/{uid}`), e aparece para o usuário e no painel como `3F2A-9C01-…`. O segredo não é guardado.
- **Usar o app (sim/não):** sem aprovação vinda do Firebase o app não abre — nem o login. Pendente mostra "Cadastro em análise"; reprovado, bloqueado ou licença expirada mostra **"Sem permissão"** com o motivo, o UID, "Verificar novamente" e "Exportar backup criptografado" (o arquivo continua cifrado). Instalações antigas também precisam se cadastrar.
- **Funcionalidades:** `permiteMesas` liga/desliga as mesas; `permiteExportacaoXlsx` a exportação em Excel; `limiteProdutos` o teto de produtos.
- **Sem esperar novo login:** com o app aberto, a Governança é reconsultada ao voltar para a tela, ao reconectar e a cada 15 minutos. Perdeu a permissão → a sessão é encerrada e aparece "Sem permissão"; liberou → a tela de espera segue sozinha.
- **Offline:** falha de rede ou resposta indeterminada mantêm o último estado (nunca liberam); sem confirmar a licença por mais de 14 dias, vale "Sem permissão" até reconectar.
- **Telemetria e feedback:** erros e feedbacks vão sanitizados para `telemetria_erros` e `feedbacks_usuarios`, com o UID do cadastro.
- **App Check:** o projeto `systekna-feedback` exige App Check; o token (reCAPTCHA Enterprise, SDK oficial da gstatic) vai no cabeçalho `X-Firebase-AppCheck` de cada chamada REST.

O app não autentica no Firebase: o que ele pode gravar e ler é definido pelas regras em `PACOTES/stk-pkg-doacao/firestore.rules`. O enforcement no aparelho impede o uso normal, mas quem controla o próprio navegador consegue contorná-lo — a autoridade final é o Firestore e o contrato.

## Segurança local

- **PIN (v2):** o PIN deriva uma chave (PBKDF2, 650 mil iterações) que embrulha a chave do cofre, e esse embrulho fica selado pela chave do aparelho. Sem o PIN o cofre não abre, mesmo com acesso ao código da página. Após 5 erros o PIN é apagado e só a senha mestra entra. PINs configurados em versões anteriores são desativados no primeiro uso e precisam ser recriados.
- **Restauração de backup:** o arquivo é validado e só é gravado se a senha de um usuário do backup abrir o cofre contido nele. Se o aparelho já tiver cadastro, é preciso também a senha de um gerente atual; o cadastro anterior fica guardado em `private/auth-previous`. O backup leva o registro de governança e, restaurado, só volta a lançar depois de revalidar a licença.
- **Frase de recuperação:** o botão baixa um arquivo `.txt` com as 12 palavras e a chave. Guarde offline e apague do aparelho.

