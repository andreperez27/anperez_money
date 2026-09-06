#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
migrar_historico_ponto_2025.py — Importa as HORAS de set/25 a dez/25 da
planilha CONTABILADE 2025 (aba "Calculo Semanal") para o Ponto Inteligente,
preenchendo parte da lacuna de horas do relatorio "Recebido & horas".

CONTEXTO DA LACUNA
  A planilha consolidada (Entradas Consolidadas) tem os VALORES de recebidos
  de 2022 a 2026, importados por migrar_historico_recebido.py. Mas as horas
  EXTRAS do relatorio leem os fechamentos semanais do Ponto Inteligente
  (src/lib/pontoCalc.js), que hoje so tem lancamentos de 2026 (migration 24).
  Para 2025 nao ha lancamento => o relatorio mostraria R$ recebido com ZERO
  horas. Esta planilha tem o registro DIARIO de entrada/saida + horas extras
  de 01/09/2025 a 21/12/2025 => cobre parte da lacuna (jan-ago/2025 fica sem
  fonte ate existir outra planilha).

  A coluna HorasExtras da MESMA 2025 (aba "Horas Extras") cobre o ano inteiro
  mas com valores SEMANAIS em R$ — nao tem a batida diaria. Entao a fonte
  diaria (Calculo Semanal) e a usada; a semanal serve de conferencia (R$/mes).

FONTE
  C:/Users/andre/Desktop/contas/CONTABILADE 2025.xlsx.xlsm — aba "Calculo Semanal"
  Linhas 15..125, colunas:
    E DATA | F Dia | G Entrada | H Saida | I HorasTrab | J Horas Extras |
    K Valor Extra | L verificar domingo

MAPEAMENTO (mesmo modelo por EXCECOES da migration 24 / pontoCalc.js)
  O modelo novo e "dia sem linha em ponto_excecoes = carga padrao cumprida"
  (seg-sex 20:30->03:00 = 6,5h; sab 20:30->02:00 = 5,5h; dom sem carga). Assim:
    * Horas ~= HorasExtras (base 0: domingo OU feriado trabalhado)
        => tipo 'domfer': he=0, domfer_qtd=1, valor_domfer = Valor Extra,
           horas = HorasTrab (o relatorio conta horasDomfer, NAO he).
    * HorasExtras > 0 em dia util => tipo 'he': he = HorasExtras,
           valor_he = Valor Extra, horas = HorasTrab.
    * HorasExtras ~= 0 e carga = base:
        => se turno PADRAO EXATO => descarta (nada a lancar);
        => se turno atipico => 'he' com he=0 (COMPENSACAO: entrada/saida
           registradas por controle, obs documenta) — regra 3b do pontoCalc.
    * valor_fixo = 1400,00 (base semanal REAL de 2025 congelada — o hook
      congela a config; o reajuste de 1650 so valeu para 2026).
  Feriados 2025 no periodo (11/15 Proclamacao e 11/20 Consciencia Negra)
  aparecem na propria planilha como base 0 — nao precisam de lista extra.

FLUXO (mesmo padrao das demais migracoes)
  1) ANALISE (padrao; so le a planilha, NAO toca no Supabase):
       .venv\\Scripts\\python.exe scripts\\migrar_historico_ponto_2025.py
     Gera scripts\\relatorio_importacao_ponto_2025.md.
  2) IMPORTAR (autentica como o DONO — RLS; user_id = auth.uid() default):
       .venv\\Scripts\\python.exe scripts\\migrar_historico_ponto_2025.py --importar
     IDEMPOTENTE pela chave unica (user_id, data): rerun nao duplica.

FLAGS
  --planilha CAMINHO      xlsm de origem
  --relatorio CAMINHO     saida do relatorio md
  --importar              grava no Supabase (analise + confirmacao)
  --sim                   nao confirma antes de gravar
  --email / --senha       credenciais (ou SUPABASE_EMAIL/SUPABASE_SENHA)
