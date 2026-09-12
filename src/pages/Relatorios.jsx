import { useState } from 'react'
import { estilosComuns, hoje } from '../lib/compartilhados'
import {
  definirPeriodo,
  deslocarPeriodo,
  definirPeriodoPersonalizado,
} from '../lib/periodos'
import SeletorPeriodoRelatorio from '../components/relatorios/SeletorPeriodoRelatorio'
import AbasRelatorio from '../components/relatorios/AbasRelatorio'
import RelatorioTemplate from '../components/relatorios/RelatorioTemplate'
import AnalisePorCategoria from '../components/relatorios/AnalisePorCategoria'
import ListaAnosAcordo from '../components/relatorios/ListaAnosAcordo'
import { useRelatorioRecebidoHoras } from '../hooks/useRelatorioRecebidoHoras'
import { useRelatorioAcordo } from '../hooks/useRelatorioAcordo'
import { useRelatorioEntradasDespesas } from '../hooks/useRelatorioEntradasDespesas'
import { useRelatorioPdf } from '../hooks/useRelatorioPdf'
import { gerarPdfRelatorio } from '../lib/gerarPdfRelatorio'
import { TODAS_CATEGORIAS } from '../lib/relatorioPdf'

const ABA_PADRAO = 'recebido-horas'

export default function Relatorios() {
  const [tipo, setTipo] = useState('mes')
  const [periodoBasico, setPeriodoBasico] = useState(() => definirPeriodo('mes', hoje()))
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [aba, setAba] = useState(ABA_PADRAO)
  const [erroPdf, setErroPdf] = useState('')
  // Categoria selecionada na aba "Por categoria" (elevada para cá para o
  // exportar PDF conhecer o filtro ativo; persiste ao trocar de aba).
  const [selecaoCategoria, setSelecaoCategoria] = useState(TODAS_CATEGORIAS)

  // Relatório consolidado em PDF (template único semana/mês).
  const { gerar, carregando: gerandoPdf } = useRelatorioPdf()

  async function aoExportarPdf() {
    // Aba "Acordo trabalhista": o acordo é um FATO fechado — fica FORA da
    // lógica "aba ativa + período + categoria". O export gera SEMPRE o
    // relatório consolidado do TOTAL do acordo (início ao fim), usando os
    // dados crus do hook — nada de período do seletor nem categoria.
    if (aba === 'acordo-trabalhista') {
      if (!acordo.temData || !acordo.dados) {
        setErroPdf('Ainda não há dados do acordo trabalhista para exportar.')
        return
      }
      try {
        gerarPdfRelatorio({ acordo: acordo.dados })
      } catch (e) {
        setErroPdf(e.message)
      }
      return
    }

    if (!periodo) {
      setErroPdf('Defina um período válido antes de exportar o PDF.')
      return
    }
    setErroPdf('')
    try {
      // Contexto de visualização no momento do clique: o filtro de categoria
      // só vale quando a aba ativa é "por-categoria" (regra 12/09/2026). Nas
      // demais abas o export segue sendo o relatório consolidado completo.
      const categoria = aba === 'por-categoria' ? selecaoCategoria : TODAS_CATEGORIAS
      const blocos = await gerar(periodo, categoria)
      gerarPdfRelatorio({ periodo, blocos, categoria })
    } catch (e) {
      setErroPdf(e.message)
    }
  }

  // Período efetivo: personalizado só existe quando a faixa De/Até é VÁLIDA
  // (ambas preenchidas e inicio <= fim). Faixa incompleta/invertida mantém o
  // último período válido e a página mostra um aviso (mesmo comportamento do
  // filtro Personalizado do extrato).
  function montarPersonalizado() {
    if (!dataInicio || !dataFim) return null
    try {
      return definirPeriodoPersonalizado(dataInicio, dataFim)
    } catch {
      return null
    }
  }
  const periodo = tipo === 'personalizado' ? montarPersonalizado() : periodoBasico

  function aoTrocarTipo(novoTipo) {
    if (novoTipo === 'personalizado') {
      // Herda a faixa do período que estava visível para o usuário já
      // começar com um intervalo coerente (o mesmo do período atual).
      const base = tipo === 'personalizado' ? null : periodoBasico
      setDataInicio(base?.inicio ?? '')
      setDataFim(base?.fim ?? '')
      setTipo(novoTipo)
      return
    }
    // Referência dentro do período atual (o "início" é uma data civil do
    // próprio período, então definir o novo tipo mantém a mesma época).
    const referencia = periodo?.inicio ?? hoje()
    setPeriodoBasico(definirPeriodo(novoTipo, referencia))
    setTipo(novoTipo)
  }

  function aoDeslocar(delta) {
    setPeriodoBasico(deslocarPeriodo(tipo, periodoBasico, delta))
  }

  function aoTrocarDataInicio(valor) {
    setDataInicio(valor)
  }

  function aoTrocarDataFim(valor) {
    setDataFim(valor)
  }

  const faixaInvertida = Boolean(dataInicio && dataFim && dataInicio > dataFim)

  // Aba "Recebido & horas", "Acordo trabalhista" e "Entradas x despesas": dados
  // reais do período. As demais abas continuam sem dados (template em "Em
  // construção"). Os hooks já devolvem as props no formato do RelatorioTemplate.
  const recebidoHoras = useRelatorioRecebidoHoras(periodo ?? undefined)
  const acordo = useRelatorioAcordo()
  const entradasDespesas = useRelatorioEntradasDespesas(periodo ?? undefined)

  return (
    <div style={estilosComuns.conteudo}>
      {/* Cabeçalho: Relatórios + exportar PDF (template único). */}
      <header style={estilos.cabecalho}>
        <div>
          <h2 style={estilos.titulo}>Relatórios</h2>
          <p style={estilos.subtitulo}>
            Em breve você analisa seus números por período, categoria e conta.
          </p>
        </div>
        <button
          type="button"
          onClick={aoExportarPdf}
          disabled={gerandoPdf}
          title="Exportar relatório em PDF"
          style={{ ...estilos.botaoPdf, ...(gerandoPdf ? estilos.botaoPdfCarregando : {}) }}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            style={{ stroke: 'currentColor', strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }}
          >
            <path d="M12 3v12" />
            <path d="M7 10l5 5 5-5" />
            <path d="M4 21h16" />
          </svg>
          <span>{gerandoPdf ? 'Gerando…' : 'Exportar PDF'}</span>
        </button>
      </header>

      {erroPdf && <p style={estilos.erro}>{erroPdf}</p>}

      {/* Seletor de período (Mês/Trimestre/Semestre/Ano/Personalizado). SOME
          na aba "Acordo trabalhista": o acordo é um fato fechado e não
          consome período — a aba carrega o total do início ao fim. O estado do
          período fica preservado para as demais abas. */}
      {aba !== 'acordo-trabalhista' && (
        <>
          <SeletorPeriodoRelatorio
            tipo={tipo}
            periodo={periodo}
            dataInicio={dataInicio}
            dataFim={dataFim}
            aoTrocarTipo={aoTrocarTipo}
            aoDeslocar={aoDeslocar}
            aoTrocarDataInicio={aoTrocarDataInicio}
            aoTrocarDataFim={aoTrocarDataFim}
          />

          {faixaInvertida && (
            <p style={estilos.aviso}>
              A data inicial deve ser anterior ou igual à final. Ajuste o período
              para ver o relatório.
            </p>
          )}
        </>
      )}

      {/* Abas de tópico — não resetam o período selecionado. */}
      <AbasRelatorio aba={aba} aoTrocarAba={setAba} />

      {aba === 'recebido-horas' ? (
        recebidoHoras.erro ? (
          <p style={estilos.erro}>{recebidoHoras.erro}</p>
        ) : (
          <RelatorioTemplate
            cards={recebidoHoras.cards}
            grafico={recebidoHoras.grafico}
            linhas={recebidoHoras.linhas}
          />
        )
      ) : aba === 'acordo-trabalhista' ? (
        acordo.erro ? (
          <p style={estilos.erro}>{acordo.erro}</p>
        ) : (
          /* Cards e gráfico vêm do template; a lista por ano (acordeão) é o
             nó customizado da aba (um ano aberto por vez). */
          <RelatorioTemplate
            cards={acordo.cards}
            grafico={acordo.grafico}
            detalhes={<ListaAnosAcordo anos={acordo.anos} />}
          />
        )
      ) : aba === 'entradas-x-despesas' ? (
        entradasDespesas.erro ? (
          <p style={estilos.erro}>{entradasDespesas.erro}</p>
        ) : (
          <RelatorioTemplate
            cards={entradasDespesas.cards}
            grafico={entradasDespesas.grafico}
            linhas={entradasDespesas.linhas}
          />
        )
      ) : aba === 'por-categoria' ? (
        /* Busca/análise por categoria — reusa a fonte única de categorização
           do relatório (relatorioPdf.js) e o período da página. A seleção fica
           elevada aqui para o exportar PDF enxergar o filtro ativo. */
        <AnalisePorCategoria
          periodo={periodo}
          selecao={selecaoCategoria}
          aoTrocarSelecao={setSelecaoCategoria}
        />
      ) : (
        /* Demais abas: mesmo template sem dados reais por enquanto. */
        <RelatorioTemplate />
      )}
    </div>
  )
}

const estilos = {
  cabecalho: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    marginBottom: '1.25rem',
  },
  titulo: { margin: 0, fontSize: '1.3rem', fontWeight: 'bold', color: '#e5e7eb' },
  subtitulo: { margin: '0.25rem 0 0', color: '#9ca3af', fontSize: '0.9rem' },
  botaoPdf: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '10px',
    border: '1px solid rgba(66, 165, 245, 0.45)',
    background: '#111827',
    color: '#42A5F5',
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: '0.85rem',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  botaoPdfCarregando: { opacity: 0.6, cursor: 'default' },
  aviso: { margin: '0 0 0.75rem', color: '#f87171', fontSize: '0.8rem' },
  erro: { margin: '0.75rem 0 0', color: '#ef4444', fontSize: '0.85rem' },
}