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

// CATEGORIAS PADRONIZADAS PARA DRE
const INITIAL_CATEGORIES_SEED = [
    // RECEITAS
    { name: 'Vendas de Mercadorias', type: 'receita', group: 'receita_bruta' },
    { name: 'Prestação de Serviços', type: 'receita', group: 'receita_bruta' },
    { name: 'Receita de Aluguel', type: 'receita', group: 'outras_receitas' },
    { name: 'Comissões Recebidas', type: 'receita', group: 'receita_bruta' },
    { name: 'Receita Financeira', type: 'receita', group: 'receita_financeira' },
    { name: 'Devoluções de Despesas', type: 'receita', group: 'receita_financeira' },
    { name: 'Reembolsos de Clientes', type: 'receita', group: 'outras_receitas' },
    { name: 'Outras Receitas Operacionais', type: 'receita', group: 'outras_receitas' },
    { name: 'Venda de Ativo Imobilizado', type: 'receita', group: 'receita_nao_operacional' },
    
    // CUSTOS
    { name: 'Compra de Mercadorias', type: 'despesa', group: 'cmv' },
    { name: 'Matéria-Prima', type: 'despesa', group: 'cmv' },
    { name: 'Fretes sobre Compras', type: 'despesa', group: 'cmv' },
    { name: 'Embalagens', type: 'despesa', group: 'cmv' },

    // DESPESAS OPERACIONAIS
    { name: 'Salários e Ordenados', type: 'despesa', group: 'despesa_pessoal' },
    { name: 'Pró-Labore', type: 'despesa', group: 'despesa_pessoal' },
    { name: 'Vale Transporte / Alimentação', type: 'despesa', group: 'despesa_pessoal' },
    { name: 'Encargos Sociais (FGTS/INSS)', type: 'despesa', group: 'despesa_pessoal' },
    
    { name: 'Aluguel e Condomínio', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Energia / Água / Telefone', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Internet e Sistemas', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Material de Escritório/Limpeza', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Contabilidade e Jurídico', type: 'despesa', group: 'despesa_administrativa' },
    
    { name: 'Marketing e Publicidade', type: 'despesa', group: 'despesa_operacional' },
    { name: 'Comissões de Vendas', type: 'despesa', group: 'despesa_operacional' },
    { name: 'Combustível e Viagens', type: 'despesa', group: 'despesa_operacional' },
    
    // IMPOSTOS
    { name: 'DAS - Simples Nacional', type: 'despesa', group: 'impostos' },
    { name: 'ICMS / ISS a Recolher', type: 'despesa', group: 'impostos' },
    { name: 'Taxas e Alvarás', type: 'despesa', group: 'impostos' },

    // FINANCEIRAS
    { name: 'Tarifas Bancárias', type: 'despesa', group: 'despesa_financeira' },
    { name: 'Juros Pagos', type: 'despesa', group: 'despesa_financeira' },
    { name: 'Antecipação de Recebíveis', type: 'despesa', group: 'despesa_financeira' },

    // NÃO OPERACIONAIS / TRANSFERÊNCIAS
    { name: 'Distribuição de Lucros', type: 'despesa', group: 'nao_operacional' },
    { name: 'Empréstimos (Pagamento Principal)', type: 'despesa', group: 'nao_operacional' },
    { name: 'Transferência entre Contas', type: 'despesa', group: 'nao_operacional' },
    { name: 'Transferência entre Contas', type: 'receita', group: 'nao_operacional' }
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
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT, cnpj TEXT, razao_social TEXT, phone TEXT, reset_token TEXT, reset_token_expires INTEGER, role TEXT DEFAULT 'user')`, (err) => {
      if(!err) ensureColumn('users', 'role', "TEXT DEFAULT 'user'");
  });
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

// --- ROTAS PÚBLICAS (SEM AUTENTICAÇÃO) ---

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err) return res.status(500).json({ error: "Erro no servidor" });
        if (!user) return res.status(401).json({ error: "Usuário ou senha incorretos" });

        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) return res.status(401).json({ error: "Usuário ou senha incorretos" });

        const token = jwt.sign({ id: user.id, email: user.email, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '24h' });
        
        logAudit(user.id, 'LOGIN', 'Login realizado com sucesso', req.ip);

        res.json({ 
            token, 
            user: { 
                id: user.id, 
                email: user.email, 
                razaoSocial: decrypt(user.razao_social), 
                cnpj: decrypt(user.cnpj),
                role: user.role
            } 
        });
    });
});

app.post('/api/request-signup', (req, res) => {
    const { email, cnpj, razaoSocial, phone } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    
    // Check if user exists
    db.get("SELECT id FROM users WHERE email = ?", [email], (err, row) => {
        if(row) return res.status(400).json({ error: "Email já cadastrado." });

        db.run(
            `INSERT OR REPLACE INTO pending_signups (email, token, cnpj, razao_social, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [email, token, encrypt(cnpj), encrypt(razaoSocial), encrypt(phone), Date.now()],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                
                const link = `${req.protocol}://${req.get('host')}/?action=finalize&token=${token}`;
                sendEmail(email, "Finalize seu cadastro - Virgula Contábil", 
                    `<p>Clique no link para criar sua senha e ativar sua conta:</p><a href="${link}">${link}</a>`
                );
                res.json({ message: "Link enviado" });
            }
        );
    });
});

