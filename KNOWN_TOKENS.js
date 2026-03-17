

const KNOWN_TOKENS = {
  'So11111111111111111111111111111111111111112': {
    symbol: 'SOL',
    decimals: 9,
    name: 'Solana'
  },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
    symbol: 'USDC',
    decimals: 6,
    name: 'USD Coin'
  },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
    symbol: 'USDT',
    decimals: 6,
    name: 'tether'
  },
  // BONK
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': {
    symbol: 'BONK',
    decimals: 5,
    name: 'Bonk'
  },
  // RAY
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': {
    symbol: 'RAY',
    decimals: 6,
    name: 'Raydium'
  },
  // jitoSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': {
    symbol: 'jitoSOL',
    decimals: 9,
    name: 'Jito Staked SOL'
  },
  // JLP
  '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4': {
    symbol: 'JLP',
    decimals: 6,
    name: 'JLP'
  },
  // WBTC
  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh': {
    symbol: 'NVDAx',
    decimals: 6,
    name: 'NVDAx'
  },
  // cBTC
  'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij': {
    symbol: 'cBTC',
    decimals: 8,
    name: 'WBTC'
  },
  // META
  'METAewgxyPbgwsseH8T16a39CQ5VyVxZi9zXiDPY18m': {
    symbol: 'META',
    decimals: 6,
    name: 'META'
  },
  '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump': {
    symbol: 'FARTCOIN',
    decimals: 6,
    name: 'FARTCOIN'
  },
  '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g': {
    symbol: 'HYPE',
    decimals: 8,
    name: 'HYPE'
  },
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB': {
    symbol: "USD1",
    decimals: 6,
    name: 'USD1'
  },

};

function getTokenSymbol(mint) {
  if (KNOWN_TOKENS[mint]) {
    return KNOWN_TOKENS[mint].symbol;
  }
  return mint.substring(0, 8).toUpperCase();
}

function getTokenDecimals(mint) {
  if (KNOWN_TOKENS[mint]) {
    return KNOWN_TOKENS[mint].decimals;
  }
  return 6;
}

module.exports = {
  KNOWN_TOKENS,
  getTokenSymbol,
  getTokenDecimals
};
/*

node -e "
const data = require('./candidates_SOL.json');
const pool = data[0]; // First pool

console.log('Pool keys:', Object.keys(pool));
console.log('\\nFields containing \"fee\":');
Object.keys(pool).forEach(k => {
    if (k.toLowerCase().includes('fee')) {
        console.log(\`  \${k}: \${pool[k]} (type: \${typeof pool[k]})\`);
    }
});

console.log('\\nFull pool structure:');
console.log(JSON.stringify(pool, null, 2));
"


*/