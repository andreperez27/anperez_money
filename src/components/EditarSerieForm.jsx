import { useState } from 'react'
import { estilosComuns, hoje } from '../lib/compartilhados'
import { montarRegeneracaoRecorrente } from '../lib/edicaoSerie'
import { primeiroVencimento } from '../lib/recorrenciaCalc'
import ModalFormulario from './ModalFormulario'

// ============================================================================
// FORMULÁRIO DE EDIÇÃO DE UMA SÉRIE RECORRENTE (aberto pelo botão "Editar série")
// ============================================================================
// 01/09/2026 (decisão com André): a edição da série vale SÓ para o FUTURO —
// realizado e cancelado ficam imutáveis (regra D4 já consagrada nas libs); as
// ocorrências 'previsto' são RECRIADAS com os novos parâmetros via
// regenerarSerie (rota recorrente → calcularRegeneraçãoRecorrente).
//
// Campos editáveis (numa série recorrente):
//   • descrição;
//   • valor MENSAL (repetido em cada parcela do futuro);
//   • mês de início (data da PRIMEIRA parcela) + dia do vencimento (1-31,
//     clamp de fim de mês D2);
//   • data de término (opcional — indefinida = horizonte de 24 meses, prorrogável).
//
// O form abre pré-preenchido a partir do ITEM que originou a série (qualquer
// ocorrência: a data inicial é a menor data_prevista da série; o campo de
// término exibe o serie_data_termino da linha, se presente).
// ============================================================================

function lerValor(texto) {
  const n = Number(String(texto).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

export default function EditarSerieForm({ item, aoSalvar, aoCancelar }) {
  const dataInicial = item.__dataInicial ?? item.data_prevista
  const diaInicial = Number(dataInicial.slice(8, 10)) || hoje().slice(8, 10)

  const [descricao, setDescricao] = useState(item.descricao ?? '')
  const [valor, setValor] = useState(
    item.__valorMensal != null ? String(item.__valorMensal).replace('.', ',') : '',
  )
  const [mesInicio, setMesInicio] = useState(dataInicial.slice(0, 7))
  const [diaVencimento, setDiaVencimento] = useState(diaInicial)
  const [dataTermino, setDataTermino] = useState(item.__serieDataTermino ?? '')
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  async function handleSalvar(e) {
    e.preventDefault()
    if (enviando) return
    const desc = descricao.trim()
    if (!desc) {
      setMensagem({ tipo: 'erro', texto: 'Informe a descrição.' })
      return
    }
    const valorNum = lerValor(valor)
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      setMensagem({ tipo: 'erro', texto: 'Informe um valor mensal maior que zero.' })
      return
    }
    if (!mesInicio || !/^\d{4}-\d{2}$/.test(mesInicio)) {
      setMensagem({ tipo: 'erro', texto: 'Informe o mês de início (AAAA-MM).' })
      return
    }
    if (!diaVencimento || diaVencimento < 1 || diaVencimento > 31) {
      setMensagem({ tipo: 'erro', texto: 'Informe o dia do vencimento (1 a 31).' })
      return
    }

    const dataPrimeiraParcela = primeiroVencimento(mesInicio, Number(diaVencimento))

    const alteracoes = montarRegeneracaoRecorrente({
      item,
      descricao: desc,
      valorCentavos: Math.round(valorNum * 100),
      dataPrimeiraParcela,
      serieDataTermino: dataTermino || null,
    })

    if (Object.keys(alteracoes).length === 0) {
      setMensagem({ tipo: 'ok', texto: 'Nenhuma alteração detectada.' })
      return
    }

    setEnviando(true)
    setMensagem(null)
    try {
      await aoSalvar(item.id, alteracoes)
      aoCancelar()
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <ModalFormulario titulo="Editar série recorrente" aoFechar={aoCancelar}>
      <form onSubmit={handleSalvar} style={{ ...estilosComuns.form, maxWidth: '100%' }} noValidate>
        <p style={estilos.nota}>
          Vale para o <strong style={{ color: '#e5e7eb' }}>futuro da série</strong>.
          Ocorrências já realizadas ou canceladas não mudam.
        </p>

        <input
          type="text"
          placeholder="Descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={200}
          style={estilosComuns.input}
        />

        <input
          type="text"
          inputMode="decimal"
          placeholder="Valor mensal (R$)"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          style={estilosComuns.input}
        />

        <div style={estilos.grade}>
          <label style={estilos.rotuloCampo}>
            Mês de início
            <input
              style={estilosComuns.input}
              type="month"
              value={mesInicio}
              onChange={(e) => setMesInicio(e.target.value)}
            />
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
              onChange={(e) =>
                setDiaVencimento(e.target.value === '' ? '' : Number(e.target.value))
              }
            />
          </label>
        </div>

        <label
          style={{ ...estilos.rotuloCampo, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
        >
          Data de término (opcional — vazio = indefinido, 24 meses prorrogável)
          <input
            style={estilosComuns.input}
            type="date"
            value={dataTermino}
            onChange={(e) => setDataTermino(e.target.value)}
          />
        </label>

        <button type="submit" disabled={enviando} style={estilos.botaoSalvar}>
          {enviando ? 'Salvando...' : 'Salvar alterações'}
        </button>

        {mensagem && (
          <p
            style={
              mensagem.tipo === 'ok'
                ? estilosComuns.mensagemOk
                : estilosComuns.mensagemErro
            }
          >
            {mensagem.texto}
          </p>
        )}
      </form>
    </ModalFormulario>
  )
}

const estilos = {
  grade: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  rotuloCampo: { color: '#9ca3af', fontSize: '0.8rem' },
  nota: { color: '#9ca3af', fontSize: '0.8rem', margin: 0 },
  botaoSalvar: {
    padding: '0.6rem',
    borderRadius: '8px',
    border: 'none',
    background: '#42A5F5',
    color: '#0b0f19',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
}
