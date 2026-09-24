require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

const PORT = process.env.PORT || 5000;

const TWELVE_DATA_API_KEY =
  process.env.TWELVE_DATA_API_KEY;

const TWELVE_DATA_BASE_URL =
  'https://api.twelvedata.com';


// ============================================================
// APPLICATION CONFIGURATION
// ============================================================

app.use(cors());

app.use(
  express.json({
    limit: '1mb',
  })
);


// ============================================================
// API KEY CHECK
// ============================================================

if (!TWELVE_DATA_API_KEY) {
  console.warn(
    '⚠️ TWELVE_DATA_API_KEY is not configured.'
  );
}


// ============================================================
// SIMULATION USER LEDGER
// ============================================================

let simulationUserStorage = {
  username: 'Simulation_Trader_One',

  cashBalance: 100000.00,

  initialCapital: 100000.00,

  portfolio: [
    {
      ticker: 'AAPL',
      shares: 10,
      avgPrice: 175.50,
      exchange: 'NASDAQ',
      currency: 'USD',
    },

    {
      ticker: 'NVDA',
      shares: 5,
      avgPrice: 850.00,
      exchange: 'NASDAQ',
      currency: 'USD',
    },
  ],
};


// ============================================================
// DEFAULT MARKET FEED
// ============================================================
//
// IMPORTANT:
//
// The frontend currently calls:
//
// /api/stocks/market-feed
//
// Therefore this default feed preserves compatibility.
//
// We intentionally keep this list small because every external
// quote request can consume provider API credits.
//
// Users can search for additional securities globally using:
//
// /api/stocks/search?q=
//
// ============================================================

const DEFAULT_MARKET_FEED = [
  {
    ticker: 'AAPL',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'TSLA',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'NVDA',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'AMZN',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'MSFT',
    exchange: 'NASDAQ',
  },

  {
    ticker: 'INFY',
    exchange: 'NSE',
  },
];


// ============================================================
// CACHE CONFIGURATION
// ============================================================
//
// Quotes are cached for 60 seconds.
//
// Search results are cached for 10 minutes.
//
// This prevents NUMORA from repeatedly hitting Twelve Data
// unnecessarily.
//
// ============================================================

const QUOTE_CACHE_DURATION =
  60 * 1000;

const SEARCH_CACHE_DURATION =
  10 * 60 * 1000;

const quoteCache = new Map();

const searchCache = new Map();


// ============================================================
// REQUEST STATE
// ============================================================
//
// Prevent duplicate requests for the same symbol when several
// frontend requests arrive at almost the same time.
//
// ============================================================

const quoteRefreshPromises = new Map();


// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function normalizeSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}


function normalizeExchange(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}


function safeNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function createCacheKey(
  symbol,
  exchange = ''
) {
  return `${normalizeSymbol(symbol)}|${normalizeExchange(exchange)}`;
}


function isCacheFresh(timestamp, duration) {
  return (
    timestamp &&
    Date.now() - timestamp < duration
  );
}


// ============================================================
// TWELVE DATA REQUEST
// ============================================================

async function requestTwelveData(
  endpoint,
  params = {}
) {
  if (!TWELVE_DATA_API_KEY) {
    throw new Error(
      'Twelve Data API key is not configured.'
    );
  }

  const response = await axios.get(
    `${TWELVE_DATA_BASE_URL}${endpoint}`,
    {
      params: {
        ...params,
        apikey: TWELVE_DATA_API_KEY,
      },

      timeout: 15000,
    }
  );

  const data = response.data;

  if (
    data &&
    data.status === 'error'
  ) {
    throw new Error(
      data.message ||
      'Twelve Data returned an error.'
    );
  }

  return data;
}


// ============================================================
// RAW QUOTE REQUEST
// ============================================================

async function requestRawQuote(
  symbol,
  exchange = ''
) {
  const normalizedSymbol =
    normalizeSymbol(symbol);

  const normalizedExchange =
    normalizeExchange(exchange);

  const params = {
    symbol: normalizedSymbol,
  };

  if (normalizedExchange) {
    params.exchange = normalizedExchange;
  }

  return requestTwelveData(
    '/quote',
    params
  );
}


// ============================================================
// NORMALIZE QUOTE
// ============================================================
//
// Converts Twelve Data's response into one consistent NUMORA
// market-data format.
//
// ============================================================