app.get('/api/validate-signup-token/:token', (req, res) => {
    db.get("SELECT * FROM pending_signups WHERE token = ?", [req.params.token], (err, row) => {
        if (!row) return res.status(404).json({ error: "Token inválido" });
        res.json({ email: row.email, razaoSocial: decrypt(row.razao_social) });
    });
});

app.post('/api/complete-signup', (req, res) => {
    const { token, password } = req.body;
    db.get("SELECT * FROM pending_signups WHERE token = ?", [token], (err, pending) => {
        if (!pending) return res.status(400).json({ error: "Token inválido" });

        const hash = bcrypt.hashSync(password, 10);
        db.run(
            `INSERT INTO users (email, password, cnpj, razao_social, phone) VALUES (?, ?, ?, ?, ?)`,
            [pending.email, hash, pending.cnpj, pending.razao_social, pending.phone],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                const userId = this.lastID;
                
                // Seed Categories for new user
                const stmt = db.prepare("INSERT INTO categories (user_id, name, type, group_type) VALUES (?, ?, ?, ?)");
                INITIAL_CATEGORIES_SEED.forEach(c => stmt.run(userId, c.name, c.type, c.group));
                stmt.finalize();

                db.run("DELETE FROM pending_signups WHERE email = ?", [pending.email]);
                
                logAudit(userId, 'SIGNUP_COMPLETE', 'Cadastro finalizado', req.ip);
                res.json({ success: true });
            }
        );
    });
});

app.post('/api/recover-password', (req, res) => {
    const { email } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour

    db.run("UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE email = ?", [token, expires, email], function(err) {
        if (this.changes > 0) {
            const link = `${req.protocol}://${req.get('host')}/?action=reset&token=${token}`;
            sendEmail(email, "Recuperação de Senha", `<a href="${link}">Redefinir Senha</a>`);
        }
        res.json({ message: "Se o email existir, as instruções foram enviadas." });
    });
});

app.post('/api/reset-password-confirm', (req, res) => {
    const { token, newPassword } = req.body;
    db.get("SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?", [token, Date.now()], (err, user) => {
        if (!user) return res.status(400).json({ error: "Link inválido ou expirado" });

        const hash = bcrypt.hashSync(newPassword, 10);
        db.run("UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?", [hash, user.id], (err) => {
            logAudit(user.id, 'PASSWORD_RESET', 'Senha redefinida via link', req.ip);
            res.json({ success: true });
        });
    });
});

// --- ROTAS PROTEGIDAS (REQUEREM TOKEN) ---

