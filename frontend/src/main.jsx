import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './kinetics.css'
import { initKinetics } from './kinetics.js'
import App from './App.jsx'

initKinetics();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
