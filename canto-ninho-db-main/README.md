# Canto & Ninho — pacote para UMA NOVA conta Cloudflare

**Não foi publicado.** Este pacote não utiliza a conta Cloudflare nem o Supabase de outros projetos.

## Arquitetura
- `public/`: HTML original evoluído, imagens externas do catálogo, PWA e cache offline.
- `functions/api/`: API Cloudflare Pages Functions para uma conta proprietária com senha e snapshot dos dados.
- `schema.sql`: tabelas para Cloudflare D1.
- Sem Supabase. A nuvem depende de um banco D1 novo na **outra conta Cloudflare**.
- Armazenamento local existente permanece sob a chave `caboclinho_manager_v04`.

## Publicação, na OUTRA conta
1. Entre na nova conta Cloudflare. Instale Node.js e Wrangler (`npm install -g wrangler`) e autentique o CLI **nesta conta** (`wrangler login`), confirmando o usuário no navegador.
2. Crie um banco D1 **novo** (`wrangler d1 create canto-ninho-db`) e aplique o `schema.sql` (`wrangler d1 execute canto-ninho-db --remote --file=schema.sql`). Os comandos devem ser executados no diretório raiz deste pacote.
3. Crie um projeto Cloudflare Pages conectado a um repositório Git que contenha as pastas `public/` e `functions/` deste pacote. Nas configurações do Pages, use `public` como diretório de saída (sem etapa de build). Uma alternativa é implantar com Wrangler, desde que as Pages Functions sejam incluídas. **Não use apenas o upload estático do HTML, pois a API não será publicada.**
4. Em Pages → Settings → Functions → D1 bindings, adicione o binding **DB** para `canto-ninho-db` criado na conta nova.
5. Em Pages → Settings → Variables and Secrets, cadastre secrets `SESSION_SECRET` (um valor aleatório forte e exclusivo, >= 32 bytes) e `OWNER_SETUP_CODE` (código temporário forte para criar a primeira conta). **Nunca adicione esses valores ao HTML ou ao Git.**
6. Publique novamente para ativar bindings/secrets. Abra a URL `https://...pages.dev`; clique em **Conectar à nuvem**, crie o acesso proprietário com código temporário e senha forte.
7. **Antes de sincronizar** no computador original, use o backup JSON do aplicativo. Ao conectar, confirme explicitamente o envio dos dados locais para a nuvem. Em outro dispositivo, faça login e aceite carregar a cópia na nuvem.
8. Após a criação inicial, remova `OWNER_SETUP_CODE` das configurações da implantação para reduzir a superfície de ataque (novo deploy se necessário).

## Avisos importantes
- Este protótipo realiza sincronização por **snapshot integral**, não por registro. Se dois dispositivos editarem simultaneamente, o servidor rejeita a gravação com revisão desatualizada; não há merge automático. Faça backup antes de resolver conflitos.
- Login da nuvem é opcional e **não substitui** a configuração inicial do criadouro. Um mesmo acesso pode ser usado nos aparelhos do proprietário.
- Alterações offline ficam localmente até a próxima tentativa de sincronização; não há garantia de entrega se o usuário fechar a aba antes da transmissão. Antes de trocar de aparelho, confirme a indicação de sincronizado.
- O cliente limita a sincronização a cerca de 1,5 MB de JSON para proteção do endpoint. Fotografias do catálogo são URLs públicas externas, não arquivos incorporados.
- Conta D1 de exemplo é proprietária única, sem multiusuário/roles por criadouro. Exige aprimoramentos de segurança, auditoria, recuperação de conta e testes de carga para uso comercial.
- **Nenhuma conta, banco ou domínio foi criado por este pacote.**

## Verificação local realizada
- `node --check` no JavaScript principal e nas três funções do servidor: aprovado.
- Não houve teste de integração real com Cloudflare Pages/D1 nem sincronização em aparelhos físicos. Execute testes completos após configurar o projeto na nova conta.
