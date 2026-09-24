import React, { useState, useEffect, useRef } from 'react';

const BACKEND_BASE_URL = 'https://onrender.com';

// Reusable TradingView Advanced Charting Engine Widget Component
function TradingViewChart({ symbol }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
      const script = document.createElement('script');
      script.src = 'https://tradingview.com';
      script.type = 'text/javascript';
      script.async = true;
      script.innerHTML = JSON.stringify({
        autosize: true,
        symbol: `NASDAQ:${symbol}`,
        interval: "D",
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        enable_publishing: false,
        hide_side_toolbar: false,
        allow_symbol_change: true,
        calendar: false,
        support_host: "https://tradingview.com"
      });
      containerRef.current.appendChild(script);
    }
  }, [symbol]);

  return (
    <div className="tradingview-widget-container" ref={containerRef} style={{ height: "450px", width: "100%" }}>
      <div className="tradingview-widget-container__widget" style={{ height: "calc(100% - 32px)", width: "100%" }}></div>
    </div>
  );
}

function App() {
  const [userData, setUserData] = useState({ cashBalance: 100000, portfolio: [] });
  const [marketPrices, setMarketPrices] = useState({});
  const [tradeQuantities, setTradeQuantities] = useState({});
  const [activeChartSymbol, setActiveChartSymbol] = useState('AAPL');
  const [feedbackMessage, setFeedbackMessage] = useState({ text: '', isError: false });
  const [priceDirections, setPriceDirections] = useState({});
  const previousPricesRef = useRef({});

  const fetchUserLedgerProfile = async () => {
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/api/users/profile`);
      const data = await response.json();
      setUserData(data);
    } catch (err) {
      console.error('API Connect Failure:', err);
    }
  };

  const fetchLiveMarketFeed = async () => {
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/api/stocks/market-feed`);
      const data = await response.json();
      
      const newDirections = { ...priceDirections };
      Object.keys(data).forEach((ticker) => {
        const prevPrice = previousPricesRef.current[ticker];
        const newPrice = data[ticker];
        if (prevPrice !== undefined) {
          if (newPrice > prevPrice) newDirections[ticker] = 'up';
          else if (newPrice < prevPrice) newDirections[ticker] = 'down';
        }
      });
      
      setPriceDirections(newDirections);
      previousPricesRef.current = data;
      setMarketPrices(data);
    } catch (err) {
      console.error('API Connect Failure:', err);
    }
  };

  useEffect(() => {
    fetchUserLedgerProfile();
    fetchLiveMarketFeed();
    const interval = setInterval(fetchLiveMarketFeed, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleTradeExecution = async (ticker, orderType) => {
    const qty = parseInt(tradeQuantities[ticker] || 0);
    if (isNaN(qty) || qty <= 0) {
      setFeedbackMessage({ text: '🚨 Error: Volume units must be positive integers.', isError: true });
      return;
    }

    try {
      const response = await fetch(`${BACKEND_BASE_URL}/api/trade/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          shares: qty,
          type: orderType,
          currentPrice: marketPrices[ticker]
        })
      });

      const result = await response.json();
      if (!response.ok) {
        setFeedbackMessage({ text: `🚨 Order Blocked: ${result.error}`, isError: true });
      } else {
        setUserData(result);
        setFeedbackMessage({ text: `✨ Filled: ${orderType} ${qty} shares of ${ticker} completed.`, isError: false });
        setTradeQuantities(prev => ({ ...prev, [ticker]: '' }));
      }
    } catch (err) {
      setFeedbackMessage({ text: '❌ System Processing Timeout.', isError: true });
    }
  };

  const holdingsVal = userData.portfolio.reduce((acc, pos) => acc + (pos.shares * (marketPrices[pos.ticker] || pos.avgPrice)), 0);
  const netAssetWorth = userData.cashBalance + holdingsVal;
  const netROI = (((netAssetWorth - 100000) / 100000) * 100).toFixed(2);

  return (
    <div className="terminal-workspace">
      <header className="terminal-navbar">
        <div className="brand-title">⚡ NUMORA PRO // TERMINAL</div>
        <div className="operator-tag">SYSTEM LEDGER STATE: LIVE</div>
      </header>

      {feedbackMessage.text && (
        <div className="system-banner-alert" style={{ borderLeftColor: feedbackMessage.isError ? '#ef4444' : '#10b981' }}>
          {feedbackMessage.text}
        </div>
      )}

      <section className="metrics-row">
        <div className="metric-box">
          <span className="box-label">Net Asset Worth Valuation</span>
          <h2 className="box-value">${netAssetWorth.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
        </div>
        <div className="metric-box">
          <span className="box-label">Liquid Sim Reserve Capital</span>
          <h2 className="box-value" style={{ color: '#38bdf8' }}>${userData.cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h2>
        </div>
        <div className="metric-box">
          <span className="box-label">Net Return Investment Metrics (ROI)</span>
          <h2 className="box-value" style={{ color: netROI >= 0 ? '#10b981' : '#ef4444' }}>
            {netROI >= 0 ? '▲' : '▼'} {netROI}%
          </h2>
        </div>
      </section>

      <div className="terminal-layout-grid">
        <div className="main-layout-panel">
          <div className="panel-card chart-container-card">
            <div className="chart-header-row">
              <h3>📊 Interactive Technical Analysis Canvas</h3>
              <div className="active-ticker-badge">Viewing Core Index: <strong>{activeChartSymbol}</strong></div>
            </div>
            <TradingViewChart symbol={activeChartSymbol} />
          </div>

          <div className="panel-card">
            <h3>📈 Live Securities Stream Board</h3>
            <p className="subtitle-tag">Click on any security asset row to instantly render its real-time candlestick chart.</p>
            <table>
              <thead>
                <tr>
                  <th>Asset Ticker Target</th>
                  <th>Spot Value Price</th>
                  <th>Execution Panel Controls</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(marketPrices).map((ticker) => {
                  const dir = priceDirections[ticker];
                  const flashClass = dir === 'up' ? 'val price-up' : dir === 'down' ? 'val price-down' : 'val';
                  return (
                    <tr key={ticker} onClick={() => setActiveChartSymbol(ticker)} style={{ cursor: 'pointer' }} className={activeChartSymbol === ticker ? 'active-row' : ''}>
                      <td><strong>{ticker} (NASDAQ)</strong></td>
                      <td className={flashClass} style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>${marketPrices[ticker]?.toFixed(2)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="input-flex-wrapper">
                          <input
                            type="number"
                            placeholder="Units"
                            className="term-input"
                            value={tradeQuantities[ticker] || ''}
                            onChange={(e) => setTradeQuantities({ ...tradeQuantities, [ticker]: e.target.value })}
                          />
                          <button className="term-btn btn-buy" onClick={() => handleTradeExecution(ticker, 'BUY')}>BUY</button>
                          <button className="term-btn btn-sell" onClick={() => handleTradeExecution(ticker, 'SELL')}>SELL</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="side-layout-panel">
          <div className="panel-card">
            <h3>💼 Position Summary Ledger</h3>
            <div className="ledger-scroll-box">
              {userData.portfolio.length === 0 ? (
                <div className="empty-msg">No active equity tracking indices populated inside this ledger.</div>
              ) : (
                userData.portfolio.map((pos) => {
                  const spot = marketPrices[pos.ticker] || pos.avgPrice;
                  const value = pos.shares * spot;
                  const pnl = value - (pos.shares * pos.avgPrice);
                  return (
                    <div className="ledger-position-row" key={pos.ticker}>
                      <div className="ledger-row-header">
                        <strong>{pos.ticker}</strong>
                        <span style={{ color: pnl >= 0 ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>
                          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                        </span>
                      </div>
                      <div className="ledger-row-details">
                        <span>Units Owned: {pos.shares}</span>
                        <span>Equity Valuation: ${value.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="panel-card learning-glossary-banner">
            <h3>🎓 Institutional Knowledge Library</h3>
            <div className="learning-item">
              <strong>Portfolio Diversification</strong>
              <p>Spread investments across assets to help manage risk.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

