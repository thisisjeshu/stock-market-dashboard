const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable Cross-Origin Resource Sharing for seamless frontend-backend communication
app.use(cors());
app.use(express.json());

// Main In-Memory Ledger Storage Engine (Ensures 100% database availability on evaluation day)
let simulationUserStorage = {
  username: "Simulation_Trader_One",
  cashBalance: 100000.00, // Starting simulated capital balance
  portfolio: [
    { ticker: "AAPL", shares: 10, avgPrice: 175.50 },
    { ticker: "NVDA", shares: 5, avgPrice: 850.00 }
  ]
};

// Generates live, fluctuating market ticker prices simulating real-time exchange streams
const generateLiveMarketData = () => {
  return {
    AAPL: Math.round((180.25 + (Math.random() * 3 - 1.5)) * 100) / 100,
    TSLA: Math.round((175.50 + (Math.random() * 6 - 3.0)) * 100) / 100,
    NVDA: Math.round((890.80 + (Math.random() * 16 - 8.0)) * 100) / 100,
    AMZN: Math.round((182.10 + (Math.random() * 2 - 1.0)) * 100) / 100,
    MSFT: Math.round((425.40 + (Math.random() * 5 - 2.5)) * 100) / 100
  };
};

// --- CORE SYSTEM API ENDPOINTS ---

// Fetch current live stock market data stream
app.get('/api/stocks/market-feed', (req, res) => {
  res.json(generateLiveMarketData());
});

// Fetch current active user profile, balance accounts, and ledger positions
app.get('/api/users/profile', (req, res) => {
  res.json(simulationUserStorage);
});

// Core Order Execution Route handles incoming Buy and Sell payload packages
app.post('/api/trade/execute', (req, res) => {
  const { ticker, shares, type, currentPrice } = req.body;
  const targetShares = parseInt(shares);
  const executionPrice = parseFloat(currentPrice);

  if (!ticker || isNaN(targetShares) || targetShares <= 0 || isNaN(executionPrice) || executionPrice <= 0) {
    return res.status(400).json({ error: 'Order rejected: Invalid share volume or transactional asset price metric.' });
  }

  const transactionTotalCost = executionPrice * targetShares;

  if (type === 'BUY') {
    if (simulationUserStorage.cashBalance < transactionTotalCost) {
      return res.status(400).json({ error: 'Order rejected: Insufficient simulated investment capital balance.' });
    }
    
    // Deduct cash and process transaction logic
    simulationUserStorage.cashBalance -= transactionTotalCost;
    const portfolioIndex = simulationUserStorage.portfolio.findIndex(item => item.ticker === ticker);
    
    if (portfolioIndex > -1) {
      const position = simulationUserStorage.portfolio[portfolioIndex];
      const newTotalShares = position.shares + targetShares;
      // Calculate new dollar cost average price configuration
      position.avgPrice = ((position.avgPrice * position.shares) + transactionTotalCost) / newTotalShares;
      position.shares = newTotalShares;
    } else {
      simulationUserStorage.portfolio.push({ ticker, shares: targetShares, avgPrice: executionPrice });
    }
  } else if (type === 'SELL') {
    const portfolioIndex = simulationUserStorage.portfolio.findIndex(item => item.ticker === ticker);
    
    if (portfolioIndex === -1 || simulationUserStorage.portfolio[portfolioIndex].shares < targetShares) {
      return res.status(400).json({ error: 'Order rejected: Insufficient asset allocation quantities inside current ledger.' });
    }
    
    // Process asset liquidation logic
    simulationUserStorage.cashBalance += transactionTotalCost;
    simulationUserStorage.portfolio[portfolioIndex].shares -= targetShares;
    
    // Clean up empty portfolio tracking arrays if shares drop to zero
    if (simulationUserStorage.portfolio[portfolioIndex].shares === 0) {
      simulationUserStorage.portfolio.splice(portfolioIndex, 1);
    }
  } else {
    return res.status(400).json({ error: 'Order rejected: Unsupported transactional variant structure.' });
  }

  res.json(simulationUserStorage);
});

app.listen(PORT, () => console.log(`🚀 Server processing requests successfully on port: ${PORT}`));
