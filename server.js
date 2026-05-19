require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
app.use(express.json());


// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ========== MEXC API CONFIGURATION ==========
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

// ========== SPOT PORTFOLIO ==========
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

// ========== ANNOUNCEMENTS SYSTEM ==========
let announcements = [];
const ANNOUNCEMENTS_FILE = 'announcements.json';

try {
  if (fs.existsSync(ANNOUNCEMENTS_FILE)) {
    const data = fs.readFileSync(ANNOUNCEMENTS_FILE, 'utf8');
    announcements = JSON.parse(data);
    console.log(`Loaded ${announcements.length} announcements`);
  }
} catch (err) {
  console.log('No existing announcements file');
}

function saveAnnouncements() {
  fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(announcements, null, 2));
}

app.get('/api/announcements', (req, res) => {
  res.json({ announcements });
});

app.post('/api/announcements', (req, res) => {
  const { title, content, adminPassword } = req.body;
  if (adminPassword !== 'Jacksmith007') {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  const newAnnouncement = {
    id: Date.now().toString(),
    title,
    content,
    date: new Date().toISOString()
  };
  announcements.unshift(newAnnouncement);
  saveAnnouncements();
  res.json({ success: true, message: 'Announcement added' });
});

app.put('/api/announcements/:id', (req, res) => {
  const { id } = req.params;
  const { title, content, adminPassword } = req.body;
  if (adminPassword !== 'Jacksmith007') {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  const index = announcements.findIndex(a => a.id === id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  announcements[index] = { ...announcements[index], title, content, updatedAt: new Date().toISOString() };
  saveAnnouncements();
  res.json({ success: true });
});

app.delete('/api/announcements/:id', (req, res) => {
  const { id } = req.params;
  const { adminPassword } = req.body;
  if (adminPassword !== 'Jacksmith007') {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  announcements = announcements.filter(a => a.id !== id);
  saveAnnouncements();
  res.json({ success: true });
});

// ========== CONTACT FORM ==========
const CONTACT_FILE = 'contacts.json';
let contacts = [];

try {
  if (fs.existsSync(CONTACT_FILE)) {
    contacts = JSON.parse(fs.readFileSync(CONTACT_FILE, 'utf8'));
  }
} catch (err) {}

function saveContacts() {
  fs.writeFileSync(CONTACT_FILE, JSON.stringify(contacts, null, 2));
}

app.post('/api/contact', (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Required fields missing' });
  }
  const newContact = {
    id: Date.now().toString(),
    name, email, phone: phone || '', subject: subject || 'general', message,
    date: new Date().toISOString(),
    status: 'unread'
  };
  contacts.unshift(newContact);
  saveContacts();
  res.json({ success: true });
});

app.get('/api/contacts', (req, res) => {
  const { adminPassword } = req.query;
  if (adminPassword !== 'Jacksmith007') return res.status(401).json({ error: 'Unauthorized' });
  res.json({ contacts });
});

app.put('/api/contacts/:id', (req, res) => {
  const { id } = req.params;
  const { adminPassword } = req.body;
  if (adminPassword !== 'Jacksmith007') return res.status(401).json({ error: 'Unauthorized' });
  const contact = contacts.find(c => c.id === id);
  if (contact) contact.status = 'read';
  saveContacts();
  res.json({ success: true });
});

app.delete('/api/contacts/:id', (req, res) => {
  const { id } = req.params;
  const { adminPassword } = req.body;
  if (adminPassword !== 'Jacksmith007') return res.status(401).json({ error: 'Unauthorized' });
  contacts = contacts.filter(c => c.id !== id);
  saveContacts();
  res.json({ success: true });
});

app.delete('/api/contacts/all', (req, res) => {
  const { adminPassword } = req.body;
  if (adminPassword !== 'Jacksmith007') return res.status(401).json({ error: 'Unauthorized' });
  contacts = [];
  saveContacts();
  res.json({ success: true });
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
    folder: 'token_applications', // This creates a folder in your Cloudinary account
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'], 
    // Cloudinary automatically generates unique file names!
  },
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// ----------------------------------------------------

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

        // Save to JSON (applications.json)
        const APP_FILE = 'applications.json';
        let applications = [];
        if (fs.existsSync(APP_FILE)) {
            applications = JSON.parse(fs.readFileSync(APP_FILE, 'utf8'));
        }
        const newApp = {
            id: Date.now().toString(),
            fullName, phone, email, age: age || '', country, address: address || '',
            tokenCount, profession: profession || '', incomeSource: incomeSource || '',
            annualIncome: annualIncome || '', paymentChoice, note: note || '',
            date: new Date().toISOString(),
           file1Name: file1.originalname,
            file2Name: file2.originalname,
            file1Url: file1.path, // This is now the permanent Cloudinary URL
            file2Url: file2.path  // This is now the permanent Cloudinary URL
            // --------------------------
        };
        applications.unshift(newApp);
        fs.writeFileSync(APP_FILE, JSON.stringify(applications, null, 2));

        console.log(`✅ Application saved from ${fullName}`);
        res.json({ success: true, message: 'Application submitted successfully! We will contact you within 72 hours.' });

    } catch (error) {
        console.error('Application error:', error);
        res.status(500).json({ error: 'Failed to submit application: ' + error.message });
    }
});

// ========== ADMIN: GET ALL APPLICATIONS ==========
app.get('/api/applications', (req, res) => {
  const { adminPassword } = req.query;
  if (adminPassword !== 'jacksmith007') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const APP_FILE = 'applications.json';
  let applications = [];
  if (fs.existsSync(APP_FILE)) {
    try {
      applications = JSON.parse(fs.readFileSync(APP_FILE, 'utf8'));
    } catch (err) {
      console.error('Error reading applications.json:', err);
    }
  }
  res.json({ applications });
});

// ========== ADMIN: DELETE APPLICATION ==========
app.delete('/api/applications/:id', (req, res) => {
    const { id } = req.params;
    const { adminPassword } = req.body;

    // Check password (make sure this matches the password you use)
    if (adminPassword !== 'jacksmith007') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const APP_FILE = 'applications.json';
    let applications = [];

    if (fs.existsSync(APP_FILE)) {
        try {
            applications = JSON.parse(fs.readFileSync(APP_FILE, 'utf8'));
        } catch (err) {
            console.error('Error reading applications.json:', err);
            return res.status(500).json({ error: 'Database error' });
        }
    }

    // Filter out the application with the matching ID
    const initialLength = applications.length;
    applications = applications.filter(app => app.id !== id);

    // If the length didn't change, the ID wasn't found
    if (applications.length === initialLength) {
        return res.status(404).json({ error: 'Application not found' });
    }

    // Save the updated list back to the file
    fs.writeFileSync(APP_FILE, JSON.stringify(applications, null, 2));
    
    console.log(`🗑️ Application ${id} deleted.`);
    res.json({ success: true, message: 'Application deleted successfully' });
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
