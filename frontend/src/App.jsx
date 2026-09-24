import React, { useCallback, useEffect, useRef, useState } from 'react';

/*
|--------------------------------------------------------------------------
| API CONFIGURATION
|--------------------------------------------------------------------------
| Replace this with your actual Render backend URL.
|
| Example:
| const BACKEND_BASE_URL = 'https://numora-backend.onrender.com';
|--------------------------------------------------------------------------
*/

const BACKEND_BASE_URL = 'https://stock-market-dashboard-1-vvv9.onrender.com';

const INITIAL_CAPITAL = 100000;

/*
|--------------------------------------------------------------------------
| TradingView Advanced Chart
|--------------------------------------------------------------------------
*/

function TradingViewChart({ symbol }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !symbol) return;

    const container = containerRef.current;

    // Clear previous widget
    container.innerHTML = '';

    const widgetContainer = document.createElement('div');
    widgetContainer.className =
      'tradingview-widget-container__widget';

    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';

    container.appendChild(widgetContainer);

    const script = document.createElement('script');

    script.src =
      'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

    script.type = 'text/javascript';
    script.async = true;

    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: `NASDAQ:${symbol}`,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      calendar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_side_toolbar: false,
      save_image: false,
      support_host: 'https://www.tradingview.com',
    });

    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [symbol]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container"
      style={{
        height: '450px',
        width: '100%',
      }}
    />
  );
}

/*
|--------------------------------------------------------------------------
| Main Application
|--------------------------------------------------------------------------
*/