app.get('/api/global-banks', authenticateToken, (req, res) => {
    db.all('SELECT * FROM global_banks ORDER BY name ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// ROTAS DE BANCOS
app.get('/api/banks', authenticateToken, (req, res) => {
    db.all('SELECT * FROM banks WHERE user_id = ? ORDER BY active DESC, name ASC', [req.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/banks', authenticateToken, (req, res) => {
    const { name, accountNumber, nickname, logo } = req.body;
    db.run(
        `INSERT INTO banks (user_id, name, account_number, nickname, logo) VALUES (?, ?, ?, ?, ?)`,
        [req.userId, name, accountNumber, nickname, logo],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req.userId, 'CREATE_BANK', `Criou banco ${name}`, req.ip);
            res.json({ id: this.lastID });
        }
    );
});

app.put('/api/banks/:id', authenticateToken, (req, res) => {
    const { nickname, active } = req.body;
    db.run(
        `UPDATE banks SET nickname = COALESCE(?, nickname), active = COALESCE(?, active) WHERE id = ? AND user_id = ?`,
        [nickname, active, req.params.id, req.userId],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.delete('/api/banks/:id', authenticateToken, (req, res) => {
    db.serialize(() => {
        db.run("DELETE FROM transactions WHERE bank_id = ? AND user_id = ?", [req.params.id, req.userId]);
        db.run("DELETE FROM forecasts WHERE bank_id = ? AND user_id = ?", [req.params.id, req.userId]);
        db.run("DELETE FROM banks WHERE id = ? AND user_id = ?", [req.params.id, req.userId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req.userId, 'DELETE_BANK', `Excluiu banco ID ${req.params.id}`, req.ip);
            res.json({ success: true });
        });
    });
});

// ROTAS DE CATEGORIAS
app.get('/api/categories', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM categories WHERE user_id = ?`, [req.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Ensure default categories exist if user has none (fallback safety)
        if (rows.length === 0) {
             const stmt = db.prepare("INSERT INTO categories (user_id, name, type, group_type) VALUES (?, ?, ?, ?)");
             INITIAL_CATEGORIES_SEED.forEach(c => stmt.run(req.userId, c.name, c.type, c.group));
             stmt.finalize(() => {
                 db.all(`SELECT * FROM categories WHERE user_id = ?`, [req.userId], (err, newRows) => {
                     res.json(newRows.map(r => ({ id: r.id, name: r.name, type: r.type, groupType: r.group_type })));
                 });
             });
        } else {
             res.json(rows.map(r => ({ id: r.id, name: r.name, type: r.type, groupType: r.group_type })).sort((a,b) => a.name.localeCompare(b.name)));
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

// ROTAS DE TRANSAÇÕES
app.get('/api/transactions', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 5000`, [req.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => ({ ...r, reconciled: !!r.reconciled, categoryId: r.category_id, bankId: r.bank_id, ofxImportId: r.ofx_import_id })));
    });
});

app.post('/api/transactions', authenticateToken, (req, res) => {
    const { date, description, value, type, categoryId, bankId, reconciled, ofxImportId } = req.body;
    db.run(
        `INSERT INTO transactions (user_id, date, description, value, type, category_id, bank_id, reconciled, ofx_import_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.userId, date, description, value, type, categoryId, bankId, reconciled ? 1 : 0, ofxImportId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // Update bank balance based on transaction (regardless of reconciliation status as per request)
            const modifier = type === 'credito' ? 1 : -1;
            db.run(`UPDATE banks SET balance = balance + ? WHERE id = ?`, [value * modifier, bankId]);
            
            res.json({ id: this.lastID });
        }
    );
});

app.put('/api/transactions/:id', authenticateToken, (req, res) => {
    const { date, description, value, type, categoryId, bankId, reconciled } = req.body;
    
    // First get old values to adjust balance
    db.get(`SELECT * FROM transactions WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err, oldTx) => {
        if (!oldTx) return res.status(404).json({ error: "Transação não encontrada" });

        db.run(
            `UPDATE transactions SET date=?, description=?, value=?, type=?, category_id=?, bank_id=?, reconciled=? WHERE id=? AND user_id=?`,
            [date, description, value, type, categoryId, bankId, reconciled ? 1 : 0, req.params.id, req.userId],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                
                recalculateBankBalance(bankId);
                if (oldTx.bank_id !== bankId) recalculateBankBalance(oldTx.bank_id);

                res.json({ success: true });
            }
        );
    });
});

app.delete('/api/transactions/:id', authenticateToken, (req, res) => {
    db.get(`SELECT bank_id FROM transactions WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err, row) => {
        if (!row) return res.status(404).json({ error: "Não encontrado" });
        
        db.run(`DELETE FROM transactions WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            recalculateBankBalance(row.bank_id);
            res.json({ success: true });
        });
    });
});