function normalizeQuote(
  quote,
  requestedSymbol,
  requestedExchange = ''
) {
  const symbol =
    normalizeSymbol(
      quote?.symbol ||
      requestedSymbol
    );

  const exchange =
    quote?.exchange ||
    requestedExchange ||
    null;

  const price =
    safeNumber(
      quote?.close ??
      quote?.price ??
      quote?.last
    );

  const previousClose =
    safeNumber(
      quote?.previous_close ??
      quote?.previousClose
    );

  let change =
    safeNumber(
      quote?.change
    );

  let changePercent =
    safeNumber(
      quote?.percent_change ??
      quote?.change_percent ??
      quote?.changePercent
    );

  // Calculate change when provider does not return it.
  if (
    change === null &&
    price !== null &&
    previousClose !== null
  ) {
    change =
      price - previousClose;
  }

  // Calculate percentage change when necessary.
  if (
    changePercent === null &&
    change !== null &&
    previousClose !== null &&
    previousClose !== 0
  ) {
    changePercent =
      (change / previousClose) * 100;
  }

  return {
    symbol,

    name:
      quote?.name ||
      quote?.instrument_name ||
      symbol,

    exchange,

    country:
      quote?.country ||
      null,

    currency:
      quote?.currency ||
      null,

    type:
      quote?.type ||
      quote?.instrument_type ||
      'Common Stock',

    price,

    open:
      safeNumber(
        quote?.open
      ),

    high:
      safeNumber(
        quote?.high
      ),

    low:
      safeNumber(
        quote?.low
      ),

    previousClose,

    change,

    changePercent,

    volume:
      safeNumber(
        quote?.volume
      ),

    averageVolume:
      safeNumber(
        quote?.average_volume
      ),

    fiftyTwoWeekHigh:
      safeNumber(
        quote?.fifty_two_week?.high ??
        quote?.fifty_two_week_high
      ),

    fiftyTwoWeekLow:
      safeNumber(
        quote?.fifty_two_week?.low ??
        quote?.fifty_two_week_low
      ),

    isMarketOpen:
      typeof quote?.is_market_open ===
      'boolean'
        ? quote.is_market_open
        : null,

    datetime:
      quote?.datetime ||
      null,

    timestamp:
      quote?.timestamp ||
      new Date().toISOString(),

    provider:
      'Twelve Data',

    dataStatus:
      'provider-quote',
  };
}


// ============================================================
// GET QUOTE WITH CACHE
// ============================================================

async function getNormalizedQuote(
  symbol,
  exchange = '',
  options = {}
) {
  const {
    allowStale = false,
  } = options;

  const normalizedSymbol =
    normalizeSymbol(symbol);

  const normalizedExchange =
    normalizeExchange(exchange);

  if (!normalizedSymbol) {
    throw new Error(
      'Stock symbol is required.'
    );
  }

  const cacheKey =
    createCacheKey(
      normalizedSymbol,
      normalizedExchange
    );

  const cached =
    quoteCache.get(cacheKey);

  // ----------------------------------------------------------
  // RETURN FRESH CACHE
  // ----------------------------------------------------------

  if (
    cached &&
    isCacheFresh(
      cached.timestamp,
      QUOTE_CACHE_DURATION
    )
  ) {
    return {
      ...cached.data,
      cache: {
        hit: true,
        stale: false,
        cachedAt:
          new Date(
            cached.timestamp
          ).toISOString(),
      },
    };
  }

  // ----------------------------------------------------------
  // PREVENT DUPLICATE REFRESHES
  // ----------------------------------------------------------

  if (
    quoteRefreshPromises.has(cacheKey)
  ) {
    try {
      return await quoteRefreshPromises.get(
        cacheKey
      );
    } catch (error) {
      if (
        allowStale &&
        cached
      ) {
        return {
          ...cached.data,

          cache: {
            hit: true,
            stale: true,
            cachedAt:
              new Date(
                cached.timestamp
              ).toISOString(),
          },
        };
      }

      throw error;
    }
  }

  // ----------------------------------------------------------
  // REFRESH PROVIDER DATA
  // ----------------------------------------------------------

  const refreshPromise =
    (async () => {
      try {
        const rawQuote =
          await requestRawQuote(
            normalizedSymbol,
            normalizedExchange
          );

        const normalizedQuote =
          normalizeQuote(
            rawQuote,
            normalizedSymbol,
            normalizedExchange
          );

        if (
          normalizedQuote.price === null
        ) {
          throw new Error(
            'Market provider returned no usable price.'
          );
        }

        const timestamp =
          Date.now();

        quoteCache.set(
          cacheKey,
          {
            data: normalizedQuote,
            timestamp,
          }
        );

        return {
          ...normalizedQuote,

          cache: {
            hit: false,
            stale: false,
            cachedAt:
              new Date(
                timestamp
              ).toISOString(),
          },
        };
      } catch (error) {
        // ----------------------------------------------------
        // USE OLD CACHE FOR MARKET FEED RESILIENCE
        // ----------------------------------------------------

        if (
          allowStale &&
          cached
        ) {
          console.warn(
            `Using cached quote for ${normalizedSymbol}:`,
            error.message
          );

          return {
            ...cached.data,

            cache: {
              hit: true,
              stale: true,
              cachedAt:
                new Date(
                  cached.timestamp
                ).toISOString(),
            },
          };
        }

        throw error;
      } finally {
        quoteRefreshPromises.delete(
          cacheKey
        );
      }
    })();

  quoteRefreshPromises.set(
    cacheKey,
    refreshPromise
  );

  return refreshPromise;
}


