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

// --- CONFIGURAÇÃO DE SEGURANÇA E AMBIENTE ---
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

// Credenciais de Admin (Suporte a MAIL_ADMIN e EMAIL_ADMIN)
const ADMIN_EMAIL = (process.env.MAIL_ADMIN || process.env.EMAIL_ADMIN || '').trim();
const ADMIN_PASSWORD = (process.env.PASSWORD_ADMIN || '').trim();

if (!ADMIN_EMAIL) console.warn("⚠️  Admin Email não configurado (.env)");

// Criptografia para dados sensíveis (LGPD)
let keyBuffer;
if (process.env.ENCRYPTION_KEY) {
    keyBuffer = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    if (keyBuffer.length !== 32) {
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
    } catch (e) { return null; }
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
    } catch (e) { return text; }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_LOGO_DIR = path.join(__dirname, 'logo');
if (!fs.existsSync(LOCAL_LOGO_DIR)) fs.mkdirSync(LOCAL_LOGO_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })); 
app.use(cors()); 
app.use(express.json({ limit: '10mb' }));

const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, 
	limit: 500, 
    message: { error: "Muitas requisições. Tente novamente mais tarde." }
});
app.use('/api/', apiLimiter);
app.use(express.static(path.join(__dirname, 'dist')));

// --- DATABASE SETUP ---
const BACKUP_DIR = '/backup';
let PERSISTENT_LOGO_DIR = './backup/logos';
let dbPath = './backup/finance_v2.db';

if (fs.existsSync(BACKUP_DIR)) {
    try {
        fs.accessSync(BACKUP_DIR, fs.constants.W_OK);
        PERSISTENT_LOGO_DIR = path.join(BACKUP_DIR, 'logos');
        dbPath = path.join(BACKUP_DIR, 'finance_v2.db');
    } catch (e) {}
}

if (!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
if (!fs.existsSync(PERSISTENT_LOGO_DIR)) fs.mkdirSync(PERSISTENT_LOGO_DIR, { recursive: true });

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("ERRO CRÍTICO DB:", err.message);
    else {
        console.log(`Banco conectado: ${dbPath}`);
        db.run('PRAGMA journal_mode = WAL;'); 
    }
});

// Serve Logos
app.use('/logo', (req, res, next) => {
    const persistentFile = path.join(PERSISTENT_LOGO_DIR, req.path);
    if (fs.existsSync(persistentFile)) return res.sendFile(persistentFile);
    next();
});
app.use('/logo', express.static(LOCAL_LOGO_DIR));

// Logger
function logAudit(userId, action, details, ip) {
    db.run(`INSERT INTO audit_logs (user_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)`,
        [userId, action, details, ip, new Date().toISOString()]);
}

// Middleware Auth
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
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Acesso negado." });
    next();
};

// Email Setup
const transporter = nodemailer.createTransport({
    host: process.env.MAIL_SERVER,
    port: Number(process.env.MAIL_PORT) || 587,
    secure: Number(process.env.MAIL_PORT) === 465, 
    auth: { user: process.env.MAIL_USERNAME, pass: process.env.MAIL_PASSWORD },
});

const sendEmail = async (to, subject, htmlContent) => {
  if (!process.env.MAIL_SERVER) return true;
  try {
      await transporter.sendMail({
          from: `"${process.env.MAIL_FROM_NAME || 'Virgula'}" <${process.env.MAIL_FROM_ADDRESS || process.env.MAIL_USERNAME}>`,
          to, subject, html: htmlContent
      });
      return true;
  } catch (error) { return false; }
};

// --- DATA SEEDS ---
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