app.patch('/api/transactions/:id/reconcile', authenticateToken, (req, res) => {
    const { reconciled } = req.body;
    db.run(`UPDATE transactions SET reconciled = ? WHERE id = ? AND user_id = ?`, [reconciled ? 1 : 0, req.params.id, req.userId], function(err) {
        if(err) return res.status(500).json({ error: err.message });
        
        // No balance update needed strictly for reconcile flag change if we count all transactions, 
        // but robust to recalculate to be safe.
        db.get(`SELECT * FROM transactions WHERE id = ?`, [req.params.id], (err, tx) => {
            if(tx) recalculateBankBalance(tx.bank_id);
        });
        
        res.json({ success: true });
    });
});

app.patch('/api/transactions/batch-update', authenticateToken, (req, res) => {
    const { transactionIds, categoryId } = req.body;
    const ids = transactionIds.join(',');
    
    db.run(
        `UPDATE transactions SET category_id = ?, reconciled = 1 WHERE id IN (${ids}) AND user_id = ?`,
        [categoryId, req.userId],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Helper for Balance Recalc (Modified to count ALL transactions)
function recalculateBankBalance(bankId) {
    db.get(
        `SELECT SUM(CASE WHEN type = 'credito' THEN value ELSE -value END) as balance 
         FROM transactions WHERE bank_id = ?`, // Removed 'AND reconciled = 1'
        [bankId],
        (err, row) => {
            const newBalance = row && row.balance ? row.balance : 0;
            db.run(`UPDATE banks SET balance = ? WHERE id = ?`, [newBalance, bankId]);
        }
    );
}

// ROTAS DE PREVISÕES
app.get('/api/forecasts', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM forecasts WHERE user_id = ? ORDER BY date ASC`, [req.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => ({ ...r, realized: !!r.realized, categoryId: r.category_id, bankId: r.bank_id, installmentCurrent: r.installment_current, installmentTotal: r.installment_total, groupId: r.group_id })));
    });
});

app.post('/api/forecasts', authenticateToken, (req, res) => {
    const { date, description, value, type, categoryId, bankId, realized, installmentCurrent, installmentTotal, groupId } = req.body;
    db.run(
        `INSERT INTO forecasts (user_id, date, description, value, type, category_id, bank_id, realized, installment_current, installment_total, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.userId, date, description, value, type, categoryId, bankId, realized ? 1 : 0, installmentCurrent, installmentTotal, groupId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

app.put('/api/forecasts/:id', authenticateToken, (req, res) => {
    const { date, description, value, type, categoryId, bankId } = req.body;
    db.run(
        `UPDATE forecasts SET date=?, description=?, value=?, type=?, category_id=?, bank_id=? WHERE id=? AND user_id=?`,
        [date, description, value, type, categoryId, bankId, req.params.id, req.userId],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// ATUALIZADO: Efetivação de previsão agora CRIA transação automaticamente
app.patch('/api/forecasts/:id/realize', authenticateToken, (req, res) => {
    const forecastId = req.params.id;
    const userId = req.userId;

    db.get(`SELECT * FROM forecasts WHERE id = ? AND user_id = ?`, [forecastId, userId], (err, forecast) => {
        if (err || !forecast) return res.status(404).json({ error: "Previsão não encontrada" });
        if (forecast.realized) return res.status(400).json({ error: "Previsão já realizada" });

        // Sufixo para a descrição
        let descSuffix = '';
        if (forecast.installment_total) {
            descSuffix = ` (${forecast.installment_current}/${forecast.installment_total})`;
        } else if (forecast.group_id) {
            descSuffix = ' (Recorrente)';
        }

        const finalDescription = forecast.description + descSuffix;

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // 1. Atualizar status da previsão
            db.run(`UPDATE forecasts SET realized = 1 WHERE id = ?`, [forecastId], (err) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }

                // 2. Inserir na tabela de transações
                db.run(
                    `INSERT INTO transactions (user_id, date, description, value, type, category_id, bank_id, reconciled) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
                    [userId, forecast.date, finalDescription, forecast.value, forecast.type, forecast.category_id, forecast.bank_id],
                    function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: err.message });
                        }

                        // 3. Atualizar saldo do banco
                        const modifier = forecast.type === 'credito' ? 1 : -1;
                        db.run(
                            `UPDATE banks SET balance = balance + ? WHERE id = ?`,
                            [forecast.value * modifier, forecast.bank_id],
                            (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: err.message });
                                }
                                db.run('COMMIT');
                                res.json({ success: true });
                            }
                        );
                    }
                );
            });
        });
    });
});

app.delete('/api/forecasts/:id', authenticateToken, (req, res) => {
    const mode = req.query.mode || 'single';
    
    if (mode === 'single') {
        db.run(`DELETE FROM forecasts WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    } else {
        db.get(`SELECT group_id, date FROM forecasts WHERE id = ?`, [req.params.id], (err, current) => {
            if (!current || !current.group_id) {
                // Fallback delete single if no group
                return db.run(`DELETE FROM forecasts WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err) => {
                    res.json({ success: true });
                });
            }

            let sql = `DELETE FROM forecasts WHERE group_id = ? AND user_id = ?`;
            const params = [current.group_id, req.userId];

            if (mode === 'future') {
                sql += ` AND date >= ?`;
                params.push(current.date);
            }

            db.run(sql, params, (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
        });
    }
});

// ROTAS DE OFX
app.get('/api/ofx-imports', authenticateToken, (req, res) => {
    db.all(`SELECT id, file_name, import_date, bank_id, transaction_count FROM ofx_imports WHERE user_id = ? ORDER BY import_date DESC`, [req.userId], (err, rows) => {
        if(err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => ({ ...r, fileName: r.file_name, importDate: r.import_date, bankId: r.bank_id, transactionCount: r.transaction_count })));
    });
});

app.post('/api/ofx-imports', authenticateToken, (req, res) => {
    const { fileName, importDate, bankId, transactionCount, content } = req.body;
    db.run(
        `INSERT INTO ofx_imports (user_id, file_name, import_date, bank_id, transaction_count, content) VALUES (?, ?, ?, ?, ?, ?)`,
        [req.userId, fileName, importDate, bankId, transactionCount, content],
        function(err) {
            if(err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

app.delete('/api/ofx-imports/:id', authenticateToken, (req, res) => {
    db.serialize(() => {
        // Delete associated transactions first
        db.run(`DELETE FROM transactions WHERE ofx_import_id = ? AND user_id = ?`, [req.params.id, req.userId]);
        // Delete import record
        db.run(`DELETE FROM ofx_imports WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], function(err) {
            if(err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// ROTAS DE REGRAS (KEYWORDS)
app.get('/api/keyword-rules', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM keyword_rules WHERE user_id = ?`, [req.userId], (err, rows) => {
        if(err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => ({ ...r, categoryId: r.category_id, bankId: r.bank_id })));
    });
});

app.post('/api/keyword-rules', authenticateToken, (req, res) => {
    const { keyword, type, categoryId, bankId } = req.body;
    db.run(
        `INSERT INTO keyword_rules (user_id, keyword, type, category_id, bank_id) VALUES (?, ?, ?, ?, ?)`,
        [req.userId, keyword, type, categoryId, bankId],
        function(err) {
            if(err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

app.delete('/api/keyword-rules/:id', authenticateToken, (req, res) => {
    db.run(`DELETE FROM keyword_rules WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err) => {
        if(err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// RELATÓRIOS (UPDATED LOGIC)

app.get('/api/reports/cash-flow', authenticateToken, async (req, res) => {
    const { year, month } = req.query;
    const y = parseInt(year);
    const m = month ? parseInt(month) : null;
    const userId = req.userId;

    try {
        let startDate, endDate;
        if (m !== null) {
            startDate = new Date(y, m, 1).toISOString().split('T')[0];
            endDate = new Date(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1, 1).toISOString().split('T')[0];
        } else {
            startDate = new Date(y, 0, 1).toISOString().split('T')[0];
            endDate = new Date(y + 1, 0, 1).toISOString().split('T')[0];
        }

        const balancePromise = new Promise((resolve, reject) => {
            db.get(
                `SELECT SUM(CASE WHEN type = 'credito' THEN value ELSE -value END) as balance 
                 FROM transactions WHERE user_id = ? AND date < ?`,
                [userId, startDate],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.balance || 0);
                }
            );
        });

        const startBalance = await balancePromise;

        db.all(
            `SELECT t.*, c.name as category_name, c.type as category_type
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.user_id = ? AND t.date >= ? AND t.date < ?`,
            [userId, startDate, endDate],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });

                const totalReceitas = rows.filter(r => r.type === 'credito').reduce((sum, r) => sum + r.value, 0);
                const totalDespesas = rows.filter(r => r.type === 'debito').reduce((sum, r) => sum + r.value, 0);
                
                const receitasCat = {};
                const despesasCat = {};

                rows.forEach(r => {
                    const catName = r.category_name || 'Sem Categoria';
                    if (r.type === 'credito') {
                        receitasCat[catName] = (receitasCat[catName] || 0) + r.value;
                    } else {
                        despesasCat[catName] = (despesasCat[catName] || 0) + r.value;
                    }
                });

                res.json({
                    startBalance,
                    totalReceitas,
                    totalDespesas,
                    endBalance: startBalance + totalReceitas - totalDespesas,
                    receitasByCategory: Object.entries(receitasCat).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value),
                    despesasByCategory: Object.entries(despesasCat).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value)
                });
            }
        );

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/reports/daily-flow', authenticateToken, (req, res) => {
    const { startDate, endDate } = req.query;
    const userId = req.userId;

    if (!startDate || !endDate) return res.status(400).json({ error: 'Start and End date required' });

    db.all(
        `SELECT date, type, SUM(value) as total 
         FROM transactions 
         WHERE user_id = ? AND date BETWEEN ? AND ? 
         GROUP BY date, type 
         ORDER BY date ASC`,
        [userId, startDate, endDate],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // Format for chart: [{ date: '...', income: 100, expense: 50, net: 50 }, ...]
            const grouped = {};
            rows.forEach(row => {
                if (!grouped[row.date]) grouped[row.date] = { date: row.date, income: 0, expense: 0, net: 0 };
                if (row.type === 'credito') grouped[row.date].income += row.total;
                else grouped[row.date].expense += row.total;
                grouped[row.date].net = grouped[row.date].income - grouped[row.date].expense;
            });
            
            res.json(Object.values(grouped));
        }
    );
});

app.get('/api/reports/dre', authenticateToken, (req, res) => {
    const { year, month } = req.query;
    const userId = req.userId;
    const y = parseInt(year);
    const m = month ? parseInt(month) : null;

    let query = `SELECT t.*, c.name as category_name, c.type as category_type, c.group_type
                 FROM transactions t 
                 LEFT JOIN categories c ON t.category_id = c.id 
                 WHERE t.user_id = ? AND strftime('%Y', t.date) = ?`;
    
    const params = [userId, String(y)];

    if (m !== null) {
        query += ` AND strftime('%m', t.date) = ?`;
        params.push(String(m + 1).padStart(2, '0'));
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        let dre = {
            receitaBruta: 0,
            deducoes: 0,
            cmv: 0,
            despesasOperacionais: 0,
            resultadoFinanceiro: 0,
            receitaNaoOperacional: 0,
            despesaNaoOperacional: 0,
            impostos: 0 
        };

        rows.forEach(t => {
            const val = t.value;
            const isCredit = t.type === 'credito';
            const group = t.group_type;
            const cat = (t.category_name || '').toLowerCase();

            // Lógica de Agrupamento DRE (Prioriza group_type, fallback para nome)
            if (group) {
                switch(group) {
                    case 'receita_bruta': if(isCredit) dre.receitaBruta += val; break;
                    case 'outras_receitas': if(isCredit) dre.receitaBruta += val; break; // Agrupando em bruta simplificado
                    case 'impostos': if(!isCredit) dre.deducoes += val; break;
                    case 'cmv': if(!isCredit) dre.cmv += val; break;
                    case 'receita_financeira': if(isCredit) dre.resultadoFinanceiro += val; break;
                    case 'despesa_financeira': if(!isCredit) dre.resultadoFinanceiro -= val; break;
                    case 'receita_nao_operacional': if(isCredit) dre.receitaNaoOperacional += val; break;
                    case 'despesa_nao_operacional': if(!isCredit) dre.despesaNaoOperacional += val; break;
                    case 'despesa_operacional':
                    case 'despesa_pessoal':
                    case 'despesa_administrativa':
                        if(!isCredit) dre.despesasOperacionais += val; 
                        break;
                    case 'nao_operacional': break; // Ignora transferências
                    default: 
                        if(!isCredit) dre.despesasOperacionais += val;
                }
            } else {
                // Fallback legado por nome
                if (cat.includes('transferências internas') || cat.includes('aportes')) return;

                if (cat.includes('vendas') || cat.includes('serviços')) { if (isCredit) dre.receitaBruta += val; }
                else if (cat.includes('impostos') || cat.includes('taxas')) { if (!isCredit) dre.deducoes += val; }
                else if (cat.includes('compra') || cat.includes('matéria')) { if (!isCredit) dre.cmv += val; }
                else if (cat.includes('financeira') && isCredit) { dre.resultadoFinanceiro += val; }
                else if (cat.includes('financeira') && !isCredit) { dre.resultadoFinanceiro -= val; }
                else if (!isCredit) { dre.despesasOperacionais += val; }
            }
        });

        const receitaLiquida = dre.receitaBruta - dre.deducoes;
        const resultadoBruto = receitaLiquida - dre.cmv;
        const resultadoOperacional = resultadoBruto - dre.despesasOperacionais;
        const resultadoNaoOperacionalTotal = dre.receitaNaoOperacional - dre.despesaNaoOperacional;
        const resultadoAntesImpostos = resultadoOperacional + dre.resultadoFinanceiro + resultadoNaoOperacionalTotal;
        const lucroLiquido = resultadoAntesImpostos - dre.impostos;

        res.json({
            receitaBruta: dre.receitaBruta,
            deducoes: dre.deducoes,
            receitaLiquida,
            cmv: dre.cmv,
            resultadoBruto,
            despesasOperacionais: dre.despesasOperacionais,
            resultadoOperacional,
            resultadoFinanceiro: dre.resultadoFinanceiro,
            resultadoNaoOperacional: resultadoNaoOperacionalTotal,
            impostos: dre.impostos,
            lucroLiquido,
            resultadoAntesImpostos
        });
    });
});

app.get('/api/reports/analysis', authenticateToken, (req, res) => {
    // ... logic same as previous response, keeping it concise ...
    const { year, month } = req.query;
    const userId = req.userId;
    const y = parseInt(year);
    const m = month ? parseInt(month) : null;

    let query = `SELECT t.*, c.name as category_name, c.type as category_type, c.group_type
                 FROM transactions t 
                 LEFT JOIN categories c ON t.category_id = c.id 
                 WHERE t.user_id = ? AND strftime('%Y', t.date) = ?`;
    
    const params = [userId, String(y)];

    if (m !== null) {
        query += ` AND strftime('%m', t.date) = ?`;
        params.push(String(m + 1).padStart(2, '0'));
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const receitas = {};
        const despesas = {};
        let totalReceitas = 0;
        let totalDespesas = 0;

        let dre = {
            receitaBruta: 0,
            deducoes: 0,
            cmv: 0,
            despesasOperacionais: 0,
            resultadoFinanceiro: 0,
            receitaNaoOperacional: 0,
            despesaNaoOperacional: 0,
            impostos: 0 
        };

        rows.forEach(r => {
            const catName = r.category_name || 'Outros';
            if (r.type === 'credito') {
                receitas[catName] = (receitas[catName] || 0) + r.value;
                totalReceitas += r.value;
            } else {
                despesas[catName] = (despesas[catName] || 0) + r.value;
                totalDespesas += r.value;
            }

            // Simplified DRE Logic for KPIs (Similar to /dre endpoint)
            const val = r.value;
            const isCredit = r.type === 'credito';
            const group = r.group_type;

            if (group) {
                 if(['receita_bruta', 'outras_receitas'].includes(group) && isCredit) dre.receitaBruta += val;
                 else if(group === 'impostos' && !isCredit) dre.deducoes += val;
                 else if(group === 'cmv' && !isCredit) dre.cmv += val;
                 else if(group === 'receita_financeira') dre.resultadoFinanceiro += val;
                 else if(group === 'despesa_financeira') dre.resultadoFinanceiro -= val;
                 else if(group.startsWith('despesa_') && !isCredit) dre.despesasOperacionais += val;
            }
        });

        // KPI Calculations
        const receitaLiquida = dre.receitaBruta - dre.deducoes;
        const resultadoBruto = receitaLiquida - dre.cmv;
        const resultadoOperacional = resultadoBruto - dre.despesasOperacionais;
        const resultadoNaoOperacionalTotal = dre.receitaNaoOperacional - dre.despesaNaoOperacional;
        const resultadoAntesImpostos = resultadoOperacional + dre.resultadoFinanceiro + resultadoNaoOperacionalTotal;
        const lucroLiquido = resultadoAntesImpostos - dre.impostos;

        const margemContribuicaoVal = receitaLiquida - dre.cmv;
        const margemContribuicaoPct = receitaLiquida > 0 ? (margemContribuicaoVal / receitaLiquida) * 100 : 0;
        const resultadoOperacionalPct = receitaLiquida > 0 ? (resultadoOperacional / receitaLiquida) * 100 : 0;
        const resultadoLiquidoPct = receitaLiquida > 0 ? (lucroLiquido / receitaLiquida) * 100 : 0;

        res.json({
            receitas,
            despesas,
            totalReceitas,
            totalDespesas,
            kpis: {
                margemContribuicaoPct,
                resultadoOperacionalPct,
                resultadoLiquidoPct
            }
        });
    });
});

app.get('/api/reports/forecasts', authenticateToken, (req, res) => {
    const { year, month } = req.query;
    const userId = req.userId;
    const y = parseInt(year);
    const m = month ? parseInt(month) : null;

    let query = `SELECT f.*, c.name as category_name 
                 FROM forecasts f
                 LEFT JOIN categories c ON f.category_id = c.id 
                 WHERE f.user_id = ? AND strftime('%Y', f.date) = ?`;
    
    const params = [userId, String(y)];

    if (m !== null) {
        query += ` AND strftime('%m', f.date) = ?`;
        params.push(String(m + 1).padStart(2, '0'));
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        let summary = {
            predictedIncome: 0,
            predictedExpense: 0,
            realizedIncome: 0,
            realizedExpense: 0,
            pendingIncome: 0,
            pendingExpense: 0
        };

        const items = rows.map(r => {
            const val = r.value;
            const isCredit = r.type === 'credito';
            const isRealized = Boolean(r.realized);

            // Total Predicted
            if (isCredit) summary.predictedIncome += val;
            else summary.predictedExpense += val;

            // Realized vs Pending
            if (isRealized) {
                if (isCredit) summary.realizedIncome += val;
                else summary.realizedExpense += val;
            } else {
                if (isCredit) summary.pendingIncome += val;
                else summary.pendingExpense += val;
            }

            return {
                ...r,
                realized: isRealized
            };
        });

        res.json({ summary, items });
    });
});

// Admin Routes (Simplificado)
app.get('/api/admin/users', authenticateToken, checkAdmin, (req, res) => {
    db.all("SELECT id, email, cnpj, razao_social, phone, created_at FROM users", [], (err, rows) => {
        if(err) return res.status(500).json({error: err.message});
        res.json(rows.map(r => ({ ...r, cnpj: decrypt(r.cnpj), razao_social: decrypt(r.razao_social), phone: decrypt(r.phone) })));
    });
});

app.delete('/api/admin/users/:id', authenticateToken, checkAdmin, (req, res) => {
    const id = req.params.id;
    db.serialize(() => {
        db.run("DELETE FROM transactions WHERE user_id = ?", [id]);
        db.run("DELETE FROM forecasts WHERE user_id = ?", [id]);
        db.run("DELETE FROM banks WHERE user_id = ?", [id]);
        db.run("DELETE FROM categories WHERE user_id = ?", [id]);
        db.run("DELETE FROM ofx_imports WHERE user_id = ?", [id]);
        db.run("DELETE FROM users WHERE id = ?", [id], (err) => {
            if(err) return res.status(500).json({error: err.message});
            res.json({success: true});
        });
    });
});

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const startServer = () => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
};

startServer();