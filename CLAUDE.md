@AGENTS.md

## Instalação desta máquina: daemon como serviço launchd

Nesta máquina o daemon roda como serviço do launchd (configurado em 16/11/2026, migrado
para `./wa-bridge service install` no mesmo dia) e sobe sozinho quando o Mac liga.

- **Serviço:** `local.wa-bridge`, em `~/Library/LaunchAgents/local.wa-bridge.plist`, com
  `RunAtLoad` e `KeepAlive`. O plist é gerado pelo script: não edite à mão; mude o `.env`
  e rode `./wa-bridge service install` de novo.
- **O que roda:** `bin/wa-bridge-daemon`, que resolve um Node 24+ a cada boot e lê o
  `.env`. O default do nvm nesta máquina é o 22, que não serve; hoje quem roda é o
  `~/.nvm/versions/node/v24.18.0`. Trocar de versão no nvm não quebra o serviço, desde que
  continue existindo algum Node 24+ instalado (`./wa-bridge service status` mostra qual).
- **Mudança no código:** só vale depois de `npm run build` e `./wa-bridge restart`.
- **Logs:** `~/.wa-bridge/logs/daemon.log` (o principal), mais `launchd.out.log` e
  `launchd.err.log`. O `./wa-bridge logs` acompanha os três.

### Ciclo de vida

Com o serviço instalado, o script fala com o launchd e nunca sobe um processo próprio ao
lado dele:

```bash
./wa-bridge restart      # launchctl kickstart -k (ex.: depois de npm run build)
./wa-bridge stop         # launchctl bootout; volta no próximo login ou com start
./wa-bridge start        # carrega o serviço de novo
./wa-bridge status       # mostra "serviço: launchd (local.wa-bridge)"
./wa-bridge service status|uninstall
```

Ainda **nunca rode `npm run dev` nem o Docker** com o serviço ativo: os dois sobem um
segundo daemon com a mesma `~/.wa-bridge/auth`. O daemon abre a conexão com o WhatsApp
antes de ocupar a porta, então esse segundo processo chega a iniciar a sessão antes de
falhar, e duas sessões na mesma credencial derrubam a conta com `device_removed`.

### Painel pelo celular (Tailscale)

O painel abre pela tailnet em `https://macbook-pro-de-kelvyn.tail7ceb8c.ts.net:8443/dashboard/`
(configurado em 16/11/2026 com `tailscale serve --bg --https=8443 http://127.0.0.1:7788`).
O daemon continua só em `127.0.0.1`: nunca mude o bind para `0.0.0.0`, que abriria a API
no Wi-Fi local. A raiz do mesmo endereço (`:443`) é de outra regra, que aponta para a porta
14210; não mexa nela. No celular, o painel pede o token uma vez (`./wa-bridge token` copia
no Mac). Para desligar: `tailscale serve --https=8443 off`.

### Estado e backup

- `~/.wa-bridge` com `chmod 700` (o daemon reaplica a cada boot).
- Retenção de mensagens de 365 dias vem do `.env` local (`WA_RETENTION_MESSAGES_DAYS=365`);
  o default do código é `0` (nunca apagar).
- Backup do banco antes da migração para o schema 2 (busca FTS5):
  `~/.wa-bridge/wa.db.bak-pre-v2`. Pode apagar quando quiser.
- Pareada de novo em 16/11/2026 às 22:11, com o nome `Jarvis` (`WA_DEVICE_NAME` no `.env`):
  no celular aparece como "Google Chrome (Jarvis)". O histórico de 9 a 16/11 entrou por
  backfill dos blocos `RECENT` já recebidos, porque o Baileys 6.7.24 descartava o histórico
  sem `shouldSyncHistoryMessage`.
- Baileys atualizado para `7.0.0-rc14` em 16/11/2026 às 22:33, com a mesma sessão. Backups
  de antes da troca: `~/.wa-bridge/auth.backup-pre-baileys7-*` e
  `~/.wa-bridge/wa.db.bak-pre-baileys7-*`. Para voltar: `daemon/package.json` em `6.7.24`,
  `npm install`, `npm run build`, restaurar o `auth/` do backup e `./wa-bridge restart`.
