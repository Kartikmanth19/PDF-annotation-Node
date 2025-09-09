const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 4000;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '20mb' }));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_PATH = path.join(__dirname, 'db.json');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ processes: [], annotations: [] }, null, 2));

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

// multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g,'_');
    cb(null, unique);
  }
});
const upload = multer({ storage });

// serve uploaded files
app.use('/uploads', express.static(UPLOAD_DIR));


app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const db = readDB();
  const newProcess = {
    id: makeId(),
    originalName: req.file.originalname,
    filename: req.file.filename,
    path: `/uploads/${req.file.filename}`,
    createdAt: new Date().toISOString()
  };
  db.processes.push(newProcess);
  writeDB(db);
  res.json(newProcess);
});


app.get('/api/processes', (req, res) => {
  const db = readDB();
  res.json(db.processes);
});

app.get('/api/processes/:id', (req, res) => {
  const db = readDB();
  const p = db.processes.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

function validateMapping(item) {
  const db = readDB();
  const proc = db.processes.find(p => p.id === String(item.process));
  if (!proc) return 'Invalid process id';
  if (typeof item.page !== 'number' || item.page < 1) return 'Invalid page';
  if (!item.field_name || typeof item.field_name !== 'string') return 'field_name required';
  if (Array.isArray(item.bbox_norm)) {
    if (item.bbox_norm.length !== 4) return 'bbox_norm must be 4 numbers';
    const [x1,y1,x2,y2] = item.bbox_norm.map(Number);
    if ([x1,y1,x2,y2].some(v => isNaN(v) || v < 0 || v > 1)) return 'bbox_norm values must be between 0 and 1';
    if (x2 <= x1 || y2 <= y1) return 'bbox_norm x2> x1 and y2 > y1 required';
  } else if (Array.isArray(item.bbox_pixel)) {
    if (item.bbox_pixel.length !== 4) return 'bbox_pixel must be 4 numbers';
    
  } else {
    return 'Either bbox_norm or bbox_pixel is required';
  }
  return null;
}


app.post('/api/pdf-annotation-mappings/bulk', (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Expected array' });
  const db = readDB();
  const out = [];
  const errors = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const err = validateMapping(it);
    if (err) {
      errors.push({ index: i, error: err });
      continue;
    }
    
    const saved = {
      id: makeId(),
      process: String(it.process),
      form_id: it.form_id || null,
      field_id: it.field_id || null,
      field_name: it.field_name,
      field_header: it.field_header || '',
      bbox_pixel: it.bbox_pixel ? it.bbox_pixel.map(Number) : null,
      bbox_norm: it.bbox_norm ? it.bbox_norm.map(Number) : null,
      page: Number(it.page),
      scale: Number(it.scale || 1),
      field_type: it.field_type || '',
      metadata: it.metadata || {},
      createdAt: new Date().toISOString()
    };
    db.annotations.push(saved);
    out.push(saved);
  }
  writeDB(db);
  const response = { saved_count: out.length, saved: out, errors };
  res.json(response);
});

app.get('/api/annotations/:processId', (req, res) => {
  const db = readDB();
  const list = db.annotations.filter(a => String(a.process) === String(req.params.processId));
  res.json(list);
});


app.post('/app_admin/api/fetch-create-table', (req, res) => {
  const { process_id, form_id } = req.body || {};
  const db = readDB();
  let list = db.annotations.filter(a => String(a.process) === String(process_id));
  if (form_id != null) list = list.filter(a => String(a.form_id) === String(form_id));
  const out = list.map(a => ({
    id: a.id,
    annotation: {
      bbox: a.bbox_norm ? { x1: a.bbox_norm[0], y1: a.bbox_norm[1], x2: a.bbox_norm[2], y2: a.bbox_norm[3] }
                        : (a.bbox_pixel ? { x1: a.bbox_pixel[0], y1: a.bbox_pixel[1], x2: a.bbox_pixel[2], y2: a.bbox_pixel[3] } : {}),
      page: a.page,
      field_id: a.field_id || a.id,
      field_name: a.field_name,
      field_header: a.field_header || '',
      process: a.process,
      form_id: a.form_id
    },
    table_name: `table_${a.process}_qc`,
    field_name: a.field_name,
    field_type: a.field_type || 'CharField',
    max_length: (a.metadata && a.metadata.max_length) || 0,
    relation_type: '',
    related_table_name: '',
    related_field: '',
    group: 1,
    field_header: a.field_header || '',
    placeholder: a.field_name,
    required: !!(a.metadata && a.metadata.required),
    field_options: JSON.stringify(a.metadata && a.metadata.options || []),
    types: (a.field_type || 'text'),
    validation_code: null,
    required_if: null,
    regex_ptn: null,
    form_id: a.form_id,
    process_id: a.process
  }));
  res.json(out);
});

app.delete('/api/annotations/clear/:processId', (req, res) => {
  const db = readDB();
  db.annotations = db.annotations.filter(a => String(a.process) !== String(req.params.processId));
  writeDB(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Backend listening at http://localhost:${PORT}`);
});
