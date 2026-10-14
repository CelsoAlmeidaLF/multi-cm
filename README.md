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

Implementa os documentos 12, 13 e 14 de `.documents/planejamento`:

- **Cadastro com homologação:** numa instalação nova, o primeiro administrador só é criado depois que a Governança aprova a solicitação (CNPJ opcional, validado quando informado). Requer internet uma vez.
- **Licença e kill-switch:** a cada login o app consulta a solicitação e a licença. Bloqueado, reprovado ou com licença expirada, os lançamentos ficam suspensos; consulta e backup continuam disponíveis. Falha de rede, erro parcial ou documento ausente **mantêm o último estado** (nunca liberam). Sem confirmar a licença por mais de 14 dias, os lançamentos também ficam suspensos até reconectar.
- **Módulo de mesas:** se a governança definir `permiteMesas: false`, a aba de mesas some e os lançamentos em comanda são recusados.
- **Demais módulos do painel:** `permiteExportacaoXlsx: false` esconde e recusa a exportação em Excel (PDF continua); `limiteProdutos` impede cadastrar produto novo acima do teto do plano.
- **Sem esperar novo login:** com a sessão aberta, o app reconsulta a governança ao voltar para a tela, ao reconectar e a cada 15 minutos; bloqueio ou liberação feitos no painel valem na hora.
- **Telemetria e feedback:** erros não tratados e falhas de gravação são enviados sanitizados (chaves, documentos, e-mails e valores removidos), com limite por sessão. O gestor envia feedback em *Mais → Suporte*.
- **Instalações existentes** (cofre criado antes desta versão) seguem funcionando sem cadastro; mesas continuam liberadas.

O app não autentica no Firebase: o que ele pode gravar e ler é definido pelas regras em `governanca-systekna/firestore.rules`. O enforcement no aparelho impede o uso normal, mas quem controla o próprio navegador consegue contorná-lo — a autoridade final é o Firestore e o contrato.

## Segurança local

- **PIN (v2):** o PIN deriva uma chave (PBKDF2, 650 mil iterações) que embrulha a chave do cofre, e esse embrulho fica selado pela chave do aparelho. Sem o PIN o cofre não abre, mesmo com acesso ao código da página. Após 5 erros o PIN é apagado e só a senha mestra entra. PINs configurados em versões anteriores são desativados no primeiro uso e precisam ser recriados.
- **Restauração de backup:** o arquivo é validado e só é gravado se a senha de um usuário do backup abrir o cofre contido nele. Se o aparelho já tiver cadastro, é preciso também a senha de um gerente atual; o cadastro anterior fica guardado em `private/auth-previous`. O backup leva o registro de governança e, restaurado, só volta a lançar depois de revalidar a licença.
- **Frase de recuperação:** o botão baixa um arquivo `.txt` com as 12 palavras e a chave. Guarde offline e apague do aparelho.

