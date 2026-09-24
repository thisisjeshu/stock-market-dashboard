require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com';

app.use(cors());
app.use(express.json());

if (!TWELVE_DATA_API_KEY) {
  console.warn('⚠️ TWELVE_DATA_API_KEY is not configured.');
}

// ============================================================
// SIMULATION USER LEDGER
// ============================================================

let simulationUserStorage = {
  username: "Simulation_Trader_One",
  cashBalance: 100000.00,
  portfolio: [
    {
      ticker: "AAPL",
      shares: 10,
      avgPrice: 175.50
    },
    {
      ticker: "NVDA",
      shares: 5,
      avgPrice: 850.00
    }
  ]
};

// ============================================================
// GLOBAL MARKET WATCHLIST
// ============================================================
//
// These are real securities.
// Prices are NOT hard-coded.
// They are retrieved from Twelve Data.
//
// You can expand this list later or allow users to search
// virtually any supported security.
//
// ============================================================

const MARKET_WATCHLIST = [
  // United States
  { ticker: 'AAPL', exchange: 'NASDAQ' },
  { ticker: 'TSLA', exchange: 'NASDAQ' },
  { ticker: 'NVDA', exchange: 'NASDAQ' },
  { ticker: 'AMZN', exchange: 'NASDAQ' },
  { ticker: 'MSFT', exchange: 'NASDAQ' },

  // India
  { ticker: 'RELIANCE', exchange: 'NSE' },
  { ticker: 'TCS', exchange: 'NSE' },
  { ticker: 'INFY', exchange: 'NSE' },
  { ticker: 'HDFCBANK', exchange: 'NSE' },
  { ticker: 'ICICIBANK', exchange: 'NSE' },

  // United Kingdom
  { ticker: 'SHEL', exchange: 'LSE' },

  // Japan
  { ticker: '7203', exchange: 'TSE' },

  // Hong Kong
  { ticker: '0700', exchange: 'HKEX' },

  // Germany
  { ticker: 'SAP', exchange: 'XETRA' }
];

// ============================================================
// TWELVE DATA REQUEST HELPER
// ============================================================

async function getQuote(ticker, exchange = '') {
  if (!TWELVE_DATA_API_KEY) {
    throw new Error('Twelve Data API key is not configured.');
  }

  const params = {
    symbol: ticker,
    apikey: TWELVE_DATA_API_KEY
  };

  if (exchange) {
    params.exchange = exchange;
  }

  const response = await axios.get(
    `${TWELVE_DATA_BASE_URL}/quote`,
    {
      params,
      timeout: 10000
    }
  );

  if (response.data?.status === 'error') {
    throw new Error(
      response.data.message || 'Market data provider error'
    );
  }

  return response.data;
}

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'NUMORA PRO Market Engine',
    marketData: 'Twelve Data'
  });
});

// ============================================================
// MARKET FEED
// ============================================================
//
// Returns real market prices for the dashboard watchlist.
//
// Frontend-compatible response:
//
// {
//   AAPL: 237.12,
//   TSLA: 321.45,
//   NVDA: 178.22
// }
//
// ============================================================

app.get('/api/stocks/market-feed', async (req, res) => {
  try {
    const results = {};

    await Promise.all(
      MARKET_WATCHLIST.map(async ({ ticker, exchange }) => {
        try {
          const quote = await getQuote(ticker, exchange);

          const price = parseFloat(
            quote.close ??
            quote.price ??
            quote.last
          );

          if (!Number.isNaN(price)) {
            results[ticker] = price;
          }
        } catch (error) {
          console.error(
            `Market data error for ${ticker}:`,
            error.message
          );
        }
      })
    );

    res.json(results);

  } catch (error) {
    console.error('Market feed error:', error.message);

    res.status(500).json({
      error: 'Unable to retrieve live market data.'
    });
  }
});

// ============================================================
// SINGLE STOCK QUOTE
// ============================================================
//
// Example:
//
// /api/stocks/quote?symbol=AAPL&exchange=NASDAQ
//
// ============================================================

app.get('/api/stocks/quote', async (req, res) => {
  try {
    const { symbol, exchange } = req.query;

    if (!symbol) {
      return res.status(400).json({
        error: 'Stock symbol is required.'
      });
    }

    const quote = await getQuote(
      symbol.toUpperCase(),
      exchange
    );

    res.json(quote);

  } catch (error) {
    console.error('Quote error:', error.message);

    res.status(500).json({
      error: 'Unable to retrieve stock quote.',
      details: error.message
    });
  }
});

// ============================================================
// STOCK SEARCH
// ============================================================
//
// Example:
//
// /api/stocks/search?q=tesla
//
// This allows NUMORA to search for securities instead of
// maintaining a hard-coded list forever.
//
// ============================================================

