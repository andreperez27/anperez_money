#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
aplicar_categorias_planilha.py — Grava no Supabase as categorias revisadas na
planilha scripts/previsao_categorizacao.xlsx (aba "Lançamentos").

SEM dependências externas além do openpyxl (para LER a planilha): o resto é
stdlib (urllib) contra a API REST do Supabase (PostgREST), autenticando como o
USUÁRIO DONO (respeita RLS).

MODOS
-----
  1) DRY-RUN (padrão, não grava nada):
       .venv\\Scripts\\python.exe scripts\\aplicar_categorias_planilha.py
  2) APLICAR de verdade (faz backup antes):
       .venv\\Scripts\\python.exe scripts\\aplicar_categorias_planilha.py --aplicar

O QUE ELE FAZ
-------------
  • Lê cada linha da planilha e cruza com o lançamento correspondente no banco
    (conta ou cartão) pela combinação data + valor + tipo + origem, usando a
    descrição como discriminante dentro do grupo (a planilha preserva o vínculo
    com o registro de origem; quando a descrição foi renomeada na edição, a
    linha casa com a correspondente restante do grupo — mesmo critério validado
    em diff_final.py, que fechou em 0 sem correspondência).
  • Grava a categoria_sugerida em movimentacoes.categoria ou compras.categoria.
    Quando a descrição foi RENOMEADA na planilha (ex.: 'Netflix.Com' -> 'Netflix'),
    grava também a descrição nova no registro correspondente (por id — seguro:
    a identidade é o UUID, não o texto; não há unique constraint em descricao).
  • Linhas com status 'excluir' (Saldo Inicial) ficam FORA do escopo: nenhuma
    categoria, não contam em nenhum totalizador.
  • Linhas SEM categoria (categoria vazia ou 'Sem Categoria') são PULADAS:
    não ganham categoria (revisão manual fica como está).
  • Antes de aplicar de verdade, confirma que a coluna public.compras.categoria
    existe (DDL da migration supabase/32_categoria_compras.sql no SQL Editor).

FLAGS
-----
  --planilha CAMINHO   planilha de origem (default: scripts/previsao_categorizacao.xlsx)
  --dry-run            (padrão) só relatório, não grava
  --aplicar            faz backup e grava as categorias de verdade
  --backup-dir         onde salvar o backup (default: scripts/backups)
  --sim                pula a confirmação antes de gravar
  --email / --senha    credenciais do dono (ou SUPABASE_EMAIL/SUPABASE_SENHA)

CREDENCIAIS: VITE_SUPABASE_URL/ANON_KEY do .env.local + SUPABASE_EMAIL/SENHA
(ou --email/--senha).
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PROJETO = Path(__file__).resolve().parents[1]
ENV_LOCAL = PROJETO / ".env.local"
PLANILHA_DEFAULT = PROJETO / "scripts" / "previsao_categorizacao.xlsx"
BACKUP_DIR_DEFAULT = PROJETO / "scripts" / "backups"

CENT_1 = 0.011  # tolerância de centavos no casamento de valor


# ---------------------------------------------------------------------------
# Supabase REST (padrão do projeto)
# ---------------------------------------------------------------------------


def carregar_env():
    env = {}
    if ENV_LOCAL.exists():
        for linha in ENV_LOCAL.read_text(encoding="utf-8", errors="replace").splitlines():
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, _, valor = linha.partition("=")
            env[chave.strip()] = valor.strip().strip('"').strip("'")
    return env


def rest(url, apikey, token, metodo="GET", corpo=None, prefer=None):
    req = urllib.request.Request(url, method=metodo)
    req.add_header("apikey", apikey)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    if prefer:
        req.add_header("Prefer", prefer)
    data = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=60) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        return e.code, raw[:500]


