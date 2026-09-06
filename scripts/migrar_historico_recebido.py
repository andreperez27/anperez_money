#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
migrar_historico_recebido.py — Importa o histórico de RECEBIDOS da planilha
CONTABILADE (aba "Entradas Consolidadas") para o Planejamento do app novo.

CADA LINHA vira UM REGISTRO em `planejamentos` com:
  • tipo_op      = 'Entrada'
  • estado       = 'realizado'   (dinheiro JÁ recebido — não é previsão)
  • data_prevista/descricao/valor = DATA, DESCRIÇÃO e VALOR TOTAL da planilha
  • origem       = 'historico_planilha'  (migration 29 amplia o CHECK)
  • ano_semana/semana = semana ISO calculada da data (aplicação preenche,
    como no restante do módulo — o banco não calcula).
NÃO preenche horas extras nem vincula semana do Ponto: o número de horas do
relatório sai dos fechamentos do Ponto Inteligente (contexto separado).

REGRA DE CORTE (decisão 05/09/2026 com o André): a planilha preenche as
LACUNAS dos ANOS ANTERIORES e de 2026 até a SEMANA 34 (a primeira paga que foi
digitada no app — 24/08/2026, início da semana de trabalho 34). Registros com
data >= 24/08/2026 NÃO são importados (nem contam no relatório) — de lá em
diante a fonte é o próprio app (registros reais do Planejamento/Ponto).

PLANILHA (fonte):
  C:/Users/andre/Desktop/contas/contabilidade total/CONTABILADE_Consolidada_atualizada.xlsx
  Aba "Entradas Consolidadas". Colunas esperadas:
    A DATA | B VALOR SEMANAL | C HorasExtras | D Acordo | E Outros |
    F VALOR TOTAL | G DESCRIÇÃO | H SEMANAS | I Mês | J Ano
  → o script usa A (DATA), B (VALOR SEMANAL — o fixo de referência da semana,
  base do extra do relatório de Recebido & horas), F (VALOR TOTAL) e G
  (DESCRIÇÃO).

FLUXO (mesmo padrão das demais migrações — ver migrar_dados_antigos.py):

  1) ANÁLISE (modo padrão, só leitura local da planilha; NÃO toca no Supabase):
       .venv\\Scripts\\python.exe scripts\\migrar_historico_recebido.py
     Gera scripts\\relatorio_migracao_recebido.md com: linhas a importar,
     soma por ano, e as linhas que precisam de atenção (valor zerado / data
     inválida / divergência entre VALOR TOTAL e a soma das parcelas).

  2) IMPORTAR (autentica como o USUÁRIO DONO — respeita RLS; user_id fica no
     DEFAULT auth.uid(), como em lancar_condominio_mes.py):
       .venv\\Scripts\\python.exe scripts\\migrar_historico_recebido.py --importar
     Pede email/senha (ou registre SUPABASE_EMAIL/SUPABASE_SENHA no .env.local).
     IDEMPOTENTE por (data, valor, descricao): linhas já importadas são puladas.

SEM --corrigir-saldos: estas entradas são PREVISÕES do módulo Planejamento e
NUNCA tocam contas/saldos (regra de ouro da migration 08).

FLAGS:
  --planilha CAMINHO       planilha de origem (default: a do André)
  --relatorio CAMINHO      saída do relatório md
  --importar               grava no Supabase (análise + confirmação)
  --sim                    não confirma antes de gravar
  --email / --senha        credenciais (ou SUPABASE_EMAIL/SUPABASE_SENHA)
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
from collections import Counter
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

# Regra 05/09/2026: a planilha preenche as lacunas dos anos anteriores e de
# 2026 até a semana 34 (primeiro lançamento digitado no app). Registros com
# data >= CORTE_2026 não são importados nem contam no relatório (de 24/08/2026
# em diante a fonte é o próprio app).
CORTE_2026 = "2026-08-24"
DEFAULT_RELATORIO = PROJETO / "scripts" / "relatorio_migracao_recebido.md"

ABA = "Entradas Consolidadas"


# ---------------------------------------------------------------------------
# Leitura da planilha (somente leitura local)
# ---------------------------------------------------------------------------

