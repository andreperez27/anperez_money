// ============================================================================
// ATENÇÃO: este componente NÃO está sendo renderizado no momento. Em 31/08/2026
// o DAS-MEI foi consolidado no formulário padrão de planejamento — a opção
// [Recorrente] do modal "Novo planejamento" (Lancamentos.jsx) cobre o valor
// fixo mensal com origem 'recorrente' via GeradorRecorrenciaMensal (conta PJ na
// realização). Este componente ficou PRESERVADO como referência, reativável.
// Ver DIARIO_DE_BORDO.md.
// ============================================================================
import { useCallback, useState } from 'react'
import { useContas } from '../../hooks/useContas'
import { estilosComuns, hoje } from '../../lib/compartilhados'
import GeradorRecorrenciaMensal from './GeradorRecorrenciaMensal'

// ============================================================================
// GERADOR DE DAS-MEI (ETAPA 06/P4 — uso mínimo do GeradorRecorrenciaMensal)
// ============================================================================
// Demonstra a reutilização do componente: uma despesa mensal de VALOR FIXO
// (sem itens, sem variáveis), registrada como previsão 'recorrente' no
// Planejamento. O DAS-MEI é o Documento de Arrecadação do Microempreendedor
// Individual — tributo fixo mensal da conta PJ.
//
//  • calcularValor(mes) devolve o valor fixo digitado (detalhamento vazio);
//  • conta padrão = conta PESSOA JURÍDICA, detectada pelo campo .tipo do
//    useContas (tipo livre no schema — 'juridica'/'pj'/contém 'jur'). Se não
//    houver conta PJ, recai na primeira conta ativa (o destino fica opcional
//    na previsão, sem mudança de schema).
// ============================================================================

// Lê um número digitado ("100,45" ou "100.45") → número em reais.
function lerValor(texto) {
  const n = Number(String(texto).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

export default function GeradorDasMei({ aoCriar, aoPosMutacao }) {
  const { contas, carregando: carregandoContas } = useContas()
  const [valor, setValor] = useState('')

  const valorNum = Number.isFinite(lerValor(valor)) ? lerValor(valor) : 0

  // Conta padrão: preferência pela PJ (tipo livre). Sem nada novo no schema.
  const contaPJ = contas.find((c) => c.ativa && /jur|pj|cnpj/i.test(String(c.tipo || '')))
  const contaPadrao = (contaPJ || contas.find((c) => c.ativa))?.id

  const calcularValor = useCallback(() => ({ total: valorNum, detalhamento: [] }), [valorNum])

  return (
    <section>
      <p style={{ ...estilosComuns.mensagem, margin: '0 0 0.75rem' }}>
        Gera a previsão mensal do DAS-MEI (valor fixo) como despesa recorrente na conta PJ.
      </p>
      <GeradorRecorrenciaMensal
        nome="DAS-MEI"
        tipoOp="Saida"
        contaPadrao={contaPadrao}
        calcularValor={calcularValor}
        aoCriar={aoCriar}
        aoPosMutacao={aoPosMutacao}
      >
        <label style={estilos.rotuloCampo}>
          Valor do DAS-MEI (R$)
          <input style={estilosComuns.input} type="text" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
      </GeradorRecorrenciaMensal>
      {carregandoContas && (
        <p style={{ ...estilosComuns.mensagem, marginTop: '0.5rem', fontSize: '0.8rem' }}>Carregando contas...</p>
      )}
      <p style={{ marginTop: '0.75rem', color: '#9ca3af', fontSize: '0.85rem' }}>
        A previsão aparece em "Lançamentos" com estado previsto — lance em conta ou cartão pelo botão "Lançar".
      </p>
    </section>
  )
}

const estilos = {
  rotuloCampo: { display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#9ca3af', fontSize: '0.8rem' },
}
