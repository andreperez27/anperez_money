#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
reconciliar_planilha_recebidos.py — Alinha as linhas `historico_planilha` do
Planejamento com a planilha CONTABILADE (fonte de verdade) e preenche as
colunas de semana de TRABALHO.

Contexto (06/09/2026): o relatório "Recebido & horas" vincula os extras de uma
semana de trabalho aos PAGAMENTOS que cobrem essa semana pelas colunas
ano_semana_trabalho/semana_trabalho (migration 28). As linhas importadas da
planilha nunca receberam essas colunas → o relatório não encontra vínculo e
mostra extras = R$0 mesmo quando a semana tem extras no Ponto (bug relatado em
junho/agosto). A descrição da planilha carrega o "período de X à Y" (o início
É a segunda-feira da semana de trabalho), então dá para reconstruir o vínculo:

  • BACKFILL: para linhas com colunas vazias, extrair o início do período da
    descricao → (ano_semana_trabalho, semana_trabalho) ISO.
  • DESCRICAO DRIFT: corrigir a descricao no banco para a texto exato da
    planilha (mantém a idempotência por (data, valor, descricao) da importação
    — senão uma reimportação duplicaria as linhas alteradas).

Também cobre lançamentos do próprio app (origem manual/recorrente) cuja
descricao declara "da semana N" (ex.: "Pagamento da semana 34"): preenche
(ano, N) usando o ano ISO da semana de trabalho derivada da data.

EXCLUSÃO explícita: origem 'historico_planilha' com data >= 24/08/2026 (corte
05/09/2026 — a fonte a partir da semana 34/2026 é o próprio app).

FLUXO:
  .venv\\Scripts\\python.exe scripts\\reconciliar_planilha_recebidos.py
      → MODO ANÁLISE (só leitura): imprime o plano de PATCHes.
  ... --aplicar    → executa os PATCHes (pede confirmação).
  ... --aplicar --sim → executa sem confirmação.
  --email / --senha → credenciais (ou SUPABASE_EMAIL/SUPABASE_SENHA).
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PROJETO = Path(__file__).resolve().parents[1]
ENV_LOCAL = PROJETO / ".env.local"
DEFAULT_PLANILHA = Path(
    r"C:\Users\andre\Desktop\contas\contabilidade total\CONTABILADE_Consolidada_atualizada.xlsx"
)
ABA = "Entradas Consolidadas"
CORTE_2026 = "2026-08-24"

# "período de 25/05/26 à 31/05/26" — início = segunda-feira da semana de trabalho.
RE_PERIODO = re.compile(
    r"[pP]er[ií]odo de (\d{1,2})/(\d{1,2})/(\d{2,4})\s*(?:a|à|at[eé])\s*(\d{1,2})/(\d{1,2})/(\d{2,4})"
)
RE_SEMANA_N = re.compile(r"semana\s+(\d{1,2})")
# "Pagamento Semanal" (recorrente do app): paga a semana de trabalho ANTERIOR
# ao recebimento (data − 7 → segunda-feira da semana).
RE_PAGAMENTO_SEMANAL = re.compile(
    r"^[Pp]agamento\s+[Ss]emanal(?:\b|$)"
)


def ano_de(yy):
    """'26' → 2026 (século por convenção do projeto); 4 dígitos → como está."""
    n = int(yy)
    if len(yy) == 2:
        return 2000 + n
    return n


# ---------------------------------------------------------------------------
# Supabase REST (autenticado como o dono — respeita RLS)
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


def rest(url, apikey, token, metodo="GET", corpo=None, extra_headers=None):
    req = urllib.request.Request(url, method=metodo)
    req.add_header("apikey", apikey)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    for chave, valor in (extra_headers or {}).items():
        req.add_header(chave, valor)
    data = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=60) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        return e.code, raw[:500]


