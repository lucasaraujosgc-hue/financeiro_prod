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
// Chave de 32 bytes para AES-256. 
// AVISO: Em produção, defina ENCRYPTION_KEY no .env para não perder dados ao reiniciar.
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY 
    ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex') 
    : crypto.randomBytes(32); 
const IV_LENGTH = 16; 

// --- FUNÇÕES DE CRIPTOGRAFIA (AES-256-CBC) ---
// Usado para: CNPJ, Telefone, Conta Bancária, Conteúdo OFX
function encrypt(text) {
    if (!text) return text;
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let encrypted = cipher.update(String(text));
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (e) {
        console.error("Erro de criptografia:", e);
        return null;
    }
}

function decrypt(text) {
    if (!text || !text.includes(':')) return text; 
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        return text; // Retorna original se falhar (fallback)
    }
}

// --- CONFIGURAÇÃO DE DIRETÓRIOS ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Garante que a pasta logo local exista
const LOCAL_LOGO_DIR = path.join(__dirname, 'logo');
if (!fs.existsSync(LOCAL_LOGO_DIR)){
    fs.mkdirSync(LOCAL_LOGO_DIR, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração para Proxy (Render, Heroku, AWS, Nginx)
app.set('trust proxy', 1);

// --- MIDDLEWARES DE SEGURANÇA ---
app.use(helmet({
    contentSecurityPolicy: false, 
    crossOriginEmbedderPolicy: false
})); 
app.use(cors()); 
app.use(express.json({ limit: '10mb' }));

// Middleware para forçar HTTPS em Produção (se estiver atrás de um proxy/Load Balancer)
// Se tiver certificados locais, o startServer no final cuidará disso.
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && !process.env.SSL_KEY_PATH) {
        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        if (!isSecure) {
            return res.redirect(`https://${req.headers.host}${req.url}`);
        }
    }
    next();
});

// Rate Limiting (Proteção contra Brute Force/DDoS simples)
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutos
	limit: 300, 
	standardHeaders: 'draft-7',
	legacyHeaders: false,
    message: { error: "Muitas requisições. Tente novamente mais tarde." }
});
app.use('/api/', apiLimiter);

// Servir arquivos do frontend (build)
app.use(express.static(path.join(__dirname, 'dist')));

// --- DATABASE & STORAGE SETUP (ROBUSTO - Mantido do Original) ---
const BACKUP_DIR = '/backup';
let PERSISTENT_LOGO_DIR = path.join(__dirname, 'backup_logos_fallback'); 

// 1. Tenta configurar diretório de backup
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

// 2. Configura diretório de logos persistente
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

console.log(`Logos persistentes em: ${PERSISTENT_LOGO_DIR}`);

// 3. Define caminho do banco
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
        db.run('PRAGMA journal_mode = WAL;'); // Melhor performance e concorrência
    }
});

// --- ROTA DE IMAGENS ---
app.use('/logo', (req, res, next) => {
    const urlPath = req.path;
    const persistentFile = path.join(PERSISTENT_LOGO_DIR, urlPath);
    if (fs.existsSync(persistentFile)) {
        return res.sendFile(persistentFile);
    }
    next();
});
app.use('/logo', express.static(LOCAL_LOGO_DIR));

// --- AUDITORIA (NOVO) ---
function logAudit(userId, action, details, ip) {
    const timestamp = new Date().toISOString();
    db.run(
        `INSERT INTO audit_logs (user_id, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)`,
        [userId, action, details, ip, timestamp],
        (err) => { if(err) console.error("Erro Audit Log:", err); }
    );
}

// --- MIDDLEWARES DE AUTENTICAÇÃO (JWT) ---
// Substitui o checkAuth original para usar Tokens Seguros
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "Token não fornecido." });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: "Sessão expirada." });
        req.user = decoded; 
        req.userId = decoded.id; // Mantém compatibilidade com o código original que usa req.userId
        next();
    });
};

const checkAdmin = (req, res, next) => {
    // Requer authenticateToken antes
    if (req.user.role !== 'admin') {
        logAudit(req.userId, 'UNAUTHORIZED_ADMIN_ACCESS', 'Tentativa de acesso admin', req.ip);
        return res.status(403).json({ error: "Acesso negado: Apenas administradores." });
    }
    next();
};

// --- EMAIL ---
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
      console.log(`[EMAIL] Sucesso! ID: ${info.messageId}`);
      return true;
  } catch (error) {
      console.error("[EMAIL] Erro FATAL ao enviar:", error);
      return false;
  }
};