// ============================================================
// SEARCH RESULT NORMALIZATION
// ============================================================

function normalizeSearchResult(
  item
) {
  return {
    symbol:
      item?.symbol ||
      null,

    name:
      item?.instrument_name ||
      item?.name ||
      item?.symbol ||
      null,

    exchange:
      item?.exchange ||
      null,

    micCode:
      item?.mic_code ||
      null,

    exchangeTimezone:
      item?.exchange_timezone ||
      null,

    country:
      item?.country ||
      null,

    currency:
      item?.currency ||
      null,

    type:
      item?.instrument_type ||
      item?.type ||
      null,

    provider:
      'Twelve Data',
  };
}


// ============================================================
// SEARCH SECURITIES
// ============================================================

async function searchSecurities(
  query
) {
  const normalizedQuery =
    String(query || '')
      .trim();

  if (
    normalizedQuery.length < 1
  ) {
    throw new Error(
      'Search query is required.'
    );
  }

  if (
    normalizedQuery.length > 100
  ) {
    throw new Error(
      'Search query is too long.'
    );
  }

  const cacheKey =
    normalizedQuery.toLowerCase();

  const cached =
    searchCache.get(cacheKey);

  if (
    cached &&
    isCacheFresh(
      cached.timestamp,
      SEARCH_CACHE_DURATION
    )
  ) {
    return {
      ...cached.data,
      cache: {
        hit: true,
        stale: false,
      },
    };
  }

  const response =
    await requestTwelveData(
      '/symbol_search',
      {
        symbol: normalizedQuery,
      }
    );

  const rawResults =
    Array.isArray(response?.data)
      ? response.data
      : [];

  const results =
    rawResults
      .map(normalizeSearchResult)
      .filter(
        item =>
          item.symbol &&
          item.name
      );

  const result =
    {
      query: normalizedQuery,

      count:
        results.length,

      results,

      provider:
        'Twelve Data',

      timestamp:
        new Date().toISOString(),
    };

  searchCache.set(
    cacheKey,
    {
      data: result,
      timestamp: Date.now(),
    }
  );

  return {
    ...result,

    cache: {
      hit: false,
      stale: false,
    },
  };
}


// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  '/',
  (req, res) => {
    res.json({
      status: 'online',

      service:
        'NUMORA PRO Market Engine',

      marketData:
        'Twelve Data',

      version:
        '2.0.0',

      capabilities: [
        'Global security search',
        'Normalized quotes',
        'Market feed',
        'Quote caching',
        'Search caching',
        'Simulated trading',
      ],
    });
  }
);


// ============================================================
// MARKET DATA STATUS
// ============================================================

