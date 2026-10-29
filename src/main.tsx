import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// O painel da equipe (/admin) é carregado à parte: o visitante não baixa esse código.
const AdminApp = lazy(() => import('./admin/AdminApp'));
const isAdmin = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAdmin ? (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
