"""
scripts/enviar_espelho_calendario.py
Envia o calendario-espelho.json para o app (página Calendário, só leitura).
Usado pela sessão Calendário. Formato do arquivo: docs/espelho-calendario.md.

A chave de sincronização é lida do arquivo local .sync_token (ignorado pelo
Git), na pasta deste projeto, e vai só no cabeçalho X-Sync-Token. O script
nunca mostra a chave.

Uso:
    python scripts/enviar_espelho_calendario.py "C:\\caminho\\calendario-espelho.json"
Opcional: --api https://outro-endereco (padrão: o backend de produção).
"""
import argparse
import json
import os
import sys
from pathlib import Path

import httpx

RAIZ = Path(__file__).resolve().parent.parent
API_PADRAO = os.environ.get("API_URL", "http://localhost:8000")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="Envia o espelho do Calendário para o app.")
    p.add_argument("arquivo", help="caminho do calendario-espelho.json")
    p.add_argument("--api", default=API_PADRAO)
    a = p.parse_args()

    chave_arq = RAIZ / ".sync_token"
    if not chave_arq.exists():
        print(f"Falta o arquivo da chave: {chave_arq}")
        return 1
    chave = chave_arq.read_text(encoding="ascii").strip()
    dados = Path(a.arquivo).read_bytes()
    try:
        json.loads(dados.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        print(f"O arquivo não é um JSON válido em UTF-8: {e}")
        return 1

    r = httpx.post(f"{a.api}/api/v1/calendario/espelho", content=dados, timeout=60,
                   headers={"X-Sync-Token": chave, "Content-Type": "application/json"})
    try:
        corpo = r.json()
    except ValueError:
        corpo = {"detail": r.text[:300]}
    if r.status_code == 200:
        print(f"Espelho enviado: {corpo['itens']} itens, gerado em {corpo['gerado_em']}, recebido em {corpo['recebido_em']}.")
        return 0
    print(f"Envio recusado (HTTP {r.status_code}): {json.dumps(corpo.get('detail', corpo), ensure_ascii=False)}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