// LISTA DE CATEGORIAS LIMPA (SEM DUPLICATAS)
const INITIAL_CATEGORIES_SEED = [
    { name: 'Vendas de Mercadorias', type: 'receita', group: 'receita_bruta' },
    { name: 'Prestação de Serviços', type: 'receita', group: 'receita_bruta' },
    { name: 'Comissões Recebidas', type: 'receita', group: 'receita_bruta' },
    { name: 'Receita Financeira', type: 'receita', group: 'receita_financeira' },
    { name: 'Receita de Aluguel', type: 'receita', group: 'outras_receitas' },
    { name: 'Outras Receitas Operacionais', type: 'receita', group: 'outras_receitas' },
    { name: 'Reembolsos de Clientes', type: 'receita', group: 'outras_receitas' },
    { name: 'Venda de Ativo Imobilizado', type: 'receita', group: 'receita_nao_operacional' },
    { name: 'Aportes de Sócios / Investimentos', type: 'receita', group: 'nao_operacional' },
    { name: 'Transferências Internas (Entrada)', type: 'receita', group: 'nao_operacional' },
    { name: 'Compra de Mercadorias (CMV)', type: 'despesa', group: 'cmv' },
    { name: 'Custos de Serviços Prestados', type: 'despesa', group: 'cmv' },
    { name: 'Fretes sobre Compras', type: 'despesa', group: 'cmv' },
    { name: 'Salários e Ordenados', type: 'despesa', group: 'despesa_pessoal' },
    { name: 'Pró-Labore', type: 'despesa', group: 'despesa_pessoal' },
    { name: 'Benefícios e Encargos Sociais', type: 'despesa', group: 'despesa_pessoal' },
    { name: 'Aluguel e Condomínio', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Energia, Água e Internet', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Material de Escritório e Limpeza', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Seguros', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Serviços de Contabilidade/Jurídico', type: 'despesa', group: 'despesa_administrativa' },
    { name: 'Marketing e Publicidade', type: 'despesa', group: 'despesa_operacional' },
    { name: 'Combustível e Deslocamento', type: 'despesa', group: 'despesa_operacional' },
    { name: 'Manutenção e Reparos', type: 'despesa', group: 'despesa_operacional' },
    { name: 'Softwares e Licenças', type: 'despesa', group: 'despesa_operacional' },
    { name: 'Impostos e Taxas (DAS, ISS, ICMS)', type: 'despesa', group: 'impostos' },
    { name: 'Tarifas Bancárias', type: 'despesa', group: 'despesa_financeira' },
    { name: 'Juros e Multas Pagos', type: 'despesa', group: 'despesa_financeira' },
    { name: 'Distribuição de Lucros', type: 'despesa', group: 'nao_operacional' },
    { name: 'Transferências Internas (Saída)', type: 'despesa', group: 'nao_operacional' }
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
  
  // Seed Bancos Globais - CRÍTICO PARA FUNCIONAR O CADASTRO
  db.get("SELECT COUNT(*) as count FROM global_banks", [], (err, row) => {
      if (!err && row && row.count === 0) {
          const stmt = db.prepare("INSERT INTO global_banks (name, logo) VALUES (?, ?)");
          INITIAL_BANKS_SEED.forEach(b => stmt.run(b.name, b.logo));
          stmt.finalize();
      }
  });
});

// --- ROTAS PÚBLICAS ---
app.get('/api/global-banks', (req, res) => {
    db.all('SELECT * FROM global_banks ORDER BY name', [], (err, rows) => res.json(rows || []));
});

// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const inputEmail = (email || '').trim();
    const inputPass = (password || '').trim();

    // 1. Login ADMIN via ENV (Checa ambas as vars)
    if (ADMIN_EMAIL && ADMIN_PASSWORD && inputEmail === ADMIN_EMAIL && inputPass === ADMIN_PASSWORD) {
        const token = jwt.sign({ id: 0, email: inputEmail, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
        logAudit('0', 'LOGIN_ADMIN', 'Acesso Admin', req.ip);
        return res.json({ 
            token, 
            user: { id: 0, email: inputEmail, razaoSocial: 'Administrador', role: 'admin' } 
        });
    }

    // 2. Login Usuário
    db.get('SELECT * FROM users WHERE email = ?', [inputEmail], (err, user) => {
        if (err || !user) return res.status(401).json({ error: "Credenciais inválidas" });
        if (!bcrypt.compareSync(inputPass, user.password)) return res.status(401).json({ error: "Credenciais inválidas" });

        const token = jwt.sign({ id: user.id, email: user.email, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '24h' });
        logAudit(user.id, 'LOGIN', 'Sucesso', req.ip);
        res.json({ 
            token, 
            user: { id: user.id, email: user.email, razaoSocial: decrypt(user.razao_social), cnpj: decrypt(user.cnpj), role: user.role } 
        });
    });
});