def login_supabase(env, email=None, senha=None):
    url = env.get("VITE_SUPABASE_URL") or input("VITE_SUPABASE_URL: ").strip()
    apikey = env.get("VITE_SUPABASE_ANON_KEY") or input("VITE_SUPABASE_ANON_KEY: ").strip()
    if not url or not apikey:
        sys.exit("Sem VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY no .env.local do projeto.")
    email = email or env.get("SUPABASE_EMAIL") or os.environ.get("SUPABASE_EMAIL")
    senha = senha or env.get("SUPABASE_SENHA") or os.environ.get("SUPABASE_SENHA")
    if not email:
        email = input("E-mail do usuário dono (Supabase): ").strip()
    if not senha:
        senha = getpass.getpass("Senha do usuário: ")
    status, resp = rest(
        f"{url}/auth/v1/token?grant_type=password", apikey, apikey, "POST",
        {"email": email, "password": senha},
    )
    if status not in (200, 201) or not isinstance(resp, dict) or not resp.get("access_token"):
        print(f"[erro] falha no login ({status}): {resp}")
        sys.exit(1)
    print(f"  ok, autenticado como {resp.get('user', {}).get('email')}")
    return url, apikey, resp["access_token"]


def consultar(url, apikey, token, query):
    status, resp = rest(f"{url}/rest/v1/{query}", apikey, token)
    if status != 200:
        raise RuntimeError(f"consulta falhou ({status}): {query}\n{resp}")
    return resp or []


# ---------------------------------------------------------------------------
# Leitura da planilha
# ---------------------------------------------------------------------------


def ler_planilha(caminho: Path):
    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl não instalado: pip install openpyxl (ou use o .venv do projeto).")
    wb = openpyxl.load_workbook(caminho, data_only=True)
    nome_aba = "Lançamentos" if "Lançamentos" in wb.sheetnames else "Lancamentos"
    ws = wb[nome_aba]
    linhas = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        data, desc, valor, tipo, origem, categoria, status = row
        linhas.append({
            "data": str(data)[:10] if data is not None else "",
            "descricao": (desc or "").strip(),
            "valor": round(float(valor), 2) if valor is not None else 0.0,
            "tipo": (tipo or "").strip(),
            "origem": (origem or "").strip(),
            "categoria": (categoria or "").strip(),
            "status": (status or "").strip(),
        })
    return linhas