def ler_entradas_consolidadas(planilha: Path):
    """Lê a aba 'Entradas Consolidadas' e devolve a lista de linhas de dados.

    Cada linha devolvida:
      { num, data_iso, data_bruto, valor, descricao,
        valido, motivo, soma_parcelas, divergencia }
    • valido=True segue para a importação (data real e valor > 0);
    • valido=False entra no relatório em 'Atenção manual' com o motivo.
    """
    import openpyxl

    wb = openpyxl.load_workbook(planilha, data_only=True)
    if ABA not in wb.sheetnames:
        sys.exit(f"Planilha sem a aba '{ABA}': {wb.sheetnames}")
    ws = wb[ABA]

    linhas = []
    for idx, r in enumerate(ws.iter_rows(values_only=True), start=1):
        if not r or not any(c is not None for c in r):
            continue
        if idx == 1:
            continue  # linha do cabeçalho (DATA | VALOR SEMANAL | ... | Ano)
        data_bruto = r[0]
        valor_semanal = r[1]   # B — VALOR SEMANAL (fixo de referência da semana)
        valor = r[5]          # F — VALOR TOTAL
        descricao = r[6]      # G — DESCRIÇÃO
        # Parcelas (só para conferência — B+C+D+E)
        soma_parcelas = None
        if any(c is not None for c in r[1:5]):
            soma_parcelas = round(
                sum(float(c or 0) for c in r[1:5] if c is not None), 2
            )

        data_iso = None
        motivo = None
        if isinstance(data_bruto, datetime):
            data_iso = data_bruto.date().isoformat()
        elif isinstance(data_bruto, date):
            data_iso = data_bruto.isoformat()
        else:
            motivo = f"data não é data (tipo {type(data_bruto).__name__}: {data_bruto!r})"

        if data_iso and not re.match(r"^\d{4}-\d{2}-\d{2}$", data_iso):
            motivo = "data fora do formato YYYY-MM-DD"

        valor_num = float(valor) if valor is not None else None
        if valor_num is None or valor_num <= 0:
            if motivo is None:
                motivo = "valor zerado ou ausente"

        valido = data_iso is not None and valor_num is not None and valor_num > 0
        divergencia = False
        if (
            valido
            and soma_parcelas is not None
            and abs(soma_parcelas - valor_num) > 0.005
        ):
            divergencia = True

        linhas.append({
            "num": idx,
            "data_iso": data_iso,
            "data_bruto": data_bruto,
            "valor": round(valor_num, 2) if valor_num is not None else 0.0,
            "valor_semanal": round(float(valor_semanal), 2) if valor_semanal is not None else None,
            "descricao": str(descricao or "").strip(),
            "soma_parcelas": soma_parcelas,
            "divergencia": divergencia,
            "valido": valido,
            "motivo": motivo,
        })
    return linhas


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
# Relatório de análise
# ---------------------------------------------------------------------------

def formatar_moeda_br(valor):
    centavos = round(abs(float(valor)) * 100)
    inteiro = centavos // 100
    dec = centavos % 100
    milhar = f"{inteiro:,}".replace(",", ".")
    return f"{milhar},{dec:02d}"


