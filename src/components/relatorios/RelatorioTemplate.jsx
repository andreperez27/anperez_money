// ============================================================================
// MODELO DE RELATÓRIO (genérico)
// ============================================================================
// Estrutura única de exibição para todas as abas: resumo → gráfico → lista
// (mesmo padrão informal da VisãoGeral do Planejamento). Recebe props de
// apresentação PURA — nenhuma consulta a dados:
//   cards   [{ label, valor, cor? }]           → resumo em grade
//   grafico { rotulos: [String], valores: [n],
//             extras?: [n] }                    → barras simples; extras (se
//             presente com o mesmo tamanho) pinta uma FATIA LARANJA na base
//             de cada coluna (parte dos extras do total daquele bucket)
//           { rotulos: [String],
//             buckets: [{ colunas: [{ cor?, valor?,
//                                   fatias?: [{ cor, valor }] }] }] }
//                                                → barras por BUCKET com
//             colunas LADO A LADO dentro do bucket; cada coluna é uma barra
//             sólida (cor + valor) ou, se tiver `fatias`, uma barra EMPILHADA
//             em fatias coloridas (a soma das fatias == valor da coluna).
//             Usado pela aba "Entradas x despesas" (entradas empilhadas por
//             categoria ao lado da despesa). rotulos e buckets têm o mesmo
//             tamanho (um bucket por rótulo; sem bucket → só o rótulo no eixo).
//   linhas  [{ label, valor, cor? }]           → lista detalhada (2 colunas)
//           OU [{ celulas: [{ texto, cor?, forte? }] }] → lista em 4 colunas
//   detalhes  (opcional) nó React renderizado no bloco "Detalhes" no lugar da
//             lista genérica (usado pela aba "Acordo trabalhista" → acordeão
//             por ano). Quando presente, ignora `linhas`.
// Qualquer uma das três vazia/undefined renderiza o estado "Em construção"
// NESSE bloco (mesmo texto e estilo do placeholder atual da página).
// ============================================================================
import { estilosComuns } from '../../lib/compartilhados'

const COR_EXTRAS = '#F59E0B'

const TEXTO_EM_CONSTRUCAO =
  'Em construção — em breve você analisa seus números por período, categoria e conta.'

function BlocoEmConstrucao() {
  return (
    <div style={estilos.emConstrucao}>
      <p style={estilosComuns.mensagem}>{TEXTO_EM_CONSTRUCAO}</p>
    </div>
  )
}

