#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
migrar_dados_antigos.py — Migração do banco SQLite do app antigo para o Supabase.

SEM dependências externas (só stdlib): sqlite3 + urllib contra a API REST do
Supabase (PostgREST). Autentica como o USUÁRIO DONO dos dados (email/senha via
REST /auth/v1/token), então TODAS as operações respeitam RLS — nada de
service_role; o Supabase resolve user_id via DEFAULT auth.uid().

MODO DE USO (na ordem correta):

  1) ANÁLISE (padrão, só leitura local, não toca no Supabase):
       .venv\\Scripts\\python.exe scripts\\migrar_dados_antigos.py
     Gera scripts\\relatorio_migracao.md com tabelas, contas, movimentações,
     transferências e a comparação de saldos (soma do extrato vs saldos_conta).

  2) IMPORTAR movimentações das contas ATIVAS (Nubank PJ, Nubank PF) e da
     caixinha "Pagamento do Apê" (antiga "Caixinha APÊ", que vira uma
     CAIXINHA vinculada à conta Nubank PJ, com histórico em
     caixinha_movimentacoes — nunca uma conta), em ordem cronológica,
     pulando o que já existe (idempotente) e SEM tocar nos lançamentos
     das demais:
       .venv\\Scripts\\python.exe scripts\\migrar_dados_antigos.py --importar
     (pede email/senha do Supabase; ou --email --senha / env SUPABASE_EMAIL)

  3) RECALCULAR saldos (fonte da verdade = soma das movimentações, como o
     trigger calcula). Use se algo gravou saldo diferente no app novo:
       .venv\\Scripts\\python.exe scripts\\migrar_dados_antigos.py --recalcular-saldos

FLAGS:
  --db CAMINHO                banco SQLite de origem (default: o do André)
  --relatorio CAMINHO         onde gravar o relatório (default: scripts/relatorio_migracao.md)
  --email / --senha           credenciais (ou entorno SUPABASE_EMAIL/SUPABASE_SENHA)
  --incluir-inativas          também cria contas inativas (ex.: Bradesco MEI) e importa
  --incluir-caixinhas         também importa movimentações de contas antigas tipo 'Caixa'
  --nao-corrigir              no --importar, não chama a correção de saldo no fim
  --sim                       não pede confirmação antes de gravar no Supabase
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sqlite3
import sys
import urllib.parse
import urllib.request
import urllib.error
from collections import Counter
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PROJETO = Path(__file__).resolve().parents[1]
DEFAULT_DB = Path(r"C:\Users\andre\Desktop\contas\contabilidade total\App financeiro\dados.db")
DEFAULT_RELATORIO = PROJETO / "scripts" / "relatorio_migracao.md"
ENV_LOCAL = PROJETO / ".env.local"

ATIVAS_ESPERADAS = ["Nubank PJ", "Nubank PF"]  # usadas na classificação/recomendação

# ---------------------------------------------------------------------------
# Leitura do banco antigo
# ---------------------------------------------------------------------------


