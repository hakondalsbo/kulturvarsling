import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { erStatsbudsjettSti } from './innhold/statsbudsjett2027.ts'
import { StatsbudsjettSide, settStatsbudsjettMeta } from './statsbudsjett.tsx'

const budsjett = erStatsbudsjettSti(window.location.pathname)
if (budsjett) settStatsbudsjettMeta()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {budsjett ? <StatsbudsjettSide /> : <App />}
  </StrictMode>,
)