app.post('/api/request-signup', (req, res) => {
    const { email, cnpj, razaoSocial, phone } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    
    db.get("SELECT id FROM users WHERE email = ?", [email], (err, row) => {
        if(row) return res.status(400).json({ error: "Email já cadastrado." });
        
        const safeCnpj = encrypt(cnpj);
        const safeRazao = encrypt(razaoSocial);
        const safePhone = encrypt(phone);

        db.run(`INSERT OR REPLACE INTO pending_signups (email, token, cnpj, razao_social, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [email, token, safeCnpj, safeRazao, safePhone, Date.now()],
            async function(err) {
                if (err) return res.status(500).json({ error: err.message });
                
                const link = `${req.protocol}://${req.get('host')}/?action=finalize&token=${token}`;
                const html = `
                <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8fafc; padding: 20px; border-radius: 8px;">
                    <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; border: 1px solid #e2e8f0; text-align: center;">
                        <h1 style="color: #10b981; margin: 0 0 20px 0;">Definir Senha de Acesso</h1>
                        <p style="color: #334155; font-size: 16px; margin-bottom: 30px;">
                            Olá, <strong>${razaoSocial}</strong>. Seus dados foram recebidos.
                            <br>Clique no botão abaixo para definir sua senha e ativar sua conta.
                        </p>
                        <a href="${link}" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
                            Definir Minha Senha
                        </a>
                        <p style="color: #94a3b8; font-size: 12px; margin-top: 30px;">
                            Link válido por 24 horas.
                        </p>
                    </div>
                </div>
                `;
                
                await sendEmail(email, "Ative sua conta - Virgula Contábil", html);
                res.json({ message: "Link enviado" });
            }
        );
    });
});

app.get('/api/validate-signup-token/:token', (req, res) => {
    db.get("SELECT * FROM pending_signups WHERE token = ?", [req.params.token], (err, row) => {
        if (!row) return res.status(404).json({ error: "Inválido" });
        res.json({ email: row.email, razaoSocial: decrypt(row.razao_social) });
    });
});

// ROTA CRÍTICA: CADASTRO COMPLETO (SEM SEED DE BANCOS)
app.post('/api/complete-signup', (req, res) => {
    const { token, password } = req.body;
    db.get("SELECT * FROM pending_signups WHERE token = ?", [token], (err, pending) => {
        if (!pending) return res.status(400).json({ error: "Inválido" });

        const hash = bcrypt.hashSync(password, 10);
        db.run(`INSERT INTO users (email, password, cnpj, razao_social, phone) VALUES (?, ?, ?, ?, ?)`,
            [pending.email, hash, pending.cnpj, pending.razao_social, pending.phone],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                const userId = this.lastID;
                
                // 1. Seed Categories (Lista Limpa)
                const stmtCat = db.prepare("INSERT INTO categories (user_id, name, type, group_type) VALUES (?, ?, ?, ?)");
                INITIAL_CATEGORIES_SEED.forEach(c => stmtCat.run(userId, c.name, c.type, c.group));
                stmtCat.finalize();

                // 2. Bancos: NÃO INSERE NADA AUTOMATICAMENTE. O USUÁRIO CADASTRA DEPOIS.

                db.run("DELETE FROM pending_signups WHERE email = ?", [pending.email]);
                logAudit(userId, 'SIGNUP', 'Completo', req.ip);
                res.json({ success: true });
            }
        );
    });
});

app.post('/api/recover-password', (req, res) => {
    const { email } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    db.run("UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE email = ?", [token, Date.now()+3600000, email], function(err) {
        if(this.changes > 0) {
            const link = `${req.protocol}://${req.get('host')}/?action=reset&token=${token}`;
            const html = `
            <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8fafc; padding: 20px; border-radius: 8px;">
            <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; border: 1px solid #e2e8f0; text-align: center;">
                <h1 style="color: #10b981; margin: 0 0 20px 0;">Recuperação de Senha</h1>
                <p style="color: #334155; font-size: 16px; margin-bottom: 30px;">
                    Recebemos uma solicitação para redefinir a senha.
                </p>
                <a href="${link}" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
                    Redefinir Minha Senha
                </a>
            </div>
            </div>
            `;
            sendEmail(email, "Recuperação de Senha - Virgula Contábil", html);
        }
        res.json({ message: "Enviado se existir." });
    });
});

app.post('/api/reset-password-confirm', (req, res) => {
    const { token, newPassword } = req.body;
    db.get("SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?", [token, Date.now()], (err, user) => {
        if(!user) return res.status(400).json({ error: "Inválido" });
        db.run("UPDATE users SET password = ?, reset_token = NULL WHERE id = ?", [bcrypt.hashSync(newPassword, 10), user.id], () => res.json({ success: true }));
    });
});

// --- ROTAS GERAIS (PROTEGIDAS) ---

