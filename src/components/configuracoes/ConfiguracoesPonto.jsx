import { CARGA_PADRAO, QUOTA_FERIAS_ANUAL, BASE_HORAS_POR_DIA } from '../../lib/pontoCalc'
import PontoConfig from '../PontoConfig'
import { estilosComuns } from '../../lib/compartilhados'

// Aba "Ponto" da tela de Configurações (em sub-abas).
//
// Exibe em LEITURA a carga horária padrão (CARGA_PADRAO — CONSTANTE de
// pontoCalc.js; não há backend para editá-la) e a cota de férias remuneradas.
// A edição da regra de presença/jornada NÃO tem implementação no projeto —
// por isso mostramos como leitura + aviso, sem inventar escrita nem botão
// "Editar horários" que não teria efeito real.
//
// Abaixo segue a edição dos valores monetários (ponto_config) e feriados
// (ponto_feriados) — que TÊM backend real — reutilizando o PontoConfig
// existente.
export default function ConfiguracoesPonto() {
  // Índice = getDay() do JS: 0..5 são Segunda..Sábado (as 6 jornadas), 6 é
  // Domingo (folga, null em CARGA_PADRAO). Exibimos na ordem da semana real.
  const dias = [
    ['Segunda', 0],
    ['Terça', 1],
    ['Quarta', 2],
    ['Quinta', 3],
    ['Sexta', 4],
    ['Sábado', 5],
    ['Domingo', 6],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <section style={estilosComuns.secao}>
        <h2 style={{ margin: '0 0 0.5rem' }}>Carga horária padrão</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {dias.map(([nome, idx]) => {
            const carga = CARGA_PADRAO[idx]
            const base = BASE_HORAS_POR_DIA[idx]
            return (
              <div key={idx} style={estilos.linha}>
                <span style={estilos.nomeDia}>{nome}</span>
                <span style={estilos.horario}>
                  {carga ? `${carga.entrada} → ${carga.saida}` : 'Folga'}
                  {base > 0 && <span style={estilos.base}>({base}h)</span>}
                </span>
              </div>
            )
          })}
        </div>
        <p style={estilosComuns.mensagem}>
          A edição da carga horária e da regra de presença ainda não tem
          implementação no app — por isso é exibida somente como leitura.
        </p>
      </section>

      <section style={estilosComuns.secao}>
        <h2 style={{ margin: '0 0 0.5rem' }}>Férias remuneradas</h2>
        <div style={estilos.linha}>
          <span style={estilos.nomeDia}>Cota anual</span>
          <span style={estilos.horario}>{QUOTA_FERIAS_ANUAL} dias</span>
        </div>
        <p style={estilosComuns.mensagem}>
          A cota de férias também é uma constante no cálculo; não é editável
          aqui.
        </p>
      </section>

      <PontoConfig />
    </div>
  )
}

const estilos = {
  linha: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.55rem 0',
    borderBottom: '1px solid #1f2937',
  },
  nomeDia: { color: '#9ca3af', fontSize: '0.9rem' },
  horario: { color: '#e5e7eb', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.4rem' },
  base: { color: '#6b7280', fontWeight: 'normal', fontSize: '0.8rem' },
}
