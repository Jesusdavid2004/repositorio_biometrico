require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const XLSX = require('xlsx');
const QRCode = require('qrcode');
const archiver = require('archiver');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const Database = require('better-sqlite3');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SOURCE_XLSX = fs.readdirSync(ROOT).find((file) => file.toLowerCase().endsWith('.xlsx'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'temp'), { recursive: true });

const config = {
  port: Number(process.env.PORT || 3000),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,
  qrToken: process.env.QR_PUBLIC_TOKEN || '',
  reason: process.env.RAZON_SOCIAL || 'CENTRALES ELECTRICAS DE NARIÑO S.A. E.S.P.',
  nit: process.env.NIT || '891200200-8',
  privacyEmail: process.env.CORREO_PROTECCION_DATOS || 'consulta.protecciondatospersonales@cedenar.com.co',
  phone: process.env.LINEA_ATENCION || '602 7244321',
  address: process.env.DIRECCION_EMPRESA || 'Calle 20 No. 36 - 12, Avenida de los Estudiantes de la ciudad de Pasto',
  responsible: process.env.RESPONSABLE_TRATAMIENTO || 'CENTRALES ELÉCTRICAS DE NARIÑO S.A. E.S.P. - CEDENAR S.A. E.S.P.',
  policyVersion: process.env.VERSION_AUTORIZACION || '2.0',
  policyUrl: process.env.POLITICA_PRIVACIDAD_URL || 'https://www.cedenar.com.co',
  maxFileBytes: Number(process.env.MAX_FILE_SIZE_MB || 5) * 1024 * 1024
};

const db = new Database(path.join(DATA_DIR, 'biometrico.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS empleados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cedula TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    cargo TEXT NOT NULL DEFAULT '',
    dependencia TEXT NOT NULL DEFAULT '',
    estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'AUTORIZADO')),
    fecha_autorizacion TEXT,
    firma TEXT,
    autorizacion_aceptada INTEGER NOT NULL DEFAULT 0,
    version_autorizacion TEXT,
    pdf_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL,
    accion TEXT NOT NULL,
    cedula TEXT,
    detalle TEXT,
    created_at TEXT NOT NULL
  );