// --- DATA SEEDING & MIGRATIONS --- 
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

const INITIAL_CATEGORIES_SEED = [
    { name: 'Vendas de Mercadorias', type: 'receita' },
    { name: 'Prestação de Serviços', type: 'receita' },
    { name: 'Receita de Aluguel', type: 'receita' },
    { name: 'Comissões Recebidas', type: 'receita' },
    { name: 'Receita Financeira', type: 'receita' },
    { name: 'Outras Receitas', type: 'receita' },
    { name: 'Compra de Mercadorias', type: 'despesa' },
    { name: 'Despesas com Pessoal', type: 'despesa' },
    { name: 'Despesas Administrativas', type: 'despesa' },
    { name: 'Impostos e Taxas', type: 'despesa' },
    { name: 'Despesas Financeiras', type: 'despesa' },
    { name: 'Pró-Labore', type: 'despesa' }
];

const ensureColumn = (table, column, definition) => {
    db.all(`PRAGMA table_info(${table})`, (err, rows) => {
        if (!err && rows && !rows.some(r => r.name === column)) {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
    });
};

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS global_banks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, logo TEXT)`, (err) => {
      if (!err) {
          db.get("SELECT COUNT(*) as count FROM global_banks", [], (err, row) => {
              if (!err && row && row.count === 0) {
                  const stmt = db.prepare("INSERT INTO global_banks (name, logo) VALUES (?, ?)");
                  INITIAL_BANKS_SEED.forEach(b => stmt.run(b.name, b.logo));
                  stmt.finalize();
              }
          });
      }
  });

  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT, cnpj TEXT, razao_social TEXT, phone TEXT, reset_token TEXT, reset_token_expires INTEGER)`, (err) => {
      if(!err) {
          ensureColumn('users', 'reset_token', 'TEXT');
          ensureColumn('users', 'reset_token_expires', 'INTEGER');
      }
  });

  db.run(`CREATE TABLE IF NOT EXISTS pending_signups (email TEXT PRIMARY KEY, token TEXT, cnpj TEXT, razao_social TEXT, phone TEXT, created_at INTEGER)`);

  db.run(`CREATE TABLE IF NOT EXISTS banks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, account_number TEXT, nickname TEXT, logo TEXT, active INTEGER DEFAULT 1, balance REAL DEFAULT 0, FOREIGN KEY(user_id) REFERENCES users(id))`, (err) => {
      if (!err) {
          ensureColumn('banks', 'active', 'INTEGER DEFAULT 1');
          ensureColumn('banks', 'balance', 'REAL DEFAULT 0');
      }
  });

  db.run(`CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, type TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`);

  db.run(`CREATE TABLE IF NOT EXISTS ofx_imports (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, file_name TEXT, import_date TEXT, bank_id INTEGER, transaction_count INTEGER, content TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`, (err) => {
      if(!err) ensureColumn('ofx_imports', 'content', 'TEXT');
  });

  db.run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, date TEXT, description TEXT, value REAL, type TEXT, category_id INTEGER, bank_id INTEGER, reconciled INTEGER, ofx_import_id INTEGER, FOREIGN KEY(user_id) REFERENCES users(id))`);

  db.run(`CREATE TABLE IF NOT EXISTS forecasts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, date TEXT, description TEXT, value REAL, type TEXT, category_id INTEGER, bank_id INTEGER, realized INTEGER, installment_current INTEGER, installment_total INTEGER, group_id TEXT, FOREIGN KEY(user_id) REFERENCES users(id))`);

  db.run(`CREATE TABLE IF NOT EXISTS keyword_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, keyword TEXT, type TEXT, category_id INTEGER, bank_id INTEGER, FOREIGN KEY(user_id) REFERENCES users(id))`, (err) => {
      if (!err) ensureColumn('keyword_rules', 'bank_id', 'INTEGER');
  });

  // Tabela de Auditoria (NOVO)
  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT, details TEXT, ip_address TEXT, created_at TEXT)`);
});

