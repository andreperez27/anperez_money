// ============================================================================
// REATIVADO em 31/08/2026: renderizado dentro do modal "Novo planejamento"
// (Lancamentos.jsx), na opção [Recorrente] (despesa fixa mensal genérica) e
// como núcleo do [Condomínio]. Ver DIARIO_DE_BORDO.md.
// EVOLUÍDO em 01/09/2026: passou a gerar uma SÉRIE recorrente (origem
// 'recorrente' com serie_id), com DIA de vencimento (1-31) + data de término
// opcional (indefinida = horizonte inicial fixo de 24 meses). Decisão com
// André — ver diário 01/09/2026.
// ============================================================================
import { useMemo, useState } from 'react'
import { estilosComuns, formatoReal, formatarData, hoje } from '../../lib/compartilhados'
import { montarObservacaoCondominio } from '../../lib/despesaRecorrenteCalc'
import {
  totalParcelasRecorrencia,
  primeiroVencimento,
} from '../../lib/recorrenciaCalc'

// ============================================================================
// GERADOR DE RECORRÊNCIA MENSAL (ETAPA 06/P4 — componente reutilizável)
// ============================================================================
// Formulário padrão para gerar a SÉRIE mensal de uma despesa recorrente
// (origem 'recorrente', com serie_id) no Planejamento. Reutilizado por:
//   • GeradorCondominio — como núcleo do formulário (itens fixos + variáveis
//     gás/água via calcularValor);
//   • (referência) GeradorDasMei — uso mínimo com valor fixo e conta PJ.
//
// Props:
//   • nome           — nome da despesa (ex.: "Condomínio", "DAS-MEI"). Vira a
//                      descrição "<nome> <MÊS/ANO>" da previsão inicial.
//   • tipoOp         — 'Saida' (padrão) ou 'Entrada'. Apenas informativo para
//                      casos incomuns; o padrão do domínio é despesa.
//   • contaPadrao    — id de conta opcional registrado como conta_destino_id.
//   • destinoPadrao/cartaoPadraoId — direcionamento Conta/Cartão (opcional).
//   • calcularValor(mesAlvo 'YYYY-MM') → { valor, detalhamento } — função
//                      PURA/síncrona que calcula o total previsto do mês. O
//                      valor do MÊS DE REFERÊNCIA (1º mês) é REPETIDO em todas
//                      as ocorrências da série (limitação assumida: condomínio
//                      com média móvel variável fica com o valor do mês inicial;
//                      DAS-MEI/assinatura de valor fixo é exato). detalhamento
//                      é a lista de linhas da observação.
//   • children       — campos EXTRA a renderizar na grade (ex.: gás/água do
//                      condomínio). Opcional.
//   • aoCriarSerie    — função de criação de SÉRIE recorrente
//                      (criarSerieRecorrente). Recebe payload no contrato da
//                      lib (totalParcelas, valorCentavos, dataPrimeiraParcela…).
//   • aoCriar        — fallback LEGADO (criação avulsa de UM mês) usado quando
//                      aoCriarSerie não é informado. Mantido para não quebrar o
//                      GeradorDasMei preservado como referência.
//   • aoPosMutacao   — callback pós-criação (recarrega a faixa na página).
//   • aoResetarCamposExtra — callback opcional para o PAI limpar os campos que
//                      ele injeta como children (ex.: descrição/valor no
//                      Lancamentos, gás/água no GeradorCondominio). O próprio
//                      gerador já zera mês/dia/término após o sucesso — pedido
//                      do André em 01/09/2026: "ao finalizar o envio, limpar os
//                      dados automaticamente para o próximo lançamento".
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
  aoCriarSerie,
  aoCriar,
  aoPosMutacao,
  aoResetarCamposExtra,
}) {
  // Mês de referência (input month 'YYYY-MM'); default = mês corrente. Define
  // o mês da 1ª ocorrência e é usado para calcular o valor repetido.
  const [mesAno, setMesAno] = useState(() => hoje().slice(0, 7))
  // Dia do vencimento (1-31) — ancorado no mês de referência e preservado por
  // clamp (D2) nos meses seguintes.
  const [diaVencimento, setDiaVencimento] = useState(() => Number(hoje().slice(8, 10)))
  // Data de término opcional ('YYYY-MM-DD'). Vazia = recorrência indefinida
  // (horizonte inicial fixo de 24 meses).
  const [dataTermino, setDataTermino] = useState('')
  const [msg, setMsg] = useState({ tipo: '', texto: '' })
  const [gerando, setGerando] = useState(false)

  const [anoAtual, mesAtual] = mesAno.split('-').map(Number)
  const rotuloMes = `${MES_3[mesAtual - 1]}/${anoAtual}`

  // Pré-visualização do total do mês via calcularValor (mesmo valor repetido).
  const previa = useMemo(() => {
    if (typeof calcularValor !== 'function') return { total: 0, detalhamento: [] }
    try {
      const r = calcularValor(mesAno)
      return { total: Number(r?.total) || 0, detalhamento: r?.detalhamento ?? [] }
    } catch {
      return { total: 0, detalhamento: [] }
    }
  }, [mesAno, calcularValor])

  // Número de parcelas da série: com término = meses até ele (inclusive);
  // sem término = horizonte inicial fixo (lib recorrenciaCalc).
  const totalParcelas = totalParcelasRecorrencia(mesAno, dataTermino)

  // Zera o formulário para o próximo lançamento: mês/dia voltam para HOJE e a
  // data de término é limpa (pedido do André — 01/09/2026). Evita gerar 2× a
  // mesma série com o mês/dia/término antigos ainda preenchidos.
  function resetarForm() {
    setMesAno(hoje().slice(0, 7))
    setDiaVencimento(Number(hoje().slice(8, 10)))
    setDataTermino('')
  }

  // Painel de resumo da extensão para o usuário decidir antes de gerar.
  const rotuloTérmino = dataTermino
    ? `até ${formatarData(dataTermino)} (${totalParcelas} meses)`
    : `indefinida (${totalParcelas} meses — prorrogável)`

  async function aoGerar(e) {
    e.preventDefault()
    if (gerando) return
    if (!diaVencimento || diaVencimento < 1 || diaVencimento > 31) {
      setMsg({ tipo: 'erro', texto: 'Informe o dia do vencimento (1 a 31).' })
      return
    }
    if (previa.total <= 0) {
      setMsg({ tipo: 'erro', texto: 'Nenhum valor para gerar: ajuste o valor/consumo do mês.' })
      return
    }
    try {
      setGerando(true)
      const valorCentavos = Math.round(previa.total * 100)
      const dataPrimeiraParcela = primeiroVencimento(mesAno, diaVencimento)
      // Contrato da série recorrente (camelCase, como na série parcelada):
      // repetirValorEmOcorrencias → montarLinhasRecorrentes. NÃO usar
      // snake_case aqui — a lib lê tipoOp/contaDestinoId/destinoPadrao/
      // cartaoPadraoId (bug corrigido em 01/09/2026).
      const serieDados = {
        tipoOp,
        descricao: `${nome} ${rotuloMes}`,
        valorCentavos,
        totalParcelas,
        dataPrimeiraParcela,
        origem: 'recorrente',
        observacao: montarObservacaoCondominio(previa.detalhamento),
        serieDataTermino: dataTermino || undefined,
      }
      if (contaPadrao) serieDados.contaDestinoId = contaPadrao
      if (destinoPadrao !== undefined) serieDados.destinoPadrao = destinoPadrao
      if (cartaoPadraoId !== undefined && cartaoPadraoId !== null && cartaoPadraoId !== '') {
        serieDados.cartaoPadraoId = cartaoPadraoId
      }

      if (aoCriarSerie) {
        await aoCriarSerie(serieDados)
        setMsg({
          tipo: 'ok',
          texto: `Série de ${nome} gerada: ${totalParcelas} meses × ${formatoReal.format(previa.total)} (${rotuloTérmino}).`,
        })
      } else {
        // Fallback legado (avulso de UM mês) — mantido p/ GeradorDasMei ref.
        const payloadAvulso = {
          tipo_op: tipoOp,
          descricao: `${nome} ${rotuloMes}`,
          valor: previa.total,
          data_prevista: dataPrimeiraParcela,
          origem: 'recorrente',
          observacao: montarObservacaoCondominio(previa.detalhamento),
        }
        if (contaPadrao) payloadAvulso.conta_destino_id = contaPadrao
        if (destinoPadrao !== undefined) payloadAvulso.destino_padrao = destinoPadrao
        if (cartaoPadraoId !== undefined && cartaoPadraoId !== null && cartaoPadraoId !== '') {
          payloadAvulso.cartao_padrao_id = cartaoPadraoId
        }
        await aoCriar(payloadAvulso)
        setMsg({ tipo: 'ok', texto: `Previsão de ${nome} ${rotuloMes} gerada (${formatoReal.format(previa.total)}).` })
      }
      await aoPosMutacao?.()
      resetarForm()
      aoResetarCamposExtra?.()
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
          Mês de início
          <input style={estilosComuns.input} type="month" value={mesAno} onChange={(e) => setMesAno(e.target.value)} />
        </label>
        <label style={estilos.rotuloCampo}>
          Dia do vencimento
          <input
            style={estilosComuns.input}
            type="number"
            min="1"
            max="31"
            step="1"
            value={diaVencimento}
            onChange={(e) => setDiaVencimento(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </label>
        <label style={{ ...estilos.rotuloCampo, gridColumn: '1 / -1' }}>
          Data de término (opcional — deixe vazio p/ indefinido)
          <input style={estilosComuns.input} type="date" value={dataTermino} onChange={(e) => setDataTermino(e.target.value)} />
        </label>
        {children}
      </div>

      <div style={estilos.totalLinha}>
        <span style={estilosComuns.mensagem}>Total previsto</span>
        <strong style={estilos.total}>{formatoReal.format(previa.total)}</strong>
      </div>

      <p style={{ color: '#9ca3af', fontSize: '0.8rem', margin: 0 }}>
        Valor do mês de início repetido em cada parcela · Duração: <strong style={{ color: '#e5e7eb' }}>{rotuloTérmino}</strong>.
      </p>

      {msg.texto && (
        <p style={msg.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>{msg.texto}</p>
      )}

      <button type="submit" disabled={gerando} style={gerando ? { ...estilosComuns.botaoCriar, opacity: 0.6 } : estilosComuns.botaoCriar}>
        {gerando ? 'Gerando...' : `Gerar série de ${rotuloMes} (${totalParcelas} meses)`}
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
