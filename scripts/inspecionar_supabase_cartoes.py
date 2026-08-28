# -*- coding: utf-8 -*-
"""Inspecao SOMENTE-LEITURA do modulo cartoes no Supabase (anon -> owner via login). Nao escreve nada."""
import getpass
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PROJETO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJETO / "scripts"))
from migrar_dados_antigos import carregar_env, rest  # noqa: E402

env = carregar_env()
url = env.get("VITE_SUPABASE_URL")
apikey = env.get("VITE_SUPABASE_ANON_KEY")
if not url or not apikey:
    sys.exit("Sem VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY no .env.local")

email = env.get("SUPABASE_EMAIL") or os.environ.get("SUPABASE_EMAIL") or input("mail do usuario dono: ").strip()
senha = env.get("SUPABASE_SENHA") or os.environ.get("SUPABASE_SENHA") or getpass.getpass("Senha: ")

status, resp = rest(f"{url}/auth/v1/token?grant_type=password", apikey, apikey, "POST",
                    {"email": email, "password": senha})
if status not in (200, 201) or not isinstance(resp, dict) or not resp.get("access_token"):
    print(f"[erro] login ({status}): {resp}")
    sys.exit(1)
token = resp["access_token"]
print(f"ok, autenticado como {resp.get('user', {}).get('email')}\n")

def q(path):
    s, r = rest(f"{url}/rest/v1/{path}", apikey, token)
    if s != 200:
        print(f"[erro] {path}: {s} {r}")
        return None
    return r

print("=== CARTOES ===")
cartoes = q("cartoes?select=id,nome,limite,dia_fechamento,dia_vencimento,ativo,conta_id&order=nome.asc")
if cartoes is not None:
    for c in cartoes:
        print("  ", c)

print("\n=== COMPRAS ===")
compras = q("compras?select=id,cartao_id,data,descricao,valor_total,n_parcelas,ativa&order=data.asc&limit=2000")
if compras is not None:
    print("  total:", len(compras))
    for c in compras:
        print("  ", c)

print("\n=== PARCELAS ===")
parcelas = q("parcelas?select=id,compra_id,numero,total,valor,mes_fatura&limit=5000")
if parcelas is not None:
    print("  total:", len(parcelas))
    for p in parcelas[:80]:
        print("  ", p)

print("\n=== FATURA_PAGAMENTOS ===")
fps = q("fatura_pagamentos?select=id,cartao_id,mes_fatura,valor_pago,data_pagamento,movimentacao_id&order=mes_fatura.asc&limit=2000")
if fps is not None:
    print("  total:", len(fps))
    for f in fps:
        print("  ", f)

print("\n=== CONTAS (para mapear conta_id) ===")
contas = q("contas?select=id,nome,tipo,ativa&order=nome.asc")
if contas is not None:
    for c in contas:
        print("  ", c)
