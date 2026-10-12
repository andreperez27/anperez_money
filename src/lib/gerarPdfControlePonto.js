// ============================================================================
// PDF DA ABA "CONTROLE DE PONTO" (Relatórios) — versão RESUMIDA
// ============================================================================
// Mesmo padrão visual dos PDFs do app (jsPDF + autotable, cabeçalho escuro
// ANPEREZ MONEY). Resumo + duas listas curtas (faltas, horas extras) +
// bloco do banco. Sem tabela dia a dia, sem bloco semanal, sem futuro
// projetado — igual à tela.
//
// ENCODING: fontes padrão do jsPDF só cobrem Latin-1 — nada de → (use "as"),
// − (use hífen ASCII), –/— ou qualquer codepoint acima de U+00FF. A função
// limparPdf() garante no fim (troca o que passar).
// ============================================================================

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatoReal, formatarData } from './compartilhados.js'
import { formatarDuracaoHMin } from './pontoCalc.js'

const MARGEM = 14
const LARGURA = 210
const COR_BRAND_ESCURA = [23, 37, 84]
const COR_TEXTO = [30, 41, 59]
const COR_CLARO = [107, 114, 128]

// Faixa Latin-1 imprimível (sem controles): troca o resto por '?'.
export function limparPdf(texto) {
  return String(texto ?? '').replace(/[^\x20-\xFF\n]/g, '?')
}

function dataCivilHoje() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function rotuloData(dataISO) {
  return `${dataISO.slice(8, 10)}/${dataISO.slice(5, 7)}`
}

function rotuloFalta(d) {
  return `Falta (${d.faltaIntegral ? 'integral' : 'parcial'}) - ${d.faltaDestino ?? ''}`
}

function rotuloExtra(d) {
  const base = d.situacao === 'he-pagamento' || d.situacao === 'he-banco'
    ? `HE (${d.situacao === 'he-banco' ? 'banco' : 'pagamento'})`
    : `Dom/fer (${d.situacao === 'domfer-banco' ? 'banco' : 'pagamento'})`
  return d.agendada ? `${base} - agendada` : base
}

