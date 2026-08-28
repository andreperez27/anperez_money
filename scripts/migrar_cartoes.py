#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
migrar_cartoes.py — Migração do histórico de CARTÃO DE CRÉDITO do banco SQLite
antigo para o módulo cartões do Supabase (app novo).

SEM dependências externas (só stdlib): sqlite3 + urllib contra a API REST do
Supabase (PostgREST), autenticando como o USUÁRIO DONO (respeita RLS).

GARANTIAS IMPORTANTES
---------------------
- NUNCA escreve no banco antigo (dados.db) — leitura só (mode=ro).
- NUNCA toca em contas, movimentações ou saldos. Faturas JÁ PAGAS do histórico
  são importadas com movimentacao_id = null e origem_pagamento = 'migracao_sem_conta'
  (a fatura fica 'paga' e o limite é liberado sem movimentação bancária).
- A fatura ainda ABERTA (mais recente, sem pagamento no app antigo) é importada
  normalmente (status 'aberta'), já que o app novo assume a gestão dela.
- Valida a soma das parcelas vs o valor pago registrado por fatura; se não
  bater, NÃO grava aquela fatura e registra no relatório de inconsistências.
- --dry-run (PADRÃO) não grava nada; só imprime o relatório. Só --aplicar grava.

MODOS
-----
  1) RELATÓRIO (padrão, não grava nada):
       .venv\\Scripts\\python.exe scripts\\migrar_cartoes.py --dry-run
  2) APLICAR de verdade (faz backup, limpa dados de teste, migra):
       .venv\\Scripts\\python.exe scripts\\migrar_cartoes.py --aplicar

CREDENCIAIS: VITE_SUPABASE_URL/ANON_KEY do .env.local + SUPABASE_EMAIL/SENHA
(ou --email/--senha). Pede interativamente se não estiverem definidas.

FLAGS
-----
  --db CAMINHO        banco SQLite de origem (default: o do André)
  --dry-run           (padrão) só relatório, não grava
  --aplicar           faz backup, limpa dados de teste e migra de verdade
  --backup-dir        onde salvar o backup (default: scripts/backups)
  --relatorio         saída do relatório md (default: scripts/relatorio_migracao_cartoes.md)
  --sim               pula a confirmação antes de gravar
  --email / --senha   credenciais do dono