function App() {
  /*
  |--------------------------------------------------------------------------
  | User / Portfolio State
  |--------------------------------------------------------------------------
  */

  const [userData, setUserData] = useState({
    cashBalance: INITIAL_CAPITAL,
    initialCapital: INITIAL_CAPITAL,
    portfolio: [],
  });

  /*
  |--------------------------------------------------------------------------
  | Market State
  |--------------------------------------------------------------------------
  */

  const [marketPrices, setMarketPrices] = useState({});
  const [priceDirections, setPriceDirections] = useState({});
  const previousPricesRef = useRef({});

  /*
  |--------------------------------------------------------------------------
  | Trading State
  |--------------------------------------------------------------------------
  */

  const [tradeQuantities, setTradeQuantities] = useState({});

  /*
  |--------------------------------------------------------------------------
  | UI State
  |--------------------------------------------------------------------------
  */

  const [activeChartSymbol, setActiveChartSymbol] =
    useState('AAPL');

  const [feedbackMessage, setFeedbackMessage] = useState({
    text: '',
    isError: false,
  });

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingMarket, setLoadingMarket] = useState(true);
  const [executingTrade, setExecutingTrade] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Generic API Helper
  |--------------------------------------------------------------------------
  */

  const apiRequest = useCallback(async (endpoint, options = {}) => {
    const response = await fetch(
      `${BACKEND_BASE_URL}${endpoint}`,
      {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      }
    );

    const contentType =
      response.headers.get('content-type') || '';

    let data;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errorMessage =
        typeof data === 'object' && data?.error
          ? data.error
          : `Request failed with HTTP ${response.status}`;

      throw new Error(errorMessage);
    }

    return data;
  }, []);

  /*
  |--------------------------------------------------------------------------
  | Feedback Helper
  |--------------------------------------------------------------------------
  */

  const showFeedback = useCallback(
    (text, isError = false) => {
      setFeedbackMessage({
        text,
        isError,
      });

      window.setTimeout(() => {
        setFeedbackMessage({
          text: '',
          isError: false,
        });
      }, 5000);
    },
    []
  );

  /*
  |--------------------------------------------------------------------------
  | Fetch User Profile
  |--------------------------------------------------------------------------
  */

  const fetchUserLedgerProfile = useCallback(async () => {
    try {
      setLoadingProfile(true);

      const data = await apiRequest('/api/users/profile');

      if (!data || typeof data !== 'object') {
        throw new Error(
          'Invalid profile response received from server.'
        );
      }

      setUserData((previous) => ({
        ...previous,
        ...data,
        cashBalance:
          Number(data.cashBalance ?? previous.cashBalance),

        initialCapital:
          Number(
            data.initialCapital ??
              previous.initialCapital ??
              INITIAL_CAPITAL
          ),

        portfolio: Array.isArray(data.portfolio)
          ? data.portfolio
          : [],
      }));
    } catch (error) {
      console.error('Profile API failure:', error);

      showFeedback(
        `Unable to load account profile: ${error.message}`,
        true
      );
    } finally {
      setLoadingProfile(false);
    }
  }, [apiRequest, showFeedback]);

  /*
  |--------------------------------------------------------------------------
  | Fetch Live Market Feed
  |--------------------------------------------------------------------------
  */

  const fetchLiveMarketFeed = useCallback(async () => {
    try {
      const data = await apiRequest(
        '/api/stocks/market-feed'
      );

      if (!data || typeof data !== 'object') {
        throw new Error(
          'Invalid market feed received from server.'
        );
      }

      const normalizedPrices = {};

      Object.entries(data).forEach(
        ([ticker, price]) => {
          const numericPrice = Number(price);

          if (
            Number.isFinite(numericPrice) &&
            numericPrice >= 0
          ) {
            normalizedPrices[ticker] = numericPrice;
          }
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Detect price direction
      |--------------------------------------------------------------------------
      */

      setPriceDirections((previousDirections) => {
        const nextDirections = {
          ...previousDirections,
        };

        Object.entries(normalizedPrices).forEach(
          ([ticker, newPrice]) => {
            const previousPrice =
              previousPricesRef.current[ticker];

            if (previousPrice !== undefined) {
              if (newPrice > previousPrice) {
                nextDirections[ticker] = 'up';
              } else if (newPrice < previousPrice) {
                nextDirections[ticker] = 'down';
              }
            }
          }
        );

        return nextDirections;
      });

      previousPricesRef.current =
        normalizedPrices;

      setMarketPrices(normalizedPrices);
    } catch (error) {
      console.error('Market feed failure:', error);

      showFeedback(
        `Market feed unavailable: ${error.message}`,
        true
      );
    } finally {
      setLoadingMarket(false);
    }
  }, [apiRequest, showFeedback]);

  /*
  |--------------------------------------------------------------------------
  | Initial Data Loading + Polling
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    fetchUserLedgerProfile();
    fetchLiveMarketFeed();

    const interval = window.setInterval(
      fetchLiveMarketFeed,
      4000
    );

    return () => {
      window.clearInterval(interval);
    };
  }, [
    fetchUserLedgerProfile,
    fetchLiveMarketFeed,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Trade Quantity Change
  |--------------------------------------------------------------------------
  */

  const handleQuantityChange = (
    ticker,
    value
  ) => {
    /*
    |--------------------------------------------------------------------------
    | Allow empty input while typing
    |--------------------------------------------------------------------------
    */

    if (value === '') {
      setTradeQuantities((previous) => ({
        ...previous,
        [ticker]: '',
      }));

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Only positive integer values
    |--------------------------------------------------------------------------
    */

    if (!/^\d+$/.test(value)) {
      return;
    }

    setTradeQuantities((previous) => ({
      ...previous,
      [ticker]: value,
    }));
  };

  /*
  |--------------------------------------------------------------------------
  | Execute Trade
  |--------------------------------------------------------------------------
  */

  const handleTradeExecution = async (
    ticker,
    orderType
  ) => {
    const rawQuantity =
      tradeQuantities[ticker];

    const quantity = Number.parseInt(
      rawQuantity,
      10
    );

    /*
    |--------------------------------------------------------------------------
    | Quantity Validation
    |--------------------------------------------------------------------------
    */

    if (
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      showFeedback(
        'Error: Volume units must be a positive integer.',
        true
      );

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Check Market Price
    |--------------------------------------------------------------------------
    */

    const currentPrice =
      Number(marketPrices[ticker]);

    if (
      !Number.isFinite(currentPrice) ||
      currentPrice <= 0
    ) {
      showFeedback(
        `No valid market price is available for ${ticker}.`,
        true
      );

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | Prevent duplicate orders
    |--------------------------------------------------------------------------
    */

    if (executingTrade) {
      return;
    }

    try {
      setExecutingTrade(true);

      /*
      |--------------------------------------------------------------------------
      | Send Order
      |--------------------------------------------------------------------------
      |
      | NOTE:
      | The backend should independently validate the authoritative price.
      |--------------------------------------------------------------------------
      */

      const result = await apiRequest(
        '/api/trade/execute',
        {
          method: 'POST',

          body: JSON.stringify({
            ticker,
            shares: quantity,
            type: orderType,

            /*
            | This is supplied for simulation compatibility.
            | Backend should NOT blindly trust it.
            */
            currentPrice,
          }),
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Update Portfolio
      |--------------------------------------------------------------------------
      */

      if (
        result &&
        typeof result === 'object'
      ) {
        setUserData((previous) => ({
          ...previous,
          ...result,

          cashBalance:
            Number(
              result.cashBalance ??
                previous.cashBalance
            ),

          initialCapital:
            Number(
              result.initialCapital ??
                previous.initialCapital ??
                INITIAL_CAPITAL
            ),

          portfolio: Array.isArray(
            result.portfolio
          )
            ? result.portfolio
            : previous.portfolio,
        }));
      }

      /*
      |--------------------------------------------------------------------------
      | Clear Input
      |--------------------------------------------------------------------------
      */

      setTradeQuantities((previous) => ({
        ...previous,
        [ticker]: '',
      }));

      showFeedback(
        `Filled: ${orderType} ${quantity} shares of ${ticker} completed.`,
        false
      );
    } catch (error) {
      console.error(
        'Trade execution failure:',
        error
      );

      showFeedback(
        `Order blocked: ${error.message}`,
        true
      );
    } finally {
      setExecutingTrade(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Portfolio Calculations
  |--------------------------------------------------------------------------
  */

  const portfolio =
    Array.isArray(userData.portfolio)
      ? userData.portfolio
      : [];

  const cashBalance =
    Number(userData.cashBalance) || 0;

  const initialCapital =
    Number(
      userData.initialCapital ||
        INITIAL_CAPITAL
    );

  /*
  |--------------------------------------------------------------------------
  | Holdings Valuation
  |--------------------------------------------------------------------------
  */

  const holdingsValue =
    portfolio.reduce(
      (total, position) => {
        const shares =
          Number(position.shares) || 0;

        const averagePrice =
          Number(position.avgPrice) || 0;

        const marketPrice =
          Number(
            marketPrices[position.ticker]
          );

        const spotPrice =
          Number.isFinite(marketPrice) &&
          marketPrice > 0
            ? marketPrice
            : averagePrice;

        return (
          total +
          shares * spotPrice
        );
      },
      0
    );

  /*
  |--------------------------------------------------------------------------
  | Net Asset Worth
  |--------------------------------------------------------------------------
  */

  const netAssetWorth =
    cashBalance + holdingsValue;

  /*
  |--------------------------------------------------------------------------
  | ROI
  |--------------------------------------------------------------------------
  */

  const netROI =
    initialCapital > 0
      ? (
          ((netAssetWorth -
            initialCapital) /
            initialCapital) *
          100
        ).toFixed(2)
      : '0.00';

  const numericROI =
    Number(netROI);

  /*
  |--------------------------------------------------------------------------
  | Render
  |--------------------------------------------------------------------------
  */

  return (
    <div className="terminal-workspace">

      {/* ================================================================
          NAVBAR
      ================================================================= */}

      <header className="terminal-navbar">

        <div className="brand-title">
          ⚡ NUMORA PRO // TERMINAL
        </div>

        <div className="operator-tag">
          SYSTEM LEDGER STATE: LIVE
        </div>

      </header>

      {/* ================================================================
          FEEDBACK
      ================================================================= */}

      {feedbackMessage.text && (
        <div
          className="system-banner-alert"
          style={{
            borderLeftColor:
              feedbackMessage.isError
                ? '#ef4444'
                : '#10b981',
          }}
        >
          {feedbackMessage.text}
        </div>
      )}

      {/* ================================================================
          METRICS
      ================================================================= */}

      <section className="metrics-row">

        {/* Net Worth */}

        <div className="metric-box">

          <span className="box-label">
            Net Asset Worth Valuation
          </span>

          <h2 className="box-value">
            $
            {netAssetWorth.toLocaleString(
              undefined,
              {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }
            )}
          </h2>

        </div>

        {/* Cash */}

        <div className="metric-box">

          <span className="box-label">
            Liquid Sim Reserve Capital
          </span>

          <h2
            className="box-value"
            style={{
              color: '#38bdf8',
            }}
          >
            $
            {cashBalance.toLocaleString(
              undefined,
              {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }
            )}
          </h2>

        </div>

        {/* ROI */}

        <div className="metric-box">

          <span className="box-label">
            Net Return Investment Metrics
            (ROI)
          </span>

          <h2
            className="box-value"
            style={{
              color:
                numericROI >= 0
                  ? '#10b981'
                  : '#ef4444',
            }}
          >
            {numericROI >= 0
              ? '▲'
              : '▼'}{' '}
            {netROI}%
          </h2>

        </div>

      </section>

      {/* ================================================================
          MAIN GRID
      ================================================================= */}

      <div className="terminal-layout-grid">

        {/* ==============================================================
            MAIN PANEL
        ============================================================== */}

        <div className="main-layout-panel">

          {/* ============================================================
              CHART
          ============================================================ */}

          <div className="panel-card chart-container-card">

            <div className="chart-header-row">

              <h3>
                📊 Interactive Technical
                Analysis Canvas
              </h3>

              <div className="active-ticker-badge">
                Viewing Core Index:{' '}
                <strong>
                  {activeChartSymbol}
                </strong>
              </div>

            </div>

            <TradingViewChart
              symbol={activeChartSymbol}
            />

          </div>

          {/* ============================================================
              MARKET BOARD
          ============================================================ */}

          <div className="panel-card">

            <h3>
              📈 Live Securities Stream
              Board
            </h3>

            <p className="subtitle-tag">
              Click any security row to
              render its technical chart.
            </p>

            {loadingMarket ? (
              <div className="loading-state">
                Loading live market feed...
              </div>
            ) : Object.keys(
                marketPrices
              ).length === 0 ? (
              <div className="empty-msg">
                No market securities are
                currently available.
              </div>
            ) : (
              <div className="table-responsive">

                <table>

                  <thead>

                    <tr>

                      <th>
                        Asset Ticker
                      </th>

                      <th>
                        Spot Value Price
                      </th>

                      <th>
                        Execution Panel
                      </th>

                    </tr>

                  </thead>

                  <tbody>

                    {Object.keys(
                      marketPrices
                    ).map((ticker) => {

                      const direction =
                        priceDirections[
                          ticker
                        ];

                      const flashClass =
                        direction === 'up'
                          ? 'val price-up'
                          : direction === 'down'
                          ? 'val price-down'
                          : 'val';

                      const price =
                        marketPrices[
                          ticker
                        ];

                      return (
                        <tr
                          key={ticker}
                          onClick={() =>
                            setActiveChartSymbol(
                              ticker
                            )
                          }
                          style={{
                            cursor:
                              'pointer',
                          }}
                          className={
                            activeChartSymbol ===
                            ticker
                              ? 'active-row'
                              : ''
                          }
                        >

                          {/* Ticker */}

                          <td>
                            <strong>
                              {ticker}{' '}
                              (NASDAQ)
                            </strong>
                          </td>

                          {/* Price */}

                          <td
                            className={
                              flashClass
                            }
                            style={{
                              fontFamily:
                                'monospace',
                              fontWeight:
                                'bold',
                            }}
                          >
                            $
                            {Number(
                              price
                            ).toFixed(2)}
                          </td>

                          {/* Controls */}

                          <td
                            onClick={(event) =>
                              event.stopPropagation()
                            }
                          >

                            <div className="input-flex-wrapper">

                              <input
                                type="number"
                                min="1"
                                step="1"
                                inputMode="numeric"
                                placeholder="Units"
                                className="term-input"
                                value={
                                  tradeQuantities[
                                    ticker
                                  ] || ''
                                }
                                onChange={(
                                  event
                                ) =>
                                  handleQuantityChange(
                                    ticker,
                                    event.target
                                      .value
                                  )
                                }
                                disabled={
                                  executingTrade
                                }
                              />

                              <button
                                type="button"
                                className="term-btn btn-buy"
                                onClick={() =>
                                  handleTradeExecution(
                                    ticker,
                                    'BUY'
                                  )
                                }
                                disabled={
                                  executingTrade
                                }
                              >
                                BUY
                              </button>

                              <button
                                type="button"
                                className="term-btn btn-sell"
                                onClick={() =>
                                  handleTradeExecution(
                                    ticker,
                                    'SELL'
                                  )
                                }
                                disabled={
                                  executingTrade
                                }
                              >
                                SELL
                              </button>

                            </div>

                          </td>

                        </tr>
                      );
                    })}

                  </tbody>

                </table>

              </div>
            )}

          </div>

        </div>

        {/* ==============================================================
            SIDEBAR
        ============================================================== */}

        <div className="side-layout-panel">

          {/* ============================================================
              PORTFOLIO
          ============================================================ */}

          <div className="panel-card">

            <h3>
              💼 Position Summary Ledger
            </h3>

            <div className="ledger-scroll-box">

              {loadingProfile ? (
                <div className="loading-state">
                  Loading portfolio...
                </div>
              ) : portfolio.length === 0 ? (
                <div className="empty-msg">
                  No active equity positions
                  populated inside this
                  ledger.
                </div>
              ) : (
                portfolio.map((position) => {

                  const shares =
                    Number(
                      position.shares
                    ) || 0;

                  const avgPrice =
                    Number(
                      position.avgPrice
                    ) || 0;

                  const marketPrice =
                    Number(
                      marketPrices[
                        position.ticker
                      ]
                    );

                  const spot =
                    Number.isFinite(
                      marketPrice
                    ) &&
                    marketPrice > 0
                      ? marketPrice
                      : avgPrice;

                  const value =
                    shares * spot;

                  const invested =
                    shares * avgPrice;

                  const pnl =
                    value - invested;

                  return (
                    <div
                      className="ledger-position-row"
                      key={
                        position.ticker
                      }
                    >

                      <div className="ledger-row-header">

                        <strong>
                          {position.ticker}
                        </strong>

                        <span
                          style={{
                            color:
                              pnl >= 0
                                ? '#10b981'
                                : '#ef4444',
                            fontWeight:
                              'bold',
                          }}
                        >
                          {pnl >= 0
                            ? '+'
                            : ''}
                          $
                          {pnl.toFixed(2)}
                        </span>

                      </div>

                      <div className="ledger-row-details">

                        <span>
                          Units Owned:{' '}
                          {shares}
                        </span>

                        <span>
                          Equity Valuation: $
                          {value.toFixed(2)}
                        </span>

                      </div>

                      <div className="ledger-row-details">

                        <span>
                          Avg Price: $
                          {avgPrice.toFixed(
                            2
                          )}
                        </span>

                        <span>
                          Spot Price: $
                          {spot.toFixed(2)}
                        </span>

                      </div>

                    </div>
                  );
                })
              )}

            </div>

          </div>

          {/* ============================================================
              LEARNING LIBRARY
          ============================================================ */}

          <div className="panel-card learning-glossary-banner">

            <h3>
              🎓 Institutional Knowledge
              Library
            </h3>

            <div className="learning-item">

              <strong>
                Portfolio Diversification
              </strong>

              <p>
                Spread investments across
                assets to help manage risk.
              </p>

            </div>

            <div className="learning-item">

              <strong>
                Unrealized P&amp;L
              </strong>

              <p>
                The current gain or loss of
                an open position based on
                its market price.
              </p>

            </div>

          </div>

        </div>

      </div>

    </div>
  );
}

export default App;