def gerar_relatorio(planilha: Path, linhas, relatorio_path: Path):
    validas = [l for l in linhas if l["valido"]]
    invalidas = [l for l in linhas if not l["valido"]]
    divergentes = [l for l in linhas if l["valido"] and l["divergencia"]]
    # Escopo após a regra 05/09/2026: planilha até a semana 34/2026.
    escopo = [l for l in validas if l["data_iso"] < CORTE_2026]
    fora_escopo = [l for l in validas if l["data_iso"] >= CORTE_2026]

    soma_por_ano = Counter()
    for l in escopo:
        soma_por_ano[l["data_iso"][:4]] += l["valor"]
    total_geral = sum(soma_por_ano.values())
    total_planilha = sum(l["valor"] for l in validas)

    ano_min = min((l["data_iso"] for l in escopo), default="—")
    ano_max = max((l["data_iso"] for l in escopo), default="—")

    linhas_md = [
        "# Relatório de migração — recebidos da planilha (Entradas Consolidadas)",
        "",
        f"- Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M')}",
        f"- Planilha analisada: `{planilha}`",
        f"- Aba: `{ABA}`",
        "",
        "## 1. Resumo",
        "",
        f"- Linhas de dados lidas: **{len(linhas)}**",
        f"- Válidas para importação (data válida + valor > 0): **{len(validas)}**",
        f"- Fora do escopo (a partir de 24/08/2026 — o app é a fonte): **{len(fora_escopo)}**",
        f"- A importar: **{len(escopo)}**",
        f"- Com atenção manual (inválidas): **{len(invalidas)}**",
        f"- Com divergência VALOR TOTAL ≠ soma das parcelas: **{len(divergentes)}**",
        f"- Período coberto (escopo de importação): **{ano_min}** a **{ano_max}**",
        f"- **Soma do escopo: R$ {formatar_moeda_br(total_geral)}** "
        f"(na planilha inteira, até 04/09/2026: R$ {formatar_moeda_br(total_planilha)})",
        "",
        "> A migração cria PREVISÕES 'realizado' de Entrada no Planejamento",
        "> (origem `historico_planilha`) — **não toca contas/saldos**. O relatório",
        "> de Recebido & horas soma estes valores junto com as entradas já do app.",
        "> **Regra (05/09/2026):** a planilha preenche as lacunas dos ANOS",
        "> ANTERIORES e de 2026 ATÉ a semana 34 (primeiro lançamento digitado no",
        "> app — 24/08/2026). Registros da planilha com data >= 24/08/2026 não são",
        "> importados.",
        "",
        "## 2. Soma por ano (escopo de importação)",
        "",
        "| Ano | Linhas | Soma |",
        "| --- | --- | --- |",
    ]
    for ano in sorted(soma_por_ano, key=int):
        q = sum(1 for l in escopo if l["data_iso"][:4] == ano)
        linhas_md.append(f"| {ano} | {q} | R$ {formatar_moeda_br(soma_por_ano[ano])} |")
    linhas_md.append(f"| **Total** | **{len(escopo)}** | **R$ {formatar_moeda_br(total_geral)}** |")

    secao = 3
    if fora_escopo:
        soma_fora = sum(l["valor"] for l in fora_escopo)
        linhas_md += [
            "",
            f"## {secao}. Fora do escopo (a partir de 24/08/2026 — o app é a fonte)",
            "",
            "Estas linhas existem na planilha mas NÃO são importadas nem contam no",
            "relatório de Recebido & horas (a partir da semana 34/2026 a fonte é o",
            "",
            f"- Linhas: **{len(fora_escopo)}**",
            f"- Soma: **R$ {formatar_moeda_br(soma_fora)}**",
            f"- Período: **{min(l['data_iso'] for l in fora_escopo)}** a **{max(l['data_iso'] for l in fora_escopo)}**",
        ]
        secao += 1

    if invalidas:
        linhas_md += [
            "",
            f"## {secao}. Linhas com atenção manual (inválidas)",
            "",
            "| Linha | Data | Valor | Descrição | Motivo |",
            "| --- | --- | --- | --- | --- |",
        ]
        for l in invalidas:
            data = l["data_bruto"] if isinstance(l["data_bruto"], (date, datetime)) else repr(l["data_bruto"])
            linhas_md.append(
                f"| {l['num']} | {data} | {l['valor']} | {l['descricao'] or '—'} | {l['motivo']} |"
            )
        secao += 1

    if divergentes:
        linhas_md += [
            "",
            f"## {secao}. Divergências VALOR TOTAL ≠ soma das parcelas (B+C+D+E)",
            "",
            "São importadas pelo VALOR TOTAL (o que realmente entrou), apenas reportadas.",
            "",
            "| Linha | Data | VALOR TOTAL | Soma parcelas | Descrição |",
            "| --- | --- | --- | --- | --- |",
        ]
        for l in divergentes:
            linhas_md.append(
                f"| {l['num']} | {l['data_iso']} | R$ {formatar_moeda_br(l['valor'])} | "
                f"R$ {formatar_moeda_br(l['soma_parcelas'])} | {l['descricao']} |"
            )
        secao += 1

    linhas_md += [
        "",
        f"## {secao}. Observações",
        "",
        "- Linhas inválidas são detectadas na análise e **NÃO** são importadas.",
        "- A importação é **idempotente** por (data, valor, descricao): rerun não duplica.",
        "- A coluna **HorasExtras** da planilha NÃO vira dado do Planejamento: o relatório",
        "  de Recebido & horas mostra as horas dos fechamentos semanais do Ponto Inteligente.",
    ]

    texto = "\n".join(linhas_md) + "\n"
    relatorio_path.write_text(texto, encoding="utf-8")
    return relatorio_path


# ---------------------------------------------------------------------------
# Importação
# ---------------------------------------------------------------------------