// Bancos (CRUD de Usuário)
app.get('/api/banks', authenticateToken, (req, res) => {
    db.all('SELECT * FROM banks WHERE user_id = ? ORDER BY active DESC, name', [req.userId], (err, rows) => res.json(rows));
});
app.post('/api/banks', authenticateToken, (req, res) => {
    const { name, accountNumber, nickname, logo } = req.body;
    db.run(`INSERT INTO banks (user_id, name, account_number, nickname, logo) VALUES (?, ?, ?, ?, ?)`, 
        [req.userId, name, accountNumber, nickname, logo], function(err) {
        if(err) return res.status(500).json({error: err.message});
        res.json({id: this.lastID});
    });
});
app.put('/api/banks/:id', authenticateToken, (req, res) => {
    const { nickname, active } = req.body;
    db.run(`UPDATE banks SET nickname = COALESCE(?, nickname), active = COALESCE(?, active) WHERE id = ? AND user_id = ?`,
        [nickname, active, req.params.id, req.userId], (err) => res.json({success: !err}));
});
app.delete('/api/banks/:id', authenticateToken, (req, res) => {
    db.serialize(() => {
        db.run("DELETE FROM transactions WHERE bank_id = ? AND user_id = ?", [req.params.id, req.userId]);
        db.run("DELETE FROM forecasts WHERE bank_id = ? AND user_id = ?", [req.params.id, req.userId]);
        db.run("DELETE FROM banks WHERE id = ? AND user_id = ?", [req.params.id, req.userId], (err) => res.json({success: !err}));
    });
});

// Categorias
app.get('/api/categories', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM categories WHERE user_id = ? ORDER BY name`, [req.userId], (err, rows) => {
        if(rows && rows.length === 0) {
            // Auto-repair seed if empty
            const stmt = db.prepare("INSERT INTO categories (user_id, name, type, group_type) VALUES (?, ?, ?, ?)");
            INITIAL_CATEGORIES_SEED.forEach(c => stmt.run(req.userId, c.name, c.type, c.group));
            stmt.finalize(() => {
                db.all(`SELECT * FROM categories WHERE user_id = ?`, [req.userId], (err, newRows) => res.json(newRows));
            });
        } else {
            res.json(rows);
        }
    });
});
app.post('/api/categories', authenticateToken, (req, res) => {
    const { name, type, groupType } = req.body;
    db.run(`INSERT INTO categories (user_id, name, type, group_type) VALUES (?, ?, ?, ?)`, [req.userId, name, type, groupType], function(err) {
        res.json({ id: this.lastID });
    });
});
app.put('/api/categories/:id', authenticateToken, (req, res) => {
    const { name, type, groupType } = req.body;
    db.run(`UPDATE categories SET name = ?, type = ?, group_type = ? WHERE id = ? AND user_id = ?`, [name, type, groupType, req.params.id, req.userId], (err) => res.json({success: !err}));
});
app.delete('/api/categories/:id', authenticateToken, (req, res) => {
    db.run(`DELETE FROM categories WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err) => res.json({success: !err}));
});

