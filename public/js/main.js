import { registerNav, showSection } from './core/sections.js';
import './core/dom.js';                       // sets up global logging
import './core/api.js';                        // sets up global fetch

/* -------- import the strategy modules (they self-register) ---- */
import './strategies/delta.js';
import './strategies/coin.js';
import './strategies/sentiment.js';
import './strategies/concentration.js';
import './strategies/obi.js';


/* -------- nav buttons ----------------------------------------- */
registerNav('btn-delta'     , 'delta');
registerNav('btn-coin'      , 'coin');
registerNav('btn-sentiment' , 'sentiment');
registerNav('btn-conc'      , 'conc');
registerNav('btn-obi'       , 'obi');

/* default view */
showSection('delta');

