#!/usr/bin/env bash
#
# resolve_node — descobre um binário do Node utilizável SEM depender do PATH.
#
# Por que isto existe: quando o node vem do nvm, ele só entra no PATH de shells
# interativos (via `~/.zshrc`). Clientes MCP GUI (Antigravity, extensões de IDE) e o
# launchd sobem processos com um PATH mínimo e falhariam com `spawn node ENOENT`.
# Fixar o caminho absoluto do nvm na config resolve o PATH mas quebra na próxima troca
# de versão — e quebra em silêncio, o que é pior. Aqui a resolução é feita em runtime.
#
# IMPORTANTE: nada aqui pode escrever em stdout além do caminho final. Este arquivo é
# usado pelo wrapper do MCP, onde stdout é o canal do protocolo e qualquer ruído
# corrompe a sessão. Diagnóstico vai para stderr.

WA_NODE_MIN_MAJOR="${WA_NODE_MIN_MAJOR:-20}"

# Imprime a major version de um binário do node, ou nada se não executar.
_node_major() {
  local bin="$1" v
  v="$("$bin" -v 2>/dev/null)" || return 1
  v="${v#v}"
  echo "${v%%.*}"
}

# Verdadeiro se o binário existe, roda e atende a major mínima.
_node_ok() {
  local bin="$1" major
  [[ -x "$bin" ]] || return 1
  major="$(_node_major "$bin")" || return 1
  [[ -n "$major" ]] && (( major >= WA_NODE_MIN_MAJOR ))
}

# Ecoa o caminho de um node utilizável. Retorna 1 se não achar nenhum.
resolve_node() {
  # 1. Override explícito: a palavra final é sempre do usuário.
  if [[ -n "${WA_BRIDGE_NODE:-}" ]]; then
    if _node_ok "$WA_BRIDGE_NODE"; then echo "$WA_BRIDGE_NODE"; return 0; fi
    echo "wa-bridge: WA_BRIDGE_NODE=$WA_BRIDGE_NODE não serve (ausente, sem permissão ou < v$WA_NODE_MIN_MAJOR)" >&2
    return 1
  fi

  # 2. O que estiver no PATH, quando houver PATH (caso do shell interativo).
  local from_path
  from_path="$(command -v node 2>/dev/null || true)"
  if [[ -n "$from_path" ]] && _node_ok "$from_path"; then echo "$from_path"; return 0; fi

  # 3. Default do nvm, que é o que o usuário escolheu como padrão.
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$nvm_dir/alias/default" ]]; then
    local alias_target candidate
    alias_target="$(<"$nvm_dir/alias/default")"
    alias_target="${alias_target#v}"
    # O alias pode ser "22", "lts/*" ou a versão cheia; tenta o prefixo mais específico.
    for candidate in "$nvm_dir/versions/node/v$alias_target"/bin/node \
                     "$nvm_dir/versions/node/v$alias_target".*/bin/node; do
      if _node_ok "$candidate"; then echo "$candidate"; return 0; fi
    done
  fi

  # 4. Versão mais nova instalada no nvm (ordenação por versão, não alfabética:
  #    senão v9 ganharia de v10).
  if [[ -d "$nvm_dir/versions/node" ]]; then
    local newest
    newest="$(ls -1 "$nvm_dir/versions/node" 2>/dev/null \
      | sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
    if [[ -n "$newest" ]] && _node_ok "$nvm_dir/versions/node/v$newest/bin/node"; then
      echo "$nvm_dir/versions/node/v$newest/bin/node"; return 0
    fi
  fi

  # 5. Instalações fora do nvm, em caminhos absolutos conhecidos.
  local fallback
  for fallback in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if _node_ok "$fallback"; then echo "$fallback"; return 0; fi
  done

  echo "wa-bridge: nenhum Node >= v$WA_NODE_MIN_MAJOR encontrado (PATH, nvm, homebrew)." >&2
  echo "           Defina WA_BRIDGE_NODE com o caminho absoluto do seu node." >&2
  return 1
}
