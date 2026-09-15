import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatoReal, formatarData, dataCivil } from './compartilhados.js'
import { calcularMesFatura } from './faturaPlanejamento.js'
import { vencimentoRealISO } from './diaUtil.js'
import { ordenarParcelasCronologicamente, textoParcela } from './faturaOrdenacao.js'

// ============================================================================
// FATURA DE CARTÃO EM PDF — extrato da fatura dentro de FaturaDetalhe
// ============================================================================
// FUNÇÃO PRÓPRIA com jsPDF direto, NÃO reaproveita gerarPdfRelatorio: o formato
// de fatura (Data | Descrição | Parcela | Valor + cabeçalho de cartão) é
// diferente do relatório consolidado.
// "Fatura fechada" = data de fechamento já passou, reaproveitando a MESMA
// lógica de mês de fatura do app (calcularMesFatura) — sem reimplementar
// comparação de data:
//
//   mesFaturaHoje = calcularMesFatura(hojeIso, dia_fechamento)
//   fechada = mesFaturaHoje > mes_fatura   (lexicográfico YYYY-MM)
//
// Fatura ABERTA ainda pode receber lançamentos até o fechamento; o PDF dela
// deixa explícito que é extrato parcial (data/hora de emissão + aviso) para
// não confundir dois PDFs da mesma fatura aberta gerados em dias diferentes.
// Fatura fechada = documento definitivo, sem aviso.
//
// Contrato: só leitura do que já está na tela (fatura, itens, cartão, limite) —
// não altera cálculo de fatura, limite ou parcelas, nem cria snapshot/tabela.
// ============================================================================

const MARGEM = 14
const LARGURA = 210
const ALTURA = 297

const AZUL = [66, 165, 245]
const AZUL_ESCURO = [23, 37, 84]
const CINZA_TEXTO = [107, 114, 128]
const CINZA_CLARO = [243, 244, 246]
const AMARELO_BG = [254, 249, 195]
const AMARELO_BORDA = [250, 204, 21]
const AMARELO_TEXTO = [133, 77, 14]

const NOME_MES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

// "2026-09" -> "Setembro/2026"
function competenciaLonga(mesFatura) {
  const [a, m] = String(mesFatura || '').split('-').map(Number)
  if (!a || !m) return mesFatura || '—'
  return `${NOME_MES[m - 1]}/${a}`
}

// Data de FECHAMENTO da competência: dia_fechamento clampado no mês da fatura.
// Mesma regra de clamp do SQL calcular_mes_fatura (least(dia, ultimo_dia)).
function fechamentoISO(mesFatura, diaFechamento) {
  const [ano, mes] = String(mesFatura || '').split('-').map(Number)
  const dia = Math.max(1, Number(diaFechamento) || 1)
  const ultimo = new Date(ano, mes, 0).getDate()
  const diaEf = Math.min(dia, ultimo)
  return `${ano}-${String(mes).padStart(2, '0')}-${String(diaEf).padStart(2, '0')}`
}

// Fatura fechada? Reaproveita calcularMesFatura (espelho do backend).
function ehFaturaFechada(mesFatura, diaFechamento, hojeIso) {
  if (!mesFatura || diaFechamento == null || !hojeIso) return false
  const mesHoje = calcularMesFatura(hojeIso, Number(diaFechamento))
  return mesHoje > mesFatura
}

function hojeIsoLocal() {
  return dataCivil(new Date())
}

function agoraDataHora() {
  const d = new Date()
  const data = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return { data, hora }
}

