import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installSerbianValidation } from './lib/validationMessages.ts';
import { installServiceWorkerRefresh } from './lib/swRefresh.ts';
import './styles.css';

installSerbianValidation();
installServiceWorkerRefresh();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
