// Ordenação cronológica de parcelas (fatura e extrato) — lib pura.
// Critério único reaproveitado em FaturaDetalhe.jsx e gerarPdfFatura.js:
//   1) mes_fatura crescente (YYYY-MM lexicográfico)
//   2) data da compra crescente (ISO, mais antiga → mais recente)
//   3) numero da parcela crescente (1/10 antes de 2/10)
// Não reordena cada um do zero separadamente.
export function ordenarParcelasCronologicamente(parcelas) {
  return [...(parcelas || [])].sort((a, b) => {
    const ma = a.mes_fatura || ''
    const mb = b.mes_fatura || ''
    if (ma !== mb) return ma < mb ? -1 : ma > mb ? 1 : 0
    const da = a.compras?.data || ''
    const db = b.compras?.data || ''
    if (da !== db) return da < db ? -1 : da > db ? 1 : 0
    return (a.numero ?? 0) - (b.numero ?? 0)
  })
}

// Texto da coluna Parc.: vazio quando parcela única (total=1), "n/total" caso contrário.
export function textoParcela(parcela) {
  const tot = Number(parcela?.total)
  if (!Number.isFinite(tot) || tot <= 1) return ''
  const n = Number(parcela?.numero)
  if (!Number.isFinite(n)) return ''
  return `${n}/${tot}`
}
