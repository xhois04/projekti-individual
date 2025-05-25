const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ─── 0. SERVE STATIC FILES ─────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── ADDITION: explicit root handler so index.html is served ─
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── 1. OPEN OR CREATE DATABASE ─────────────────────────────
const dbPath = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(dbPath, err => {
    if (err) console.error(err);
    else console.log('Connected to SQLite database.');
});

// ─── 2. CREATE TABLES & SEED ─────────────────────────────────
db.serialize(() => {
    // consoles table
    db.run(`
        CREATE TABLE IF NOT EXISTS consoles (
                                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                name TEXT UNIQUE NOT NULL
        );
    `);

    // games table
    db.run(`
        CREATE TABLE IF NOT EXISTS games (
                                             id INTEGER PRIMARY KEY AUTOINCREMENT,
                                             name TEXT NOT NULL,
                                             platform TEXT NOT NULL,
                                             FOREIGN KEY (platform) REFERENCES consoles(name)
            );
    `);

    // items table (inventory for games, consoles, merch)
    db.run(`
        CREATE TABLE IF NOT EXISTS items (
                                             id        INTEGER PRIMARY KEY AUTOINCREMENT,
                                             category  TEXT NOT NULL,
                                             name      TEXT NOT NULL,
                                             price     REAL NOT NULL DEFAULT 0,
                                             quantity  INTEGER NOT NULL DEFAULT 0
        );
    `);

    // seed consoles if empty
    db.get(`SELECT COUNT(*) AS cnt FROM consoles`, (err, row) => {
        if (err) {
            console.error('Error counting consoles:', err);
        } else if (row.cnt === 0) {
            const consoles = ['PC','PlayStation','Xbox','Nintendo Switch'];
            const stmt = db.prepare(`INSERT INTO consoles(name) VALUES (?)`);
            consoles.forEach(c => stmt.run(c));
            stmt.finalize();
        }
    });

    // seed games if empty
    db.get(`SELECT COUNT(*) AS cnt FROM games`, (err, row) => {
        if (err) {
            console.error('Error counting games:', err);
        } else if (row.cnt === 0) {
            const games = [
                ['Halo Infinite','Xbox'],
                ['Spider-Man','PlayStation'],
                ['Civilization VI','PC'],
                ['Zelda: Breath of the Wild','Nintendo Switch']
            ];
            const stmt = db.prepare(`INSERT INTO games(name,platform) VALUES (?,?)`);
            games.forEach(g => stmt.run(g[0], g[1]));
            stmt.finalize();
        }
    });

    // seed items if empty
    db.get(`SELECT COUNT(*) AS cnt FROM items`, (err, row) => {
        if (err) {
            console.error('Error counting items:', err);
        } else if (row.cnt === 0) {
            const seed = [
                ['game','Halo Infinite',59.99,20],
                ['console','PlayStation 5',499.99,10],
                ['merch','Evangelion T-Shirt',24.99,50]
            ];
            const stmt = db.prepare(`INSERT INTO items(category,name,price,quantity) VALUES (?,?,?,?)`);
            seed.forEach(r => stmt.run(r));
            stmt.finalize();
        }
    });
});

// ─── 3. INVENTORY API ───────────────────────────────────────
// GET items (optional ?category=game|console|merch)
app.get('/api/items', (req, res) => {
    const { category } = req.query;
    let sql = `SELECT * FROM items`;
    const params = [];
    if (category) {
        sql += ` WHERE category = ?`;
        params.push(category);
    }
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST new item
app.post('/api/items', (req, res) => {
    const { category, name, price, quantity } = req.body;
    db.run(
        `INSERT INTO items(category,name,price,quantity) VALUES(?,?,?,?)`,
        [category, name, price, quantity],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

// PUT update item
app.put('/api/items/:id', (req, res) => {
    const { name, price, quantity } = req.body;
    db.run(
        `UPDATE items SET name=?, price=?, quantity=? WHERE id=?`,
        [name, price, quantity, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ changes: this.changes });
        }
    );
});

// DELETE item
app.delete('/api/items/:id', (req, res) => {
    db.run(`DELETE FROM items WHERE id=?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ changes: this.changes });
    });
});

// ─── 4. ORDERS API (decrement inventory) ───────────────────
app.post('/api/orders', (req, res) => {
    const { items } = req.body; // [{ id, qty }, ...]
    const stmt = db.prepare(`UPDATE items SET quantity = quantity - ? WHERE id = ?`);
    db.serialize(() => {
        items.forEach(i => stmt.run(i.qty, i.id));
        stmt.finalize();
        res.json({ status: 'ok' });
    });
});

// ─── 5. CONSOLES & GAMES API ───────────────────────────────
// GET all consoles
app.get('/api/consoles', (req, res) => {
    db.all(`SELECT name FROM consoles ORDER BY name`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => r.name));
    });
});

// GET games, optional ?platform=&search=
app.get('/api/games', (req, res) => {
    const { platform = '', search = '' } = req.query;
    let sql = `SELECT name, platform FROM games WHERE 1=1`;
    const params = [];
    if (platform) {
        sql += ` AND platform = ?`;
        params.push(platform);
    }
    if (search) {
        sql += ` AND name LIKE ?`;
        params.push(`%${search}%`);
    }
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ─── 6. START SERVER ───────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`API server and static web root running on http://localhost:${PORT}`);
});
