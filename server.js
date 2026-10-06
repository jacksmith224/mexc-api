require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB Database!'))
  .catch(err => console.error('🚨 MongoDB Connection Error:', err));

// Define the Announcement Schema (What an announcement looks like)
const announcementSchema = new mongoose.Schema({
  title: String,
  content: String,
  date: { type: Date, default: Date.now }
});


// Define the Application Schema 
const applicationSchema = new mongoose.Schema({
    fullName: String,
    phone: String,
    email: String,
    age: String,
    country: String,
    address: String,
    tokenCount: Number,
    profession: String,
    incomeSource: String,
    annualIncome: String,
    paymentChoice: String,
    note: String,
    file1Url: String,
    file1Name: String,
    file2Url: String,
    file2Name: String,
    date: { type: Date, default: Date.now }
});
const Application = mongoose.model('Application', applicationSchema);

// Define the Contact Schema
const contactSchema = new mongoose.Schema({
    name: String,
    phone: String,
    email: String,
    message: String,
    status: { type: String, default: 'unread' },
    date: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', contactSchema);



// Create the Model (This gives us methods to find, save, and delete)
const Announcement = mongoose.model('Announcement', announcementSchema);

const app = express();
app.use(express.json());
const cors = require('cors');
app.use(cors()); // This tells the server to allow outside requests!


// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ========== EXCHANGE API CONFIGURATION ==========
// MEXC
const MEXC_API_KEY = process.env.MEXC_API_KEY;
const MEXC_SECRET_KEY = process.env.MEXC_SECRET_KEY;
const MEXC_BASE_URL = 'https://api.mexc.com';

// Binance
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;
const BINANCE_BASE_URL = 'https://api.binance.com';

function getSignature(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

// ---------- MEXC helpers ----------
async function getMexcPrice(symbol) {
  try {
    const response = await axios.get(`${MEXC_BASE_URL}/api/v3/ticker/price?symbol=${symbol}`, {
      timeout: 10000
    });
    return parseFloat(response.data.price);
  } catch {
    return 0;
  }
}

async function getMexcSpotPortfolioValue() {
  if (!MEXC_API_KEY || !MEXC_SECRET_KEY) {
    throw new Error('MEXC API credentials are missing');
  }

  const timestamp = Date.now();
  const recvWindow = 5000;
  const queryParams = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
  const signature = getSignature(queryParams, MEXC_SECRET_KEY);
  const url = `${MEXC_BASE_URL}/api/v3/account?${queryParams}&signature=${signature}`;

  const response = await axios.get(url, {
    headers: { 'X-MEXC-APIKEY': MEXC_API_KEY },
    timeout: 10000
  });

  const balances = response.data.balances || [];
  let totalUSDTValue = 0;

  for (const asset of balances) {
    const free = parseFloat(asset.free) || 0;
    const locked = parseFloat(asset.locked) || 0;
    const totalHeld = free + locked;

    if (totalHeld <= 0) continue;

    if (asset.asset === 'USDT') {
      totalUSDTValue += totalHeld;
      continue;
    }

    let price = await getMexcPrice(`${asset.asset}USDT`);

    // Preserve your existing fallbacks for assets without a direct USDT pair.
    if (price === 0) price = await getMexcPrice(`${asset.asset}BUSD`);
    if (price === 0) price = await getMexcPrice(`${asset.asset}USDC`);

    totalUSDTValue += totalHeld * price;
  }

  return totalUSDTValue;
}

// ---------- Binance helpers ----------
async function getBinanceAllPrices() {
  const response = await axios.get(`${BINANCE_BASE_URL}/api/v3/ticker/price`, {
    timeout: 10000
  });

  const priceMap = new Map();
  for (const item of response.data || []) {
    const price = parseFloat(item.price);
    if (item.symbol && Number.isFinite(price) && price > 0) {
      priceMap.set(item.symbol, price);
    }
  }

  return priceMap;
}

function getBinanceAssetPriceInUSDT(asset, priceMap, visited = new Set()) {
  if (asset === 'USDT') return 1;
  if (visited.has(asset)) return 0;
  visited.add(asset);

  // Best case: the asset has a direct USDT market.
  const direct = priceMap.get(`${asset}USDT`);
  if (direct) return direct;

  // Handle an inverse market if one exists.
  const inverse = priceMap.get(`USDT${asset}`);
  if (inverse) return 1 / inverse;

  // Try common Binance quote assets as bridges to USDT.
  const bridgeAssets = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'BTC', 'ETH', 'BNB'];

  for (const bridge of bridgeAssets) {
    if (bridge === asset) continue;

    const assetToBridge = priceMap.get(`${asset}${bridge}`);
    if (assetToBridge) {
      const bridgeToUSDT = getBinanceAssetPriceInUSDT(bridge, priceMap, new Set(visited));
      if (bridgeToUSDT > 0) return assetToBridge * bridgeToUSDT;
    }

    const bridgeToAsset = priceMap.get(`${bridge}${asset}`);
    if (bridgeToAsset) {
      const bridgeToUSDT = getBinanceAssetPriceInUSDT(bridge, priceMap, new Set(visited));
      if (bridgeToUSDT > 0) return bridgeToUSDT / bridgeToAsset;
    }
  }

  return 0;
}

async function getBinanceSpotPortfolioValues() {
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
    throw new Error('Binance API credentials are missing');
  }

  // Ask Binance for its own aggregate wallet valuation instead of
  // calculating every asset locally. This is much closer to the
  // "Est. Total Value" shown in the Binance Spot wallet.
  const timestamp = Date.now();
  const recvWindow = 5000;
  const queryParams =
    `quoteAsset=USDT&recvWindow=${recvWindow}&timestamp=${timestamp}`;
  const signature = getSignature(queryParams, BINANCE_SECRET_KEY);

  const walletUrl =
    `${BINANCE_BASE_URL}/sapi/v1/asset/wallet/balance?${queryParams}&signature=${signature}`;

  const response = await axios.get(walletUrl, {
    headers: { 'X-MBX-APIKEY': BINANCE_API_KEY },
    timeout: 10000
  });

  const wallets = Array.isArray(response.data) ? response.data : [];

  // Binance returns one aggregate balance per wallet.
  // We only want the Spot wallet.
  const spotWallet = wallets.find(item => {
    const name = String(item.walletName || '').trim().toLowerCase();
    return name === 'spot' || name.includes('spot');
  });

  if (!spotWallet) {
    console.error(
      'Binance Spot wallet was not found. Wallets returned:',
      wallets.map(item => item.walletName)
    );
    throw new Error('Binance Spot wallet balance was not returned');
  }

  const estimatedTotal = Number(spotWallet.balance);

  if (!Number.isFinite(estimatedTotal)) {
    throw new Error('Invalid Binance Spot estimated balance');
  }

  return {
    free_spot_value_usdt: estimatedTotal,
    locked_spot_value_usdt: 0,
    total_spot_value_usdt: estimatedTotal,
    source: 'binance_wallet_balance'
  };
}

// ========== EXISTING MEXC SPOT PORTFOLIO ==========
// Kept on the same URL so your current website continues working unchanged.
app.get('/api/spot-portfolio', async (req, res) => {
  try {
    const mexcTotal = await getMexcSpotPortfolioValue();
    res.json({ total_spot_value_usdt: mexcTotal });
  } catch (error) {
    console.error('MEXC spot portfolio error:', error.response?.data || error.message);
    res.status(500).json({ error: 'MEXC spot portfolio error' });
  }
});

// ========== BINANCE SPOT PORTFOLIO ==========
app.get('/api/binance-spot-portfolio', async (req, res) => {
  try {
    const values = await getBinanceSpotPortfolioValues();
    res.json(values);
  } catch (error) {
    console.error('Binance spot portfolio error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Binance spot portfolio error' });
  }
});

