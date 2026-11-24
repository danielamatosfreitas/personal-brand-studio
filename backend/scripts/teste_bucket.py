"""
scripts/teste_bucket.py
Teste real do bucket de mídia, antes de migrar: sobe um arquivo de 300 MB
(envio em partes), confere o tamanho no bucket, gera a URL assinada e baixa o
primeiro 1 MB por ela, sem credencial (como o Instagram faria), confere que o
endereço sem assinatura é recusado (bucket privado) e apaga o arquivo de teste.

Nunca imprime chave, segredo nem a URL assinada inteira: só o servidor, o
nome do bucket, tamanhos, tempos e OK ou FALHA por etapa.

Uso (as variáveis S3_* vêm do serviço na Railway, sem passar valores a ninguém):
  railway run python scripts/teste_bucket.py            # 300 MB
  railway run python scripts/teste_bucket.py --mb 5     # teste rápido
"""
import argparse
import hashlib
import os
import sys
import tempfile
import time
import uuid
from urllib.parse import urlparse

import httpx

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings  # noqa: E402
from app.services import storage_service as st  # noqa: E402


def etapa(nome, ok, detalhe=""):
    print(f"[{'OK' if ok else 'FALHA'}] {nome}{': ' + detalhe if detalhe else ''}", flush=True)
    return ok


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # acentos certos no terminal do Windows
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--mb", type=int, default=300)
    args = ap.parse_args()

    faltando = [n for n in ("S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY") if not getattr(settings, n)]
    if not etapa("variáveis S3_* presentes", not faltando, ("faltam " + ", ".join(faltando)) if faltando else ""):
        return 1
    print(f"servidor: {urlparse(settings.S3_ENDPOINT).hostname} | bucket: {settings.S3_BUCKET} | "
          f"estilo: {settings.S3_ADDRESSING_STYLE} | região: {settings.S3_REGION}", flush=True)

    cliente = st.client()
    chave = f"teste-{uuid.uuid4().hex}.mp4"
    tamanho = args.mb * 1024 * 1024
    falhas = 0
    with tempfile.TemporaryDirectory() as pasta:
        caminho = os.path.join(pasta, "teste.bin")
        h = hashlib.sha256()
        with open(caminho, "wb") as f:
            restante = tamanho
            while restante:
                bloco = os.urandom(min(restante, 8 * 1024 * 1024))
                f.write(bloco)
                h.update(bloco)
                restante -= len(bloco)
        with open(caminho, "rb") as f:
            primeiro_mb = f.read(1024 * 1024)

        # 1. envio em partes
        t0 = time.time()
        try:
            cliente.upload_file(caminho, settings.S3_BUCKET, chave,
                                ExtraArgs={"ContentType": "video/mp4"}, Config=st.transfer_config())
            etapa(f"envio de {args.mb} MB em partes de 16 MB", True, f"{time.time() - t0:.0f} s")
        except Exception as e:
            etapa(f"envio de {args.mb} MB", False, f"{type(e).__name__}: {e}")
            return 1

        try:
            # 2. tamanho no bucket
            cab = cliente.head_object(Bucket=settings.S3_BUCKET, Key=chave)
            falhas += not etapa("tamanho no bucket", cab["ContentLength"] == tamanho, f"{cab['ContentLength']} bytes")

            # 3. URL assinada: baixar o primeiro 1 MB sem credencial. Erros de
            # rede mostram só o tipo: a mensagem traria a URL com a assinatura.
            url = st.presigned_url(st.REF_PREFIX + chave)
            u = urlparse(url)
            try:
                r = httpx.get(url, headers={"Range": "bytes=0-1048575"}, timeout=60)
                total = r.headers.get("content-range", "").split("/")[-1]
                ok = r.status_code in (200, 206) and r.content[:1024 * 1024] == primeiro_mb
                falhas += not etapa("URL assinada baixa o arquivo sem credencial", ok,
                                    f"HTTP {r.status_code}, servidor {u.hostname}, validade {settings.MEDIA_URL_TTL_SECONDS} s, tamanho informado {total or '-'}")
            except Exception as e:
                falhas += 1
                etapa("URL assinada baixa o arquivo sem credencial", False, f"erro de rede: {type(e).__name__}, servidor {u.hostname}")

            # 4. bucket privado: o mesmo endereço sem assinatura é recusado
            try:
                r2 = httpx.get(f"{u.scheme}://{u.netloc}{u.path}", timeout=30)
                falhas += not etapa("endereço sem assinatura é recusado (bucket privado)", r2.status_code in (401, 403), f"HTTP {r2.status_code}")
            except Exception as e:
                falhas += 1
                etapa("endereço sem assinatura é recusado (bucket privado)", False, f"erro de rede: {type(e).__name__}")
        finally:
            # 5. limpeza
            try:
                cliente.delete_object(Bucket=settings.S3_BUCKET, Key=chave)
                etapa("arquivo de teste apagado do bucket", True)
            except Exception as e:
                falhas += 1
                etapa("arquivo de teste apagado do bucket", False, f"{type(e).__name__}: {e}")
            # sobras de rodadas interrompidas: só arquivos com o prefixo "teste-"
            try:
                sobras = [o["Key"] for o in cliente.list_objects_v2(Bucket=settings.S3_BUCKET, Prefix="teste-").get("Contents", [])]
                for k in sobras:
                    cliente.delete_object(Bucket=settings.S3_BUCKET, Key=k)
                etapa("nenhum arquivo de teste sobrando no bucket", True, f"{len(sobras)} sobra(s) apagada(s)")
            except Exception as e:
                falhas += 1
                etapa("nenhum arquivo de teste sobrando no bucket", False, f"{type(e).__name__}: {e}")

    print("RESULTADO: " + ("tudo OK" if not falhas else f"{falhas} etapa(s) com FALHA"), flush=True)
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
