import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { erStatsbudsjettSti } from './innhold/statsbudsjett2027.ts'
import { StatsbudsjettSide, settStatsbudsjettMeta } from './statsbudsjett.tsx'
import { MobiliserSide } from './mobiliser/MobiliserSide.tsx'
import { erMobiliserSti } from './mobiliser/miljo.ts'

const sti = window.location.pathname
const budsjett = erStatsbudsjettSti(sti)
if (budsjett) settStatsbudsjettMeta()

function Side() {
  if (budsjett) return <StatsbudsjettSide />
  if (erMobiliserSti(sti)) return <MobiliserSide />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Side />
  </StrictMode>,
)
