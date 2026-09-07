#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
migrar_historico_recebido.py — Importa o histórico de RECEBIDOS da planilha
CONTABILADE (aba "Entradas Consolidadas") para o Planejamento do app novo,
com QUEBRA POR CATEGORIA (decisão 06/09/2026 com o André).

Cada linha da planilha é LIDA POR COLUNA (e não mais pelo VALOR TOTAL lumped):
  • B (VALOR SEMANAL) e/ou C (HorasExtras) preenchidas → UM registro
      origem='historico_planilha' com:
        valor             = B + C            (mesmo total de antes — o
                                              "Recebido no período" não muda)
        valor_semanal     = B                (migration 30 — a base da semana)
        valor_extra_historico = C            (migration 31 — o excedente real;
                                              o relatório usa DIRETO, sem
                                              fórmula de subtração)
        descricao         = G                (a da planilha)
  • ACORDO TRABALHISTA (origem='historico_acordo'): a FONTE é o arquivo
      `depositos indenizaçao.xlsx` — os 136 depósitos 2021–2025 (R$ 140.187) que
      geraram o PDF; o André aprovou essa fonte em 06/09/2026 por decisão
      explícita. A coluna D da planilha NÃO é importada: serve SÓ de
      CONFERÊNCIA (deve ser subconjunto da fonte). Os registros ficam FORA do
      "Recebido & horas" e alimentam a aba "Acordo trabalhista" (lista com data
      e valor).
  • E (Outros) preenchida → UM registro à parte origem='historico_outros' com
      valor = E e descricao = G (ex.: "FGTS (saque aniversário)", "restituição
      do IRPF") — FORA do "Recebido & horas".

REMOÇÃO DA MIGRAÇÃO ANTERIOR (spirit de --limpar-2026): como já existem ~361
registros da migração antiga em produção — TODOS origem='historico_planilha' e
com valor lumped (B+C+D+E somados, sem distinguir categoria) — o dry-run exige
uma flag EXPLÍCITA (--limpar-historico) para APAGAR essas linhas antes de
reimportar com a quebra nova; sem ela, duplicaria. A flag pede confirmação e
só é executada JUNTO COM o --importar (primeiro mostra o dry-run).

Campos comuns de todo registro criado:
  • tipo_op='Entrada', estado='realizado' (dinheiro JÁ recebido);
  • data_prevista = DATA da linha;
  • ano_semana/semana = semana ISO da data (aplicação preenche);
  • NÃO preenche conta_destino/lancamento_id (não existe lançamento real);
  • user_id fica no DEFAULT auth.uid() (autentica como o DONO — respeita RLS).

REGRA DE CORTE (decisão 05/09/2026): a planilha preenche as lacunas dos ANOS
ANTERIORES e de 2026 até a SEMANA 34 (a primeira paga digitada no app —
24/08/2026, início da semana de trabalho 34). Registros com data >= 24/08/2026
NÃO são importados (nem contam no relatório).

PLANILHA (fonte):
  C:/Users/andre/Desktop/contas/contabilidade total/CONTABILADE_Consolidada_atualizada.xlsx
  Aba "Entradas Consolidadas". Colunas esperadas:
    A DATA | B VALOR SEMANAL | C HorasExtras | D Acordo | E Outros |
    F VALOR TOTAL | G DESCRIÇÃO | H SEMANAS | I Mês | J Ano

FLUXO (mesmo padrão das demais migrações — ver migrar_dados_antigos.py):

  1) ANÁLISE / DRY-RUN (modo padrão, só leitura local; NÃO toca no Supabase):
       .venv\Scripts\python.exe scripts\migrar_historico_recebido.py
Gera scripts\relatorio_migracao_recebido.md com: entrada por categoria,
      soma por ano, itens de atenção (valor zerado / data inválida / divergência
      VALOR TOTAL ≠ soma das parcelas) e — para o ACORDO — a CONFERÊNCIA da
      coluna D da planilha contra a FONTE `depositos indenizaçao.xlsx` (os mesmos
      136 depósitos do PDF): a planilha deve ser subconjunto da fonte. Qualquer
      linha da planilha com acordo que NÃO exista no xlsx é reportada como
      atenção (decisão 06/09/2026 — fonte aprovada pelo André).

  2) IMPORTAR (autentica como o USUÁRIO DONO — respeita RLS):
       .venv\Scripts\python.exe scripts\migrar_historico_recebido.py --importar
     Pede email/senha (ou registre SUPABASE_EMAIL/SUPABASE_SENHA no .env.local).
     IDEMPOTENTE por (data, valor, descricao, origem): linhas já importadas são
     puladas. Se a migração antiga ainda tiver as linhas lumped gravadas
     (origem historico_planilha), rode primeiro --limpar-historico.

  3) LIMPAR HISTÓRICO ANTIGO (apaga a migração lumped de 2022–2026):
       .venv\Scripts\python.exe scripts\migrar_historico_recebido.py --limpar-historico
     Apaga TODOS os registros origem='historico_planilha' existentes (pede
     confirmação explícita) para a reimportação com a quebra nova não duplicar.