def login_supabase(env, email=None, senha=None):
    url = env.get("VITE_SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    apikey = env.get("VITE_SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")
    if not url or not apikey:
        sys.exit("Sem VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY no .env.local do projeto.")
    email = email or env.get("SUPABASE_EMAIL") or os.environ.get("SUPABASE_EMAIL")
    senha = senha or env.get("SUPABASE_SENHA") or os.environ.get("SUPABASE_SENHA")
    if not email:
        email = input("E-mail do usuário dono (Supabase): ").strip()
    if not senha:
        senha = getpass.getpass("Senha do usuário: ")
    status, resp = rest(
        f"{url}/auth/v1/token?grant_type=password",
        apikey, apikey,
        metodo="POST",
        corpo={"email": email, "password": senha},
    )
    if status not in (200, 201) or not isinstance(resp, dict) or not resp.get("access_token"):
        print(f"[erro] falha no login ({status}): {resp}")
        sys.exit(1)
    print(f"  ok, autenticado como {resp.get('user', {}).get('email')}")
    return url, apikey, resp["access_token"]


# ---------------------------------------------------------------------------
# Fontes de dados
# ---------------------------------------------------------------------------

def ler_planilha(planilha: Path):
    """Linhas da aba 'Entradas Consolidadas' no formato (data_iso, valor, valor_semanal, descricao)."""
    import openpyxl  # noqa: PLC0415

    wb = openpyxl.load_workbook(planilha, data_only=True)
    ws = wb[ABA]
    linhas = []
    for r in ws.iter_rows(values_only=True):
        if not r or not any(c is not None for c in r):
            continue
        data = r[0]
        if isinstance(data, datetime):
            data = data.date()
        if not isinstance(data, date):
            continue
        valor_semanal_raw = r[1]
        valor = r[5]
        descricao = str(r[6] or "").strip()
        if valor is None:
            continue
        linhas.append({
            "data_iso": data.isoformat(),
            "valor": round(float(valor), 2),
            "valor_semanal": round(float(valor_semanal_raw), 2) if valor_semanal_raw is not None else None,
            "descricao": descricao,
        })
    return linhas


def semana_trabalho_da_descricao(descricao):
    """Segunda-feira ISO da semana de trabalho declarada na descricao
    (início do 'período de X à Y'). None se não houver período parseável."""
    m = RE_PERIODO.search(descricao)
    if not m:
        return None
    try:
        return date(ano_de(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        return None


def semana_trabalho_da_data(data_iso):
    """Convenção do app: o pagamento paga a semana civil ANTERIOR (data − 7)."""
    d = date.fromisoformat(data_iso) - __import__("datetime").timedelta(days=7)
    return d - __import__("datetime").timedelta(days=d.isoweekday() - 1)


def ler_do_banco(url, apikey, token):
    """Linhas da planilha + app-native candidatas à reconciliação."""
    status, rows = rest(
        f"{url}/rest/v1/planejamentos?"
        f"select=id,data_prevista,valor,valor_semanal,descricao,tipo_op,estado,origem,"
        f"ano_semana_trabalho,semana_trabalho&limit=10000"
        f"&order=data_prevista",
        apikey, token,
    )
    if status != 200:
        sys.exit(f"[erro] listando planejamentos ({status}): {rows}")
    return rows or []


# ---------------------------------------------------------------------------
# Plano
# ---------------------------------------------------------------------------

def montar_plano(planilha: Path, rows, url, apikey, token):
    plan_sp = ler_planilha(planilha)
    sp_por_chave = {}
    for l in plan_sp:
        sp_por_chave.setdefault((l["data_iso"], l["valor"]), []).append(l)

    backfill = []   # (origem, id, data, valor, descricao, ano, semana)
    base_semanal = []  # (origem, id, data, valor, descricao, valor_semanal)
    drift = []      # (origem, id, data, valor, atual, esperado)

    for p in rows:
        dados = {
            "origem": p.get("origem") or "?",
            "id": p.get("id"),
            "data": str(p.get("data_prevista") or "")[:10],
            "valor": round(float(p.get("valor") or 0), 2),
            "descricao": str(p.get("descricao") or "").strip(),
        }
        ano_col = p.get("ano_semana_trabalho")
        semana_col = p.get("semana_trabalho")
        colunas_vazias = ano_col is None or semana_col is None

        # --- backfill: preencher colunas de trabalho quando vazias ----------
        if colunas_vazias:
            inicio = None
            if dados["origem"] == "historico_planilha":
                if dados["data"] < CORTE_2026:
                    inicio = semana_trabalho_da_descricao(dados["descricao"])
            else:  # lançamentos do próprio app
                if dados["origem"] not in ("manual", "recorrente", "jornada"):
                    inicio = None
                else:
                    m = RE_SEMANA_N.search(dados["descricao"])
                    if m:
                        seg = semana_trabalho_da_data(dados["data"])
                        iso = seg.isocalendar()
                        try:
                            inicio = date.fromisocalendar(iso.year, int(m.group(1)), 1)
                        except ValueError:
                            inicio = None
                    elif RE_PAGAMENTO_SEMANAL.match(dados["descricao"]):
                        inicio = semana_trabalho_da_data(dados["data"])
            if inicio is not None:
                iso = inicio.isocalendar()
                if (ano_col, semana_col) != (iso.year, iso.week):
                    backfill.append((*dados.values(), iso.year, iso.week))

        # --- backfill: valor_semanal (coluna B da planilha) ----------------
        if dados["origem"] == "historico_planilha" and dados["data"] < CORTE_2026:
            vs_banco = p.get("valor_semanal")
            candidatas = sp_por_chave.get((dados["data"], dados["valor"]), [])
            # Busca a que mais se aproxima da descricao do banco
            vs_planilha = None
            for sp in candidatas:
                if sp["descricao"] == dados["descricao"] or sp["valor_semanal"] is not None:
                    vs_planilha = sp["valor_semanal"]
                    break
            if vs_planilha is None and candidatas:
                vs_planilha = candidatas[0]["valor_semanal"]
            if vs_planilha is not None:
                vs_banco_num = round(float(vs_banco), 2) if vs_banco is not None else None
                if vs_banco_num != vs_planilha:
                    base_semanal.append((dados["origem"], dados["id"], dados["data"],
                                         dados["valor"], dados["descricao"], vs_planilha))

        # --- drift de descricao (só planilha): alinhar com a fonte ----------
        if dados["origem"] == "historico_planilha":
            candidatas = sp_por_chave.get((dados["data"], dados["valor"]), [])
            esperada = next((l["descricao"] for l in candidatas if dados["descricao"] == l["descricao"]), None)
            if esperada is None and candidatas:
                esperada = candidatas[0]["descricao"]
            if esperada is not None and dados["descricao"] != esperada:
                drift.append((dados["origem"], dados["id"], dados["data"], dados["valor"], dados["descricao"], esperada))

    return backfill, base_semanal, drift, len(plan_sp)


def aplicar_patch(url, apikey, token, id_linha, corpo):
    status, resp = rest(
        f"{url}/rest/v1/planejamentos?id=eq.{urllib.parse.quote(str(id_linha))}",
        apikey, token, metodo="PATCH", corpo=corpo,
    )
    return status


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Reconcilia recebidos da planilha no Planejamento.")
    ap.add_argument("--planilha", type=Path, default=DEFAULT_PLANILHA)
    ap.add_argument("--aplicar", action="store_true", help="executa os PATCHes (pede confirmação)")
    ap.add_argument("--sim", action="store_true", help="não confirma antes de gravar")
    ap.add_argument("--email", help="e-mail do usuário dono")
    ap.add_argument("--senha", help="senha do usuário dono")
    args = ap.parse_args()

    if not args.planilha.exists():
        sys.exit(f"Planilha não encontrada: {args.planilha}")

    env = carregar_env()
    url, apikey, token = login_supabase(env, args.email, args.senha)

    rows = ler_do_banco(url, apikey, token)
    print(f"  linhas de planejamentos lidas: {len(rows)}")
    backfill, base_semanal, drift, n_sp = montar_plano(args.planilha, rows, url, apikey, token)

    print("\n=== BACKFILL: colunas (ano_semana_trabalho, semana_trabalho) ===")
    print(f"  linhas da planilha analisadas: {n_sp}")
    print(f"  preenchimentos pendentes: {len(backfill)}")
    for origem, id_linha, data, valor, descricao, ano, semana in backfill:
        print(f"    {data} {origem:17} R$ {valor:9.2f} → ({ano}, {semana:02d})  {descricao[:56]}")

    print("\n=== BACKFILL: valor_semanal (coluna B da planilha) ===")
    print(f"  divergências: {len(base_semanal)}")
    for origem, id_linha, data, valor, descricao, vs in base_semanal:
        print(f"    {data} R$ {valor:9.2f} → valor_semanal R$ {vs:9.2f}  {descricao[:56]}")

    print("\n=== DESCRIÇÃO DRIFT (banco ≠ planilha) ===")
    print(f"  divergências: {len(drift)}")
    for origem, id_linha, data, valor, atual, esperada in drift:
        print(f"    {data} R$ {valor:9.2f}")
        print(f"      banco:     {atual}")
        print(f"      planilha:  {esperada}")

    total = len(backfill) + len(base_semanal) + len(drift)
    if total == 0:
        print("\nNada a corrigir. Tudo alinhado.")
        return 0

    if not args.aplicar:
        print("\nModo análise. Rode com --aplicar para executar os PATCHes.")
        return 0

    if not args.sim:
        if input(f"\nConfirmar {total} PATCHes no Supabase? [s/N] ").strip().lower() != "s":
            print("Cancelado.")
            return 0

    ok_b, ok_vs, ok_d = 0, 0, 0
    for origem, id_linha, data, valor, descricao, ano, semana in backfill:
        st = aplicar_patch(url, apikey, token, id_linha, {"ano_semana_trabalho": ano, "semana_trabalho": semana})
        if st in (200, 204):
            ok_b += 1
        else:
            print(f"    [erro] backfill {data} ({st})")
    for origem, id_linha, data, valor, descricao, vs in base_semanal:
        st = aplicar_patch(url, apikey, token, id_linha, {"valor_semanal": vs})
        if st in (200, 204):
            ok_vs += 1
        else:
            print(f"    [erro] valor_semanal {data} ({st})")
    for origem, id_linha, data, valor, atual, esperada in drift:
        st = aplicar_patch(url, apikey, token, id_linha, {"descricao": esperada})
        if st in (200, 204):
            ok_d += 1
        else:
            print(f"    [erro] descricao {data} ({st})")

    print(f"\nConcluído: {ok_b} backfills + {ok_vs} valor_semanal + {ok_d} descrições corrigidas.")
    return 0


if __name__ == "__main__":
    import traceback
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)