export function montarPdfControlePonto({ periodo, dados }) {
  const doc = new jsPDF()
  const { resumo: r, banco, dias } = dados

  doc.setFillColor(...COR_BRAND_ESCURA)
  doc.rect(0, 0, LARGURA, 26, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(limparPdf('ANPEREZ MONEY'), MARGEM, 11)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(191, 219, 254)
  doc.text(limparPdf(`Controle de ponto - gerado em ${dataCivilHoje()}`), MARGEM, 18)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...COR_TEXTO)
  doc.text(limparPdf('Controle de ponto'), MARGEM, 36)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COR_CLARO)
  doc.text(
    limparPdf(`${formatarData(periodo.inicio)} - ${formatarData(periodo.fim)} - somente leitura, sem projeção`),
    MARGEM,
    42,
  )

  let y = 48
  const tabela = (titulo, head, body) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...COR_BRAND_ESCURA)
    doc.text(limparPdf(titulo), MARGEM, y)
    y += 2
    autoTable(doc, {
      startY: y,
      margin: { left: MARGEM, right: MARGEM },
      theme: 'grid',
      head: [head.map(limparPdf)],
      body: body.map((linha) => linha.map(limparPdf)),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: COR_BRAND_ESCURA, textColor: 255, fontStyle: 'bold', fontSize: 8 },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // --- Resumo ---
  const pct = r.carga.pct !== null && r.carga.pct !== undefined
    ? `${r.carga.pct.toFixed(1).replace('.', ',')}%`
    : '-'
  const faltasHorasMin = r.faltas.pagamento.minutos + r.faltas.banco.minutos + r.faltas.abonada.minutos
  tabela('Resumo', ['Carga cumprida', 'Faltas (p/b/a)', 'HE pagas', 'Dom/fer', 'Banco'], [[
    `${r.carga.cumprida}h de ${r.carga.prevista}h (${pct})`,
    `${r.faltas.pagamento.qtd}/${r.faltas.banco.qtd}/${r.faltas.abonada.qtd} - ${formatarDuracaoHMin(faltasHorasMin)}`,
    `${r.hePagasHoras}h - ${formatoReal.format(r.hePagasValor)}`,
    `${r.domferPagosDias} dia(s) - ${formatoReal.format(r.domferPagosValor)}`,
    `${formatarDuracaoHMin(banco.saldoFim)} (${banco.variacao >= 0 ? '+' : ''}${formatarDuracaoHMin(banco.variacao)}) - início ${formatarDuracaoHMin(banco.saldoInicio)}`,
  ]])

  // --- Faltas ---
  const faltasLista = dias.filter((d) => String(d.situacao).startsWith('falta-'))
  tabela(
    'Faltas do período',
    ['Data', 'Tipo', 'Horas', 'Status', 'Motivo'],
    faltasLista.length === 0
      ? [['nenhuma falta no período', '', '', '', '']]
      : faltasLista.map((d) => [
        `${rotuloData(d.data)} ${d.diaSemana}${d.agendada ? ' (agendada)' : ''}`,
        rotuloFalta(d),
        formatarDuracaoHMin(d.faltaMinutos),
        d.faltaDestino === 'banco'
          ? (banco.fifoPorData.get(d.data) === 'compensada' ? 'Compensada' : 'Pendente')
          : '-',
        d.obs ?? '',
      ]),
  )

  // --- Horas extras (inclui dom/fer) ---
  const extrasLista = dias.filter((d) =>
    d.situacao === 'he-pagamento' || d.situacao === 'he-banco' ||
    d.situacao === 'domfer-pagamento' || d.situacao === 'domfer-banco',
  )
  const horasTxt = (d) => (d.situacao === 'he-pagamento' || d.situacao === 'he-banco'
    ? `${d.situacao === 'he-pagamento' ? d.hePagaHoras : d.bancoHoras}h`
    : `${Number(d.horas || 0).toFixed(2).replace('.', ',')}h`)
  const horaTxt = (d) => (d.entrada && d.saida ? `${d.entrada} as ${d.saida}` : '-')
  const valorTxt = (d) => {
    const pago = d.situacao === 'he-pagamento' || d.situacao === 'domfer-pagamento'
    if (!pago) return '-'
    return formatoReal.format((d.hePagaValor || 0) + (d.domferValor || 0))
  }
  tabela(
    'Horas extras do período',
    ['Data', 'Tipo', 'Horário', 'Horas', 'Valor', 'Obs'],
    extrasLista.length === 0
      ? [['nenhuma hora extra no período', '', '', '', '', '']]
      : extrasLista.map((d) => [
        `${rotuloData(d.data)} ${d.diaSemana}${d.agendada ? ' (agendada)' : ''}`,
        rotuloExtra(d),
        horaTxt(d),
        horasTxt(d),
        valorTxt(d),
        d.obs ?? '',
      ]),
  )

  // --- Banco ---
  tabela('Banco de horas', ['Saldo início', 'Créditos', 'Débitos', 'Saldo fim', 'Variação'], [[
    formatarDuracaoHMin(banco.saldoInicio),
    `+${formatarDuracaoHMin(banco.creditosPeriodo)}`,
    `-${formatarDuracaoHMin(banco.debitosPeriodo)}`,
    formatarDuracaoHMin(banco.saldoFim),
    `${banco.variacao >= 0 ? '+' : ''}${formatarDuracaoHMin(banco.variacao)}`,
  ]])
  if (banco.faltas.length > 0) {
    tabela(
      'Faltas no banco (status all-time)',
      ['Data', 'Minutos', 'Acumulado', 'Status'],
      banco.faltas.map((f) => [
        `${f.data.slice(8, 10)}/${f.data.slice(5, 7)}${f.futura ? ' (agendada)' : ''}`,
        formatarDuracaoHMin(f.minutos),
        formatarDuracaoHMin(f.acumulado),
        f.status === 'compensada' ? 'Compensada' : 'Pendente',
      ]),
    )
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COR_CLARO)
  doc.text(
    limparPdf(`Emitido em ${dataCivilHoje()} via ANPEREZ MONEY - espelho de controle, sem valor fiscal`),
    MARGEM,
    287,
  )
  return doc
}

export function gerarPdfControlePonto(params) {
  const { previa = false, ...resto } = params ?? {}
  const doc = montarPdfControlePonto(resto)
  const sufixo = resto.periodo ? `${resto.periodo.inicio}-${resto.periodo.fim}` : 'periodo'
  const nomeArquivo = `controle-ponto-${sufixo}.pdf`
  if (previa) return { doc, nomeArquivo }
  doc.save(nomeArquivo)
}
