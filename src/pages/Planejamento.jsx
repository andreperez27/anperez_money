import { useEffect, useMemo, useState } from 'react'
import { usePlanejamentos } from '../hooks/usePlanejamentos'
import { estilosComuns, hoje } from '../lib/compartilhados'
import { definirPeriodo, deslocarPeriodo, ehPeriodoAtual } from '../lib/periodos'
import { calcularResumoPlanejamentos } from '../lib/planejamentoCalc'
import SeletorPeriodo from '../components/planejamento/SeletorPeriodo'
import VisaoGeral from '../components/planejamento/VisaoGeral'
import Lancamentos from '../components/planejamento/Lancamentos'

// ============================================================================
// PLANEJAMENTOS — ORQUESTRADOR (ETAPA 06/E5-F4)
// ============================================================================
// A página virou estrutura: SELETOR DE PERÍODO (Semana/Mês/Trimestre/Semestre)
// + ABAS INTERNAS (Visão geral | Lançamentos) — estado local da página, sem
// rotas novas. Ao abrir, a tela padrão é a VISÃO GERAL (resumo primeiro,
// formulário não — correção central desta etapa).
//
// Divisão de responsabilidades:
//   • SEMANA → caminho ÚNICO validado do domínio (listarPorSemana do hook:
//     alvo/itens/totais/contagens prontos). A aritmética de navegação NÃO é
//     duplicada aqui: usa definirPeriodo/deslocarPeriodo de periodos.js;
//   • MÊS/TRIMESTRE/SEMESTRE → consulta explícita listarPorPeriodo(inicio,fim)
//     guardada em estado próprio da página; resumo via calcularResumoPlanejamentos
//     (a MESMA função pura usada pelo hook — nenhuma segunda implementação);
//   • Lançamentos.jsx concentra formulário e ações (comportamento E5-E intacto);
//   • VisaoGeral.jsx exibe resumo, contagens, divisão por mês e próximos.
//
// Ao trocar o TIPO de período, a tela volta para o período que contém HOJE
// (previsível e igual à semântica do botão Hoje). "Hoje" nunca desloca dia
// civil por timezone: hoje() é data civil YYYY-MM-DD e periodos.js opera em UTC.
//
// FORA de escopo nesta etapa: Recorrentes (aba/migration/gerador) e efetivação
// E5-F (botão Lançar). O hook usePlanejamentos permanece INTACTO.
// ============================================================================

