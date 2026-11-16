#!/usr/bin/env bash
# Entrypoint do container wa-bridge.
#
# O daemon (daemon/src/config.ts) faz bind
# SEMPRE em 127.0.0.1 — é uma garantia de segurança intencional do projeto e
# este empacotamento não a contraria. Dentro de um container isso significa
# que o processo só escuta no loopback *do próprio container* (namespace de
# rede isolado) — o encaminhamento de porta do Docker chega pela interface
# externa (eth0), nunca pela loopback do container, então um bind
# estritamente em 127.0.0.1 fica inalcançável de fora sem um retransmissor.
#
# Solução: o daemon continua ouvindo em 127.0.0.1:$WA_BRIDGE_PORT exatamente
# como o código já faz (sem nenhuma alteração). Este script sobe, ao lado,
# um `socat` que escuta em 0.0.0.0:$RELAY_PORT (uma porta DIFERENTE, na
# interface externa do container) e repassa cada conexão para
# 127.0.0.1:$WA_BRIDGE_PORT. Uma porta diferente é necessária porque o
# Linux não deixa um socket wildcard (0.0.0.0) e um socket específico
# (127.0.0.1) coexistirem na MESMA porta ("Address already in use") — não é
# uma particularidade deste projeto, é o kernel. O docker-compose.yml é quem
# faz a ponte `127.0.0.1:7788 (host) -> RELAY_PORT (container)`, então por
# fora tudo continua em 7788; só por dentro do container existe uma porta
# interna extra. Como o compose só publica a porta em 127.0.0.1 do HOST
# (nunca 0.0.0.0 do host), a superfície exposta continua a mesma do
# contrato: só localhost da máquina consegue falar com o daemon.
set -euo pipefail

APP_PORT="${WA_BRIDGE_PORT:-7788}"
RELAY_PORT="${RELAY_PORT:-17788}"

node dist/index.js &
NODE_PID=$!

cleanup() {
  kill -TERM "$NODE_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

# Espera o daemon abrir o socket antes de subir o relay, para o socat não
# falhar de cara numa corrida de inicialização.
for _ in $(seq 1 50); do
  if (exec 3<>"/dev/tcp/127.0.0.1/${APP_PORT}") 2>/dev/null; then
    exec 3<&- 3>&-
    break
  fi
  sleep 0.2
done

socat TCP-LISTEN:"${RELAY_PORT}",bind=0.0.0.0,fork,reuseaddr TCP:127.0.0.1:"${APP_PORT}" &
SOCAT_PID=$!

wait -n "$NODE_PID" "$SOCAT_PID"
cleanup