// Transações
app.get('/api/transactions', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 5000`, [req.userId], (err, rows) => {
        res.json(rows.map(r => ({...r, reconciled: !!r.reconciled, categoryId: r.category_id, bankId: r.bank_id})));
    });
});
app.post('/api/transactions', authenticateToken, (req, res) => {
    const { date, description, value, type, categoryId, bankId, reconciled, ofxImportId } = req.body;
    db.run(`INSERT INTO transactions (user_id, date, description, value, type, category_id, bank_id, reconciled, ofx_import_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.userId, date, description, value, type, categoryId, bankId, reconciled?1:0, ofxImportId], function(err) {
            if(err) return res.status(500).json({error: err.message});
            const modifier = type === 'credito' ? 1 : -1;
            db.run(`UPDATE banks SET balance = balance + ? WHERE id = ?`, [value * modifier, bankId]);
            res.json({ id: this.lastID });
        });
});
app.put('/api/transactions/:id', authenticateToken, (req, res) => {
    const { date, description, value, type, categoryId, bankId, reconciled } = req.body;
    db.get(`SELECT * FROM transactions WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err, oldTx) => {
        if(!oldTx) return res.status(404).json({error: "Não encontrado"});
        db.run(`UPDATE transactions SET date=?, description=?, value=?, type=?, category_id=?, bank_id=?, reconciled=? WHERE id=? AND user_id=?`,
            [date, description, value, type, categoryId, bankId, reconciled?1:0, req.params.id, req.userId], (err) => {
                recalculateBankBalance(bankId);
                if(oldTx.bank_id !== bankId) recalculateBankBalance(oldTx.bank_id);
                res.json({success: true});
            });
    });
});
app.delete('/api/transactions/:id', authenticateToken, (req, res) => {
    db.get(`SELECT bank_id FROM transactions WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err, row) => {
        if(!row) return res.json({success:false});
        db.run(`DELETE FROM transactions WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err) => {
            recalculateBankBalance(row.bank_id);
            res.json({success: true});
        });
    });
});
app.patch('/api/transactions/:id/reconcile', authenticateToken, (req, res) => {
    const { reconciled } = req.body;
    db.run(`UPDATE transactions SET reconciled = ? WHERE id = ? AND user_id = ?`, [reconciled?1:0, req.params.id, req.userId], (err) => res.json({success: !err}));
});
app.patch('/api/transactions/batch-update', authenticateToken, (req, res) => {
    const { transactionIds, categoryId } = req.body;
    db.run(`UPDATE transactions SET category_id = ?, reconciled = 1 WHERE id IN (${transactionIds.join(',')}) AND user_id = ?`, [categoryId, req.userId], (err) => res.json({success: !err}));
});

function recalculateBankBalance(bankId) {
    db.get(`SELECT SUM(CASE WHEN type = 'credito' THEN value ELSE -value END) as balance FROM transactions WHERE bank_id = ?`, [bankId], (err, row) => {
        db.run(`UPDATE banks SET balance = ? WHERE id = ?`, [row?.balance || 0, bankId]);
    });
}

// Previsões
app.get('/api/forecasts', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM forecasts WHERE user_id = ? ORDER BY date`, [req.userId], (err, rows) => {
        res.json(rows.map(r => ({...r, realized: !!r.realized, categoryId: r.category_id, bankId: r.bank_id, installmentCurrent: r.installment_current, installmentTotal: r.installment_total, groupId: r.group_id})));
    });
});
app.post('/api/forecasts', authenticateToken, (req, res) => {
    const { date, description, value, type, categoryId, bankId, realized, installmentCurrent, installmentTotal, groupId } = req.body;
    db.run(`INSERT INTO forecasts (user_id, date, description, value, type, category_id, bank_id, realized, installment_current, installment_total, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.userId, date, description, value, type, categoryId, bankId, realized?1:0, installmentCurrent, installmentTotal, groupId], function(err) {
            res.json({ id: this.lastID });
        });
});
app.put('/api/forecasts/:id', authenticateToken, (req, res) => {
    const { date, description, value, type, categoryId, bankId } = req.body;
    db.run(`UPDATE forecasts SET date=?, description=?, value=?, type=?, category_id=?, bank_id=? WHERE id=? AND user_id=?`, [date, description, value, type, categoryId, bankId, req.params.id, req.userId], (err) => res.json({success: !err}));
});
app.patch('/api/forecasts/:id/realize', authenticateToken, (req, res) => {
    db.run(`UPDATE forecasts SET realized = 1 WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err) => res.json({success: !err}));
});
app.delete('/api/forecasts/:id', authenticateToken, (req, res) => {
    const mode = req.query.mode || 'single';
    if (mode === 'single') {
        db.run(`DELETE FROM forecasts WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err) => res.json({success: !err}));
    } else {
        db.get(`SELECT group_id, date FROM forecasts WHERE id = ?`, [req.params.id], (err, current) => {
            if(!current || !current.group_id) return db.run(`DELETE FROM forecasts WHERE id = ?`, [req.params.id], () => res.json({success:true}));
            let sql = `DELETE FROM forecasts WHERE group_id = ? AND user_id = ?`;
            const params = [current.group_id, req.userId];
            if (mode === 'future') { sql += ` AND date >= ?`; params.push(current.date); }
            db.run(sql, params, (err) => res.json({success: !err}));
        });
    }
});

// OFX e Regras
app.get('/api/ofx-imports', authenticateToken, (req, res) => {
    db.all(`SELECT id, file_name, import_date, bank_id, transaction_count FROM ofx_imports WHERE user_id = ? ORDER BY import_date DESC`, [req.userId], (err, rows) => {
        res.json(rows.map(r => ({...r, fileName: r.file_name, importDate: r.import_date, bankId: r.bank_id, transactionCount: r.transaction_count})));
    });
});
app.post('/api/ofx-imports', authenticateToken, (req, res) => {
    const { fileName, importDate, bankId, transactionCount, content } = req.body;
    db.run(`INSERT INTO ofx_imports (user_id, file_name, import_date, bank_id, transaction_count, content) VALUES (?, ?, ?, ?, ?, ?)`,
        [req.userId, fileName, importDate, bankId, transactionCount, content], function(err) { res.json({id: this.lastID}); });
});
app.delete('/api/ofx-imports/:id', authenticateToken, (req, res) => {
    db.serialize(() => {
        db.run(`DELETE FROM transactions WHERE ofx_import_id = ? AND user_id = ?`, [req.params.id, req.userId]);
        db.run(`DELETE FROM ofx_imports WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err) => res.json({success: !err}));
    });
});
app.get('/api/keyword-rules', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM keyword_rules WHERE user_id = ?`, [req.userId], (err, rows) => res.json(rows.map(r => ({...r, categoryId: r.category_id, bankId: r.bank_id}))));
});
app.post('/api/keyword-rules', authenticateToken, (req, res) => {
    const { keyword, type, categoryId, bankId } = req.body;
    db.run(`INSERT INTO keyword_rules (user_id, keyword, type, category_id, bank_id) VALUES (?, ?, ?, ?, ?)`, [req.userId, keyword, type, categoryId, bankId], function(err) { res.json({id: this.lastID}); });
});
app.delete('/api/keyword-rules/:id', authenticateToken, (req, res) => {
    db.run(`DELETE FROM keyword_rules WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], (err) => res.json({success: !err}));
});

