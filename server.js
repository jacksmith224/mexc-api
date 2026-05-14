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

// ---------- ANNOUNCEMENTS SYSTEM ----------
let announcements = [];

// Load existing announcements from file (optional - creates file if not exists)
const fs = require('fs');
const ANNOUNCEMENTS_FILE = 'announcements.json';

try {
    if (fs.existsSync(ANNOUNCEMENTS_FILE)) {
        const data = fs.readFileSync(ANNOUNCEMENTS_FILE, 'utf8');
        announcements = JSON.parse(data);
    }
} catch (err) {
    console.log('No existing announcements file, starting fresh');
}

function saveAnnouncements() {
    fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(announcements, null, 2));
}

// Get all announcements
app.get('/api/announcements', (req, res) => {
    res.json({ announcements });
});

// Add new announcement (requires admin password)
app.post('/api/announcements', (req, res) => {
    const { title, content, adminPassword } = req.body;
    
    if (adminPassword !== 'SBint365') {
        return res.status(401).json({ error: 'Invalid admin password' });
    }
    
    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
    }
    
    const newAnnouncement = {
        id: Date.now().toString(),
        title,
        content,
        date: new Date().toISOString()
    };
    
    announcements.unshift(newAnnouncement);
    saveAnnouncements();
    res.json({ success: true, message: 'Announcement added successfully', announcement: newAnnouncement });
});

// Update announcement
app.put('/api/announcements/:id', (req, res) => {
    const { id } = req.params;
    const { title, content, adminPassword } = req.body;
    
    if (adminPassword !== 'SBint365') {
        return res.status(401).json({ error: 'Invalid admin password' });
    }
    
    const index = announcements.findIndex(a => a.id === id);
    if (index === -1) {
        return res.status(404).json({ error: 'Announcement not found' });
    }
    
    announcements[index] = {
        ...announcements[index],
        title: title || announcements[index].title,
        content: content || announcements[index].content,
        updatedAt: new Date().toISOString()
    };
    
    saveAnnouncements();
    res.json({ success: true, message: 'Announcement updated successfully' });
});

// Delete announcement
app.delete('/api/announcements/:id', (req, res) => {
    const { id } = req.params;
    const { adminPassword } = req.body;
    
    if (adminPassword !== 'SBint365') {
        return res.status(401).json({ error: 'Invalid admin password' });
    }
    
    const initialLength = announcements.length;
    announcements = announcements.filter(a => a.id !== id);
    
    if (announcements.length === initialLength) {
        return res.status(404).json({ error: 'Announcement not found' });
    }
    
    saveAnnouncements();
    res.json({ success: true, message: 'Announcement deleted successfully' });
});

app.listen(3000, () => console.log('Server running on port 3000'));
