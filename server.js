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
app.post('/api/contacts', async (req, res) => {
    try {
        const newContact = new Contact(req.body);
        await newContact.save();
        res.json({ success: true, message: 'Message sent successfully' });
    } catch (err) {
        console.error("Error saving contact:", err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Admin: Get all contacts
app.get('/api/contacts', async (req, res) => {
    if (req.query.adminPassword !== 'jacksmith007') return res.status(401).json({ error: 'Unauthorized' });
    try {
        const contacts = await Contact.find().sort({ date: -1 });
        const formatted = contacts.map(c => ({ 
            id: c._id, name: c.name, phone: c.phone, email: c.email, message: c.message, status: c.status, date: c.date 
        }));
        res.json({ contacts: formatted });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch contacts' });
    }
});

// Admin: Mark as read
app.put('/api/contacts/:id', async (req, res) => {
    if (req.body.adminPassword !== 'jacksmith007') return res.status(401).json({ error: 'Unauthorized' });
    try {
        await Contact.findByIdAndUpdate(req.params.id, { status: 'read' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update contact' });
    }
});

// Admin: Delete one
app.delete('/api/contacts/:id', async (req, res) => {
    if (req.body.adminPassword !== 'jacksmith007') return res.status(401).json({ error: 'Unauthorized' });
    try {
        await Contact.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete contact' });
    }
});

// Admin: Delete all
app.delete('/api/contacts/all', async (req, res) => {
    if (req.body.adminPassword !== 'jacksmith007') return res.status(401).json({ error: 'Unauthorized' });
    try {
        await Contact.deleteMany({});
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete all contacts' });
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

// ========== ADMIN: GET ALL APPLICATIONS (MONGODB) ==========
app.get('/api/applications', async (req, res) => {
    const { adminPassword } = req.query;
    if (adminPassword !== 'jacksmith007') return res.status(401).json({ error: 'Unauthorized' });

    try {
        const applications = await Application.find().sort({ date: -1 });
        const formatted = applications.map(app => ({
            id: app._id, fullName: app.fullName, phone: app.phone, email: app.email,
            age: app.age, country: app.country, tokenCount: app.tokenCount,
            paymentChoice: app.paymentChoice, file1Url: app.file1Url, file1Name: app.file1Name,
            file2Url: app.file2Url, file2Name: app.file2Name, date: app.date
        }));
        res.json({ applications: formatted });
    } catch (err) {
        console.error("Error fetching applications:", err);
        res.status(500).json({ error: 'Failed to fetch applications' });
    }
});

// ========== ADMIN: DELETE APPLICATION (MONGODB) ==========
app.delete('/api/applications/:id', async (req, res) => {
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

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error("🚨 MIDDLEWARE CRASH:", err);
    res.status(500).json({ error: "Server Error: " + err.message });
});
// ----------------------------

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