app.get(
  '/api/stocks/status',
  (req, res) => {
    res.json({
      provider:
        'Twelve Data',

      configured:
        Boolean(
          TWELVE_DATA_API_KEY
        ),

      quoteCacheEntries:
        quoteCache.size,

      searchCacheEntries:
        searchCache.size,

      quoteCacheDurationMs:
        QUOTE_CACHE_DURATION,

      searchCacheDurationMs:
        SEARCH_CACHE_DURATION,

      timestamp:
        new Date().toISOString(),
    });
  }
);


// ============================================================
// MARKET FEED
// ============================================================
//
// Existing frontend compatibility:
//
// GET /api/stocks/market-feed
//
// returns:
//
// {
//   AAPL: 337.02,
//   TSLA: 380.12
// }
//
// New detailed mode:
//
// GET /api/stocks/market-feed?symbols=AAPL,INFY&details=true
//
// returns normalized security objects.
//
// ============================================================

app.get(
  '/api/stocks/market-feed',
  async (req, res) => {
    try {
      let requestedSymbols =
        req.query.symbols;

      let instruments;

      // --------------------------------------------------------
      // CUSTOM SYMBOL LIST
      // --------------------------------------------------------

      if (requestedSymbols) {
        const symbols =
          String(requestedSymbols)
            .split(',')
            .map(
              item =>
                item.trim()
            )
            .filter(Boolean)
            .slice(0, 25);

        instruments =
          symbols.map(
            symbol => ({
              ticker:
                normalizeSymbol(
                  symbol
                ),

              exchange:
                '',
            })
          );
      }

      // --------------------------------------------------------
      // DEFAULT NUMORA FEED
      // --------------------------------------------------------

      else {
        instruments =
          DEFAULT_MARKET_FEED;
      }

      const detailedResults =
        [];

      const legacyResults =
        {};

      // --------------------------------------------------------
      // SEQUENTIAL REQUESTS
      // --------------------------------------------------------
      //
      // Deliberately sequential to avoid sending a large burst
      // of provider requests.
      //
      // --------------------------------------------------------

      for (
        const instrument of instruments
      ) {
        try {
          const quote =
            await getNormalizedQuote(
              instrument.ticker,
              instrument.exchange,
              {
                allowStale: true,
              }
            );

          if (
            quote.price !== null
          ) {
            legacyResults[
              instrument.ticker
            ] =
              quote.price;

            detailedResults.push(
              quote
            );
          }
        } catch (error) {
          console.error(
            `Market data error for ${instrument.ticker}:`,
            error.message
          );
        }
      }

      // --------------------------------------------------------
      // DETAILED MODE
      // --------------------------------------------------------

      const detailed =
        String(
          req.query.details || ''
        ).toLowerCase() ===
        'true';

      if (detailed) {
        return res.json({
          data:
            detailedResults,

          count:
            detailedResults.length,

          requested:
            instruments.length,

          provider:
            'Twelve Data',

          timestamp:
            new Date().toISOString(),
        });
      }

      // --------------------------------------------------------
      // LEGACY FRONTEND MODE
      // --------------------------------------------------------

      return res.json(
        legacyResults
      );

    } catch (error) {
      console.error(
        'Market feed error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Unable to retrieve market data.',
      });
    }
  }
);


// ============================================================
// SINGLE STOCK QUOTE
// ============================================================
//
// Example:
//
// /api/stocks/quote?symbol=AAPL&exchange=NASDAQ
//
// ============================================================

app.get(
  '/api/stocks/quote',
  async (req, res) => {
    try {
      const symbol =
        normalizeSymbol(
          req.query.symbol
        );

      const exchange =
        normalizeExchange(
          req.query.exchange
        );

      if (!symbol) {
        return res.status(400).json({
          error:
            'Stock symbol is required.',
        });
      }

      const quote =
        await getNormalizedQuote(
          symbol,
          exchange,
          {
            allowStale: false,
          }
        );

      return res.json(
        quote
      );

    } catch (error) {
      console.error(
        'Quote error:',
        error.message
      );

      return res.status(502).json({
        error:
          'Unable to retrieve stock quote.',

        details:
          error.message,
      });
    }
  }
);


// ============================================================
// GLOBAL SECURITY SEARCH
// ============================================================
//
// Example:
//
// /api/stocks/search?q=tesla
//
// ============================================================