// ========== COMBINED MEXC + BINANCE SPOT PORTFOLIO ==========
app.get('/api/combined-spot-portfolio', async (req, res) => {
  try {
    const [mexcTotal, binanceValues] = await Promise.all([
      getMexcSpotPortfolioValue(),
      getBinanceSpotPortfolioValues()
    ]);

    const combinedTotal = mexcTotal + binanceValues.total_spot_value_usdt;

    res.json({
      mexc_spot_value_usdt: mexcTotal,
      binance_spot_value_usdt: binanceValues.total_spot_value_usdt,
      binance_free_spot_value_usdt: binanceValues.free_spot_value_usdt,
      binance_locked_spot_value_usdt: binanceValues.locked_spot_value_usdt,
      total_spot_value_usdt: combinedTotal
    });
  } catch (error) {
    console.error('Combined spot portfolio error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Combined spot portfolio error' });
  }
});

// ========== ANNOUNCEMENTS SYSTEM (MONGODB) ==========

// Get all announcements
app.get('/api/announcements', async (req, res) => {
    try {
        // Fetch all from database, sorted newest first
        const announcements = await Announcement.find().sort({ date: -1 });
        
        // Map them to match your frontend's expected format (using _id as id)
        const formattedAnnouncements = announcements.map(ann => ({
            id: ann._id,
            title: ann.title,
            content: ann.content,
            date: ann.date
        }));
        
        res.json({ announcements: formattedAnnouncements });
    } catch (err) {
        console.error("Error fetching announcements:", err);
        res.status(500).json({ error: 'Failed to fetch announcements' });
    }
});

