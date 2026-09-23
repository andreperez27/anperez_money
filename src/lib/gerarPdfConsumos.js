// ============================================================================
// PDF DA ABA "CONSUMOS" (Relatórios)
// ============================================================================
// Regra de período própria (como Acordo trabalhista): sempre o ANO CIVIL
// corrente (Jan–Dez), ignorando o SeletorPeriodoRelatorio da tela.
//
// Por tipo: resumo do ano + gráfico de linha mês a mês (Jan–Dez, gap onde
// não há dado, nunca zero) + tabela detalhada (mesma da tela). Métricas:
// UMA → valores brutos; 2+ → cada série indexada em % (normalizarIndice).
// O traço do gráfico usa a MESMA geometria da tela (graficoLinha.js) — só
// muda o pincel (primitivas vetoriais jsPDF em vez de SVG), sem duplicar a
// matemática das séries. Cores: azul Água, laranja Gás (paleta da tela).
//
// Dependências (as do projeto): jsPDF + jspdf-autotable. Números pt-BR via
// formatoReal (telas) e formataM3 (gerarPdfCondominio — mesmo formato).
// ============================================================================

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatoReal, formatarData, hoje } from './compartilhados.js'
import { formataM3 } from './gerarPdfCondominio.js'
import {
  COR_TIPO_CONSUMO,
  ROTULO_TIPO_CONSUMO,
  TIPOS_CONSUMO_VISIVEIS,
  corSerieConsumo,
  formatarM3,
  formatarVariacao,
  normalizarIndice,
  rotuloMes,
  valorMetrica,
} from './consumoMensalCalc.js'
import { geometriaLinha } from './graficoLinha.js'

const MARGEM = 14
const LARGURA = 210

const TRACO_ROTULO = { solido: 'Valor pago', tracejado: 'Consumo', pontilhado: 'R$ por m³' }
const TRACO_DASH = { solido: [], tracejado: [7, 5], pontilhado: [1.5, 3] }

const METRICA_CHAVE = { valor: 'valor', consumo: 'consumo', m3: 'm3' }

function hexParaRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex ?? ''))
  if (!m) return [66, 165, 245]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function dataCivilHoje() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

// Meses do ano civil (eixo fixo Jan–Dez; sem dado = gap, nunca zero).
export function mesesDoAno(ano) {
  const meses = []
  for (let m = 1; m <= 12; m++) {
    meses.push(`${ano}-${String(m).padStart(2, '0')}`)
  }
  return meses
}

// Monta as seções (puro, testável): porTipoAno = { [tipo]: [pontos] }.
// tipos: ordem dos chips (vazio = todos com dado); metricas: 1+ chaves.
export function montarSecoesConsumos({ porTipoAno, tipos = [], metricas = ['valor'], ano }) {
  const listaTipos = (tipos.length > 0 ? tipos : TIPOS_CONSUMO_VISIVEIS).filter(
    (t) => Array.isArray(porTipoAno[t]) && porTipoAno[t].length > 0,
  )
  const indexado = metricas.length > 1
  const meses = mesesDoAno(ano)
  const secoes = []

  for (const tipo of listaTipos) {
    const serie = porTipoAno[tipo]
    const porMes = new Map(serie.map((p) => [p.mes, p]))
    const consumoTotal = serie.reduce((s, p) => s + Number(p.consumo), 0)
    const valorTotal = serie.reduce((s, p) => s + Number(p.valor), 0)
    const series = metricas.map((metrica) => {
      const chave = METRICA_CHAVE[metrica] ?? 'valor'
      // Base Jan–Dez (gap onde não há dado); indexado usa normalizarIndice.
      const base = meses.map((mes) => porMes.get(mes) ?? { mes, valor: null, consumo: null, valorM3: null })
      const pontos = !indexado
        ? base.map((p) => ({ mes: p.mes, valor: valorMetrica(p, chave) }))
        : normalizarIndice(base, chave).map((q) => ({ mes: q.mes, valor: q.pct }))
      return {
        chave: `${tipo}-${chave}`,
        metrica: chave,
        traco: chave === 'valor' ? 'solido' : chave === 'consumo' ? 'tracejado' : 'pontilhado',
        corSerie: corSerieConsumo(tipo, chave),
        pontos,
      }
    })
    secoes.push({
      tipo,
      rotulo: ROTULO_TIPO_CONSUMO[tipo] ?? tipo,
      cor: COR_TIPO_CONSUMO[tipo] ?? '#42A5F5',
      resumo: {
        consumoTotal,
        valorTotal,
        valorMedioM3: consumoTotal > 0 ? valorTotal / consumoTotal : null,
      },
      meses,
      series,
      indexado,
      tabela: serie.map((p) => ({
        mes: p.mes,
        anterior: p.leituraAnterior,
        atual: p.leituraAtual,
        consumo: p.consumo,
        valor: p.valor,
        valorM3: p.valorM3,
      })),
    })
  }
  return secoes
}

