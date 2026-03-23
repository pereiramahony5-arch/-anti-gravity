const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const db = new Database('salon.db');

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time TEXT UNIQUE,
        status TEXT,
        count INTEGER
    );

    CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT,
        services TEXT,
        date TEXT,
        time TEXT,
        message TEXT,
        status TEXT DEFAULT 'Pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    );

    CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT,
        number TEXT,
        position_type TEXT,
        resume_path TEXT,
        status TEXT DEFAULT 'Pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Seed slots
const defaultSlots = [
    { time: "10:00 AM", status: "Available", count: 1 },
    { time: "11:00 AM", status: "Available", count: 1 },
    { time: "12:00 PM", status: "Available", count: 1 },
    { time: "01:00 PM", status: "Available", count: 1 },
    { time: "02:00 PM", status: "Available", count: 1 },
    { time: "03:00 PM", status: "Available", count: 1 },
    { time: "04:00 PM", status: "Available", count: 1 },
    { time: "05:00 PM", status: "Available", count: 1 },
    { time: "06:00 PM", status: "Available", count: 1 },
    { time: "07:00 PM", status: "Available", count: 1 },
    { time: "08:00 PM", status: "Available", count: 1 }
];

const insertSlot = db.prepare('INSERT OR IGNORE INTO slots (time, status, count) VALUES (?, ?, ?)');
const insertManySlots = db.transaction((slots) => {
    for (const slot of slots) insertSlot.run(slot.time, slot.status, slot.count);
});
insertManySlots(defaultSlots);

// Seed admin
const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || 'admin123';
const hashedPassword = bcrypt.hashSync(password, 10);

const insertAdmin = db.prepare('INSERT OR IGNORE INTO admins (username, password) VALUES (?, ?)');
insertAdmin.run(username, hashedPassword);

console.log('Database initialized successfully.');
db.close();