def listar_existentes(url, apikey, token):
    """Linhas já no Supabase com a origem no conjunto da importação, no
    formato (data, valor, descricao) para idempotência."""
    status, resp = rest(
        f"{url}/rest/v1/planejamentos?select=data_prevista,valor,descricao"
        f"&tipo_op=eq.Entrada&estado=eq.realizado&origem=eq.historico_planilha"
        f"&limit=5000",
        apikey, token,
    )
    if status != 200:
        sys.exit(f"[erro] listando recebidos já importados ({status}): {resp}")
    return {
        (str(i["data_prevista"]), float(i["valor"]), str(i["descricao"] or ""))
        for i in (resp or [])
    }


def importar(planilha: Path, linhas, env, email, senha, sim):
    # Corte 05/09/2026: de 24/08/2026 em diante a fonte é o próprio app — a
    # planilha não importa e nem entra na lista de pendentes.
    validas = [l for l in linhas if l["valido"]]
    fora_escopo = [l for l in validas if l["data_iso"] >= CORTE_2026]
    importaveis = [l for l in validas if l["data_iso"] < CORTE_2026]
    if not importaveis:
        print("Nada a importar (tudo é 2026+ — fora do escopo da planilha).")
        return 0

    print("\n=== IMPORTAR RECEBIDOS DO HISTÓRICO ===")
    print(f"  linhas válidas: {len(validas)}")
    print(f"  fora do escopo (24/08+, app é a fonte): {len(fora_escopo)}")
    print(f"  a importar: {len(importaveis)}")
    url, apikey, token = login_supabase(env, email, senha)

    existentes = listar_existentes(url, apikey, token)
    pendentes = [
        l for l in importaveis
        if (l["data_iso"], l["valor"], l["descricao"]) not in existentes
    ]
    print(f"  já importadas: {len(importaveis) - len(pendentes)}")
    print(f"  a importar: {len(pendentes)}")

    if not pendentes:
        print("  nada novo a importar.")
        return 0

    if not sim:
        if input("\nConfirmar importação no Supabase? [s/N] ").strip().lower() != "s":
            print("Cancelado.")
            return 0

    total = 0
    for l in pendentes:
        iso = date.fromisoformat(l["data_iso"]).isocalendar()
        corpo = {
            "tipo_op": "Entrada",
            "descricao": l["descricao"] or f"Recebido {l['data_iso']}",
            "valor": l["valor"],
            "valor_semanal": l["valor_semanal"],
            "data_prevista": l["data_iso"],
            "ano_semana": iso.year,
            "semana": iso.week,
            "estado": "realizado",
            "origem": "historico_planilha",
        }
        status, resp = rest(f"{url}/rest/v1/planejamentos", apikey, token, "POST", corpo=corpo)
        if status not in (200, 201):
            print(f"    [erro] {l['data_iso']} {l['descricao']} ({status}): {resp}")
        else:
            total += 1
            if total <= 10 or total % 25 == 0:
                print(f"    ok   {l['data_iso']} {l['descricao'][:48]:<48} R$ {l['valor']:,.2f}")

    print(f"\nImportação concluída: {total} registros criados.")
    return total


def corrigir_estado_realizado(url, apikey, token):
    """Plano da planilha ficou 'previsto' (default do banco): o relatório só
    soma 'realizado'. Corrige em lote os registros origem=historico_planilha
    que ainda estão 'previsto', deixando 'realizado'. Idempotente."""
    print("\n=== CORRIGIR ESTADO DOS RECEBIDOS DA PLANILHA ===")

    status, resp = rest(
        f"{url}/rest/v1/planejamentos?select=id&origem=eq.historico_planilha&estado=neq.realizado",
        apikey, token,
    )
    if status != 200:
        print(f"  [erro] ao listar pendentes ({status}): {resp}")
        return 1
    pendentes = resp if isinstance(resp, list) else []
    print(f"  registros da planilha em estado != 'realizado': {len(pendentes)}")

    if not pendentes:
        print("  nada a corrigir.")
        return 0

    # PATCH em lote pelo filtro (mesmo conjunto acima), trazendo as linhas
    # atualizadas para conferência.
    status, resp = rest(
        f"{url}/rest/v1/planejamentos?origem=eq.historico_planilha&estado=neq.realizado",
        apikey, token, metodo="PATCH",
        corpo={"estado": "realizado"},
        extra_headers={"Prefer": "return=representation"},
    )
    if status not in (200, 201):
        print(f"  [erro] ao corrigir ({status}): {resp}")
        return 1
    corrigidos = resp if isinstance(resp, list) else []
    print(f"  corrigidos para 'realizado': {len(corrigidos)}")
    return 0


