require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult, param } = require('express-validator');
const multer = require('multer');
const fs = require('fs');
const https = require('https');

// WhatsApp Config (for owner notification)
const WA_PHONE = "918378905114"; // Owner phone
const WA_API_KEY = process.env.WHATSAPP_API_KEY; // Get from callmebot.com

function notifyOwnerOnWhatsApp(booking) {
    if (!WA_API_KEY) {
        console.log("WhatsApp Notification: No API key found. Skipping.");
        return;
    }
    
    const text = `New Booking Alert! 💇\n\nName: ${booking.name}\nService: ${booking.services}\nDate: ${booking.date}\nTime: ${booking.time}\nPhone: ${booking.phone}`;
    const url = `https://api.callmebot.com/whatsapp.php?phone=${WA_PHONE}&text=${encodeURIComponent(text)}&apikey=${WA_API_KEY}`;
    
    https.get(url, (res) => {
        console.log(`WhatsApp Notification sent. Status: ${res.statusCode}`);
    }).on('error', (e) => {
        console.error(`WhatsApp Notification check failed: ${e.message}`);
    });
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const db = new Database(process.env.DATABASE_URL || 'salon.db');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads', 'resumes');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer for resume uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        const filetypes = /pdf|doc|docx/;
        const mimetypes = /application\/pdf|application\/msword|application\/vnd.openxmlformats-officedocument.wordprocessingml.document/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = mimetypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error("Error: File upload only supports the following filetypes - " + filetypes));
    }
});

// --- Security Middleware ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'", "'unsafe-hashes'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
            "script-src-attr": ["'unsafe-inline'"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            "img-src": ["'self'", "data:", "https://*"],
            "connect-src": ["'self'", "ws:", "http://localhost:3000", "http://127.0.0.1:3000"],
            "media-src": ["'self'", "https://assets.mixkit.co", "https://*"]
        },
    },
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use('/api/', limiter);

app.use(cors({
    origin: '*', // In production, restrict this to your domain
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Auth Middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
        req.user = user;
        next();
    });
};

// --- Validation Schemas ---
const bookingValidation = [
    body('name').trim().isLength({ min: 2, max: 100 }).escape(),
    body('phone').trim().matches(/^\+?[\d\s-]{10,}$/).withMessage('Invalid phone number format').escape(),
    body('services').trim().notEmpty().escape(),
    body('date').trim().isISO8601().withMessage('Invalid date format'),
    body('time').trim().notEmpty().escape(),
    body('message').optional().trim().isLength({ max: 500 }).escape()
];

// --- API Endpoints ---

// 1. Admin Login
app.post('/api/admin/login', [
    body('username').trim().notEmpty(),
    body('password').notEmpty()
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { username, password } = req.body;
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);

    if (admin && bcrypt.compareSync(password, admin.password)) {
        const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ token });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// 2. Public: Create Booking
