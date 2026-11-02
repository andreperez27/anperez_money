#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
atualizar_consumo_agua_gas.py — Sincroniza a planilha consumo_agua_gas.xlsx
com os consumos REAIS registrados no app (tabela condominio_consumo_mensal).

Fonte: o app é a fonte (mesma regra dos recebimentos). Cada linha do banco
(leitura_anterior, leitura_atual, valor) vira uma linha "Mês referência × Tipo"
na aba "Consumo", usando o MES_CONSUMO (mês do consumo que o boleto cobra —
fallback: mês do boleto, pré-migration 39). Linhas já existentes recebem SÓ os
campos em branco (nunca sobrescreve o que está na planilha); as ausentes são
acrescentadas no fim da Tabela1 com as fórmulas de Consumo (m³) e valor do m³,
a referência da tabela é redimensionada e a formatação (Arial, bordas thin,
centralização, formatos 0.00 e o amarelo FFFFF2CC em C/D/F das linhas de Gás)
é replicada de uma linha modelo já formatada do MESMO tipo.

Uso:  python scripts/atualizar_consumo_agua_gas.py
"""

import copy
import json
import shutil
import sys
import urllib.request
from pathlib import Path

import openpyxl
from openpyxl.worksheet.table import Table  # noqa: F401 (garante carga das definições)

RAIZ = Path(__file__).resolve().parent.parent
PLANILHA = RAIZ / "consumo_agua_gas.xlsx"
ENV_LOCAL = RAIZ / ".env.local"

NOMES_DO_TIPO = {"gas": "Gás", "agua": "Água"}
ABBA = "Consumo"


def ler_env():
    env = {}
    for linha in ENV_LOCAL.read_text(encoding="utf-8", errors="replace").splitlines():
        t = linha.strip()
        if not t or t.startswith("#") or "=" not in t:
            continue
        chave, *resto = t.split("=")
        env[chave.strip()] = "=".join(resto).strip().strip('"').strip("'")
    return env


def requisicao(url, corpo=None, cabec=None, metodo="GET"):
    cabec = dict(cabec or {})
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, headers=cabec, method=metodo)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8") or "null")


def carregar_banco(env):
    base = env["VITE_SUPABASE_URL"].rstrip("/")
    apikey = env["VITE_SUPABASE_ANON_KEY"]
    sessao = requisicao(
        f"{base}/auth/v1/token?grant_type=password",
        corpo={"email": env["SUPABASE_EMAIL"], "password": env["SUPABASE_SENHA"]},
        cabec={"apikey": apikey, "Content-Type": "application/json"},
        metodo="POST",
    )
    token = sessao["access_token"]
    cabec = {"apikey": apikey, "Authorization": f"Bearer {token}", "Accept": "application/json"}
    linhas = requisicao(
        f"{base}/rest/v1/condominio_consumo_mensal"
        "?select=mes,mes_consumo,tipo,valor,leitura_anterior,leitura_atual&order=mes.asc",
        cabec=cabec,
    )
    consumos = {}
    for l in linhas or []:
        mes_banco = str(l.get("mes_consumo") or "")[:7]
        if not len(mes_banco) == 7:
            mes_banco = str(l.get("mes") or "")[:7]
        tipo = (l.get("tipo") or "").strip().lower()
        if tipo not in NOMES_DO_TIPO or l.get("leitura_atual") is None:
            continue  # linha incompleta do app nunca entra na planilha
        consumos[(mes_banco, tipo)] = {
            "anterior": l.get("leitura_anterior"),
            "atual": l.get("leitura_atual"),
            "valor": l.get("valor"),
        }
    return consumos


def escolher_modelos(ws, linha_ini, linha_fim):
    """Linha modelo de cada tipo: primeira linha completa e já formatada
    (C e E preenchidos) — de onde se copiam fonte, bordas, alinhamento,
    formatos e preenchimento (o amarelo das linhas de Gás vem junto)."""
    modelos = {}
    for r in range(linha_ini + 1, linha_fim + 1):
        tipo = ws.cell(row=r, column=2).value
        if tipo is None or tipo in modelos:
            continue
        if ws.cell(row=r, column=3).value is None:  # nunca preenchida
            continue
        if ws.cell(row=r, column=5).value is not None:  # fórmula de consumo ok
            modelos[tipo] = r
    return modelos


def replicar_estilo(ws, rmodelo, rdestino):
    for col in range(1, 8):
        c_src = ws.cell(row=rmodelo, column=col)
        c_dst = ws.cell(row=rdestino, column=col)
        c_dst.font = copy.copy(c_src.font)
        c_dst.fill = copy.copy(c_src.fill)
        c_dst.border = copy.copy(c_src.border)
        c_dst.alignment = copy.copy(c_src.alignment)
        c_dst.protection = copy.copy(c_src.protection)
        # C-G sempre 0.00 (algumas linhas antigas têm 0.000 herdado do modelo).
        c_dst.number_format = "0.00" if col >= 3 else c_src.number_format


def sincronizar(consumos):
    backup = PLANILHA.with_name(PLANILHA.stem + "_antes.xlsx")
    if not backup.exists():
        shutil.copy2(PLANILHA, backup)
        print(f"backup: {backup.name}")

    wb = openpyxl.load_workbook(PLANILHA)
    ws = wb[ABBA]
    tabela = ws.tables["Tabela1"]
    lados = str(tabela.ref).split(":")
    linha_ini = int("".join(c for c in lados[0] if c.isdigit()))
    linha_fim = int("".join(c for c in lados[1] if c.isdigit()))

    # Linhas existentes: chave (mês, tipo) → índice das colunas.
    existentes = {}
    for r in range(linha_ini + 1, linha_fim + 1):
        mes = ws.cell(row=r, column=1).value
        tipo = ws.cell(row=r, column=2).value
        if mes is None:
            continue
        existentes[(str(mes), tipo)] = r

    # Modelo de formato por tipo (fonte/bordas/amarelo) e de fórmulas.
    modelos = escolher_modelos(ws, linha_ini, linha_fim)
    rmodelo = modelos.get("Água") or modelos.get("Gás") or (linha_ini + 1)
    borda_interior = copy.copy(ws.cell(row=rmodelo, column=1).border)

    preenchidas = 0
    novas = []
    primeira_nova = None
    for (mes, tipo), dados in sorted(consumos.items()):
        r = existentes.get((mes, NOMES_DO_TIPO[tipo]))
        dest = "** nova linha **" if r is None else str(r)
        if r is None:
            primeira_nova = linha_fim + 1 if primeira_nova is None else primeira_nova
            ws.cell(row=linha_fim + 1, column=1, value=mes)
            ws.cell(row=linha_fim + 1, column=2, value=NOMES_DO_TIPO[tipo])
            existentes[(mes, NOMES_DO_TIPO[tipo])] = linha_fim + 1
            r = linha_fim + 1
            linha_fim = r
            novas.append(r)
        # Só preenche o que está EM BRANCO: nunca sobrescreve o que a planilha
        # já tem (o banco é fonte para registros do app, mas correção manual
        # na planilha é respeitada).
        for col, chave, fmt in ((3, "anterior", "0.00"), (4, "atual", "0.00"), (6, "valor", "0.00")):
            if ws.cell(row=r, column=col).value is None and dados.get(chave) is not None:
                ws.cell(row=r, column=col, value=float(dados[chave])).number_format = fmt
                preenchidas += 1
        # Fórmulas fixas (células em branco só em linha nova/incompleta).
        if ws.cell(row=r, column=5).value is None:
            ws.cell(row=r, column=5, value=f'=IF(OR(C{r}="",D{r}=""),"",D{r}-C{r})').number_format = "0.00"
        if ws.cell(row=r, column=7).value is None:
            ws.cell(
                row=r, column=7,
                value="=Tabela1[[#This Row],[Valor (R$)]]/Tabela1[[#This Row],[Consumo (m3)]]",
            ).number_format = "0.00"
        print(f"  {mes} {NOMES_DO_TIPO[tipo]:<5} linha {dest}: ant={dados.get('anterior')} at={dados.get('atual')} R$ {dados.get('valor')}")

    # Formata as linhas novas com o estilo da linha modelo do MESMO tipo
    # (Arial, bordas thin, centralização, formatos 0.00; o preenchimento de
    # C/D/F da linha de Gás — amarelo FFFFF2CC — vem junto do modelo).
    for r_nova in novas:
        tipo_nome = ws.cell(row=r_nova, column=2).value
        replicar_estilo(ws, modelos.get(tipo_nome, rmodelo), r_nova)
    # A última linha da tabela antiga perdeu a borda de baixo ao receber
    # linhas novas — restaura com a mesma borda do interior da tabela.
    if primeira_nova is not None:
        for col in range(1, 8):
            c = ws.cell(row=primeira_nova - 1, column=col)
            nb = copy.copy(c.border)
            nb.bottom = borda_interior.bottom
            c.border = nb

    # Redimensiona a tabela (referência do e faixa do autofiltro).
    novo_ref = f"A{linha_ini}:G{linha_fim}"
    tabela.ref = novo_ref
    if tabela.autoFilter is not None:
        tabela.autoFilter.ref = novo_ref
    wb.save(PLANILHA)
    print(f"\n{preenchidas} célula(s) preenchida(s), {len(novas)} linha(s) nova(s). Tabela: {novo_ref}")


def main():
    env = ler_env()
    consumos = carregar_banco(env)
    print(f"Registros no app (com leitura completa): {len(consumos)}")
    sincronizar(consumos)


if __name__ == "__main__":
    main()
