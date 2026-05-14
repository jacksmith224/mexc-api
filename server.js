require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// Enable CORS for all requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const API_KEY = process.env.MEXC_API_KEY;
const SECRET_KEY = process.env.MEXC_SECRET_KEY;
const BASE_URL = 'https://api.mexc.com';

function getSignature(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function getPrice(symbol) {
  try {
    const response = await axios.get(`${BASE_URL}/api/v3/ticker/price?symbol=${symbol}`);
    return parseFloat(response.data.price);
  } catch (error) {
    return 0;
  }
}

app.get('/api/spot-portfolio', async (req, res) => {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000;
    const queryParams = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
    const signature = getSignature(queryParams, SECRET_KEY);
    const url = `${BASE_URL}/api/v3/account?${queryParams}&signature=${signature}`;

    const response = await axios.get(url, {
      headers: { 'X-MEXC-APIKEY': API_KEY }
    });

    const balances = response.data.balances;
    let totalUSDTValue = 0;

    for (const asset of balances) {
      const assetName = asset.asset;
      const free = parseFloat(asset.free);
      const locked = parseFloat(asset.locked);
      const totalHeld = free + locked;
      
      if (totalHeld <= 0) continue;

      let valueInUSDT = 0;
      
      if (assetName === 'USDT') {
        valueInUSDT = totalHeld;
      } else {
        let price = await getPrice(`${assetName}USDT`);
        if (price === 0) price = await getPrice(`${assetName}BUSD`);
        if (price === 0) price = await getPrice(`${assetName}USDC`);
        valueInUSDT = totalHeld * price;
      }
      
      totalUSDTValue += valueInUSDT;
    }

    res.json({ total_spot_value_usdt: totalUSDTValue });
    
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch spot portfolio' });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));