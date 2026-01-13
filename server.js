import 'dotenv/config';
import express from 'express';
import sqlite3 from 'sqlite3';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import https from 'https';

// --- CONFIGURAÇÃO DE SEGURANÇA E AMBIENTE (LGPD) ---
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

let keyBuffer;
if (process.env.ENCRYPTION_KEY) {
    keyBuffer = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    if (keyBuffer.length !== 32) {
        console.warn("Aviso: ENCRYPTION_KEY fornecida não tem 32 bytes. Usando SHA-256.");
        keyBuffer = crypto.createHash('sha256').update(String(process.env.ENCRYPTION_KEY)).digest();
    }
} else {
    keyBuffer = crypto.randomBytes(32);
}
const ENCRYPTION_KEY = keyBuffer;
const IV_LENGTH = 16; 

function encrypt(text) {
    if (!text) return text;
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(String(text));
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (e) {
        console.error("Erro de criptografia:", e.message);
        return null;
    }
}

function decrypt(text) {
    if (!text || !text.includes(':')) return text; 
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        return text; 
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_LOGO_DIR = path.join(__dirname, 'logo');
if (!fs.existsSync(LOCAL_LOGO_DIR)){
    fs.mkdirSync(LOCAL_LOGO_DIR, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: false, 
    crossOriginEmbedderPolicy: false
})); 
app.use(cors()); 
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && !process.env.SSL_KEY_PATH) {
        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        if (!isSecure) {
            return res.redirect(`https://${req.headers.host}${req.url}`);
        }
    }
    next();
});

const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, 
	limit: 300, 
	standardHeaders: 'draft-7',
	legacyHeaders: false,
    message: { error: "Muitas requisições. Tente novamente mais tarde." }
});
app.use('/api/', apiLimiter);

app.use(express.static(path.join(__dirname, 'dist')));

const BACKUP_DIR = '/backup';
let PERSISTENT_LOGO_DIR = path.join(__dirname, 'backup_logos_fallback'); 

try {
    if (!fs.existsSync(BACKUP_DIR)) {
        try {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
        } catch (e) {
            if (!fs.existsSync('./backup')) {
                fs.mkdirSync('./backup', { recursive: true });
            }
        }
    }
} catch (e) {
    console.error("Aviso: Erro ao configurar diretórios de backup:", e.message);
}

if (fs.existsSync(BACKUP_DIR)) {
    try {
        fs.accessSync(BACKUP_DIR, fs.constants.W_OK);
        PERSISTENT_LOGO_DIR = path.join(BACKUP_DIR, 'logos');
    } catch (e) {
        PERSISTENT_LOGO_DIR = './backup/logos';
    }
} else {
    PERSISTENT_LOGO_DIR = './backup/logos';
}

if (!fs.existsSync(PERSISTENT_LOGO_DIR)) {
    fs.mkdirSync(PERSISTENT_LOGO_DIR, { recursive: true });
}

let dbPath = './backup/finance_v2.db'; 
if (fs.existsSync(BACKUP_DIR)) {
    try {
        fs.accessSync(BACKUP_DIR, fs.constants.W_OK);
        dbPath = path.join(BACKUP_DIR, 'finance_v2.db');
    } catch (e) {}
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("ERRO CRÍTICO AO ABRIR BANCO DE DADOS:", err.message);
    else {
        console.log(`Banco de dados conectado em: ${dbPath}`);
        db.run('PRAGMA journal_mode = WAL;'); 
    }
});

app.use('/logo', (req, res, next) => {
    const urlPath = req.path;
    const persistentFile = path.join(PERSISTENT_LOGO_DIR, urlPath);
    if (fs.existsSync(persistentFile)) {
        return res.sendFile(persistentFile);
    }
    next();
});
app.use('/logo', express.static(LOCAL_LOGO_DIR));

function logAudit(userId, action, details, ip) {
    const timestamp = new Date().toISOString();
    db.run(
        `INSERT INTO audit_logs (user_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)`,
        [userId, action, details, ip, timestamp],
        (err) => { if(err) console.error("Erro Audit Log:", err); }
    );
}

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "Token não fornecido." });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: "Sessão expirada." });
        req.user = decoded; 
        req.userId = decoded.id; 
        next();
    });
};

const checkAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        logAudit(req.userId, 'UNAUTHORIZED_ADMIN_ACCESS', 'Tentativa de acesso admin', req.ip);
        return res.status(403).json({ error: "Acesso negado: Apenas administradores." });
    }
    next();
};

const mailPort = Number(process.env.MAIL_PORT) || 587;
const mailSecure = mailPort === 465 ? true : false; 

const transporter = nodemailer.createTransport({
    host: process.env.MAIL_SERVER,
    port: mailPort,
    secure: mailSecure, 
    auth: {
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD,
    },
});