def limpar_2026(url, apikey, token):
    """Regra 05/09/2026: de 24/08/2026 em diante a fonte é o próprio app. Apaga
    os registros da planilha (origem=historico_planilha) com data_prevista >=
    2026-08-24 que tenham sido gravados antes da regra."""

    print("\n=== LIMPAR RECEBIDOS DA PLANILHA A PARTIR DE JAN/2026 ===")
    filtro = (
        f"{url}/rest/v1/planejamentos?select=id,data_prevista,valor&origem=eq.historico_planilha"
        f"&data_prevista=gte.{CORTE_2026}&limit=5000"
    )
    status, resp = rest(filtro, apikey, token)
    if status != 200:
        print(f"  [erro] ao listar ({status}): {resp}")
        return 1
    alvos = resp if isinstance(resp, list) else []
    print(f"  registros da planilha em 2026+: {len(alvos)}")
    if not alvos:
        print("  nada a limpar.")
        return 0

    total = sum(float(a.get("valor") or 0) for a in alvos)
    status, resp = rest(
        f"{url}/rest/v1/planejamentos?origem=eq.historico_planilha&data_prevista=gte.{CORTE_2026}",
        apikey, token, metodo="DELETE",
        corpo=None,
    )
    if status not in (200, 204):
        print(f"  [erro] ao apagar ({status}): {resp}")
        return 1
    print(f"  {len(alvos)} registros apagados (R$ {total:,.2f}).")
    return 0


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Migra o histórico de recebidos da planilha para o Planejamento.")
    parser.add_argument("--planilha", type=Path, default=DEFAULT_PLANILHA, help="planilha de origem")
    parser.add_argument("--relatorio", type=Path, default=DEFAULT_RELATORIO, help="saída do relatório md")
    parser.add_argument("--importar", action="store_true", help="grava no Supabase (análise + confirmação)")
    parser.add_argument("--fix-estado", action="store_true", help="corrige os da planilha que vieram 'previsto' para 'realizado'")
    parser.add_argument("--limpar-2026", action="store_true", help="apaga os da planilha com data >= 2026-08-24 (de lá a fonte é o app)")
    parser.add_argument("--sim", action="store_true", help="não confirma antes de gravar")
    parser.add_argument("--email", help="e-mail do usuário dono")
    parser.add_argument("--senha", help="senha do usuário dono")
    args = parser.parse_args()

    if not args.planilha.exists():
        sys.exit(f"Planilha não encontrada: {args.planilha}")

    print(f"=== ANÁLISE MIGRAÇÃO RECEBIDOS: {args.planilha.name} ===")
    linhas = ler_entradas_consolidadas(args.planilha)
    validas = [l for l in linhas if l["valido"]]
    invalidas = [l for l in linhas if not l["valido"]]
    divergentes = [l for l in linhas if l["valido"] and l["divergencia"]]

    print(f"  linhas de dados lidas: {len(linhas)}")
    print(f"  válidas para importação: {len(validas)}")
    print(f"  inválidas (atenção manual): {len(invalidas)}")
    print(f"  divergências no VALOR TOTAL: {len(divergentes)}")

    rel = gerar_relatorio(args.planilha, linhas, args.relatorio)
    print(f"\nRelatório gravado em {rel}")

    if not args.importar and not args.fix_estado and not args.limpar_2026:
        print("\nModo análise concluído. Rode com --importar para gravar no Supabase (revise o relatório antes).")
        return

    env = carregar_env()

    if args.fix_estado or args.limpar_2026:
        url, apikey, token = login_supabase(env, args.email, args.senha)
        if args.limpar_2026:
            limpar_2026(url, apikey, token)
        if args.fix_estado:
            corrigir_estado_realizado(url, apikey, token)
        if not args.importar:
            return

    if args.importar:
        importar(args.planilha, linhas, env, args.email, args.senha, args.sim)


def pausa_fim():
    try:
        if sys.stdin.isatty():
            input("\nPressione Enter para fechar...")
    except Exception:
        pass


if __name__ == "__main__":
    try:
        main()
        pausa_fim()
    except SystemExit:
        pausa_fim()
        raise
    except Exception:
        import traceback
        print("\n=== ERRO INESPERADO ===")
        traceback.print_exc()
        pausa_fim()
        sys.exit(1)