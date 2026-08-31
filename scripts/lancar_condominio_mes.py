#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lancar_condominio_mes.py — Lança a previsão mensal de condomínio no Planejamento
a partir da planilha Boletos_atualizado.xlsx (lado do lançamento do antigo
gerar_boletos.py).

Fluxo (modo padrão, com confirmação antes de gravar):

  1. Lê o bloco do mês alvo (default 2026-09) na aba "boletos" da planilha:
     itens FIXOS (cod, descricao, valor, ref) + variáveis (Gás 1010, Água 1052)
     + o TOTAL do mês.
  2. Cadastra os itens FIXOS em `despesa_recorrente_item` com a VIGÊNCIA do mês
     alvo. As duas séries com fim conhecido entram com `vigencia_termino`
     (fim do contador), garantindo a referência "n/total" certa nas gerações
     futuras pela tela:
        • Manut. Pintura PC → JAN/2026 a DEZ/2027 (24 parcelas, ref 9/24 em SET/26)
        • Benfeitorias      → JAN/2024 a DEZ/2026 (36 parcelas, ref 33/36 em SET/26)
     Os demais (Cota, Taxa de Coleta, Fundo de Reserva, Leitura) entram vigentes
     a partir do mês em que o valor atual passou a valer, sem término. Inserção
     IDEMPOTENTE: pula linhas já existentes (mesmo cod + vigencia_inicio).
  3. Calcula o total = fixos + gás + água e CONFERE com o TOTAL da planilha
     (aborta se divergir).
  4. Insere UMA previsão em `planejamentos` com origem 'recorrente', tipo_op
     'Saida', data_prevista = vencimento, semana ISO calculada da data e
     observação item a item (mesmo formato do montarObservacaoCondominio:
     "COD Desc n/total R$ x,xx"). Só PREVÊ; a efetivação fica pro botão
     "Lançar" da tela.

SEGURANÇA: autentica como o USUÁRIO DONO (email/senha via REST) → respeita RLS;
user_id fica no DEFAULT auth.uid() do banco (não vai no payload), mesmo padrão
dos hooks.

Uso:
  .venv\\Scripts\\python.exe scripts\\lancar_condominio_mes.py --mes 2026-09 --vencimento 2026-09-10
  .venv\\Scripts\\python.exe scripts\\lancar_condominio_mes.py --mes 2026-09 --sim
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
from datetime import date, timedelta
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PROJETO = Path(__file__).resolve().parents[1]
ENV_LOCAL = PROJETO / ".env.local"
DEFAULT_PLANILHA = Path(r"C:\Users\andre\Desktop\contas\contabilidade total\Boletos_atualizado.xlsx")

# VIGÊNCIAS dos itens FIXOS de condomínio VIGENTES no mês atual (conhecimento
# extraído da planilha + histórico registrado na migration 17). Chave = cod do
# boleto; valor = (vigencia_inicio, vigencia_termino). As séries limitadas por
# contador entram com termino = fim do contador; os demais, sem término.
VIGENCIA_VIGENTE = {
    "1002":  ("2026-04-01", None),   # Cota Condominial (840,82 desde ABR/26)
    "1050":  ("2026-06-01", None),   # Taxa de Coleta (70,76 desde JUN/26)
    "3002":  ("2026-04-01", None),   # Fundo de Reserva (42,04 desde ABR/26)
    "1102":  ("2024-01-01", None),   # Leitura de Água e Gás (8,48)
    "15002": ("2026-01-01", "2027-12-31"),  # Manut. Pintura PC — série 24 (9/24 em SET/26)
    "2002":  ("2024-01-01", "2026-12-31"),  # Benfeitorias — série 36 (33/36 em SET/26)
}

MESES = {
    "JANEIRO": "01", "FEVEREIRO": "02", "MARCO": "03", "ABRIL": "04",
    "MAIO": "05", "JUNHO": "06", "JULHO": "07", "AGOSTO": "08",
    "SETEMBRO": "09", "OUTUBRO": "10", "NOVEMBRO": "11", "DEZEMBRO": "12",
}


# ---------------------------------------------------------------------------
# Planilha (aba "boletos")
# ---------------------------------------------------------------------------