`);

const now = () => new Date().toISOString();
const clean = (value) => String(value ?? '').trim();
const normalizeHeader = (value) => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normalizeCedula = (value) => clean(value).replace(/[.\s-]/g, '');
const normalizeName = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
const colombiaDate = () => new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeStyle: 'medium', timeZone: 'America/Bogota' }).format(new Date());

function audit(user, action, cedula, detail = '') {
  db.prepare('INSERT INTO auditoria (usuario, accion, cedula, detalle, created_at) VALUES (?, ?, ?, ?, ?)').run(user, action, cedula || null, detail, now());
}

function authorizationText(employee) {
  const ciudad = clean(employee.ciudad) || '______________________';
  return `Yo, ${employee.nombre}, identificado(a) con cédula de ciudadanía No. ${employee.cedula} de la ciudad de ${ciudad}, autorizo a las CENTRALES ELÉCTRICAS DE NARIÑO S.A. E.S.P. - CEDENAR S.A. E.S.P., ubicada en la ${config.address}, para que recolecte, almacene, use, circule y/o suprima mis datos personales, que se capturan en este medio, incluyendo el tratamiento de datos sensibles, aun conociendo que no estoy obligado(a) a autorizarlo. Lo anterior con el fin de registrar y utilizar mi imagen para fines de identificación biométrica, que permitan controlar mi ingreso como trabajador a las oficinas de CEDENAR S.A. E.S.P; así como para las demás finalidades de la Política de Tratamiento de Información disponible en www.cedenar.com.co, la cual declaro conocer y aceptar, así como entender que en esta se especifican cuáles datos son sensibles.\n\nDeclaro conocer que, como titular, me asisten los derechos a conocer, actualizar y rectificar mis datos personales, así como a solicitar el cese de su tratamiento y dejar sin efecto el consentimiento previamente otorgado. Estos derechos los podré ejercer a través de los canales dispuestos por CEDENAR S.A. E.S.P. para la atención de requerimientos relacionados con el tratamiento de datos personales, en el correo electrónico ${config.privacyEmail}, en la línea de atención ${config.phone} o a través de la página web www.cedenar.com.co.`;
}

function isPublicTokenValid(req) {
  return !config.qrToken || req.query.token === config.qrToken || req.get('x-public-token') === config.qrToken;
}

function importWorkbook(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { imported: 0, skipped: 0, source: null };
  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
  let imported = 0;
  let skipped = 0;
  const insert = db.prepare(`INSERT INTO empleados (cedula, nombre, cargo, dependencia, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(cedula) DO UPDATE SET nombre=excluded.nombre, cargo=excluded.cargo, dependencia=excluded.dependencia, updated_at=excluded.updated_at
    WHERE empleados.estado = 'PENDIENTE'`);
  const transaction = db.transaction(() => {
    for (const sheetName of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
      const headerIndex = rows.findIndex((row) => {
        const headers = row.map(normalizeHeader);
        return headers.includes('cedula') && headers.includes('nombre') && headers.includes('cargo') && (headers.includes('area') || headers.includes('dependencia'));
      });
      if (headerIndex < 0) continue;
      const headers = rows[headerIndex].map(normalizeHeader);
      const col = (names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0);
      const cedulaCol = col(['cedula', 'identificacion', 'numero de cedula']);
      const nombreCol = col(['nombre', 'nombre completo']);
      const cargoCol = col(['cargo']);
      const dependenciaCol = col(['area', 'dependencia']);
      for (const row of rows.slice(headerIndex + 1)) {
        const cedula = normalizeCedula(row[cedulaCol]);
        const nombre = clean(row[nombreCol]);
        const cargo = clean(row[cargoCol]);
        const dependencia = clean(row[dependenciaCol]);
        const joined = row.map(clean).join(' ').toLowerCase();
        if (!cedula || !nombre || !/\d/.test(cedula) || /\btotal\b|\bsubtotal\b|nivel /.test(joined)) { skipped += 1; continue; }
        const result = insert.run(cedula, nombre, cargo, dependencia, now(), now());
        if (result.changes) imported += 1; else skipped += 1;
      }
    }
  });
  transaction();
  return { imported, skipped, source: path.basename(filePath) };
}

if (SOURCE_XLSX) {
  const result = importWorkbook(path.join(ROOT, SOURCE_XLSX));
  console.log(`Excel inicial: ${result.imported} trabajadores procesados desde ${result.source}.`);
}

async function createPdf(employee) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  const W = page.getWidth();
  const margin = 56;
  const contentWidth = W - margin * 2;
  const azul = rgb(0, 0.31, 0.64);
  const azulOscuro = rgb(0, 0.23, 0.46);
  const gris = rgb(0.42, 0.47, 0.51);
  const ink = rgb(0.13, 0.13, 0.15);

  // Pie institucional: ondas + linea dorada + direccion
  try {
    const pie = await pdf.embedPng(fs.readFileSync(path.join(ROOT, 'public', 'pie-ondas.png')));
    page.drawImage(pie, { x: 0, y: 0, width: W, height: 74 });
  } catch (_) { /* sin pie grafico */ }
  page.drawRectangle({ x: 0, y: 72, width: W, height: 3, color: rgb(0.95, 0.72, 0.02) });
  page.drawText('Calle 20 N° 36 – 12 Av. Los estudiantes · Contact Center 115 · www.cedenar.com.co Pasto – Nariño – Colombia', { x: 0, y: 58, size: 9, font: bold, color: ink, maxWidth: W - 100 });
  page.drawText('Página 1 de 1', { x: W - 76, y: 30, size: 9, font: regular, color: ink });

  // Encabezado: tabla de 3 columnas (logo | titulo centrado | control), con bordes como el formato
  const headTop = 820, headBottom = 736;
  const colLogoX = margin, colTitleX = margin + 160, colCtrlX = W - margin - 120, colEnd = W - margin;
  page.drawRectangle({ x: colLogoX, y: headBottom, width: colEnd - colLogoX, height: headTop - headBottom, borderColor: ink, borderWidth: 1 });
  page.drawLine({ start: { x: colTitleX, y: headBottom }, end: { x: colTitleX, y: headTop }, thickness: 1, color: ink });
  page.drawLine({ start: { x: colCtrlX, y: headBottom }, end: { x: colCtrlX, y: headTop }, thickness: 1, color: ink });
  // Celdas de control (3 filas)
  const filaH = (headTop - headBottom) / 4;
  for (let i = 1; i < 4; i++) page.drawLine({ start: { x: colCtrlX, y: headBottom + filaH * i }, end: { x: colEnd, y: headBottom + filaH * i }, thickness: 1, color: ink });
  page.drawText('Página 1 de 1', { x: colCtrlX + 10, y: headTop - 17, size: 8.5, font: regular, color: ink });
  page.drawText('FOR-GDA-GHU-019', { x: colCtrlX + 10, y: headTop - 17 - filaH, size: 8.5, font: bold, color: ink });
  page.drawText('VERSIÓN: 1.0', { x: colCtrlX + 10, y: headTop - 17 - filaH * 2, size: 8.5, font: regular, color: ink });
  page.drawText('08/SEP/2026', { x: colCtrlX + 10, y: headTop - 17 - filaH * 3, size: 8.5, font: regular, color: ink });
  // Logo dentro de la primera celda
  try {
    const logo = await pdf.embedPng(fs.readFileSync(path.join(ROOT, 'public', 'logo-cedenar-nuevo.png')));
    const logoW = 150, logoH = logoW * (468 / 2048);
    page.drawImage(logo, { x: colLogoX + (160 - logoW) / 2, y: headBottom + (84 - logoH) / 2, width: logoW, height: logoH });
  } catch (_) { /* sin logo */ }
  // Titulo centrado en la celda del medio
  const titleLines = ['AUTORIZACIÓN PARA EL TRATAMIENTO DE', 'DATOS PERSONALES BIOMÉTRICOS PARA', 'INGRESO A LAS INSTALACIONES'];
  const titleWidth = colCtrlX - colTitleX;
  titleLines.forEach((line, i) => {
    const size = 10.5;
    const tw = bold.widthOfTextAtSize(line, size);
    page.drawText(line, { x: colTitleX + (titleWidth - tw) / 2, y: 800 - i * 20, size, font: bold, color: azul });
  });

  // Cuerpo: texto del formato con campos diligenciados subrayados
  const ciudad = clean(employee.ciudad) || '______________________';
  const lineHeight = 14.5;
  let y = 706;
  const drawSegment = (text, x, yy, font, size, color) => { page.drawText(text, { x, y: yy, size, font, color }); return x + font.widthOfTextAtSize(text, size); };
  const writeRich = (segments, size) => {
    let x = margin;
    for (const seg of segments) {
      const words = seg.text.split(/(\s+)/);
      for (const word of words) {
        if (!word) continue;
        const ww = seg.font.widthOfTextAtSize(word, size);
        if (x + ww > W - margin && word.trim()) { x = margin; y -= lineHeight; }
        x = drawSegment(word, x, y, seg.font, size, seg.color || ink);
        if (seg.underline && word.trim()) page.drawLine({ start: { x: x - ww, y: y - 2 }, end: { x, y: y - 2 }, thickness: 0.8, color: ink });
      }
    }
    y -= lineHeight + 6;
  };
  writeRich([
    { text: 'Yo, ', font: regular },
  { text: employee.nombre + ' ', font: bold, underline: true },
    { text: 'identificado(a) con cédula de ciudadanía No. ', font: regular },
    { text: employee.cedula + ' ', font: bold, underline: true },
    { text: 'de la ciudad de ', font: regular },
    { text: ciudad + ' ', font: bold, underline: true },
    { text: ', autorizo a las ', font: regular },
    { text: 'CENTRALES ELÉCTRICAS DE NARIÑO S.A. E.S.P. - CEDENAR S.A. E.S.P.', font: bold },
    { text: ', ubicada en la Calle 20 No. 36 - 12, Avenida de los Estudiantes de la ciudad de Pasto, para que recolecte, almacene, use, circule y/o suprima mis datos personales, que se capturan en este medio, incluyendo el tratamiento de datos sensibles, aun conociendo que no estoy obligado(a) a autorizarlo. Lo anterior con el fin de registrar y utilizar mi imagen para fines de identificación biométrica, que permitan controlar mi ingreso como trabajador a las oficinas de CEDENAR S.A. E.S.P; así como para las demás finalidades de la Política de Tratamiento de Información disponible en www.cedenar.com.co, la cual declaro conocer y aceptar, así como entender que en esta se especifican cuáles datos son sensibles.', font: regular }
  ], 10.5);
  y -= 4;
  writeRich([
    { text: 'Declaro conocer que, como titular, me asisten los derechos a conocer, actualizar y rectificar mis datos personales, así como a solicitar el cese de su tratamiento y dejar sin efecto el consentimiento previamente otorgado. Estos derechos los podré ejercer a través de los canales dispuestos por CEDENAR S.A. E.S.P. para la atención de requerimientos relacionados con el tratamiento de datos personales, en el correo electrónico ', font: regular },
    { text: config.privacyEmail, font: regular, color: azulOscuro },
    { text: ', en la línea de atención ', font: regular },
    { text: config.phone, font: regular, color: azulOscuro },
    { text: ' o a través de la página web ', font: regular },
    { text: 'www.cedenar.com.co', font: regular, color: azulOscuro },
    { text: '.', font: regular }
  ], 10.5);

  // Bloque de firma como en el formato
  y -= 10;
  page.drawText('Atentamente,', { x: margin, y, size: 10.5, font: regular, color: ink });
  y -= 46;
  page.drawText('Firma:', { x: margin, y, size: 10.5, font: regular, color: ink });
  if (employee.firma && employee.firma.startsWith('data:image/png;base64,')) {
    try { const image = await pdf.embedPng(Buffer.from(employee.firma.split(',')[1], 'base64')); page.drawImage(image, { x: margin + 46, y: y - 14, width: 200, height: 56 }); } catch (_) { /* evidencia conservada en base */ }
  }
  page.drawLine({ start: { x: margin, y: y - 18 }, end: { x: margin + 250, y: y - 18 }, thickness: 0.8, color: ink });
  y -= 42;
  page.drawText('Nombre: ', { x: margin, y, size: 10.5, font: regular, color: ink });
  let nx = margin + regular.widthOfTextAtSize('Nombre: ', 10.5);
  nx = drawSegment(employee.nombre, nx, y, bold, 10.5, ink);
  page.drawLine({ start: { x: margin + 52, y: y - 3 }, end: { x: margin + 250, y: y - 3 }, thickness: 0.8, color: ink });
  y -= 26;
  page.drawText('C.C. No.: ', { x: margin, y, size: 10.5, font: regular, color: ink });
  drawSegment(employee.cedula, margin + regular.widthOfTextAtSize('C.C. No.: ', 10.5), y, bold, 10.5, ink);
  page.drawLine({ start: { x: margin + 52, y: y - 3 }, end: { x: margin + 250, y: y - 3 }, thickness: 0.8, color: ink });

  // Nota de evidencia sobre la barra del pie
  page.drawText(`Registro digital: ${employee.fecha_autorizacion || colombiaDate()} · Versión del formato: FOR-GDA-GHU-019 v1.0 · Este documento constituye evidencia del consentimiento registrado en la plataforma.`, { x: margin, y: 92, size: 7, font: regular, color: gris, maxWidth: contentWidth });
  const bytes = await pdf.save();
  const filename = `autorizacion_biometrica_${employee.cedula}_${normalizeName(employee.nombre) || 'trabajador'}.pdf`;
  const relative = path.join('uploads', filename);
  fs.writeFileSync(path.join(DATA_DIR, relative), bytes);
  return { relative, filename };
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(session({ secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'), resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 } }));
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, message: { error: 'Demasiados intentos. Espera unos minutos.' } });
app.use('/api/empleado', publicLimiter);
app.use('/api/autorizaciones', publicLimiter);
app.use(express.static(path.join(ROOT, 'public')));

function requireAdmin(req, res, next) { if (req.session.admin) return next(); return res.status(401).json({ error: 'Sesión administrativa requerida.' }); }
function validateEmployeeInput(body) { const cedula = normalizeCedula(body.cedula); const nombre = clean(body.nombre); if (!/^\d{4,20}$/.test(cedula) || !nombre || nombre.length > 160) return null; return { cedula, nombre, cargo: clean(body.cargo).slice(0, 160), dependencia: clean(body.dependencia).slice(0, 160) }; }

app.get('/api/config', (req, res) => res.json({ reason: config.reason, nit: config.nit, privacyEmail: config.privacyEmail, version: config.policyVersion, policyUrl: config.policyUrl, tokenRequired: Boolean(config.qrToken) }));
app.get('/api/empleado/:cedula', (req, res) => { if (!isPublicTokenValid(req)) return res.status(403).json({ error: 'Enlace no autorizado.' }); const employee = db.prepare('SELECT cedula, nombre, cargo, dependencia, estado, fecha_autorizacion, pdf_path FROM empleados WHERE cedula = ?').get(normalizeCedula(req.params.cedula)); if (!employee) return res.status(404).json({ error: 'Empleado no encontrado. Verifica la cédula e inténtalo nuevamente.' }); res.json({ ...employee, date: colombiaDate(), authorization: authorizationText(employee) }); });
app.post('/api/autorizaciones', async (req, res) => { if (!isPublicTokenValid(req)) return res.status(403).json({ error: 'Enlace no autorizado.' }); const cedula = normalizeCedula(req.body.cedula); const ciudad = clean(req.body.ciudad).slice(0, 80); const employee = db.prepare('SELECT * FROM empleados WHERE cedula = ?').get(cedula); if (!employee) return res.status(404).json({ error: 'Empleado no encontrado. Verifica la cédula e inténtalo nuevamente.' }); if (employee.estado === 'AUTORIZADO') return res.status(409).json({ error: 'Esta autorización ya fue registrada.', employee }); if (req.body.autorizacionAceptada !== true) return res.status(400).json({ error: 'Debes marcar la casilla de consentimiento.' }); const signature = clean(req.body.firma); if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length < 200) return res.status(400).json({ error: 'La firma es obligatoria y debe ser válida.' }); const acceptedAt = colombiaDate(); const updated = { ...employee, ciudad, estado: 'AUTORIZADO', fecha_autorizacion: acceptedAt, firma: signature, autorizacion_aceptada: 1, version_autorizacion: config.policyVersion }; const pdf = await createPdf(updated); db.prepare(`UPDATE empleados SET estado='AUTORIZADO', fecha_autorizacion=?, firma=?, autorizacion_aceptada=1, version_autorizacion=?, pdf_path=?, updated_at=? WHERE cedula=? AND estado='PENDIENTE'`).run(acceptedAt, signature, config.policyVersion, pdf.relative, now(), cedula); const saved = db.prepare('SELECT cedula, nombre, estado, fecha_autorizacion, pdf_path FROM empleados WHERE cedula = ?').get(cedula); res.json({ message: 'Autorización guardada correctamente.', employee: saved, download: `/api/pdf/${encodeURIComponent(pdf.relative)}?token=${encodeURIComponent(config.qrToken)}` }); });

app.post('/api/admin/login', loginLimiter, async (req, res) => { const password = clean(req.body.password); const hash = process.env.ADMIN_PASSWORD_HASH; if (!hash || !password || !(await bcrypt.compare(password, hash))) return res.status(401).json({ error: 'Credenciales inválidas.' }); req.session.admin = true; audit('admin', 'LOGIN', null); res.json({ ok: true }); });
app.post('/api/admin/logout', requireAdmin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/admin/session', (req, res) => res.json({ authenticated: Boolean(req.session.admin) }));
app.get('/api/admin/empleados', requireAdmin, (req, res) => { const params = []; let sql = 'SELECT id, cedula, nombre, cargo, dependencia, estado, fecha_autorizacion, pdf_path FROM empleados WHERE 1=1'; if (req.query.estado && ['PENDIENTE', 'AUTORIZADO'].includes(req.query.estado)) { sql += ' AND estado = ?'; params.push(req.query.estado); } if (req.query.dependencia) { sql += ' AND dependencia LIKE ?'; params.push(`%${clean(req.query.dependencia)}%`); } if (req.query.q) { sql += ' AND (cedula LIKE ? OR nombre LIKE ? OR cargo LIKE ?)'; const q = `%${clean(req.query.q)}%`; params.push(q, q, q); } sql += ' ORDER BY nombre COLLATE NOCASE'; const employees = db.prepare(sql).all(...params); const totals = db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN estado='AUTORIZADO' THEN 1 ELSE 0 END) autorizado FROM empleados").get(); res.json({ employees, totals: { total: totals.total, autorizado: totals.autorizado || 0, pendientes: totals.total - (totals.autorizado || 0), avance: totals.total ? Math.round((totals.autorizado || 0) * 100 / totals.total) : 0 } }); });
app.post('/api/admin/empleados', requireAdmin, (req, res) => { const employee = validateEmployeeInput(req.body); if (!employee) return res.status(400).json({ error: 'Completa una cédula válida y el nombre.' }); try { db.prepare('INSERT INTO empleados (cedula, nombre, cargo, dependencia, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(employee.cedula, employee.nombre, employee.cargo, employee.dependencia, now(), now()); audit('admin', 'CREAR_EMPLEADO', employee.cedula); res.status(201).json({ ok: true }); } catch (_) { res.status(409).json({ error: 'La cédula ya existe.' }); } });
app.patch('/api/admin/empleados/:cedula', requireAdmin, (req, res) => { const employee = validateEmployeeInput({ ...req.body, cedula: req.params.cedula }); if (!employee) return res.status(400).json({ error: 'Datos inválidos.' }); const result = db.prepare('UPDATE empleados SET nombre=?, cargo=?, dependencia=?, updated_at=? WHERE cedula=?').run(employee.nombre, employee.cargo, employee.dependencia, now(), employee.cedula); if (!result.changes) return res.status(404).json({ error: 'Empleado no encontrado.' }); audit('admin', 'EDITAR_EMPLEADO', employee.cedula); res.json({ ok: true }); });
app.delete('/api/admin/empleados/:cedula', requireAdmin, (req, res) => { const employee = db.prepare('SELECT pdf_path FROM empleados WHERE cedula=?').get(normalizeCedula(req.params.cedula)); if (!employee) return res.status(404).json({ error: 'Empleado no encontrado.' }); if (employee.pdf_path) fs.rmSync(path.join(DATA_DIR, employee.pdf_path), { force: true }); db.prepare('DELETE FROM empleados WHERE cedula=?').run(normalizeCedula(req.params.cedula)); audit('admin', 'ELIMINAR_EMPLEADO', req.params.cedula); res.json({ ok: true }); });

const upload = multer({ dest: path.join(DATA_DIR, 'temp'), limits: { fileSize: config.maxFileBytes }, fileFilter: (_, file, cb) => cb(null, /\.(csv|xlsx|xls)$/i.test(file.originalname)) });
app.post('/api/admin/importar-empleados', requireAdmin, upload.single('archivo'), (req, res) => { if (!req.file) return res.status(400).json({ error: 'Adjunta un archivo CSV, XLSX o XLS.' }); try { const result = importWorkbook(req.file.path); fs.rmSync(req.file.path, { force: true }); audit('admin', 'IMPORTAR_EMPLEADOS', null, JSON.stringify(result)); res.json(result); } catch (_) { fs.rmSync(req.file.path, { force: true }); res.status(400).json({ error: 'No fue posible leer el archivo. Revisa sus columnas.' }); } });
app.get('/api/pdf/:relative(*)', (req, res) => { if (!req.session.admin && !isPublicTokenValid(req)) return res.status(401).json({ error: 'Acceso no autorizado.' }); const relative = req.params.relative; const full = path.resolve(DATA_DIR, relative); if (!full.startsWith(path.resolve(UPLOAD_DIR)) || !fs.existsSync(full)) return res.status(404).end(); res.download(full); });
app.get('/api/admin/qr', requireAdmin, async (req, res) => { const url = `${config.publicUrl}/?token=${encodeURIComponent(config.qrToken)}`; const dataUrl = await QRCode.toDataURL(url, { width: 800, margin: 2, errorCorrectionLevel: 'H' }); res.json({ url, dataUrl }); });
app.get('/api/admin/descargar-autorizaciones', requireAdmin, (req, res) => { const employees = db.prepare('SELECT cedula,nombre,cargo,dependencia,estado,fecha_autorizacion,pdf_path FROM empleados ORDER BY nombre').all(); res.attachment(`respaldo_autorizaciones_${new Date().toISOString().slice(0,10)}.zip`); const archive = archiver('zip', { zlib: { level: 9 } }); archive.on('error', (error) => res.status(500).end(error.message)); archive.pipe(res); const csv = ['cedula,nombre,cargo,dependencia,estado,fecha_autorizacion,archivo_pdf', ...employees.map((e) => [e.cedula,e.nombre,e.cargo,e.dependencia,e.estado,e.fecha_autorizacion || '',e.pdf_path ? path.basename(e.pdf_path) : ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n'); archive.append(csv, { name: 'control_autorizaciones.csv' }); for (const employee of employees) if (employee.pdf_path && fs.existsSync(path.join(DATA_DIR, employee.pdf_path))) archive.file(path.join(DATA_DIR, employee.pdf_path), { name: `pdf/${path.basename(employee.pdf_path)}` }); archive.finalize(); });

app.get('/admin', (_, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.listen(config.port, () => console.log(`Servidor activo en ${config.publicUrl}`));
