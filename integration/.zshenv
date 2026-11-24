[[ -f "${TS_ORIGINAL_ZDOTDIR:-$HOME}/.zshenv" ]] && source "${TS_ORIGINAL_ZDOTDIR:-$HOME}/.zshenv"
export ZDOTDIR="${TS_INTEGRATION:-${0:A:h}}"
