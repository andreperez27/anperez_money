// ============================================================================
// LISTA POR ANO DO ACORDO TRABALHISTA — acordeão
// ============================================================================
// Lista colapsável da aba "Acordo trabalhista": UM ano aberto por vez. Cada
// ano é uma linha clicável (ano + total do ano + nº de depósitos) que expande
// a lista cronológica dos depósitos daquele ano (data + descrição + valor).
// Os cards de resumo (totais gerais) ficam no RelatorioTemplate, fora daqui.
//
// Padrão de acessibilidade/visual consistente com o app: botões com
// aria-expanded (como o "Ver todas as categorias" da aba Por categoria) e a
// linguagem de linha/item do extrato. Pura apresentação — os dados vêm prontos.
// ============================================================================
import { useState } from 'react'
import { formatoReal, formatarData } from '../../lib/compartilhados'

const COR_PRINCIPAL = '#42A5F5'
const COR_TEXTO_FORTE = '#e5e7eb'
const COR_TEXTO_SUAVE = '#9ca3af'

export default function ListaAnosAcordo({ anos }) {
  // Acordeão: só um ano aberto por vez (null = nenhum).
  const [anoAberto, setAnoAberto] = useState(null)

  function alternar(ano) {
    setAnoAberto((atual) => (atual === ano ? null : ano))
  }

  if (!Array.isArray(anos) || anos.length === 0) {
    return null
  }

  return (
    <div style={estilos.bloco}>
      <ul style={estilos.listaAnos}>
        {anos.map((item) => {
          const aberto = item.ano === anoAberto
          return (
            <li key={item.ano} style={estilos.item}>
              <button
                type="button"
                onClick={() => alternar(item.ano)}
                style={estilos.cabecalho(aberto)}
                aria-expanded={aberto}
                aria-controls={`acordo-ano-${item.ano}`}
              >
                <span style={estilos.ano}>{item.ano}</span>
                <span style={estilos.resumoAno}>
                  <span style={estilos.totalAno}>{formatoReal.format(item.recebido)}</span>
                  <span style={estilos.contagem}>
                    {item.quantidade} {item.quantidade === 1 ? 'depósito' : 'depósitos'}
                  </span>
                </span>
                <span style={estilos.marcador} aria-hidden="true">
                  {aberto ? '▾' : '▸'}
                </span>
              </button>

              {aberto && (
                <div id={`acordo-ano-${item.ano}`} style={estilos.detalhe}>
                  {item.depositos.length === 0 ? (
                    <p style={estilos.vazio}>Nenhum depósito neste ano.</p>
                  ) : (
                    <ul style={estilos.subLista}>
                      {item.depositos.map((d, i) => (
                        <li
                          key={`${d.data}-${i}`}
                          style={{
                            ...estilos.subItem,
                            ...(i === item.depositos.length - 1 ? estilos.subItemUltimo : {}),
                          }}
                        >
                          <div style={estilos.colunaDescricao}>
                            <span style={estilos.data}>{formatarData(d.data)}</span>
                            <span style={estilos.descricao}>{d.descricao || 'Sem descrição'}</span>
                          </div>
                          <div style={estilos.colunaValor}>
                            <span style={estilos.valor}>{formatoReal.format(d.valor)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const estilos = {
  bloco: { display: 'flex', flexDirection: 'column', gap: '0.9rem' },
  // Container SEM max-height (os botões de ano ficam sempre visíveis; só a
  // sublista expandida rola — maxHeight 30vh em overflowY abaixo).
  listaAnos: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '10px',
    background: '#111827',
    border: '1px solid #1f2937',
    overflow: 'hidden',
  },
  cabecalho: (aberto) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.9rem',
    width: '100%',
    padding: '0.75rem 0.9rem',
    border: 'none',
    background: aberto ? '#17213a' : 'transparent',
    color: COR_TEXTO_FORTE,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    textAlign: 'left',
    transition: 'background 150ms ease',
  }),
  ano: { fontWeight: 700, fontSize: '1rem' },
  resumoAno: { display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' },
  totalAno: { color: COR_PRINCIPAL, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  contagem: { color: COR_TEXTO_SUAVE, fontSize: '0.78rem' },
  marcador: { color: COR_TEXTO_SUAVE, fontSize: '0.85rem' },
  detalhe: {
    borderTop: '1px solid #1f2937',
    background: '#0f172a',
    padding: '0.35rem 0.9rem 0.4rem',
  },
  subLista: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    // Scroll interno quando o ano tem muitos depósitos (mesmo padrão das
    // listas roláveis do app: maxHeight 30vh + overflowY auto — extrato,
    // movimentações, detalhe por categoria). O item do ano (overflow hidden)
    // não encolhe: quem rola é esta sublista, não o container pai.
    maxHeight: '30vh',
    overflowY: 'auto',
  },
  subItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.9rem',
    padding: '0.55rem 0',
    borderBottom: '1px solid #1f2937',
  },
  subItemUltimo: { borderBottom: 'none' },
  colunaDescricao: { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  data: { color: COR_TEXTO_SUAVE, fontSize: '0.78rem' },
  descricao: { color: COR_TEXTO_FORTE, fontWeight: 500, fontSize: '0.9rem' },
  colunaValor: { display: 'flex', alignItems: 'center' },
  valor: { color: COR_TEXTO_FORTE, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  vazio: { margin: '0.5rem 0', color: COR_TEXTO_SUAVE, fontSize: '0.85rem' },
}