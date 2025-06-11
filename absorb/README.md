# Absorption and Rolling Bias Module

This folder contains standalone utilities for detecting tape flow events
(absorptions and exhaustions) and computing rolling bias values.
The code was extracted from the main server logic to allow easier
analysis and independent testing.

`rollingBias.js` implements a small class that maintains a rolling window
of absorption/exhaustion events and returns the current bias value.

`tapeFlow.js` exposes:

- `depthDiff(pre, post)` – calculate how much order book depth was eaten on
  each side between two snapshots.
- `classifyTrade(trade, preBook, postBook)` – given a trade and book
  snapshots before and after it, returns a structured event describing the
  absorption/exhaustion.
- `TapeFlowAnalyzer` – small helper class that uses `classifyTrade` and
  updates a `RollingBias` instance. It prints the resulting event to the
  console and allows reading the current bias via `getBias()`.

These utilities do not depend on the rest of the repository and can be
imported in isolation for further experimentation or integration.

## Demo

Run `node demo.js` to stream live trades from Hyperliquid.  Set the `COIN`
environment variable to choose the market (default `BTC`).  The script fetches
order book snapshots around each trade and prints the detected tape flow event
along with the current rolling bias value.