"""

from __future__ import annotations

import argparse
import getpass
import json
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PROJETO = Path(__file__).resolve().parents[1]
DEFAULT_DB = Path(r"C:\Users\andre\Desktop\contas\contabilidade total\App financeiro\dados.db")
ENV_LOCAL = PROJETO / ".env.local"
DEFAULT_RELATORIO = PROJETO / "scripts" / "relatorio_migracao_cartoes.md"
DEFAULT_BACKUP_DIR = PROJETO / "scripts" / "backups"

# Tolerância de centavos na validação de soma de parcelas vs valor pago.
CENT_1 = 0.011

# Seguro Mapfre lançado como compra parcelada no app antigo. As parcelas que
# ainda estão ABERTAS (não pagas) serão geridas no app novo como PLANEJAMENTO
# PARCELADO (já criado na aba planejamento em 02/09/2026) — por isso são
# excluídas da migração de cartão. As parcelas já pagas permanecem no histórico.
SEGURO_MAPFRE = "mapfre"


# ---------------------------------------------------------------------------
# Leitura do banco antigo (SOMENTE LEITURA)
# ---------------------------------------------------------------------------


def ler_banco_antigo(caminho_db: Path):
    con = sqlite3.connect(f"file:{caminho_db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    cartoes = [dict(r) for r in cur.execute("SELECT * FROM cartoes ORDER BY id")]
    despesas = [dict(r) for r in cur.execute("SELECT * FROM despesas_cartao ORDER BY id")]
    faturas_pagas = [dict(r) for r in cur.execute("SELECT * FROM faturas_pagas ORDER BY id")]
    con.close()
    return {"cartoes": cartoes, "despesas": despesas, "faturas_pagas": faturas_pagas}


def norm_nome(nome):
    """Normaliza nome de cartão para casamento: minúsculo, sem espaços/
    pontuação/acentos e removendo o prefixo 'cc' (ex.: 'CC Nu PJ' → 'nupj')."""
    if nome is None:
        return ""
    s = re.sub(r"[^a-z0-9]", "", str(nome).lower())
    if s.startswith("cc"):
        s = s[2:]
    # remove prefixos 'nu'/'nubank' quando sobram (ex.: 'CC NU PF' -> 'nupf')
    for pref in ("nubank", "nu"):
        if s.startswith(pref):
            s = s[len(pref):]
            break
    return s


def parse_parcela(texto):
    """'1/10' -> (1, 10); 'à vista'/None -> (1, 1)."""
    if not texto:
        return (1, 1)
    t = str(texto).strip()
    m = re.match(r"^\s*(\d+)\s*/\s*(\d+)\s*$", t)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return (1, 1)


def mes_para_novo(mes_antigo):
    """'05/2024' -> '2024-05'."""
    if not mes_antigo:
        return None
    t = str(mes_antigo).strip()
    m = re.match(r"^(\d{1,2})/(\d{4})$", t)
    if m:
        return f"{m.group(2)}-{int(m.group(1)):02d}"
    m = re.match(r"^(\d{4})-(\d{2})$", t)  # já no formato novo
    if m:
        return t
    return None


def agrupar_compras(dados):
    """Agrupa linhas de despesas_cartao (1 por parcela) em compras.

    Uma compra = conjunto de parcelas que compartilham (id_cartao, data,
    descricao, denominador). Devolve dict: { (id_cartao, data, descricao, denom):
    {cartao_id, data, descricao, valor_total, n_parcelas, parcelas:[...]} }
    por cartão: agrupados por id_cartao.
    """
    grupos = {}
    for d in dados["despesas"]:
        num, denom = parse_parcela(d.get("parcela"))
        mes = mes_para_novo(d.get("mes_fatura"))
        # Compra à vista (denom=1): cada linha é UMA compra independente, mesmo
        # que compartilhe data+descricao com outra (ex.: duas 'à vista' do mesmo
        # dia/estabelecimento com valores diferentes). Usamos o id da linha como
        # discriminante para não agrupá-las.
        if denom == 1:
            chave = (d["id_cartao"], str(d.get("data") or ""), (d.get("descricao") or "").strip(), denom, d["id"])
        else:
            chave = (d["id_cartao"], str(d.get("data") or ""), (d.get("descricao") or "").strip(), denom)
        g = grupos.setdefault(chave, {
            "cartao_id": d["id_cartao"],
            "data": str(d.get("data") or ""),
            "descricao": (d.get("descricao") or "").strip(),
            "n_parcelas": denom,
            "parcelas": [],
        })
        g["parcelas"].append({
            "numero": num,
            "mes_fatura": mes,
            "valor": float(d.get("valor") or 0),
        })

    for g in grupos.values():
        g["parcelas"].sort(key=lambda p: p["numero"])
        g["valor_total"] = round(sum(p["valor"] for p in g["parcelas"]), 2)
    return grupos


def faturas_por_cartao(dados):
    """Conjunto de meses pagos por cartão (id_cartao -> set de 'YYYY-MM')."""
    por = {}
    for f in dados["faturas_pagas"]:
        mes = mes_para_novo(f.get("mes_fatura"))
        if not mes:
            continue
        por.setdefault(f["id_cartao"], set()).add(mes)
    return por


def meses_de_parcelas(compras, cartao_id):
    """Todos os meses com parcela para o cartão (para achar a fatura aberta)."""
    meses = set()
    for g in compras.values():
        if g["cartao_id"] != cartao_id:
            continue
        for p in g["parcelas"]:
            if p["mes_fatura"]:
                meses.add(p["mes_fatura"])
    return meses


def excluir_estornos(dados):
    """Remove lançamentos de CRÉDITO/estorno (valor negativo) e a compra positiva
    que eles anulam, para casar com o schema novo (compras só com valor > 0).

    Contexto do app antigo (dívidas/créditos de fatura):
      - 'Pagamento recebido antecipado'  (negativo)  → cancela a compra de mesmo
        valor no mesmo mês (ex.: -599,98 anula 'Lojas Mel Shop Abc' +599,98).
      - 'Encerramento de dívida'          (negativo)  → desconto da fatura, lançado
        em contraposição aos 'Juros de dívida encerrada' (positivo) do mesmo mês.

    Regra: para cada linha negativa, exclui também a sua contrapartida positiva:
      - 'pagamento recebido antecipado' → casa por |valor| igual no mesmo
        (id_cartao, mes_fatura).
      - 'encerramento de dívida'        → casa com a linha 'juros de dívida
        encerrada' do mesmo (id_cartao, mes_fatura).

    Assim as faturas pagas continuam com soma de parcelas ≈ valor pago real.
    Excluir ANTES do agrupamento em compras.
    """
    linhas = dados["despesas"]
    por_mes = {}  # (id_cartao, mes) -> lista de linhas
    for d in linhas:
        mes = mes_para_novo(d.get("mes_fatura"))
        if mes:
            por_mes.setdefault((d["id_cartao"], mes), []).append(d)

    def normaliza(s):
        return re.sub(r"[^a-z0-9]", "", (s or "").lower())

    marcadas = set()
    for d in linhas:
        valor = float(d.get("valor") or 0)
        if valor >= 0:
            continue
        mes = mes_para_novo(d.get("mes_fatura"))
        if not mes:
            continue
        desc = normaliza(d.get("descricao"))
        grupo = por_mes.get((d["id_cartao"], mes), [])
        alvo = None
        if "pagamentorecebidoantecipado" in desc:
            # casamento por |valor| igual no mesmo mês
            alvo = next((x for x in grupo
                         if x is not d and abs(float(x.get("valor") or 0) - abs(valor)) < CENT_1),
                        None)
        elif "encerramentodedvida" in desc:
            # casamento com 'juros de dívida encerrada' (sem acento pós-normalização)
            alvo = next((x for x in grupo
                         if x is not d and "jurosdedvidaencerrada" in normaliza(x.get("descricao"))),
                        None)
            if alvo is None:
                # fallback: |valor| aproximado
                alvo = next((x for x in grupo
                             if x is not d and abs(float(x.get("valor") or 0) - abs(valor)) < 0.02),
                            None)
        if alvo is not None:
            marcadas.add(id(d))
            marcadas.add(id(alvo))
            print(f"  [estorno] excluído par: '{d.get('descricao')}' ({valor}) ↔ "
                  f"'{alvo.get('descricao')}' ({alvo.get('valor')}) — mês {mes}")

    if marcadas:
        dados["despesas"] = [d for d in linhas if id(d) not in marcadas]
    return len(marcadas) // 2


def excluir_mapfre_abertas(dados):
    """Remove as parcelas ABERTAS (não pagas) do seguro Mapfre do cartão.

    O seguro Mapfre foi lançado no app antigo como compra parcelada no cartão.
    No app novo essas parcelas ainda em aberto passam a ser geridas como
    PLANEJAMENTO PARCELADO (já criado na aba planejamento), então são excluídas
    da migração do cartão. As parcelas já pagas permanecem no histórico do cartão
    para as faturas pagas continuarem fechando.

    Devolve o total de parcelas excluídas.
    """
    pagas_por_cartao = faturas_por_cartao(dados)
    restantes = []
    removidos = 0
    for d in dados["despesas"]:
        desc = (d.get("descricao") or "").strip()
        eh_mapfre = SEGURO_MAPFRE in desc.lower()
        mes = mes_para_novo(d.get("mes_fatura"))
        pago = bool(mes) and mes in pagas_por_cartao.get(d["id_cartao"], set())
        if eh_mapfre and mes and not pago:
            removidos += 1
            continue
        restantes.append(d)
    dados["despesas"] = restantes
    if removidos:
        print(f"  [seguro Mapfre] excluídas {removidos} parcelas ABERTAS do cartão "
              f"(virão a ser planejamento parcelado no app novo); as já pagas permanecem no histórico.")
    return removidos


# ---------------------------------------------------------------------------
# Supabase REST (reuso do padrão do script de contas)
# ---------------------------------------------------------------------------


def carregar_env():
    """Lê VITE_SUPABASE_URL/ANON_KEY (e SUPABASE_EMAIL/SENHA se houver) do .env.local."""
    env = {}
    if ENV_LOCAL.exists():
        for linha in ENV_LOCAL.read_text(encoding="utf-8", errors="replace").splitlines():
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, _, valor = linha.partition("=")
            env[chave.strip()] = valor.strip().strip('"').strip("'")
    return env


def rest(url, apikey, token, metodo="GET", corpo=None, prefer=None):
    req = urllib.request.Request(url, method=metodo)
    req.add_header("apikey", apikey)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    if prefer:
        req.add_header("Prefer", prefer)
    data = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=60) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        return e.code, raw[:500]


def login_supabase(env, email=None, senha=None, confirmar=True):
    url = env.get("VITE_SUPABASE_URL") or input("VITE_SUPABASE_URL: ").strip()
    apikey = env.get("VITE_SUPABASE_ANON_KEY") or input("VITE_SUPABASE_ANON_KEY: ").strip()
    if not url or not apikey:
        sys.exit("Sem VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY no .env.local do projeto.")
    email = email or env.get("SUPABASE_EMAIL") or os_environ("SUPABASE_EMAIL")
    senha = senha or env.get("SUPABASE_SENHA") or os_environ("SUPABASE_SENHA")
    if not email:
        email = input("E-mail do usuário dono (Supabase): ").strip()
    if not senha:
        senha = getpass.getpass("Senha do usuário: ")
    status, resp = rest(
        f"{url}/auth/v1/token?grant_type=password", apikey, apikey, "POST",
        {"email": email, "password": senha},
    )
    if status not in (200, 201) or not isinstance(resp, dict) or not resp.get("access_token"):
        print(f"[erro] falha no login ({status}): {resp}")
        sys.exit(1)
    print(f"  ok, autenticado como {resp.get('user', {}).get('email')}")
    user_id = (resp.get('user') or {}).get('id')
    return url, apikey, resp["access_token"], user_id


import os as _os


def os_environ(k):
    return _os.environ.get(k)


# ---------------------------------------------------------------------------
# Montagem do plano de migração (lógica pura — usada por dry-run e aplicar)
# ---------------------------------------------------------------------------


def montar_plano(dados, match_cartoes, conta_por_cartao):
    """match_cartoes: dict id_cartao_antigo -> uuid_do_cartao_no_supabase.
    conta_por_cartao: dict uuid_do_cartao_no_supabase -> conta_id (origem).

    Devolve por cartão: {cartao_uuid, nome_novo, limite_antigo, dias,
    faturas_pagas:[{mes_fatura, valor_pago, data_pagamento, ok, motivo}],
    faturas_abertas:[mes...], compras:[{...parcelas...}], inconsistencias:[],
    soma_total, n_parcelas}.
    """
    compras = agrupar_compras(dados)
    pagas_por_cartao = faturas_por_cartao(dados)
    plano = {}
    for id_antigo, uuid_novo in match_cartoes.items():
        carto = next((c for c in dados["cartoes"] if c["id"] == id_antigo), None)
        if carto is None:
            continue
        cc = {
            "cartao_antigo": carto["id"],
            "cartao_uuid": uuid_novo,
            "conta_origem_id": conta_por_cartao.get(uuid_novo),
            "nome_antigo": carto.get("nome"),
            "limite_antigo": float(carto.get("limite") or 0),
            "dia_fechamento": carto.get("dia_fechamento"),
            "dia_vencimento": carto.get("dia_vencimento"),
            "compras": [],
            "faturas_pagas": [],
            "faturas_abertas": [],
            "inconsistencias": [],
            "n_parcelas_total": 0,
            "soma_compras": 0.0,
            "soma_paga": 0.0,
        }
        # compras do cartão
        for g in compras.values():
            if g["cartao_id"] != id_antigo:
                continue
            cc["compras"].append(g)
            cc["n_parcelas_total"] += len(g["parcelas"])
            cc["soma_compras"] = round(cc["soma_compras"] + g["valor_total"], 2)

        # faturas pagas
        pagas = pagas_por_cartao.get(id_antigo, set())
        for f in dados["faturas_pagas"]:
            if f["id_cartao"] != id_antigo:
                continue
            mes = mes_para_novo(f.get("mes_fatura"))
            if not mes:
                continue
            soma_parcelas = sum(
                p["valor"]
                for g in cc["compras"]
                for p in g["parcelas"]
                if p["mes_fatura"] == mes
            )
            valor_pago = float(f.get("valor_pago") or 0)
            ok = abs(soma_parcelas - valor_pago) < CENT_1
            if not ok:
                cc["inconsistencias"].append({
                    "mes_fatura": mes,
                    "valor_pago": valor_pago,
                    "soma_parcelas": round(soma_parcelas, 2),
                })
            cc["faturas_pagas"].append({
                "mes_fatura": mes,
                "valor_pago": valor_pago,
                "data_pagamento": str(f.get("data_pagamento") or ""),
                "ok": ok,
            })
            if ok:
                cc["soma_paga"] = round(cc["soma_paga"] + valor_pago, 2)

        # faturas abertas = meses com parcela e sem pagamento registrado
        todos_meses = meses_de_parcelas(compras, id_antigo)
        cc["faturas_abertas"] = sorted(todos_meses - set(pagas))
        # mas só abrimos as MESES QUE AINDA ESTÃO EM ABERTO (mais recentes).
        # Sem pagamento = aberta por definição. Mantemos todas sem pagamento.

        venc = cc["dia_vencimento"]
        pl = plano
        pl[id_antigo] = cc
    return plano


# ---------------------------------------------------------------------------
# Relatório/impressão
# ---------------------------------------------------------------------------


def imprimir_dry_run(plano, dados):
    print("\n" + "=" * 60)
    print("RELATÓRIO DRY-RUN — MIGRAÇÃO DE CARTÕES")
    print("=" * 60)
    print(f"Cartões no banco antigo: {len([c for c in dados['cartoes']])}")
    print(f"Compras agrupadas (todas os cartões): {len(agrupar_compras(dados))}")
    print(f"Linhas de parcelas (despesas_cartao): {len(dados['despesas'])}")
    print(f"Faturas pagas registradas (faturas_pagas): {len(dados['faturas_pagas'])}")

    total_faturas = total_compras = total_parcelas = 0
    total_soma = 0.0
    total_inc = 0
    for id_ant, cc in sorted(plano.items()):
        print("\n" + "-" * 60)
        print(f"Cartão antigo: {cc['nome_antigo']} (limite {cc['limite_antigo']:,.2f} "
              f"fecha {cc['dia_fechamento']} vence {cc['dia_vencimento']})")
        print(f"  → Supabase uuid: {cc['cartao_uuid']}")
        n_pagas_ok = sum(1 for f in cc["faturas_pagas"] if f["ok"])
        print(f"  Faturas PAGAS a migrar (sem conta): {n_pagas_ok}")
        for f in cc["faturas_pagas"]:
            if f["ok"]:
                print(f"    • {f['mes_fatura']}  pago {f['valor_pago']:,.2f}  em {f['data_pagamento']}")
        print(f"  Faturas ABERTAS (mantidas): {', '.join(cc['faturas_abertas']) or 'nenhuma'}")
        print(f"  Compras: {len(cc['compras'])} | Parcelas: {cc['n_parcelas_total']} | Soma compras: {cc['soma_compras']:,.2f}")
        if cc["inconsistencias"]:
            print(f"  ⚠ INCONSISTÊNCIAS ({len(cc['inconsistencias'])}):")
            for i in cc["inconsistencias"]:
                print(f"      {i['mes_fatura']}: soma parcelas {i['soma_parcelas']:,.2f} ≠ valor pago {i['valor_pago']:,.2f}")
            total_inc += len(cc["inconsistencias"])
        total_faturas += n_pagas_ok
        total_compras += len(cc["compras"])
        total_parcelas += cc["n_parcelas_total"]
        total_soma += cc["soma_compras"]

    print("\n" + "=" * 60)
    print("TOTAIS")
    print(f"  Faturas pagas a migrar: {total_faturas}")
    print(f"  Compras: {total_compras} | Parcelas: {total_parcelas}")
    print(f"  Soma total dos valores das compras: R$ {total_soma:,.2f}")
    print(f"  Inconsistências de valor: {total_inc}")
    print("=" * 60)
    print("(modo DRY-RUN — nada foi gravado no Supabase)")


# ---------------------------------------------------------------------------
# Backup / limpeza / aplicação
# ---------------------------------------------------------------------------


def consultar(url, apikey, token, path):
    s, r = rest(f"{url}/rest/v1/{path}", apikey, token)
    if s != 200:
        raise RuntimeError(f"consulta {path}: {s} {r}")
    return r


def realizar_backup(url, apikey, token, backup_dir: Path):
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dados = {}
    for t in ("cartoes", "compras", "parcelas", "fatura_pagamentos"):
        dados[t] = consultar(url, apikey, token, f"{t}?select=*&limit=10000")
    arquivo = backup_dir / f"backup_cartoes_{ts}.json"
    arquivo.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  backup gravado: {arquivo}")
    return arquivo


def limpar_dados_teste(url, apikey, token, cartoes_uuid, sim):
    """Apaga compras (cascata parcelas) e fatura_pagamentos dos cartões novos.
    NÃO toca em cartoes, contas, movimentações nem saldos."""
    total_c = total_fp = 0
    for uuid in cartoes_uuid:
        # fatura_pagamentos primeiro (referencia cartao; nada de movimentação)
        s, r = rest(f"{url}/rest/v1/fatura_pagamentos?cartao_id=eq.{uuid}", apikey, token, "DELETE")
        if s not in (200, 204):
            print(f"    [erro] limpando fatura_pagamentos do cartão {uuid} ({s}): {r}")
        else:
            total_fp += 1
        # compras (cascateia parcelas)
        s, r = rest(f"{url}/rest/v1/compras?cartao_id=eq.{uuid}", apikey, token, "DELETE")
        if s not in (200, 204):
            print(f"    [erro] limpando compras do cartão {uuid} ({s}): {r}")
        else:
            total_c += 1
    print(f"  dados de teste limpos (compras={total_c}, fatura_pagamentos={total_fp})")


def aplicar_cartao(url, apikey, token, user_id, cc):
    """Insere compras/parcelas/fatura_pagamentos de UM cartão. Só chamado após
    pré-validação (dry-run) — aqui não há movimentação/conta. Idempotente."""
    criadas = 0
    ids_compras = []
    # compras + parcelas
    for g in cc["compras"]:
        s, r = rest(f"{url}/rest/v1/compras", apikey, token, "POST",
                    prefer="return=representation",
                    corpo={
                        "user_id": user_id,
                        "cartao_id": cc["cartao_uuid"],
                        "data": g["data"],
                        "descricao": g["descricao"],
                        "valor_total": g["valor_total"],
                        "n_parcelas": g["n_parcelas"],
                    })
        compra_id = None
        if s in (200, 201):
            compra_id = (r[0]["id"] if isinstance(r, list) and r else (r or {}).get("id"))
        if not compra_id:
            print(f"    [erro] criando compra {g['descricao']} ({s}): {r}")
            continue
        ids_compras.append(compra_id)
        for p in g["parcelas"]:
            if not p["mes_fatura"]:
                continue
            s2, r2 = rest(f"{url}/rest/v1/parcelas", apikey, token, "POST",
                          corpo={
                              "user_id": user_id,
                              "compra_id": compra_id,
                              "numero": p["numero"],
                              "total": g["n_parcelas"],
                              "valor": p["valor"],
                              "mes_fatura": p["mes_fatura"],
                          })
            if s2 in (200, 201):
                criadas += 1
            else:
                print(f"    [erro] parcela {p['numero']}/{g['n_parcelas']} ({s2}): {r2}")
    # faturas pagas (somente as ok)
    for f in cc["faturas_pagas"]:
        if not f["ok"]:
            continue
        s, r = rest(f"{url}/rest/v1/fatura_pagamentos", apikey, token, "POST",
                    corpo={
                        "user_id": user_id,
                        "cartao_id": cc["cartao_uuid"],
                        "mes_fatura": f["mes_fatura"],
                        "valor_pago": f["valor_pago"],
                        "data_pagamento": f["data_pagamento"] or None,
                        "movimentacao_id": None,
                        "conta_origem_id": cc["conta_origem_id"],
                        "origem_pagamento": "migracao_sem_conta",
                    })
        if s in (200, 201):
            pass
        else:
            print(f"    [erro] fatura paga {f['mes_fatura']} ({s}): {r}")
    return criadas, len(ids_compras)


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="Migração do histórico de cartões (SQLite → Supabase).")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--dry-run", action="store_true", help="só relatório, não grava (padrão)")
    parser.add_argument("--aplicar", action="store_true", help="faz backup, limpa testes e migra")
    parser.add_argument("--backup-dir", type=Path, default=DEFAULT_BACKUP_DIR)
    parser.add_argument("--relatorio", type=Path, default=DEFAULT_RELATORIO)
    parser.add_argument("--sim", action="store_true", help="não confirma antes de gravar")
    parser.add_argument("--email")
    parser.add_argument("--senha")
    args = parser.parse_args()

    if not args.db.exists():
        sys.exit(f"Banco não encontrado: {args.db}")

    if not args.aplicar:
        args.dry_run = True

    print(f"=== ANÁLISE (somente leitura) — {args.db} ===")
    dados = ler_banco_antigo(args.db)
    if not dados["cartoes"]:
        sys.exit("Nenhum cartão no banco antigo.")

    excluir_mapfre_abertas(dados)
    excluir_estornos(dados)

    env = carregar_env()
    url, apikey, token, user_id = login_supabase(env, args.email, args.senha, confirmar=not args.dry_run)

    # Cartões novos (Supabase) para casar com os antigos
    cartoes_sb = consultar(url, apikey, token, "cartoes?select=id,nome,limite,dia_fechamento,dia_vencimento,conta_id,ativo&order=nome.asc")
    print("\nCartões cadastrados no app novo (Supabase):")
    for c in cartoes_sb:
        print(f"  {c['id']}  {c['nome']:<14} limite={float(c['limite']):,.2f} fecha={c['dia_fechamento']} vence={c['dia_vencimento']} ativo={c['ativo']}")

    # Casamento por nome normalizado
    sb_por_norm = {norm_nome(c["nome"]): c for c in cartoes_sb}
    match = {}
    divergencias_cadastro = []
    for c in dados["cartoes"]:
        cand = sb_por_norm.get(norm_nome(c["nome"]))
        if cand is None:
            # tenta por apelido conhecido
            cand = sb_por_norm.get(norm_nome("Nu " + c["nome"])) or sb_por_norm.get(norm_nome(c["nome"].replace("Nu ", "")))
        if cand is None:
            print(f"\n[aviso] cartão antigo '{c['nome']}' não encontrado no app novo — pulado.")
            continue
        match[c["id"]] = cand["id"]
        # divergências de CADASTRO (reportar, não alterar)
        difs = []
        if abs(float(c.get("limite") or 0) - float(cand.get("limite") or 0)) > 0.001:
            difs.append(f"limite antigo {c['limite']} ≠ novo {cand['limite']}")
        if int(c.get("dia_fechamento")) != int(cand.get("dia_fechamento")):
            difs.append(f"fechamento antigo {c['dia_fechamento']} ≠ novo {cand['dia_fechamento']}")
        if int(c.get("dia_vencimento")) != int(cand.get("dia_vencimento")):
            difs.append(f"vencimento antigo {c['dia_vencimento']} ≠ novo {cand['dia_vencimento']}")
        if difs:
            divergencias_cadastro.append((c["nome"], difs))
            print(f"\n[divergência de cadastro] {c['nome']}: {', '.join(difs)} — NÃO ALTERADO (reportado)")

    print("\n=== DIVERGÊNCIAS DE CADASTRO (limite/dias) ===")
    if divergencias_cadastro:
        for nome, difs in divergencias_cadastro:
            print(f"  {nome}: {', '.join(difs)}")
    else:
        print("  Nenhuma divergência — cadastros dos cartões batem com o app antigo.")

    if not match:
        sys.exit("\nNenhum cartão antigo casou com os do app novo — interrompendo.")

    conta_por_cartao = {c["id"]: c["conta_id"] for c in cartoes_sb}
    plano = montar_plano(dados, match, conta_por_cartao)
    imprimir_dry_run(plano, dados)

    if args.dry_run:
        # grava relatório md de referência (não toca no banco)
        gerar_relatorio_md(plano, dados, args.relatorio, divergencias_cadastro)
        print(f"\nRelatório (referência, sem gravação) em {args.relatorio}")
        print("\nNada foi gravado. Para aplicar de verdade: scripts\\migrar_cartoes.py --aplicar")
        return

    # ---------------- APLICAR ----------------
    if not args.sim:
        if input("\nVai APLICAR: backup + limpar dados de teste + migrar no Supabase. Confirmar? [s/N] ").strip().lower() != "s":
            print("Cancelado. Nada foi alterado.")
            return

    print("\n=== BACKUP ===")
    realizar_backup(url, apikey, token, args.backup_dir)

    print("\n=== LIMPANDO DADOS DE TESTE (compras/parcelas/faturas) ===")
    limpar_dados_teste(url, apikey, token, list(match.values()), args.sim)

    print("\n=== MIGRANDO ===")
    totais = {"compras": 0, "parcelas": 0, "fatura_pagamentos": 0}
    for id_ant, cc in sorted(plano.items()):
        print(f"  Cartão: {cc['nome_antigo']}")
        nparc, ncomp = aplicar_cartao(url, apikey, token, user_id, cc)
        totais["parcelas"] += nparc
        totais["compras"] += ncomp
        totais["fatura_pagamentos"] += sum(1 for f in cc["faturas_pagas"] if f["ok"])

    print("\n=== RESUMO DA APLICAÇÃO ===")
    print(f"  Compras criadas: {totais['compras']}")
    print(f"  Parcelas criadas: {totais['parcelas']}")
    print(f"  Faturas pagas (migracao_sem_conta): {totais['fatura_pagamentos']}")
    gerar_relatorio_md(plano, dados, args.relatorio, divergencias_cadastro)
    print(f"\nRelatório final em {args.relatorio}")


def gerar_relatorio_md(plano, dados, caminho: Path, divergencias_cadastro):
    linhas = []
    ad = linhas.append
    ad("# Relatório de migração — cartões de crédito (app antigo → Supabase)")
    ad("")
    ad(f"- Gerado em: {datetime.now():%d/%m/%Y %H:%M}")
    ad(f"- Banco analisado: `{DEFAULT_DB}`")
    ad("")
    ad("## Divergências de cadastro (limite/dias)")
    ad("")
    if divergencias_cadastro:
        for nome, difs in divergencias_cadastro:
            ad(f"- **{nome}**: {', '.join(difs)} (não alterado — reportado)")
    else:
        ad("_Nenhuma — cadastros batem._")
    ad("")

    ad("## Plano por cartão")
    ad("")
    ad("| Cartão antigo | Faturas pagas | Faturas abertas | Compras | Parcelas | Soma compras | Inconsistências |")
    ad("| --- | --- | --- | --- | --- | --- | --- |")
    for id_ant, cc in sorted(plano.items()):
        ad(f"| {cc['nome_antigo']} | {sum(1 for f in cc['faturas_pagas'] if f['ok'])} "
           f"| {', '.join(cc['faturas_abertas']) or '—'} | {len(cc['compras'])} | {cc['n_parcelas_total']} "
           f"| {cc['soma_compras']:,.2f} | {len(cc['inconsistencias'])} |")
    ad("")
    ad("## Inconsistências de valor (soma parcelas ≠ valor pago)")
    for id_ant, cc in sorted(plano.items()):
        for i in cc["inconsistencias"]:
            ad(f"- {cc['nome_antigo']} {i['mes_fatura']}: soma parcelas {i['soma_parcelas']:,.2f} ≠ valor pago {i['valor_pago']:,.2f} (não gravada)")
    ad("")
    ad("## Observações")
    ad("- Faturas pagas do histórico entram com `origem_pagamento='migracao_sem_conta'` e `movimentacao_id=null` — **não tocam em contas/movimentações/saldos**.")
    ad("- A fatura aberta (sem pagamento no app antigo) entra como `aberta`, gerida pelo app novo daqui pra frente.")
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text("\n".join(linhas), encoding="utf-8")


if __name__ == "__main__":
    main()
