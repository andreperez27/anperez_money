// ============================================================================
// GERADOR DO RELATÓRIO CONSOLIDADO EM PDF (10/09/2026)
// ============================================================================
// Transforma os blocos prontos (src/lib/relatorioPdf.js — dados PURAMENTE
// calcados, sem fetch aqui) num arquivo A4 com o template único dos relatórios
// semanais e mensais (somente dados realizados):
//   1. Resumo do período;
//   2. Gasto por categoria;
//   3. Faturas e compromissos (faturas/projeções + próximos pendentes);
//   4. Saldos finais das contas ativas.
//
// Dependências (únicas no projeto): jsPDF + jspdf-autotable. Numeros
// formatados em pt-BR via formatoReal (mesma lib das telas). Valores
// negativos em vermelho, positivos em verde (mesma semantica das telas).
// ============================================================================

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatoReal, formatarData } from './compartilhados.js'
import { rotuloRelatorioPdf, TODAS_CATEGORIAS } from './relatorioPdf.js'

const MARGEM = 14
const LARGURA = 210
const ALTURA = 297
const RODAPE = 20

// Paleta das telas (tons fechados para impressao em preto-e-branco legivel).
const COR_BRAND = [66, 165, 245]
const COR_BRAND_ESCURA = [23, 37, 84]
const COR_VERDE = [21, 128, 61]
const COR_VERMELHA = [185, 28, 28]
const COR_TEXTO = [31, 41, 55]
const COR_CLARO = [75, 85, 99]
const COR_FUNDO_TABELA = [243, 244, 246]

function fmt(valor) {
  return formatoReal.format(valor)
}

function dataDoDia() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function corDoSaldo(v) {
  return v >= 0 ? COR_VERDE : COR_VERMELHA
}

// Faixa de rolagem: usa o rodape quando o proximo bloco nao cabe na pagina.
function novaPaginaSeNecessario(doc, y) {
  if (y > ALTURA - RODAPE - 14) {
    doc.addPage()
    return MARGEM + 4
  }
  return y
}

// Barra de titulo azul de cada seção; devolve o y do inicio da tabela.
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

// Estilos comuns das tabelas (grid claro, cabecalho azul-escuro).
function estilosTabela() {
  return {
    margin: { left: MARGEM, right: MARGEM },
    theme: 'grid',
    headStyles: { fillColor: COR_BRAND_ESCURA, textColor: 255, fontStyle: 'bold', fontSize: 9.5 },
    styles: { font: 'helvetica', fontSize: 9.5, textColor: COR_TEXTO, cellPadding: 3 },
    alternateRowStyles: { fillColor: COR_FUNDO_TABELA },
    columnStyles: { 0: { cellWidth: 'auto' } },
  }
}

// Rótulo legível da categoria (a '' — sem categoria — tem nome próprio).
function rotuloCategoria(categoria) {
  return categoria === '' ? 'Sem categoria' : categoria
}