export function montarPdfFatura({
  cartao,
  fatura,
  itens = [],
  limiteDisponivel = null,
  feriados = [],
  hojeIso = null,
}) {
  if (!cartao || !fatura?.mes_fatura) {
    throw new Error('montarPdfFatura precisa de cartao e fatura.mes_fatura')
  }

  const mes = String(fatura.mes_fatura)
  const hoje = hojeIso || hojeIsoLocal()
  const fechada = ehFaturaFechada(mes, cartao.dia_fechamento, hoje)
  const { data: dataEmissao, hora: horaEmissao } = agoraDataHora()

  const fechISO = fechamentoISO(mes, cartao.dia_fechamento)
  const vencISO = vencimentoRealISO(mes, cartao.dia_vencimento, feriados)

  const doc = new jsPDF()

  // ---------- CABEÇALHO ----------
  doc.setFillColor(...AZUL_ESCURO)
  doc.rect(0, 0, LARGURA, 26, 'F')
  doc.setFillColor(...AZUL)
  doc.rect(0, 26, LARGURA, 1.2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('Fatura Cartão', MARGEM, 12)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(191, 219, 254)
  doc.text(`Cartão ${String(cartao.nome || '—').trim()} · Competência ${competenciaLonga(mes)}`, MARGEM, 19)

  // Linha de competência / fechamento / vencimento
  doc.setTextColor(30, 41, 59)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...CINZA_TEXTO)
  const competenciaCurta = mes.includes('-') ? `${mes.slice(5, 7)}/${mes.slice(0, 4)}` : mes
  doc.text(`Competência: ${competenciaCurta}`, MARGEM, 36)
  doc.text(`Fechamento: ${formatarData(fechISO)}`, MARGEM + 42, 36)
  doc.text(`Vencimento: ${formatarData(vencISO)}`, MARGEM + 84, 36)
  // Status à direita
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...(fechada ? [21, 128, 61] : [180, 83, 9]))
  doc.text(fechada ? 'FATURA FECHADA' : 'FATURA EM ABERTO', LARGURA - MARGEM, 36, { align: 'right' })
  doc.setFont('helvetica', 'normal')

  let y = 42

  // ---------- AVISO DE EXTRATO PARCIAL (só quando ABERTA) ----------
  if (!fechada) {
    const aviso = `Extrato parcial gerado em ${dataEmissao} às ${horaEmissao} — sujeito a novos lançamentos até o fechamento em ${formatarData(fechISO)}.`
    // Caixa amarela
    const linhas = doc.splitTextToSize(aviso, LARGURA - MARGEM * 2 - 8)
    const h = 6 + linhas.length * 4.5
    doc.setFillColor(...AMARELO_BG)
    doc.setDrawColor(...AMARELO_BORDA)
    doc.roundedRect(MARGEM, y, LARGURA - MARGEM * 2, h, 2, 2, 'FD')
    doc.setTextColor(...AMARELO_TEXTO)
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')
    doc.text(aviso, MARGEM + 4, y + 5, { maxWidth: LARGURA - MARGEM * 2 - 8 })
    doc.setFont('helvetica', 'normal')
    y += h + 6
  } else {
    y += 2
  }

  // ---------- TABELA DE LANÇAMENTOS ----------
  // Descrição limpa: multi-parcela genuína NÃO ganha "(i/n)" aqui — a coluna
  // Parc. já exibe a fração separadamente. Série de Planejamento já vem com
  // "(n/total)" no texto da compra (migration 37, n_parcelas=1) e é exibida
  // como gravada, sem duplicação. Ordenação reaproveita a mesma regra da tela.
  const itensOrdenados = ordenarParcelasCronologicamente(itens)
  const linhasTabela = itensOrdenados.map((parcela) => {
    const compra = parcela.compras ?? {}
    const dataRaw = String(compra.data || '')
    const dataFmt = dataRaw ? formatarData(dataRaw) : '—'
    const desc = String(compra.descricao || 'Compra no cartão').trim()
    const parc = textoParcela(parcela)
    const valorNum = Number(parcela.valor)
    return [dataFmt, desc, parc, formatoReal.format(valorNum)]
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...AZUL_ESCURO)
  doc.text('Lançamentos da fatura', MARGEM, y)
  y += 3

  const totalFatura = Number(fatura.valor_total ?? 0)

  if (linhasTabela.length === 0) {
    autoTable(doc, {
      startY: y + 1,
      margin: { left: MARGEM, right: MARGEM },
      theme: 'grid',
      head: [['Data', 'Descrição', 'Parcela', 'Valor']],
      body: [[{ content: 'Nenhum lançamento nesta fatura.', colSpan: 4, styles: { halign: 'center', textColor: CINZA_TEXTO, fontStyle: 'italic' } }]],
      headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
      styles: { fontSize: 8.5, cellPadding: 2.2 },
      columnStyles: {
        0: { cellWidth: 22, halign: 'center' },
        1: { cellWidth: 102 },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 40, halign: 'right' },
      },
    })
  } else {
    autoTable(doc, {
      startY: y + 1,
      margin: { left: MARGEM, right: MARGEM },
      theme: 'grid',
      head: [['Data', 'Descrição', 'Parcela', 'Valor']],
      body: linhasTabela,
      foot: [[
        { content: 'Total da fatura', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } },
        { content: formatoReal.format(totalFatura), styles: { halign: 'right', fontStyle: 'bold' } },
      ]],
      headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
      footStyles: { fillColor: CINZA_CLARO, textColor: [23, 37, 84], fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8.5, cellPadding: 2.2 },
      columnStyles: {
        0: { cellWidth: 22, halign: 'center' },
        1: { cellWidth: 102 },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 40, halign: 'right' },
      },
    })
  }

  y = doc.lastAutoTable.finalY + 8

  // ---------- LINHA DE REFERÊNCIA AO LIMITE ----------
  const limiteTotal = Number(cartao.limite)
  if (Number.isFinite(limiteTotal) && limiteTotal > 0) {
    const disp = limiteDisponivel != null ? Number(limiteDisponivel) : null
    const textoLimite = disp != null && Number.isFinite(disp)
      ? `Limite total ${formatoReal.format(limiteTotal)} · Disponível ${formatoReal.format(disp)}`
      : `Limite total ${formatoReal.format(limiteTotal)}`
    doc.setFontSize(8)
    doc.setTextColor(...CINZA_TEXTO)
    doc.setFont('helvetica', 'normal')
    // Quebra automática se couber
    const limLines = doc.splitTextToSize(textoLimite, LARGURA - MARGEM * 2)
    // Se estiver perto do rodapé, não precisa nova página — é só uma linha
    if (y + limLines.length * 4 > ALTURA - 18) {
      doc.addPage()
      y = MARGEM + 4
    }
    doc.text(textoLimite, MARGEM, y)
    y += limLines.length * 4 + 4
  }

  // ---------- RODAPÉ ----------
  // Evita sobrescrever a tabela quando ela vai até o fim da página
  let rodapeY = 287
  if (y + 10 > rodapeY) {
    doc.addPage()
    rodapeY = 287
  }
  doc.setTextColor(...CINZA_TEXTO)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  const fechadaTxt = fechada
    ? `Fatura ${competenciaCurta} — fechada em ${formatarData(fechISO)}, vencimento ${formatarData(vencISO)}.`
    : `Extrato parcial da fatura ${competenciaCurta} — fechamento em ${formatarData(fechISO)}, vencimento ${formatarData(vencISO)}.`
  doc.text(fechadaTxt, MARGEM, rodapeY)
  doc.setFontSize(7)
  doc.text(`Emitido em ${dataEmissao} às ${horaEmissao} via Anperez — ${fechada ? 'documento definitivo da fatura fechada' : 'extrato parcial sujeito a novos lançamentos'}`, MARGEM, rodapeY + 4)
  // Numeração
  doc.setFontSize(7)
  doc.text(`Página 1 de 1`, LARGURA - MARGEM, rodapeY + 4, { align: 'right' })

  return doc
}

export function gerarPdfFatura(params) {
  const doc = montarPdfFatura(params)
  const mes = String(params.fatura?.mes_fatura || 'fatura')
  const nome = String(params.cartao?.nome || 'cartao').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'cartao'
  const suf = mes.includes('-') ? `${mes.slice(0, 4)}-${mes.slice(5, 7)}` : mes
  doc.save(`fatura-${nome}-${suf}.pdf`)
}

// Reexporta helpers úteis (teste / decisão de status na UI, sem duplicar lógica)
export { ehFaturaFechada, fechamentoISO, competenciaLonga }