def ler_bloco_mes(planilha: Path, mes_alvo: str):
    """Lê a aba 'boletos' e devolve o bloco do mês alvo (YYYY-MM).

    Cada bloco começa com 'BOLETO DE <MES>', depois um cabeçalho
    (Codigo/Descricao/Ref/Valores/Categoria/Obs), as linhas dos itens e uma
    linha TOTAL. Devolve { items, gas, agua, total_planilha }."""
    import openpyxl

    wb = openpyxl.load_workbook(planilha, data_only=True)
    ws = wb["boletos"]
    mes_num = mes_alvo.split("-")[1]
    linhas = [[c.value for c in r] for r in ws.iter_rows()]

    inicio_bloco = None
    for idx, linha in enumerate(linhas):
        if not linha or not linha[0]:
            continue
        texto = str(linha[0]).strip().upper()
        for nome, mm in MESES.items():
            if nome in texto and mm == mes_num:
                inicio_bloco = idx
                break
        if inicio_bloco is not None:
            break
    if inicio_bloco is None:
        sys.exit(f"Não encontrei o bloco 'BOLETO de {mes_alvo}' na planilha.")

    items = []
    gas = agua = 0.0
    total_planilha = None
    for linha in linhas[inicio_bloco + 1:]:
        if not linha or not any(c is not None for c in linha):
            continue
        cod, desc = linha[0], linha[1]
        if cod is not None and any(n in str(cod).upper() for n in MESES) and "BOLETO" in str(cod).upper():
            break  # bloco seguinte
        if cod is None:
            continue
        if str(cod).strip().upper() == "TOTAL":
            total_planilha = float(linha[3])
            continue
        if str(desc).strip().upper() == "CODIGO":
            continue  # cabeçalho do bloco
        try:
            cod_num = str(int(cod))
        except (TypeError, ValueError):
            continue
        items.append({
            "cod": cod_num,
            "descricao": str(desc or "").strip(),
            "referencia": str(linha[2]).strip() if linha[2] is not None else "",
            "valor": float(linha[3] or 0),
            "categoria": str(linha[4]).strip() if linha[4] is not None else "",
        })

    fixos = [i for i in items if i["cod"] not in ("1010", "1052")]
    for i in items:
        if i["cod"] == "1010":
            gas = i["valor"]
        elif i["cod"] == "1052":
            agua = i["valor"]
    return {"items": fixos, "gas": gas, "agua": agua, "total_planilha": total_planilha}


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


def rest(url, apikey, token, metodo="GET", corpo=None):
    req = urllib.request.Request(url, method=metodo)
    req.add_header("apikey", apikey)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
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
# Cálculo (espelha despesaRecorrenteCalc.js)
# ---------------------------------------------------------------------------

def meses_entre(inicio_iso, fim_iso):
    ai, mi = int(inicio_iso[:4]), int(inicio_iso[5:7])
    af, mf = int(fim_iso[:4]), int(fim_iso[5:7])
    return (af - ai) * 12 + (mf - mi)


def fim_do_mes(iso):
    a, m = int(iso[:4]), int(iso[5:7])
    if m == 12:
        return f"{a}-12-31"
    return (date(a, m + 1, 1) - timedelta(days=1)).isoformat()


def referencia_serie(inicio, termino, mes_iso):
    pos = meses_entre(inicio, mes_iso) + 1
    total = meses_entre(inicio, fim_do_mes(termino)) + 1
    return f"{pos}/{total}" if pos >= 1 and total >= 1 else ""


def formatar_moeda_br(valor):
    centavos = round(abs(float(valor)) * 100)
    inteiro = centavos // 100
    dec = centavos % 100
    milhar = f"{inteiro:,}".replace(",", ".")
    return f"R$ {milhar},{dec:02d}"


