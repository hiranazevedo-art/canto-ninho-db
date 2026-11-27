# Canto & Ninho

Aplicativo de gestão de criadouro com dados locais, sincronização entre aparelhos pela conta e lembretes opcionais via Web Push.

## Dados locais e sincronização

O aplicativo pede uma conta no primeiro acesso. Depois de entrar, o navegador mantém uma cópia de trabalho local. Quando a sessão local ainda permite abrir o aplicativo, é possível continuar trabalhando sem conexão. Use **Configurações → Baixar backup JSON** para manter uma cópia independente do navegador.

Ao conectar novamente, acompanhe o estado dos dados no cabeçalho:

| Estado | Como interpretar |
|---|---|
| Salvo neste aparelho ou aguardando envio | A alteração permanece no aparelho. Mantenha ou reabra o aplicativo com conexão para concluir o envio. |
| Sincronizando | O aplicativo está trocando dados com a nuvem. |
| Sincronizado | O aplicativo confirmou a sincronização com a nuvem. Abra o outro aparelho e confira os registros depois que ele atualizar. |
| Conflito | O aplicativo preservou os registros locais. Abra o estado dos dados no cabeçalho para revisar as diferenças e faça um backup antes de resolver o conflito. |

A primeira cópia usa um envio inicial dos dados. Depois, o aplicativo envia alterações por registro e tenta conciliar edições independentes. Alterações concorrentes que exigem decisão aparecem na revisão do conflito. Os dados de contas distintas ficam separados.

## Implantação em homologação

Use um projeto Pages e um D1 autorizados para testes com dados fictícios. O diretório de saída do Pages é `public`, com `functions` na raiz do projeto e sem etapa de build.

1. Num D1 novo, execute `schema.sql` e depois as migrações `001_records.sql`, `002_tournament_relations.sql`, `003_web_push.sql` e `004_pilot_invites.sql`, nessa ordem. Para um D1 existente, confira o histórico e aplique as migrações pendentes em ordem.
2. Associe o D1 de homologação ao Pages com o binding `DB`. Configure `SESSION_SECRET` com um valor aleatório de pelo menos 32 bytes e `OWNER_SETUP_CODE` temporário para criar o acesso proprietário. Use a configuração de segredos do Pages.
3. Implante o Pages com suas Functions. Crie a conta de teste pelo fluxo do aplicativo e retire o código temporário após a criação. Configure o Worker e o binding `PUSH` conforme [Notificações](push-worker/README.md).
4. Siga o [roteiro de homologação](verificacao_uso_diario/Homologacao_Pages_D1_Push.md) com dois dispositivos.

Referência de configuração do provedor [Bindings do Cloudflare Pages](https://developers.cloudflare.com/pages/functions/bindings/).

## Validação disponível

O [relatório de uso diário](verificacao_uso_diario/Resultados_uso_diario.md) registra a navegação em 18 módulos, os dez temas, o teste desktop e mobile emulado, e os fluxos de Saúde, Estoque e pedigree. Os testes de regressão usam SQLite local e simulam o serviço de push. Consulte o roteiro de homologação para registrar os resultados no Pages/D1 e nos aparelhos.
