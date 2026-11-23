# Notificações do Canto & Ninho

O aplicativo Pages pode ser publicado independentemente. A Agenda e a
sincronização continuam funcionando se o serviço de notificações estiver
indisponível. Para ativar o Web Push, configure o Worker e a conexão abaixo.

## Banco e implantação

1. Confirme o ID do D1 que o Pages usa em produção. Se os arquivos 001 e 002
   já foram executados, aplique somente `migrations/003_web_push.sql`. No
   Console do D1, execute os três comandos completos em ordem. Em uma
   instalação nova, `schema.sql` já contém a estrutura completa.
2. No repositório, preencha `database_id` no arquivo
   `push-worker/wrangler.toml` com esse ID. O ID é uma referência de
   configuração. As chaves VAPID privadas ficam em segredos do Worker.
3. Crie um projeto **Worker** separado, conectado ao GitHub, com nome
   `canto-ninho-push`. Use diretório raiz `push-worker`, branch `main` e
   comando de implantação `npx wrangler deploy`. Também é possível
   executar `npm ci` e `npm run deploy` dentro desse diretório em um
   terminal autorizado. Mantenha o Worker sem rota pública e sem Preview URL.
4. Em um terminal privado com Node.js, execute `npx --yes web-push@3.6.7
   generate-vapid-keys --json` uma única vez. Você pode usar um ambiente de
   desenvolvimento autorizado na nuvem se não puder instalar ferramentas no
   computador. Em **Settings → Variables and Secrets** do **Worker**, adicione
   `VAPID_PUBLIC_KEY` com `publicKey`, `VAPID_PRIVATE_KEY` como segredo com
   `privateKey`, e `VAPID_SUBJECT` com um contato real no formato
   `mailto:seu-email@dominio`. Nunca envie a chave privada ao GitHub ou ao
   navegador. Guarde o par para manter as inscrições existentes.
5. No **Pages** `canto-e-ninho`, em **Settings → Bindings** de **Production**,
   adicione um **Service binding** chamado `PUSH`, apontando para o Worker
   `canto-ninho-push`. Republique o Pages para aplicar o binding. Confira no
   Worker se o cron de 15 minutos declarado no arquivo Wrangler está ativo.
6. Em um aparelho compatível, entre na conta, abra **Agenda**, toque em
   **Ativar notificações neste aparelho** e autorize. Use **Enviar
   notificação de teste**. Ao tocar no teste, a Agenda deve abrir. Para
   testar um lembrete automático, sincronize um registro de teste com
   lembrete para a data atual e verifique os logs do Worker após o cron.

## Funcionamento

O Worker lê ovoscopia, véspera de eclosão, abertura da janela de anilhamento,
vencimento de documento e torneios agendados do D1 a partir das 6h no fuso do
criadouro. Edições ou cancelamentos precisam estar sincronizados antes do
envio. Cada lembrete tem uma tentativa de envio por aparelho, identificada no
D1. O horário depende do cron e a entrega depende do serviço do aparelho.
Uma falha de entrega ambígua fica nos logs para evitar duplicação automática.
Uma notificação já entregue permanece sujeita às ações do aparelho.
O texto na tela bloqueada é genérico e o toque destaca o item na Agenda.

No iPhone/iPad, adicione a aplicação à Tela de Início e abra pelo ícone.
No Android ou no computador, se a permissão estiver bloqueada, confira as
configurações do navegador e as permissões do sistema operacional.
