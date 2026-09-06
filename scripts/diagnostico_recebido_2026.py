# ============================================================================
# DIAGNÓSTICO do relatório "Recebido & horas" — app × planilha, semana a semana
# ============================================================================
# Somente LEITURA (REST autenticado como o dono, respeita RLS). Imprime:
#   1) todos os planejamentos 2026 (data, valor, origem, estado, semana_trabalho,
#      descricao) — para ver O QUE o app tem e com qual semântica;
#   2) a comparação por SEMANA DE TRABALHO (segunda da semana civil anterior à
#      data, a convenção da planilha "referente ao período de X à Y"):
#         planilha  = soma do VALOR TOTAL da planilha por semana trabalhada;
#         realizado = soma dos realizados do app por semana (bucket do relatório);
#         extras    = valorHe + valorDomfer do Ponto (não conta duas vezes,
#                     já está dentro do realizado);
#         sóPrevis  = soma dos previstos (origem jornada/planilha) da semana.
#
# Uso:  .venv\Scripts\python.exe scripts\diagnostico_recebido_2026.py [2026]
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
PLANILHA = Path(r"C:\Users\andre\Desktop\contas\contabilidade total\CONTABILADE_Consolidada_atualizada.xlsx")


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
    url = env.get("VITE_SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    apikey = env.get("VITE_SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")
    if not url or not apikey:
        sys.exit("Faltam VITE_SUPABASE_URL/ANON_KEY no .env.local")
    email = env.get("SUPABASE_EMAIL") or os.environ.get("SUPABASE_EMAIL") or input("E-mail do usuário dono (Supabase): ").strip()
    senha = os.environ.get("SUPABASE_SENHA") or getpass.getpass("Senha: ")
    status, resp = rest(
        f"{url}/auth/v1/token?grant_type=password",
        apikey, apikey, "POST",
        {"email": email, "password": senha},
    )
    if status not in (200, 201) or not isinstance(resp, dict) or not resp.get("access_token"):
        sys.exit(f"Falha no login ({status}): {resp}")
    return url, apikey, resp["access_token"]


def segunda_da_semana_iso(data):
    """Segunda-feira ISO da semana civil de `data` (dt.date)."""
    seg = data - dt.timedelta(days=data.isoweekday() - 1)
    return seg.isoformat()


def semana_trabalho_da_data(data):
    """Convenção do app/planilha: o pagamento paga a semana civil ANTERIOR."""
    return segunda_da_semana_iso(data - dt.timedelta(days=7))


def semana_trabalho_da_linha(l):
    """Bucket do relatório para a linha: semana_trabalho quando presente (as
    duas colunas), senão a semana trabalhada derivada da data (convenção do app).
    Devolve a segunda-feira ISO como chave."""
    ano = l.get("ano_semana_trabalho")
    semana = l.get("semana_trabalho")
    if ano and semana:
        try:
            # segunda-feira ISO da semana `semana` do ano `ano`
            primeira_seg = segunda_da_semana_iso(dt.date(int(ano), 1, 4))
            seg = dt.date.fromisoformat(primeira_seg) + dt.timedelta(days=(int(semana) - 1) * 7)
            return seg.isoformat()
        except Exception:
            return semana_trabalho_da_data(dt.date.fromisoformat(l["data_prevista"]))
    return semana_trabalho_da_data(dt.date.fromisoformat(l["data_prevista"]))


def ler_planilha(ano):
    """Valor TOTAL por semana trabalhada (data − 7 dias) no ano dado."""
    try:
        import openpyxl  # noqa: PLC0415
    except Exception:
        return None
    wb = openpyxl.load_workbook(PLANILHA, data_only=True, read_only=True)
    ws = wb["Entradas Consolidadas"]
    saldo = {}
    for linha in ws.iter_rows(min_row=2, values_only=True):
        data, valor_semanal, he, acordo, outros, valor_total, desc, sem, mes, ano_l = linha[:10]
        if not data or not valor_total:
            continue
        d = getattr(data, "date", lambda: data)()
        if d.year != ano:
            continue
        chave = semana_trabalho_da_data(d)
        saldo[chave] = saldo.get(chave, 0) + float(valor_total)
    return saldo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ano", nargs="?", default=str(dt.date.today().year))
    args = ap.parse_args()
    ano = int(args.ano)
    ini, fim = f"{ano}-01-01", f"{ano}-12-31"

    env = carregar_env()
    url, apikey, token = login_supabase(env)

    st, rows = rest(
        f"{url}/rest/v1/planejamentos?"
        f"select=data_prevista,descricao,valor,tipo_op,estado,origem,ano_semana_trabalho,semana_trabalho"
        f"&data_prevista=gte.{ini}&data_prevista=lte.{fim}&order=data_prevista",
        apikey, token,
    )
    if st != 200:
        sys.exit(f"Falha na consulta planejamentos ({st}): {rows}")
    plan_hist = [p for p in rows or [] if p.get("origem") == "historico_planilha"]
    plan_jorn = [p for p in (rows or []) if p.get("origem") == "jornada"]
    plan_outro = [p for p in (rows or []) if p.get("origem") not in ("historico_planilha", "jornada")]

    st, excs = rest(
        f"{url}/rest/v1/ponto_excecoes?select=data,tipo,he,valor_he,valor_domfer&data=gte.{ini}&data=lte.{fim}&order=data",
        apikey, token,
    )
    if st != 200:
        sys.exit(f"Falha na consulta ponto_excecoes ({st}): {excs}")

    st, cfg = rest(f"{url}/rest/v1/ponto_config?order=atualizado_em.desc&limit=1", apikey, token)
    if st != 200:
        cfg = None
    st2, feriados = rest(f"{url}/rest/v1/ponto_feriados?select=data,nome&order=data", apikey, token)
    if st2 != 200:
        feriados = []

    print("=" * 100)
    print("1) PLANEJAMENTOS 2026 — cru (o que o relatório pode usar)")
    print("=" * 100)
    for p in rows or []:
        w = p.get("ano_semana_trabalho"), p.get("semana_trabalho")
        print(
            f"{p.get('data_prevista')} R$ {float(p.get('valor') or 0):10.2f} "
            f"origem={p.get('origem'):17} estado={p.get('estado'):9} "
            f"wk_trab={w!s:14} {p.get('descricao') or ''}"
        )

    print()
    print("=" * 100)
    print("2) EXCEÇÕES DO PONTO 2026 (valorHe/valorDomfer entram nos extras)")
    print("=" * 100)
    for e in excs or []:
        print(
            f"{e.get('data')} tipo={e.get('tipo'):7} he={e.get('he') or 0:6} "
            f"valorHe=R$ {float(e.get('valor_he') or 0):8.2f} "
            f"valorDomfer=R$ {float(e.get('valor_domfer') or 0):8.2f}"
        )

    print()
    print("PONTO_CONFIG (fixo semanal vigente):", (cfg or [None])[0] if isinstance(cfg, list) and cfg else cfg)
    print("FERIADOS 2026:", [(f.get('data'), f.get('nome')) for f in feriados or []])

    print()
    print("=" * 100)
    print("3) POR SEMANA DE TRABALHO (chave = segunda-feira ISO)")
    print("=" * 100)
    planilha = ler_planilha(ano)
    semanas = sorted(
        set(
            list(planilha.keys())
            + [semana_trabalho_da_linha(p) for p in rows or []]
            + [segunda_da_semana_iso(dt.date.fromisoformat(e["data"]) - dt.timedelta(days=7)) for e in excs or []]
        )
    )
    print(f"{'semana (trab.)':16} | {'planilha':>12} | {'realizado':>12} | {'extras':>10} | {'sóPrevis':>10}")
    for s in semanas:
        soma_real = sum(float(p.get("valor") or 0) for p in rows or [] if p.get("estado") == "realizado" and semana_trabalho_da_linha(p) == s)
        soma_prev = sum(float(p.get("valor") or 0) for p in rows or [] if p.get("estado") == "previsto" and semana_trabalho_da_linha(p) == s)
        soma_ext = sum(
            (float(e.get("valor_he") or 0) + float(e.get("valor_domfer") or 0))
            for e in excs or []
            if segunda_da_semana_iso(dt.date.fromisoformat(e["data"])) == s
        )
        print(
            f"{s:16} | {(planilha or {}).get(s, 0):12.2f} | {soma_real:12.2f} | {soma_ext:10.2f} | {soma_prev:10.2f}"
        )

    print()
    print("=" * 100)
    print("4) LANÇAMENTOS POR SEMANA DIVERGENTE (17/08, 24/08 e 31/08 TRABALHADA)")
    print("=" * 100)
    for s in ["2026-08-17", "2026-08-24", "2026-08-31"]:
        print(f"-- semana trabalhada {s} --")
        for p in rows or []:
            if semana_trabalho_da_linha(p) != s:
                continue
            print(
                f"   data={p.get('data_prevista')} R$ {float(p.get('valor') or 0):10.2f} "
                f"origem={p.get('origem'):17} estado={p.get('estado'):9} "
                f"wk_trab=({p.get('ano_semana_trabalho')},{p.get('semana_trabalho')}) "
                f"{p.get('descricao') or ''}"
            )

    print()
    print("-" * 100)
    print("Legenda: planilha = VALOR TOTAL por semana TRABALHADA | realizado = o que")
    print("o relatório soma hoje (com a semana trabalhada quando há coluna, senão a")
    print("semana trabalhada derivada da data) | extras = parte do realizado (HE+dom/fer),")
    print("nunca somada por cima | sóPrevis = jornada/outros ainda previstos na semana.")
    print("Meça: semana 24/08 deve mostrar planilha 2130 = realizado 2130 + extras 480.")


if __name__ == "__main__":
    main()