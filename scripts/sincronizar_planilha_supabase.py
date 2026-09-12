#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
sincronizar_planilha_supabase.py — Escreve os recebimentos do APP na
CONTABILADE_Consolidada_atualizada.xlsx PRESERVANDO as abas de Tabelas
Dinâmicas/Slicer (Excel COM com fallback openpyxl).

Adaptação do script antigo do app de horas (sincronizar_planilha.py) para a
arquitetura nova aprovada pelo André:

  Node  (gerar_recebidos_planilha.mjs)  → busca no Supabase e grava um JSON
                                           intermediário (recebidos do app a
                                           partir de 24/08/2026, com data real,
                                           valor, fixo e extras da semana);
  Python (ESTE arquivo)                  → lê esse JSON, DEDUPLICA contra a
                                           planilha por (data, valor) e ESCREVE
                                           só as linhas novas na aba "Entradas
                                           Consolidadas", via Excel COM (preserva
                                           pivôs/tabelas) com fallback openpyxl.

Diferenças em relação ao script antigo (decisões 11/09/2026):
  • FONTE: JSON intermediário do Supabase, NÃO o SQLite dados.db;
  • NÃO REMOVE hista: a planilha é o arquivo oficial e guarda o histórico prévio
    (2022..semana 33/2026) que NÃO vem do app — o script só ADICIONA as linhas
    que faltam (idempotente por (data, valor));
  • Além de adicionar, REPARA a planilha: (a) remove linhas DUPLICADAS internas
    (mesma data + mesmo valor, mantendo a primeira) e (b) normaliza a descrição
    das linhas existentes para o padrão "Pagamento referente ao período de
    17/08/26 à 23/08/26" quando o JSON traz a versão padrão;
  • Como o app é a fonte a partir de 24/08/2026 (corte 05/09/2026), linhas do
    JSON com data < corte não são gravadas (defensivo): elas já estariam na
    planilha;
  • Colunas gravadas (mesmo leiaute do script antigo): A=Data, B=VALOR SEMANAL
    (fixo da semana), C=HorasExtras, F=VALOR TOTAL, G=DESCRIÇÃO, H=SEMANAS (nº
    ISO), I=Mês (pt minúsculo), J=Ano. D (Acordo) e E (Outros) ficam em branco
    (são históricos que não vêm do app).

USO:
  python scripts/sincronizar_planilha_supabase.py [PLANILHA] [JSON] [DESTINO_DIR]

  PLANILHA    planilha base (default: testes\CONTABILADE_Consolidada.xlsx)
  JSON        arquivo intermediário gerado pelo Node
              (default: scripts\recebidos_para_planilha.json)
  DESTINO_DIR pasta de saída (default: C:/Users/andre/Desktop/contas/contabilidade total)

O arquivo gravado é sempre <stem>_atualizada.xlsx no DESTINO_DIR (mesmo nome
do app antigo e da planilha que o André já usa). Se o _atualizada existir, ele
é a base de leitura (continuação); senão, parte da planilha base.

