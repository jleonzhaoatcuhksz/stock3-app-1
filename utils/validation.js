const validSymbols = new Set(['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA', 'JPM', 'V', 'WMT']);

function validateStockSymbol(symbol) {
  // Basic format validation (1-5 uppercase letters)
  if (!/^[A-Z]{1,5}$/.test(symbol)) return false;
  
  // Check against known symbols (optional)
  return validSymbols.has(symbol);
}

module.exports = { validateStockSymbol };