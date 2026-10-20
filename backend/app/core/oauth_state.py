"""
app/core/oauth_state.py
Guarda o 'state' anti-CSRF do OAuth no servidor, em memória: uso único e
validade de 10 minutos.

Por que não na sessão (cookie): o início da conexão agora é uma chamada fetch
do frontend (Netlify) para o backend (Railway), com a senha de acesso no
cabeçalho. Um cookie criado numa chamada entre domínios diferentes é cookie
de terceiros, que os navegadores bloqueiam; o state se perderia antes do
callback. Guardando no servidor, o callback confere o state sem cookie.

Limite conhecido: com mais de uma réplica do backend (ou um reinício entre o
clique em Conectar e a volta da plataforma), o state não é encontrado e a
conexão precisa ser refeita. Hoje o backend roda com uma réplica só.
"""
import time

VALIDADE_SEGUNDOS = 600

_estados: dict[str, tuple[str, float]] = {}


def _limpa_vencidos() -> None:
    agora = time.monotonic()
    for chave in [k for k, (_, vence) in _estados.items() if vence < agora]:
        _estados.pop(chave, None)


def registra_state(plataforma: str, state: str) -> None:
    """Guarda o state (já gerado com secrets.token_urlsafe) ligado à plataforma."""
    _limpa_vencidos()
    _estados[state] = (plataforma, time.monotonic() + VALIDADE_SEGUNDOS)


def consome_state(plataforma: str, state: str | None) -> bool:
    """Confere e apaga o state (uso único). False se não existe, venceu ou é de outra plataforma."""
    if not state:
        return False
    item = _estados.pop(state, None)
    if not item:
        return False
    dono, vence = item
    return dono == plataforma and vence >= time.monotonic()
