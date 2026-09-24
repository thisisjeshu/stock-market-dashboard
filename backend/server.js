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
  username: 'Simulation_Trader_One',
  cashBalance: 100000.00,
  portfolio: [
    {
      ticker: 'AAPL',
      shares: 10,
      avgPrice: 175.50
    },
    {
      ticker: 'NVDA',
      shares: 5,
      avgPrice: 850.00
    }
  ]
};

// ============================================================
// GLOBAL MARKET WATCHLIST
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
// MARKET CACHE
// ============================================================

let marketCache = {};
let marketCacheTimestamp = 0;

// Refresh Twelve Data only once every 60 seconds.
const MARKET_CACHE_DURATION = 60 * 1000;

// Prevent multiple simultaneous refreshes.
let marketRefreshPromise = null;

// ============================================================
// TWELVE DATA QUOTE
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
// REFRESH MARKET CACHE
// ============================================================

async function refreshMarketCache() {
  if (marketRefreshPromise) {
    return marketRefreshPromise;
  }

  marketRefreshPromise = (async () => {
    const updatedPrices = { ...marketCache };

    console.log('📡 Refreshing market data from Twelve Data...');

    for (const { ticker, exchange } of MARKET_WATCHLIST) {
      try {
        const quote = await getQuote(ticker, exchange);

        const price = parseFloat(
          quote.close ??
          quote.price ??
          quote.last
        );

        if (!Number.isNaN(price) && price > 0) {
          updatedPrices[ticker] = price;

          console.log(
            `✓ ${ticker}: ${price} ${quote.currency || ''}`
          );
        }
      } catch (error) {
        console.error(
          `⚠️ Market data error for ${ticker}:`,
          error.response?.data?.message || error.message
        );

        // Keep the previous cached price if available.
        if (marketCache[ticker] !== undefined) {
          updatedPrices[ticker] = marketCache[ticker];
        }
      }
    }

    marketCache = updatedPrices;
    marketCacheTimestamp = Date.now();

    console.log(
      `✅ Market cache updated: ${Object.keys(marketCache).length} symbols`
    );

    return marketCache;
  })();

  try {
    return await marketRefreshPromise;
  } finally {
    marketRefreshPromise = null;
  }
}

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'NUMORA PRO Market Engine',
    marketData: 'Twelve Data',
    cacheDuration: '60 seconds'
  });
});

// ============================================================
// MARKET FEED
// ============================================================

app.get('/api/stocks/market-feed', async (req, res) => {
  try {
    const cacheExpired =
      Date.now() - marketCacheTimestamp >= MARKET_CACHE_DURATION;

    if (cacheExpired || Object.keys(marketCache).length === 0) {
      await refreshMarketCache();
    }

    res.json(marketCache);

  } catch (error) {
    console.error(
      'Market feed error:',
      error.response?.data?.message || error.message
    );

    if (Object.keys(marketCache).length > 0) {
      return res.json(marketCache);
    }

    res.status(500).json({
      error: 'Unable to retrieve market data.'
    });
  }
});

// ============================================================
// SINGLE STOCK QUOTE
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
    console.error(
      'Quote error:',
      error.response?.data?.message || error.message
    );

    res.status(500).json({
      error: 'Unable to retrieve stock quote.',
      details:
        error.response?.data?.message || error.message
    });
  }
});

// ============================================================
// STOCK SEARCH
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
    console.error(
      'Symbol search error:',
      error.response?.data?.message || error.message
    );

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

    const normalizedTicker = ticker?.toUpperCase();
    const targetShares = parseInt(shares);

    if (
      !normalizedTicker ||
      Number.isNaN(targetShares) ||
      targetShares <= 0
    ) {
      return res.status(400).json({
        error: 'Order rejected: Invalid share quantity.'
      });
    }

    // Never trust a frontend price.
    const cachedPrice = marketCache[normalizedTicker];

    let executionPrice = cachedPrice;
    let quote = null;

    // Use the cache when available.
    // Otherwise retrieve a fresh quote.
    if (!executionPrice) {
      try {
        quote = await getQuote(normalizedTicker);
      } catch (error) {
        return res.status(502).json({
          error: 'Unable to obtain current market price.'
        });
      }

      executionPrice = parseFloat(
        quote.close ??
        quote.price ??
        quote.last
      );
    }

    if (
      Number.isNaN(executionPrice) ||
      executionPrice <= 0
    ) {
      return res.status(502).json({
        error: 'Market provider returned an invalid price.'
      });
    }

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
    // RESPONSE
    // ========================================================

    res.json({
      ...simulationUserStorage,
      execution: {
        ticker: normalizedTicker,
        shares: targetShares,
        type,
        executionPrice,
        total: transactionTotalCost,
        currency: quote?.currency || null,
        exchange: quote?.exchange || null,
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

  console.log(
    `💾 Market cache duration: ${MARKET_CACHE_DURATION / 1000}s`
  );
});