export default function RelatorioTemplate({ cards, grafico, linhas, detalhes }) {
  const temCards = Array.isArray(cards) && cards.length > 0
  const temGraficoSimples =
    grafico &&
    Array.isArray(grafico.rotulos) &&
    Array.isArray(grafico.valores) &&
    grafico.rotulos.length > 0 &&
    grafico.rotulos.length === grafico.valores.length
  const temGraficoBuckets =
    grafico &&
    Array.isArray(grafico.rotulos) &&
    Array.isArray(grafico.buckets) &&
    grafico.rotulos.length > 0 &&
    grafico.rotulos.length === grafico.buckets.length
  const temGrafico = temGraficoSimples || temGraficoBuckets

  // Máximo do gráfico (base das alturas). No modo buckets considera o MAIOR
  // valor de coluna (soma das fatias, se houver) entre todos os buckets.
  const maxValor = temGrafico
    ? temGraficoBuckets
      ? Math.max(
          1,
          ...grafico.buckets.flatMap((b) =>
            (b.colunas ?? []).map((c) =>
              Array.isArray(c.fatias)
                ? c.fatias.reduce((a, f) => a + Number(f.valor), 0)
                : Number(c.valor),
            ),
          ),
        )
      : Math.max(...grafico.valores) || 1
    : 1
  // Fatia de extras por coluna, somente quando a série existe e bate o tamanho.
  const temExtras =
    temGraficoSimples &&
    Array.isArray(grafico.extras) &&
    grafico.extras.length === grafico.valores.length &&
    grafico.extras.some((e) => Number(e) > 0)

  const temLinhas = Array.isArray(linhas) && linhas.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      {/* Resumo — grade de cards de número */}
      <section aria-label="Resumo">
        {temCards ? (
          <div style={estilos.gradeResumo}>
            {cards.map((card, i) => (
              <div key={i} style={estilos.cardResumo}>
                <div style={estilos.rotuloCard}>{card.label}</div>
                <div style={{ ...estilos.valorCard, color: card.cor ?? '#e5e7eb' }}>
                  {card.valor}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <BlocoEmConstrucao />
        )}
      </section>

      {/* Gráfico — barras proporcionais (simples OU buckets com colunas lado a lado) */}
      <section aria-label="Gráfico">
        {temGrafico ? (
          <div style={estilos.cardGrafico}>
            <div style={estilos.barras}>
              {temGraficoBuckets
                ? grafico.buckets.map((bucket, i) => (
                    <div key={i} style={estilos.bucket}>
                      {(bucket.colunas ?? []).map((coluna, j) => {
                        const totalColuna = Array.isArray(coluna.fatias)
                          ? coluna.fatias.reduce((a, f) => a + Number(f.valor), 0)
                          : Number(coluna.valor)
                        const alturaTotal = Math.round((totalColuna / maxValor) * 100)
                        return Array.isArray(coluna.fatias) ? (
                          <div key={j} style={estilos.bucketColuna}>
                            {coluna.fatias.map((fatia, k) => {
                              const altura = Math.round((Number(fatia.valor) / maxValor) * 100)
                              return (
                                altura > 0 && (
                                  <div
                                    key={k}
                                    style={{
                                      ...estilos.barraFatia,
                                      height: `${altura}%`,
                                      background: fatia.cor,
                                    }}
                                  />
                                )
                              )
                            })}
                          </div>
                        ) : (
                          <div key={j} style={estilos.bucketColuna}>
                            {alturaTotal > 0 && (
                              <div
                                style={{
                                  ...estilos.barra,
                                  background: coluna.cor ?? estilos.barra.background,
                                  height: `${alturaTotal}%`,
                                }}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))
                : grafico.valores.map((v, i) => {
                    const extras = temExtras ? Math.min(Number(grafico.extras[i]) || 0, v) : 0
                    const alturaTotal = Math.round((v / maxValor) * 100)
                    const alturaExtras = extras > 0 ? Math.min(Math.round((extras / maxValor) * 100), alturaTotal) : 0
                    const alturaAzul = alturaTotal - alturaExtras
                    return (
                      <div key={i} style={estilos.coluna}>
                        {alturaAzul > 0 && <div style={{ ...estilos.barra, height: `${alturaAzul}%` }} />}
                        {alturaExtras > 0 && (
                          <div
                            style={{
                              ...estilos.barraExtras,
                              height: `${alturaExtras}%`,
                              borderRadius: alturaAzul > 0 ? '0 0 3px 3px' : '3px',
                            }}
                          />
                        )}
                      </div>
                    )
                  })}
            </div>
            <div style={estilos.eixo}>
              {grafico.rotulos.map((rotulo, i) => (
                <span key={i} style={estilos.rotuloBarra}>
                  {rotulo}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <BlocoEmConstrucao />
        )}
      </section>

      {/* Lista — linhas detalhadas (ou nó customizado via `detalhes`) */}
      <section aria-label="Detalhes">
        {detalhes ? (
          detalhes
        ) : temLinhas ? (
          <div style={estilos.cardLista}>
            {linhas.map((linha, i) =>
              Array.isArray(linha.celulas) && linha.celulas.length > 0 ? (
                <div
                  key={i}
                  style={{
                    ...estilos.linhaCelulas,
                    ...(i === linhas.length - 1 ? estilos.linhaUltima : {}),
                  }}
                >
                  {linha.celulas.map((celula, j) => (
                    <span
                      key={j}
                      style={{
                        ...(celula.forte ? estilos.valorCelula : {}),
                        color: celula.cor ?? (j === 0 ? '#e5e7eb' : '#9ca3af'),
                      }}
                    >
                      {celula.texto}
                    </span>
                  ))}
                </div>
              ) : (
                <div
                  key={i}
                  style={{ ...estilos.linha, ...(i === linhas.length - 1 ? estilos.linhaUltima : {}) }}
                >
                  <span style={estilos.rotuloLinha}>{linha.label}</span>
                  <span style={{ ...estilos.valorLinha, color: linha.cor ?? '#e5e7eb' }}>
                    {linha.valor}
                  </span>
                </div>
              ),
            )}
          </div>
        ) : (
          <BlocoEmConstrucao />
        )}
      </section>
    </div>
  )
}

const estilos = {
  emConstrucao: {
    background: '#111827',
    border: '1px dashed #374151',
    borderRadius: '10px',
    padding: '1.2rem 1rem',
    textAlign: 'center',
  },
  gradeResumo: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '0.9rem',
  },
  cardResumo: {
    background: '#111827',
    borderRadius: '10px',
    padding: '0.9rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  rotuloCard: { color: '#9ca3af', fontSize: '0.8rem' },
  valorCard: { fontWeight: 700, fontSize: '1.15rem', fontVariantNumeric: 'tabular-nums' },
  cardGrafico: { background: '#111827', borderRadius: '10px', padding: '0.9rem 1rem 0.6rem' },
  barras: { display: 'flex', alignItems: 'flex-end', gap: '0.5rem', height: '80px' },
  coluna: {
    flex: 1,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'stretch',
  },
  // Bucket (modo múltiplas colunas): ocupa uma fração do eixo e agrupa as
  // colunas lado a lado dentro de si (entradas empilhadas + despesa).
  bucket: {
    flex: 1,
    height: '100%',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3,
  },
  bucketColuna: {
    height: '100%',
    flex: 1,
    maxWidth: 14,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'stretch',
  },
  barraFatia: {
    width: '100%',
    transition: 'height 200ms ease',
  },
  barra: {
    width: '100%',
    background: '#42A5F5',
    borderRadius: '3px 3px 0 0',
    transition: 'height 200ms ease',
  },
  barraExtras: {
    width: '100%',
    background: COR_EXTRAS,
    borderRadius: '0 0 3px 3px',
    transition: 'height 200ms ease',
  },
  eixo: { display: 'flex', gap: '0.5rem', marginTop: '0.4rem' },
  rotuloBarra: { flex: 1, textAlign: 'center', fontSize: '0.65rem', color: '#6b7280' },
  cardLista: { background: '#111827', borderRadius: '10px', padding: '0.4rem 1rem 0.1rem' },
  linha: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.7rem 0',
    borderBottom: '1px solid #1f2937',
    fontSize: '0.9rem',
  },
  linhaCelulas: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '0.2rem 0.9rem',
    padding: '0.7rem 0',
    borderBottom: '1px solid #1f2937',
    fontSize: '0.9rem',
  },
  linhaUltima: { borderBottom: 'none' },
  rotuloLinha: { color: '#e5e7eb' },
  valorLinha: { fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  valorCelula: { fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
}