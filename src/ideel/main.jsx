import React from 'react'
import ReactDOM from 'react-dom/client'
import Ideel from './Ideel.jsx'
import './ideel.css'

// Egen, fristående ingångspunkt för den publika undersidan /ideel (skild från dev-tavlans App).
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Ideel />
  </React.StrictMode>,
)
