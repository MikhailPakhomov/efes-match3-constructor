import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from './features/editor/Editor'
import './app/styles.css'
createRoot(document.getElementById('root')!).render(<StrictMode><Editor /></StrictMode>)