// Add new announcement
app.post('/api/announcements', async (req, res) => {
    const { title, content, adminPassword } = req.body;
    if (adminPassword !== 'jacksmith007') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const newAnnouncement = new Announcement({ title, content });
        await newAnnouncement.save(); // Save to database
        res.json({ success: true, message: 'Announcement added successfully!' });
    } catch (err) {
        console.error("Error saving announcement:", err);
        res.status(500).json({ error: 'Failed to save announcement' });
    }
});

// Update announcement
app.put('/api/announcements/:id', async (req, res) => {
    const { id } = req.params;
    const { title, content, adminPassword } = req.body;
    if (adminPassword !== 'jacksmith007') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        await Announcement.findByIdAndUpdate(id, { title, content });
        res.json({ success: true, message: 'Announcement updated!' });
    } catch (err) {
        console.error("Error updating announcement:", err);
        res.status(500).json({ error: 'Failed to update announcement' });
    }
});

// Delete announcement
app.delete('/api/announcements/:id', async (req, res) => {
    const { id } = req.params;
    const { adminPassword } = req.body;
    if (adminPassword !== 'jacksmith007') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        await Announcement.findByIdAndDelete(id);
        res.json({ success: true, message: 'Announcement deleted!' });
    } catch (err) {
        console.error("Error deleting announcement:", err);
        res.status(500).json({ error: 'Failed to delete announcement' });
    }
});

// ========== CONTACT FORM (MONGODB) ==========

