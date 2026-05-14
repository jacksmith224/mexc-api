require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json()); // Important: parse JSON bodies

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
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
  } catch {
    return 0;
  }
}

// ---------- SPOT PORTFOLIO ----------
app.get('/api/spot-portfolio', async (req, res) => {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000;
    const queryParams = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
    const signature = getSignature(queryParams, SECRET_KEY);
    const url = `${BASE_URL}/api/v3/account?${queryParams}&signature=${signature}`;
    const response = await axios.get(url, { headers: { 'X-MEXC-APIKEY': API_KEY } });
    
    const balances = response.data.balances;
    let totalUSDTValue = 0;
    for (const asset of balances) {
      const free = parseFloat(asset.free);
      const locked = parseFloat(asset.locked);
      const totalHeld = free + locked;
      if (totalHeld <= 0) continue;
      if (asset.asset === 'USDT') {
        totalUSDTValue += totalHeld;
      } else {
        let price = await getPrice(`${asset.asset}USDT`);
        if (price === 0) price = await getPrice(`${asset.asset}BUSD`);
        if (price === 0) price = await getPrice(`${asset.asset}USDC`);
        totalUSDTValue += totalHeld * price;
      }
    }
    res.json({ total_spot_value_usdt: totalUSDTValue });
  } catch (error) {
    console.error('Spot portfolio error:', error.message);
    res.status(500).json({ error: 'Spot portfolio error' });
  }
});

// ---------- ANNOUNCEMENTS SYSTEM ----------
let announcements = [];
const ANNOUNCEMENTS_FILE = 'announcements.json';

// Load existing announcements
try {
  if (fs.existsSync(ANNOUNCEMENTS_FILE)) {
    const data = fs.readFileSync(ANNOUNCEMENTS_FILE, 'utf8');
    announcements = JSON.parse(data);
    console.log(`Loaded ${announcements.length} announcements from file`);
  } else {
    console.log('No existing announcements file, starting fresh');
  }
} catch (err) {
  console.error('Error loading announcements:', err);
}

function saveAnnouncements() {
  try {
    fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(announcements, null, 2));
    console.log('Announcements saved');
  } catch (err) {
    console.error('Error saving announcements:', err);
  }
}

// Get all announcements
app.get('/api/announcements', (req, res) => {
  res.json({ announcements });
});

// Add new announcement
app.post('/api/announcements', (req, res) => {
  try {
    console.log('POST /api/announcements - body:', req.body);
    const { title, content, adminPassword } = req.body;
    
    if (adminPassword !== 'SBint365') {
      console.log('Invalid admin password');
      return res.status(401).json({ error: 'Invalid admin password' });
    }
    
    if (!title || !content) {
      console.log('Missing title or content');
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
    console.log('Announcement added:', newAnnouncement.id);
    res.json({ success: true, message: 'Announcement added successfully', announcement: newAnnouncement });
  } catch (error) {
    console.error('Error in POST /api/announcements:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Update announcement
app.put('/api/announcements/:id', (req, res) => {
  try {
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
  } catch (error) {
    console.error('Error in PUT:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete announcement
app.delete('/api/announcements/:id', (req, res) => {
  try {
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
  } catch (error) {
    console.error('Error in DELETE:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
