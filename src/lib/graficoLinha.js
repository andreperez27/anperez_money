// ============================================================================
// GEOMETRIA DE GRÁFICO DE LINHA — pura, compartilhada (tela SVG + PDF vetorial)
// ============================================================================
// Mesma matemática nos dois traços: eixo X = união dos meses (ordenado),
// valor null quebra a linha (nunca zera). series:
//   [{ chave, pontos: [{ mes: 'YYYY-MM', valor: number|null }] }]
// Devolve { meses, min, max, x(mes), y(v), segmentos } — segmentos agrupa por
// série as polilinhas de pontos consecutivos não-nulos.
// ============================================================================

// Atenção ao Number(null) === 0: nulo/vazio é gap (quebra a linha), nunca zero.
function numValido(v) {
  if (v === null || v === undefined || v === '') return NaN
  return Number(v)
}

export function geometriaLinha({ series = [], W = 600, H = 190, padX = 26, padY = 22 }) {
  const mesesSet = new Set()
  for (const s of series) for (const p of s.pontos ?? []) mesesSet.add(p.mes)
  const meses = [...mesesSet].sort()

  const validos = []
  for (const s of series) {
    for (const p of s.pontos ?? []) {
      const v = numValido(p.valor)
      if (Number.isFinite(v)) validos.push(v)
    }
  }
  if (meses.length === 0 || validos.length === 0) return null

  const min = Math.min(...validos)
  const max = Math.max(...validos)
  const span = max - min || 1
  const x = (mes) => {
    const i = meses.indexOf(mes)
    return meses.length === 1 ? W / 2 : padX + (i * (W - padX * 2)) / (meses.length - 1)
  }
  const y = (v) => padY + (1 - (v - min) / span) * (H - padY * 2)

  const segmentos = series.map((s) => {
    const porMes = new Map((s.pontos ?? []).map((p) => [p.mes, p.valor]))
    const segs = []
    let atual = []
    for (const mes of meses) {
      const v = numValido(porMes.get(mes))
      if (Number.isFinite(v)) {
        atual.push({ mes, x: x(mes), y: y(v), valor: v })
      } else if (atual.length > 0) {
        segs.push(atual)
        atual = []
      }
    }
    if (atual.length > 0) segs.push(atual)
    return { serie: s, segs }
  })

  return { meses, min, max, x, y, segmentos }
}