SEM --corrigir-saldos: estas entradas são PREVISÕES do módulo Planejamento e
NUNCA tocam contas/saldos (regra de ouro da migration 08).

FLAGS:
  --planilha CAMINHO       planilha de origem (default: a do André)
  --relatorio CAMINHO      saída do relatório md
  --gabarito CAMINHO       xlsx com a FONTE dos depósitos do Acordo trabalhista
                           (default: depositos indenizaçao.xlsx — os 136
                           depósitos usados para gerar o PDF)
  --importar               grava no Supabase (análise + confirmação)
  --limpar-historico       apaga a migração antiga (lumped) antes de reimportar
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
DEFAULT_GABARITO = Path(
    r"C:\Users\andre\Desktop\contas\contabilidade total\depositos indenizaçao.xlsx"
)

# Regra 05/09/2026: a planilha preenche as lacunas dos anos anteriores e de
# 2026 até a semana 34 (primeiro lançamento digitado no app). Registros com
# data >= CORTE_2026 não são importados nem contam no relatório.
CORTE_2026 = "2026-08-24"
DEFAULT_RELATORIO = PROJETO / "scripts" / "relatorio_migracao_recebido.md"

ABA = "Entradas Consolidadas"


# ---------------------------------------------------------------------------
# Leitura da planilha (somente leitura local) — quebra por coluna
# ---------------------------------------------------------------------------