// PDF de CATEGORIA ISOLADA: lista os lançamentos da categoria no período (mesmo
// recorte da aba "Por categoria": analisarCategoria) + o total. O cabeçalho já
// foi impresso pelo chamador; aqui só o bloco, o rodapé e o salvamento.
function gerarPdfCategoria(doc, { periodo, blocos, categoria }) {
  const info = blocos?.blocoCategoria
  if (!info) {
    throw new Error('Export por categoria exige o bloco blocoCategoria (gerado pelo hook).')
  }

  let y = 54
  y = secao(doc, `Gasto na categoria: ${rotuloCategoria(categoria)}`, y)

  if (!info || info.lancamentos.length === 0) {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Data', 'Descrição', 'Origem', 'Valor']],
      body: [[{ content: 'Nenhum lançamento desta categoria no período.', colSpan: 4, styles: { halign: 'center', textColor: COR_CLARO, fontStyle: 'italic' } }]],
    })
    y = doc.lastAutoTable.finalY + 14
  } else {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Data', 'Descrição', 'Origem', 'Valor']],
      body: info.lancamentos.map((l) => [
        { content: formatarData(l.data), styles: { halign: 'center' } },
        { content: l.descricao || 'Sem descrição' },
        { content: l.fonte === 'compra' ? 'Compra no cartão' : 'Movimentação', styles: { halign: 'center' } },
        { content: fmt(l.valor), styles: { halign: 'right' } },
      ]),
      showFoot: 'lastPage',
      foot: [[
        { content: 'Total', styles: { fontStyle: 'bold' } },
        { content: '', styles: {} },
        { content: '', styles: {} },
        { content: fmt(info.total), styles: { halign: 'right', fontStyle: 'bold' } },
      ]],
      footStyles: { fillColor: COR_FUNDO_TABELA, textColor: COR_TEXTO },
    })
    y = doc.lastAutoTable.finalY + 14
  }

  // Subtítulo explicando o recorte do export.
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8.5)
  doc.setTextColor(...COR_CLARO)
  doc.text(
    `Export filtrado pela categoria "${rotuloCategoria(categoria)}" — apenas os lançamentos desta categoria no período.`,
    MARGEM, Math.min(y, ALTURA - RODAPE - 4),
  )

  rodape(doc)
  doc.save(`relatorio-${periodo.tipo}-${rotuloCategoria(categoria).toLowerCase().replace(/\s+/g, '-')}-${periodo.inicio}-${periodo.fim}.pdf`)
}

// PDF do ACORDO TRABALHISTA (fato fechado — 2021 a 2025): consolidado do
// total do acordo, do início ao fim, SEM depender do período do seletor.
// Recebe os dados crus do hook useRelatorioAcordo (totalRecebido + depositos
// + inicio/fim). O cabeçalho já foi impresso pelo chamador.
function gerarPdfAcordo(doc, { acordo }) {
  let y = 54
  y = secao(doc, 'Total do acordo trabalhista', y)

  autoTable(doc, {
    ...estilosTabela(),
    startY: y,
    head: [[
      { content: 'Total recebido', styles: { halign: 'center' } },
      { content: 'Depósitos', styles: { halign: 'center' } },
    ]],
    body: [[
      { content: fmt(acordo.totalRecebido), styles: { halign: 'center', fontStyle: 'bold', textColor: COR_VERDE } },
      { content: String(acordo.depositos.length), styles: { halign: 'center' } },
    ]],
  })
  y = doc.lastAutoTable.finalY + 14

  y = novaPaginaSeNecessario(doc, y)
  y = secao(doc, 'Depósitos do acordo', y)

  if (acordo.depositos.length === 0) {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Data', 'Descrição', 'Valor']],
      body: [[{ content: 'Nenhum depósito do acordo.', colSpan: 3, styles: { halign: 'center', textColor: COR_CLARO, fontStyle: 'italic' } }]],
    })
  } else {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Data', 'Descrição', 'Valor']],
      body: acordo.depositos.map((d) => [
        { content: formatarData(d.data), styles: { halign: 'center' } },
        { content: d.descricao || 'Sem descrição' },
        { content: fmt(d.valor), styles: { halign: 'right' } },
      ]),
      showFoot: 'lastPage',
      foot: [[
        { content: 'Total', styles: { fontStyle: 'bold' } },
        { content: '', styles: { fontStyle: 'bold' } },
        { content: fmt(acordo.totalRecebido), styles: { halign: 'right', fontStyle: 'bold' } },
      ]],
      footStyles: { fillColor: COR_FUNDO_TABELA, textColor: COR_TEXTO },
    })
  }

  rodape(doc)
  const faixa = acordo.inicio && acordo.fim ? `-${acordo.inicio}-${acordo.fim}` : ''
  doc.save(`acordo-trabalhista${faixa}.pdf`)
}

// Rodapé com números de página.
function rodape(doc) {
  const totalPaginas = doc.getNumberOfPages()
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...COR_CLARO)
    doc.text(`Página ${i} de ${totalPaginas}`, LARGURA - MARGEM, ALTURA - 10, { align: 'right' })
    doc.text('ANPEREZ MONEY', MARGEM, ALTURA - 10)
  }
}

