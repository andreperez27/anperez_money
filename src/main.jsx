import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/global.css'

// BrowserRouter é o que permite existirem "telas" diferentes (Login,
// Dashboard, Contas) sem recarregar a página inteira a cada clique, do
// mesmo jeito que o site do bolão navega entre grupos sem piscar a tela.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename="/anperez-money">
      <App />
    </BrowserRouter>
  </StrictMode>,
)