function fmtM3(v) {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${formataM3.format(Number(v))} m³`
}

function fmtY(indexado, metrica, v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  if (indexado) return formatarVariacao(v)
  if (metrica === 'consumo') return formatarM3(Number(v))
  if (metrica === 'm3') return `${formatoReal.format(Number(v))}/m³`
  return formatoReal.format(Number(v))
}

// Desenha UMA seção (resumo + gráfico vetorial + tabela). rotulos = chaves
// de métrica com valor nos pontos (vazio = sem rótulos). Devolve o Y final.
function desenharSecao(doc, secao, ano, y, rotulos = []) {
  const cor = hexParaRgb(secao.cor)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...cor)
  doc.text(`${secao.rotulo} — ${ano}`, MARGEM, y)
  y += 7

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(60, 60, 60)
  doc.text(`Consumo total: ${fmtM3(secao.resumo.consumoTotal)}`, MARGEM, y)
  y += 5
  doc.text(`Valor total pago: ${formatoReal.format(Number(secao.resumo.valorTotal))}`, MARGEM, y)
  y += 5
  doc.text(
    `Valor médio por m³: ${secao.resumo.valorMedioM3 !== null ? `${formatoReal.format(Number(secao.resumo.valorMedioM3))}/m³` : '—'}`,
    MARGEM,
    y,
  )
  y += 8

  // Gráfico vetorial (mesma geometria da tela).
  const geo = geometriaLinha({
    series: secao.series.map((s) => ({ chave: s.chave, pontos: s.pontos })),
    W: 600,
    H: 190,
    padX: 34,
    padY: 24,
  })
  const GX = MARGEM
  const GW = LARGURA - MARGEM * 2
  const GH = 62
  if (geo) {
    const sx = (gx) => GX + (gx / 600) * GW
    const sy = (gy) => y + (gy / 190) * GH
    doc.setDrawColor(220, 220, 220)
    doc.setLineWidth(0.2)
    doc.line(GX, sy(0), GX, sy(190))
    doc.line(GX, sy(190), GX + GW, sy(190))
    for (const { serie, segs } of geo.segmentos) {
      const meta = secao.series.find((s) => s.chave === serie.chave) ?? {}
      const traco = meta.traco ?? 'solido'
      const corSerie = hexParaRgb(meta.corSerie ?? secao.cor)
      doc.setDrawColor(...corSerie)
      doc.setLineWidth(0.7)
      doc.setLineDashPattern(TRACO_DASH[traco] ?? [], 0)
      for (const seg of segs) {
        for (let i = 1; i < seg.length; i++) {
          doc.line(sx(seg[i - 1].x), sy(seg[i - 1].y), sx(seg[i].x), sy(seg[i].y))
        }
      }
      doc.setLineDashPattern([], 0)
      doc.setFillColor(...corSerie)
      doc.setFontSize(6.5)
      const comRotulo = rotulos.includes(meta.metrica)
      for (const seg of segs) {
        for (const p of seg) {
          doc.circle(sx(p.x), sy(p.y), 0.9, 'F')
          if (comRotulo) {
            doc.setTextColor(...corSerie)
            doc.text(
              fmtY(secao.indexado, meta.metrica ?? 'valor', p.valor),
              sx(p.x),
              sy(p.y) - 2.5,
              { align: 'center' },
            )
          }
        }
      }
    }
    doc.setFontSize(7)
    doc.setTextColor(107, 114, 128)
    const metrica0 = secao.series[0]?.metrica ?? 'valor'
    doc.text(fmtY(secao.indexado, metrica0, geo.max), GX + GW, y + 3, { align: 'right' })
    doc.text(fmtY(secao.indexado, metrica0, geo.min), GX + GW, y + GH, { align: 'right' })
    geo.meses.forEach((m, i) => {
      if (i % 2 === 0) doc.text(rotuloMes(m), sx(geo.x(m)), y + GH + 5, { align: 'center' })
    })
  }
  y += GH + 12

  // Legenda (cor = tipo, traço = métrica).
  doc.setFontSize(8)
  doc.setTextColor(107, 114, 128)
  let lx = MARGEM
  for (const s of secao.series) {
    const corSerie = hexParaRgb(s.corSerie ?? secao.cor)
    doc.setDrawColor(...corSerie)
    doc.setLineWidth(0.7)
    doc.setLineDashPattern(TRACO_DASH[s.traco] ?? [], 0)
    doc.line(lx, y - 1, lx + 10, y - 1)
    doc.setLineDashPattern([], 0)
    doc.setFillColor(...corSerie)
    doc.circle(lx + 5, y - 1, 0.9, 'F')
    const rot = `${secao.rotulo} · ${TRACO_ROTULO[s.traco] ?? s.traco}`
    doc.text(rot, lx + 12, y)
    lx += doc.getTextWidth(rot) + 20
  }
  y += 6
  if (secao.indexado) {
    doc.setFontSize(7.5)
    doc.text('Séries indexadas em % sobre o primeiro mês com dado (0%).', MARGEM, y)
    y += 5
  }

  // Tabela detalhada (mesma da tela).
  autoTable(doc, {
    startY: y,
    head: [['Mês', 'Ant. (m³)', 'Atual (m³)', 'Consumo', 'Valor', 'R$/m³']],
    body: secao.tabela.map((l) => [
      rotuloMes(l.mes),
      l.anterior !== null ? formataM3.format(Number(l.anterior)) : '—',
      l.atual !== null ? formataM3.format(Number(l.atual)) : '—',
      fmtM3(l.consumo),
      formatoReal.format(Number(l.valor)),
      l.valorM3 !== null ? `${formatoReal.format(Number(l.valorM3))}/m³` : '—',
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: cor },
  })
  return doc.lastAutoTable.finalY + 10
}

export function montarPdfConsumos({ ano, secoes, rotulos = [] }) {
  const doc = new jsPDF()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(20, 20, 20)
  doc.text(`Consumos — ${ano}`, MARGEM, 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(107, 114, 128)
  doc.text(`Emitido em: ${formatarData(hoje())} · Ano civil (jan–dez), mês do consumo`, MARGEM, 24)
  let y = 32
  secoes.forEach((secao, i) => {
    if (i > 0) {
      doc.addPage()
      y = 18
    }
    y = desenharSecao(doc, secao, ano, y, rotulos)
  })
  return doc
}

export function gerarPdfConsumos(params) {
  const doc = montarPdfConsumos(params)
  doc.save(`consumos-${params.ano}.pdf`)
}