app.get('/api/stocks/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        error: 'Search query is required.'
      });
    }

    if (!TWELVE_DATA_API_KEY) {
      return res.status(500).json({
        error: 'Twelve Data API key is not configured.'
      });
    }

    const response = await axios.get(
      `${TWELVE_DATA_BASE_URL}/symbol_search`,
      {
        params: {
          symbol: q,
          apikey: TWELVE_DATA_API_KEY
        },
        timeout: 10000
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error('Symbol search error:', error.message);

    res.status(500).json({
      error: 'Unable to search market securities.'
    });
  }
});

// ============================================================
// USER PROFILE
// ============================================================

app.get('/api/users/profile', (req, res) => {
  res.json(simulationUserStorage);
});

// ============================================================
// TRADE EXECUTION
// ============================================================

app.post('/api/trade/execute', async (req, res) => {
  try {
    const {
      ticker,
      shares,
      type
    } = req.body;

    const targetShares = parseInt(shares);

    if (
      !ticker ||
      Number.isNaN(targetShares) ||
      targetShares <= 0
    ) {
      return res.status(400).json({
        error: 'Order rejected: Invalid share quantity.'
      });
    }

    // --------------------------------------------------------
    // IMPORTANT:
    // Do NOT trust a price sent by the React frontend.
    // Retrieve the current market price from the backend.
    // --------------------------------------------------------

    let quote;

    try {
      quote = await getQuote(ticker.toUpperCase());
    } catch (error) {
      return res.status(502).json({
        error: 'Unable to obtain current market price.'
      });
    }

    const executionPrice = parseFloat(
      quote.close ??
      quote.price ??
      quote.last
    );

    if (
      Number.isNaN(executionPrice) ||
      executionPrice <= 0
    ) {
      return res.status(502).json({
        error: 'Market provider returned an invalid price.'
      });
    }

    const normalizedTicker = ticker.toUpperCase();

    const transactionTotalCost =
      executionPrice * targetShares;

    // ========================================================
    // BUY
    // ========================================================

    if (type === 'BUY') {

      if (
        simulationUserStorage.cashBalance <
        transactionTotalCost
      ) {
        return res.status(400).json({
          error:
            'Order rejected: Insufficient simulated investment capital balance.'
        });
      }

      simulationUserStorage.cashBalance -=
        transactionTotalCost;

      const portfolioIndex =
        simulationUserStorage.portfolio.findIndex(
          item => item.ticker === normalizedTicker
        );

      if (portfolioIndex > -1) {

        const position =
          simulationUserStorage.portfolio[portfolioIndex];

        const newTotalShares =
          position.shares + targetShares;

        position.avgPrice =
          (
            (position.avgPrice * position.shares) +
            transactionTotalCost
          ) / newTotalShares;

        position.shares = newTotalShares;

      } else {

        simulationUserStorage.portfolio.push({
          ticker: normalizedTicker,
          shares: targetShares,
          avgPrice: executionPrice
        });
      }

    // ========================================================
    // SELL
    // ========================================================

    } else if (type === 'SELL') {

      const portfolioIndex =
        simulationUserStorage.portfolio.findIndex(
          item => item.ticker === normalizedTicker
        );

      if (
        portfolioIndex === -1 ||
        simulationUserStorage.portfolio[portfolioIndex].shares <
          targetShares
      ) {
        return res.status(400).json({
          error:
            'Order rejected: Insufficient asset allocation quantities.'
        });
      }

      simulationUserStorage.cashBalance +=
        transactionTotalCost;

      simulationUserStorage.portfolio[portfolioIndex].shares -=
        targetShares;

      if (
        simulationUserStorage.portfolio[portfolioIndex].shares === 0
      ) {
        simulationUserStorage.portfolio.splice(
          portfolioIndex,
          1
        );
      }

    } else {

      return res.status(400).json({
        error:
          'Order rejected: Unsupported transaction type.'
      });
    }

    // ========================================================
    // RETURN UPDATED ACCOUNT
    // ========================================================

    res.json({
      ...simulationUserStorage,
      execution: {
        ticker: normalizedTicker,
        shares: targetShares,
        type,
        executionPrice,
        total: transactionTotalCost,
        currency: quote.currency || null,
        exchange: quote.exchange || null,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {

    console.error(
      'Trade execution error:',
      error.message
    );

    res.status(500).json({
      error: 'Internal trade execution error.'
    });
  }
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(
    `🚀 NUMORA PRO market engine running on port ${PORT}`
  );

  console.log(
    `📡 Market provider: Twelve Data`
  );
});