import React from 'react'
import ReactDOM from 'react-dom/client'
import IdeaMap from './IdeaMap.jsx'
import './idea.css'

// Egen, fristående ingångspunkt för det interna brainstorm-verktyget /idea
// (skild från dev-tavlans App och från den publika /ideel-sidan).
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <IdeaMap />
  </React.StrictMode>,
)