// --- ROTA PÚBLICA DE DADOS ---
app.get('/api/global-banks', (req, res) => {
    db.all('SELECT * FROM global_banks ORDER BY name ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// --- ROTAS DE AUTENTICAÇÃO ---
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  // Admin Hardcoded
  if (email === process.env.MAIL_ADMIN && password === process.env.PASSWORD_ADMIN) {
      const token = jwt.sign({ id: 'admin', role: 'admin', email }, JWT_SECRET, { expiresIn: '12h' });
      logAudit('admin', 'LOGIN', 'Admin login successful', req.ip);
      return res.json({ 
          token,
          user: { id: 'admin', email, razaoSocial: 'Administrador Global', role: 'admin' }
      });
  }

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) {
        logAudit(email, 'LOGIN_FAILED', 'Usuário não encontrado', req.ip);
        return res.status(401).json({ error: 'Credenciais inválidas.' });
    }
    
    let isValid = false;
    if (row.password && row.password.startsWith('$2')) {
        isValid = await bcrypt.compare(password, row.password);
    } else {
        isValid = row.password === password; // Legacy fallback
    }

    if (!isValid) {
        logAudit(row.id, 'LOGIN_FAILED', 'Senha incorreta', req.ip);
        return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    // Gera o Token
    const token = jwt.sign({ id: row.id, role: 'user', email: row.email }, JWT_SECRET, { expiresIn: '12h' });
    logAudit(row.id, 'LOGIN', 'User login successful', req.ip);
    
    res.json({ 
        token,
        user: { id: row.id, email: row.email, razaoSocial: row.razao_social, role: 'user' } 
    });
  });
});

