# ============================================================================
# DIAGNÓSTICO — leitura do mês nos dois bancos do relatório "Recebido & horas"
# ============================================================================
# Somente LEITURA (REST autenticado como o dono, respeita RLS). Imprime:
#   1) planejamentos  do mês (data, descricao, valor, tipo_op, estado, origem);
#   2) ponto_excecoes da janela do mês (data, tipo, he, valor);
# para comparar o que o relatório soma vs o que a planilha mostra.
#
# Uso:  .venv\Scripts\python.exe scripts\diagnostico_mes.py [YYYY-MM]
# E-mail/senha são pedidos no terminal (ou SUPABASE_EMAIL/SUPABASE_SENHA).
# ============================================================================
import argparse
import datetime as dt
import getpass
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENV_LOCAL = Path(__file__).resolve().parents[1] / ".env.local"


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


def login_supabase(env):
    url = env.get("VITE_SUPABASE_URL") or input("VITE_SUPABASE_URL: ").strip()
    apikey = env.get("VITE_SUPABASE_ANON_KEY") or input("VITE_SUPABASE_ANON_KEY: ").strip()
    if not url or not apikey:
        sys.exit("Sem VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY no .env.local do projeto.")

    email = env.get("SUPABASE_EMAIL") or os.environ.get("SUPABASE_EMAIL") or input("E-mail do usuário dono (Supabase): ").strip()
    senha = env.get("SUPABASE_SENHA") or os.environ.get("SUPABASE_SENHA") or getpass.getpass("Senha do usuário: ")

    status, resp = rest(f"{url}/auth/v1/token?grant_type=password", apikey, apikey, "POST",
                        corpo={"email": email, "password": senha})
    if status not in (200, 201) or not isinstance(resp, dict) or not resp.get("access_token"):
        print(f"[erro] falha no login ({status}): {resp}")
        sys.exit(1)
    return url, apikey, resp["access_token"]


def fmt_moeda(v):
    return f"R$ {v:,.2f}".replace(",", "*").replace(".", ",").replace("*", ".")


def main():
    parser = argparse.ArgumentParser(description="Diagnóstico de leitura do mês no relatório.")
    parser.add_argument("mes", nargs="?", default="2026-08", help="mês no formato YYYY-MM (padrão 2026-08)")
    args = parser.parse_args()

    try:
        ano, mes = int(args.mes[:4]), int(args.mes[5:7])
        inicio = f"{ano:04d}-{mes:02d}-01"
        dia_fim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]
        if ano % 4 == 0 and mes == 2:
            dia_fim = 29
        fim = f"{ano:04d}-{mes:02d}-{dia_fim:02d}"
    except Exception:
        sys.exit("Mês inválido. Use YYYY-MM (ex.: 2026-08).")

    # Janela do Ponto: segunda-feira anterior ao mês até o fim do mês (para a
    # semana ISO que começa no mês anterior contar, igual ao relatório não faz,
    # mas aqui queremos VER os registros).
    inicio_sem = (dt.date(ano, mes, 1) - dt.timedelta(days=7)).isoformat()

    env = carregar_env()
    url, apikey, token = login_supabase(env)

    print(f"\n=== PLANEJAMENTOS {args.mes} (data {inicio}..{fim}) ===")
    st, rows = rest(f"{url}/rest/v1/planejamentos?select=data_prevista,descricao,valor,tipo_op,estado,origem&data_prevista=gte.{inicio}&data_prevista=lte.{fim}&order=data_prevista", apikey, token)
    if st != 200:
        print(f"[erro] ({st}): {rows}")
        return 1
    rows = rows if isinstance(rows, list) else []
    total_por_origem = {}
    for i, r in enumerate(rows, 1):
        origem = r.get("origem")
        total_por_origem[origem] = total_por_origem.get(origem, 0) + float(r.get("valor") or 0)
        print(f'  {i:>3}. {r.get("data_prevista")}  [{r.get("origem"):<18}] [{r.get("tipo_op"):<7}] [{r.get("estado"):<9}] {fmt_moeda(r.get("valor"))}  {r.get("descricao") or ""}')
    print("\n  Totais por origem (todos os estados):")
    for origem, soma in sorted(total_por_origem.items()):
        print(f"    {origem:<18} {len([1 for r in rows if r.get('origem') == origem]):>3} linhas  {fmt_moeda(soma)}")
    total_realizado = sum(float(r.get("valor") or 0) for r in rows if r.get("estado") == "realizado")
    print(f"  Soma dos 'realizado': {fmt_moeda(total_realizado)}")

    print(f"\n=== PONTO EXCEÇÕES na janela {inicio_sem}..{fim} (semana do mês anterior incluída p/ ver) ===")
    st, excs = rest(f"{url}/rest/v1/ponto_excecoes?select=data,tipo,he,valor_he,valor_domfer&data=gte.{inicio_sem}&data=lte.{fim}&order=data", apikey, token)
    if st != 200:
        print(f"[erro] ({st}): {excs}")
        return 1
    excs = excs if isinstance(excs, list) else []
    soma_he = 0.0
    for i, e in enumerate(excs, 1):
        he = float(e.get("he") or 0)
        soma_he += he
        veto = f'  (he={he:g} h, valor_he={fmt_moeda(e.get("valor_he"))}'
        print(f'  {i:>3}. {e.get("data")}  [{e.get("tipo"):<7}] {veto}, valor_domfer={fmt_moeda(e.get("valor_domfer"))})')
    print(f"\n  Total he na janela: {soma_he:g} h")
    print("\nDiagnóstico concluído (nada foi alterado).")
    return 0


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        import traceback
        print("\n=== ERRO INESPERADO ===")
        traceback.print_exc()
        sys.exit(1)