const sendEmail = async (to, subject, htmlContent) => {
  if (!process.env.MAIL_SERVER) {
      console.warn("[EMAIL] Configurações ausentes. Simulando envio.");
      return true;
  }
  try {
      const fromName = process.env.MAIL_FROM_NAME || "Virgula Contábil";
      const fromAddress = process.env.MAIL_FROM_ADDRESS || process.env.MAIL_USERNAME;
      const info = await transporter.sendMail({
          from: `"${fromName}" <${fromAddress}>`,
          to: to,
          subject: subject,
          html: htmlContent
      });
      return true;
  } catch (error) {
      console.error(`[EMAIL] Erro FATAL ao enviar para ${to}:`, error.message);
      return false;
  }
};

const INITIAL_BANKS_SEED = [
  { name: 'Nubank', logo: '/logo/nubank.jpg' },
  { name: 'Itaú', logo: '/logo/itau.png' },
  { name: 'Bradesco', logo: '/logo/bradesco.jpg' },
  { name: 'Caixa Econômica', logo: '/logo/caixa.png' },
  { name: 'Banco do Brasil', logo: '/logo/bb.png' },
  { name: 'Santander', logo: '/logo/santander.png' },
  { name: 'Inter', logo: '/logo/inter.png' },
  { name: 'BTG Pactual', logo: '/logo/btg_pactual.png' },
  { name: 'C6 Bank', logo: '/logo/c6_bank.png' },
  { name: 'Sicredi', logo: '/logo/sicredi.png' },
  { name: 'Sicoob', logo: '/logo/sicoob.png' },
  { name: 'Mercado Pago', logo: '/logo/mercado_pago.png' },
  { name: 'PagBank', logo: '/logo/pagbank.png' },
  { name: 'Stone', logo: '/logo/stone.png' },
  { name: 'Banco Safra', logo: '/logo/safra.png' },
  { name: 'Banco Pan', logo: '/logo/banco_pan.png' },
  { name: 'Banrisul', logo: '/logo/banrisul.png' },
  { name: 'Neon', logo: '/logo/neon.png' },
  { name: 'Caixa Registradora', logo: '/logo/caixaf.png' },
];