def ler_entradas_consolidadas(planilha: Path):
    """Lê a aba 'Entradas Consolidadas' e devolve a lista de cortes.

    Cada linha devolvida:
      { num, data_iso, data_bruto, categorias, valido, motivo }
    • categorias é uma LISTA de pedaços a importar, um por coluna preenchida:
        { origem, valor, valor_semanal?, valor_extra_historico?, descricao }
      B+C preenchidas → um pedaço 'historico_planilha' (valor B+C, base B,
      extra C). D preenchida → 'historico_acordo' (valor D). E preenchida →
      'historico_outros' (valor E, descricao G).
    • valido=True se a data é real E há pelo menos UM pedaço com valor > 0;
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
        b = r[1]            # B — VALOR SEMANAL (o fixo da semana)
        c = r[2]            # C — HorasExtras (excedente real da semana)
        d = r[3]            # D — Acordo
        e = r[4]            # E — Outros
        f = r[5]            # F — VALOR TOTAL (conferência)
        descricao = str(r[6] or "").strip()  # G — DESCRIÇÃO

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

        bv = float(b) if b is not None else None
        cv = float(c) if c is not None else None
        dv = float(d) if d is not None else None
        ev = float(e) if e is not None else None
        fv = float(f) if f is not None else None

        categorias = []
        if bv is not None or cv is not None:
            categorias.append({
                "origem": "historico_planilha",
                "valor": round((bv or 0) + (cv or 0), 2),
                "valor_semanal": round(bv, 2) if bv is not None else None,
                "valor_extra_historico": round(cv, 2) if cv is not None else None,
                "descricao": descricao,
            })
        if dv is not None:
            # Acordo: linha à parte, FORA do "Recebido & horas" (aba própria).
            categorias.append({
                "origem": "historico_acordo",
                "valor": round(dv, 2),
                "valor_semanal": None,
                "valor_extra_historico": None,
                "descricao": descricao or "Acordo trabalhista",
            })
        if ev is not None:
            categorias.append({
                "origem": "historico_outros",
                "valor": round(ev, 2),
                "valor_semanal": None,
                "valor_extra_historico": None,
                "descricao": descricao or "Recebimento avulso",
            })

        # Conferência: F deve ser a soma das parcelas da linha.
        soma_parcelas = None
        if any(x is not None for x in (b, c, d, e)):
            soma_parcelas = round(sum(float(x or 0) for x in (b, c, d, e)), 2)
        divergencia = False
        if soma_parcelas is not None and fv is not None and abs(soma_parcelas - fv) > 0.005:
            divergencia = True

        if not categorias:
            if motivo is None:
                motivo = "linha sem nenhuma categoria preenchida (B/C/D/E)"
        elif all(p["valor"] <= 0 for p in categorias):
            if motivo is None:
                motivo = "valor zerado ou ausente em todas as categorias"

        valido = data_iso is not None and len(categorias) > 0 and any(
            p["valor"] > 0 for p in categorias
        )

        linhas.append({
            "num": idx,
            "data_iso": data_iso,
            "data_bruto": data_bruto,
            "categorias": categorias,
            "descricao": descricao,
            "soma_parcelas": soma_parcelas,
            "valor_total_planilha": round(fv, 2) if fv is not None else None,
            "divergencia": divergencia,
            "valido": valido,
            "motivo": motivo,
        })
    return linhas


# ---------------------------------------------------------------------------
# FONTE dos depósitos do Acordo trabalhista
# ---------------------------------------------------------------------------

def ler_depositos_acordo(fonte: Path):
    """Lê o xlsx que é a FONTE dos depósitos do Acordo trabalhista (136
    depósitos 2021–2025; o André aprovou essa fonte em 06/09/2026).

    Aba "Plan1": uma linha por depósito, colunas [data, valor].
    Devolve: [{ data_iso, valor }], ordenado por data."""
    if not fonte.exists():
        return []
    import openpyxl
    wb = openpyxl.load_workbook(fonte, data_only=True, read_only=True)
    depositos = []
    for nome in wb.sheetnames:
        ws = wb[nome]
        for r in ws.iter_rows(values_only=True):
            v = r[0]
            if not isinstance(v, (datetime, date)):
                continue
            val = r[1]
            if val is None:
                continue
            iso = v.date().isoformat() if isinstance(v, datetime) else v.isoformat()
            depositos.append({"data_iso": iso, "valor": round(float(val), 2)})
        if depositos:
            break
    return sorted(depositos, key=lambda d: d["data_iso"])


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
# Montagem dos pedidos (fonte definitiva para importação)
# ---------------------------------------------------------------------------

def descricao_acordo_planilha(linhas):
    """Mapa (data_iso, valor) → descrição da linha da planilha (coluna D).

    Usado para trazer a descrição humana original quando o acordo é importado
    da FONTE xlsx; se a combinação (data, valor) casar com a planilha, usa a
    descrição dela. Caso contrário, usa o rótulo genérico."""
    mapa = {}
    for l in linhas:
        for p in l["categorias"]:
            if p["origem"] == "historico_acordo":
                mapa[(l["data_iso"], p["valor"])] = (
                    p["descricao"] or "Acordo trabalhista"
                )
    return mapa


def montar_pedidos(linhas, depositos_acordo):
    """Monta a lista final de registros a importar.

    • historico_planilha / historico_outros  → vêm da planilha (colunas B+C / E);
    • historico_acordo                      → vêm da FONTE xlsx (136 depósitos,
      decisão 06/09/2026). A descrição é casada com a planilha quando o par
      (data, valor) existir; senão, "Acordo trabalhista".

    Registros com data >= CORTE_2026 já são filtrados aqui."""
    desc_map = descricao_acordo_planilha(linhas)
    pedidos = []
    for l in linhas:
        if not l["valido"] or l["data_iso"] >= CORTE_2026:
            continue
        for p in l["categorias"]:
            if p["origem"] == "historico_acordo":
                continue  # acordo vem do xlsx (abaixo)
            pedidos.append({**p, "data_iso": l["data_iso"]})

    for d in depositos_acordo:
        if d["data_iso"] >= CORTE_2026:
            continue
        descricao = desc_map.get((d["data_iso"], d["valor"]), "Acordo trabalhista")
        pedidos.append({
            "origem": "historico_acordo",
            "valor": d["valor"],
            "valor_semanal": None,
            "valor_extra_historico": None,
            "descricao": descricao,
            "data_iso": d["data_iso"],
        })
    return pedidos


# ---------------------------------------------------------------------------
# Relatório de análise
# ---------------------------------------------------------------------------

def formatar_moeda_br(valor):
    centavos = round(abs(float(valor)) * 100)
    inteiro = centavos // 100
    dec = centavos % 100
    milhar = f"{inteiro:,}".replace(",", ".")
    return f"{milhar},{dec:02d}"


def gerar_relatorio(planilha: Path, gabarito: Path, linhas, relatorio_path: Path):
    validas = [l for l in linhas if l["valido"]]
    invalidas = [l for l in linhas if not l["valido"]]
    divergentes = [l for l in linhas if l["valido"] and l["divergencia"]]

    # Escopo após a regra 05/09/2026 (corte) e quebra por origem.
    def escopo(l):
        return [p for p in l["categorias"] if l["data_iso"] < CORTE_2026]

    importaveis = [l for l in validas if l["data_iso"] < CORTE_2026]
    fora_escopo = [l for l in validas if l["data_iso"] >= CORTE_2026]

    # Fonte definitiva do Acordo: o xlsx (decisão 06/09/2026). Os demais
    # pedidos continuam vindos da planilha.
    depositos_acordo = ler_depositos_acordo(gabarito)
    pedidos = montar_pedidos(linhas, depositos_acordo)
    contagem, soma = Counter(), Counter()
    for p in pedidos:
        contagem[p["origem"]] += 1
        soma[p["origem"]] += p["valor"]

    # Quebra por ano e por origem (só escopo — já filtrado em montar_pedidos).
    por_ano_origem = Counter()
    for p in pedidos:
        por_ano_origem[(p["data_iso"][:4], p["origem"])] += p["valor"]

    total_geral = sum(p["valor"] for p in pedidos)
    total_por_origem_all = {origem: soma[origem] for origem in [
        "historico_planilha", "historico_acordo", "historico_outros"
    ] if origem in soma}

    ano_min = min((p["data_iso"] for p in pedidos), default="—")
    ano_max = max((p["data_iso"] for p in pedidos), default="—")

    # Conferência do ACORDO: coluna D da planilha DEVE ser subconjunto da fonte
    # xlsx (a fonte é a verdade — decisão 06/09/2026). Registo tanto os
    # depósitos da fonte AUSENTES na planilha (cobrem o que faltava: 2021 e
    # 25/08/2023) quanto os que só existem na planilha (atenção — fonte não
    # confirmada), que NÃO são importados.
    referencia_acordo = None
    acordo_fonte = [
        p for p in pedidos if p["origem"] == "historico_acordo"
    ]
    if depositos_acordo:
        # Da planilha (coluna D) — só conferência.
        plan_set = {(l["data_iso"], p["valor"]) for l in importaveis
                    for p in l["categorias"] if p["origem"] == "historico_acordo"}
        fonte_set = {(d["data_iso"], d["valor"]) for d in depositos_acordo}

        faltam_na_planilha = sorted(
            [d for d in depositos_acordo if (d["data_iso"], d["valor"]) not in plan_set],
            key=lambda d: d["data_iso"],
        )
        # Linhas da planilha cujo (data, valor) NÃO consta na fonte xlsx.
        so_na_planilha = [
            (l["data_iso"], p["valor"])
            for l in importaveis
            for p in l["categorias"]
            if p["origem"] == "historico_acordo"
            and (l["data_iso"], p["valor"]) not in fonte_set
        ]

        soma_fonte_ano, qtd_fonte_ano = Counter(), Counter()
        for d in depositos_acordo:
            qtd_fonte_ano[d["data_iso"][:4]] += 1
            soma_fonte_ano[d["data_iso"][:4]] += d["valor"]
        soma_plan_ano, qtd_plan_ano = Counter(), Counter()
        for l in importaveis:
            for p in l["categorias"]:
                if p["origem"] == "historico_acordo":
                    qtd_plan_ano[l["data_iso"][:4]] += 1
                    soma_plan_ano[l["data_iso"][:4]] += p["valor"]

        referencia_acordo = {
            "qtd_fonte": len(depositos_acordo),
            "soma_fonte": round(sum(d["valor"] for d in depositos_acordo), 2),
            "qtd_plan": len(plan_set),
            "soma_plan": round(sum(v for _, v in plan_set), 2),
            "qtd_por_ano_fonte": dict(qtd_fonte_ano),
            "qtd_por_ano_plan": dict(qtd_plan_ano),
            "soma_por_ano_fonte": {a: round(soma_fonte_ano[a], 2) for a in soma_fonte_ano},
            "soma_por_ano_plan": {a: round(soma_plan_ano[a], 2) for a in soma_plan_ano},
            "faltam_na_planilha": faltam_na_planilha,
            "so_na_planilha": so_na_planilha,
        }

    linhas_md = [
        "# Relatório de migração — recebidos da planilha (Entradas Consolidadas)",
        "",
        f"- Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M')}",
        f"- Planilha analisada: `{planilha}`",
        f"- Aba: `{ABA}`",
        "",
        "> **QUEBRA POR CATEGORIA (06/09/2026):** cada coluna da planilha vira",
        "> um registro com a PRÓPRIA origem — B+C → `historico_planilha` (com",
        "> `valor_extra_historico` = coluna C), D → conferência do Acordo, E →",
        "> `historico_outros`. O Acordo e os Outros ficam FORA do \"Recebido &",
        "> horas\". **A FONTE do Acordo é o xlsx `depositos indenizaçao.xlsx`",
        "> (136 depósitos, aprovado pelo André em 06/09/2026); a coluna D da",
        "> planilha só confere.**",
        "",
        "## 1. Resumo",
        "",
        f"- Linhas de dados lidas: **{len(linhas)}**",
        f"- Válidas para importação (data válida + valor > 0): **{len(validas)}**",
        f"- Fora do escopo (a partir de 24/08/2026 — o app é a fonte): **{len(fora_escopo)}**",
        f"- A importar (linhas): **{len(importaveis)}**",
        f"- Registros a criar (quebra por coluna): **{sum(contagem.values())}**",
        f"- Com atenção manual (inválidas): **{len(invalidas)}**",
        f"- Com divergência VALOR TOTAL ≠ soma das parcelas: **{len(divergentes)}**",
        f"- Período coberto (escopo de importação): **{ano_min}** a **{ano_max}**",
        f"- **Soma do escopo: R$ {formatar_moeda_br(total_geral)}**",
        "",
        "### 1.1 Registros a criar por origem",
        "",
        "| Origem | Registros | Soma |",
        "| --- | --- | --- |",
    ]
    for origem in ["historico_planilha", "historico_acordo", "historico_outros"]:
        if origem in contagem:
            linhas_md.append(
                f"| `{origem}` | {contagem[origem]} | R$ {formatar_moeda_br(soma[origem])} |"
            )
    linhas_md.append(f"| **Total** | **{sum(contagem.values())}** | **R$ {formatar_moeda_br(total_geral)}** |")

    linhas_md += [
        "",
        "## 2. Soma por ano e origem (escopo de importação)",
        "",
        "| Ano | Planilha (B+C) | Acordo (fonte xlsx) | Outros (E) |",
        "| --- | --- | --- | --- |",
    ]
    anos = sorted({ano for (ano, _) in por_ano_origem})
    for ano in anos:
        ap = por_ano_origem.get((ano, "historico_planilha"), 0)
        ac = por_ano_origem.get((ano, "historico_acordo"), 0)
        ou = por_ano_origem.get((ano, "historico_outros"), 0)
        linhas_md.append(
            f"| {ano} | R$ {formatar_moeda_br(ap)} | R$ {formatar_moeda_br(ac)} | R$ {formatar_moeda_br(ou)} |"
        )
    linhas_md.append(
        f"| **Total** | **R$ {formatar_moeda_br(soma['historico_planilha'])}** | "
        f"**R$ {formatar_moeda_br(soma['historico_acordo'])}** | "
        f"**R$ {formatar_moeda_br(soma['historico_outros'])}** |"
    )

    linhas_md += [
        "",
        "## 3. Acordo trabalhista — conferência da planilha contra a FONTE",
        "",
        "Fonte dos depósitos: **`depositos indenizaçao.xlsx`** (o mesmo usado",
        "para gerar o PDF). A importação do Acordo USA ESSA FONTE (decisão",
        "06/09/2026). A coluna D da planilha serve apenas para conferir; os",
        "valores que a planilha NÃO lista (2021 e 25/08/2023) entram mesmo",
        "assim, direto da fonte.",
        "",
    ]
    if referencia_acordo:
        r = referencia_acordo
        linhas_md += [
            f"- Fonte (xlsx): **{r['qtd_fonte']} depósitos**, "
            f"**R$ {formatar_moeda_br(r['soma_fonte'])}**",
            f"- Planilha (coluna D): **{r['qtd_plan']} depósitos**, "
            f"**R$ {formatar_moeda_br(r['soma_plan'])}**",
            "",
            "| Ano | Fonte (qtd / soma) | Planilha (qtd / soma) |",
            "| --- | --- | --- |",
        ]
        for ano in sorted(set(r["qtd_por_ano_fonte"]) | set(r["qtd_por_ano_plan"])):
            linhas_md.append(
                f"| {ano} | {r['qtd_por_ano_fonte'].get(ano, 0)} / "
                f"R$ {formatar_moeda_br(r['soma_por_ano_fonte'].get(ano, 0))} | "
                f"{r['qtd_por_ano_plan'].get(ano, 0)} / "
                f"R$ {formatar_moeda_br(r['soma_por_ano_plan'].get(ano, 0))} |"
            )

        falt = r["faltam_na_planilha"]
        so_plan = r["so_na_planilha"]
        if falt:
            linhas_md += [
                "",
                f"Depósitos da FONTE que a planilha NÃO lista ({len(falt)}) — são os",
                "que faltavam na migração do André (2021 e o depósito de",
                "25/08/2023). Entram na importação direto da fonte:",
                "",
                "| Data | Valor |",
                "| --- | --- |",
            ]
            for d in falt:
                linhas_md.append(f"| {d['data_iso']} | R$ {formatar_moeda_br(d['valor'])} |")
        if so_plan:
            linhas_md += [
                "",
                f"**ATENÇÃO — depósitos na planilha que NÃO existem na fonte "
                f"({len(so_plan)}):** NÃO serão importados (a fonte é a verdade).",
                "",
                "| Data | Valor |",
                "| --- | --- |",
            ]
            for p in so_plan:
                linhas_md.append(f"| {p[0]} | R$ {formatar_moeda_br(p[1])} |")
        if not falt and not so_plan:
            linhas_md += [
                "",
                "Conferência perfeita: a coluna D da planilha casa exatamente com",
                "a fonte.",
            ]
    else:
        linhas_md += [
            f"- Fonte não encontrada: `{gabarito}` (Acordo será importado da",
            "coluna D da planilha).",
        ]

    secao = 4
    if fora_escopo:
        soma_fora = sum(l["valor_total_planilha"] or 0 for l in fora_escopo)
        linhas_md += [
            "",
            f"## {secao}. Fora do escopo (a partir de 24/08/2026 — o app é a fonte)",
            "",
            "Estas linhas existem na planilha mas NÃO são importadas nem contam no",
            "relatório de Recebido & horas (a partir da semana 34/2026 a fonte é o",
            "próprio app).",
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
            "| Linha | Data | Descrição | Motivo |",
            "| --- | --- | --- | --- |",
        ]
        for l in invalidas:
            data = l["data_bruto"] if isinstance(l["data_bruto"], (date, datetime)) else repr(l["data_bruto"])
            linhas_md.append(f"| {l['num']} | {data} | {l['descricao'] or '—'} | {l['motivo']} |")
        secao += 1

    if divergentes:
        linhas_md += [
            "",
            f"## {secao}. Divergências VALOR TOTAL ≠ soma das parcelas (B+C+D+E)",
            "",
            "São importadas pela soma das parcelas (o que realmente entrou), apenas reportadas.",
            "",
            "| Linha | Data | VALOR TOTAL | Soma parcelas | Descrição |",
            "| --- | --- | --- | --- | --- |",
        ]
        for l in divergentes:
            linhas_md.append(
                f"| {l['num']} | {l['data_iso']} | R$ {formatar_moeda_br(l['valor_total_planilha'] or 0)} | "
                f"R$ {formatar_moeda_br(l['soma_parcelas'] or 0)} | {l['descricao']} |"
            )
        secao += 1

    linhas_md += [
        "",
        f"## {secao}. Observações",
        "",
        "- Linhas inválidas são detectadas na análise e **NÃO** são importadas.",
        "- A importação é **idempotente** por (data, valor, descricao, origem): rerun não duplica.",
        "- Para reimportar a quebra nova, primeiro apague a migração antiga (lumped):",
        "  `--limpar-historico` (pede confirmação explícita).",
        "- `valor_extra_historico` (coluna C) é gravado nas linhas `historico_planilha`;",
        "  o relatório de Recebido & horas usa ESSE valor direto, sem fórmula de subtração.",
        "- Acordo (`historico_acordo`) e Outros (`historico_outros`) ficam FORA do",
        "  \"Recebido & horas\"; o Acordo tem aba própria no relatório.",
    ]

    texto = "\n".join(linhas_md) + "\n"
    relatorio_path.write_text(texto, encoding="utf-8")
    return relatorio_path


# ---------------------------------------------------------------------------
# Importação
# ---------------------------------------------------------------------------

def listar_existentes(url, apikey, token):
    """Linhas já no Supabase com as origens da importação, por
    (data, valor, descricao, origem) para idempotência."""
    status, resp = rest(
        f"{url}/rest/v1/planejamentos?select=data_prevista,valor,descricao,origem"
        f"&tipo_op=eq.Entrada&estado=eq.realizado"
        f"&origem=in.(historico_planilha,historico_acordo,historico_outros)"
        f"&limit=5000",
        apikey, token,
    )
    if status != 200:
        sys.exit(f"[erro] listando recebidos já importados ({status}): {resp}")
    return {
        (str(i["data_prevista"]), float(i["valor"]), str(i["descricao"] or ""), str(i["origem"]))
        for i in (resp or [])
    }


def importar(planilha: Path, gabarito: Path, linhas, env, email, senha, sim, limpar_primeiro):
    validas = [l for l in linhas if l["valido"]]
    fora_escopo = [l for l in validas if l["data_iso"] >= CORTE_2026]
    importaveis = [l for l in validas if l["data_iso"] < CORTE_2026]
    if not importaveis:
        print("Nada a importar (tudo é 2026+ — fora do escopo da planilha).")
        return 0
    # Quebra por coluna → registros a criar (Acordo vem da FONTE xlsx).
    depositos_acordo = ler_depositos_acordo(gabarito)
    pedidos = montar_pedidos(linhas, depositos_acordo)
    total_registros = len(pedidos)

    print("\n=== IMPORTAR RECEBIDOS DO HISTÓRICO (com quebra por categoria) ===")
    print(f"  linhas válidas: {len(validas)}")
    print(f"  fora do escopo (24/08+, app é a fonte): {len(fora_escopo)}")
    print(f"  a importar (linhas): {len(importaveis)}")
    print(f"  registros a criar (quebra): {total_registros}")

    url, apikey, token = login_supabase(env, email, senha)

    # Limpeza da migração antiga (lumped) — flag explícita, pede confirmação.
    if limpar_primeiro:
        limpar_historico(url, apikey, token, confirma=not sim)

    existentes = listar_existentes(url, apikey, token)
    pendentes = []
    for p in pedidos:
        chave = (p["data_iso"], p["valor"], p["descricao"], p["origem"])
        if chave not in existentes:
            pendentes.append(p)
    print(f"  já importadas: {total_registros - len(pendentes)}")
    print(f"  a importar: {len(pendentes)}")

    if not pendentes:
        print("  nada novo a importar.")
        return 0

    if not sim:
        if input("\nConfirmar importação no Supabase? [s/N] ").strip().lower() != "s":
            print("Cancelado.")
            return 0

    total = 0
    por_origem = Counter()
    for p in pendentes:
        iso = date.fromisoformat(p["data_iso"]).isocalendar()
        corpo = {
            "tipo_op": "Entrada",
            "descricao": p["descricao"] or f"Recebido {p['data_iso']}",
            "valor": p["valor"],
            "valor_semanal": p.get("valor_semanal"),
            "valor_extra_historico": p.get("valor_extra_historico"),
            "data_prevista": p["data_iso"],
            "ano_semana": iso.year,
            "semana": iso.week,
            "estado": "realizado",
            "origem": p["origem"],
        }
        status, resp = rest(f"{url}/rest/v1/planejamentos", apikey, token, "POST", corpo=corpo)
        if status not in (200, 201):
            print(f"    [erro] {p['origem']} {p['data_iso']} {p['descricao']} ({status}): {resp}")
        else:
            total += 1
            por_origem[p["origem"]] += 1
            if total <= 10 or total % 50 == 0:
                print(f"    ok   {p['data_iso']} {p['origem'][:19]:<19} R$ {p['valor']:,.2f}")

    print(f"\nImportação concluída: {total} registros criados ({dict(por_origem)}).")
    return total


def limpar_historico(url, apikey, token, confirma=True):
    """Apaga TODOS os registros de histórico da planilha já em produção
    (origens historico_planilha/acordo/outros) — a migração antiga lumped.
    Pedido explícito do André (06/09/2026): sem a flag --limpar-historico o
    script NUNCA apaga; com ela, ainda pede confirmação (--sim pula)."""

    print("\n=== LIMPAR HISTÓRICO DA PLANILHA (reimportação com quebra) ===")
    filtro = (
        f"{url}/rest/v1/planejamentos?select=id,data_prevista,valor,origem"
        f"&tipo_op=eq.Entrada&estado=eq.realizado"
        f"&origem=in.(historico_planilha,historico_acordo,historico_outros)"
        f"&limit=5000"
    )
    status, resp = rest(filtro, apikey, token)
    if status != 200:
        print(f"  [erro] ao listar ({status}): {resp}")
        return 1
    alvos = resp if isinstance(resp, list) else []
    print(f"  registros de histórico da planilha: {len(alvos)}")
    if not alvos:
        print("  nada a limpar.")
        return 0

    total = sum(float(a.get("valor") or 0) for a in alvos)
    if confirma:
        n = input(f"\nApagar {len(alvos)} registros (R$ {total:,.2f})? digite 'sim': ").strip().lower()
        if n != "sim":
            print("Cancelado.")
            return 0
    status, resp = rest(
        f"{url}/rest/v1/planejamentos?tipo_op=eq.Entrada&estado=eq.realizado"
        f"&origem=in.(historico_planilha,historico_acordo,historico_outros)",
        apikey, token, metodo="DELETE",
        corpo=None,
    )
    if status not in (200, 204):
        print(f"  [erro] ao apagar ({status}): {resp}")
        return 1
    print(f"  {len(alvos)} registros apagados (R$ {total:,.2f}).")
    return 0


def corrigir_estado_realizado(url, apikey, token):
    """Registros do histórico da planilha que ficaram 'previsto' → 'realizado'
    (mantido da migração anterior, aplicável também ao acordo/outros)."""
    print("\n=== CORRIGIR ESTADO DOS RECEBIDOS DA PLANILHA ===")

    status, resp = rest(
        f"{url}/rest/v1/planejamentos?select=id"
        f"&origem=in.(historico_planilha,historico_acordo,historico_outros)"
        f"&estado=neq.realizado",
        apikey, token,
    )
    if status != 200:
        print(f"  [erro] ao listar pendentes ({status}): {resp}")
        return 1
    pendentes = resp if isinstance(resp, list) else []
    print(f"  registros do histórico em estado != 'realizado': {len(pendentes)}")

    if not pendentes:
        print("  nada a corrigir.")
        return 0

    status, resp = rest(
        f"{url}/rest/v1/planejamentos?origem=in.(historico_planilha,historico_acordo,historico_outros)"
        f"&estado=neq.realizado",
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


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Migra o histórico de recebidos da planilha para o Planejamento (com quebra por categoria).")
    parser.add_argument("--planilha", type=Path, default=DEFAULT_PLANILHA, help="planilha de origem")
    parser.add_argument("--relatorio", type=Path, default=DEFAULT_RELATORIO, help="saída do relatório md")
    parser.add_argument("--gabarito", type=Path, default=DEFAULT_GABARITO, help="xlsx com o gabarito do Acordo trabalhista")
    parser.add_argument("--importar", action="store_true", help="grava no Supabase (análise + confirmação)")
    parser.add_argument("--limpar-historico", action="store_true", help="apaga a migração antiga (lumped) antes de reimportar")
    parser.add_argument("--fix-estado", action="store_true", help="corrige os do histórico que vieram 'previsto' para 'realizado'")
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

    # Pedidos montados com a fonte definitiva do Acordo (xlsx).
    depositos_acordo = ler_depositos_acordo(args.gabarito)
    pedidos = montar_pedidos(linhas, depositos_acordo)
    contagem, soma = Counter(), Counter()
    for p in pedidos:
        contagem[p["origem"]] += 1
        soma[p["origem"]] += p["valor"]

    print(f"  linhas de dados lidas: {len(linhas)}")
    print(f"  válidas para importação: {len(validas)}")
    print(f"  inválidas (atenção manual): {len(invalidas)}")
    print(f"  divergências no VALOR TOTAL: {len(divergentes)}")
    for origem in ["historico_planilha", "historico_acordo", "historico_outros"]:
        print(f"    {origem:19} → {contagem.get(origem, 0):3d} registros, R$ {soma.get(origem, 0):,.2f}")

    rel = gerar_relatorio(args.planilha, args.gabarito, linhas, args.relatorio)
    print(f"\nRelatório gravado em {rel}")

    if args.gabarito.exists():
        print(f"\n=== ACORDO — FONTE: {args.gabarito.name} ===")
        if depositos_acordo:
            soma_plan_acordo = sum(
                p["valor"] for l in validas if l["data_iso"] < CORTE_2026
                for p in l["categorias"] if p["origem"] == "historico_acordo"
            )
            print(f"  fonte (xlsx): {len(depositos_acordo)} depósitos, R$ {sum(d['valor'] for d in depositos_acordo):,.2f}")
            print(f"  planilha (coluna D, só conferência): {sum(1 for l in validas if any(p['origem'] == 'historico_acordo' for p in l['categorias']))} depósitos, R$ {soma_plan_acordo:,.2f}")

    if not args.importar and not args.fix_estado and not args.limpar_historico:
        print("\nModo análise concluído. Rode com --importar para gravar no Supabase (revise o relatório antes).")
        return

    env = carregar_env()

    if args.limpar_historico and not args.importar:
        url, apikey, token = login_supabase(env, args.email, args.senha)
        limpar_historico(url, apikey, token, confirma=not args.sim)
        return

    if args.fix_estado:
        url, apikey, token = login_supabase(env, args.email, args.senha)
        corrigir_estado_realizado(url, apikey, token)
        if not args.importar:
            return

    if args.importar:
        importar(args.planilha, args.gabarito, linhas, env, args.email, args.senha, args.sim, args.limpar_historico)


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