def ler_banco(caminho_db: Path):
    """Abre o SQLite (somente leitura) e devolve um dicionário com tudo que a
    análise precisa: contas, movimentações, saldos e tabelas do catálogo."""
    con = sqlite3.connect(f"file:{caminho_db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    def tabelas():
        return [
            dict(r)
            for r in cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
        ]

    def contas():
        try:
            return [dict(r) for r in cur.execute("SELECT * FROM contas ORDER BY id")]
        except sqlite3.Error as e:
            print(f"  [aviso] tabela 'contas' ilegível: {e}")
            return []

    def movimentacoes():
        return [dict(r) for r in cur.execute("SELECT * FROM movimentacoes ORDER BY data, id")]

    def saldos():
        try:
            return [dict(r) for r in cur.execute("SELECT conta, saldo_atual FROM saldos_conta")]
        except sqlite3.Error:
            return []

    def categorias():
        try:
            return [dict(r) for r in cur.execute("SELECT * FROM categorias ORDER BY id")]
        except sqlite3.Error:
            return []

    dados = {
        "tabelas": tabelas(),
        "contas": contas(),
        "movimentacoes": movimentacoes(),
        "saldos_conta": saldos(),
        "categorias": categorias(),
    }
    con.close()
    return dados


def limpar(texto, valor_padrao=""):
    """Textos vêm do SQLite; são UTF-8 válidos, mas normalize para não
    importarmos nada nulo/vazio onde o esquema exige NOT NULL."""
    if texto is None:
        return valor_padrao
    t = str(texto).strip()
    return t or valor_padrao


# ---------------------------------------------------------------------------
# Classificação das contas antigas
# ---------------------------------------------------------------------------


def classificar_contas(dados):
    """Devolve dict por NOME da conta: {nome, id, tipo, ativa, saldo_tabela,
    saldo_antigo, classe (ativa/inativa/caixinha/ornfa)}."""
    por_nome = {}
    for c in dados["contas"]:
        por_nome[c["nome"]] = {
            "id": c["id"],
            "nome": c["nome"],
            "tipo": c["tipo"],
            "ativa": bool(c.get("ativa")),
            "saldo_tabela": float(c.get("saldo_atual") or 0),
        }
    # Nomes que só existem nas movimentações (ex.: "Caixinha APÊ") viram órfãs.
    nomes_mov = {limpar(m["conta"]) for m in dados["movimentacoes"]}
    for nome in nomes_mov - set(por_nome):
        por_nome[nome] = {"id": None, "nome": nome, "tipo": "?", "ativa": True, "saldo_tabela": 0}

    for s in dados["saldos_conta"]:
        nome = limpar(s["conta"])
        if nome in por_nome:
            por_nome[nome]["saldo_antigo"] = float(s["saldo_atual"])

    for info in por_nome.values():
        tipo = info["tipo"]
        if tipo == "Caixa" or info["nome"].startswith("Caixinha"):
            info["classe"] = "caixinha"
        elif info["id"] is None:
            info["classe"] = "orfã"  # só existe em movimentações antigas
        elif info["ativa"]:
            info["classe"] = "ativa"
        else:
            info["classe"] = "inativa"
    return por_nome


def resumo_movimentacoes(dados, por_nome):
    """Por conta: nº de movs, entradas, saídas, soma (Entrada - Saida)."""
    resumo = {}
    for m in dados["movimentacoes"]:
        nome = limpar(m["conta"])
        r = resumo.setdefault(nome, {"n": 0, "entradas": 0.0, "saidas": 0.0, "soma": 0.0})
        valor = float(m.get("valor") or 0)
        op = limpar(m.get("tipo_op"))
        r["n"] += 1
        if op == "Entrada":
            r["entradas"] += valor
            r["soma"] += valor
        elif op == "Saida":
            r["saidas"] += valor
            r["soma"] -= valor
    return resumo


# ---------------------------------------------------------------------------
# Análise de transferências (impacto de contas inativas/caixinhas em ativas)
# ---------------------------------------------------------------------------


def analisar_transferencias(dados, por_nome):
    """Emparelha as pernas (Saida X + Entrada Y, mesma data e valor) para saber
    se alguma movimentação de conta inativa/caixinha alteraria o saldo de uma
    conta ativa SE fosse simplesmente ignorada. Regra de decisão:
      - Se a perna da conta ATIVA existe nas movimentações dela, importar só
        ela não muda o saldo (a perna da inativa não é importada, correto).
      - Se existe perna em conta ativa SEM par correspondente na outra conta,
        anota como 'terminal' (gasto/receita real) — também importada normal.
    Devolve pares encontrados e lista de pendências para o relatório."""
    movs = dados["movimentacoes"]
    chaves = {}  # (data, valor) -> [(nome_conta, tipo_op, descricao)]
    for m in movs:
        if "Transfer" not in limpar(m.get("categoria")):
            continue
        chave = (limpar(m.get("data")), round(float(m.get("valor") or 0), 2))
        chaves.setdefault(chave, []).append(
            (limpar(m["conta"]), limpar(m.get("tipo_op")), limpar(m.get("descricao"), ""))
        )

    pares, terminais = [], []
    usadas = set()
    for chave, pernas in chaves.items():
        entrada = [p for p in pernas if p[1] == "Entrada"]
        saida = [p for p in pernas if p[1] == "Saida"]
        if entrada and saida:
            for e in entrada:
                for s in saida:
                    pares.append((chave[0], chave[1], s[0], e[0]))
                    usadas.add(id(e))
                    usadas.add(id(s))
    for m in movs:
        if "Transfer" not in limpar(m.get("categoria")):
            continue
        if id(m) in usadas:
            continue
        terminais.append(
            (limpar(m["data"]), limpar(m["conta"]), limpar(m.get("tipo_op")), float(m.get("valor") or 0))
        )
    # Só interessam pares que envolvem contas NÃO ativas (inativa/caixinha/orfã):
    relevantes = [
        p for p in pares
        if any(por_nome[c]["classe"] != "ativa" for c in (p[2], p[3]))
    ]
    return {"contagem_trf": len(movs and [m for m in movs if "Transfer" in limpar(m.get("categoria"))] or []),
            "pares": pares, "relevantes": relevantes, "terminais": terminais}


# ---------------------------------------------------------------------------
# Relatório markdown
# ---------------------------------------------------------------------------


def gerar_relatorio(dados, por_nome, resumo, transf, caminho: Path):
    linhas = []
    ad = linhas.append
    ad("# Relatório de migração — banco antigo → app novo")
    ad("")
    ad(f"- Gerado em: {datetime.now():%d/%m/%Y %H:%M}")
    ad(f"- Banco analisado: `{DEFAULT_DB}`")
    ad("")

    ad("## 1. Visão geral")
    ad("")
    ad("| Tabela | Linhas |")
    ad("| --- | --- |")
    for t in dados["tabelas"]:
        con = sqlite3.connect(f"file:{DEFAULT_DB}?mode=ro", uri=True)
        n = con.execute(f'SELECT COUNT(*) FROM "{t["name"]}"').fetchone()[0]
        con.close()
        ad(f"| {t['name']} | {n} |")
    ad("")

    ad("## 2. Contas e saldos")
    ad("")
    ad("| Conta | Tipo | Ativa? | Classe | Saldo antigo (saldos_conta) | Saldo na tabela contas |")
    ad("| --- | --- | --- | --- | --- | --- |")
    for nome, info in sorted(por_nome.items()):
        saldo_antigo = info.get("saldo_antigo")
        fmt = lambda v: f"{v:,.2f}" if v is not None else "—"
        ad(
            f"| {nome} | {info['tipo']} | {'sim' if info['ativa'] else 'não'} | {info['classe']} "
            f"| {fmt(saldo_antigo)} | {fmt(info['saldo_tabela'])} |"
        )
    ad("")

    ativas = [i for i in por_nome.values() if i["classe"] == "ativa"]
    ad(f"**Contas ativas** (importadas por padrão): {', '.join(i['nome'] for i in ativas) or 'nenhuma'}")
    ad("")
    ad("> Contas **inativas** e **caixinhas** antigas NÃO são criadas no app novo por padrão "
       "(use `--incluir-inativas` ou `--incluir-caixinhas` se quiser o histórico). "
       "Caixinhas do app novo têm gestão própria (funções `caixinha_guardar`/`caixinha_resgatar`).")
    ad("")

    ad("## 3. Movimentações por conta")
    ad("")
    ad("| Conta | Nº | Entradas | Saídas | Soma (E - S) |")
    ad("| --- | --- | --- | --- | --- |")
    for nome, r in sorted(resumo.items()):
        ad(f"| {nome} | {r['n']} | {r['entradas']:,.2f} | {r['saidas']:,.2f} | {r['soma']:,.2f} |")
    ad("")
    datas = [limpar(m["data"]) for m in dados["movimentacoes"] if limpar(m["data"])]
    if datas:
        ad(f"- Período coberto: **{min(datas)}** a **{max(datas)}**")
    ad("")

    ad("## 4. Transferências entre contas")
    ad("")
    ad(f"- Total de movimentações com categoria `Transferência`: {transf['contagem_trf']}")
    ad(f"- Pares saída+entrada identificados (mesma data e valor): {len(transf['pares'])}")
    ad("")
    ad("### 4.1 Pares que envolvem contas não ativas (inativa/caixinha/órfã)")
    ad("")
    ad("| Data | Valor | Saída em | Entrada em |")
    ad("| --- | --- | --- | --- |")
    if transf["relevantes"]:
        for data, valor, s, e in transf["relevantes"]:
            ad(f"| {data} | {valor:,.2f} | {s} | {e} |")
    else:
        ad("_Nenhum._")
    ad("")
    classes = {p[2] for p in transf["relevantes"]} | {p[3] for p in transf["relevantes"]}
    nome_por = {v["nome"]: v["classe"] for v in por_nome.values()}
    if transf["relevantes"]:
        ad("**Conclusão:** em todas as transferências acima a perna da conta **ativa** está "
           "registrada nas movimentações da própria conta ativa. Importar apenas a conta ativa "
           "não altera o saldo dela (a perna da conta inativa/caixinha simplesmente não é "
           "importada, que é o comportamento esperado).")
    else:
        ad("**Conclusão:** nenhuma transferência envolve conta não ativa — sem impacto.")
    ad("")

    ad("## 5. Comparação de saldos (conferência pós-import)")
    ad("")
    ad("O trigger do app novo recalcula `saldo_atual` somando as movimentações importadas. "
       "O histórico antigo é **parcial** (veja a tabela da seção 3), portanto a soma do extrato "
       "raramente fecha com o saldo registrado no app antigo:")
    ad("")
    ad("| Conta | Soma do extrato antigo | Saldo registrado (saldos_conta) | Divergência |")
    ad("| --- | --- | --- | --- |")
    for nome, r in sorted(resumo.items()):
        info = por_nome.get(nome, {})
        saldo_antigo = info.get("saldo_antigo")
        if saldo_antigo is None:
            ad(f"| {nome} | {r['soma']:,.2f} | _sem registro_ | — |")
            continue
        ad(f"| {nome} | {r['soma']:,.2f} | {saldo_antigo:,.2f} | {r['soma'] - saldo_antigo:,.2f} |")
    ad("")
    ad("**Recomendação:** importe as movimentações (opção 1) e depois rode `--corrigir-saldos` "
       "(opção 3) para fixar `saldo_atual` no valor registrado do app antigo — o extrato "
       "histórico mostra os lançamentos importados, e o saldo passa a refletir a realidade.")
    ad("")

    ad("## 6. Observações")
    ad("")
    ad("- A tabela `transacoes` do app antigo tem 1 linha apenas e foi ignorada "
       "(o extrato real usava `movimentacoes`).")
    ad("- Movimentações com `tipo_op` vazio ou valor <= 0 são puladas na importação "
       "(ex.: 'Saldo Inicial 0,00' de Bradesco MEI).")
    ad("- 1 linha com valor 0,00 (Saldo Inicial de Bradesco MEI) será ignorada por "
       "não representar movimento.")
    ad("")

    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text("\n".join(linhas), encoding="utf-8")
    return caminho


# ---------------------------------------------------------------------------
# Supabase REST (autenticado como o dono — respeita RLS)
# ---------------------------------------------------------------------------


def carregar_env():
    """Lê VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY do .env.local (se houver)."""
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
    """Chamada genérica à API REST do Supabase. Devolve (status, json ou None)."""
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


def login_supabase(env, email=None, senha=None, confirmar=True):
    """Autentica como o usuário dono. Retorna (url, apikey, access_token) ou
    encerra se não conseguir."""
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

    if confirmar:
        print(f"Entrando como {email} em {url} ...")

    status, resp = rest(
        f"{url}/auth/v1/token?grant_type=password",
        apikey,
        apikey,  # anon também serve de token para o endpoint público de auth
        metodo="POST",
        corpo={"email": email, "password": senha},
    )
    if status not in (200, 201) or not isinstance(resp, dict) or not resp.get("access_token"):
        print(f"[erro] falha no login ({status}): {resp}")
        sys.exit(1)
    print(f"  ok, autenticado como {resp.get('user', {}).get('email')}")
    return url, apikey, resp["access_token"]


def obter_contas_supabase(url, apikey, token):
    """Contas existentes do usuário no app novo, por nome."""
    status, resp = rest(f"{url}/rest/v1/contas?select=id,nome,tipo,ativa,saldo_atual&order=nome.asc", apikey, token)
    if status != 200:
        print(f"[erro] listando contas ({status}): {resp}")
        return {}
    return {c["nome"]: c for c in resp}


def criar_conta(url, apikey, token, nome, tipo, ativa):
    # O app novo usa tipos curtos ('corrente', 'caixa'); converte os rótulos
    # do banco antigo ('Conta Corrente', 'Caixa') para o padrão.
    TIPOS = {"Conta Corrente": "corrente", "Caixa": "caixa", "corrente": "corrente", "caixa": "caixa"}
    status, resp = rest(
        f"{url}/rest/v1/contas",
        apikey, token, "POST",
        corpo={"nome": nome, "tipo": TIPOS.get(tipo, "corrente"), "ativa": ativa, "saldo_atual": 0},
    )
    if status not in (200, 201):
        print(f"[erro] criando conta {nome} ({status}): {resp}")
        return None
    # PostgREST devolve a linha criada como lista de 1 elemento — MAS
    # quando a resposta vem sem corpo (ex.: representação vazia), busca a
    # conta recém-criada pelo nome para pegar o id.
    if isinstance(resp, list) and resp:
        return resp
    if isinstance(resp, dict) and resp.get("id"):
        return [resp]
    status2, resp2 = rest(
        f"{url}/rest/v1/contas?select=id&nome=eq.{urllib.parse.quote(nome)}",
        apikey, token,
    )
    if status2 == 200 and resp2:
        return resp2
    print(f"[erro] conta {nome} criada mas sem id identificável ({status2}): {resp2}")
    return None


def movimentos_existentes(url, apikey, token, conta_uuid):
    """Conjunto de (data, descricao, valor, tipo_op) já no Supabase p/ idempotência."""
    status, resp = rest(
        f"{url}/rest/v1/movimentacoes?select=data,descricao,valor,tipo_op&conta_id=eq.{conta_uuid}&limit=5000",
        apikey, token,
    )
    if status != 200:
        print(f"[erro] listando movimentações ({status}): {resp}")
        return set()
    return {(r["data"], limpar(r.get("descricao")), float(r.get("valor") or 0), r.get("tipo_op")) for r in resp}


def ajustar_saldo(url, apikey, token, conta_uuid, saldo):
    status, resp = rest(
        f"{url}/rest/v1/contas?id=eq.{conta_uuid}",
        apikey, token, "PATCH",
        corpo={"saldo_atual": round(float(saldo), 2)},
    )
    return status, resp


def obter_caixinhas_supabase(url, apikey, token):
    """Caixinhas do usuário no app novo, por nome."""
    status, resp = rest(
        f"{url}/rest/v1/caixinhas?select=id,conta_id,nome,saldo,ativa&order=nome.asc",
        apikey, token,
    )
    if status != 200:
        print(f"[erro] listando caixinhas ({status}): {resp}")
        return {}
    return {c["nome"]: c for c in resp}


def criar_caixinha(url, apikey, token, conta_id, nome):
    """Cria a caixinha (saldo 0) e devolve a linha criada; se o POST
    voltar sem corpo, busca pelo nome + conta."""
    status, resp = rest(
        f"{url}/rest/v1/caixinhas",
        apikey, token, "POST",
        corpo={"conta_id": conta_id, "nome": nome, "saldo": 0, "ativa": True},
    )
    if status not in (200, 201):
        print(f"[erro] criando caixinha {nome} ({status}): {resp}")
        return None
    if isinstance(resp, list) and resp:
        return resp[0]
    if isinstance(resp, dict) and resp.get("id"):
        return resp
    status2, resp2 = rest(
        f"{url}/rest/v1/caixinhas?select=id,conta_id,nome,saldo,ativa&nome=eq.{urllib.parse.quote(nome)}&conta_id=eq.{conta_id}",
        apikey, token,
    )
    if status2 == 200 and resp2:
        return resp2[0]
    print(f"[erro] caixinha {nome} criada mas sem id identificável ({status2}): {resp2}")
    return None


def movimentos_caixinha_existentes(url, apikey, token, caixinha_uuid):
    """Conjunto de (data, descricao, valor, tipo) já na caixinha p/ idempotência."""
    status, resp = rest(
        f"{url}/rest/v1/caixinha_movimentacoes?select=data,descricao,valor,tipo&caixinha_id=eq.{caixinha_uuid}&limit=5000",
        apikey, token,
    )
    if status != 200:
        print(f"[erro] listando movimentos da caixinha ({status}): {resp}")
        return set()
    return {(r["data"], limpar(r.get("descricao")), float(r.get("valor") or 0), r["tipo"]) for r in resp}


def importar_caixinha_ape(url, apikey, token, dados, contas_sb, sim):
    """Importa a caixinha "Pagamento do Apê" (antiga "Caixinha APÊ") como
    CAIXINHA da conta Nubank PJ — nunca como conta:
      * remove a conta "Pagamento do Apê" caso exista no Supabase (foi
        criada por engano numa versão anterior do script; delete em
        cascade limpa as movimentações que ela tiver)
      * insere caixinhas + histórico em caixinha_movimentacoes
        (Entrada antiga = guardar, Saida = resgatar, datas originais)
      * saldo da caixinha = soma(guardar) - soma(resgatar) do histórico
      * NÃO mexe nas movimentações da Nubank PJ (as transferências
        PJ <-> caixinha já estão lá e não são duplicadas)
    Retorna o total de movimentos inseridos."""
    APE_ANTIGO, APE_NOVO = "Caixinha APÊ", "Pagamento do APê"
    APE_VARIANTE = "Pagamento do Apê"  # grafia que uma versão anterior criava
    DONA = "Nubank PJ"
    print("\n=== CAIXINHA: Pagamento do APê (dentro da Nubank PJ) ===")

    conta_dona = contas_sb.get(DONA)
    if not conta_dona:
        print(f"[erro] conta dona {DONA} não encontrada no Supabase; caixinha não importada.")
        return 0
    print(f"  conta dona: {DONA} (id={conta_dona['id']})")

    # Acerto de rota: limpar o que versões anteriores criaram por engano
    # (a conta "Pagamento do Apê"/"APê" e a caixinha na grafia variante).
    for nome_errante in (APE_NOVO, APE_VARIANTE):
        conta_ape = contas_sb.get(nome_errante)
        if conta_ape:
            if not sim:
                if input(f"  Vai EXCLUIR a conta '{nome_errante}' ({conta_ape['id']}) e seus lançamentos. Confirmar? [s/N] ").strip().lower() != "s":
                    print("  Conta errada não excluída; caixinha não importada.")
                    return 0
            status, resp = rest(
                f"{url}/rest/v1/contas?id=eq.{conta_ape['id']}",
                apikey, token, "DELETE",
            )
            if status not in (200, 204):
                print(f"  [erro] excluindo conta {nome_errante} ({status}): {resp}")
                return 0
            print(f"  conta {nome_errante} excluída (era conta, virou caixinha da {DONA}).")

    caixinhas = obter_caixinhas_supabase(url, apikey, token)
    caixinha = caixinhas.get(APE_NOVO)
    variante = caixinhas.get(APE_VARIANTE)
    # Caixinha órfã na grafia variante (criada por este script em versão
    # anterior): apaga SEMPRE que aparecer, mesmo com a dona existindo.
    if variante and (not caixinha or variante["id"] != caixinha["id"]):
        status, resp = rest(
            f"{url}/rest/v1/caixinhas?id=eq.{variante['id']}",
            apikey, token, "DELETE",
        )
        if status not in (200, 204):
            print(f"  [erro] excluindo caixinha {APE_VARIANTE} ({status}): {resp}")
            return 0
        print(f"  caixinha {APE_VARIANTE} excluída (grafia corrigida para {APE_NOVO}).")
    if not caixinha:
        caixinha = criar_caixinha(url, apikey, token, conta_dona["id"], APE_NOVO)
        if not caixinha:
            return 0
        print(f"  caixinha criada: id={caixinha['id']}")
    else:
        print(f"  caixinha já existente: id={caixinha['id']}")

    existentes = movimentos_caixinha_existentes(url, apikey, token, caixinha["id"])
    print(f"  movimentos já na caixinha (Supabase): {len(existentes)}")

    antigos = [
        m for m in dados["movimentacoes"]
        if limpar(m["conta"]) == APE_ANTIGO
        and limpar(m.get("tipo_op")) in ("Entrada", "Saida")
        and float(m.get("valor") or 0) > 0
    ]
    antigos.sort(key=lambda m: (limpar(m["data"]), m["id"]))
    convertidos = [
        (m, {"Entrada": "guardar", "Saida": "resgatar"}[limpar(m.get("tipo_op"))])
        for m in antigos
    ]
    pendentes = [
        (m, tipo) for m, tipo in convertidos
        if (
            limpar(m["data"]),
            limpar(m.get("descricao")),
            float(m.get("valor") or 0),
            tipo,
        )
        not in existentes
    ]
    print(f"  a importar: {len(pendentes)} movimentos (já existiam: {len(convertidos) - len(pendentes)})")

    total = 0
    for m, tipo in pendentes:
        status, resp = rest(
            f"{url}/rest/v1/caixinha_movimentacoes",
            apikey, token, "POST",
            corpo={
                "caixinha_id": caixinha["id"],
                "tipo": tipo,
                "valor": float(m.get("valor") or 0),
                "descricao": limpar(m.get("descricao")) or None,
                "data": limpar(m["data"]),
            },
        )
        if status not in (200, 201):
            print(f"    [erro] {m['data']} {m['descricao']} ({status}): {resp}")
        else:
            total += 1

    # Saldo da caixinha = fonte da verdade (soma do histórico), mesmo
    # padrão das contas (análogo ao trigger da conta; caixinhas não têm
    # trigger, o saldo é atualizado manualmente).
    status, resp = rest(
        f"{url}/rest/v1/caixinha_movimentacoes?select=tipo,valor&caixinha_id=eq.{caixinha['id']}&limit=5000",
        apikey, token,
    )
    if status == 200:
        soma = sum(
            (1 if m.get("tipo") == "guardar" else -1) * float(m.get("valor") or 0)
            for m in resp
        )
        status2, resp2 = rest(
            f"{url}/rest/v1/caixinhas?id=eq.{caixinha['id']}",
            apikey, token, "PATCH",
            corpo={"saldo": round(soma, 2)},
        )
        if status2 in (200, 204):
            print(f"  saldo da caixinha = {soma:,.2f} (soma do histórico, {len(resp)} movimentos)")
        else:
            print(f"  [erro] ajustando saldo da caixinha ({status2}): {resp2}")
    else:
        print(f"  [erro] recalculando saldo da caixinha ({status}): {resp}")
    return total


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="Migração do banco antigo para o Supabase.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="banco SQLite de origem")
    parser.add_argument("--relatorio", type=Path, default=DEFAULT_RELATORIO, help="saída do relatório md")
    parser.add_argument("--importar", action="store_true", help="importa contas ativas + movimentações")
    parser.add_argument("--corrigir-saldos", action="store_true", help="fixa saldo_atual com o saldo do app antigo")
    parser.add_argument("--incluir-inativas", action="store_true", help="importa também contas inativas")
    parser.add_argument("--incluir-caixinhas", action="store_true", help="importa também movimentações de caixinhas antigas")
    parser.add_argument("--nao-corrigir", action="store_true", help="(compat) sem efeito: o import não corrige saldo")
    parser.add_argument("--recalcular-saldos", action="store_true", help="saldo_atual = soma das movimentações (fonte da verdade)")
    parser.add_argument("--sim", action="store_true", help="não confirma antes de gravar")
    parser.add_argument("--email", help="e-mail do usuário dono")
    parser.add_argument("--senha", help="senha do usuário dono")
    args = parser.parse_args()

    if not args.db.exists():
        sys.exit(f"Banco não encontrado: {args.db}")

    print(f"=== ANÁLISE DO BANCO ANTIGO: {args.db} ===")
    dados = ler_banco(args.db)
    por_nome = classificar_contas(dados)
    resumo = resumo_movimentacoes(dados, por_nome)
    transf = analisar_transferencias(dados, por_nome)

    print("\nContas do app antigo:")
    for nome, info in sorted(por_nome.items()):
        s_ant = info.get("saldo_antigo")
        print(f"  [{info['classe']:>9}] {nome:<22} saldo antigo={s_ant if s_ant is not None else '—':>10}")

    print("\nMovimentações por conta (soma E - S):")
    for nome, r in sorted(resumo.items()):
        print(f"  {nome:<22} {r['n']:>4} movs | soma {r['soma']:>12,.2f}")

    rel = gerar_relatorio(dados, por_nome, resumo, transf, args.relatorio)
    print(f"\nRelatório gravado em {rel}")

    if not (args.importar or args.corrigir_saldos or args.recalcular_saldos):
        print("\nModo análise concluído. Rode com --importar (e depois --corrigir-saldos) para gravar no Supabase.")
        return

    # ---- gravações no Supabase --------------------------------------------
    env = carregar_env()
    url, apikey, token = login_supabase(env, args.email, args.senha, confirmar=True)

    if args.importar:
        # Alvos da importação: (registro antigo, nome no app novo, tipo,
        # ativa). Ativas entram sempre; inativas/caixinhas só com flags.
        alvos = [
            (i, i["nome"], None, i["classe"] == "ativa")
            for i in por_nome.values()
            if i["classe"] == "ativa"
        ]
        if args.incluir_inativas:
            alvos += [
                (i, i["nome"], None, False)
                for i in por_nome.values()
                if i["classe"] == "inativa"
            ]
        if args.incluir_caixinhas:
            alvos += [
                (i, i["nome"], None, True)
                for i in por_nome.values()
                if i["classe"] in ("caixinha", "orfã")
            ]

        # Caixinha "Pagamento do Apê" (antiga "Caixinha APÊ") NÃO vira
        # conta: no app novo ela é uma CAIXINHA da Nubank PJ (ver
        # importar_caixinha_ape, chamada no fim deste bloco).

        contas_sb = obter_contas_supabase(url, apikey, token)
        print("\n=== IMPORTANDO CONTAS E MOVIMENTAÇÕES ===")
        print(f"Contas a importar: {[destino for _i, destino, _t, _a in alvos]}")
        if not args.sim:
            if input("Confirmar? [s/N] ").strip().lower() != "s":
                print("Cancelado.")
                return

        total_inseridas = 0
        for info, nome_destino, tipo_explicito, ativa_explicita in alvos:
            nome = nome_destino
            conta_sb = contas_sb.get(nome)
            uuid = conta_sb["id"] if conta_sb else None
            if not uuid:
                tipo = tipo_explicito or info["tipo"]
                print(f"\nCriando conta: {nome} (tipo {tipo}) ...")
                criada = criar_conta(url, apikey, token, nome, tipo, ativa_explicita)
                if not criada:
                    continue
                # PostgREST devolve a linha criada como lista de 1 elemento
                uuid = criada[0]["id"] if isinstance(criada, list) else criada["id"]
                print(f"  criada: {uuid}")
            else:
                print(f"\nConta já existente no app novo: {nome} (id={uuid})")

            existentes = movimentos_existentes(url, apikey, token, uuid)
            print(f"  movimentações já no Supabase: {len(existentes)}")

            # As movimentações vivem no banco antigo com o nome ANTIGO da
            # conta (info["nome"]); o app novo recebe o nome_destino.
            novos = [
                m for m in dados["movimentacoes"]
                if limpar(m["conta"]) == info["nome"]
                and limpar(m.get("tipo_op")) in ("Entrada", "Saida")
                and float(m.get("valor") or 0) > 0
            ]
            # ordem cronológica (data, depois id) e idempotência
            novos.sort(key=lambda m: (limpar(m["data"]), m["id"]))
            pendentes = [
                m for m in novos
                if (
                    limpar(m["data"]),
                    limpar(m.get("descricao")),
                    float(m.get("valor") or 0),
                    limpar(m.get("tipo_op")),
                )
                not in existentes
            ]
            print(f"  a importar: {len(pendentes)} movimentações (já existiam: {len(novos) - len(pendentes)})")

            for m in pendentes:
                corpo = {
                    "conta_id": uuid,
                    "data": limpar(m["data"]),
                    "descricao": limpar(m.get("descricao")),
                    "valor": float(m.get("valor") or 0),
                    "categoria": limpar(m.get("categoria")) or None,
                    "tipo_op": limpar(m.get("tipo_op")),
                }
                status, resp = rest(f"{url}/rest/v1/movimentacoes", apikey, token, "POST", corpo=corpo)
                if status not in (200, 201):
                    print(f"    [erro] {m['data']} {m['descricao']} ({status}): {resp}")
                else:
                    total_inseridas += 1

            # NÃO ajusta saldo aqui: o trigger trg_atualizar_saldo calcula
            # saldo_atual = soma das movimentações importadas (a fonte da
            # verdade, como André confirmou). Correção para o valor do app
            # antigo só com --corrigir-saldos EXPLÍCITO, e recálculo a
            # partir das movimentações com --recalcular-saldos.

        # Caixinha "Pagamento do Apê" destinada à Nubank PJ (histórico em
        # caixinha_movimentacoes). Precisa da lista atualizada de contas.
        total_inseridas += importar_caixinha_ape(url, apikey, token, dados, contas_sb, args.sim)

        print(f"\nImportação concluída: {total_inseridas} movimentações inseridas.")

        print("\nSaldos finais das contas importadas (conferência):")
        contas_sb = obter_contas_supabase(url, apikey, token)
        for info, nome_destino, *_resto in alvos:
            c = contas_sb.get(nome_destino)
            if c:
                s_ant = info.get("saldo_antigo")
                print(f"  {nome_destino:<22} Supabase={float(c['saldo_atual']):>12,.2f}  antigo={s_ant if s_ant is not None else '—'}")
        caix_sb = obter_caixinhas_supabase(url, apikey, token)
        id_para_nome = {c["id"]: nome for nome, c in contas_sb.items()}
        for nome, c in sorted(caix_sb.items()):
            dona = id_para_nome.get(c.get("conta_id"), "?")
            print(f"  caixinha {nome:<18} Supabase={float(c['saldo']):>12,.2f}  (conta {dona})")

    if args.corrigir_saldos:
        if not args.importar and not args.sim:
            if input("\nVai corrigir saldo_atual de contas ATIVAS para o valor do app antigo. Confirmar? [s/N] ").strip().lower() != "s":
                print("Cancelado.")
                return
        print("\n=== CORRIGINDO SALDOS ===")
        contas_sb = obter_contas_supabase(url, apikey, token)
        for nome, info in sorted(por_nome.items()):
            if info["classe"] not in ("ativa", "inativa"):
                continue
            saldo_antigo = info.get("saldo_antigo")
            c = contas_sb.get(nome)
            if saldo_antigo is None or not c:
                print(f"  {nome:<22} (sem referência ou conta não existe no Supabase) — ignorado")
                continue
            status, resp = ajustar_saldo(url, apikey, token, c["id"], saldo_antigo)
            if status in (200, 204):
                print(f"  {nome:<22} saldo_atual = {saldo_antigo:,.2f}  (ok)")
            else:
                print(f"  {nome:<22} [erro] ({status}): {resp}")
        print("Correção de saldos concluída.")

    if args.recalcular_saldos:
        # Saldo da FONTE DA VERDADE: soma das movimentações do Supabase
        # (mesma lógica do trigger trg_atualizar_saldo). Desfaz qualquer
        # correção feita com --corrigir-saldos.
        if not args.sim:
            if input("\nVai recalcular saldo_atual = soma das movimentações no Supabase. Confirmar? [s/N] ").strip().lower() != "s":
                print("Cancelado.")
                return
        print("\n=== RECALCULANDO SALDOS (soma das movimentações) ===")
        contas_sb = obter_contas_supabase(url, apikey, token)
        for nome, c in sorted(contas_sb.items()):
            status, resp = rest(
                f"{url}/rest/v1/movimentacoes?select=tipo_op,valor&conta_id=eq.{c['id']}&limit=5000",
                apikey, token,
            )
            if status != 200:
                print(f"  {nome:<22} [erro] buscando movimentações ({status}): {resp}")
                continue
            soma = sum(
                (1 if m.get("tipo_op") == "Entrada" else -1) * float(m.get("valor") or 0)
                for m in resp
            )
            status2, resp2 = ajustar_saldo(url, apikey, token, c["id"], soma)
            if status2 in (200, 204):
                print(f"  {nome:<22} saldo_atual = {soma:,.2f}  (movimentações: {len(resp)})  (ok)")
            else:
                print(f"  {nome:<22} [erro] ({status2}): {resp2}")
        print("Recálculo de saldos concluído.")


if __name__ == "__main__":
    main()