export default function Planejamento() {
  // Semana INICIAL (só na montagem): quem troca a semana visível é o hook via
  // listarPorSemana — contrato documentado no hook, preservado.
  const [semanaInicial] = useState(() => {
    const atual = definirPeriodo('semana', hoje())
    return { ano: atual.ano, semana: atual.semana }
  })

  const {
    carregando,
    erro,
    itens,
    alvo,
    periodo: periodoSemana,
    totais,
    contagens,
    listarPorSemana,
    listarPorPeriodo,
    cancelarPlanejamento,
    excluirPlanejamento,
    criarPlanejamento,
    criarSerieParcelada,
    cancelarSerieAPartirDe,
  } = usePlanejamentos({ ano: semanaInicial.ano, semana: semanaInicial.semana })

  const [tipoPeriodo, setTipoPeriodo] = useState('semana')
  const [aba, setAba] = useState('visao') // 'visao' | 'lancamentos'

  // Período corrente das visões MÊS/TRIMESTRE/SEMESTRE (estado da página).
  const [periodo, setPeriodo] = useState(() => definirPeriodo('mes', hoje()))
  const [itensPeriodo, setItensPeriodo] = useState([])
  const [carregandoPeriodo, setCarregandoPeriodo] = useState(false)
  const [erroPeriodo, setErroPeriodo] = useState('')

  const modoSemana = tipoPeriodo === 'semana'

  // Período VISÍVEL unificado (metadados + faixa) para o seletor. Na SEMANA é
  // reconstruído a partir do hook; nos demais, é o estado da própria página.
  const periodoVisivel = useMemo(() => {
    if (modoSemana) {
      if (!alvo || !periodoSemana) return null
      return {
        tipo: 'semana',
        ano: alvo.ano,
        semana: alvo.semana,
        inicio: periodoSemana.inicio,
        fim: periodoSemana.fim,
      }
    }
    return periodo
  }, [modoSemana, alvo, periodoSemana, periodo])

  // Busca das faixas maiores — caminho EXPLÍCITO listarPorPeriodo. A semana
  // continua pelo mecanismo do hook (efeito próprio); os dois nunca se misturam.
  useEffect(() => {
    if (modoSemana) return undefined
    let ativo = true
    setCarregandoPeriodo(true)
    setErroPeriodo('')
    listarPorPeriodo(periodo.inicio, periodo.fim)
      .then((dados) => {
        if (!ativo) return
        setItensPeriodo(dados)
      })
      .catch((e) => {
        if (!ativo) return
        setErroPeriodo(e.message)
        setItensPeriodo([])
      })
      .finally(() => {
        if (ativo) setCarregandoPeriodo(false)
      })
    return () => {
      ativo = false
    }
    // listarPorPeriodo é uma consulta explícita estável em comportamento;
    // incluí-la nas dependências dispararia recarga a cada render (identidade
    // muda), sem nenhum dado novo.
  }, [modoSemana, periodo]) // eslint-disable-line react-hooks/exhaustive-deps

  const carregandoVisivel = modoSemana ? carregando : carregandoPeriodo
  const erroVisivel = modoSemana ? erro : erroPeriodo
  const itensVisiveis = modoSemana ? itens : itensPeriodo

  // Resumo: na SEMANA vêm PRONTOS do hook (caminho validado); nos períodos
  // maiores, a MESMA função pura do domínio sobre a faixa buscada.
  const resumoPeriodo = useMemo(
    () => calcularResumoPlanejamentos(itensPeriodo),
    [itensPeriodo],
  )
  const totaisVisiveis = modoSemana ? totais : resumoPeriodo.totais
  const contagensVisiveis = modoSemana ? contagens : resumoPeriodo.contagens

  const unidadeAtual =
    !!periodoVisivel && ehPeriodoAtual(tipoPeriodo, periodoVisivel, hoje())

  // Data padrão dos formulários: início do período visível (ou hoje).
  const dataPadrao = periodoVisivel?.inicio ?? hoje()

  function aoTrocarTipo(novoTipo) {
    if (novoTipo === tipoPeriodo || carregandoVisivel) return
    if (novoTipo === 'semana') {
      setTipoPeriodo('semana')
      const s = definirPeriodo('semana', hoje())
      listarPorSemana(s.ano, s.semana)
    } else {
      setTipoPeriodo(novoTipo)
      setPeriodo(definirPeriodo(novoTipo, hoje()))
      setItensPeriodo([])
      setErroPeriodo('')
    }
  }

  function aoDeslocar(delta) {
    if (!periodoVisivel || carregandoVisivel) return
    if (modoSemana) {
      const novo = deslocarPeriodo('semana', periodoVisivel, delta)
      listarPorSemana(novo.ano, novo.semana)
    } else {
      setPeriodo((p) => deslocarPeriodo(tipoPeriodo, p, delta))
    }
  }

  function aoIrParaHoje() {
    if (carregandoVisivel || unidadeAtual || !periodoVisivel) return
    const destino = definirPeriodo(tipoPeriodo, hoje())
    if (modoSemana) {
      listarPorSemana(destino.ano, destino.semana)
    } else {
      setPeriodo(destino)
    }
  }

  // Pós-mutação na aba Lançamentos: na SEMANA o hook já recarrega sozinho
  // (atualizar()); nos períodos maiores a página refaz a PRÓPRIA faixa. Erros
  // daqui caem no estado do período — jamais são confundidos com falha da
  // mutação (que já teve sucesso dentro do domínio).
  async function aoPosMutacao() {
    if (modoSemana) return
    try {
      const dados = await listarPorPeriodo(periodo.inicio, periodo.fim)
      setItensPeriodo(dados)
      setErroPeriodo('')
    } catch (e) {
      setErroPeriodo(e.message)
    }
  }

  return (
    <div style={estilosComuns.conteudo}>
      <header style={{ marginBottom: '1.25rem' }}>
        <h2 style={estilos.titulo}>Planejamentos</h2>
        <p style={estilos.subtitulo}>
          Entradas e despesas planejadas — visão por semana, mês, trimestre ou semestre.
        </p>
      </header>

      <SeletorPeriodo
        tipo={tipoPeriodo}
        periodo={periodoVisivel}
        unidadeAtual={unidadeAtual}
        desabilitado={carregandoVisivel}
        aoTrocarTipo={aoTrocarTipo}
        aoDeslocar={aoDeslocar}
        aoIrParaHoje={aoIrParaHoje}
      />

      {/* Abas internas — estado local da página (sem rotas novas) */}
      <div style={estilos.abas}>
        <button
          type="button"
          onClick={() => setAba('visao')}
          aria-pressed={aba === 'visao'}
          style={{ ...estilos.aba, ...(aba === 'visao' ? estilos.abaAtiva : {}) }}
        >
          Visão geral
        </button>
        <button
          type="button"
          onClick={() => setAba('lancamentos')}
          aria-pressed={aba === 'lancamentos'}
          style={{ ...estilos.aba, ...(aba === 'lancamentos' ? estilos.abaAtiva : {}) }}
        >
          Lançamentos
        </button>
      </div>

      {aba === 'visao' ? (
        <VisaoGeral
          carregando={carregandoVisivel}
          erro={erroVisivel}
          totais={totaisVisiveis}
          contagens={contagensVisiveis}
          itens={itensVisiveis}
          dividirPorMes={!modoSemana}
          aoVerLancamentos={() => setAba('lancamentos')}
        />
      ) : (
        <Lancamentos
          itens={itensVisiveis}
          carregando={carregandoVisivel}
          erro={erroVisivel}
          dataPadrao={dataPadrao}
          acoes={{
            criar: criarPlanejamento,
            criarSerie: criarSerieParcelada,
            cancelar: cancelarPlanejamento,
            cancelarSerie: cancelarSerieAPartirDe,
            excluir: excluirPlanejamento,
          }}
          aoPosMutacao={aoPosMutacao}
        />
      )}

      <p style={estilos.notaEtapa}>
        A efetivação (lançar em conta/cartão) será disponibilizada em etapa futura.
      </p>
    </div>
  )
}

const estilos = {
  titulo: { margin: 0, fontSize: '1.3rem', fontWeight: 'bold', color: '#e5e7eb' },
  subtitulo: { margin: '0.25rem 0 0', color: '#9ca3af', fontSize: '0.9rem' },
  abas: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' },
  aba: {
    padding: '0.45rem 1.1rem',
    borderRadius: '999px',
    border: '1px solid #374151',
    background: '#111827',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 'bold',
  },
  abaAtiva: { color: '#42A5F5', borderColor: 'rgba(66, 165, 245, 0.45)' },
  notaEtapa: { marginTop: '1.5rem', color: '#6b7280', fontSize: '0.8rem' },
}