app.post('/api/request-signup', (req, res) => {
    const { email, cnpj, razaoSocial, phone } = req.body;
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
        if (row) return res.status(400).json({ error: "E-mail já cadastrado." });
        
        const token = crypto.randomBytes(32).toString('hex');
        const createdAt = Date.now();
        // Criptografar dados sensíveis (LGPD)
        const encCnpj = encrypt(cnpj);
        const encPhone = encrypt(phone);

        db.run(
            `INSERT OR REPLACE INTO pending_signups (email, token, cnpj, razao_social, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [email, token, encCnpj, razaoSocial, encPhone, createdAt],
            async function(err) {
                if (err) return res.status(500).json({ error: err.message });
                const origin = req.headers.origin || 'https://seu-app.com';
                const link = `${origin}/?action=finalize&token=${token}`;
                
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
                logAudit('system', 'SIGNUP_REQUEST', email, req.ip);
                res.json({ message: "Link de cadastro enviado." });
            }
        );
    });
});

app.post('/api/complete-signup', (req, res) => {
  const { token, password } = req.body;
  db.get('SELECT * FROM pending_signups WHERE token = ?', [token], async (err, pendingUser) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!pendingUser) return res.status(400).json({ error: "Token inválido ou expirado." });
      
      const hashedPassword = await bcrypt.hash(password, 12);

      db.run(
        `INSERT INTO users (email, password, cnpj, razao_social, phone) VALUES (?, ?, ?, ?, ?)`,
        [pendingUser.email, hashedPassword, pendingUser.cnpj, pendingUser.razao_social, pendingUser.phone], // Já criptografados na pendência
        async function(err) {
          if (err) return res.status(500).json({ error: err.message });
          const newUserId = this.lastID;
          db.run('DELETE FROM pending_signups WHERE email = ?', [pendingUser.email]);
          
          // Seed from global banks
          db.all('SELECT * FROM global_banks', [], (err, globalBanks) => {
              if (!err && globalBanks.length > 0) {
                  const bankStmt = db.prepare("INSERT INTO banks (user_id, name, account_number, nickname, logo, active, balance) VALUES (?, ?, ?, ?, ?, ?, ?)");
                  globalBanks.forEach(b => {
                      // Default values for new user copy (criptografando numero conta 0000-0)
                      bankStmt.run(newUserId, b.name, encrypt('0000-0'), b.name, b.logo, 0, 0);
                  });
                  bankStmt.finalize();
              }
          });

          const catStmt = db.prepare("INSERT INTO categories (user_id, name, type) VALUES (?, ?, ?)");
          INITIAL_CATEGORIES_SEED.forEach(c => {
              catStmt.run(newUserId, c.name, c.type);
          });
          catStmt.finalize();
          
          logAudit(newUserId, 'SIGNUP_COMPLETE', 'Account created', req.ip);
          res.json({ id: newUserId, email: pendingUser.email, razaoSocial: pendingUser.razao_social });
        }
      );
  });
});

app.get('/api/validate-signup-token/:token', (req, res) => {
    db.get('SELECT email, razao_social FROM pending_signups WHERE token = ?', [req.params.token], (err, row) => {
        if (err || !row) return res.status(404).json({ valid: false });
        res.json({ valid: true, email: row.email, razaoSocial: row.razao_social });
    });
});

app.post('/api/recover-password', (req, res) => {
    const { email } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, row) => {
        if (!row) return res.json({ message: 'Se o email existir, as instruções foram enviadas.' });
        const token = crypto.randomBytes(20).toString('hex');
        const expires = Date.now() + 3600000;
        db.run('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [token, expires, row.id], async (err) => {
            if (err) return res.status(500).json({error: err.message});
            const origin = req.headers.origin || 'https://seu-app.com';
            const link = `${origin}/?action=reset&token=${token}`;
            const resetHtml = `... (HTML de Recuperação) ... <a href="${link}">Link</a>`;
            await sendEmail(email, "Recuperação de Senha - Virgula Contábil", resetHtml);
            res.json({ message: 'Email de recuperação enviado.' });
        });
    });
});

app.post('/api/reset-password-confirm', (req, res) => {
    const { token, newPassword } = req.body;
    db.get('SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?', [token, Date.now()], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(400).json({ error: "Link inválido ou expirado." });
        
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        
        db.run('UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [hashedPassword, row.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Senha alterada com sucesso." });
        });
    });
});

// --- ADMIN ROUTES (Protected by authenticateToken + checkAdmin) ---
app.use('/api/admin', authenticateToken, checkAdmin);

app.get('/api/admin/banks', (req, res) => {
    db.all('SELECT * FROM global_banks ORDER BY id DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/banks', async (req, res) => {
    const { name, logoData } = req.body;
    if (!name) return res.status(400).json({ error: "Nome é obrigatório" });

    let logoPath = '/logo/caixaf.png';
    if (logoData && logoData.startsWith('data:image')) {
        try {
            const matches = logoData.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const extension = matches[1].includes('+') ? matches[1].split('+')[0] : matches[1]; 
                const base64Data = matches[2];
                const fileName = `bank_${Date.now()}.${extension.replace('jpeg','jpg')}`;
                const filePath = path.join(PERSISTENT_LOGO_DIR, fileName);
                fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
                logoPath = `/logo/${fileName}`;
            }
        } catch (e) {
            console.error("Error saving logo:", e);
        }
    } else if (logoData && typeof logoData === 'string' && logoData.startsWith('/logo/')) {
        logoPath = logoData;
    }

    db.run('INSERT INTO global_banks (name, logo) VALUES (?, ?)', [name, logoPath], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name, logo: logoPath });
    });
});

app.put('/api/admin/banks/:id', (req, res) => {
    const { name, logoData } = req.body;
    const { id } = req.params;
    if (!name) return res.status(400).json({ error: "Nome é obrigatório" });

    db.get('SELECT * FROM global_banks WHERE id = ?', [id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: "Banco não encontrado" });
        const oldName = row.name;
        let logoPath = row.logo;

        if (logoData && logoData.startsWith('data:image')) {
             try {
                const matches = logoData.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                    const extension = matches[1].includes('+') ? matches[1].split('+')[0] : matches[1]; 
                    const fileName = `bank_${Date.now()}.${extension.replace('jpeg','jpg')}`;
                    const filePath = path.join(PERSISTENT_LOGO_DIR, fileName);
                    fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
                    logoPath = `/logo/${fileName}`;
                }
            } catch (e) { console.error(e); }
        }

        db.run('UPDATE global_banks SET name = ?, logo = ? WHERE id = ?', [name, logoPath, id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            db.run('UPDATE banks SET name = ?, logo = ? WHERE name = ?', [name, logoPath, oldName]); // Propagate
            res.json({ id, name, logo: logoPath });
        });
    });
});

app.delete('/api/admin/banks/:id', (req, res) => {
    db.run('DELETE FROM global_banks WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Banco removido" });
    });
});

app.get('/api/admin/users', (req, res) => {
    db.all('SELECT id, email, cnpj, razao_social, phone FROM users', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // Decrypt sensitive info for admin
        const decrypted = rows.map(u => ({...u, cnpj: decrypt(u.cnpj), phone: decrypt(u.phone)}));
        res.json(decrypted);
    });
});

app.get('/api/admin/users/:id/full-data', async (req, res) => {
    const userId = req.params.id;
    try {
        const getAsync = (sql) => new Promise((resolve, reject) => {
            db.all(sql, [userId], (err, rows) => err ? reject(err) : resolve(rows));
        });

        const [transactions, forecasts, ofxImports] = await Promise.all([
            getAsync(`SELECT t.*, c.name as category_name, b.name as bank_name FROM transactions t LEFT JOIN categories c ON t.category_id = c.id LEFT JOIN banks b ON t.bank_id = b.id WHERE t.user_id = ? ORDER BY t.date DESC`),
            getAsync(`SELECT f.*, c.name as category_name, b.name as bank_name FROM forecasts f LEFT JOIN categories c ON f.category_id = c.id LEFT JOIN banks b ON f.bank_id = b.id WHERE f.user_id = ? ORDER BY f.date ASC`),
            getAsync(`SELECT o.id, o.file_name, o.import_date, o.transaction_count, b.name as bank_name FROM ofx_imports o LEFT JOIN banks b ON o.bank_id = b.id WHERE o.user_id = ? ORDER BY o.import_date DESC`)
        ]);

        res.json({ transactions, forecasts, ofxImports });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/ofx-download/:id', (req, res) => {
    db.get('SELECT file_name, content FROM ofx_imports WHERE id = ?', [req.params.id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: "Arquivo não encontrado" });
        const decryptedContent = decrypt(row.content); // DECRYPT CONTENT
        logAudit(req.user.id, 'ADMIN_DOWNLOAD_OFX', req.params.id, req.ip);
        res.setHeader('Content-Disposition', `attachment; filename="${row.file_name}"`);
        res.setHeader('Content-Type', 'application/x-ofx');
        res.send(decryptedContent);
    });
});

app.delete('/api/admin/users/:id', (req, res) => {
    const userId = req.params.id;
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const tables = ['transactions', 'forecasts', 'banks', 'categories', 'ofx_imports', 'keyword_rules'];
        tables.forEach(t => db.run(`DELETE FROM ${t} WHERE user_id = ?`, [userId]));
        db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
            if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
            db.run('COMMIT');
            logAudit(req.user.id, 'DELETE_USER', `User ${userId} deleted`, req.ip);
            res.json({ message: 'User deleted' });
        });
    });
});

app.get('/api/admin/global-data', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM users', (err, users) => {
        db.get('SELECT COUNT(*) as count, SUM(value) as totalValue FROM transactions', (err, txs) => {
             res.json({ users, transactions: txs });
        });
    });
});

app.get('/api/admin/audit-transactions', (req, res) => {
    const sql = `SELECT t.id, t.date, t.description, t.value, t.type, u.razao_social FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.date DESC LIMIT 500`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- USER ROUTES (Protected by authenticateToken) ---
app.use('/api', authenticateToken);

app.get('/api/banks', (req, res) => {
    db.all(`SELECT * FROM banks WHERE user_id = ?`, [req.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(b => ({
            ...b,
            accountNumber: decrypt(b.account_number), // Decrypt on read
            active: Boolean(b.active)
        })));
    });
});

app.post('/api/banks', (req, res) => {
    const { name, accountNumber, nickname, logo } = req.body;
    const encAccount = encrypt(accountNumber); // Encrypt on write
    db.run(
        `INSERT INTO banks (user_id, name, account_number, nickname, logo, active, balance) VALUES (?, ?, ?, ?, ?, 1, 0)`,
        [req.userId, name, encAccount, nickname, logo],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name, accountNumber, nickname, logo, active: true, balance: 0 });
        }
    );
});

app.put('/api/banks/:id', (req, res) => {
    const { nickname, accountNumber, active } = req.body;
    const encAccount = encrypt(accountNumber);
    db.run(
        `UPDATE banks SET nickname = ?, account_number = ?, active = ? WHERE id = ? AND user_id = ?`,
        [nickname, encAccount, active ? 1 : 0, req.params.id, req.userId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.delete('/api/banks/:id', (req, res) => {
    db.run(`DELETE FROM banks WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

app.get('/api/categories', (req, res) => {
    db.all(`SELECT * FROM categories WHERE user_id = ?`, [req.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/categories', (req, res) => {
    const { name, type } = req.body;
    db.run(
        `INSERT INTO categories (user_id, name, type) VALUES (?, ?, ?)`,
        [req.userId, name, type],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name, type });
        }
    );
});

app.delete('/api/categories/:id', (req, res) => {
    db.run(`DELETE FROM categories WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

app.get('/api/keyword-rules', (req, res) => {
    db.all(`SELECT * FROM keyword_rules WHERE user_id = ?`, [req.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => ({
            id: r.id,
            keyword: r.keyword,
            type: r.type,
            categoryId: r.category_id,
            bankId: r.bank_id
        })));
    });
});

app.post('/api/keyword-rules', (req, res) => {
    const { keyword, type, categoryId, bankId } = req.body;
    db.run(
        `INSERT INTO keyword_rules (user_id, keyword, type, category_id, bank_id) VALUES (?, ?, ?, ?, ?)`,
        [req.userId, keyword, type, categoryId, bankId || null],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, keyword, type, categoryId, bankId });
        }
    );
});

app.delete('/api/keyword-rules/:id', (req, res) => {
    db.run(`DELETE FROM keyword_rules WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

app.get('/api/transactions', (req, res) => {
  db.all(`SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC`, [req.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(t => ({...t, reconciled: Boolean(t.reconciled)})));
  });
});

app.post('/api/transactions', (req, res) => {
  const { date, description, value, type, categoryId, bankId, reconciled, ofxImportId } = req.body;
  const safeDesc = description ? description.replace(/[<>]/g, '') : '';
  db.run(
    `INSERT INTO transactions (user_id, date, description, value, type, category_id, bank_id, reconciled, ofx_import_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.userId, date, safeDesc, value, type, categoryId, bankId, reconciled ? 1 : 0, ofxImportId || null],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, ...req.body });
    }
  );
});

app.put('/api/transactions/:id', (req, res) => {
  const { date, description, value, type, categoryId, bankId, reconciled } = req.body;
  const safeDesc = description ? description.replace(/[<>]/g, '') : '';
  let query = `UPDATE transactions SET date = ?, description = ?, value = ?, type = ?, category_id = ?, bank_id = ?`;
  const params = [date, safeDesc, value, type, categoryId, bankId];
  if (reconciled !== undefined) {
      query += `, reconciled = ?`;
      params.push(reconciled ? 1 : 0);
  }
  query += ` WHERE id = ? AND user_id = ?`;
  params.push(req.params.id, req.userId);
  db.run(query, params, function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.delete('/api/transactions/:id', (req, res) => {
    db.run(`DELETE FROM transactions WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

app.patch('/api/transactions/:id/reconcile', (req, res) => {
    const { reconciled } = req.body;
    db.run(`UPDATE transactions SET reconciled = ? WHERE id = ? AND user_id = ?`, [reconciled ? 1 : 0, req.params.id, req.userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes });
    });
});

app.patch('/api/transactions/batch-update', (req, res) => {
    const { transactionIds, categoryId } = req.body;
    const placeholders = transactionIds.map(() => '?').join(',');
    const sql = `UPDATE transactions SET category_id = ?, reconciled = 1 WHERE id IN (${placeholders}) AND user_id = ?`;
    const params = [categoryId, ...transactionIds, req.userId];
    db.run(sql, params, function(err) {
        if(err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes });
    });
});

app.get('/api/ofx-imports', (req, res) => {
    db.all(`SELECT id, file_name, import_date, bank_id, transaction_count FROM ofx_imports WHERE user_id = ? ORDER BY import_date DESC`, [req.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/ofx-imports', (req, res) => {
    const { fileName, importDate, bankId, transactionCount, content } = req.body;
    if (content.length > 5 * 1024 * 1024) return res.status(400).json({ error: "Arquivo muito grande." });
    
    const encContent = encrypt(content); // Encrypt content
    db.run(
        `INSERT INTO ofx_imports (user_id, file_name, import_date, bank_id, transaction_count, content) VALUES (?, ?, ?, ?, ?, ?)`,
        [req.userId, fileName, importDate, bankId, transactionCount, encContent],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            logAudit(req.userId, 'IMPORT_OFX', `${fileName} (${transactionCount} txs)`, req.ip);
            res.json({ id: this.lastID });
        }
    );
});

app.delete('/api/ofx-imports/:id', (req, res) => {
    const importId = req.params.id;
    const userId = req.userId;
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(`DELETE FROM transactions WHERE ofx_import_id = ? AND user_id = ?`, [importId, userId]);
        db.run(`DELETE FROM ofx_imports WHERE id = ? AND user_id = ?`, [importId, userId], function(err) {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
            }
            db.run('COMMIT');
            res.json({ message: 'Import deleted' });
        });
    });
});

app.get('/api/forecasts', (req, res) => {
    db.all(`SELECT * FROM forecasts WHERE user_id = ? ORDER BY date ASC`, [req.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(f => ({...f, realized: Boolean(f.realized)})));
    });
});

app.post('/api/forecasts', (req, res) => {
    const { date, description, value, type, categoryId, bankId, installmentCurrent, installmentTotal, groupId } = req.body;
    db.run(
        `INSERT INTO forecasts (user_id, date, description, value, type, category_id, bank_id, realized, installment_current, installment_total, group_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [req.userId, date, description, value, type, categoryId, bankId, installmentCurrent, installmentTotal, groupId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

app.put('/api/forecasts/:id', (req, res) => {
    const { date, description, value, type, categoryId, bankId } = req.body;
    db.run(
        `UPDATE forecasts SET date = ?, description = ?, value = ?, type = ?, category_id = ?, bank_id = ? WHERE id = ? AND user_id = ?`,
        [date, description, value, type, categoryId, bankId, req.params.id, req.userId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.delete('/api/forecasts/:id', (req, res) => {
    const { mode } = req.query; 
    const id = req.params.id;
    const userId = req.userId;

    if (!mode || mode === 'single') {
        db.run(`DELETE FROM forecasts WHERE id = ? AND user_id = ?`, [id, userId], function(err) {
            if(err) return res.status(500).json({error: err.message});
            res.json({ deleted: this.changes });
        });
    } else {
        db.get(`SELECT group_id, date FROM forecasts WHERE id = ? AND user_id = ?`, [id, userId], (err, row) => {
            if (err) return res.status(500).json({error: err.message});
            if (!row || !row.group_id) {
                db.run(`DELETE FROM forecasts WHERE id = ? AND user_id = ?`, [id, userId]);
                return res.json({ deleted: 1 });
            }

            if (mode === 'all') {
                db.run(`DELETE FROM forecasts WHERE group_id = ? AND user_id = ?`, [row.group_id, userId], function(err) {
                    if(err) return res.status(500).json({error: err.message});
                    res.json({ deleted: this.changes });
                });
            } else if (mode === 'future') {
                db.run(`DELETE FROM forecasts WHERE group_id = ? AND date >= ? AND user_id = ?`, [row.group_id, row.date, userId], function(err) {
                     if(err) return res.status(500).json({error: err.message});
                     res.json({ deleted: this.changes });
                });
            }
        });
    }
});

app.patch('/api/forecasts/:id/realize', (req, res) => {
     db.run(`UPDATE forecasts SET realized = 1 WHERE id = ? AND user_id = ?`, [req.params.id, req.userId], function(err) {
        if(err) return res.status(500).json({error: err.message});
        res.json({ updated: this.changes });
    });
});

app.get('/api/reports/cash-flow', async (req, res) => {
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
                    receitasByCategory: Object.entries(receitasCat).map(([name, value]) => ({ name, value })),
                    despesasByCategory: Object.entries(despesasCat).map(([name, value]) => ({ name, value }))
                });
            }
        );

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/reports/daily-flow', (req, res) => {
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

app.get('/api/reports/dre', (req, res) => {
    const { year, month } = req.query;
    const userId = req.userId;
    const y = parseInt(year);
    const m = month ? parseInt(month) : null;

    let query = `SELECT t.*, c.name as category_name, c.type as category_type 
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
            const cat = (t.category_name || '').toLowerCase();
            const val = t.value;
            const isCredit = t.type === 'credito';
            
            if (cat.includes('transferências internas') || 
                cat.includes('aportes de sócios') || 
                cat.includes('distribuição de lucros') ||
                cat.includes('retirada de sócios')) {
                return;
            }

            if (cat.includes('vendas de mercadorias') || 
                cat.includes('prestação de serviços') || 
                cat.includes('comissões recebidas') ||
                cat.includes('receita de aluguel') ||
                cat.includes('outras receitas operacionais')) {
                 if (isCredit) dre.receitaBruta += val;
            }
            else if (cat.includes('impostos e taxas') || 
                     cat.includes('impostos sobre vendas') ||
                     cat.includes('icms') || cat.includes('iss') || cat.includes('das') ||
                     cat.includes('devoluções de vendas') ||
                     cat.includes('descontos concedidos')) {
                 if (!isCredit) dre.deducoes += val;
            }
            else if (cat.includes('compra de mercadorias') || 
                     cat.includes('matéria-prima') || 
                     cat.includes('fretes e transportes') || 
                     cat.includes('custos diretos')) {
                 if (!isCredit) dre.cmv += val;
            }
            else if (cat.includes('receita financeira') || 
                     cat.includes('devoluções de despesas') || 
                     cat.includes('reembolsos de clientes')) {
                 if (isCredit) dre.resultadoFinanceiro += val;
            }
            else if (cat.includes('despesas financeiras') || 
                     cat.includes('juros sobre empréstimos') || 
                     cat.includes('multas') || 
                     cat.includes('iof')) {
                 if (!isCredit) dre.resultadoFinanceiro -= val;
            }
            else if (cat.includes('receitas não operacionais') || 
                     cat.includes('venda de ativo')) {
                 if (isCredit) dre.receitaNaoOperacional += val;
            }
            else if (cat.includes('despesas não operacionais') || 
                     cat.includes('baixa de bens')) {
                 if (!isCredit) dre.despesaNaoOperacional += val;
            }
            else if (cat.includes('irpj') || cat.includes('csll')) {
                 if (!isCredit) dre.impostos += val;
            }
            else if (!isCredit) {
                dre.despesasOperacionais += val;
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

app.get('/api/reports/analysis', (req, res) => {
    const { year, month } = req.query;
    const userId = req.userId;
    const y = parseInt(year);
    const m = month ? parseInt(month) : null;

    let query = `SELECT t.*, c.name as category_name, c.type as category_type 
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

            // DRE Logic Copy
            const cat = (r.category_name || '').toLowerCase();
            const val = r.value;
            const isCredit = r.type === 'credito';

            if (cat.includes('transferências internas') || cat.includes('aportes de sócios') || cat.includes('distribuição de lucros')) return;

            if (cat.includes('vendas de mercadorias') || cat.includes('prestação de serviços') || cat.includes('comissões recebidas') || cat.includes('receita de aluguel')) {
                 if (isCredit) dre.receitaBruta += val;
            }
            else if (cat.includes('impostos e taxas') || cat.includes('icms') || cat.includes('iss') || cat.includes('das') || cat.includes('devoluções')) {
                 if (!isCredit) dre.deducoes += val;
            }
            else if (cat.includes('compra de mercadorias') || cat.includes('matéria-prima') || cat.includes('fretes') || cat.includes('custos diretos')) {
                 if (!isCredit) dre.cmv += val;
            }
            else if (cat.includes('receita financeira')) {
                 if (isCredit) dre.resultadoFinanceiro += val;
            }
            else if (cat.includes('despesas financeiras') || cat.includes('juros')) {
                 if (!isCredit) dre.resultadoFinanceiro -= val;
            }
            else if (cat.includes('receitas não operacionais')) {
                 if (isCredit) dre.receitaNaoOperacional += val;
            }
            else if (cat.includes('despesas não operacionais')) {
                 if (!isCredit) dre.despesaNaoOperacional += val;
            }
            else if (cat.includes('irpj') || cat.includes('csll')) {
                 if (!isCredit) dre.impostos += val;
            }
            else if (!isCredit) {
                dre.despesasOperacionais += val;
            }
        });

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

app.get('/api/reports/forecasts', (req, res) => {
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

            if (isCredit) summary.predictedIncome += val;
            else summary.predictedExpense += val;

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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// --- BACKUP ---
setInterval(() => {
    const date = new Date().toISOString().split('T')[0];
    const backupFile = path.join(BACKUP_DIR, `backup_${date}.db`);
    if (!fs.existsSync(backupFile)) {
        fs.copyFile(dbPath, backupFile, () => {});
    }
}, 86400000);

// --- START SERVER (HTTPS / HTTP) ---
const startServer = () => {
    const sslKeyPath = process.env.SSL_KEY_PATH;
    const sslCertPath = process.env.SSL_CERT_PATH;

    if (sslKeyPath && sslCertPath && fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
        const options = {
            key: fs.readFileSync(sslKeyPath),
            cert: fs.readFileSync(sslCertPath)
        };
        https.createServer(options, app).listen(PORT, () => {
            console.log(`HTTPS Server running on port ${PORT}`);
            console.log(`Logos served from: ${LOCAL_LOGO_DIR}`);
        });
    } else {
        app.listen(PORT, () => {
            console.log(`HTTP Server running on port ${PORT}`);
            console.log(`Logos served from: ${LOCAL_LOGO_DIR}`);
        });
    }
};

startServer();