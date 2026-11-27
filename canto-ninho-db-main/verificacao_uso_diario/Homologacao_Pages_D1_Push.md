# Homologação do Canto & Ninho

Estado da validação em 27 de novembro de 2026. Os testes locais documentados no pacote anterior foram concluídos. A execução abaixo depende de um projeto Pages, D1 e Worker autorizados e de aparelhos de teste. Preencha o resultado observado em cada linha durante a execução.

## Preparação

Registre a URL autorizada, a revisão implantada, a data e o fuso do criadouro, os navegadores e as versões dos sistemas dos aparelhos A e B. Confirme que o Pages e o Worker apontam para o mesmo D1 de homologação e que o binding `PUSH`, o par VAPID e o cron de 15 minutos estão ativos. Use a mesma conta fictícia nos dois aparelhos.

| Cenário | Evidência esperada | Resultado |
|---|---|---|
| Sincronização A → B | Cadastre uma ave fictícia no A. Após o cabeçalho indicar **Sincronizado**, abra ou atualize B e confira nome e anilha. | Pendente |
| Edição B → A | Edite a ave no B, aguarde a confirmação e confira a alteração no A. | Pendente |
| Retomada após perda de conexão | Com a conta já aberta, desconecte A, crie um registro fictício e confirme que aparece localmente como pendente. Reconecte, aguarde a confirmação e confira o registro no B. | Pendente |
| Edições independentes e conflito | Faça alterações em registros distintos nos dois aparelhos e confira a conciliação. Em outro par de alterações sobre o mesmo campo, confira a revisão de conflito e o resultado da escolha. | Pendente |
| Inscrição e push de teste | Na Agenda, ative as notificações no A e no B. Envie o teste em cada aparelho e confirme a chegada na central. Toque no teste com o app em segundo plano e confira se ele volta ao primeiro plano. | Pendente |
| Lembrete automático | Sincronize um registro fictício com lembrete devido no dia. A partir das 6h no fuso do criadouro, observe o cron, confirme a chegada em ambos os aparelhos e confira a abertura da Agenda ao tocar. Verifique se a próxima execução evita repetir o mesmo envio. | Pendente |
| Desativação em um aparelho | Desative as notificações em B, confirme a ausência de uma inscrição ativa para B e teste novamente em A. | Pendente |

No iPhone ou iPad, abra pelo ícone da Tela de Início. Para cada caso, registre horário, aparelho e resultado visível. Para push, registre separadamente a aceitação do envio pelo serviço e a chegada ao aparelho.
