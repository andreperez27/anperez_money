// ============================================================================
// PRÉ-VISUALIZAÇÃO DE PDF — abre numa nova guia em vez de baixar direto
// ============================================================================
// A guia precisa ser aberta NO CLIQUE (gesto do usuário) para o bloqueador
// de pop-ups não barrar — por isso abrirGuiaPrevia() é síncrona e deve ser
// chamada antes de qualquer await. Depois de gerar o doc, entregarPdf()
// navega a guia até o blob (de lá dá para baixar/imprimir); se bloqueada,
// cai no download direto como antes. Revoga a URL após 60s.
// ============================================================================

export function abrirGuiaPrevia() {
  try {
    const abaPrevia = window.open('', '_blank')
    if (abaPrevia) {
      abaPrevia.document.write('<p style="font-family:sans-serif;color:#9ca3af">Gerando PDF…</p>')
    }
    return abaPrevia ?? null
  } catch {
    return null
  }
}

export function entregarPdf(doc, nomeArquivo, abaPrevia) {
  const url = URL.createObjectURL(doc.output('blob'))
  if (abaPrevia && !abaPrevia.closed) {
    abaPrevia.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } else {
    doc.save(nomeArquivo)
  }
}