app.post('/api/book', bookingValidation, (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, phone, services, date, time, message } = req.body;

    try {
        const info = db.prepare(`
            INSERT INTO bookings (name, phone, services, date, time, message)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(name, phone, services, date, time, message);

        // Notify Owner
        notifyOwnerOnWhatsApp({ name, phone, services, date, time });

        res.status(200).json({ message: 'Booking successful', id: info.lastInsertRowid });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 3. Public: Get Available Slots
app.get('/api/slots', (req, res) => {
    try {
        const slots = db.prepare('SELECT * FROM slots').all();
        res.json(slots);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch slots' });
    }
});

// 4. Public: Get Single Booking (for customer cancel page)
app.get('/api/booking/:id', [param('id').isInt()], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
        const booking = db.prepare('SELECT id, name, services, date, time, status FROM bookings WHERE id = ?').get(req.params.id);
        if (booking) {
            res.json(booking);
        } else {
            res.status(404).json({ error: 'Booking not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch booking' });
    }
});

// 5. Public: Customer Self-Cancellation
app.patch('/api/cancel/:id', [param('id').isInt()], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const id = req.params.id;

    try {
        const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        if (booking.status === 'Cancelled') return res.status(400).json({ error: 'Already cancelled' });

        const wasConfirmed = booking.status === 'Confirmed';

        // Use transaction for consistency
        const cancelTransaction = db.transaction(() => {
            db.prepare("UPDATE bookings SET status = 'Cancelled' WHERE id = ?").run(id);
            
            if (wasConfirmed) {
                // Restore slot count
                db.prepare(`
                    UPDATE slots 
                    SET count = count + 1, status = 'Available' 
                    WHERE time = ?
                `).run(booking.time);
            }
        });

        cancelTransaction();
        res.json({ message: 'Booking cancelled successfully' });
    } catch (error) {
        console.error('Cancel error:', error);
        res.status(500).json({ error: 'Failed to cancel booking' });
    }
});

// --- Private Admin Endpoints ---

// 6. Admin: Get All Bookings
app.get('/api/admin/bookings', authenticateToken, (req, res) => {
    try {
        const bookings = db.prepare('SELECT * FROM bookings ORDER BY created_at DESC').all();
        res.json(bookings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

// 7. Admin: Update Booking Status
app.patch('/api/admin/bookings/:id', [
    authenticateToken,
    param('id').isInt(),
    body('status').isIn(['Pending', 'Confirmed', 'Cancelled'])
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    const { status } = req.body;

    try {
        const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });

        const oldStatus = booking.status;

        const updateTransaction = db.transaction(() => {
            db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, id);

            // Handle slot adjustments
            if (status === 'Confirmed' && oldStatus !== 'Confirmed') {
                const result = db.prepare(`
                    UPDATE slots 
                    SET count = count - 1,
                        status = CASE WHEN count - 1 = 0 THEN 'Busy' ELSE 'Limited' END
                    WHERE time = ? AND count > 0
                `).run(booking.time);
                
                if (result.changes === 0) {
                    throw new Error('SLOTS_UNAVAILABLE');
                }
            } else if (status !== 'Confirmed' && oldStatus === 'Confirmed') {
                db.prepare(`
                    UPDATE slots 
                    SET count = count + 1, status = 'Available' 
                    WHERE time = ?
                `).run(booking.time);
            }
        });

        updateTransaction();
        res.json({ message: 'Status updated' });
    } catch (error) {
        console.error('Update status error:', error);
        if (error.message === 'SLOTS_UNAVAILABLE') {
            return res.status(400).json({ error: 'No slots available for the selected time.' });
        }
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// 7b. Admin: Manual Booking
app.post('/api/admin/book', [
    authenticateToken,
    body('name').trim().isLength({ min: 2, max: 100 }).escape(),
    body('phone').trim().matches(/^\+?[\d\s-]{10,}$/).withMessage('Invalid phone number format').escape(),
    body('services').trim().notEmpty().escape(),
    body('date').trim().isISO8601().withMessage('Invalid date format'),
    body('time').trim().notEmpty().escape()
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, phone, services, date, time } = req.body;

    try {
        const createTransaction = db.transaction(() => {
            // Deduct the slot straight away
            const slotResult = db.prepare(`
                UPDATE slots 
                SET count = count - 1,
                    status = CASE WHEN count - 1 = 0 THEN 'Busy' ELSE 'Limited' END
                WHERE time = ? AND count > 0
            `).run(time);

            if (slotResult.changes === 0) {
                throw new Error('SLOTS_UNAVAILABLE');
            }

            // Create booking as Confirmed
            const info = db.prepare(`
                INSERT INTO bookings (name, phone, services, date, time, status, message)
                VALUES (?, ?, ?, ?, ?, 'Confirmed', 'Manual admin booking')
            `).run(name, phone, services, date, time);
            
            return info.lastInsertRowid;
        });

        const newId = createTransaction();
        res.status(200).json({ message: 'Manual booking successful', id: newId });
    } catch (error) {
        console.error('Manual booking error:', error);
        if (error.message === 'SLOTS_UNAVAILABLE') {
            return res.status(400).json({ error: 'No slots available for the selected time.' });
        }
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 8. Admin: Update Slots
app.post('/api/admin/slots', authenticateToken, (req, res) => {
    const { slots } = req.body;
    try {
        const updateMany = db.transaction((slotList) => {
            for (const slot of slotList) {
                db.prepare('UPDATE slots SET status = ?, count = ? WHERE time = ?')
                    .run(slot.status, slot.count, slot.time);
            }
        });
        updateMany(slots);
        res.json({ message: 'Slots updated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update slots' });
    }
});

// 8b. Admin: Get Career Applications
app.get('/api/admin/applications', authenticateToken, (req, res) => {
    try {
        const applications = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
        res.json(applications);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch applications' });
    }
});

// 9. Public: Contact Form
app.post('/api/contact', [
    body('name').trim().notEmpty().escape(),
    body('email').trim().isEmail().normalizeEmail(),
    body('message').trim().notEmpty().escape()
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, message } = req.body;
    console.log(`[Contact Form] ${name} (${email}): ${message}`);
    
    // In a real app, you might save this to a 'contacts' table or send an email
    // For now, we'll just log it and return success
    res.json({ message: 'Message received. We will get back to you soon!' });
});

// 10. Public: Career Application
app.post('/api/career', upload.single('resume'), [
    body('name').trim().notEmpty().escape(),
    body('email').trim().isEmail().normalizeEmail(),
    body('number').trim().notEmpty().escape(),
    body('position_type').trim().notEmpty().escape()
], (req, res) => {
    const errors = validationResult(req);
    // If there are validation errors, we should also delete the uploaded file if there is one
    if (!errors.isEmpty()) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ errors: errors.array() });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'Resume file is required (PDF, DOC, DOCX)' });
    }

    const { name, email, number, position_type } = req.body;
    const resume_path = req.file.path;

    try {
        const info = db.prepare(`
            INSERT INTO applications (name, email, number, position_type, resume_path)
            VALUES (?, ?, ?, ?, ?)
        `).run(name, email, number, position_type, resume_path);

        res.status(200).json({ message: 'Application submitted successfully', id: info.lastInsertRowid });
    } catch (error) {
        console.error('Database error on application:', error);
        // Clean up file if db fails
        if (fs.existsSync(resume_path)) {
            fs.unlinkSync(resume_path);
        }
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Catch-all to serve index.html for undefined routes (Optional for SPA style) ---
// app.get('*', (req, res) => {
//     res.sendFile(path.join(__dirname, 'index.html'));
// });

app.listen(PORT, () => {
    console.log(`\n===============================================`);
    console.log(`🚀 Salon de PET-LEEN Secure Backend Active!`);
    console.log(`🔒 Environment: Production (Security Enhanced)`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`🛠️ SQL Database: ${process.env.DATABASE_URL || 'salon.db'}`);
    console.log(`===============================================\n`);
});
