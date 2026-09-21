import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './index.css';
import App from './App.tsx';
import { warmup } from './lib/highlighter.ts';

// 预热 Shiki 高亮器，避免首次高亮等待
warmup();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);