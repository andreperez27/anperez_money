// ============================================================================
// GERADOR DO RELATÓRIO MENSAL EM PDF (02/11/2026)
// ============================================================================
// Renderiza o "Relatório Mensal" (mesmo template acordado na avaliação do PDF
// de Setembro/2026) a partir dos dados JÁ calculados — não busca nada aqui.
// Os dados chegam prontos do hook useRelatorioMensal (app) ou do script
// scripts/gerar_relatorio_mensal.mjs (geração em lote pelo contador).
//
// Formato da entrada `dados`:
//   {
//     fluxo: { totalEntradas, totalDespesas, saldo, lancamentos },
//     resumoPonto: { diasTrabalhados, carga, hePagasHoras, hePagasValor,
//                    domferPagosDias, domferPagosValor, faltas },
//     receb: { totalRecebido, totalValorHorasExtras, recebimentos },
//     gastoCategoria: { linhas, total },
//     detalheCategoria: Map|objeto { categoria → [{data, descricao, valor, fonte}] },
//     faturas: [{ cartao, vencimento, valor, pago, restante, status }],
//     saldos: { contas:[{nome, saldo}], total },
//     caixinhas: [{ nome, saldo }],
//     totalCaixinhas, patrimonioTotal,
//   }
// ============================================================================
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatoReal, formatarData } from './compartilhados.js'