// --- RELATÓRIOS (RESTAURADOS) ---

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
            db.get(`SELECT SUM(CASE WHEN type = 'credito' THEN value ELSE -value END) as balance FROM transactions WHERE user_id = ? AND date < ?`,
                [userId, startDate], (err, row) => err ? reject(err) : resolve(row?.balance || 0));
        });

        const startBalance = await balancePromise;

        db.all(`SELECT t.*, c.name as category_name FROM transactions t LEFT JOIN categories c ON t.category_id = c.id WHERE t.user_id = ? AND t.date >= ? AND t.date < ?`,
            [userId, startDate, endDate], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });

                const totalReceitas = rows.filter(r => r.type === 'credito').reduce((sum, r) => sum + r.value, 0);
                const totalDespesas = rows.filter(r => r.type === 'debito').reduce((sum, r) => sum + r.value, 0);
                
                const receitasCat = {};
                const despesasCat = {};

                rows.forEach(r => {
                    const catName = r.category_name || 'Sem Categoria';
                    if (r.type === 'credito') receitasCat[catName] = (receitasCat[catName] || 0) + r.value;
                    else despesasCat[catName] = (despesasCat[catName] || 0) + r.value;
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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reports/daily-flow', authenticateToken, (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'Datas necessárias' });

    db.all(`SELECT date, type, SUM(value) as total FROM transactions WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date, type ORDER BY date ASC`,
        [req.userId, startDate, endDate], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
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

    let query = `SELECT t.*, c.name as category_name, c.group_type FROM transactions t LEFT JOIN categories c ON t.category_id = c.id WHERE t.user_id = ? AND strftime('%Y', t.date) = ?`;
    const params = [userId, String(y)];
    if (m !== null) { query += ` AND strftime('%m', t.date) = ?`; params.push(String(m + 1).padStart(2, '0')); }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        let dre = { receitaBruta: 0, deducoes: 0, cmv: 0, despesasOperacionais: 0, resultadoFinanceiro: 0, receitaNaoOperacional: 0, despesaNaoOperacional: 0, impostos: 0 };

        rows.forEach(t => {
            const group = t.group_type || '';
            const val = t.value;
            const isCredit = t.type === 'credito';

            // Agrupamento baseado no DRE
            if (group === 'receita_bruta') dre.receitaBruta += val;
            else if (group === 'impostos') { if(!isCredit) dre.deducoes += val; } // Simplificação: impostos redutores
            else if (group === 'cmv') dre.cmv += val;
            else if (group === 'receita_financeira') dre.resultadoFinanceiro += val;
            else if (group === 'despesa_financeira') dre.resultadoFinanceiro -= val;
            else if (group === 'receita_nao_operacional') dre.receitaNaoOperacional += val;
            else if (group === 'despesa_nao_operacional') dre.despesaNaoOperacional += val;
            else if (group === 'outras_receitas') dre.receitaBruta += val; // Agrupa com bruta operacional
            else if (['despesa_operacional', 'despesa_pessoal', 'despesa_administrativa'].includes(group)) dre.despesasOperacionais += val;
            else if (group === 'nao_operacional') { /* Ignorar transferências */ }
            else { 
                // Fallback por texto se não tiver grupo
                const cat = (t.category_name || '').toLowerCase();
                if (!isCredit) dre.despesasOperacionais += val; 
                else if(cat.includes('venda') || cat.includes('serviço')) dre.receitaBruta += val;
            }
        });

        const receitaLiquida = dre.receitaBruta - dre.deducoes;
        const resultadoBruto = receitaLiquida - dre.cmv;
        const resultadoOperacional = resultadoBruto - dre.despesasOperacionais;
        const resultadoNaoOperacionalTotal = dre.receitaNaoOperacional - dre.despesaNaoOperacional;
        const resultadoAntesImpostos = resultadoOperacional + dre.resultadoFinanceiro + resultadoNaoOperacionalTotal;
        const lucroLiquido = resultadoAntesImpostos - dre.impostos;

        res.json({
            receitaBruta: dre.receitaBruta, deducoes: dre.deducoes, receitaLiquida, cmv: dre.cmv, resultadoBruto,
            despesasOperacionais: dre.despesasOperacionais, resultadoOperacional, resultadoFinanceiro: dre.resultadoFinanceiro,
            resultadoNaoOperacional: resultadoNaoOperacionalTotal, impostos: dre.impostos, lucroLiquido, resultadoAntesImpostos
        });
    });
});

