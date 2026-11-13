// End-to-end smoke test: node test.js
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `sf-test-${Date.now()}.db`);
const assert = require('assert');
const app = require('./server');
const srv = app.listen(0);
const base = `http://localhost:${srv.address().port}`;

const client = () => {
  let cookie = '';
  return async (path, opts = {}) => {
    const r = await fetch(base + path, {
      redirect: 'manual', ...opts, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) },
      body: opts.form ? new URLSearchParams(opts.form).toString() : undefined,
      method: opts.form ? 'POST' : (opts.method || 'GET'),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].startsWith('token=;') ? '' : sc.split(';')[0];
    return { status: r.status, loc: r.headers.get('location'), text: await r.text() };
  };
};
const ok = (n) => console.log('  ✓', n);

(async () => {
  const A = client(), B = client();
  assert.equal((await A('/')).loc, '/login'); ok('unauthenticated users are redirected to /login');

  let r = await A('/signup', { form: { email: 'a@x.com', password: 'password1', confirm: 'nope', org: 'Org A' } });
  assert.equal(r.status, 400); ok('signup validates password confirmation');
  r = await A('/signup', { form: { email: 'a@x.com', password: 'password1', confirm: 'password1', org: 'Org A' } });
  assert.equal(r.loc, '/'); ok('signup creates org + user and logs in');
  r = await B('/signup', { form: { email: 'b@x.com', password: 'password1', confirm: 'password1', org: 'Org B' } });
  assert.equal(r.loc, '/');
  r = await client()('/signup', { form: { email: 'a@x.com', password: 'password1', confirm: 'password1', org: 'Dup' } });
  assert.equal(r.status, 400); ok('duplicate email rejected');

  const add = (c, f) => c('/products', { form: f });
  assert.equal((await add(A, { name: 'Widget', sku: 'W-1', quantity: 3, selling_price: '9.99' })).loc, '/products?msg=Product+created');
  await add(A, { name: 'Gadget', sku: 'G-1', quantity: 50, low_stock_threshold: 10 });
  await add(A, { name: 'Gizmo', sku: 'Z-1', quantity: 2, low_stock_threshold: 1 });
  r = await add(A, { name: 'Dup', sku: 'W-1', quantity: 1 });
  assert.equal(r.status, 400); assert(r.text.includes('SKU already exists')); ok('SKU unique per org');
  await add(B, { name: 'Widget', sku: 'W-1', quantity: 100 });  // same SKU allowed in other org
  ok('same SKU allowed in a different org');

  r = await A('/');
  assert(r.text.includes('id="total-products">3<')); assert(r.text.includes('id="total-units">55<'));
  assert(r.text.includes('Widget') && !r.text.includes('Gadget</a>') && !r.text.includes('Gizmo</a>'));
  ok('dashboard totals correct; only Widget (3 <= default 5) is low stock (Gizmo 2 > its threshold 1)');

  await add(A, { name: 'Bolt', sku: 'B-1', quantity: 20 });
  assert(!(await A('/')).text.includes('Bolt</a>'));
  await A('/settings', { form: { default_low_stock: '60' } });
  r = await A('/');
  assert(r.text.includes('Bolt</a>') && !r.text.includes('Gadget</a>'));
  ok('default threshold drives low-stock for products without their own (Bolt), own threshold wins (Gadget)');

  const idA = 1, idB = 4;
  assert.equal((await A(`/products/${idB}/edit`)).status, 404); ok('cannot view another org\'s product');
  await A(`/products/${idB}/delete`, { form: {} });
  await A(`/products/${idB}/adjust`, { form: { delta: '-50' } });
  await A(`/products/${idB}`, { form: { name: 'HACKED', sku: 'W-1', quantity: 0 } });
  r = await B('/products'); assert(r.text.includes('Widget') && r.text.includes('>100<') && !r.text.includes('HACKED'));
  ok('cross-tenant delete/adjust/update have no effect');
  assert(!(await A('/products')).text.includes('>100<')); ok('org A list never shows org B data');

  await A(`/products/${idA}/adjust`, { form: { delta: '+7' } });
  assert((await A('/products')).text.includes('>10<')); ok('stock adjustment works');
  r = await A(`/products/${idA}/adjust`, { form: { delta: '-999' } });
  assert((await A('/products')).text.includes('>10<')); ok('negative stock prevented');
  assert((await A('/products?q=gad')).text.includes('Gadget')); assert(!(await A('/products?q=gad')).text.includes('Widget')); ok('search by name/SKU');

  await A(`/products/${idA}/delete`, { form: {} });
  assert(!(await A('/products')).text.includes('W-1')); ok('delete works');

  r = await client()('/login', { form: { email: 'a@x.com', password: 'wrongpass' } });
  assert.equal(r.status, 401); ok('bad login rejected');
  r = await client()('/login', { form: { email: 'a@x.com', password: 'password1' } });
  assert.equal(r.loc, '/'); ok('login works');
  console.log('\nAll tests passed'); srv.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
