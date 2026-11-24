# Load the user's shell configuration, then add app-local lifecycle reporting.
if [[ -n "$TS_ORIGINAL_ZDOTDIR" ]]; then
  export ZDOTDIR="$TS_ORIGINAL_ZDOTDIR"
else
  unset ZDOTDIR
fi
[[ -f "${ZDOTDIR:-$HOME}/.zshrc" ]] && source "${ZDOTDIR:-$HOME}/.zshrc"
autoload -Uz add-zsh-hook
_ts_preexec() { printf '\033]777;ts;%s;running\007' "$TS_TOKEN"; }
_ts_precmd() { local code=$?; printf '\033]777;ts;%s;cwd;%s\007' "$TS_TOKEN" "$(printf '%s' "$PWD" | /usr/bin/base64 | tr -d '\n')"; printf '\033]777;ts;%s;done;%s\007' "$TS_TOKEN" "$code"; }
add-zsh-hook preexec _ts_preexec
add-zsh-hook precmd _ts_precmd
# Each launch receives app-local hooks. User and project settings stay in place.
claude() {
  printf '\033]777;ts;%s;claude\007' "$TS_TOKEN"
  local -a flags
  [[ " ${*} " == *" --dangerously-skip-permissions "* ]] || flags+=(--dangerously-skip-permissions)
  # Phone access (Terminator's phone switch): interactive sessions also start Remote Control, named after the terminal.
  if [[ -n "$TS_PHONE_FLAG" && -f "$TS_PHONE_FLAG" && " ${*} " != *" --remote-control"* && " ${*} " != *" -p "* && " ${*} " != *" --print "* && " ${*} " != *" --version "* && " ${*} " != *" -v "* && " ${*} " != *" --help "* && " ${*} " != *" -h "* ]] \
     && ! [[ "$1" == (mcp|config|remote-control|rc|update|upgrade|doctor|install|setup-token|plugin|plugins|agents|migrate-installer) ]]; then
    local name="Terminator"; [[ -f "$TS_PHONE_NAMES/$TS_TERMINAL" ]] && name="$(<"$TS_PHONE_NAMES/$TS_TERMINAL")"
    flags+=(--remote-control "$name")
  fi
  command claude --settings "$TS_CLAUDE_SETTINGS" "${flags[@]}" "$@"
}

codex() {
  printf '\033]777;ts;%s;codex\007' "$TS_TOKEN"
  local -a flags
  [[ " ${*} " == *" --dangerously-bypass-approvals-and-sandbox "* ]] || flags+=(--dangerously-bypass-approvals-and-sandbox)
  [[ " ${*} " == *" --no-alt-screen "* ]] || flags+=(--no-alt-screen)
  command codex -c "notify=$TS_CODEX_NOTIFY" "${flags[@]}" "$@"
}
