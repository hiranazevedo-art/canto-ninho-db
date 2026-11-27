# Canto & Ninho — Melhorar o uso diário

Validação de 27 de novembro de 2026. Pacote cumulativo baseado no ZIP `canto-ninho-db-main (4).zip`, que traz o identificador `4cf2ebb5e8ed0540a3bbcd8fe9236209fae119d8` no comentário do arquivo. SHA-256 da entrada `a4a659410972095ef013efe22167a20223e42f2a3c6d789c7976be5b8b202a97`.

O ponto de entrada testado foi `canto-ninho-db-main/public/index.html`, na raiz externa do ZIP, conforme a estrutura de publicação descrita no README. O pacote inclui o projeto completo e as cópias históricas que já vinham aninhadas no original. A atualização do cache está em `public/sw.js`.

## Problemas e correções

| Observação | Correção |
|---|---|
| A cor informada ao navegador continuava marrom depois da troca de tema. A navegação superior e inferior conservava o fundo claro fixo. | Aplicação da cor de destaque do tema ao navegador e da cor de fundo do tema às barras. |
| Vários botões usados no celular mediam menos de 44 px. | Área mínima de 44 × 44 px nos botões de ação, texto maior em ações compactas e campos da barra de ferramentas, e linhas de seleção com mais altura nos formulários. Os avisos aparecem acima da barra inferior e permitem tocar nos controles que estiverem atrás. |
| Buscas genéricas e o seletor de módulo para exportação estavam sem nome acessível. A troca de ave no pedigree redesenhava o seletor, interrompendo o uso do teclado. | Rótulos acessíveis, indicação de foco, restauração de foco nos seletores redesenhados e associação dos avisos a uma região de status. |
| Saúde apresentava opções de suplementação, mas omitia tipos como sinal observado, consulta e exame. A busca genérica consultava os IDs das aves e a conclusão podia deixar o alerta ativo no painel inicial. | Tipos clínicos disponíveis junto às opções anteriores. Busca pelo nome ou pela anilha da ave e retirada do registro concluído da contagem de alertas. |

## Resultados

| Verificação | Computador 1440 × 900 | Celular 390 × 844 | Celular 320 × 740 |
|---|---|---|---|
| Abertura dos 18 módulos pelo menu e conferência do conteúdo principal | 18/18 | 18/18 | 18/18 |
| Largura da página e nomes acessíveis dos campos inspecionados | Aprovado | Aprovado | Aprovado |
| Alvos de toque nos botões visíveis da área de conteúdo e na barra inferior | — | Aprovado | Aprovado |
| Dez temas, seleção, persistência, cor do navegador e contraste | 10/10 | 10/10 | 10/10 |
| Foco, Enter, Tab, Shift+Tab, Escape e retorno ao controle de origem | Aprovado | Aprovado | Aprovado |
| Saúde, Estoque e exportação de pedigree | Aprovado | Aprovado | Aprovado |
| Exceções de JavaScript na página durante a execução | 0 | 0 | 0 |

Os módulos percorridos foram Início, Plantel, Árvore genealógica, Reprodução, Manejo, Alimentação, Saúde, Agenda, Estoque, Despesas, Receitas, Relatórios, Instalações, Campeadas, Torneios, Documentação, Biblioteca e Configurações.

- **Legibilidade.** O menor contraste medido entre os pares de cores testados nos dez temas foi **6,19:1**, no tema Terracota. Os pares foram texto principal sobre o fundo geral, texto branco sobre a cor de destaque e cor de destaque sobre o fundo da navegação. Os números por tema estão no registro de execução.
- **Saúde.** Registro fictício de sinal observado. Rejeição de término anterior ao início. Conferência do término previsto na Agenda, edição com conclusão efetiva, busca pelo nome da ave e conferência da retirada do lembrete e do alerta ativo.
- **Estoque.** Compra de 1,5 kg por R$ 12,50, saldo de 6,5 kg e conferência do lançamento em Despesas. Rejeição da saída de 8 kg. Saída de 2 kg, saldo de 4,5 kg, exclusão da saída com reposição para 6,5 kg e confirmação do saldo após recarregar.
- **Pedigree.** Seleção por controle com foco preservado e download de `pedigree-ave-teste.pdf`. Verificação do formato do arquivo e extração do texto com nome da ave, pai, mãe e anilha `0003`.
- **Regressão.** A suíte do pacote passou em seis testes, incluindo o piloto local com SQLite, sincronização e notificações simuladas.

## Repetição dos testes

O roteiro `uso_diario.cjs` usa Node.js, Playwright, Chromium e `pdftotext`. Na raiz externa do projeto, sirva `public` em loopback com `python3 -m http.server 8770 --bind 127.0.0.1 --directory public`. Com Playwright disponível para o Node.js, execute `node verificacao_uso_diario/uso_diario.cjs`. Informe `CHROMIUM_PATH` se usar um binário de Chromium externo e `CANTO_URL` se usar outra porta local.

O teste de navegação usa perfis isolados, dados fictícios e respostas simuladas de API. A execução em celular foi feita com emulação de toque e viewport no Chromium. A cobertura dos demais módulos é de abertura, controles visíveis e layout, com fluxos completos nos itens destacados. Aparelhos físicos, leitores de tela, Cloudflare de produção e entrega real de notificações ficaram fora desta execução.

Status da entrega em 27 de novembro de 2026: aguardando aprovação para publicar.