export function gerarPdfRelatorio({ periodo, blocos, categoria = TODAS_CATEGORIAS, acordo }) {
  const casoAcordo = Boolean(acordo)

  if (!casoAcordo && (!periodo || !blocos)) {
    throw new Error('Informe período e blocos (montarBlocosRelatorio) para gerar o PDF.')
  }
  if (casoAcordo && !acordo.depositos) {
    throw new Error('Erro ao exportar o acordo: dados incompletos.')
  }

  const casoCategoria = !casoAcordo && categoria !== TODAS_CATEGORIAS

  const doc = new jsPDF()
  // No caso do Acordo o rótulo vem dos próprios dados (início → fim reais);
  // nos demais casos, do período selecionado.
  const rotulo = casoAcordo
    ? {
        titulo: 'Acordo trabalhista',
        faixa: acordo.inicio && acordo.fim
          ? `${formatarData(acordo.inicio)} – ${formatarData(acordo.fim)}`
          : '',
      }
    : rotuloRelatorioPdf(periodo)

  // --- Cabeçalho -----------------------------------------------------------
  doc.setFillColor(...COR_BRAND_ESCURA)
  doc.rect(0, 0, LARGURA, 26, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('ANPEREZ MONEY', MARGEM, 11)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(191, 219, 254)
  doc.text(
    casoAcordo
      ? `Relatório do acordo trabalhista · gerado em ${dataDoDia()}`
      : casoCategoria
        ? `Relatório por categoria · gerado em ${dataDoDia()}`
        : `Relatório consolidado · gerado em ${dataDoDia()}`,
    MARGEM, 18,
  )

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...COR_TEXTO)
  doc.text(rotulo.titulo || 'Período', MARGEM, 36)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COR_CLARO)
  if (rotulo.faixa) doc.text(rotulo.faixa, MARGEM, 42)
  doc.setDrawColor(...COR_BRAND)
  doc.setLineWidth(0.8)
  doc.line(MARGEM, 45.5, LARGURA - MARGEM, 45.5)

  // --- Caso: acordo trabalhista → bloco único (independente de período) ------
  if (casoAcordo) {
    return gerarPdfAcordo(doc, { acordo })
  }

  // --- Caso: categoria isolada → bloco único ----------------------------------
  if (casoCategoria) {
    return gerarPdfCategoria(doc, { periodo, blocos, categoria })
  }

  let y = 54

  // --- Bloco 1: Resumo do período -------------------------------------------
  const resumo = blocos.resumo
  y = secao(doc, 'Resumo do período', y)
  autoTable(doc, {
    ...estilosTabela(),
    startY: y,
    head: [[
      { content: 'Entradas', styles: { halign: 'center' } },
      { content: 'Saídas', styles: { halign: 'center' } },
      { content: 'Resultado', styles: { halign: 'center' } },
    ]],
    body: [[
      { content: fmt(resumo.entradas), styles: { halign: 'center', fontStyle: 'bold', textColor: COR_VERDE } },
      { content: fmt(resumo.saidas), styles: { halign: 'center', fontStyle: 'bold', textColor: COR_VERMELHA } },
      { content: fmt(resumo.resultado), styles: { halign: 'center', fontStyle: 'bold', textColor: corDoSaldo(resumo.resultado) } },
    ]],
  })
  y = doc.lastAutoTable.finalY + 14

  // --- Bloco 2: Gasto por categoria -------------------------------------------
  y = novaPaginaSeNecessario(doc, y)
  y = secao(doc, 'Gasto por categoria', y)

  if (blocos.gastoCategoria.linhas.length === 0) {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Categoria', 'Valor']],
      body: [[{ content: 'Nenhum gasto no período.', colSpan: 2, styles: { halign: 'center', textColor: COR_CLARO, fontStyle: 'italic' } }]],
    })
  } else {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Categoria', 'Valor']],
      body: blocos.gastoCategoria.linhas.map((l) => [
        { content: l.categoria },
        { content: fmt(l.valor), styles: { halign: 'right' } },
      ]),
      // showFoot 'lastPage': o rodapé "Total" só na última página da tabela
      // (default 'everyPage' duplicava o Total quando a tabela quebrava).
      showFoot: 'lastPage',
      foot: [[
        { content: 'Total', styles: { fontStyle: 'bold' } },
        { content: fmt(blocos.gastoCategoria.total), styles: { halign: 'right', fontStyle: 'bold' } },
      ]],
      footStyles: { fillColor: COR_FUNDO_TABELA, textColor: COR_TEXTO },
    })
  }
  y = doc.lastAutoTable.finalY + 14

  // --- Bloco 3: Faturas e compromissos -----------------------------------------
  y = novaPaginaSeNecessario(doc, y)
  y = secao(doc, 'Faturas e compromissos', y)

  if (blocos.faturasCompromissos.faturas.length === 0) {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Fatura', 'Vencimento', 'Valor']],
      body: [[{ content: 'Nenhuma fatura vencendo no período.', colSpan: 3, styles: { halign: 'center', textColor: COR_CLARO, fontStyle: 'italic' } }]],
    })
  } else {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Fatura', 'Vencimento', 'Valor']],
      body: blocos.faturasCompromissos.faturas.map((f) => [
        { content: f.descricao },
        { content: formatarData(f.data), styles: { halign: 'center' } },
        { content: fmt(f.valor), styles: { halign: 'right', fontStyle: f.tipo === 'real' ? 'bold' : 'normal' } },
      ]),
    })
  }

  y = doc.lastAutoTable.finalY + 9
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...COR_TEXTO)
  doc.text('Compromissos próximos (previstos ainda não lançados)', MARGEM, y)
  doc.setFont('helvetica', 'normal')
  y += 5

  if (blocos.faturasCompromissos.compromissos.length === 0) {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Data', 'Descrição', 'Valor']],
      body: [[{ content: 'Nenhum compromisso pendente a partir de hoje.', colSpan: 3, styles: { halign: 'center', textColor: COR_CLARO, fontStyle: 'italic' } }]],
    })
  } else {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Data', 'Descrição', 'Valor']],
      body: blocos.faturasCompromissos.compromissos.map((c) => [
        { content: formatarData(c.data), styles: { halign: 'center' } },
        { content: c.descricao },
        { content: fmt(c.valor), styles: { halign: 'right' } },
      ]),
    })
  }
  y = doc.lastAutoTable.finalY + 14

  // --- Bloco 4: Saldos finais ----------------------------------------------------
  y = novaPaginaSeNecessario(doc, y)
  y = secao(doc, 'Saldos finais', y)

  if (blocos.saldosFinais.contas.length === 0) {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Conta', 'Saldo ao fim do período']],
      body: [[{ content: 'Nenhuma conta ativa.', colSpan: 2, styles: { halign: 'center', textColor: COR_CLARO, fontStyle: 'italic' } }]],
    })
  } else {
    autoTable(doc, {
      ...estilosTabela(),
      startY: y,
      head: [['Conta', 'Saldo ao fim do período']],
      body: blocos.saldosFinais.contas.map((c) => [
        { content: c.nome },
        {
          content: c.saldo === null ? '—' : fmt(c.saldo),
          styles: { halign: 'right', textColor: c.saldo === null ? COR_CLARO : corDoSaldo(c.saldo), fontStyle: c.saldo === null ? 'italic' : 'normal' },
        },
      ]),
      foot: [[
        { content: 'Total', styles: { fontStyle: 'bold' } },
        {
          content: blocos.saldosFinais.total === null ? '—' : fmt(blocos.saldosFinais.total),
          styles: { halign: 'right', fontStyle: 'bold', textColor: blocos.saldosFinais.total === null ? COR_CLARO : corDoSaldo(blocos.saldosFinais.total) },
        },
      ]],
      footStyles: { fillColor: COR_FUNDO_TABELA, textColor: COR_TEXTO },
    })
  }

  // --- Rodapé com números de página ------------------------------------------
  rodape(doc)

  doc.save(`relatorio-${periodo.tipo}-${periodo.inicio}-${periodo.fim}.pdf`)
}