app.get('/api/reports/analysis', authenticateToken, (req, res) => {
    // Reusing logic similar to DRE but for KPI calculation
    const { year, month } = req.query;
    const userId = req.userId;
    const y = parseInt(year);
    const m = month ? parseInt(month) : null;

    let query = `SELECT t.*, c.name as category_name, c.group_type FROM transactions t LEFT JOIN categories c ON t.category_id = c.id WHERE t.user_id = ? AND strftime('%Y', t.date) = ?`;
    const params = [userId, String(y)];
    if (m !== null) { query += ` AND strftime('%m', t.date) = ?`; params.push(String(m + 1).padStart(2, '0')); }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const receitas = {};
        const despesas = {};
        let totalReceitas = 0;
        let totalDespesas = 0;
        let dre = { receitaBruta: 0, cmv: 0, despesasOperacionais: 0, impostos: 0 };

        rows.forEach(r => {
            if (r.type === 'credito') {
                receitas[r.category_name || 'Outros'] = (receitas[r.category_name || 'Outros'] || 0) + r.value;
                totalReceitas += r.value;
                if(r.group_type === 'receita_bruta') dre.receitaBruta += r.value;
            } else {
                despesas[r.category_name || 'Outros'] = (despesas[r.category_name || 'Outros'] || 0) + r.value;
                totalDespesas += r.value;
                if(r.group_type === 'cmv') dre.cmv += r.value;
                if(['despesa_operacional', 'despesa_pessoal'].includes(r.group_type)) dre.despesasOperacionais += r.value;
            }
        });

        // KPIs Básicos
        const receitaLiquida = dre.receitaBruta; // Simplificado
        const margemContribuicaoVal = receitaLiquida - dre.cmv;
        const margemContribuicaoPct = receitaLiquida > 0 ? (margemContribuicaoVal / receitaLiquida) * 100 : 0;
        const resultadoOperacional = margemContribuicaoVal - dre.despesasOperacionais;
        const resultadoOperacionalPct = receitaLiquida > 0 ? (resultadoOperacional / receitaLiquida) * 100 : 0;
        const resultadoLiquidoPct = totalReceitas > 0 ? ((totalReceitas - totalDespesas) / totalReceitas) * 100 : 0;

        res.json({
            receitas, despesas, totalReceitas, totalDespesas,
            kpis: { margemContribuicaoPct, resultadoOperacionalPct, resultadoLiquidoPct }
        });
    });
});

app.get('/api/reports/forecasts', authenticateToken, (req, res) => {
    const { year, month } = req.query;
    const userId = req.userId;
    const y = parseInt(year);
    const m = month ? parseInt(month) : null;

    let query = `SELECT f.*, c.name as category_name FROM forecasts f LEFT JOIN categories c ON f.category_id = c.id WHERE f.user_id = ? AND strftime('%Y', f.date) = ?`;
    const params = [userId, String(y)];
    if (m !== null) { query += ` AND strftime('%m', f.date) = ?`; params.push(String(m + 1).padStart(2, '0')); }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        let summary = { predictedIncome: 0, predictedExpense: 0, realizedIncome: 0, realizedExpense: 0, pendingIncome: 0, pendingExpense: 0 };
        const items = rows.map(r => {
            const val = r.value;
            const isCredit = r.type === 'credito';
            if (isCredit) summary.predictedIncome += val; else summary.predictedExpense += val;
            if (r.realized) {
                if (isCredit) summary.realizedIncome += val; else summary.realizedExpense += val;
            } else {
                if (isCredit) summary.pendingIncome += val; else summary.pendingExpense += val;
            }
            return { ...r, realized: !!r.realized };
        });
        res.json({ summary, items });
    });
});

