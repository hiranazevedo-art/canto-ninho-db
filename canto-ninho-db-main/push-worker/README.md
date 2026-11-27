# Notificações do Canto & Ninho

O aplicativo Pages pode ser publicado independentemente. A Agenda e a
sincronização continuam funcionando se o serviço de notificações estiver
indisponível. Para ativar o Web Push, configure o Worker e a conexão abaixo.

## Banco e implantação

1. Confirme o ID do D1 usado pelo Pages no ambiente autorizado. Num banco novo,
   aplique `schema.sql` e as migrações `001` a `004` em ordem, conforme o
   README principal. Num banco existente, aplique as migrações pendentes.
2. No repositório, preencha `database_id` no arquivo
   `push-worker/wrangler.toml` com esse ID. O ID é uma referência de
   configuração. As chaves VAPID privadas ficam em segredos do Worker.
3. Crie um projeto **Worker** separado, conectado ao GitHub, com nome
   próprio do ambiente autorizado. Ajuste o nome no arquivo Wrangler. Use o diretório raiz `push-worker` e
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
5. No projeto **Pages**, nas configurações de bindings do ambiente autorizado,
   adicione um **Service binding** chamado `PUSH`, apontando para o Worker desse ambiente. Republique o Pages para aplicar o binding. Confira no
   Worker se o cron de 15 minutos declarado no arquivo Wrangler está ativo.
6. Em um aparelho compatível, entre na conta, abra **Agenda**, toque em
   **Ativar notificações neste aparelho** e autorize. Use **Enviar
   notificação de teste**. Ao tocar no teste, o aplicativo deve abrir ou voltar ao primeiro plano. O toque em um lembrete automático abre a Agenda. Para
   testar um lembrete automático, sincronize um registro de teste com
   lembrete para a data atual e verifique os logs do Worker após o cron.

## Funcionamento

O Worker lê ovoscopia, véspera de eclosão, abertura da janela de anilhamento,
vencimento de documento, torneios agendados, manejo e término previsto de saúde
do D1 a partir das 6h no fuso do
criadouro. Edições ou cancelamentos precisam estar sincronizados antes do
envio. Cada lembrete é registrado por aparelho no D1. Uma resposta temporária explícita
(HTTP 429 ou 5xx) permite uma nova tentativa em execução posterior do cron.
O horário depende do cron e a entrega depende do serviço do aparelho.
Uma falha de entrega ambígua fica nos logs para evitar duplicação automática.
Uma notificação já entregue permanece sujeita às ações do aparelho.
O texto na tela bloqueada é genérico. O toque no lembrete automático abre a Agenda.

No iPhone/iPad, adicione a aplicação à Tela de Início e abra pelo ícone.
No Android ou no computador, se a permissão estiver bloqueada, confira as
configurações do navegador e as permissões do sistema operacional.