def normalizar(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", s.lower())


def mesma_categoria(a, b):
    """Compara categorias ignorando acento/caixa/espaço.

    Ex.: 'Transferência' (planilha) == 'transferencia' (banco, canônica do
    módulo de transferências). Evita tentar editar movimentações protegidas
    por trigger (pernas de transferência) quando a categoria já é a mesma."""
    a = (a or "").strip()
    b = (b or "").strip()
    if not a or not b:
        return a == b
    return normalizar(a) == normalizar(b)


# ---------------------------------------------------------------------------
# Cruzamento planilha <-> banco
# ---------------------------------------------------------------------------


def montar_base_banco(url, apikey, token):
    """Agrupa movimentações e compras pela chave (data, valor, tipo, origem).

    Devolve: dict chave -> lista de dicts {tabela, id, descricao, categoria}.
    origem = nome da conta (movimentações) ou "Cartão <nome>" (compras).
    """
    grupos = defaultdict(list)
    mov = consultar(
        url, apikey, token,
        "movimentacoes?select=id,data,descricao,valor,tipo_op,contas(nome),categoria&order=data.asc&limit=10000",
    )
    for m in mov:
        conta = (m.get("contas") or {}).get("nome") or "?"
        chave = (
            m["data"],
            round(float(m["valor"]), 2),
            "entrada" if m["tipo_op"] == "Entrada" else "saida",
            conta,
        )
        grupos[chave].append({
            "tabela": "movimentacoes", "id": m["id"],
            "descricao": m["descricao"], "categoria": m.get("categoria"),
        })
    # Em dry-run a coluna compras.categoria pode ainda não existir (migration 32
    # pendente): em vez de abortar, consulta sem a coluna e assume categoria None.
    try:
        compras = consultar(
            url, apikey, token,
            "compras?select=id,data,descricao,valor_total,cartoes(nome),categoria&ativa=eq.true&order=data.asc&limit=10000",
        )
    except RuntimeError as e:
        if "42703" not in str(e):
            raise
        compras = consultar(
            url, apikey, token,
            "compras?select=id,data,descricao,valor_total,cartoes(nome)&ativa=eq.true&order=data.asc&limit=10000",
        )
        print("  [aviso] compras.categoria ainda não existe — assumindo categoria atual = None (migration 32 pendente)")
        for cadeextra in compras:
            cadeextra["categoria"] = None
    for c in compras:
        cartao = (c.get("cartoes") or {}).get("nome") or "?"
        chave = (
            c["data"],
            round(float(c["valor_total"]), 2),
            "saida",
            f"Cartão {cartao}",
        )
        grupos[chave].append({
            "tabela": "compras", "id": c["id"],
            "descricao": c["descricao"], "categoria": c.get("categoria"),
        })
    return grupos


def chave_planilha(l):
    return (l["data"], round(float(l["valor"]), 2), l["tipo"], l["origem"])


def montar_plano(linhas, grupos):
    """Casa cada linha aplicável da planilha com um registro do banco.

    Critério: chave (data, valor, tipo, origem); dentro do grupo, descrição
    igual primeiro; se não houver (renomeada na edição), casa com o primeiro
    restante do grupo e remove — mesmo critério do diff_final.py (0 sem-match).

    Devolve: {"plano": [...], "excluidas": int, "sem_categoria": [...],
              "sem_match": [...], "sobrando_banco": [...]}.
    """
    plano = []
    sem_categoria = []
    sem_match = []
    excluidas = []

    # cópia mutável: cada registro do banco casa com no máximo 1 linha
    copia = {k: [dict(r) for r in v] for k, v in grupos.items()}
    usados = set()  # ids já consumidos

    def consume(chave):
        restante = [r for r in copia.get(chave, []) if r["id"] not in usados]
        return restante

    for l in linhas:
        if l["status"] == "excluir":
            excluidas.append(l)
            # registra a chave como "fora do escopo" para a sobra do banco
            continue
        if not l["categoria"] or l["categoria"] == "Sem Categoria":
            sem_categoria.append(l)
            continue
        chave = chave_planilha(l)
        restante = consume(chave)
        if not restante:
            sem_match.append(l)
            continue
        # descrição igual dentro do grupo
        alvo = next((r for r in restante if r["descricao"] == l["descricao"]), None)
        if alvo is None:
            alvo = restante[0]  # descrição renomeada na edição
            l = dict(l, _descricao_banco=alvo["descricao"])
        alvo = dict(alvo)
        usados.add(alvo["id"])
        plano.append({
            "tabela": alvo["tabela"], "id": alvo["id"],
            "descricao_planilha": l["descricao"],
            "descricao_banco": l.get("_descricao_banco", l["descricao"]),
            "categoria_atual": alvo["categoria"],
            "categoria_nova": l["categoria"],
            "data": l["data"], "valor": l["valor"], "tipo": l["tipo"],
            "origem": l["origem"],
        })

    # registros do banco que sobraram sem correspondência na planilha
    # (esperado: apenas os 'Saldo Inicial', que estão fora do escopo —
    # status 'excluir' na planilha — e são reconhecidos pela chave)
    chaves_fora = {chave_planilha(l) for l in excluidas}
    sobrando_fora = []
    sobrando_sem_plano = []
    for chave, regs in copia.items():
        for r in regs:
            if r["id"] not in usados and r["tabela"] == "movimentacoes" and chave in chaves_fora:
                sobrando_fora.append(r)
            elif r["id"] not in usados:
                sobrando_sem_plano.append(r)

    return {
        "plano": plano,
        "excluidas": len(excluidas),
        "sem_categoria": sem_categoria,
        "sem_match": sem_match,
        "sobrando_fora": sobrando_fora,
        "sobrando_sem_plano": sobrando_sem_plano,
    }


# ---------------------------------------------------------------------------
# Relatório dry-run
# ---------------------------------------------------------------------------


def imprimir_dry_run(res, linhas, coluna_compras_existe):
    plano = res["plano"]
    por_tabela = defaultdict(int)
    a_gravar = 0
    ja_igual = 0
    for p in plano:
        por_tabela[p["tabela"]] += 1
        if mesma_categoria(p["categoria_atual"], p["categoria_nova"]):
            ja_igual += 1
        else:
            a_gravar += 1

    print("\n" + "=" * 66)
    print("DRY-RUN — APLICAÇÃO DAS CATEGORIAS DA PLANILHA")
    print("=" * 66)
    print(f"Linhas na planilha (aba Lançamentos): {len(linhas)}")
    print(f"  • fora do escopo (status 'excluir' — Saldo Inicial): {res['excluidas']}")
    print(f"  • puladas SEM categoria (Sem Categoria/revisão manual): {len(res['sem_categoria'])}")
    print(f"  • casadas com registro no banco: {len(plano)}")
    print(f"      movimentações de conta : {por_tabela.get('movimentacoes', 0)}")
    print(f"      compras de cartão      : {por_tabela.get('compras', 0)}")
    print(f"    → receberão/atualizarão categoria: {a_gravar}")
    print(f"    → já com a mesma categoria (sem alteração): {ja_igual}")
    print(f"  • SEM correspondência no banco (esperado 0): {len(res['sem_match'])}")
    print(f"  • registros do banco sem linha na planilha (esperado 0): {len(res['sobrando_sem_plano'])}")
    print(f"  • registros do banco correspondentes a linhas 'excluir' (esperado {len(res['sobrando_fora'])} — Saldo Inicial): {len(res['sobrando_fora'])}")
    print(f"Coluna compras.categoria existe no banco: {'SIM' if coluna_compras_existe else 'NÃO (rode a migration 32 no SQL Editor antes de aplicar)'}")

    if res["sem_categoria"]:
        print("\n--- Puladas SEM categoria (ficam como estão) ---")
        for l in res["sem_categoria"][:15]:
            print(f"  {l['data']} {l['tipo']:7} R$ {l['valor']:>9,.2f}  {l['descricao']!r}  [{l['origem']}]")

    if res["sem_match"]:
        print("\n--- SEM CORRESPONDÊNCIA (precisa investigar) ---")
        for l in res["sem_match"][:30]:
            print(f"  {l['data']} {l['tipo']:7} R$ {l['valor']:>9,.2f}  {l['descricao']!r}  [{l['origem']}]")

    if res["sobrando_sem_plano"]:
        print("\n--- Registros do banco sem linha na planilha (precisa investigar) ---")
        for r in res["sobrando_sem_plano"][:30]:
            print(f"  {r['tabela']} {r['descricao']!r}")

    if res["sobrando_fora"]:
        print(f"\n--- Registros do banco das linhas 'excluir' (Saldo Inicial — esperado): {len(res['sobrando_fora'])} ---")
        for r in res["sobrando_fora"][:10]:
            print(f"  {r['tabela']} {r['descricao']!r}")

    # amostra de renomeações (descrições casadas por posição)
    renomeadas = [p for p in plano if p["descricao_planilha"] != p["descricao_banco"]]
    if renomeadas:
        print(f"\n--- Descrições a renomear no banco (gravadas por id, sem duplicidade): {len(renomeadas)} ---")
        for p in renomeadas[:20]:
            print(f"  {p['descricao_banco']!r} -> {p['descricao_planilha']!r}  → {p['categoria_nova']!r}")

    print("\n" + "=" * 66)
    print("(modo DRY-RUN — nada foi gravado no Supabase)")
    if not coluna_compras_existe:
        print("Antes de aplicar, rode no SQL Editor do Supabase o arquivo:")
        print("  supabase\\32_categoria_compras.sql")


# ---------------------------------------------------------------------------
# Aplicação
# ---------------------------------------------------------------------------


def verificar_coluna_compras(url, apikey, token):
    """Confirma que compras.categoria existe para poder fazer PATCH."""
    status, resp = rest(f"{url}/rest/v1/compras?select=categoria&limit=1", apikey, token)
    return status == 200


def realizar_backup(url, apikey, token, backup_dir: Path):
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dados = {
        "movimentacoes": consultar(
            url, apikey, token,
            "movimentacoes?select=id,data,descricao,valor,tipo_op,categoria&limit=10000",
        ),
        "compras": consultar(
            url, apikey, token,
            "compras?select=id,data,descricao,valor_total,ativa,categoria&limit=10000",
        ),
    }
    arquivo = backup_dir / f"backup_categorias_{ts}.json"
    arquivo.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  backup gravado: {arquivo}")
    return arquivo


def aplicar_plano(url, apikey, token, plano):
    ok = 0
    erros = []
    renomeadas = 0
    for p in plano:
        corpo = {"categoria": p["categoria_nova"]}
        descricao_muda = p["descricao_planilha"] != p["descricao_banco"]
        if descricao_muda:
            corpo["descricao"] = p["descricao_planilha"]
            renomeadas += 1
        if not descricao_muda and mesma_categoria(p["categoria_atual"], p["categoria_nova"]):
            ok += 1  # já igual — conta como ok/sem alteração
            continue
        s, r = rest(f"{url}/rest/v1/{p['tabela']}?id=eq.{p['id']}", apikey, token,
                    "PATCH", corpo=corpo)
        if s in (200, 204):
            ok += 1
        else:
            erros.append((p, s, r))
    return ok, erros, renomeadas


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Grava no Supabase as categorias revisadas da planilha previsao_categorizacao.xlsx.")
    parser.add_argument("--planilha", type=Path, default=PLANILHA_DEFAULT)
    parser.add_argument("--dry-run", action="store_true", help="só relatório, não grava (padrão)")
    parser.add_argument("--aplicar", action="store_true", help="faz backup e grava de verdade")
    parser.add_argument("--backup-dir", type=Path, default=BACKUP_DIR_DEFAULT)
    parser.add_argument("--sim", action="store_true", help="não confirma antes de gravar")
    parser.add_argument("--email")
    parser.add_argument("--senha")
    args = parser.parse_args()

    if not args.aplicar:
        args.dry_run = True

    if not args.planilha.exists():
        sys.exit(f"Planilha não encontrada: {args.planilha}")

    print(f"=== LEITURA DA PLANILHA — {args.planilha} ===")
    linhas = ler_planilha(args.planilha)
    print(f"  {len(linhas)} linhas na aba Lançamentos")

    env = carregar_env()
    url, apikey, token = login_supabase(env, args.email, args.senha)

    print("\n=== CONSULTANDO BANCO (movimentações e compras) ===")
    grupos = montar_base_banco(url, apikey, token)
    n_mov = sum(1 for rgs in grupos.values() for r in rgs if r["tabela"] == "movimentacoes")
    n_cpr = sum(1 for rgs in grupos.values() for r in rgs if r["tabela"] == "compras")
    print(f"  movimentações: {n_mov} | compras ativas: {n_cpr}")

    coluna_compras_existe = verificar_coluna_compras(url, apikey, token)

    print("\n=== CRUZANDO PLANILHA <-> BANCO ===")
    res = montar_plano(linhas, grupos)
    imprimir_dry_run(res, linhas, coluna_compras_existe)

    if args.dry_run:
        print("\nNada foi gravado. Para aplicar de verdade: scripts\\aplicar_categorias_planilha.py --aplicar")
        return

    if res["sem_match"] or res["sobrando_sem_plano"]:
        print("\n[erro] Existem linhas sem correspondência no banco — não vou aplicar até resolver.")
        sys.exit(1)

    if not coluna_compras_existe:
        print("\n[erro] A coluna public.compras.categoria ainda não existe.")
        print("Rode primeiro no SQL Editor do Supabase o arquivo:")
        print("  supabase\\32_categoria_compras.sql")
        print("Depois rode o script --aplicar de novo.")
        sys.exit(1)

    if not args.sim:
        print("\nVai APLICAR: backup + gravar categorias no Supabase (movimentacoes e compras).")
        if input("Confirmar? [s/N] ").strip().lower() != "s":
            print("Cancelado. Nada foi alterado.")
            return

    print("\n=== BACKUP ===")
    realizar_backup(url, apikey, token, args.backup_dir)

    print("\n=== APLICANDO ===")
    ok, erros, renomeadas = aplicar_plano(url, apikey, token, res["plano"])

    por_tabela = defaultdict(int)
    for p in res["plano"]:
        por_tabela[p["tabela"]] += 1

    print("\n=== RESUMO DA APLICAÇÃO ===")
    print(f"  Linhas casadas: {len(res['plano'])} (movimentações {por_tabela.get('movimentacoes', 0)} | "
          f"compras {por_tabela.get('compras', 0)})")
    print(f"  Descrições renomeadas junto (gravadas por id): {renomeadas}")
    print(f"  Registros OK (gravados ou já iguais): {ok}")
    print(f"  Erros: {len(erros)}")
    for p, s, r in erros[:10]:
        print(f"    [erro] {p['tabela']} {p['id']} ({s}): {r}")


if __name__ == "__main__":
    main()