// Submit a new contact message
app.post('/api/contact', async (req, res) => {
    try {
        const newContact = new Contact(req.body);
        await newContact.save();
        res.json({ success: true, message: 'Message sent successfully' });
    } catch (err) {
        console.error("Error saving contact:", err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Admin: Get all contact
app.get('/api/contact', async (req, res) => {
    if (req.query.adminPassword !== 'jacksmith007') return res.status(401).json({ error: 'Unauthorized' });
    try {
        const contact = await Contact.find().sort({ date: -1 });
        const formatted = contact.map(c => ({ 
            id: c._id, name: c.name, phone: c.phone, email: c.email, message: c.message, status: c.status, date: c.date 
        }));
        res.json({ contact: formatted });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch contact' });
    }
});

// Admin: Mark as read
app.put('/api/contact/:id', async (req, res) => {
    if (req.body.adminPassword !== 'jacksmith007') return res.status(401).json({ error: 'Unauthorized' });
    try {
        await Contact.findByIdAndUpdate(req.params.id, { status: 'read' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update contact' });
    }
});

// Admin: Delete one
app.delete('/api/contact/:id', async (req, res) => {
    if (req.body.adminPassword !== 'jacksmith007') return res.status(401).json({ error: 'Unauthorized' });
    try {
        await Contact.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete contact' });
    }
});

// Admin: Delete all
app.delete('/api/contact/all', async (req, res) => {
    if (req.body.adminPassword !== 'jacksmith007') return res.status(401).json({ error: 'Unauthorized' });
    try {
        await Contact.deleteMany({});
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete all contact' });
    }
});

// ========== APPLICATION FORM (saves to JSON and Cloudinary) ==========

// 1. Configure Cloudinary with your .env keys
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 2. Set up the Cloudinary Storage engine
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'token_application', // This creates a folder in your Cloudinary account
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'], 
    // Cloudinary automatically generates unique file names!
  },
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// ----------------------------------------------------

// ========== SUBMIT NEW APPLICATION (MONGODB) ==========
app.post('/api/application', upload.fields([
    { name: 'idCard1', maxCount: 1 },
    { name: 'idCard2', maxCount: 1 }
]), async (req, res) => {
    try {
        console.log('Application received - body:', req.body);
        console.log('Files received:', req.files ? Object.keys(req.files) : 'none');

        const {
            fullName, phone, email, age, country, address, tokenCount,
            profession, incomeSource, annualIncome, termsChoice, paymentChoice, note
        } = req.body;

        // Validate required fields
        if (!fullName || !phone || !email || !country || !tokenCount || !termsChoice || !paymentChoice) {
            return res.status(400).json({ error: 'Please fill in all required fields.' });
        }

        if (termsChoice !== 'yes') {
            return res.status(400).json({ error: 'You must read and accept the terms and conditions.' });
        }

        const file1 = req.files['idCard1'] ? req.files['idCard1'][0] : null;
        const file2 = req.files['idCard2'] ? req.files['idCard2'][0] : null;

        if (!file1 || !file2) {
            return res.status(400).json({ error: 'Please upload both sides of your ID card.' });
        }

        // --- NEW MONGODB SAVE LOGIC ---
        const newApp = new Application({
            fullName, 
            phone, 
            email, 
            age: age || '', 
            country, 
            address: address || '',
            tokenCount, 
            profession: profession || '', 
            incomeSource: incomeSource || '',
            annualIncome: annualIncome || '', 
            paymentChoice, 
            note: note || '',
            file1Name: file1.originalname,
            file2Name: file2.originalname,
            file1Url: file1.path, // Permanent Cloudinary URL
            file2Url: file2.path  // Permanent Cloudinary URL
        });
        
        await newApp.save(); // Saves securely to MongoDB Atlas
        // ------------------------------

        console.log(`✅ Application saved to MongoDB from ${fullName}`);
        res.json({ success: true, message: 'Application submitted successfully! We will contact you within 72 hours.' });

    } catch (error) {
        console.error('Application error:', error);
        res.status(500).json({ error: 'Failed to submit application: ' + error.message });
    }
});

// ========== ADMIN: GET ALL application (MONGODB) ==========
app.get('/api/application', async (req, res) => {
    const { adminPassword } = req.query;
    if (adminPassword !== 'jacksmith007') return res.status(401).json({ error: 'Unauthorized' });

    try {
        const application = await Application.find().sort({ date: -1 });
        const formatted = application.map(app => ({
            id: app._id, fullName: app.fullName, phone: app.phone, email: app.email,
            age: app.age, country: app.country, tokenCount: app.tokenCount,
            paymentChoice: app.paymentChoice, file1Url: app.file1Url, file1Name: app.file1Name,
            file2Url: app.file2Url, file2Name: app.file2Name, date: app.date
        }));
        res.json({ application: formatted });
    } catch (err) {
        console.error("Error fetching application:", err);
        res.status(500).json({ error: 'Failed to fetch application' });
    }
});

// ========== ADMIN: DELETE APPLICATION (MONGODB) ==========
app.delete('/api/application/:id', async (req, res) => {
    const { id } = req.params;
    const { adminPassword } = req.body;
    if (adminPassword !== 'jacksmith007') return res.status(401).json({ error: 'Unauthorized' });

    try {
        await Application.findByIdAndDelete(id);
        res.json({ success: true, message: 'Application deleted successfully' });
    } catch (err) {
        console.error("Error deleting application:", err);
        res.status(500).json({ error: 'Failed to delete application' });
    }
});

// ========== MEXC BALANCE API ==========
app.get('/api/balance', async (req, res) => {
    // This is where you would securely use your hidden EXCHANGE_API_KEY
    // to ask MEXC for the real data. 
    
    // For now, sending dummy data so you can test the frontend:
    res.json({ 
        balance: "714.71", 
        tokens: 7 
    });
});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error("🚨 MIDDLEWARE CRASH:", err);
    res.status(500).json({ error: "Server Error: " + err.message });
});
// ----------------------------

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