"""

from __future__ import annotations

import argparse
import datetime as _dt
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PROJETO = Path(__file__).resolve().parents[1]
ENV_LOCAL = PROJETO / ".env.local"
DEFAULT_PLANILHA = Path(r"C:\Users\andre\Desktop\contas\CONTABILADE 2025.xlsx.xlsm")
DEFAULT_RELATORIO = PROJETO / "scripts" / "relatorio_importacao_ponto_2025.md"

ABA = "Cálculo Semanal"

# 0 = segunda ... 6 = domingo (mesma convencao do pontoCalc.js).
BASE_HORAS = {0: 6.5, 1: 6.5, 2: 6.5, 3: 6.5, 4: 6.5, 5: 5.5, 6: 0.0}
PADRAO_TURNO = {
    0: ("20:30", "03:00"),
    1: ("20:30", "03:00"),
    2: ("20:30", "03:00"),
    3: ("20:30", "03:00"),
    4: ("20:30", "03:00"),
    5: ("20:30", "02:00"),
    6: None,
}
DIA_NOME = {0: "seg", 1: "ter", 2: "qua", 3: "qui", 4: "sex", 5: "sab", 6: "dom"}
VALOR_FIXO_2025 = 1400.00
EPS = 0.01


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def dia_semana_iso(d):
    """0 = segunda ... 6 = domingo (mesma convencao do pontoCalc.js)."""
    return d.weekday()


def norm_hora(v):
    if v is None:
        return None
    if isinstance(v, _dt.time):
        return v.strftime("%H:%M")
    s = str(v).strip()
    if ":" in s:
        hh, mm = s.split(":")[:2]
        try:
            return "%02d:%02d" % (int(hh), int(mm))
        except ValueError:
            return None
    return None


def round2(x):
    if x is None:
        return 0.0
    return round(float(x), 2)


def formatar_moeda_br(valor):
    centavos = round(abs(float(valor)) * 100)
    inteiro = centavos // 100
    dec = centavos % 100
    return f"{inteiro:,}".replace(",", ".") + f",{dec:02d}"


FRASE_ORIGEM = "Importado da planilha CONTABILADE 2025 (aba Cálculo Semanal) em 04/09/2026."


# ---------------------------------------------------------------------------
# Leitura do Calculo Semanal
# ---------------------------------------------------------------------------
def ler_calculo_semanal(planilha: Path):
    """Le a aba 'Calculo Semanal' e devolve as linhas diarias com trabalho.

    Linha devolvida:
      { num, data_iso, dia, entrada, saida, horas, extras, valor, verif }
    """
    import openpyxl

    wb = openpyxl.load_workbook(planilha, data_only=True)
    if ABA not in wb.sheetnames:
        sys.exit(f"Planilha sem a aba '{ABA}': {wb.sheetnames}")
    ws = wb[ABA]

    header_idx = None
    for idx, r in enumerate(ws.iter_rows(values_only=True), start=1):
        if r and len(r) > 4 and isinstance(r[4], str) and str(r[4]).strip().upper() == "DATA":
            header_idx = idx
            break
    if header_idx is None:
        sys.exit(f"Nao achei o cabecalho da tabela diaria em '{ABA}'.")

    linhas = []
    for idx, r in enumerate(ws.iter_rows(values_only=True), start=1):
        if idx <= header_idx or not r or len(r) < 11:
            continue
        data_cell = r[4]
        if isinstance(data_cell, (int, float)):
            # Celula de data como serial (nao era esperado aqui).
            try:
                base = _dt.date(1899, 12, 30)
                data_iso = (base + _dt.timedelta(days=int(data_cell))).isoformat()
            except Exception:
                continue
        elif isinstance(data_cell, _dt.datetime):
            data_iso = data_cell.date().isoformat()
        elif isinstance(data_cell, _dt.date):
            data_iso = data_cell.isoformat()
        else:
            texto = str(data_cell or "").strip()
            if not texto.startswith("2025-"):
                continue
            data_iso = texto[:10]
        try:
            d = _dt.date.fromisoformat(data_iso)
        except ValueError:
            continue
        entrada = norm_hora(r[6])
        saida = norm_hora(r[7])
        if entrada is None or saida is None:
            continue
        horas = round2(r[8])
        if horas <= 0:
            continue
        linhas.append({
            "num": idx,
            "data_iso": data_iso,
            "dia": dia_semana_iso(d),
            "entrada": entrada,
            "saida": saida,
            "horas": horas,
            "extras": round2(r[9]),
            "valor": round2(r[10]),
            "verif": 1 if round2(r[11]) else 0,
        })
    return linhas


# ---------------------------------------------------------------------------
# Classificacao -> payload de ponto_excecoes
# ---------------------------------------------------------------------------
def classificar_linha(linha):
    """Devolve o payload pronta para insert em ponto_excecoes, ou None
    (dia padrao exato -> nada a lancar).

    Retorna (classe, payload):
      classe in ('domfer', 'he', 'compensacao', 'descarte')
    """
    data_iso = linha["data_iso"]
    dia = linha["dia"]
    horas = linha["horas"]
    extras = linha["extras"]
    valor = linha["valor"]
    entrada = linha["entrada"]
    saida = linha["saida"]

    base = BASE_HORAS[dia]
    eh_base0 = abs(horas - extras) < EPS  # domingo OU feriado trabalhado

    if eh_base0:
        return "domfer", {
            "data": data_iso,
            "tipo": "domfer",
            "entrada": entrada,
            "saida": saida,
            "horas": horas,
            "he": 0.0,
            "domfer_qtd": 1,
            "valor_he": 0.0,
            "valor_domfer": valor,
            "valor_fixo": VALOR_FIXO_2025,
            "obs": (
                f"Diaria base 0 ({DIA_NOME[dia]} trabalhado): "
                f"{entrada}->{saida} = {horas:g}h, paga R$ {valor:g}. " + FRASE_ORIGEM
            ),
        }

    if extras >= EPS:
        # hora extra em dia util: confere coerencias (he = horas - base).
        he = extras
        if abs((horas - base) - extras) >= EPS:
            he = max(0.0, round2(horas - base))
        return "he", {
            "data": data_iso,
            "tipo": "he",
            "entrada": entrada,
            "saida": saida,
            "horas": horas,
            "he": he,
            "domfer_qtd": 0,
            "valor_he": valor,
            "valor_domfer": 0.0,
            "valor_fixo": VALOR_FIXO_2025,
            "obs": (
                f"{DIA_NOME[dia]} com HE: {entrada}->{saida} = {horas:g}h "
                f"(base {base:g}h + {he:g}h HE), pago R$ {valor:g}. " + FRASE_ORIGEM
            ),
        }

    # extras ~= 0: carga cumprida. Padrao exato dispensa; atipico = comp.
    if PADRAO_TURNO[dia] and PADRAO_TURNO[dia][0] == entrada and PADRAO_TURNO[dia][1] == saida:
        return "descarte", None
    return "compensacao", {
        "data": data_iso,
        "tipo": "he",
        "entrada": entrada,
        "saida": saida,
        "horas": horas,
        "he": 0.0,
        "domfer_qtd": 0,
        "valor_he": 0.0,
        "valor_domfer": 0.0,
        "valor_fixo": VALOR_FIXO_2025,
        "obs": (
            f"Compensacao: carga igual ao padrao ({horas:g}h) em horario "
            f"atipico {entrada}->{saida}. " + FRASE_ORIGEM
        ),
    }


def preparar_lancamentos(linhas):
    """Aplica a classificacao e devolve (importaveis, descartados)."""
    importaveis = []
    descartados = []
    for l in linhas:
        classe, payload = classificar_linha(l)
        if payload is None:
            descartados.append({**l, "classe": classe})
        else:
            importaveis.append({**l, "classe": classe, "payload": payload})
    importaveis.sort(key=lambda x: x["data_iso"])
    return importaveis, descartados


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


def rest(url, apikey, token, metodo="GET", corpo=None, headers=None):
    req = urllib.request.Request(url, method=metodo)
    req.add_header("apikey", apikey)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
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
        email = input("E-mail do usuario dono (Supabase): ").strip()
    if not senha:
        senha = getpass.getpass("Senha do usuario: ")

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
# Relatorio de analise
# ---------------------------------------------------------------------------
def gerar_relatorio(planilha: Path, linhas, importaveis, descartados, relatorio_path: Path):
    base_ref = relatorio_path
    linhas_md = [
        "# Relatório de importação — Horas set/25 a dez/25 para o Ponto Inteligente",
        "",
        f"- Gerado em: {_dt.datetime.now().strftime('%d/%m/%Y %H:%M')}",
        f"- Planilha analisada: `{planilha}`",
        f"- Aba: `{ABA}` (registro DIÁRIO de entrada/saída + horas extras)",
        "",
        "## 1. Resumo",
        "",
        f"- Dias com registro de trabalho na planilha: **{len(linhas)}**",
        f"- Lançamentos a importar (exceções `he`/`domfer`): **{len(importaveis)}**",
        f"- Dias descartados (horário padrão exato): **{len(descartados)}**",
        f"- Período coberto: **{linhas[0]['data_iso']}** a **{linhas[-1]['data_iso']}**",
        "",
        "> O relatório **Recebido & horas** atribui as horas por semana ISO",
        "> (mês da segunda-feira). Depois desta migração, set/25 a dez/25 passam",
        "> a mostrar as horas extras ao lado dos valores recebidos. Jan a ago/2025",
        "> continuam sem fonte de horas até existir outra planilha.",
        "",
        "## 2. Por mês (a importar)",
        "",
        "| Mês | Dias | he (he) | dom/fer | HE (h) | Valor HE | Valor dom/fer |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    por_mes = defaultdict(lambda: {
        "dias": 0, "he_rows": 0, "df_rows": 0, "he_h": 0.0, "v_he": 0.0, "v_df": 0.0,
    })
    for it in importaveis:
        m = it["data_iso"][:7]
        p = por_mes[m]
        p["dias"] += 1
        if it["classe"] == "domfer":
            p["df_rows"] += 1
            p["v_df"] += p["valor_domfer"] if False else it["payload"]["valor_domfer"]
        else:
            p["he_rows"] += 1
            p["he_h"] += it["payload"]["he"]
            p["v_he"] += it["payload"]["valor_he"]
    for m in sorted(por_mes):
        p = por_mes[m]
        linhas_md.append(
            f"| {m} | {p['dias']} | {p['he_rows']} | {p['df_rows']} | "
            f"{p['he_h']:g} | R$ {formatar_moeda_br(p['v_he'])} | R$ {formatar_moeda_br(p['v_df'])} |"
        )

    total_he = sum(p["he_h"] for p in por_mes.values())
    linhas_md += [
        "",
        f"- **Total de horas extras no período: {total_he:g} h**",
        f"- Valor em R$ (HE): **R$ {formatar_moeda_br(sum(p['v_he'] for p in por_mes.values()))}**",
        f"- Valor em R$ (dom/fer): **R$ {formatar_moeda_br(sum(p['v_df'] for p in por_mes.values()))}**",
        "- `valor_fixo` congelado em **R$ 1.400,00** (base semanal real de 2025;",
        "  o reajuste para 1650 só vale para 2026). Não afeta o relatório de horas.",
        "",
        "## 3. Dias descartados (horário padrão exato — nada a lançar)",
        "",
        "| Data | Dia | Entrada->Saída | Horas |",
        "| --- | --- | --- | --- |",
    ]
    for d in descartados:
        linhas_md.append(f"| {d['data_iso']} | {DIA_NOME[d['dia']]} | {d['entrada']}->{d['saida']} | {d['horas']:g} |")

    linhas_md += [
        "",
        "## 4. Regras aplicadas",
        "",
        "- **Domingo/feriado trabalhado** (planilha marca base 0) → `domfer`",
        "  (he = 0; diária congelada pelo valor da planilha; o relatório mostra",
        "  as horas como trabalho em dom/fer, não como hora extra).",
        "- **Dia útil com HE** → `he` (horas extras em horas, valor_he congelado).",
        "- **Carga exata com horário atípico** → `he` com he = 0 + obs",
        "  'Compensação' (controle de que houve troca de horário).",
        "- **Horário padrão exato** → nada é lançado (modelo do app).",
        "- **Feriados 11/15 (Proclamação) e 11/20 (Consciência Negra)** tratados",
        "  como base 0 pela própria planilha — conferem com o calendário nacional.",
        "",
        "## 5. Observações",
        "",
        "- A aba **Horas Extras** desta planilha (valores semanais em R$ do ano",
        "  inteiro) não é usada: a fonte é o registro diário `Cálculo Semanal`.",
        "- Importação **idempotente** por (user_id, data): rerun não duplica.",
        "- Jan–ago/2025 permanece sem horas (sem fonte na planilha — a aba",
        "  `Horas Extras` só tem R$, não a batida diária).",
    ]

    texto = "\n".join(linhas_md) + "\n"
    relatorio_path.write_text(texto, encoding="utf-8")
    return relatorio_path


# ---------------------------------------------------------------------------
# Importacao
# ---------------------------------------------------------------------------
def listar_existentes(url, apikey, token):
    """Datas ja gravadas no periodo da importacao, para idempotencia."""
    status, resp = rest(
        f"{url}/rest/v1/ponto_excecoes?select=data"
        f"&data=gte.2025-09-01&data=lte.2025-12-31&limit=500",
        apikey, token,
    )
    if status != 200:
        sys.exit(f"[erro] listando excecoes existentes ({status}): {resp}")
    return {str(r["data"]) for r in (resp or [])}


def importar(importaveis, env, email, senha, sim):
    if not importaveis:
        print("Nada a importar (nenhuma linha de trabalho).")
        return 0

    print("\n=== IMPORTAR HORAS SET/DEZ-2025 PARA O PONTO ===")
    print(f"  lancamentos a gravar: {len(importaveis)}")
    url, apikey, token = login_supabase(env, email, senha)

    existentes = listar_existentes(url, apikey, token)
    pendentes = [it for it in importaveis if it["data_iso"] not in existentes]
    print(f"  ja importados: {len(importaveis) - len(pendentes)}")
    print(f"  a importar: {len(pendentes)}")

    if not pendentes:
        print("  nada novo a importar.")
        return 0

    if not sim:
        if input("\nConfirmar importacao no Supabase? [s/N] ").strip().lower() != "s":
            print("Cancelado.")
            return 0

    total = 0
    erros = 0
    for it in pendentes:
        p = it["payload"]
        status, resp = rest(
            f"{url}/rest/v1/ponto_excecoes?on_conflict=user_id,data",
            apikey, token, metodo="POST",
            corpo=p,
            headers={"Prefer": "resolution=ignore-duplicates"},
        )
        if status not in (200, 201, 204):
            erros += 1
            print(f"    [erro] {p['data']} {p['tipo']} ({status}): {resp}")
        else:
            total += 1
            if total <= 10 or total % 20 == 0:
                print(
                    f"    ok   {p['data']} {p['tipo']:<10} "
                    f"{p['entrada']}->{p['saida']} "
                    f"{p['horas']:g}h he={p['he']:g}"
                )

    print(f"\nImportacao concluida: {total} registros criados, {erros} erros.")
    return total


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Importa horas de set/dez-2025 para o Ponto Inteligente.")
    parser.add_argument("--planilha", type=Path, default=DEFAULT_PLANILHA, help="xlsm de origem")
    parser.add_argument("--relatorio", type=Path, default=DEFAULT_RELATORIO, help="saida do relatorio md")
    parser.add_argument("--importar", action="store_true", help="grava no Supabase (analise + confirmacao)")
    parser.add_argument("--sim", action="store_true", help="nao confirma antes de gravar")
    parser.add_argument("--email", help="e-mail do usuario dono")
    parser.add_argument("--senha", help="senha do usuario dono")
    args = parser.parse_args()

    if not args.planilha.exists():
        sys.exit(f"Planilha nao encontrada: {args.planilha}")

    print(f"=== ANALISE HORAS PONTO 2025: {args.planilha.name} ===")
    linhas = ler_calculo_semanal(args.planilha)
    importaveis, descartados = preparar_lancamentos(linhas)
    domfer = [i for i in importaveis if i["classe"] == "domfer"]
    he = [i for i in importaveis if i["classe"] == "he"]
    comp = [i for i in importaveis if i["classe"] == "compensacao"]
    total_he = sum(i["payload"]["he"] for i in importaveis)

    print(f"  dias com registro de trabalho: {len(linhas)}")
    print(f"  lancamentos a importar: {len(importaveis)}")
    print(f"    . domingo/feriado (domfer): {len(domfer)}")
    print(f"    . hora extra (he):          {len(he)}")
    print(f"    . compensacao (he=0):       {len(comp)}")
    print(f"  descartados (padrao exato): {len(descartados)}")
    print(f"  total de horas extras: {total_he:g} h")

    rel = gerar_relatorio(args.planilha, linhas, importaveis, descartados, args.relatorio)
    print(f"\nRelatorio gravado em {rel}")

    if not args.importar:
        print("\nModo analise concluido. Rode com --importar para gravar no Supabase.")
        return

    env = carregar_env()
    importar(importaveis, env, args.email, args.senha, args.sim)


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