O Python precisa de openpyxl e — para preservar os pivôs — win32com (pywin32)
com o Excel instalado. Sem COM, cai no fallback openpyxl.
"""

import json
import re
import shutil
import sys
import unicodedata
import warnings
from copy import copy
from datetime import datetime, date
from pathlib import Path

from openpyxl import load_workbook

warnings.filterwarnings("ignore", message="Slicer List extension is not supported")
warnings.filterwarnings("ignore", message="Data Validation extension is not supported")

_USA_COM = False
try:
    import win32com.client
    import pythoncom
    _USA_COM = True
except ModuleNotFoundError:
    pass

ABA = "Entradas Consolidadas"
CORTE_2026 = "2026-08-24"
MESES_PT = {1: "janeiro", 2: "fevereiro", 3: "março", 4: "abril", 5: "maio", 6: "junho", 7: "julho", 8: "agosto", 9: "setembro", 10: "outubro", 11: "novembro", 12: "dezembro"}

DEFAULT_PLANILHA = Path(r"C:\Users\andre\Desktop\contas\testes\CONTABILADE_Consolidada.xlsx")
DEFAULT_JSON = Path(__file__).resolve().parent / "recebidos_para_planilha.json"
DEFAULT_DESTINO_DIR = Path(r"C:/Users/andre/Desktop/contas/contabilidade total")


def normalizar(texto):
    return unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")


def corrigir_crasis(texto):
    return re.sub(r"(\d{2}/\d{2}/\d{2}) a (\d{2}/\d{2}/\d{2})", lambda m: m.group(1) + " \u00e0 " + m.group(2), texto)


def chave_linha(ws, r):
    """Chave de deduplicação: (data, valor Total arredondado) — o valor é o
    que identifica de fato o recebimento (a descrição pode variar entre o
    padrão da planilha e os textos livres do app, o que causava duplicatas)."""
    data_cell = ws.cell(r, 1).value
    valor_cell = ws.cell(r, 6).value
    if data_cell is None:
        return None
    if isinstance(data_cell, datetime):
        data_str = data_cell.strftime("%Y-%m-%d")
    elif isinstance(data_cell, date):
        data_str = data_cell.isoformat()
    else:
        data_str = str(data_cell)
    try:
        valor = round(float(str(valor_cell).replace(".", "").replace(",", ".")) if isinstance(valor_cell, str) else float(valor_cell), 2)
    except (TypeError, ValueError):
        return None
    return (data_str, valor)


def carregar_existentes(ws):
    """Linhas JÁ presentes na planilha (>= corte — as anteriores são história
    fixa do arquivo). Só linhas com data a partir de 24/08/2026 interessam para
    a deduplicação das linhas novas do app.

    Devolve (mapa, duplicadas):
      mapa       chave -> linha (a primeira ocorrência, a mantida);
      duplicadas lista de linhas extras com a mesma chave (a remover)."""
    mapa = {}
    duplicadas = []
    for r in range(2, ws.max_row + 1):
        k = chave_linha(ws, r)
        if k is None:
            continue
        try:
            dt = datetime.strptime(k[0], "%Y-%m-%d").date()
        except ValueError:
            continue
        if dt >= date.fromisoformat(CORTE_2026):
            if k in mapa:
                duplicadas.append(r)
            else:
                mapa[k] = r
    return mapa, duplicadas


def copiar_formatacao(ws, row_dest, row_ref):
    for col in range(1, 11):
        src = ws.cell(row_ref, col)
        dst = ws.cell(row_dest, col)
        dst.font = copy(src.font)
        dst.border = copy(src.border)
        dst.alignment = copy(src.alignment)
        dst.fill = copy(src.fill)
        dst.number_format = src.number_format


def _validar_xlsx(caminho):
    try:
        wbv = load_workbook(caminho, read_only=True)
        wbv.close()
        return True
    except Exception:
        return False


def ler_json(arquivo: Path):
    """Lê o JSON intermediário gerado pelo Node.

    Formato esperado:
      { "gerado_em", "corte", "fixo_semana", "recebidos": [
          { "data": "YYYY-MM-DD", "valor": float, "valor_fixo": float|null,
            "hora_extras": float, "descricao": str } ] }
    Cada item vira um "pagamento" no mesmo shape do antigo script (data,
    valor_total, hora_extras, descricao, valor_fixo). Linhas com data < corte
    são ignoradas (defensivo — não deveriam existir)."""
    if not arquivo.exists():
        sys.exit(f"JSON intermediário não encontrado: {arquivo}")
    with open(arquivo, encoding="utf-8") as f:
        payload = json.load(f)

    pagamentos = []
    for it in payload.get("recebidos") or []:
        data_str = str(it.get("data") or "").strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", data_str):
            continue
        if data_str < CORTE_2026:
            continue
        desc_raw = str(it.get("descricao") or "").strip()
        vf = it.get("valor_fixo")
        valor_total = round(float(it.get("valor") or 0), 2)
        pagamentos.append({
            "chave": (data_str, valor_total),
            "data_str": data_str,
            "data": datetime.strptime(data_str, "%Y-%m-%d"),
            "valor_total": valor_total,
            "valor_fixo": round(float(vf), 2) if vf is not None else None,
            "hora_extras": round(float(it.get("hora_extras") or 0), 2),
            "descricao": corrigir_crasis(desc_raw),
        })
    return pagamentos


def main():
    planilha = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PLANILHA
    arquivo_json = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_JSON
    destino_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_DESTINO_DIR

    if not planilha.exists():
        sys.exit(f"Planilha não encontrada: {planilha}")

    destino = destino_dir / (planilha.stem + "_atualizada.xlsx")
    print("Planilha origem : " + str(planilha))
    print("Fonte (JSON)    : " + str(arquivo_json))
    print("Aba             : " + ABA)
    print("Destino         : " + str(destino))

    fonte = destino if destino.exists() else planilha
    print("Lendo de        : " + str(fonte))
    try:
        wb = load_workbook(fonte)
    except Exception:
        if fonte != planilha and planilha.exists():
            print("AVISO: arquivo atualizado ilegível (corrompido).")
            print("Acao : descartando e recriando a partir da planilha origem...")
            try:
                destino.unlink()
            except OSError:
                pass
            fonte = planilha
            wb = load_workbook(fonte)
        else:
            sys.exit(f"Falha ao abrir a planilha: {fonte}")
    if ABA not in wb.sheetnames:
        sys.exit(f"Aba '{ABA}' nao encontrada.")
    ws = wb[ABA]

    pagamentos = ler_json(arquivo_json)
    sheet_map, duplicadas = carregar_existentes(ws)
    novos = [p for p in pagamentos if p["chave"] not in sheet_map]

    # Correção de descrição: se uma linha existente tem a MESMA data+valor mas
    # a descrição difere do padrão do JSON, normalizamos a célula G.
    corrigir = []
    for p in pagamentos:
        linha = sheet_map.get(p["chave"])
        if linha is None:
            continue
        atual = ws.cell(linha, 7).value or ""
        if str(atual).strip() != p["descricao"]:
            corrigir.append((linha, p["descricao"]))

    print(f"Registros na planilha (>= {CORTE_2026}): {len(sheet_map)}")
    print(f"Registros no JSON (>= {CORTE_2026})   : {len(pagamentos)}")
    print(f"A adicionar                          : {len(novos)}")
    print(f"A corrigir (descricao)               : {len(corrigir)}")
    print(f"Duplicadas a remover                 : {len(duplicadas)}")
    if duplicadas:
        for r in duplicadas:
            print(f"  - remover linha {r}: {ws.cell(r, 1).value} | R$ {ws.cell(r, 6).value}")
    print()
    wb.close()

    if not novos and not corrigir and not duplicadas:
        if not destino.exists():
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(planilha.resolve()), str(destino.resolve()))
        print("Nenhuma alteracao necessaria.")
        print(f"Arquivo: {destino}")
        return 0

    destino.parent.mkdir(parents=True, exist_ok=True)

    sucesso_com = False
    if _USA_COM:
        pythoncom.CoInitialize()
        excel = None
        wb_com = None
        try:
            excel = win32com.client.Dispatch("Excel.Application")
            excel.Visible = False
            excel.DisplayAlerts = False
            wb_com = excel.Workbooks.Open(str(fonte.resolve()))
            ws_com = wb_com.Sheets(ABA)

            # 1) Normaliza a descricao das linhas existentes (célula G).
            for linha, desc in corrigir:
                ws_com.Cells(linha, 7).Value = desc
                print(f"  ~ Corrigida descricao na linha {linha}")

            # 2) Remove duplicatas internas (de baixo para cima p/ nao
            #    deslocar as linhas ainda nao processadas).
            for r in sorted(duplicadas, reverse=True):
                ws_com.Rows(r).Delete()
                print(f"  - Removida duplicata na linha {r}")

            # 3) Adiciona as linhas novas no fim da area (respeitando a tabela).
            last_row = ws_com.UsedRange.Rows.Count
            for t in ws_com.ListObjects:
                if t.DataBodyRange:
                    last_row = max(last_row, t.DataBodyRange.Row + t.DataBodyRange.Rows.Count - 1)
            for pag in novos:
                r = last_row + 1
                ws_com.Cells(r, 1).Value = pag["data"]
                if pag["valor_fixo"]:
                    ws_com.Cells(r, 2).Value = pag["valor_fixo"]
                ws_com.Cells(r, 3).Value = pag["hora_extras"]
                ws_com.Cells(r, 6).Value = pag["valor_total"]
                ws_com.Cells(r, 7).Value = pag["descricao"]
                ws_com.Cells(r, 8).Value = pag["data"].isocalendar()[1]
                ws_com.Cells(r, 9).Value = MESES_PT[pag["data"].month]
                ws_com.Cells(r, 10).Value = pag["data"].year
                for t in ws_com.ListObjects:
                    if t.DataBodyRange:
                        data_end = t.DataBodyRange.Row + t.DataBodyRange.Rows.Count - 1
                        if r > data_end:
                            new_ref = ws_com.Range(t.Range.Address, ws_com.Cells(r, t.Range.Columns.Count))
                            t.Resize(new_ref)
                print(f"  + Linha {r}: {pag['data'].strftime('%d/%m/%Y')}  |  R$ {pag['valor_total']:.2f}  |  {pag['descricao'][:55]}")
                last_row = r
            wb_com.SaveAs(str(destino.resolve()), ConflictResolution=2)
            wb_com.Close(SaveChanges=False)
            wb_com = None
            sucesso_com = _validar_xlsx(destino)
            if not sucesso_com:
                print("AVISO: arquivo salvo pelo Excel nao passou na validacao.")
        except Exception as e:
            print(f"AVISO: Excel COM falhou ({e}). Usando openpyxl...")
        finally:
            try:
                if wb_com is not None:
                    wb_com.Close(SaveChanges=False)
            except Exception:
                pass
            if excel is not None:
                excel.Quit()
            pythoncom.CoUninitialize()

    if not sucesso_com:
        wb = load_workbook(fonte)
        ws = wb[ABA]
        for linha, desc in corrigir:
            ws.cell(linha, 7).value = desc
            print(f"  ~ Corrigida descricao na linha {linha}")
        for r in sorted(duplicadas, reverse=True):
            ws.delete_rows(r, 1)
            print(f"  - Removida duplicata na linha {r}")
        prox_linha = ws.max_row + 1
        while prox_linha > 2 and ws.cell(prox_linha - 1, 1).value is None:
            prox_linha -= 1
        for i, pag in enumerate(novos):
            r = prox_linha + i
            copiar_formatacao(ws, r, prox_linha - 1)
            ws.cell(r, 1).value = pag["data"]
            ws.cell(r, 2).value = pag["valor_fixo"] if pag["valor_fixo"] else None
            ws.cell(r, 3).value = pag["hora_extras"]
            ws.cell(r, 6).value = pag["valor_total"]
            ws.cell(r, 7).value = pag["descricao"]
            ws.cell(r, 8).value = pag["data"].isocalendar()[1]
            ws.cell(r, 9).value = MESES_PT[pag["data"].month]
            ws.cell(r, 10).value = pag["data"].year
            for tname in list(ws.tables):
                t = ws.tables[tname]
                m = re.match(r"^([A-Z]+)(\d+):([A-Z]+)(\d+)$", t.ref)
                if m and int(m.group(4)) < ws.max_row:
                    t.ref = f"{m.group(1)}{m.group(2)}:{m.group(3)}{ws.max_row}"
            print(f"  + Linha {r}: {pag['data'].strftime('%d/%m/%Y')}  |  R$ {pag['valor_total']:.2f}  |  {pag['descricao'][:55]}")
        try:
            wb.save(destino)
        except Exception as e:
            sys.exit(f"Falha ao salvar {destino}: {e}")
        wb.close()
        if not _validar_xlsx(destino):
            sys.exit(f"Arquivo salvo esta corrompido: {destino}")

    print(f"\n{len(novos)} adicionada(s).")
    print(f"Arquivo salvo: {destino}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        import traceback
        print("\n=== ERRO INESPERADO ===")
        traceback.print_exc()
        sys.exit(1)