app.get(
  '/api/stocks/search',
  async (req, res) => {
    try {
      const query =
        String(
          req.query.q || ''
        ).trim();

      if (!query) {
        return res.status(400).json({
          error:
            'Search query is required.',
        });
      }

      const result =
        await searchSecurities(
          query
        );

      return res.json(
        result
      );

    } catch (error) {
      console.error(
        'Symbol search error:',
        error.message
      );

      return res.status(502).json({
        error:
          'Unable to search market securities.',

        details:
          error.message,
      });
    }
  }
);


// ============================================================
// SECURITY METADATA
// ============================================================
//
// This endpoint searches for a security and returns the best
// matching identity information.
//
// Example:
//
// /api/stocks/metadata?symbol=INFY&exchange=NSE
//
// ============================================================

app.get(
  '/api/stocks/metadata',
  async (req, res) => {
    try {
      const symbol =
        normalizeSymbol(
          req.query.symbol
        );

      const exchange =
        normalizeExchange(
          req.query.exchange
        );

      if (!symbol) {
        return res.status(400).json({
          error:
            'Stock symbol is required.',
        });
      }

      const searchResult =
        await searchSecurities(
          symbol
        );

      let matches =
        searchResult.results;

      // --------------------------------------------------------
      // Prefer exact symbol
      // --------------------------------------------------------

      matches =
        matches.sort(
          (a, b) => {
            const aExact =
              normalizeSymbol(
                a.symbol
              ) === symbol
                ? 1
                : 0;

            const bExact =
              normalizeSymbol(
                b.symbol
              ) === symbol
                ? 1
                : 0;

            return (
              bExact -
              aExact
            );
          }
        );

      // --------------------------------------------------------
      // Prefer requested exchange
      // --------------------------------------------------------

      if (exchange) {
        const exchangeMatches =
          matches.filter(
            item =>
              normalizeExchange(
                item.exchange
              ) === exchange
          );

        if (
          exchangeMatches.length
        ) {
          matches =
            exchangeMatches;
        }
      }

      if (!matches.length) {
        return res.status(404).json({
          error:
            'Security not found.',
        });
      }

      return res.json({
        security:
          matches[0],

        alternatives:
          matches.slice(
            1,
            10
          ),

        provider:
          'Twelve Data',

        timestamp:
          new Date().toISOString(),
      });

    } catch (error) {
      console.error(
        'Metadata error:',
        error.message
      );

      return res.status(502).json({
        error:
          'Unable to retrieve security metadata.',

        details:
          error.message,
      });
    }
  }
);


// ============================================================
// USER PROFILE
// ============================================================

app.get(
  '/api/users/profile',
  (req, res) => {
    res.json(
      simulationUserStorage
    );
  }
);


// ============================================================
// TRADE EXECUTION
// ============================================================
//
// IMPORTANT:
//
// This is a SIMULATION.
//
// No real brokerage order is sent.
//
// The backend obtains the market price itself rather than
// trusting a price supplied by the frontend.
//
// ============================================================

