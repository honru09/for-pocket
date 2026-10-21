import React from 'react';
import { createRoot } from 'react-dom/client';
import '@telegram-apps/telegram-ui/dist/styles.css';
import './styles.css';
import './account-styles.css';
import './pocket-layout.css';
import './mascot.css';
import './refinements.css';
import './ui-polish.css';
import './popup-materials.css';
import './secondary-motion.css';
import './journal-materials.css';
import './type-system.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
