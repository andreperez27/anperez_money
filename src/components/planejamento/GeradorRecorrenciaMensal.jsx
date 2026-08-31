// ============================================================================
// REATIVADO em 31/08/2026: renderizado dentro do modal "Novo planejamento"
// (Lancamentos.jsx), na opção [Recorrente] (despesa fixa mensal genérica) e
// como núcleo do [Condomínio]. Ver DIARIO_DE_BORDO.md.
// ============================================================================
import { useMemo, useState } from 'react'
import { estilosComuns, formatoReal, hoje } from '../../lib/compartilhados'
import { montarObservacaoCondominio } from '../../lib/despesaRecorrenteCalc'

// ============================================================================
// GERADOR DE RECORRÊNCIA MENSAL (ETAPA 06/P4 — componente reutilizável)
// ============================================================================
// Formulário padrão para gerar a PREVISÃO mensal de uma despesa recorrente
// (origem 'recorrente') no Planejamento. Reutilizado por:
//   • GeradorCondominio — como núcleo do formulário (itens fixos + variáveis
//     gás/água via calcularValor);
//   • GeradorDasMei      — uso mínimo com valor fixo e conta PJ padrão.
//
// Props:
//   • nome           — nome da despesa (ex.: "Condomínio", "DAS-MEI"). Vira a
//                      descrição "<nome> <MÊS/ANO>" da previsão.
//   • tipoOp         — 'Saida' (padrão) ou 'Entrada'. Apenas informativo para
//                      casos incomuns; o padrão do domínio é despesa.
//   • contaPadrao    — id de conta opcional registrado como conta_destino_id
//                      da previsão.
//   • calcularValor(mesAlvo 'YYYY-MM') → { valor, detalhamento } — função
//                      PURA/síncrona que calcula o total previsto do mês.
//                      detalhamento é a lista de linhas { cod, descricao, valor,
//                      referencia, categoria } usada na observação (mesmo
//                      formato de calcularTotalCondominio).
//   • children       — campos EXTRA a renderizar na grade (ex.: gás/água do
//                      condomínio). Opcional.
//   • aoCriar        — função de criação de planejamento (criarPlanejamento).
//   • aoPosMutacao   — callback pós-criação (recarrega a faixa na página).
//
// O componente NÃO move saldo, NÃO toca em cartões e NÃO gerencia a tabela de
// itens fixos (responsabilidade de quem usa / do GeradorCondominio).
// ============================================================================

const MES_3 = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']

export default function GeradorRecorrenciaMensal({
  nome,
  tipoOp = 'Saida',
  contaPadrao,
  destinoPadrao,
  cartaoPadraoId,
  calcularValor,
  children,
  aoCriar,
  aoPosMutacao,
}) {
  // Mês de referência (input month 'YYYY-MM'); default = mês corrente.
  const [mesAno, setMesAno] = useState(() => hoje().slice(0, 7))
  const [vencimento, setVencimento] = useState(() => hoje())
  const [msg, setMsg] = useState({ tipo: '', texto: '' })
  const [gerando, setGerando] = useState(false)

  const [anoAtual, mesAtual] = mesAno.split('-').map(Number)
  const rotuloMes = `${MES_3[mesAtual - 1]}/${anoAtual}`

  // Pré-visualização do total do mês via calcularValor.
  const previa = useMemo(() => {
    if (typeof calcularValor !== 'function') return { total: 0, detalhamento: [] }
    try {
      const r = calcularValor(mesAno)
      return { total: Number(r?.total) || 0, detalhamento: r?.detalhamento ?? [] }
    } catch {
      return { total: 0, detalhamento: [] }
    }
  }, [mesAno, calcularValor])

  async function aoGerar(e) {
    e.preventDefault()
    if (gerando) return
    if (!vencimento) {
      setMsg({ tipo: 'erro', texto: 'Informe a data de vencimento.' })
      return
    }
    if (previa.total <= 0) {
      setMsg({ tipo: 'erro', texto: 'Nenhum valor para gerar: ajuste o valor/consumo do mês.' })
      return
    }
    try {
      setGerando(true)
      const payload = {
        tipo_op: tipoOp,
        descricao: `${nome} ${rotuloMes}`,
        valor: previa.total,
        data_prevista: vencimento,
        origem: 'recorrente',
        observacao: montarObservacaoCondominio(previa.detalhamento),
      }
      if (contaPadrao) payload.conta_destino_id = contaPadrao
      if (destinoPadrao !== undefined) payload.destino_padrao = destinoPadrao
      if (cartaoPadraoId !== undefined && cartaoPadraoId !== null && cartaoPadraoId !== '') {
        payload.cartao_padrao_id = cartaoPadraoId
      }
      await aoCriar(payload)
      setMsg({ tipo: 'ok', texto: `Previsão de ${nome} ${rotuloMes} gerada (${formatoReal.format(previa.total)}).` })
      await aoPosMutacao?.()
    } catch (err) {
      setMsg({ tipo: 'erro', texto: `Não foi possível gerar: ${err.message}` })
    } finally {
      setGerando(false)
    }
  }

  return (
    <form onSubmit={aoGerar} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }} noValidate>
      <div style={estilos.grade}>
        <label style={estilos.rotuloCampo}>
          Mês de referência
          <input style={estilosComuns.input} type="month" value={mesAno} onChange={(e) => setMesAno(e.target.value)} />
        </label>
        <label style={estilos.rotuloCampo}>
          Data de vencimento
          <input style={estilosComuns.input} type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
        </label>
        {children}
      </div>

      <div style={estilos.totalLinha}>
        <span style={estilosComuns.mensagem}>Total previsto</span>
        <strong style={estilos.total}>{formatoReal.format(previa.total)}</strong>
      </div>

      {msg.texto && (
        <p style={msg.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>{msg.texto}</p>
      )}

      <button type="submit" disabled={gerando} style={gerando ? { ...estilosComuns.botaoCriar, opacity: 0.6 } : estilosComuns.botaoCriar}>
        {gerando ? 'Gerando...' : `Gerar previsão de ${rotuloMes}`}
      </button>
    </form>
  )
}

const estilos = {
  grade: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  rotuloCampo: { display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#9ca3af', fontSize: '0.8rem' },
  totalLinha: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.8rem', borderRadius: '8px', background: '#111827', border: '1px solid #1f2937' },
  total: { color: '#4ade80', fontSize: '1.1rem' },
}
