import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/artboard.css';
import './styles/animation-inspector.css';
import './styles/globals.css';

const root = document.getElementById('framebuilder-root');
if (root) {
  ReactDOM.createRoot(root).render(<App />);
}
