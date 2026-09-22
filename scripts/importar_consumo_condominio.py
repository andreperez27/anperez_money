# ============================================================================
# IMPORTA o histórico de consumo de água/gás (consumo_agua_gas.xlsx, aba
# "Consumo", dados da linha 5 em diante) para condominio_consumo_mensal.
#
# Regras (22/09/2026, decisão com André):
#   - linha válida SÓ se Leitura anterior E Leitura atual preenchidas
#     (mês incompleto = pular sem erro);
#   - idempotente: mes+tipo já existente = pular (checa antes, não duplica);
#   - NÃO marca ocorrência do Planejamento como "Consumo real informado"
#     (backfill histórico — a regra de travar só vale pela tela);
#   - NÃO mexe em ocorrência já realizada (só grava a leitura);
#   - no fim imprime inseridas / já existentes / incompletas.
#
# Colunas: A=Mês (YYYY-MM) B=Tipo (Água/Gás) C=Leitura anterior D=Leitura
# atual E=Consumo (ignorado, recalcula quem lê) F=Valor (R$) G=Valor m3
# (ignorado). Uso: python scripts/importar_consumo_condominio.py
# ============================================================================
import re
import sys
from pathlib import Path

import openpyxl
import requests

PROJETO = Path(__file__).resolve().parent.parent
PLANILHA = PROJETO / "consumo_agua_gas.xlsx"


def ler_env():
    env = {}
    try:
        for linha in (PROJETO / ".env.local").read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$", linha)
            if m:
                env[m.group(1)] = m.group(2)
    except FileNotFoundError:
        pass
    return env


def login(env):
    url = env.get("VITE_SUPABASE_URL")
    apikey = env.get("VITE_SUPABASE_ANON_KEY")
    r = requests.post(
        f"{url}/auth/v1/token?grant_type=password",
        headers={"apikey": apikey, "Content-Type": "application/json"},
        json={"email": env.get("SUPABASE_EMAIL"), "password": env.get("SUPABASE_SENHA")},
        timeout=30,
    )
    r.raise_for_status()
    return url, apikey, r.json()["access_token"]


def normalizar_tipo(texto):
    t = str(texto or "").strip().lower().replace("á", "a").replace("â", "a")
    return t if t in ("agua", "gas") else None


def num(valor):
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return None
    return n if n == n else None  # NaN fora


def main():
    env = ler_env()
    url, apikey, token = login(env)
    headers = {"apikey": apikey, "Authorization": f"Bearer {token}",
               "Content-Type": "application/json"}

    existentes = requests.get(
        f"{url}/rest/v1/condominio_consumo_mensal",
        params={"select": "mes,tipo"},
        headers=headers, timeout=30,
    )
    existentes.raise_for_status()
    chaves = {(r["mes"][:7], r["tipo"]) for r in existentes.json()}

    wb = openpyxl.load_workbook(PLANILHA, data_only=True)
    ws = wb["Consumo"]

    novas, ja_existiam, incompletas = [], 0, 0
    for r in range(5, ws.max_row + 1):
        mes_txt = ws.cell(r, 1).value
        tipo_txt = ws.cell(r, 2).value
        ant = num(ws.cell(r, 3).value)
        atual = num(ws.cell(r, 4).value)
        valor = num(ws.cell(r, 6).value)
        mes = str(mes_txt or "").strip()
        tipo = normalizar_tipo(tipo_txt)
        if not re.fullmatch(r"\d{4}-\d{2}", mes) or not tipo \
                or ant is None or atual is None or valor is None:
            if mes or tipo_txt:
                incompletas += 1
                print(f"  linha {r}: incompleta, pulada ({mes_txt} / {tipo_txt})")
            continue
        chave = (mes, tipo)
        if chave in chaves:
            ja_existiam += 1
            print(f"  linha {r}: {mes} {tipo} já existe, pulada")
            continue
        novas.append({
            "mes": f"{mes}-01",
            "tipo": tipo,
            "leitura_anterior": round(ant, 2),
            "leitura_atual": round(atual, 2),
            "valor": round(valor, 2),
        })
        chaves.add(chave)

    inseridas = 0
    if novas:
        r = requests.post(
            f"{url}/rest/v1/condominio_consumo_mensal",
            headers=headers, json=novas, timeout=60,
        )
        r.raise_for_status()
        inseridas = len(novas)

    print(f"\nInseridas: {inseridas} | Já existiam: {ja_existiam} | "
          f"Incompletas: {incompletas}")


if __name__ == "__main__":
    sys.exit(main())