// Admin Routes
app.get('/api/admin/users', authenticateToken, checkAdmin, (req, res) => {
    db.all("SELECT id, email, cnpj, razao_social, phone, created_at FROM users", [], (err, rows) => {
        res.json(rows.map(r => ({ ...r, cnpj: decrypt(r.cnpj), razao_social: decrypt(r.razao_social), phone: decrypt(r.phone) })));
    });
});
app.get('/api/admin/global-data', authenticateToken, checkAdmin, (req, res) => {
    db.get('SELECT COUNT(*) as count FROM users', (err, u) => {
        db.get('SELECT COUNT(*) as count, SUM(value) as totalValue FROM transactions', (err, t) => {
            res.json({ users: u, transactions: t });
        });
    });
});
app.get('/api/admin/audit-transactions', authenticateToken, checkAdmin, (req, res) => {
    const sql = `SELECT t.id, t.date, t.description, t.value, t.type, u.razao_social FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.date DESC LIMIT 500`;
    db.all(sql, [], (err, rows) => res.json(rows));
});
app.get('/api/admin/banks', authenticateToken, checkAdmin, (req, res) => {
    db.all('SELECT * FROM global_banks ORDER BY id DESC', [], (err, rows) => res.json(rows));
});
app.post('/api/admin/banks', authenticateToken, checkAdmin, (req, res) => {
    const { name, logoData } = req.body;
    let logoPath = '/logo/caixaf.png';
    if (logoData && logoData.startsWith('data:image')) {
        try {
            const matches = logoData.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const buffer = Buffer.from(matches[2], 'base64');
                const fileName = `bank_${Date.now()}.${matches[1].includes('+') ? matches[1].split('+')[0] : matches[1].replace('jpeg','jpg')}`;
                fs.writeFileSync(path.join(PERSISTENT_LOGO_DIR, fileName), buffer);
                logoPath = `/logo/${fileName}`;
            }
        } catch (e) {}
    } else if (logoData && logoData.startsWith('/logo/')) logoPath = logoData;
    db.run('INSERT INTO global_banks (name, logo) VALUES (?, ?)', [name, logoPath], function(err) { res.json({ id: this.lastID, name, logo: logoPath }); });
});
app.put('/api/admin/banks/:id', authenticateToken, checkAdmin, (req, res) => {
    const { name, logoData } = req.body;
    db.get('SELECT * FROM global_banks WHERE id = ?', [req.params.id], (err, row) => {
        if(!row) return res.status(404).json({error: "Not found"});
        let logoPath = row.logo;
        if (logoData && logoData.startsWith('data:image')) {
            try {
                const matches = logoData.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
                const buffer = Buffer.from(matches[2], 'base64');
                const fileName = `bank_${Date.now()}.${matches[1].includes('+') ? matches[1].split('+')[0] : matches[1].replace('jpeg','jpg')}`;
                fs.writeFileSync(path.join(PERSISTENT_LOGO_DIR, fileName), buffer);
                logoPath = `/logo/${fileName}`;
            } catch (e) {}
        }
        db.run('UPDATE global_banks SET name = ?, logo = ? WHERE id = ?', [name, logoPath, req.params.id], function(err) {
            // Propagate updates to all user banks with same name
            db.run('UPDATE banks SET name = ?, logo = ? WHERE name = ?', [name, logoPath, row.name]);
            res.json({ success: true });
        });
    });
});
app.delete('/api/admin/banks/:id', authenticateToken, checkAdmin, (req, res) => {
    db.run('DELETE FROM global_banks WHERE id = ?', [req.params.id], (err) => res.json({success: !err}));
});
app.get('/api/admin/users/:id/full-data', authenticateToken, checkAdmin, (req, res) => {
    const userId = req.params.id;
    const p1 = new Promise((resolve) => db.all(`SELECT t.*, c.name as category_name, b.name as bank_name FROM transactions t LEFT JOIN categories c ON t.category_id = c.id LEFT JOIN banks b ON t.bank_id = b.id WHERE t.user_id = ? ORDER BY t.date DESC`, [userId], (err, r) => resolve(r)));
    const p2 = new Promise((resolve) => db.all(`SELECT f.*, c.name as category_name FROM forecasts f LEFT JOIN categories c ON f.category_id = c.id WHERE f.user_id = ?`, [userId], (err, r) => resolve(r)));
    const p3 = new Promise((resolve) => db.all(`SELECT * FROM ofx_imports WHERE user_id = ?`, [userId], (err, r) => resolve(r)));
    Promise.all([p1, p2, p3]).then(([transactions, forecasts, ofxImports]) => res.json({ transactions, forecasts, ofxImports }));
});
app.delete('/api/admin/users/:id', authenticateToken, checkAdmin, (req, res) => {
    const id = req.params.id;
    db.serialize(() => {
        ['transactions', 'forecasts', 'banks', 'categories', 'ofx_imports', 'keyword_rules'].forEach(t => db.run(`DELETE FROM ${t} WHERE user_id = ?`, [id]));
        db.run("DELETE FROM users WHERE id = ?", [id], (err) => res.json({success: true}));
    });
});

// START
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (ADMIN_EMAIL) console.log(`Admin ativo para: ${ADMIN_EMAIL}`);
});