// Rotulo de semana (segunda ISO → "DD/MM a DD/MM"). Reimplementado aqui para
// não depender de exportar de semana.js (que não exporta esse helper).
function rotuloSemanaLocal(segundaISO) {
  // semana.js exporta semanaIso(inicio) → { inicio, fim }
  // import dinâmico não; reimplementa via Date aritmética (seg–dom).
  const ini = String(segundaISO)
  const d = new Date(`${ini}T00:00:00Z`)
  const dom = new Date(d.getTime() + 6 * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} a ${p(dom.getUTCDate())}/${p(dom.getUTCMonth() + 1)}`
}

const MARGEM = 14
const LARGURA = 210
const ALTURA = 297
const RODAPE = 18

const COR_BRAND = [66, 165, 245]
const COR_BRAND_ESCURA = [23, 37, 84]
const COR_VERDE = [21, 128, 61]
const COR_VERMELHA = [185, 28, 28]
const COR_TEXTO = [31, 41, 55]
const COR_CLARO = [75, 85, 99]
const COR_FUNDO_TABELA = [243, 244, 246]
const COR_AMARELA = [245, 158, 11]

const fmt = (v) => formatoReal.format(v)
const corDoSaldo = (v) => (v >= 0 ? COR_VERDE : COR_VERMELHA)

function secao(doc, texto, y) {
  doc.setFillColor(...COR_BRAND)
  doc.roundedRect(MARGEM, y, LARGURA - 2 * MARGEM, 9, 2, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(texto, MARGEM + 4, y + 6.1)
  doc.setFont('helvetica', 'normal')
  return y + 12
}

function estilosTabela() {
  return {
    margin: { left: MARGEM, right: MARGEM },
    theme: 'grid',
    headStyles: { fillColor: COR_BRAND_ESCURA, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    styles: { font: 'helvetica', fontSize: 9, textColor: COR_TEXTO, cellPadding: 2.6 },
    alternateRowStyles: { fillColor: COR_FUNDO_TABELA },
  }
}

function novaPaginaSeNecessario(doc, y, alturaNecessaria = 30) {
  if (y > ALTURA - RODAPE - alturaNecessaria) {
    doc.addPage()
    return MARGEM + 4
  }
  return y
}

function rodape(doc, geradoEm) {
  const totalPaginas = doc.getNumberOfPages()
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COR_CLARO)
    doc.text(`Página ${i} de ${totalPaginas}`, LARGURA - MARGEM, ALTURA - 10, { align: 'right' })
    doc.text(`Gerado pelo ANPEREZ MONEY em ${geradoEm}`, MARGEM, ALTURA - 10)
  }
}

function agoraRotulo() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function detalheDe(dados, categoria) {
  const dc = dados.detalheCategoria
  if (!dc) return []
  if (dc instanceof Map) return dc.get(categoria) ?? []
  return dc[categoria] ?? []
}

export function gerarPdfRelatorioMensal({ periodo, dados, previa = false }) {
  if (!periodo || !dados) {
    throw new Error('Informe período e dados para gerar o Relatório Mensal.')
  }
  const doc = new jsPDF()
  const NOME_MES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ]
  const [ano, mes] = String(periodo.inicio).slice(0, 7).split('-').map(Number)
  const tituloMes = `${NOME_MES[mes - 1]}/${ano}`
  const geradoEm = agoraRotulo()

  // Cabeçalho
  doc.setFillColor(...COR_BRAND_ESCURA)
  doc.rect(0, 0, LARGURA, 26, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('ANPEREZ MONEY', MARGEM, 11)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(191, 219, 254)
  doc.text(`Relatório Mensal · gerado em ${geradoEm}`, MARGEM, 18)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...COR_TEXTO)
  doc.text(`Relatório Mensal — ${NOME_MES[mes - 1]}/${ano}`, MARGEM, 36)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COR_CLARO)
  doc.text(`${formatarData(periodo.inicio)} – ${formatarData(periodo.fim)}`, MARGEM, 42)
  doc.setDrawColor(...COR_BRAND)
  doc.setLineWidth(0.8)
  doc.line(MARGEM, 45.5, LARGURA - MARGEM, 45.5)

  let y = 52

  // KPIs
  y = secao(doc, 'Resumo do mês', y)
  autoTable(doc, {
    ...estilosTabela(),
    startY: y,
    head: [['Entradas', 'Saídas', 'Resultado', 'Recebido', 'Extras']],
    body: [[
      { content: fmt(dados.fluxo.totalEntradas), styles: { halign: 'center', fontStyle: 'bold', textColor: COR_VERDE } },
      { content: fmt(dados.fluxo.totalDespesas), styles: { halign: 'center', fontStyle: 'bold', textColor: COR_VERMELHA } },
      { content: fmt(dados.fluxo.saldo), styles: { halign: 'center', fontStyle: 'bold', textColor: corDoSaldo(dados.fluxo.saldo) } },
      { content: fmt(dados.receb.totalRecebido), styles: { halign: 'center', fontStyle: 'bold', textColor: COR_VERDE } },
      { content: fmt(dados.receb.totalValorHorasExtras), styles: { halign: 'center', fontStyle: 'bold', textColor: COR_AMARELA } },
    ]],
  })
  y = doc.lastAutoTable.finalY + 12

  // Horas trabalhadas
  y = novaPaginaSeNecessario(doc, y)
  y = secao(doc, 'Horas trabalhadas', y)
  const rp = dados.resumoPonto
  const pctCarga = rp.carga.pct === null ? '—' : `${rp.carga.pct}%`
  autoTable(doc, {
    ...estilosTabela(),
    startY: y,
    head: [['Dias trab.', 'Carga cumprida', 'Carga prevista', 'HE pagas', 'HE pagas R$', 'Dom/Fer', 'Dom/Fer R$', 'Faltas']],
    body: [[
      String(rp.diasTrabalhados),
      `${rp.carga.cumprida}h`,
      `${rp.carga.prevista}h (${pctCarga})`,
      `${rp.hePagasHoras}h`,
      fmt(rp.hePagasValor),
      String(rp.domferPagosDias),
      fmt(rp.domferPagosValor),
      String(rp.faltas.pagamento.qtd + rp.faltas.banco.qtd + rp.faltas.abonada.qtd),
    ]],
  })
  y = doc.lastAutoTable.finalY + 12

  // Recebimentos
  y = novaPaginaSeNecessario(doc, y)
  y = secao(doc, 'Recebimentos', y)
  const recebimentos = dados.receb.recebimentos ?? []
  if (recebimentos.length === 0) {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Data', 'Referente', 'Valor', 'Extras']],
      body: [[{ content: 'Nenhum recebimento no período.', colSpan: 4, styles: { halign: 'center', textColor: COR_CLARO, fontStyle: 'italic' } }]],
    })
  } else {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Data', 'Referente', 'Valor', 'Extras']],
      body: recebimentos.map((r) => {
        let referente = r.descricao || '—'
        if (r.referente) {
          const fracao = Number.isFinite(Number(r.fracao)) ? Math.round(Number(r.fracao) * 100) : null
          referente = `Semana de ${rotuloSemanaLocal(r.referente)}${fracao !== null && fracao !== 100 ? ` (${fracao}%)` : ''}`
        }
        return [
          { content: formatarData(r.data), styles: { halign: 'center' } },
          referente,
          { content: fmt(r.valor), styles: { halign: 'right', fontStyle: 'bold' } },
          { content: fmt(r.valorHorasExtras), styles: { halign: 'right', textColor: r.valorHorasExtras > 0 ? COR_AMARELA : COR_CLARO } },
        ]
      }),
      showFoot: 'lastPage',
      foot: [[
        { content: 'Total', styles: { fontStyle: 'bold' } },
        { content: '', styles: {} },
        { content: fmt(dados.receb.totalRecebido), styles: { halign: 'right', fontStyle: 'bold', textColor: COR_VERDE } },
        { content: fmt(dados.receb.totalValorHorasExtras), styles: { halign: 'right', fontStyle: 'bold', textColor: COR_AMARELA } },
      ]],
      footStyles: { fillColor: COR_FUNDO_TABELA, textColor: COR_TEXTO },
    })
  }
  y = doc.lastAutoTable.finalY + 12

  // Movimentações (resumo)
  y = novaPaginaSeNecessario(doc, y)
  y = secao(doc, 'Movimentações', y)
  autoTable(doc, {
    ...estilosTabela(),
    startY: y,
    head: [['Tipo', 'Quantidade', 'Valor']],
    body: [
      ['Entradas', String(dados.fluxo.lancamentos.filter((l) => l.tipo === 'entrada').length), { content: fmt(dados.fluxo.totalEntradas), styles: { halign: 'right', textColor: COR_VERDE, fontStyle: 'bold' } }],
      ['Saídas', String(dados.fluxo.lancamentos.filter((l) => l.tipo === 'despesa').length), { content: fmt(dados.fluxo.totalDespesas), styles: { halign: 'right', textColor: COR_VERMELHA, fontStyle: 'bold' } }],
    ],
    showFoot: 'lastPage',
    foot: [[
      { content: 'Saldo do mês', styles: { fontStyle: 'bold' } },
      { content: '', styles: {} },
      { content: fmt(dados.fluxo.saldo), styles: { halign: 'right', fontStyle: 'bold', textColor: corDoSaldo(dados.fluxo.saldo) } },
    ]],
    footStyles: { fillColor: COR_FUNDO_TABELA, textColor: COR_TEXTO },
  })
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8.5)
  doc.setTextColor(...COR_CLARO)
  doc.text(
    'Fluxo real das contas: exclui transferências internas entre contas/caixinhas; inclui o pagamento das faturas do cartão (o dinheiro sai da conta no pagamento).',
    MARGEM, Math.min(doc.lastAutoTable.finalY + 5, ALTURA - RODAPE - 4),
  )
  y = doc.lastAutoTable.finalY + 12

  // Detalhamento — Entradas
  y = novaPaginaSeNecessario(doc, y)
  y = secao(doc, 'Detalhamento — Entradas', y)
  const entradasLista = dados.fluxo.lancamentos.filter((l) => l.tipo === 'entrada')
  autoTable(doc, {
    ...estilosTabela(),
    startY: y,
    head: [['Data', 'Descrição', 'Valor']],
    body:
      entradasLista.length === 0
        ? [[{ content: 'Nenhuma entrada no período.', colSpan: 3, styles: { halign: 'center', textColor: COR_CLARO, fontStyle: 'italic' } }]]
        : entradasLista.map((l) => [
            { content: formatarData(l.data), styles: { halign: 'center' } },
            l.descricao || 'Sem descrição',
            { content: fmt(l.valor), styles: { halign: 'right', textColor: COR_VERDE } },
          ]),
  })
  y = doc.lastAutoTable.finalY + 12

  // Detalhamento — Saídas por categoria (com subtotais)
  y = novaPaginaSeNecessario(doc, y, 50)
  y = secao(doc, 'Detalhamento — Saídas por categoria', y)
  {
    const body = []
    for (const linha of dados.gastoCategoria.linhas ?? []) {
      body.push([
        { content: `${linha.categoria} (${detalheDe(dados, linha.categoria).length})`, colSpan: 2, styles: { fontStyle: 'bold', fillColor: [226, 232, 240], textColor: COR_BRAND_ESCURA } },
      ])
      for (const l of detalheDe(dados, linha.categoria)) {
        body.push([
          { content: `   ${formatarData(l.data)} · ${l.fonte === 'compra' ? 'cartão' : 'conta'}`, styles: { textColor: COR_CLARO, fontSize: 8.5 } },
          { content: `${l.descricao || 'Sem descrição'}`, styles: { fontSize: 8.5 } },
          { content: fmt(l.valor), styles: { halign: 'right', fontSize: 8.5 } },
        ])
      }
    }
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Lançamento', 'Descrição', 'Valor']],
      body:
        body.length === 0
          ? [[{ content: 'Nenhuma saída no período.', colSpan: 3, styles: { halign: 'center', textColor: COR_CLARO, fontStyle: 'italic' } }]]
          : body,
      showFoot: 'lastPage',
      foot: [[
        { content: 'Total de saídas', styles: { fontStyle: 'bold' } },
        { content: '', styles: {} },
        { content: fmt(dados.gastoCategoria.total), styles: { halign: 'right', fontStyle: 'bold', textColor: COR_VERMELHA } },
      ]],
      footStyles: { fillColor: COR_FUNDO_TABELA, textColor: COR_TEXTO },
    })
  }
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8.5)
  doc.setTextColor(...COR_CLARO)
  doc.text(
    'Visão econômica do gasto: compras no cartão contam pela DATA DA COMPRA (e não no pagamento da fatura) — por isso o total difere das Movimentações.',
    MARGEM, Math.min(doc.lastAutoTable.finalY + 5, ALTURA - RODAPE - 4),
  )
  y = doc.lastAutoTable.finalY + 12

  // Faturas
  y = novaPaginaSeNecessario(doc, y, 50)
  y = secao(doc, `Faturas — ${tituloMes}`, y)
  const faturas = dados.faturas ?? []
  autoTable(doc, {
    ...estilosTabela(),
    startY: y,
    head: [['Cartão', 'Vencimento (dia útil)', 'Valor', 'Pago', 'Restante', 'Status']],
    body:
      faturas.length === 0
        ? [[{ content: 'Nenhuma fatura para o mês.', colSpan: 6, styles: { halign: 'center', textColor: COR_CLARO, fontStyle: 'italic' } }]]
        : faturas.map((f) => [
            f.cartao,
            { content: formatarData(f.vencimento), styles: { halign: 'center' } },
            { content: fmt(f.valor), styles: { halign: 'right', fontStyle: 'bold' } },
            { content: fmt(f.pago), styles: { halign: 'right' } },
            { content: fmt(f.restante), styles: { halign: 'right', textColor: f.restante > 0 ? COR_VERMELHA : COR_VERDE } },
            { content: f.status === 'paga' ? 'Paga' : f.status === 'parcialmente_paga' ? 'Parcial' : 'Em aberto', styles: { halign: 'center', textColor: f.status === 'paga' ? COR_VERDE : COR_VERMELHA, fontStyle: 'bold' } },
          ]),
    showFoot: 'lastPage',
    foot: [[
      { content: 'Total', styles: { fontStyle: 'bold' } },
      { content: '', styles: {} },
      { content: fmt(faturas.reduce((a, f) => a + f.valor, 0)), styles: { halign: 'right', fontStyle: 'bold' } },
      { content: fmt(faturas.reduce((a, f) => a + f.pago, 0)), styles: { halign: 'right', fontStyle: 'bold' } },
      { content: fmt(faturas.reduce((a, f) => a + f.restante, 0)), styles: { halign: 'right', fontStyle: 'bold', textColor: COR_VERMELHA } },
      { content: '', styles: {} },
    ]],
    footStyles: { fillColor: COR_FUNDO_TABELA, textColor: COR_TEXTO },
  })
  y = doc.lastAutoTable.finalY + 12

  // Saldos
  y = novaPaginaSeNecessario(doc, y, 60)
  y = secao(doc, `Saldos em ${formatarData(periodo.fim)}`, y)
  {
    const body = []
    for (const c of dados.saldos.contas ?? []) {
      body.push([
        c.nome,
        { content: c.saldo === null ? '—' : fmt(c.saldo), styles: { halign: 'right', textColor: c.saldo === null ? COR_CLARO : corDoSaldo(c.saldo) } },
      ])
    }
    if ((dados.saldos.contas ?? []).length > 0 && dados.saldos.total !== null) {
      body.push([
        { content: 'Total em contas', styles: { fontStyle: 'bold', fillColor: [226, 232, 240] } },
        { content: fmt(dados.saldos.total), styles: { halign: 'right', fontStyle: 'bold', fillColor: [226, 232, 240], textColor: corDoSaldo(dados.saldos.total) } },
      ])
    }
    for (const c of dados.caixinhas ?? []) {
      body.push([
        `Caixinha: ${c.nome}`,
        { content: fmt(Number(c.saldo) || 0), styles: { halign: 'right', textColor: corDoSaldo(Number(c.saldo) || 0) } },
      ])
    }
    if ((dados.caixinhas ?? []).length > 0) {
      body.push([
        { content: 'Total em caixinhas', styles: { fontStyle: 'bold', fillColor: [226, 232, 240] } },
        { content: fmt(dados.totalCaixinhas), styles: { halign: 'right', fontStyle: 'bold', fillColor: [226, 232, 240], textColor: corDoSaldo(dados.totalCaixinhas) } },
      ])
    }
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Conta / Caixinha', 'Saldo']],
      body,
      showFoot: 'lastPage',
      foot: [[
        { content: 'PATRIMÔNIO TOTAL', styles: { fontStyle: 'bold' } },
        { content: fmt(dados.patrimonioTotal), styles: { halign: 'right', fontStyle: 'bold', textColor: corDoSaldo(dados.patrimonioTotal), fontSize: 10.5 } },
      ]],
      footStyles: { fillColor: COR_BRAND_ESCURA, textColor: 255 },
    })
  }

  rodape(doc, geradoEm)

  const nomeArquivo = `relatorio_mensal_${ano}_${String(mes).padStart(2, '0')}.pdf`
  if (previa) return { doc, nomeArquivo }
  doc.save(nomeArquivo)
}