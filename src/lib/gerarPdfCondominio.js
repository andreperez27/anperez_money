import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatoReal, formatarData } from './compartilhados.js'

// ============================================================================
// COMPROVANTE DO CONDOMÍNIO EM PDF (espelho do boleto — PARTE 3, 13/09/2026)
// ============================================================================
// FUNÇÃO PRÓPRIA com jsPDF (padrão do app), NÃO reaproveita gerarPdfRelatorio:
// aquele é o template único dos Relatórios; o comprovante é o espelho do
// boleto da administradora, sem Resumo/Categoria/Faturas/Saldos.
//
// FONTES (todas IMUTÁVEIS — modelo congelado):
//   • condominio_boleto_itens  → snapshot da composição gravado NA REALIZAÇÃO
//     (fixos vigentes no mês + Gás 1010 / Água 1052), na ordem gravada
//     (coluna `ordem`). Total = soma destas linhas. NUNCA recalcula.
//   • condominio_consumo_mensal → leituras (m³) do mês para a seção
//     "Histórico de consumo".
// UNIDADE: REAIS (numeric(12,2)) — a do boleto, NÃO centavos (movimentacoes).
//
// TRATAMENTO DO MÊS SEM LEITURA REGISTRADA (backfill antigo via observação):
//   o mês não tem linha em condominio_consumo_mensal (ou tem, mas sem leitura)
//   — só o VALOR existe, capturado no snapshot. Nesse caso o "Histórico de
//   consumo" sai SEM as colunas de leitura: apenas Descrição | Valor (a fonte
//   do valor passa a ser a linha do snapshot 1010/1052). Se nem gás nem água
//   existirem no snapshot, a seção é omitida por inteiro — o espelho continua
//   idêntico ao boleto físico.
// ============================================================================

const MARGEM = 14
const LARGURA = 210

const MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

// m³ com até 2 casas ("124" → "124,00", "124,35" → "124,35").
const formataM3 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const AZUL = [66, 165, 245]
const AZUL_ESCURO = [23, 37, 84]
const CINZA_CLARO = [243, 244, 246]
const CINZA_TEXTO = [107, 114, 128]

function ponto2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

// Linhas do "Histórico de consumo": um item por tipo (Gás/Água) que exista no
// snapshot (valor > 0) OU tenha registro no consumo mensal. O valor vem do
// consumo mensal quando há registro; senão do próprio snapshot (meses antigos
// via fallback da observação) — sempre batendo com a composição.
function linhasConsumo(itens, consumo) {
  const porTipo = {
    gas: consumo.find((l) => l.tipo === 'gas'),
    agua: consumo.find((l) => l.tipo === 'agua'),
  }
  const specs = [
    { tipo: 'gas', cod: '1010', desc: 'Consumo de Gás' },
    { tipo: 'agua', cod: '1052', desc: 'Consumo de Água' },
  ]
  const linhas = []
  for (const s of specs) {
    const itemSnap = itens.find((i) => i.cod === s.cod) ?? null
    const reg = porTipo[s.tipo] ?? null
    const valor = reg ? Number(reg.valor) : itemSnap ? Number(itemSnap.valor) : 0
    if (!reg && (!itemSnap || valor <= 0)) continue
    const atual = reg?.leitura_atual != null ? Number(reg.leitura_atual) : null
    const anterior = reg?.leitura_anterior != null ? Number(reg.leitura_anterior) : null
    const consumoM3 = atual != null && anterior != null ? ponto2(atual - anterior) : null
    linhas.push({ desc: s.desc, atual, anterior, consumo: consumoM3, valor })
  }
  return linhas
}

