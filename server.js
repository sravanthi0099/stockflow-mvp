const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PROD = process.env.NODE_ENV === 'production';
if (PROD && !process.env.JWT_SECRET) console.warn('WARNING: set JWT_SECRET in production');

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Load current user (and their org) from the JWT cookie
app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.msg = req.query.msg || null;
  const t = req.cookies.token;
  if (t) {
    try {
      const { uid } = jwt.verify(t, SECRET);
      const u = db.prepare(
        `SELECT u.id, u.email, u.org_id, o.name AS org_name, o.default_low_stock
         FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = ?`).get(uid);
      if (u) { req.user = u; res.locals.user = u; }
    } catch (e) { /* invalid token -> treated as logged out */ }
  }
  next();
});
const requireAuth = (req, res, next) => (req.user ? next() : res.redirect('/login'));
const setSession = (res, uid) =>
  res.cookie('token', jwt.sign({ uid }, SECRET, { expiresIn: '7d' }),
    { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 7 * 864e5 });

// ---------- Auth ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.get('/signup', (req, res) => req.user ? res.redirect('/') : res.render('signup', { errors: [], v: {} }));
app.post('/signup', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const { password = '', confirm = '' } = req.body;
  const org = (req.body.org || '').trim();
  const errors = [];
  if (!EMAIL_RE.test(email)) errors.push('Enter a valid email address.');
  if (password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password !== confirm) errors.push('Passwords do not match.');
  if (!org) errors.push('Organization name is required.');
  if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    errors.push('An account with this email already exists.');
  if (errors.length) return res.status(400).render('signup', { errors, v: { email, org } });

  const uid = db.transaction(() => {
    const orgId = db.prepare('INSERT INTO organizations (name) VALUES (?)').run(org).lastInsertRowid;
    return db.prepare('INSERT INTO users (email, password_hash, org_id) VALUES (?, ?, ?)')
      .run(email, bcrypt.hashSync(password, 10), orgId).lastInsertRowid;
  })();
  setSession(res, uid);
  res.redirect('/');
});

app.get('/login', (req, res) => req.user ? res.redirect('/') : res.render('login', { errors: [], v: {} }));
app.post('/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password_hash))
    return res.status(401).render('login', { errors: ['Invalid email or password.'], v: { email } });
  setSession(res, u.id);
  res.redirect('/');
});
app.post('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/login'); });

// ---------- Dashboard ----------
app.get('/', requireAuth, (req, res) => {
  const { org_id, default_low_stock } = req.user;
  const totals = db.prepare(
    'SELECT COUNT(*) AS n, COALESCE(SUM(quantity),0) AS units FROM products WHERE org_id = ?').get(org_id);
  const low = db.prepare(
    `SELECT *, COALESCE(low_stock_threshold, ?) AS eff_threshold FROM products
     WHERE org_id = ? AND quantity <= COALESCE(low_stock_threshold, ?)
     ORDER BY quantity ASC, name`).all(default_low_stock, org_id, default_low_stock);
  res.render('dashboard', { totals, low });
});

// ---------- Products ----------
function parseProduct(b) {
  const errors = [];
  const v = {
    name: (b.name || '').trim(), sku: (b.sku || '').trim(),
    description: (b.description || '').trim(),
    quantity: (b.quantity ?? '').toString().trim(),
    cost_price: (b.cost_price ?? '').toString().trim(),
    selling_price: (b.selling_price ?? '').toString().trim(),
    low_stock_threshold: (b.low_stock_threshold ?? '').toString().trim(),
  };
  if (!v.name) errors.push('Name is required.');
  if (!v.sku) errors.push('SKU is required.');
  const isInt = s => /^\d+$/.test(s);
  const isNum = s => /^\d+(\.\d+)?$/.test(s);
  if (!isInt(v.quantity)) errors.push('Quantity must be a whole number (0 or more).');
  if (v.cost_price && !isNum(v.cost_price)) errors.push('Cost price must be a non-negative number.');
  if (v.selling_price && !isNum(v.selling_price)) errors.push('Selling price must be a non-negative number.');
  if (v.low_stock_threshold && !isInt(v.low_stock_threshold)) errors.push('Low stock threshold must be a whole number.');
  const data = {
    name: v.name, sku: v.sku, description: v.description || null,
    quantity: parseInt(v.quantity, 10),
    cost_price: v.cost_price ? parseFloat(v.cost_price) : null,
    selling_price: v.selling_price ? parseFloat(v.selling_price) : null,
    low_stock_threshold: v.low_stock_threshold ? parseInt(v.low_stock_threshold, 10) : null,
  };
  return { errors, v, data };
}
const getProduct = req =>
  db.prepare('SELECT * FROM products WHERE id = ? AND org_id = ?').get(req.params.id, req.user.org_id);