// Configuração completa com grupos DRE
const INITIAL_CATEGORIES_SEED = [
    // RECEITAS
    { name: 'Vendas de Mercadorias', type: 'receita', group: 'receita_bruta' },
    { name: 'Prestação de Serviços', type: 'receita', group: 'receita_bruta' },
    { name: 'Receita de Aluguel', type: 'receita', group: 'outras_receitas' },
    { name: 'Comissões Recebidas', type: 'receita', group: 'receita_bruta' },
    { name: 'Receita Financeira (juros, rendimentos)', type: 'receita', group: 'receita_financeira' },
    { name: 'Devoluções de Despesas', type: 'receita', group: 'receita_financeira' },
    { name: 'Reembolsos de Clientes', type: 'receita', group: 'outras_receitas' },
    { name: 'Transferências Internas', type: 'receita', group: 'nao_operacional' },
    { name: 'Aportes de Sócios / Investimentos', type: 'receita', group: 'nao_operacional' },
    { name: 'Outras Receitas Operacionais', type: 'receita', group: 'outras_receitas' },
    { name: 'Receitas Não Operacionais (venda de ativo)', type: 'receita', group: 'receita_nao_operacional' },
    // DESPESAS
    { name: 'Compra de Mercadorias / Matéria-Prima', type: 'despesa', group: 'cmv' },
    { name: 'Fretes e Transportes', type: 'despesa', group: 'cmv' },
    { name: 'Despesas com Pessoal (salários, pró-labore)', type: 'despesa', group: 'despesa_pessoal' },
    { name: 'Serviços de Terceiros (contabilidade, marketing)', type: 'despesa', group: 'despesa_operacional' },
    { name: 'Despesas Administrativas (papelaria, escritório)', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Despesas Comerciais (comissões, propaganda)', type: 'despesa', group: 'despesa_operacional' },
    { name: 'Energia Elétrica / Água / Telefone / Internet', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Aluguel e Condomínio', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Manutenção e Limpeza', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Combustível e Deslocamento', type: 'despesa', group: 'despesa_operacional' },
    { name: 'Seguros', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Tarifas Bancárias e Juros', type: 'despesa', group: 'despesa_financeira' },
    { name: 'Impostos e Taxas (ISS, ICMS, DAS)', type: 'despesa', group: 'impostos' },
    { name: 'Despesas Financeiras', type: 'despesa', group: 'despesa_financeira' },
    { name: 'Transferências Internas', type: 'despesa', group: 'nao_operacional' },
    { name: 'Distribuição de Lucros / Retirada', type: 'despesa', group: 'nao_operacional' },
    { name: 'Outras Despesas Operacionais', type: 'despesa', group: 'despesa_operacional' },
    { name: 'Despesas Não Operacionais', type: 'despesa', group: 'despesa_nao_operacional' }
];

const ensureColumn = (table, column, definition) => {
    db.all(`PRAGMA table_info(${table})`, (err, rows) => {
        if (!err && rows && !rows.some(r => r.name === column)) {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
    });
};

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS global_banks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, logo TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT, cnpj TEXT, razao_social TEXT, phone TEXT, reset_token TEXT, reset_token_expires INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS pending_signups (email TEXT PRIMARY KEY, token TEXT, cnpj TEXT, razao_social TEXT, phone TEXT, created_at INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS banks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, account_number TEXT, nickname TEXT, logo TEXT, active INTEGER DEFAULT 1, balance REAL DEFAULT 0, FOREIGN KEY(user_id) REFERENCES users(id))`);
  
  db.run(`CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, type TEXT, group_type TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`, (err) => {
      if(!err) ensureColumn('categories', 'group_type', 'TEXT');
  });

  db.run(`CREATE TABLE IF NOT EXISTS ofx_imports (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, file_name TEXT, import_date TEXT, bank_id INTEGER, transaction_count INTEGER, content TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, date TEXT, description TEXT, value REAL, type TEXT, category_id INTEGER, bank_id INTEGER, reconciled INTEGER, ofx_import_id INTEGER, FOREIGN KEY(user_id) REFERENCES users(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS forecasts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, date TEXT, description TEXT, value REAL, type TEXT, category_id INTEGER, bank_id INTEGER, realized INTEGER, installment_current INTEGER, installment_total INTEGER, group_id TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS keyword_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, keyword TEXT, type TEXT, category_id INTEGER, bank_id INTEGER, FOREIGN KEY(user_id) REFERENCES users(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT, details TEXT, ip_address TEXT, created_at TEXT)`);
  
  // Seed Global Banks
  db.get("SELECT COUNT(*) as count FROM global_banks", [], (err, row) => {
      if (!err && row && row.count === 0) {
          const stmt = db.prepare("INSERT INTO global_banks (name, logo) VALUES (?, ?)");
          INITIAL_BANKS_SEED.forEach(b => stmt.run(b.name, b.logo));
          stmt.finalize();
      }
  });
});

// ... Routes (Auth, Admin, etc.) omitted for brevity, keeping relevant changes ...

app.get('/api/categories', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM categories WHERE user_id = ?`, [req.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const existingNames = new Set(rows.map(r => r.name));
        const missingCategories = INITIAL_CATEGORIES_SEED.filter(c => !existingNames.has(c.name));

        if (missingCategories.length > 0) {
            const stmt = db.prepare("INSERT INTO categories (user_id, name, type, group_type) VALUES (?, ?, ?, ?)");
            missingCategories.forEach(c => {
                stmt.run(req.userId, c.name, c.type, c.group);
            });
            stmt.finalize(() => {
                db.all(`SELECT * FROM categories WHERE user_id = ? ORDER BY name ASC`, [req.userId], (err, newRows) => {
                    res.json(newRows.map(r => ({
                        id: r.id, 
                        name: r.name, 
                        type: r.type, 
                        groupType: r.group_type // Map snake_case to camelCase
                    })));
                });
            });
        } else {
            res.json(rows.map(r => ({
                id: r.id, 
                name: r.name, 
                type: r.type, 
                groupType: r.group_type
            })).sort((a,b) => a.name.localeCompare(b.name)));
        }
    });
});

app.post('/api/categories', authenticateToken, (req, res) => {
    const { name, type, groupType } = req.body;
    db.run(
        `INSERT INTO categories (user_id, name, type, group_type) VALUES (?, ?, ?, ?)`,
        [req.userId, name, type, groupType || 'outros'],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name, type, groupType });
        }
    );
});

app.put('/api/categories/:id', authenticateToken, (req, res) => {
    const { name, type, groupType } = req.body;
    db.run(
        `UPDATE categories SET name = ?, type = ?, group_type = ? WHERE id = ? AND user_id = ?`,
        [name, type, groupType, req.params.id, req.userId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.delete('/api/categories/:id', authenticateToken, (req, res) => {
    db.run(`DELETE FROM categories WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

// ... Remaining routes (Transactions, Banks, Reports, etc.) ...
// Mantendo o restante das rotas como estavam, pois apenas categories teve mudança significativa no schema

app.get('/api/global-banks', (req, res) => {
    db.all('SELECT * FROM global_banks ORDER BY name ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// User routes (Banks, Transactions, etc.) - keep existing implementation
app.use('/api', authenticateToken);

// ... (other route implementations) ...

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const startServer = () => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
};

startServer();