export function montarPdfCondominio({ ocorrencia, itens, consumo = [] }) {
  const doc = new jsPDF()

  const mesRef = String(ocorrencia.data_prevista || '').slice(0, 7)
  const temMes = /^\d{4}-\d{2}$/.test(mesRef)
  const ano = temMes ? Number(mesRef.slice(0, 4)) : null
  const mesNum = temMes ? Number(mesRef.slice(5, 7)) : null
  const rotuloMes = temMes ? `${MES_ABREV[mesNum - 1]}/${ano}` : '—'
  // "Set/26" — usado na linha da Cota Condominial (fiel ao boleto real).
  const rotuloMesCurto = temMes ? `${MES_ABREV[mesNum - 1]}/${String(ano).slice(2)}` : null
  const nomeCondominio = String(ocorrencia.descricao || 'Condomínio').trim()

  // ---------- CABEÇALHO ----------
  doc.setFillColor(...AZUL_ESCURO)
  doc.rect(0, 0, LARGURA, 26, 'F')
  doc.setFillColor(...AZUL)
  doc.rect(0, 26, LARGURA, 1.2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('Comprovante do Condomínio', MARGEM, 12)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(nomeCondominio, MARGEM, 19)

  doc.setTextColor(30, 41, 59)
  doc.setFontSize(10)
  doc.text(`Mês de referência: ${rotuloMes}`, MARGEM, 36)
  doc.text(`Emitido em: ${formatarData(dataCivilHoje())}`, LARGURA - MARGEM, 36, { align: 'right' })

  let y = 42

  // ---------- 1. HISTÓRICO DE CONSUMO (descrição + valor; leituras só se houver) ----------
  const cLinhas = linhasConsumo(itens, consumo)
  const temLeitura = cLinhas.some((l) => l.atual != null || l.anterior != null)

  if (cLinhas.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...AZUL_ESCURO)
    doc.text('Histórico de consumo', MARGEM, y)
    y += 3

    const corpo = cLinhas.map((l) =>
      temLeitura
        ? [
            l.desc,
            l.atual != null ? formataM3.format(l.atual) : '—',
            l.anterior != null ? formataM3.format(l.anterior) : '—',
            l.consumo != null ? formataM3.format(l.consumo) : '—',
            formatoReal.format(l.valor),
          ]
        : [l.desc, formatoReal.format(l.valor)],
    )

    autoTable(doc, {
      startY: y + 1,
      margin: { left: MARGEM, right: MARGEM },
      theme: 'grid',
      head: [temLeitura ? ['Descrição', 'Leitura atual', 'Leitura anterior', 'Consumo', 'Valor'] : ['Descrição', 'Valor']],
      body: corpo,
      headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: temLeitura
        ? { 0: { cellWidth: 80 }, 1: { cellWidth: 24 }, 2: { cellWidth: 24 }, 3: { cellWidth: 24 }, 4: { cellWidth: 30, halign: 'right' } }
        : { 0: { cellWidth: 140 }, 1: { cellWidth: 42, halign: 'right' } },
    })
    y = doc.lastAutoTable.finalY + 8
    doc.setFillColor(...CINZA_CLARO)
    doc.rect(MARGEM, y - 6, LARGURA - MARGEM * 2, 0.4, 'F')
    y += 2
  }

  // ---------- 2. COMPOSIÇÃO DA ARRECADAÇÃO (snapshot imutável, ordem gravada) ----------
  const ordens = [...itens].sort((a, b) => Number(a.ordem) - Number(b.ordem))
  const total = ponto2(ordens.reduce((s, i) => s + Number(i.valor || 0), 0))

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...AZUL_ESCURO)
  doc.text('Composição da Arrecadação', MARGEM, y)
  y += 3

  autoTable(doc, {
    startY: y + 1,
    margin: { left: MARGEM, right: MARGEM },
    theme: 'grid',
    head: [['Cód', 'Descrição', 'Ref', 'Valor']],
    body: ordens.map((i) => [
      String(i.cod),
      // A Cota Condominial (1002) sai com o mês de referência junto, como no
      // boleto real da administradora ("Cota Condominial Set/26"). Itens
      // variáveis e demais fixos seguem com a descrição pura.
      i.cod === '1002' && rotuloMesCurto ? `${i.descricao} ${rotuloMesCurto}` : i.descricao,
      i.referencia ?? '',
      formatoReal.format(Number(i.valor || 0)),
    ]),
    // Total como RODAPÉ DA TABELA (correção 13/09/2026): antes era desenhado
    // fora, com uma linha de acento por CIMA do texto — a borda cruzava as
    // letras e deixava o "Total" cortado. Como linha da tabela ganha o mesmo
    // padding/borda das demais, sem sobreposição, só com destaque (negrito +
    // fundo claro).
    foot: [['', 'Total', '', formatoReal.format(total)]],
    headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    footStyles: { fillColor: [240, 240, 245], textColor: [23, 37, 84], fontStyle: 'bold', fontSize: 10 },
    styles: { fontSize: 9, cellPadding: 2.5 },
    columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 102 }, 2: { cellWidth: 22 }, 3: { cellWidth: 40, halign: 'right' } },
  })

  // ---------- 4. RODAPÉ (emissão) ----------
  doc.setTextColor(...CINZA_TEXTO)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(
    `Comprovante emitido em ${formatarData(dataCivilHoje())} via Anperez — espelho do boleto (modelo congelado na realização)`,
    MARGEM,
    287,
  )

  return doc
}

// Monta o documento e grava o arquivo (uso na UI). Separada de montarPdfCondominio
// para os scripts/testes poderem renderizar o A4 em Node sem o navegador
// (doc.output('arraybuffer') em vez de doc.save, que exige DOM).
export function gerarPdfCondominio(params) {
  const doc = montarPdfCondominio(params)
  const mesRef = String(params.ocorrencia.data_prevista || '').slice(0, 7)
  const temMes = /^\d{4}-\d{2}$/.test(mesRef)
  const mesNum = temMes ? Number(mesRef.slice(5, 7)) : null
  const ano = temMes ? Number(mesRef.slice(0, 4)) : null
  const mesArquivo = temMes ? String(mesNum).padStart(2, '0') : '00'
  doc.save(`condominio-${mesArquivo}-${ano}.pdf`)
}

// Data civil LOCAL hoje ('YYYY-MM-DD') — mesmo cuidado das telas (sem UTC).
function dataCivilHoje() {
  const d = new Date()
  const ano = d.getFullYear()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

// Reexporta helpers úteis para a UI (mês/ano em pt-BR para o título da seção).
export { formatarData }