const skuTaken = (orgId, sku, exceptId = 0) =>
  !!db.prepare('SELECT 1 FROM products WHERE org_id = ? AND sku = ? AND id != ?').get(orgId, sku, exceptId);

app.get('/products', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
  const products = db.prepare(
    `SELECT *, quantity <= COALESCE(low_stock_threshold, ?) AS is_low FROM products
     WHERE org_id = ? AND (name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\') ORDER BY name`)
    .all(req.user.default_low_stock, req.user.org_id, like, like);
  res.render('products', { products, q });
});

app.get('/products/new', requireAuth, (req, res) =>
  res.render('product_form', { title: 'Add product', action: '/products', errors: [], v: { quantity: 0 } }));

app.post('/products', requireAuth, (req, res) => {
  const { errors, v, data } = parseProduct(req.body);
  if (!errors.length && skuTaken(req.user.org_id, data.sku)) errors.push('SKU already exists in your organization.');
  if (errors.length) return res.status(400).render('product_form', { title: 'Add product', action: '/products', errors, v });
  db.prepare(`INSERT INTO products (org_id, name, sku, description, quantity, cost_price, selling_price, low_stock_threshold, last_updated_by)
              VALUES (@org_id, @name, @sku, @description, @quantity, @cost_price, @selling_price, @low_stock_threshold, @by)`)
    .run({ ...data, org_id: req.user.org_id, by: req.user.email });
  res.redirect('/products?msg=Product+created');
});

app.get('/products/:id/edit', requireAuth, (req, res) => {
  const p = getProduct(req);
  if (!p) return res.status(404).send('Product not found');
  res.render('product_form', { title: 'Edit product', action: `/products/${p.id}`, errors: [], v: p, meta: p });
});

app.post('/products/:id', requireAuth, (req, res) => {
  const p = getProduct(req);
  if (!p) return res.status(404).send('Product not found');
  const { errors, v, data } = parseProduct(req.body);
  if (!errors.length && skuTaken(req.user.org_id, data.sku, p.id)) errors.push('SKU already exists in your organization.');
  if (errors.length) return res.status(400).render('product_form', { title: 'Edit product', action: `/products/${p.id}`, errors, v, meta: p });
  db.prepare(`UPDATE products SET name=@name, sku=@sku, description=@description, quantity=@quantity, cost_price=@cost_price,
              selling_price=@selling_price, low_stock_threshold=@low_stock_threshold, last_updated_by=@by, updated_at=CURRENT_TIMESTAMP
              WHERE id=@id AND org_id=@org_id`)
    .run({ ...data, id: p.id, org_id: req.user.org_id, by: req.user.email });
  res.redirect('/products?msg=Product+updated');
});

app.post('/products/:id/adjust', requireAuth, (req, res) => {
  const p = getProduct(req);
  if (!p) return res.status(404).send('Product not found');
  const delta = /^[+-]?\d+$/.test((req.body.delta || '').trim()) ? parseInt(req.body.delta, 10) : NaN;
  if (Number.isNaN(delta)) return res.redirect('/products?msg=Enter+a+whole+number+like+%2B5+or+-3');
  if (p.quantity + delta < 0) return res.redirect('/products?msg=Adjustment+would+make+stock+negative');
  db.prepare(`UPDATE products SET quantity = quantity + ?, last_updated_by = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND org_id = ?`).run(delta, req.user.email, p.id, req.user.org_id);
  res.redirect('/products?msg=Stock+adjusted');
});

app.post('/products/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ? AND org_id = ?').run(req.params.id, req.user.org_id);
  res.redirect('/products?msg=Product+deleted');
});

// ---------- Settings ----------
app.get('/settings', requireAuth, (req, res) => res.render('settings', { errors: [] }));
app.post('/settings', requireAuth, (req, res) => {
  const t = (req.body.default_low_stock || '').trim();
  if (!/^\d+$/.test(t)) return res.status(400).render('settings', { errors: ['Enter a whole number (0 or more).'] });
  db.prepare('UPDATE organizations SET default_low_stock = ? WHERE id = ?').run(parseInt(t, 10), req.user.org_id);
  res.redirect('/settings?msg=Settings+saved');
});

app.get('/healthz', (req, res) => res.send('ok'));
const port = process.env.PORT || 3000;
if (require.main === module) app.listen(port, () => console.log(`StockFlow running on http://localhost:${port}`));
module.exports = app;
