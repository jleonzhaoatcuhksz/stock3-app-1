const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const { validateStockSymbol } = require('./utils/validation');

// API Documentation
const apiDocs = {
  endpoints: {
    '/api/stock/:symbol': {
      method: 'GET',
      description: 'Get daily closing prices for a stock symbol',
      parameters: {
        symbol: 'Stock symbol (e.g., AAPL)'
      },
      example: '/api/stock/AAPL'
    },
    '/health': {
      method: 'GET',
      description: 'Server health check'
    }
  }
};

// Configure logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/server.log' })
  ]
});

const app = express();
const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache
const ALPHA_VANTAGE_KEY = 'LCH793C5NT8GWIB0';



// Middleware for consistent API responses
app.use((req, res, next) => {
  res.apiSuccess = (data) => {
    res.json({
      status: 'success',
      data,
      timestamp: new Date().toISOString()
    });
  };

  res.apiError = (error, statusCode = 500) => {
    res.status(statusCode).json({
      status: 'error',
      error: error.message || error,
      timestamp: new Date().toISOString()
    });
  };
  next();
});

app.use(cors());
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.apiSuccess({ 
    status: 'healthy',
    uptime: process.uptime()
  });
});

// API documentation endpoint
app.get('/api-docs', (req, res) => {
  res.apiSuccess(apiDocs);
});


// Real API handler with caching
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    
    // Validate symbol format
    if (!validateStockSymbol(symbol)) {
      return res.apiError('Invalid stock symbol', 400);
    }

    // Check cache first
    const cachedData = cache.get(symbol);
    if (cachedData) {
      const responseJson = JSON.stringify({
        status: 'success',
        data: {
          symbol: symbol,
          closingPrices: cachedData.map(item => ({
            date: item.date,
            close: item.close
          })),
          cached: true,
          dataPoints: cachedData.length
        },
        timestamp: new Date().toISOString()
      }, null, 2);
      
      res.setHeader('Content-Type', 'application/json');
      return res.send(responseJson);
    }

    
    // Fetch from Alpha Vantage API (free tier)
    const response = await axios.get(`https://www.alphavantage.co/query`, {
      params: {
        function: 'TIME_SERIES_DAILY',
        symbol: symbol,
        apikey: ALPHA_VANTAGE_KEY,
        outputsize: 'full', // Changed from 'compact' to 'full' for 1+ year of data
        datatype: 'json'
      }
    });

    // Add delay to respect Alpha Vantage free tier limits (5 requests/minute max)
    await new Promise(resolve => setTimeout(resolve, 13000));
    logger.info(`Called Alpha Vantage API for ${symbol} - waiting 13 seconds`);

    if (!response.data || !response.data['Time Series (Daily)']) {
      // Check for Alpha Vantage rate limit message
      if (response.data['Note'] && response.data['Note'].includes('API rate limit')) {
        return res.apiError('Alpha Vantage API limit reached (5 requests/minute). Please wait 1 minute.', 429);
      }
      if (response.data['Information']) {
        return res.apiError(response.data['Information'], 400);
      }
      return res.apiError('No data found for symbol', 404);
    }

    // Process and cache data
    const timeSeries = response.data['Time Series (Daily)'] || response.data['Time Series (Daily Adjusted)'];
    const closingPrices = Object.entries(timeSeries).map(([date, data]) => ({
      date,
      close: parseFloat(data['4. close'] || data['5. adjusted close'])
    })).sort((a, b) => new Date(a.date) - new Date(b.date));

    cache.set(symbol, closingPrices);
    // Build response with explicit JSON formatting
    // Manually construct JSON string with proper formatting
    // Manually construct JSON with guaranteed proper syntax
    try {
      console.log('Building response with', closingPrices.length, 'data points');
      
      // Start building JSON string
      let jsonStr = `{
  "status": "success",
  "data": {
    "symbol": "${symbol}",
    "closingPrices": [`;

      // Add each price point
      closingPrices.forEach((item, index) => {
        if (!item.date || typeof item.close !== 'number') {
          throw new Error(`Invalid price data at index ${index}: ${JSON.stringify(item)}`);
        }
        
        jsonStr += `
      {
        "date": "${item.date}",
        "close": ${item.close}
      }`;
        
        if (index < closingPrices.length - 1) {
          jsonStr += ',';
        }
      });

      // Close JSON structure
      jsonStr += `
    ],
    "cached": false,
    "dataPoints": ${closingPrices.length}
  },
  "timestamp": "${new Date().toISOString()}"
}`;

      // Verify JSON is valid
      JSON.parse(jsonStr);
      
      // Send response with proper headers
      res.setHeader('Content-Type', 'application/json');
      return res.send(jsonStr);
    } catch (error) {
      console.error('Response construction failed:', error);
      return res.status(500).json({
        status: 'error',
        error: 'Failed to construct valid response',
        details: error.message
      });
    }
  } catch (error) {
    logger.error(`Stock data error: ${error.message}`, {
      symbol: req.params.symbol,
      error: error.stack
    });
    res.apiError('Failed to process stock data');
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3006;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Server error: ${err.message}`, {
    url: req.originalUrl,
    method: req.method,
    error: err.stack
  });
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});