app.post(
  '/api/trade/execute',
  async (req, res) => {
    try {
      const {
        ticker,
        shares,
        type,
        exchange,
      } = req.body;

      const normalizedTicker =
        normalizeSymbol(
          ticker
        );

      const normalizedExchange =
        normalizeExchange(
          exchange
        );

      const targetShares =
        Number.parseInt(
          shares,
          10
        );

      const normalizedType =
        String(
          type || ''
        ).toUpperCase();

      // --------------------------------------------------------
      // VALIDATION
      // --------------------------------------------------------

      if (
        !normalizedTicker
      ) {
        return res.status(400).json({
          error:
            'Order rejected: Stock symbol is required.',
        });
      }

      if (
        Number.isNaN(
          targetShares
        ) ||
        targetShares <= 0
      ) {
        return res.status(400).json({
          error:
            'Order rejected: Invalid share quantity.',
        });
      }

      if (
        ![
          'BUY',
          'SELL',
        ].includes(
          normalizedType
        )
      ) {
        return res.status(400).json({
          error:
            'Order rejected: Unsupported transaction type.',
        });
      }

      // --------------------------------------------------------
      // BACKEND-AUTHORITATIVE MARKET PRICE
      // --------------------------------------------------------

      let quote;

      try {
        quote =
          await getNormalizedQuote(
            normalizedTicker,
            normalizedExchange,
            {
              allowStale: false,
            }
          );
      } catch (error) {
        return res.status(502).json({
          error:
            'Unable to obtain current market price.',

          details:
            error.message,
        });
      }

      const executionPrice =
        safeNumber(
          quote.price
        );

      if (
        executionPrice === null ||
        executionPrice <= 0
      ) {
        return res.status(502).json({
          error:
            'Market provider returned an invalid price.',
        });
      }

      const transactionTotalCost =
        executionPrice *
        targetShares;

      // ======================================================
      // BUY
      // ======================================================

      if (
        normalizedType === 'BUY'
      ) {
        if (
          simulationUserStorage.cashBalance <
          transactionTotalCost
        ) {
          return res.status(400).json({
            error:
              'Order rejected: Insufficient simulated investment capital balance.',
          });
        }

        simulationUserStorage.cashBalance -=
          transactionTotalCost;

        const portfolioIndex =
          simulationUserStorage.portfolio.findIndex(
            item =>
              item.ticker ===
              normalizedTicker
          );

        if (
          portfolioIndex > -1
        ) {
          const position =
            simulationUserStorage
              .portfolio[
                portfolioIndex
              ];

          const newTotalShares =
            position.shares +
            targetShares;

          position.avgPrice =
            (
              (
                position.avgPrice *
                position.shares
              ) +
              transactionTotalCost
            ) /
            newTotalShares;

          position.shares =
            newTotalShares;

          if (
            normalizedExchange
          ) {
            position.exchange =
              normalizedExchange;
          }

          if (
            quote.currency
          ) {
            position.currency =
              quote.currency;
          }
        } else {
          simulationUserStorage.portfolio.push(
            {
              ticker:
                normalizedTicker,

              shares:
                targetShares,

              avgPrice:
                executionPrice,

              exchange:
                quote.exchange ||
                normalizedExchange ||
                null,

              currency:
                quote.currency ||
                null,
            }
          );
        }
      }

      // ======================================================
      // SELL
      // ======================================================

      else if (
        normalizedType === 'SELL'
      ) {
        const portfolioIndex =
          simulationUserStorage.portfolio.findIndex(
            item =>
              item.ticker ===
              normalizedTicker
          );

        if (
          portfolioIndex === -1 ||
          simulationUserStorage
            .portfolio[
              portfolioIndex
            ]
            .shares <
            targetShares
        ) {
          return res.status(400).json({
            error:
              'Order rejected: Insufficient asset allocation quantities.',
          });
        }

        simulationUserStorage.cashBalance +=
          transactionTotalCost;

        simulationUserStorage
          .portfolio[
            portfolioIndex
          ]
          .shares -=
          targetShares;

        if (
          simulationUserStorage
            .portfolio[
              portfolioIndex
            ]
            .shares === 0
        ) {
          simulationUserStorage
            .portfolio.splice(
              portfolioIndex,
              1
            );
        }
      }

      // ======================================================
      // RESPONSE
      // ======================================================

      return res.json({
        ...simulationUserStorage,

        execution: {
          ticker:
            normalizedTicker,

          shares:
            targetShares,

          type:
            normalizedType,

          executionPrice,

          total:
            transactionTotalCost,

          currency:
            quote.currency ||
            null,

          exchange:
            quote.exchange ||
            normalizedExchange ||
            null,

          provider:
            quote.provider,

          dataStatus:
            quote.dataStatus,

          timestamp:
            new Date().toISOString(),
        },
      });

    } catch (error) {
      console.error(
        'Trade execution error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Internal trade execution error.',
      });
    }
  }
);


// ============================================================
// 404 HANDLER
// ============================================================

app.use(
  (req, res) => {
    res.status(404).json({
      error:
        'NUMORA API endpoint not found.',
    });
  }
);


// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      'Unhandled server error:',
      error
    );

    res.status(500).json({
      error:
        'Internal server error.',
    });
  }
);


// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  () => {
    console.log(
      `🚀 NUMORA PRO market engine running on port ${PORT}`
    );

    console.log(
      '📡 Market provider: Twelve Data'
    );

    console.log(
      `🌍 Global security search: ENABLED`
    );

    console.log(
      `💾 Quote cache: ${QUOTE_CACHE_DURATION / 1000}s`
    );

    console.log(
      `🔎 Search cache: ${SEARCH_CACHE_DURATION / 1000 / 60}min`
    );
  }
);