def calcular_observacao(detalhamento):
    linhas = []
    for d in detalhamento:
        ref = f" {d['referencia']}" if d["referencia"] else ""
        linhas.append(f"{d['cod']} {d['descricao']}{ref} {formatar_moeda_br(d['valor'])}")
    return "\n".join(linhas)


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Lança a previsão mensal de condomínio (origem 'recorrente') a partir da planilha.")
    parser.add_argument("--mes", default="2026-09", help="mês a lançar (YYYY-MM, default 2026-09)")
    parser.add_argument("--vencimento", default=None, help="data_prevista da previsão (YYYY-MM-DD; default dia 1 do mês)")
    parser.add_argument("--planilha", type=Path, default=DEFAULT_PLANILHA, help="planilha de origem")
    parser.add_argument("--sim", action="store_true", help="não confirma antes de gravar")
    parser.add_argument("--email", help="e-mail do usuário dono")
    parser.add_argument("--senha", help="senha do usuário dono")
    args = parser.parse_args()

    if not re.match(r"^\d{4}-\d{2}$", args.mes):
        sys.exit("--mes deve estar no formato YYYY-MM.")
    vencimento = args.vencimento or f"{args.mes}-01"
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", vencimento):
        sys.exit("--vencimento deve estar no formato YYYY-MM-DD.")

    print(f"=== LANÇAMENTO DA PREVISÃO DE CONDOMÍNIO — {args.mes} ===")
    dados = ler_bloco_mes(args.planilha, args.mes)
    print(f"  vencimento: {vencimento} | planilha: {args.planilha.name}")

    by_cod = {i["cod"]: i for i in dados["items"]}
    fixos = []
    for cod, (inicio, termino) in sorted(VIGENCIA_VIGENTE.items()):
        item = by_cod.get(cod)
        if item is None:
            print(f"  [aviso] cod {cod} não achado no bloco do mês {args.mes} — pulado")
            continue
        fixos.append({
            "cod": cod,
            "descricao": item["descricao"],
            "valor": item["valor"],
            "categoria": item["categoria"],
            "vigencia_inicio": inicio,
            "vigencia_termino": termino,
            "referencia": referencia_serie(inicio, termino, f"{args.mes}-01") if termino else "",
        })

    total = round(sum(f["valor"] for f in fixos) + dados["gas"] + dados["agua"], 2)
    total_planilha = dados["total_planilha"]

    print("\n  Itens fixos a cadastrar (despesa_recorrente_item):")
    for f in fixos:
        termino_txt = f["vigencia_termino"] or "—"
        print(f"    {f['cod']:>5} {f['descricao']:<24} {f['valor']:>9,.2f}  vig: {f['vigencia_inicio']}→{termino_txt}")
    print(f"\n  Variáveis:  Gás {dados['gas']:,.2f} | Água {dados['agua']:,.2f}")
    print(f"  Total calculado : {total:,.2f}")
    if total_planilha is not None:
        print(f"  Total (planilha): {total_planilha:,.2f}")
        if abs(total - total_planilha) > 0.005:
            sys.exit(f"[erro] total diverge da planilha ({total:.2f} vs {total_planilha:.2f}). Abortando.")

    print("\n  Previsão a criar (planejamentos):")
    print(f"    'Saida' | 'Condomínio {args.mes.upper().replace('-', '/')}' | {total:,.2f} | {vencimento} | origem='recorrente'")

    if not args.sim:
        if input("\nGravar no Supabase? [s/N] ").strip().lower() != "s":
            print("Cancelado.")
            return

    env = carregar_env()
    url, apikey, token = login_supabase(env, args.email, args.senha)

    # 1) itens fixos (idempotente: mesmo cod + vigencia_inicio)
    status, exist = rest(
        f"{url}/rest/v1/despesa_recorrente_item?select=cod,vigencia_inicio&limit=5000",
        apikey, token,
    )
    if status != 200:
        sys.exit(f"[erro] listando itens existentes ({status}): {exist}")
    ja_existentes = {(str(i["cod"]), i["vigencia_inicio"]) for i in (exist or [])}

    inseridos = 0
    for f in fixos:
        chave = (f["cod"], f["vigencia_inicio"])
        if chave in ja_existentes:
            print(f"  item {f['cod']} ({f['vigencia_inicio']}) já existe — pulado")
            continue
        status, resp = rest(
            f"{url}/rest/v1/despesa_recorrente_item", apikey, token, "POST",
            corpo={
                "cod": f["cod"],
                "descricao": f["descricao"],
                "valor": f["valor"],
                "categoria": f["categoria"],
                "vigencia_inicio": f["vigencia_inicio"],
                "vigencia_termino": f["vigencia_termino"],
            },
        )
        if status not in (200, 201):
            print(f"    [erro] item {f['cod']} ({status}): {resp}")
        else:
            inseridos += 1
    print(f"  itens fixos inseridos: {inseridos}")

    # 2) previsão
    obs = calcular_observacao(
        [dict(f) for f in fixos]
        + [
            {"cod": "1010", "descricao": "Consumo de Gás", "valor": dados["gas"], "referencia": "", "categoria": "Utilidades"},
            {"cod": "1052", "descricao": "Consumo de Água", "valor": dados["agua"], "referencia": "", "categoria": "Utilidades"},
        ]
    )
    iso = date.fromisoformat(vencimento).isocalendar()
    status, resp = rest(
        f"{url}/rest/v1/planejamentos", apikey, token, "POST",
        corpo={
            "tipo_op": "Saida",
            "descricao": f"Condomínio {args.mes.upper().replace('-', '/')}",
            "valor": total,
            "data_prevista": vencimento,
            "ano_semana": iso.year,
            "semana": iso.week,
            "origem": "recorrente",
            "observacao": obs,
        },
    )
    if status not in (200, 201):
        sys.exit(f"[erro] criando a previsão ({status}): {resp}")

    print("\n  Previsão criada com sucesso:")
    print(f"    'Condomínio {args.mes.upper().replace('-', '/')}' | {total:,.2f} | {vencimento} (semana {iso.week}/{iso.year}) | recorrente | previsto")
    print("    Observação:")
    for l in obs.splitlines():
        print(f"      {l}")
    print("\n  Efetivação (Lançar) fica pela tela do Planejamento.")


def pausa_fim():
    """Segura a janela aberta quando o script roda sem ser chamado pelo
    terminal (ex.: duplo clique / atalho), senão ela fecha antes de a pessoa
    ler o resultado ou o erro. Em pipeline/redireção não pausa (isatty falso)."""
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
        # sys.exit()/saída normal do main — pausa para mostrar, depois repassa.
        pausa_fim()
        raise
    except Exception:
        # Qualquer exceção inesperada: imprime o erro COMPLETO (mais fácil de
        # diagnosticar) e segura a janela.
        import traceback
        print("\n=== ERRO INESPERADO ===")
        traceback.print_exc()
        pausa_fim()
        sys.exit(1)
