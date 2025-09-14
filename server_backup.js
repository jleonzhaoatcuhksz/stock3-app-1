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

// API Usage Tracking
const apiUsage = new Map();
function trackApiUsage(symbol) {
  const now = new Date();
  const minute = now.getMinutes();
  const hour = now.getHours();
  const day = now.getDate();
  const month = now.getMonth();
  const year = now.getFullYear();
  
  const key = `${year}-${month}-${day}`;
  const usage = apiUsage.get(key) || {
    daily: 0,
    hourly: {},
    minutely: {}
  };

  // Update counts
  usage.daily++;
  usage.hourly[hour] = (usage.hourly[hour] || 0) + 1;
  usage.minutely[minute] = (usage.minutely[minute] || 0) + 1;

  apiUsage.set(key, usage);
  logger.info(`API call for ${symbol}`, { 
    timestamp: now.toISOString(),
    dailyUsage: usage.daily,
    hourlyUsage: usage.hourly[hour],
    minutelyUsage: usage.minutely[minute]
  });
}

// Rate limiting for free tier (5 requests per minute)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Free tier allows 5 requests per minute
  message: 'API rate limit exceeded (5 requests/minute max)'
});
app.use(limiter);

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

// API usage statistics endpoint
app.get('/api-usage', (req, res) => {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  const usageData = Array.from(apiUsage.entries()).map(([date, usage]) => ({
    date,
    daily: usage.daily,
    hourly: usage.hourly[currentHour] || 0,
    minutely: usage.minutely[currentMinute] || 0
  }));
  
  res.apiSuccess({
    usage: usageData,
    limits: {
      daily: 500,
      hourly: 30,
      minutely: 5
    }
  });
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
      return res.apiSuccess({
        status: 'success',
        data: {
          symbol,
          closingPrices: cachedData,
          cached: true,
          dataPoints: cachedData.length
        },
        timestamp: new Date().toISOString()
      });
    }

    // Track API usage
    trackApiUsage(symbol);
    
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

    // Add delay to respect free tier limits (min 12 seconds between requests)
    await new Promise(resolve => setTimeout(resolve, 13000));

    if (!response.data || !response.data['Time Series (Daily)']) {
      // Check for alternative response format
      if (response.data['Note'] || response.data['Information']) {
        return res.apiError(response.data['Note'] || response.data['Information'], 429);
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
    res.apiSuccess({
      status: 'success',
      data: {
        symbol,
        closingPrices,
        cached: false,
        dataPoints: closingPrices.length
      },
      timestamp: new Date().toISOString()
    });
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