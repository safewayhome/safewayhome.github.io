import React from 'react'
import ReactDOM from 'react-dom/client'
import 'leaflet/dist/leaflet.css'   // Leaflets bas-CSS, buntad (CSP: ingen extern stylesheet)
import Uplift from './Uplift.jsx'
import './uplift.css'

// Egen, fristående ingångspunkt för dev-undersidan /UpliftModeling (skild från tavlans App och /ideel).
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Uplift />
  </React.StrictMode>,
)
