/* =========================================================
   نظام محاسبة محل التوابل - المنطق الرئيسي
   التخزين: محلي في هذا المتصفح (localStorage) - بدون سيرفر وبدون قاعدة بيانات
   يفتح مباشرة بفتح index.html في المتصفح
   ========================================================= */

const STORAGE_KEY = 'spiceShopAccountingData_v1';

let state = defaultState();
let currentSupplierId = null;
let editingProductId = null;
let sellMode = 'qty';
let purchaseItemsDraft = [];

/* ---------------- Persistence (localStorage) ---------------- */

function defaultState() {
  return { meta: {}, exchangeRates: [], products: [], suppliers: [], sales: [], categories: [], reps: [], shops: [], wholesaleInvoices: [] };
}

// يضمن وجود كل الحقول (للبيانات القديمة المحفوظة قبل إضافة أقسام جديدة)
function normalizeState() {
  state.meta = state.meta || {};
  ['exchangeRates', 'products', 'suppliers', 'sales', 'categories', 'reps', 'shops', 'wholesaleInvoices'].forEach(k => {
    state[k] = state[k] || [];
  });
  state.reps.forEach(r => { r.payments = r.payments || []; });
  state.shops.forEach(s => { s.payments = s.payments || []; });
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : defaultState();
  } catch (e) {
    state = defaultState();
  }
  normalizeState();
}

// يكتب البيانات فوراً على القرص (localStorage) بدون إعادة رسم الواجهة،
// لضمان عدم ضياع أي تعديل (مثل الكتابة داخل حقل سعر) حتى لو أُغلق المتصفح فجأة قبل مغادرة الحقل
function persist() {
  const indicator = document.getElementById('saveIndicator');
  try {
    state.meta = state.meta || {};
    state.meta.lastSaved = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    indicator.textContent = 'محفوظ';
    indicator.className = 'save-indicator';
  } catch (e) {
    indicator.textContent = 'تعذّر الحفظ (مساحة التخزين ممتلئة؟)';
    indicator.className = 'save-indicator error';
  }
}

function save() {
  persist();
  renderAll();
}

window.addEventListener('beforeunload', persist);

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `نسخة-احتياطية-المحل-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('invalid');
      if (!confirm('سيتم استبدال كل البيانات الحالية بالنسخة المستوردة. متابعة؟')) return;
      state = parsed;
      normalizeState();
      save();
      alert('تم استيراد النسخة الاحتياطية بنجاح');
    } catch (e) {
      alert('الملف غير صالح، تأكد أنه نسخة احتياطية صحيحة بصيغة JSON');
    }
  };
  reader.readAsText(file);
}

/* ---------------- Utilities ---------------- */

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function timeStr() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ---------------- Exchange rate ---------------- */

function getRateForDate(dateStr) {
  const upToDate = state.exchangeRates.filter(r => r.date <= dateStr);
  if (upToDate.length) {
    upToDate.sort((a, b) => a.date.localeCompare(b.date));
    return upToDate[upToDate.length - 1].rate;
  }
  if (state.exchangeRates.length) {
    const sorted = state.exchangeRates.slice().sort((a, b) => a.date.localeCompare(b.date));
    return sorted[0].rate;
  }
  return null;
}
function getCurrentRate() { return getRateForDate(todayStr()); }

function setTodayRate(value) {
  const d = todayStr();
  const existing = state.exchangeRates.find(r => r.date === d);
  if (existing) existing.rate = value;
  else state.exchangeRates.push({ date: d, rate: value });
  save();
}

/* ---------------- Categories (الأصناف الثابتة) ---------------- */

function addCategory(name) {
  name = (name || '').trim();
  if (!name) return;
  if (state.categories.some(c => c.toLowerCase() === name.toLowerCase())) {
    alert('هذا الصنف موجود مسبقاً');
    return;
  }
  state.categories.push(name);
  save();
}
function deleteCategory(name) {
  if (!confirm(`حذف الصنف "${name}"؟ (المنتجات المصنّفة تحته حالياً لن تتأثر، فقط لن يظهر بالقائمة لاحقاً)`)) return;
  state.categories = state.categories.filter(c => c !== name);
  save();
}

/* ---------------- Products ---------------- */

function baseUnitFactor(unit) { return unit === 'kg' ? 1000 : 1; }
function stockDisplay(product) {
  if (product.unit === 'kg') return fmt(product.stock / 1000, 2) + ' كغ';
  let label = fmt(product.stock, 0) + ' حبة';
  if (product.unitsPerCarton) {
    const cartons = Math.floor(product.stock / product.unitsPerCarton);
    const rest = product.stock % product.unitsPerCarton;
    label += ` (≈ ${cartons} كرتونة` + (rest ? ` + ${fmt(rest, 0)} حبة` : '') + ')';
  }
  return label;
}
function unitPriceLabel(unit) { return unit === 'kg' ? 'لكل كغ' : 'لكل حبة'; }

function addProduct(data) {
  state.products.push({
    id: uid(),
    name: data.name,
    category: data.category || '',
    unit: data.unit,
    stock: data.stock * baseUnitFactor(data.unit),
    purchasePriceUSD: data.purchasePriceUSD,
    sellPriceUSD: data.sellPriceUSD,
    wholesalePriceUSD: data.wholesalePriceUSD,
    unitsPerCarton: data.unitsPerCarton || null,
    supplierId: data.supplierId || null,
    createdAt: new Date().toISOString()
  });
  save();
}
function updateProduct(id, patch) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  Object.assign(p, patch);
  save();
}
function deleteProduct(id) {
  if (!confirm('هل تريد حذف هذا المنتج نهائياً؟')) return;
  state.products = state.products.filter(x => x.id !== id);
  if (editingProductId === id) cancelEditProduct();
  save();
}

function startEditProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  editingProductId = id;

  document.getElementById('p_name').value = p.name;
  document.getElementById('p_unit').value = p.unit;
  document.getElementById('p_unit').dispatchEvent(new Event('change'));
  setSelectValueEnsured(document.getElementById('p_category'), p.category || '');
  document.getElementById('p_qty').value = p.unit === 'kg' ? (p.stock / 1000) : p.stock;
  document.getElementById('p_cartonSize').value = p.unitsPerCarton || '';
  document.getElementById('p_cartonSizeEcho').textContent = p.unitsPerCarton || '—';
  document.getElementById('p_purchase').value = p.purchasePriceUSD;
  document.getElementById('p_sell').value = p.sellPriceUSD ?? '';
  document.getElementById('p_wholesale').value = p.wholesalePriceUSD ?? '';
  document.getElementById('p_supplier').value = p.supplierId || '';

  document.getElementById('productFormTitle').textContent = 'تعديل المنتج: ' + p.name;
  document.getElementById('productSubmitBtn').textContent = 'حفظ التعديلات';
  document.getElementById('cancelEditBtn').classList.remove('hidden');
  document.getElementById('productForm').scrollIntoView({ behavior: 'smooth' });
}

function cancelEditProduct() {
  editingProductId = null;
  document.getElementById('productForm').reset();
  document.getElementById('p_unit').dispatchEvent(new Event('change'));
  document.getElementById('p_cartonSizeEcho').textContent = '—';
  document.getElementById('productFormTitle').textContent = 'إضافة منتج جديد';
  document.getElementById('productSubmitBtn').textContent = 'إضافة المنتج';
  document.getElementById('cancelEditBtn').classList.add('hidden');
}

/* ---------------- Suppliers ---------------- */

function addSupplier(data) {
  state.suppliers.push({
    id: uid(),
    name: data.name,
    phone: data.phone || '',
    notes: data.notes || '',
    createdAt: new Date().toISOString(),
    transactions: []
  });
  save();
}
function supplierBalance(sup) {
  let total = 0, paid = 0;
  sup.transactions.forEach(t => {
    if (t.type === 'purchase') { total += t.totalUSD; paid += (t.paidUSD || 0); }
    else if (t.type === 'payment') { paid += t.amountUSD; }
  });
  return { total, paid, balance: total - paid };
}

/* ---------------- Sales / profit calc ---------------- */

function computeSalePreview(product, mode, value) {
  const rate = getCurrentRate();
  if (!rate) return { error: 'لم يتم إدخال سعر صرف الدولار بعد. الرجاء إدخاله من لوحة التحكم أولاً.' };
  if (product.sellPriceUSD == null) return { error: 'لم يتم تحديد سعر بيع لهذا المنتج بعد. حدده من صفحة المنتجات.' };
  if (!value || value <= 0) return null;

  const sellPricePerBaseUSD = product.sellPriceUSD / baseUnitFactor(product.unit); // per gram or per piece
  const purchasePricePerBaseUSD = product.purchasePriceUSD / baseUnitFactor(product.unit);
  const sellPricePerBaseSYP = sellPricePerBaseUSD * rate;

  let qty, revenueSYP;
  if (mode === 'qty') {
    qty = value;
    revenueSYP = qty * sellPricePerBaseSYP;
  } else {
    revenueSYP = value;
    if (sellPricePerBaseSYP <= 0) return { error: 'سعر البيع غير صالح.' };
    qty = value / sellPricePerBaseSYP;
  }

  const costUSD = qty * purchasePricePerBaseUSD;
  const costSYP = costUSD * rate;
  const profitSYP = revenueSYP - costSYP;

  if (qty > product.stock + 1e-9) {
    return { error: `الكمية المتوفرة غير كافية (المتوفر: ${stockDisplay(product)})` };
  }

  return { qty, revenueSYP, costSYP, profitSYP, rate };
}

function recordSale(product, mode, value, customer) {
  const preview = computeSalePreview(product, mode, value);
  if (!preview || preview.error) return preview;

  state.sales.push({
    id: uid(),
    date: todayStr(),
    time: timeStr(),
    productId: product.id,
    productName: product.name,
    unit: product.unit,
    qty: preview.qty,
    revenueSYP: preview.revenueSYP,
    costSYP: preview.costSYP,
    profitSYP: preview.profitSYP,
    rateUsed: preview.rate,
    customer: customer || ''
  });
  product.stock -= preview.qty;
  save();
  return { ok: true };
}

function deleteSale(id) {
  const sale = state.sales.find(s => s.id === id);
  if (!sale) return;
  if (!confirm('حذف عملية البيع هذه؟ سيتم إرجاع الكمية إلى المخزون.')) return;
  const product = state.products.find(p => p.id === sale.productId);
  if (product) product.stock += sale.qty;
  state.sales = state.sales.filter(s => s.id !== id);
  save();
}

/* ---------------- Rendering: shared ---------------- */

function renderAll() {
  renderDashboard();
  renderCategories();
  renderProducts();
  renderInventory();
  renderSell();
  renderWholesale();
  renderSuppliers();
  renderReports();
  renderPrintOptions();
}

function renderCategories() {
  const container = document.getElementById('categoryChips');
  container.innerHTML = '';
  state.categories.forEach(c => {
    container.appendChild(el(`<span class="chip">${escapeHtml(c)} <button type="button" class="chip-remove" data-name="${escapeHtml(c)}">×</button></span>`));
  });
  container.querySelectorAll('.chip-remove').forEach(btn => btn.addEventListener('click', () => deleteCategory(btn.dataset.name)));
  populateCategorySelect(document.getElementById('p_category'), true);
}

function populateCategorySelect(selectEl, includeEmpty) {
  const current = selectEl.value;
  selectEl.innerHTML = '';
  if (includeEmpty) selectEl.appendChild(el(`<option value="">— اختر صنف —</option>`));
  state.categories.forEach(c => {
    selectEl.appendChild(el(`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`));
  });
  if ([...selectEl.options].some(o => o.value === current)) selectEl.value = current;
}

// يضمن ظهور قيمة موجودة مسبقاً (كصنف منتج قديم لم يعد بالقائمة الثابتة) كخيار بالقائمة بدل ضياعها
function setSelectValueEnsured(selectEl, value) {
  if (value && ![...selectEl.options].some(o => o.value === value)) {
    selectEl.appendChild(el(`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`));
  }
  selectEl.value = value || '';
}

function populateProductSelect(selectEl, includeEmpty, filterFn, emptyLabel) {
  const current = selectEl.value;
  selectEl.innerHTML = '';
  if (includeEmpty) selectEl.appendChild(el(`<option value="">${emptyLabel || '— اختر —'}</option>`));
  state.products.filter(filterFn || (() => true)).forEach(p => {
    selectEl.appendChild(el(`<option value="${p.id}">${escapeHtml(p.name)} (${p.category || 'بدون تصنيف'})</option>`));
  });
  if ([...selectEl.options].some(o => o.value === current)) selectEl.value = current;
}

function populateSupplierSelect(selectEl, includeEmpty) {
  const current = selectEl.value;
  selectEl.innerHTML = '';
  if (includeEmpty) selectEl.appendChild(el(`<option value="">— بدون —</option>`));
  state.suppliers.forEach(s => {
    selectEl.appendChild(el(`<option value="${s.id}">${escapeHtml(s.name)}</option>`));
  });
  if ([...selectEl.options].some(o => o.value === current)) selectEl.value = current;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Dashboard ---------------- */

function renderDashboard() {
  const rate = getCurrentRate();
  const todayRateEntry = state.exchangeRates.find(r => r.date === todayStr());
  const display = document.getElementById('currentRateDisplay');
  if (todayRateEntry) {
    display.textContent = `سعر اليوم (${todayStr()}): ${fmt(todayRateEntry.rate)} ل.س / دولار`;
  } else if (rate) {
    display.textContent = `⚠️ لم يُدخل سعر اليوم بعد — يُستخدم آخر سعر مسجل: ${fmt(rate)} ل.س / دولار`;
  } else {
    display.textContent = 'لا يوجد أي سعر صرف مسجل بعد';
  }

  const historyEl = document.getElementById('rateHistory');
  historyEl.innerHTML = '';
  state.exchangeRates.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).forEach(r => {
    historyEl.appendChild(el(`<div>${r.date} — ${fmt(r.rate)} ل.س</div>`));
  });

  const today = todayStr();
  const weekStart = addDays(today, -6);
  const todaySales = state.sales.filter(s => s.date === today);
  const weekSales = state.sales.filter(s => s.date >= weekStart && s.date <= today);

  document.getElementById('statTodaySales').textContent = fmt(sum(todaySales, 'revenueSYP'));
  document.getElementById('statTodayProfit').textContent = fmt(sum(todaySales, 'profitSYP'));
  document.getElementById('statWeekSales').textContent = fmt(sum(weekSales, 'revenueSYP'));
  document.getElementById('statWeekProfit').textContent = fmt(sum(weekSales, 'profitSYP'));

  document.getElementById('statProductCount').textContent = state.products.length;
  document.getElementById('statNoPriceCount').textContent = state.products.filter(p => p.sellPriceUSD == null).length;
  document.getElementById('statSupplierCount').textContent = state.suppliers.length;
  const totalDebt = state.suppliers.reduce((acc, s) => acc + supplierBalance(s).balance, 0);
  document.getElementById('statSupplierDebt').textContent = fmt(totalDebt, 2);
  document.getElementById('statShopDebt').textContent = fmt(state.shops.reduce((a, s) => a + shopTotals(s).balance, 0), 2);
  document.getElementById('statRepDue').textContent = fmt(state.reps.reduce((a, r) => a + repTotals(r).due, 0), 2);
}
function sum(arr, field) { return arr.reduce((a, x) => a + (x[field] || 0), 0); }

/* ---------------- Products view ---------------- */

function renderProducts() {
  const tbody = document.getElementById('productsTbody');
  const search = (document.getElementById('productSearch').value || '').trim().toLowerCase();
  const rate = getCurrentRate();
  tbody.innerHTML = '';
  state.products
    .filter(p => !search || p.name.toLowerCase().includes(search) || (p.category || '').toLowerCase().includes(search))
    .forEach(p => {
      const supplier = state.suppliers.find(s => s.id === p.supplierId);
      const sellSYP = (p.sellPriceUSD != null && rate) ? fmt(p.sellPriceUSD * rate, 0) + ` ل.س/${p.unit === 'kg' ? 'كغ' : 'حبة'}` : '—';
      const row = el(`
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.category || '—')}</td>
          <td>${p.unit === 'kg' ? 'وزن' : 'قطعة'}</td>
          <td>${stockDisplay(p)}</td>
          <td>${fmt(p.purchasePriceUSD, 2)}</td>
          <td><input type="number" class="inline-edit sell-price-input" min="0" step="any" value="${p.sellPriceUSD ?? ''}" placeholder="غير محدد" data-id="${p.id}"></td>
          <td>${sellSYP}</td>
          <td>${supplier ? escapeHtml(supplier.name) : '—'}</td>
          <td>
            <button class="link-btn edit-product-btn" data-id="${p.id}">تعديل</button>
            <button class="link-btn del-product-btn" data-id="${p.id}">حذف</button>
          </td>
        </tr>
      `);
      tbody.appendChild(row);
    });

  tbody.querySelectorAll('.edit-product-btn').forEach(btn => {
    btn.addEventListener('click', () => startEditProduct(btn.dataset.id));
  });
  tbody.querySelectorAll('.sell-price-input').forEach(input => {
    // يحفظ فوراً مع كل حرف يُكتب (بدون إعادة رسم الجدول، حتى لا يفقد الحقل التركيز أثناء الكتابة)
    input.addEventListener('input', () => {
      const p = state.products.find(x => x.id === input.dataset.id);
      if (!p) return;
      p.sellPriceUSD = input.value === '' ? null : parseFloat(input.value);
      persist();
    });
    // عند مغادرة الحقل: إعادة رسم الواجهة لتحديث الأعمدة المحسوبة (السعر بالليرة) والتبويبات الأخرى
    input.addEventListener('change', renderAll);
  });
  tbody.querySelectorAll('.del-product-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteProduct(btn.dataset.id));
  });

  populateSupplierSelect(document.getElementById('p_supplier'), true);
}

/* ---------------- Inventory (الجرد) view ---------------- */

function renderInventory() {
  const tbody = document.getElementById('inventoryTbody');
  const search = (document.getElementById('invSearch').value || '').trim().toLowerCase();
  const rate = getCurrentRate();
  tbody.innerHTML = '';
  let totalCost = 0, totalSellUSD = 0;
  state.products
    .filter(p => !search || p.name.toLowerCase().includes(search) || (p.category || '').toLowerCase().includes(search))
    .forEach(p => {
      const factor = baseUnitFactor(p.unit);
      const costValue = (p.stock / factor) * p.purchasePriceUSD;
      const sellValue = p.sellPriceUSD != null ? (p.stock / factor) * p.sellPriceUSD : null;
      totalCost += costValue;
      if (sellValue != null) totalSellUSD += sellValue;
      tbody.appendChild(el(`
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.category || '—')}</td>
          <td>${stockDisplay(p)}</td>
          <td>${fmt(p.purchasePriceUSD, 2)}</td>
          <td>${fmt(costValue, 2)}</td>
          <td>${p.sellPriceUSD != null ? fmt(p.sellPriceUSD, 2) : '—'}</td>
          <td>${sellValue != null ? fmt(sellValue, 2) : '—'}</td>
        </tr>
      `));
    });
  document.getElementById('inv_totalCost').textContent = fmt(totalCost, 2);
  document.getElementById('inv_totalSellUSD').textContent = fmt(totalSellUSD, 2);
  document.getElementById('inv_totalSellSYP').textContent = rate ? fmt(totalSellUSD * rate, 0) : '—';
}

/* ---------------- Sell / POS view ---------------- */

function productMatches(p, q) {
  q = (q || '').trim().toLowerCase();
  return !q || p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q);
}

// يعيد تعبئة قائمة المنتجات حسب نص البحث، ويختار أول نتيجة تلقائياً إذا الاختيار الحالي مش ضمن النتائج
function populateSearchableProductSelect(selectEl, query, baseFilter) {
  const ok = p => (!baseFilter || baseFilter(p)) && productMatches(p, query);
  const matches = state.products.filter(ok);
  populateProductSelect(selectEl, true, ok,
    query && query.trim() ? `— ${matches.length} نتيجة —` : '— اختر —');
  if (query && query.trim() && matches.length && !matches.some(p => p.id === selectEl.value)) {
    selectEl.value = matches[0].id;
  }
}

function renderSell() {
  const sel = document.getElementById('s_product');
  populateSearchableProductSelect(sel, document.getElementById('s_productSearch').value);
  updateSellFormForProduct();

  const today = todayStr();
  const rate = getCurrentRate();
  const todaySales = state.sales.filter(s => s.date === today).slice().reverse();
  const tbody = document.getElementById('todaySalesTbody');
  tbody.innerHTML = '';
  todaySales.forEach(s => {
    const qtyLabel = s.unit === 'kg' ? fmt(s.qty, 1) + ' غ' : fmt(s.qty, 0) + ' حبة';
    tbody.appendChild(el(`
      <tr>
        <td>${s.time}</td>
        <td>${escapeHtml(s.productName)}</td>
        <td>${qtyLabel}</td>
        <td>${fmt(s.revenueSYP)}</td>
        <td>${fmt(s.profitSYP)}</td>
        <td>${escapeHtml(s.customer || '—')}</td>
        <td><button class="link-btn del-sale-btn" data-id="${s.id}">حذف</button></td>
      </tr>
    `));
  });
  tbody.querySelectorAll('.del-sale-btn').forEach(btn => btn.addEventListener('click', () => deleteSale(btn.dataset.id)));

  document.getElementById('todaySalesTotals').innerHTML =
    `<span>إجمالي مبيعات اليوم: ${fmt(sum(todaySales, 'revenueSYP'))} ل.س</span>
     <span>إجمالي الربح: ${fmt(sum(todaySales, 'profitSYP'))} ل.س</span>`;

  updateSalePreview();
}

function updateSellFormForProduct() {
  const productId = document.getElementById('s_product').value;
  const product = state.products.find(p => p.id === productId);
  const infoEl = document.getElementById('s_productInfo');
  const rate = getCurrentRate();

  if (!product) {
    infoEl.className = 'product-info';
    infoEl.innerHTML = '';
    return;
  }
  infoEl.className = 'product-info visible';
  const sellSYP = (product.sellPriceUSD != null && rate) ? fmt(product.sellPriceUSD * rate, 0) : null;
  infoEl.innerHTML = `المتوفر: <b>${stockDisplay(product)}</b> — سعر البيع: ` +
    (sellSYP ? `<b>${sellSYP} ل.س ${unitPriceLabel(product.unit)}</b>` : `<span class="warn">لم يُحدد بعد</span>`);

  document.getElementById('s_qtyUnitLabel').textContent = product.unit === 'kg' ? '(غرام)' : '(حبة)';
}

function updateSalePreview() {
  const productId = document.getElementById('s_product').value;
  const product = state.products.find(p => p.id === productId);
  const previewEl = document.getElementById('s_preview');
  const confirmBtn = document.getElementById('s_confirmBtn');

  if (!product) {
    previewEl.className = 'preview-box';
    previewEl.innerHTML = '';
    confirmBtn.disabled = true;
    return;
  }

  const value = sellMode === 'qty'
    ? parseFloat(document.getElementById('s_qty').value)
    : parseFloat(document.getElementById('s_amount').value);

  const result = computeSalePreview(product, sellMode, value);
  if (!result) {
    previewEl.className = 'preview-box';
    previewEl.innerHTML = '';
    confirmBtn.disabled = false;
    return;
  }
  if (result.error) {
    previewEl.className = 'preview-box visible';
    previewEl.innerHTML = `<span class="warn">${result.error}</span>`;
    confirmBtn.disabled = true;
    return;
  }
  const qtyLabel = product.unit === 'kg' ? fmt(result.qty, 1) + ' غرام' : fmt(result.qty, 2) + ' حبة';
  previewEl.className = 'preview-box visible';
  previewEl.innerHTML = `
    الكمية: <b>${qtyLabel}</b> —
    المبلغ: <b>${fmt(result.revenueSYP)} ل.س</b> —
    الربح المتوقع: <b>${fmt(result.profitSYP)} ل.س</b>
  `;
  confirmBtn.disabled = false;
}

/* ---------------- Suppliers view ---------------- */

function renderSuppliers() {
  const tbody = document.getElementById('suppliersTbody');
  tbody.innerHTML = '';
  state.suppliers.forEach(s => {
    const bal = supplierBalance(s);
    tbody.appendChild(el(`
      <tr>
        <td><button class="link-btn open-supplier-btn" data-id="${s.id}">${escapeHtml(s.name)}</button></td>
        <td>${escapeHtml(s.phone || '—')}</td>
        <td>${fmt(bal.balance, 2)}</td>
        <td><button class="link-btn del-supplier-btn" data-id="${s.id}">حذف</button></td>
      </tr>
    `));
  });
  tbody.querySelectorAll('.open-supplier-btn').forEach(btn => btn.addEventListener('click', () => openSupplierDetail(btn.dataset.id)));
  tbody.querySelectorAll('.del-supplier-btn').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('حذف هذا المورد وكل سجل حسابه؟')) return;
    state.suppliers = state.suppliers.filter(x => x.id !== btn.dataset.id);
    if (currentSupplierId === btn.dataset.id) { currentSupplierId = null; document.getElementById('supplierDetailCard').classList.add('hidden'); }
    save();
  }));

  if (currentSupplierId && state.suppliers.find(s => s.id === currentSupplierId)) {
    renderSupplierDetail();
  }
}

function openSupplierDetail(id) {
  currentSupplierId = id;
  document.getElementById('supplierDetailCard').classList.remove('hidden');
  purchaseItemsDraft = [{ productId: '', qty: '', unitPriceUSD: '', desc: '' }];
  renderPurchaseItemsDraft();
  renderSupplierDetail();
  document.getElementById('supplierDetailCard').scrollIntoView({ behavior: 'smooth' });
}

function renderSupplierDetail() {
  const sup = state.suppliers.find(s => s.id === currentSupplierId);
  if (!sup) return;
  document.getElementById('supplierDetailName').textContent = `دفتر حساب: ${sup.name}`;
  const bal = supplierBalance(sup);
  document.getElementById('sup_totalPurchases').textContent = fmt(bal.total, 2);
  document.getElementById('sup_totalPaid').textContent = fmt(bal.paid, 2);
  document.getElementById('sup_balance').textContent = fmt(bal.balance, 2);

  const tbody = document.getElementById('supplierTransactionsTbody');
  tbody.innerHTML = '';
  sup.transactions.slice().reverse().forEach(t => {
    let details, amount, paid, typeLabel;
    if (t.type === 'purchase') {
      typeLabel = 'شراء';
      details = t.items.map(i => `${escapeHtml(i.label)} × ${fmt(i.qty, 2)}`).join('، ');
      amount = fmt(t.totalUSD, 2);
      const badge = t.paymentMethod === 'cash' ? '<span class="badge cash">نقدي</span>' :
        t.paymentMethod === 'partial' ? '<span class="badge partial">جزئي</span>' : '<span class="badge credit">آجل</span>';
      paid = fmt(t.paidUSD || 0, 2) + ' ' + badge;
    } else {
      typeLabel = 'دفعة';
      details = escapeHtml(t.note || 'تسديد دفعة');
      amount = '—';
      paid = fmt(t.amountUSD, 2);
    }
    tbody.appendChild(el(`
      <tr>
        <td>${t.date}</td>
        <td>${typeLabel}</td>
        <td>${details}</td>
        <td>${amount}</td>
        <td>${paid}</td>
        <td><button class="link-btn del-transaction-btn" data-id="${t.id}">حذف</button></td>
      </tr>
    `));
  });
  tbody.querySelectorAll('.del-transaction-btn').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('حذف هذه الحركة من الحساب؟')) return;
    const tx = sup.transactions.find(t => t.id === btn.dataset.id);
    if (tx && tx.type === 'purchase') {
      tx.items.forEach(i => {
        if (i.productId) {
          const prod = state.products.find(p => p.id === i.productId);
          if (prod) prod.stock -= i.qty * baseUnitFactor(prod.unit);
        }
      });
    }
    sup.transactions = sup.transactions.filter(t => t.id !== btn.dataset.id);
    save();
  }));
}

function renderPurchaseItemsDraft() {
  const container = document.getElementById('purchaseItems');
  container.innerHTML = '';
  purchaseItemsDraft.forEach((row, idx) => {
    const wrap = el(`<div class="purchase-item-row" data-idx="${idx}"></div>`);
    const select = el(`<select class="pi-product"></select>`);
    populateProductSelect(select, true, null, '— صنف يدوي —');
    select.value = row.productId;
    wrap.appendChild(select);
    const descInput = el(`<input type="text" class="pi-desc" placeholder="الوصف (إن لم يكن صنفاً مسجلاً)" value="${escapeHtml(row.desc)}" ${row.productId ? 'disabled' : ''}>`);
    const qtyInput = el(`<input type="number" class="pi-qty" min="0" step="any" placeholder="الكمية" value="${row.qty}">`);
    const priceInput = el(`<input type="number" class="pi-price" min="0" step="any" placeholder="سعر الوحدة $" value="${row.unitPriceUSD}">`);
    const removeBtn = el(`<button type="button" class="btn small danger">حذف</button>`);

    select.addEventListener('change', () => {
      row.productId = select.value;
      const prod = state.products.find(p => p.id === select.value);
      if (prod) {
        row.unitPriceUSD = row.unitPriceUSD || prod.purchasePriceUSD;
      }
      renderPurchaseItemsDraft();
      updatePurchaseTotal();
    });
    descInput.addEventListener('input', () => { row.desc = descInput.value; });
    qtyInput.addEventListener('input', () => { row.qty = parseFloat(qtyInput.value) || 0; updatePurchaseTotal(); });
    priceInput.addEventListener('input', () => { row.unitPriceUSD = parseFloat(priceInput.value) || 0; updatePurchaseTotal(); });
    removeBtn.addEventListener('click', () => { purchaseItemsDraft.splice(idx, 1); renderPurchaseItemsDraft(); updatePurchaseTotal(); });

    wrap.appendChild(descInput);
    wrap.appendChild(qtyInput);
    wrap.appendChild(priceInput);
    wrap.appendChild(removeBtn);
    container.appendChild(wrap);

    const prod = row.productId ? state.products.find(p => p.id === row.productId) : null;
    if (prod) {
      const hint = el(`<small style="grid-column:1/-1;color:var(--muted)">الكمية بوحدة: ${prod.unit === 'kg' ? 'كغ' : 'حبة'} — سعر الوحدة بالدولار ${unitPriceLabel(prod.unit)}</small>`);
      container.appendChild(hint);
    }

    // مساعد الكراتين: لمنتجات القطعة (مثال: اشتريت 5 كراتين، كل كرتونة فيها ظرف)
    if (prod && prod.unit === 'piece') {
      const helper = el(`
        <div class="carton-helper" style="margin-bottom:10px">
          <small>احسب الكمية (بالحبة) من عدد الكراتين:</small>
          <div class="row">
            <input type="number" class="ci-cartons" min="0" step="any" placeholder="عدد الكراتين">
            <span>×</span>
            <input type="number" class="ci-perCarton" min="0" step="any" placeholder="قطع/كرتونة" value="${prod.unitsPerCarton || ''}">
            <button type="button" class="btn small ci-calc">تعبئة الكمية</button>
          </div>
        </div>
      `);
      helper.querySelector('.ci-calc').addEventListener('click', () => {
        const cartons = parseFloat(helper.querySelector('.ci-cartons').value) || 0;
        const perCarton = parseFloat(helper.querySelector('.ci-perCarton').value) || 0;
        if (!cartons || !perCarton) { alert('أدخل عدد الكراتين وعدد القطع بالكرتونة'); return; }
        row.qty = cartons * perCarton;
        if (prod.unitsPerCarton !== perCarton) updateProduct(prod.id, { unitsPerCarton: perCarton });
        renderPurchaseItemsDraft();
        updatePurchaseTotal();
      });
      container.appendChild(helper);
    }
  });
  updatePurchaseTotal();
}

function updatePurchaseTotal() {
  const total = purchaseItemsDraft.reduce((a, r) => a + (r.qty || 0) * (r.unitPriceUSD || 0), 0);
  document.getElementById('purchaseTotalDisplay').textContent = fmt(total, 2);
}

/* ---------------- Reports ---------------- */

function renderSaleSearch() {
  const q = (document.getElementById('saleSearch').value || '').trim().toLowerCase();
  const from = document.getElementById('saleSearchFrom').value;
  const to = document.getElementById('saleSearchTo').value;
  const tbody = document.getElementById('saleSearchTbody');
  const totalsEl = document.getElementById('saleSearchTotals');

  if (!q && !from && !to) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">اكتب اسم منتج أو زبون، أو اختر فترة تاريخ، لعرض نتائج البحث</td></tr>';
    totalsEl.innerHTML = '';
    return;
  }

  const results = state.sales
    .filter(s => {
      if (from && s.date < from) return false;
      if (to && s.date > to) return false;
      if (q && !(s.productName.toLowerCase().includes(q) || (s.customer || '').toLowerCase().includes(q))) return false;
      return true;
    })
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  if (!results.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">لا توجد نتائج مطابقة</td></tr>';
    totalsEl.innerHTML = '';
    return;
  }

  tbody.innerHTML = results.map(s => {
    const qtyLabel = s.unit === 'kg' ? fmt(s.qty, 1) + ' غ' : fmt(s.qty, 0) + ' حبة';
    return `<tr>
      <td>${s.date}</td><td>${s.time}</td><td>${escapeHtml(s.productName)}</td><td>${qtyLabel}</td>
      <td>${fmt(s.revenueSYP)}</td><td>${fmt(s.profitSYP)}</td><td>${escapeHtml(s.customer || '—')}</td>
    </tr>`;
  }).join('');

  totalsEl.innerHTML =
    `<span>عدد النتائج: ${results.length}</span>
     <span>مجموع المبيعات: ${fmt(sum(results, 'revenueSYP'))} ل.س</span>
     <span>مجموع الربح: ${fmt(sum(results, 'profitSYP'))} ل.س</span>`;
}

function renderReports() {
  renderSaleSearch();
  const dateInput = document.getElementById('rep_date');
  if (!dateInput.value) dateInput.value = todayStr();
  const day = dateInput.value;

  const daySales = state.sales.filter(s => s.date === day);
  document.getElementById('rep_count').textContent = daySales.length;
  document.getElementById('rep_revenue').textContent = fmt(sum(daySales, 'revenueSYP'));
  document.getElementById('rep_profit').textContent = fmt(sum(daySales, 'profitSYP'));

  const tbody = document.getElementById('rep_dailyTbody');
  tbody.innerHTML = '';
  daySales.forEach(s => {
    const qtyLabel = s.unit === 'kg' ? fmt(s.qty, 1) + ' غ' : fmt(s.qty, 0) + ' حبة';
    tbody.appendChild(el(`
      <tr>
        <td>${s.time}</td><td>${escapeHtml(s.productName)}</td><td>${qtyLabel}</td>
        <td>${fmt(s.revenueSYP)}</td><td>${fmt(s.profitSYP)}</td><td>${escapeHtml(s.customer || '—')}</td>
      </tr>
    `));
  });

  const weekTbody = document.getElementById('rep_weeklyTbody');
  weekTbody.innerHTML = '';
  let weekRevenue = 0, weekProfit = 0;
  for (let i = 6; i >= 0; i--) {
    const d = addDays(day, -i);
    const daySalesX = state.sales.filter(s => s.date === d);
    const rev = sum(daySalesX, 'revenueSYP');
    const prof = sum(daySalesX, 'profitSYP');
    weekRevenue += rev;
    weekProfit += prof;
    weekTbody.appendChild(el(`
      <tr><td>${d}</td><td>${daySalesX.length}</td><td>${fmt(rev)}</td><td>${fmt(prof)}</td></tr>
    `));
  }
  document.getElementById('rep_weekRevenue').textContent = fmt(weekRevenue);
  document.getElementById('rep_weekProfit').textContent = fmt(weekProfit);
}

/* ---------------- Print ---------------- */

function renderPrintOptions() {
  const catSelect = document.getElementById('pr_category');
  const current = catSelect.value;
  const cats = [...new Set(state.products.map(p => p.category).filter(Boolean))];
  catSelect.innerHTML = '<option value="">كل التصنيفات</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  catSelect.value = current;
  buildPrintPreview();
}

function buildPrintPreview() {
  const category = document.getElementById('pr_category').value;
  const showQty = document.getElementById('pr_showQty').checked;
  const showCost = document.getElementById('pr_showCost').checked;
  const showSell = document.getElementById('pr_showSell').checked;
  const currency = document.getElementById('pr_currency').value;
  const currencyLabel = currency === 'USD' ? 'دولار' : 'ل.س';
  const title = document.getElementById('pr_title').value || 'قائمة الأصناف';
  const rate = getCurrentRate();

  document.getElementById('pr_currencyWrap').style.display = (showCost || showSell) ? '' : 'none';

  document.getElementById('printTitle').textContent = title;
  document.getElementById('printDate').textContent = 'تاريخ: ' + todayStr();

  const thead = document.getElementById('printThead');
  const tbody = document.getElementById('printTbody');
  const products = state.products.filter(p => !category || p.category === category);

  // خانة سعر: فراغ قابل للتعبئة باليد إذا السعر غير محدد، أو إذا العملة ليرة ولا يوجد سعر صرف بعد
  function priceCell(usdVal, unit) {
    if (usdVal == null) return '<span class="fill-blank"></span>';
    let value;
    if (currency === 'USD') value = fmt(usdVal, 2);
    else if (rate) value = fmt(usdVal * rate, 0);
    else return '<span class="fill-blank"></span>';
    return value + ' / ' + (unit === 'kg' ? 'كغ' : 'حبة');
  }

  const headers = ['#', 'اسم الصنف', 'التصنيف'];
  if (showQty) headers.push('الكمية المتوفرة');
  if (showCost) headers.push(`رأس المال (${currencyLabel})`);
  if (showSell) headers.push(`سعر البيع (${currencyLabel})`);
  thead.innerHTML = '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';

  tbody.innerHTML = products.map((p, i) => {
    const cells = [String(i + 1), escapeHtml(p.name), escapeHtml(p.category || '—')];
    if (showQty) cells.push(stockDisplay(p));
    if (showCost) cells.push(priceCell(p.purchasePriceUSD, p.unit));
    if (showSell) cells.push(priceCell(p.sellPriceUSD, p.unit));
    return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
  }).join('');
}

/* ---------------- Wholesale (المبيع بالجملة) ---------------- */

let wsDraftItems = [];
let currentRepId = null;
let editingRepId = null;
let currentShopId = null;
let editingShopId = null;
let viewingInvoiceId = null;

function repById(id) { return state.reps.find(r => r.id === id); }
function shopById(id) { return state.shops.find(s => s.id === id); }
function inDateRange(d, from, to) { return (!from || d >= from) && (!to || d <= to); }

// يحوّل مبلغ مدخل (ليرة أو دولار) إلى دولار حسب سعر صرف اليوم
function toUSD(amount, currency) {
  if (currency === 'USD') return amount;
  const rate = getCurrentRate();
  return rate ? amount / rate : null;
}
// مبلغ بالدولار مع ما يعادله بالليرة (حسب سعر اليوم أو سعر محدد)
function usdWithSYP(usd, rate) {
  rate = rate === undefined ? getCurrentRate() : rate;
  return `${fmt(usd, 2)} $` + (rate ? ` <small class="muted">(${fmt(usd * rate)} ل.س)</small>` : '');
}
function paymentLabel(p) {
  if (p.origCurrency === 'SYP') return `${fmt(p.origAmount)} ل.س <small class="muted">(= ${fmt(p.amountUSD, 2)} $)</small>`;
  return `${fmt(p.amountUSD, 2)} $`;
}
function makePayment(amount, currency, note) {
  const amountUSD = toUSD(amount, currency);
  if (amountUSD == null) return null;
  return { id: uid(), date: todayStr(), time: timeStr(), amountUSD, origAmount: amount, origCurrency: currency, rateUsed: getCurrentRate(), note: note || '' };
}
function qtyDisplay(unit, qtyBase, unitsPerCarton) {
  if (unit === 'kg') return fmt(qtyBase / 1000, 3).replace(/\.?0+$/, '') + ' كغ';
  return stockDisplay({ unit, stock: qtyBase, unitsPerCarton });
}

function populateSimpleSelect(selectEl, items, emptyLabel, labelFn) {
  const current = selectEl.value;
  selectEl.innerHTML = '';
  if (emptyLabel != null) selectEl.appendChild(el(`<option value="">${emptyLabel}</option>`));
  items.forEach(x => selectEl.appendChild(el(`<option value="${x.id}">${escapeHtml(labelFn ? labelFn(x) : x.name)}</option>`)));
  if ([...selectEl.options].some(o => o.value === current)) selectEl.value = current;
}

/* ----- حسابات المندوبين والمحلات ----- */

function repInvoices(repId) { return state.wholesaleInvoices.filter(i => i.repId === repId); }
function repTotals(rep) {
  const invs = repInvoices(rep.id);
  const sales = sum(invs, 'totalUSD');
  const commission = sum(invs, 'commissionUSD');
  const paid = sum(rep.payments, 'amountUSD');
  return { sales, commission, paid, due: commission - paid };
}
function shopTotals(shop) {
  const invs = state.wholesaleInvoices.filter(i => i.shopId === shop.id);
  const purchases = sum(invs, 'totalUSD');
  const paid = sum(invs, 'paidUSD') + sum(shop.payments, 'amountUSD');
  return { purchases, paid, balance: purchases - paid };
}

/* ----- المندوبين ----- */

function renderReps() {
  const tbody = document.getElementById('repsTbody');
  tbody.innerHTML = '';
  if (!state.reps.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">لا يوجد مندوبين بعد — أضف أول مندوب من النموذج</td></tr>';
  }
  state.reps.forEach(r => {
    const t = repTotals(r);
    tbody.appendChild(el(`
      <tr>
        <td><button class="link-btn open-rep-btn" data-id="${r.id}">${escapeHtml(r.name)}</button></td>
        <td>${escapeHtml(r.phone || '—')}</td>
        <td>${fmt(r.commissionPct, 2).replace(/\.?0+$/, '')}%</td>
        <td>${fmt(t.sales, 2)}</td>
        <td>${fmt(t.due, 2)}</td>
        <td>
          <button class="link-btn open-rep-btn" data-id="${r.id}">الدفتر</button>
          <button class="link-btn edit-rep-btn" data-id="${r.id}">تعديل</button>
          <button class="link-btn del-rep-btn" data-id="${r.id}">حذف</button>
        </td>
      </tr>
    `));
  });
  tbody.querySelectorAll('.open-rep-btn').forEach(b => b.addEventListener('click', () => openRepLedger(b.dataset.id)));
  tbody.querySelectorAll('.edit-rep-btn').forEach(b => b.addEventListener('click', () => startEditRep(b.dataset.id)));
  tbody.querySelectorAll('.del-rep-btn').forEach(b => b.addEventListener('click', () => {
    if (!confirm('حذف هذا المندوب؟ (فواتيره القديمة بتضل محفوظة باسمه)')) return;
    state.reps = state.reps.filter(x => x.id !== b.dataset.id);
    if (currentRepId === b.dataset.id) currentRepId = null;
    if (editingRepId === b.dataset.id) cancelEditRep();
    save();
  }));
  renderRepLedger();
}

function startEditRep(id) {
  const r = repById(id);
  if (!r) return;
  editingRepId = id;
  document.getElementById('rep_name').value = r.name;
  document.getElementById('rep_phone').value = r.phone || '';
  document.getElementById('rep_pct').value = r.commissionPct || '';
  document.getElementById('rep_notes').value = r.notes || '';
  document.getElementById('rep_formTitle').textContent = 'تعديل المندوب: ' + r.name;
  document.getElementById('rep_submitBtn').textContent = 'حفظ التعديلات';
  document.getElementById('rep_cancelEditBtn').classList.remove('hidden');
  document.getElementById('repForm').scrollIntoView({ behavior: 'smooth' });
}
function cancelEditRep() {
  editingRepId = null;
  document.getElementById('repForm').reset();
  document.getElementById('rep_formTitle').textContent = 'إضافة مندوب';
  document.getElementById('rep_submitBtn').textContent = 'إضافة المندوب';
  document.getElementById('rep_cancelEditBtn').classList.add('hidden');
}

function openRepLedger(id) {
  currentRepId = id;
  renderRepLedger();
  document.getElementById('repLedgerCard').scrollIntoView({ behavior: 'smooth' });
}

function renderRepLedger() {
  const card = document.getElementById('repLedgerCard');
  const rep = repById(currentRepId);
  if (!rep) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  document.getElementById('repLedgerTitle').textContent = 'دفتر المندوب: ' + rep.name;

  const from = document.getElementById('rl_from').value;
  const to = document.getElementById('rl_to').value;
  const invs = repInvoices(rep.id).filter(i => inDateRange(i.date, from, to))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const pays = rep.payments.filter(p => inDateRange(p.date, from, to))
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const sales = sum(invs, 'totalUSD');
  const commission = sum(invs, 'commissionUSD');
  const paid = sum(pays, 'amountUSD');
  const allTime = repTotals(rep);

  // ملخص الكميات يلي باعها من كل صنف
  const byProduct = {};
  invs.forEach(inv => inv.items.forEach(it => {
    const key = it.productId || it.name;
    byProduct[key] = byProduct[key] || { name: it.name, unit: it.unit, unitsPerCarton: it.unitsPerCarton, qtyBase: 0, totalUSD: 0 };
    byProduct[key].qtyBase += it.qtyBase;
    byProduct[key].totalUSD += it.totalUSD;
  }));
  const productRows = Object.values(byProduct).sort((a, b) => b.totalUSD - a.totalUSD);

  const periodLabel = (from || to) ? `الفترة: ${from || 'البداية'} ← ${to || 'اليوم'}` : 'كل الفترات';

  document.getElementById('repLedgerPrint').innerHTML = `
    <div class="doc-header">
      <h2>دفتر المندوب: ${escapeHtml(rep.name)}</h2>
      <div>${rep.phone ? 'هاتف: ' + escapeHtml(rep.phone) + ' — ' : ''}النسبة: ${fmt(rep.commissionPct, 2).replace(/\.?0+$/, '')}% — ${periodLabel} — تاريخ الطباعة: ${todayStr()}</div>
    </div>
    <div class="stat-grid four">
      <div class="stat-box"><div class="stat-label">مبيعاته بالفترة</div><div class="stat-value">${fmt(sales, 2)} $</div></div>
      <div class="stat-box profit"><div class="stat-label">عمولته بالفترة</div><div class="stat-value">${fmt(commission, 2)} $</div></div>
      <div class="stat-box"><div class="stat-label">قبض بالفترة</div><div class="stat-value">${fmt(paid, 2)} $</div></div>
      <div class="stat-box debt"><div class="stat-label">الباقي له (كل الفترات)</div><div class="stat-value">${fmt(allTime.due, 2)} $</div></div>
    </div>

    <h3>الفواتير (${invs.length})</h3>
    <table>
      <thead><tr><th>التاريخ</th><th>رقم الفاتورة</th><th>المحل</th><th>قيمة الفاتورة $</th><th>النسبة</th><th>العمولة $</th></tr></thead>
      <tbody>${invs.length ? invs.map(i => `
        <tr><td>${i.date}</td><td>${i.number}</td><td>${escapeHtml(i.shopName)}</td><td>${fmt(i.totalUSD, 2)}</td>
        <td>${fmt(i.commissionPct, 2).replace(/\.?0+$/, '')}%</td><td>${fmt(i.commissionUSD, 2)}</td></tr>`).join('')
        : '<tr><td colspan="6" class="empty-cell">لا توجد فواتير بهذه الفترة</td></tr>'}</tbody>
      <tfoot><tr><th colspan="3">المجموع</th><th>${fmt(sales, 2)}</th><th></th><th>${fmt(commission, 2)}</th></tr></tfoot>
    </table>

    <h3>الأصناف يلي باعها</h3>
    <table>
      <thead><tr><th>الصنف</th><th>الكمية</th><th>القيمة $</th></tr></thead>
      <tbody>${productRows.length ? productRows.map(p => `
        <tr><td>${escapeHtml(p.name)}</td><td>${qtyDisplay(p.unit, p.qtyBase, p.unitsPerCarton)}</td><td>${fmt(p.totalUSD, 2)}</td></tr>`).join('')
        : '<tr><td colspan="3" class="empty-cell">—</td></tr>'}</tbody>
    </table>

    <h3>دفعات العمولة يلي قبضها</h3>
    <table>
      <thead><tr><th>التاريخ</th><th>المبلغ</th><th>ملاحظة</th><th class="no-print"></th></tr></thead>
      <tbody>${pays.length ? pays.map(p => `
        <tr><td>${p.date}</td><td>${paymentLabel(p)}</td><td>${escapeHtml(p.note || '—')}</td>
        <td class="no-print"><button class="link-btn del-rep-pay-btn" data-id="${p.id}">حذف</button></td></tr>`).join('')
        : '<tr><td colspan="4" class="empty-cell">لا توجد دفعات بهذه الفترة</td></tr>'}</tbody>
    </table>
  `;
  document.querySelectorAll('#repLedgerPrint .del-rep-pay-btn').forEach(b => b.addEventListener('click', () => {
    if (!confirm('حذف هذه الدفعة؟')) return;
    rep.payments = rep.payments.filter(p => p.id !== b.dataset.id);
    save();
  }));
}

/* ----- المحلات ----- */

function renderShops() {
  const tbody = document.getElementById('shopsTbody');
  const q = (document.getElementById('shopSearch').value || '').trim().toLowerCase();
  tbody.innerHTML = '';
  let totalDebt = 0;
  const list = state.shops.filter(s => !q || s.name.toLowerCase().includes(q) || (s.owner || '').toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q));
  if (!state.shops.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">لا يوجد محلات بعد — أضف أول محل من النموذج</td></tr>';
  }
  list.forEach(s => {
    const t = shopTotals(s);
    totalDebt += t.balance;
    const rep = repById(s.repId);
    tbody.appendChild(el(`
      <tr>
        <td><button class="link-btn open-shop-btn" data-id="${s.id}">${escapeHtml(s.name)}</button>${s.address ? `<br><small class="muted">${escapeHtml(s.address)}</small>` : ''}</td>
        <td>${escapeHtml(s.phone || '—')}</td>
        <td>${rep ? escapeHtml(rep.name) : '—'}</td>
        <td>${fmt(t.purchases, 2)}</td>
        <td class="${t.balance > 0.005 ? 'neg' : ''}">${fmt(t.balance, 2)}</td>
        <td>
          <button class="link-btn open-shop-btn" data-id="${s.id}">الدفتر</button>
          <button class="link-btn new-inv-shop-btn" data-id="${s.id}">فاتورة</button>
          <button class="link-btn edit-shop-btn" data-id="${s.id}">تعديل</button>
          <button class="link-btn del-shop-btn" data-id="${s.id}">حذف</button>
        </td>
      </tr>
    `));
  });
  document.getElementById('shopsTotals').innerHTML = `<span>إجمالي الديون على المحلات: ${usdWithSYP(totalDebt)}</span>`;

  tbody.querySelectorAll('.open-shop-btn').forEach(b => b.addEventListener('click', () => openShopLedger(b.dataset.id)));
  tbody.querySelectorAll('.edit-shop-btn').forEach(b => b.addEventListener('click', () => startEditShop(b.dataset.id)));
  tbody.querySelectorAll('.new-inv-shop-btn').forEach(b => b.addEventListener('click', () => {
    const shop = shopById(b.dataset.id);
    document.getElementById('wi_shop').value = shop.id;
    if (shop.repId && repById(shop.repId)) document.getElementById('wi_rep').value = shop.repId;
    showWsSub('ws-invoice');
  }));
  tbody.querySelectorAll('.del-shop-btn').forEach(b => b.addEventListener('click', () => {
    if (!confirm('حذف هذا المحل ودفعاته؟ (الفواتير القديمة بتضل محفوظة بقائمة الفواتير)')) return;
    state.shops = state.shops.filter(x => x.id !== b.dataset.id);
    if (currentShopId === b.dataset.id) currentShopId = null;
    if (editingShopId === b.dataset.id) cancelEditShop();
    save();
  }));
  renderShopLedger();
}

function startEditShop(id) {
  const s = shopById(id);
  if (!s) return;
  editingShopId = id;
  document.getElementById('shop_name').value = s.name;
  document.getElementById('shop_owner').value = s.owner || '';
  document.getElementById('shop_phone').value = s.phone || '';
  document.getElementById('shop_address').value = s.address || '';
  document.getElementById('shop_rep').value = s.repId || '';
  document.getElementById('shop_formTitle').textContent = 'تعديل المحل: ' + s.name;
  document.getElementById('shop_submitBtn').textContent = 'حفظ التعديلات';
  document.getElementById('shop_cancelEditBtn').classList.remove('hidden');
  document.getElementById('shopForm').scrollIntoView({ behavior: 'smooth' });
}
function cancelEditShop() {
  editingShopId = null;
  document.getElementById('shopForm').reset();
  document.getElementById('shop_formTitle').textContent = 'إضافة محل';
  document.getElementById('shop_submitBtn').textContent = 'إضافة المحل';
  document.getElementById('shop_cancelEditBtn').classList.add('hidden');
}

function openShopLedger(id) {
  currentShopId = id;
  renderShopLedger();
  document.getElementById('shopLedgerCard').scrollIntoView({ behavior: 'smooth' });
}

function renderShopLedger() {
  const card = document.getElementById('shopLedgerCard');
  const shop = shopById(currentShopId);
  if (!shop) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  document.getElementById('shopLedgerTitle').textContent = 'دفتر المحل: ' + shop.name;

  // كل الحركات بالترتيب الزمني: فواتير (عليه) ودفعات (له) مع الرصيد التراكمي
  const rows = [];
  state.wholesaleInvoices.filter(i => i.shopId === shop.id).forEach(i => {
    rows.push({ sortKey: i.date + i.time + '0', date: i.date, kind: 'invoice', inv: i, debit: i.totalUSD, credit: i.paidUSD || 0 });
  });
  shop.payments.forEach(p => {
    rows.push({ sortKey: p.date + (p.time || '') + '1', date: p.date, kind: 'payment', pay: p, debit: 0, credit: p.amountUSD });
  });
  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  let running = 0;
  const t = shopTotals(shop);

  const bodyHtml = rows.length ? rows.map(r => {
    running += r.debit - r.credit;
    if (r.kind === 'invoice') {
      const i = r.inv;
      return `<tr>
        <td>${r.date}</td>
        <td>فاتورة رقم <button class="link-btn view-inv-btn" data-id="${i.id}">${i.number}</button>${i.repName ? ` <small class="muted">(${escapeHtml(i.repName)})</small>` : ''}
          <div class="small-items">${i.items.map(it => `${escapeHtml(it.name)} × ${qtyDisplay(it.unit, it.qtyBase, it.unitsPerCarton)}`).join('، ')}</div></td>
        <td>${fmt(r.debit, 2)}</td><td>${r.credit ? fmt(r.credit, 2) : '—'}</td><td>${fmt(running, 2)}</td>
        <td class="no-print"></td>
      </tr>`;
    }
    const p = r.pay;
    return `<tr>
      <td>${r.date}</td><td>دفعة: ${paymentLabel(p)}${p.note ? ' — ' + escapeHtml(p.note) : ''}</td>
      <td>—</td><td>${fmt(r.credit, 2)}</td><td>${fmt(running, 2)}</td>
      <td class="no-print"><button class="link-btn del-shop-pay-btn" data-id="${p.id}">حذف</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-cell">لا توجد حركات بعد</td></tr>';

  document.getElementById('shopLedgerPrint').innerHTML = `
    <div class="doc-header">
      <h2>كشف حساب: ${escapeHtml(shop.name)}</h2>
      <div>${[shop.owner && 'صاحب المحل: ' + escapeHtml(shop.owner), shop.phone && 'هاتف: ' + escapeHtml(shop.phone), shop.address && 'العنوان: ' + escapeHtml(shop.address)].filter(Boolean).join(' — ')}</div>
      <div>تاريخ الكشف: ${todayStr()}</div>
    </div>
    <div class="stat-grid small">
      <div class="stat-box"><div class="stat-label">إجمالي المشتريات $</div><div class="stat-value">${fmt(t.purchases, 2)}</div></div>
      <div class="stat-box"><div class="stat-label">إجمالي المدفوع $</div><div class="stat-value">${fmt(t.paid, 2)}</div></div>
      <div class="stat-box debt"><div class="stat-label">الباقي عليه</div><div class="stat-value">${fmt(t.balance, 2)} $</div>${getCurrentRate() ? `<div class="stat-label">≈ ${fmt(t.balance * getCurrentRate())} ل.س</div>` : ''}</div>
    </div>
    <table>
      <thead><tr><th>التاريخ</th><th>البيان</th><th>عليه $</th><th>دفع $</th><th>الرصيد $</th><th class="no-print"></th></tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  `;
  document.querySelectorAll('#shopLedgerPrint .view-inv-btn').forEach(b => b.addEventListener('click', () => openInvoiceView(b.dataset.id)));
  document.querySelectorAll('#shopLedgerPrint .del-shop-pay-btn').forEach(b => b.addEventListener('click', () => {
    if (!confirm('حذف هذه الدفعة؟')) return;
    shop.payments = shop.payments.filter(p => p.id !== b.dataset.id);
    save();
  }));
}

/* ----- فاتورة جديدة ----- */

function renderInvoiceForm() {
  const shopSel = document.getElementById('wi_shop');
  const repSel = document.getElementById('wi_rep');
  populateSimpleSelect(shopSel, state.shops, '— اختر المحل —', s => s.name + (s.address ? ` (${s.address})` : ''));
  populateSimpleSelect(repSel, state.reps, '— بدون مندوب (بيع مباشر) —', r => `${r.name} (${fmt(r.commissionPct, 2).replace(/\.?0+$/, '')}%)`);
  if (!document.getElementById('wi_date').value) document.getElementById('wi_date').value = todayStr();
  document.getElementById('wi_numberLabel').textContent = `— رقم ${state.meta.nextInvoiceNo || 1}`;
  document.getElementById('wi_noShopsHint').textContent = state.shops.length ? '' : 'ما في محلات مضافة بعد — روح على تبويب "المحلات" وضيف المحل أول.';

  populateSearchableProductSelect(document.getElementById('wi_product'), document.getElementById('wi_search').value, isWholesaleProduct);
  updateInvoiceAdderForProduct(false);
  renderInvoiceDraft();
}

function updateInvoiceAdderForProduct(resetPrice) {
  const product = state.products.find(p => p.id === document.getElementById('wi_product').value);
  const unitSel = document.getElementById('wi_qtyUnit');
  const infoEl = document.getElementById('wi_productInfo');
  const currentUnit = unitSel.value;
  unitSel.innerHTML = '';
  if (!product) {
    infoEl.className = 'product-info';
    document.getElementById('wi_priceUnitLabel').textContent = '';
    return;
  }
  const opts = product.unit === 'kg'
    ? [['kg', 'كغ'], ['g', 'غرام']]
    : [['piece', 'حبة']].concat(product.unitsPerCarton ? [['carton', `كرتونة (${product.unitsPerCarton} حبة)`]] : []);
  opts.forEach(([v, l]) => unitSel.appendChild(el(`<option value="${v}">${l}</option>`)));
  if (opts.some(o => o[0] === currentUnit)) unitSel.value = currentUnit;
  else if (product.unitsPerCarton) unitSel.value = 'carton';

  document.getElementById('wi_priceUnitLabel').textContent = '(' + unitPriceLabel(product.unit) + ')';
  const priceInput = document.getElementById('wi_price');
  if (resetPrice) priceInput.value = product.wholesalePriceUSD ?? '';

  infoEl.className = 'product-info visible';
  infoEl.innerHTML = `المتوفر: <b>${stockDisplay(product)}</b> — سعر الجملة: ` +
    (product.wholesalePriceUSD != null ? `<b>${usdWithSYP(product.wholesalePriceUSD)} ${unitPriceLabel(product.unit)}</b>` : '<span class="warn">لم يُحدد بعد (حدده من تبويب أسعار الجملة أو اكتبه هون)</span>') +
    ` — رأس المال: ${fmt(product.purchasePriceUSD, 2)} $`;
}

function draftQtyBase(productId) {
  return wsDraftItems.filter(i => i.productId === productId).reduce((a, i) => a + i.qtyBase, 0);
}

function addInvoiceDraftItem() {
  const product = state.products.find(p => p.id === document.getElementById('wi_product').value);
  if (!product) { alert('اختر منتجاً'); return; }
  const qty = parseFloat(document.getElementById('wi_qty').value);
  if (!qty || qty <= 0) { alert('أدخل الكمية'); return; }
  const priceVal = document.getElementById('wi_price').value;
  if (priceVal === '') { alert('أدخل سعر الجملة'); return; }
  const unitPriceUSD = parseFloat(priceVal);
  if (isNaN(unitPriceUSD) || unitPriceUSD < 0) { alert('سعر غير صالح'); return; }

  const qtyUnit = document.getElementById('wi_qtyUnit').value;
  let qtyBase;
  if (qtyUnit === 'kg') qtyBase = qty * 1000;
  else if (qtyUnit === 'g') qtyBase = qty;
  else if (qtyUnit === 'carton') qtyBase = qty * product.unitsPerCarton;
  else qtyBase = qty;

  if (draftQtyBase(product.id) + qtyBase > product.stock + 1e-9) {
    alert(`الكمية المتوفرة غير كافية (المتوفر: ${stockDisplay(product)})`);
    return;
  }

  const existing = wsDraftItems.find(i => i.productId === product.id && i.unitPriceUSD === unitPriceUSD);
  if (existing) {
    existing.qtyBase += qtyBase;
  } else {
    wsDraftItems.push({
      productId: product.id, name: product.name, unit: product.unit, unitsPerCarton: product.unitsPerCarton || null,
      qtyBase, unitPriceUSD, purchasePriceUSD: product.purchasePriceUSD
    });
  }
  document.getElementById('wi_qty').value = '';
  document.getElementById('wi_search').value = '';
  renderInvoiceForm();
  document.getElementById('wi_search').focus();
}

function draftItemTotal(it) { return (it.qtyBase / baseUnitFactor(it.unit)) * it.unitPriceUSD; }

function renderInvoiceDraft() {
  const tbody = document.getElementById('wi_itemsTbody');
  tbody.innerHTML = '';
  if (!wsDraftItems.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">ما في أصناف بالفاتورة بعد</td></tr>';
  }
  wsDraftItems.forEach((it, idx) => {
    tbody.appendChild(el(`
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(it.name)}</td>
        <td>${qtyDisplay(it.unit, it.qtyBase, it.unitsPerCarton)}</td>
        <td>${fmt(it.unitPriceUSD, 2)} ${unitPriceLabel(it.unit)}</td>
        <td>${fmt(draftItemTotal(it), 2)}</td>
        <td><button class="link-btn del-draft-btn" data-idx="${idx}">حذف</button></td>
      </tr>
    `));
  });
  tbody.querySelectorAll('.del-draft-btn').forEach(b => b.addEventListener('click', () => {
    wsDraftItems.splice(Number(b.dataset.idx), 1);
    renderInvoiceDraft();
  }));

  const total = wsDraftItems.reduce((a, it) => a + draftItemTotal(it), 0);
  const rate = getRateForDate(document.getElementById('wi_date').value || todayStr());
  const rep = repById(document.getElementById('wi_rep').value);
  const commission = rep ? total * (rep.commissionPct || 0) / 100 : 0;
  const cost = wsDraftItems.reduce((a, it) => a + (it.qtyBase / baseUnitFactor(it.unit)) * it.purchasePriceUSD, 0);
  document.getElementById('wi_summary').innerHTML = wsDraftItems.length ? `
    <span>المجموع: <b>${usdWithSYP(total, rate)}</b></span>
    ${rep ? `<span>عمولة ${escapeHtml(rep.name)} (${fmt(rep.commissionPct, 2).replace(/\.?0+$/, '')}%): <b>${fmt(commission, 2)} $</b></span>` : ''}
    <span>ربحك الصافي: <b class="${total - cost - commission < 0 ? 'neg' : 'pos'}">${fmt(total - cost - commission, 2)} $</b></span>
  ` : '';
}

function clearInvoiceForm() {
  wsDraftItems = [];
  ['wi_note', 'wi_qty', 'wi_price', 'wi_search', 'wi_paidAmount'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('wi_paymentMethod').value = 'credit';
  document.getElementById('wi_paidWrap').classList.add('hidden');
  document.getElementById('wi_date').value = todayStr();
  document.getElementById('wi_shop').value = '';
  document.getElementById('wi_rep').value = '';
  renderInvoiceForm();
}

function saveInvoice(andPrint) {
  const shop = shopById(document.getElementById('wi_shop').value);
  if (!shop) { alert('اختر المحل'); return; }
  if (!wsDraftItems.length) { alert('أضف صنف واحد على الأقل'); return; }

  // تأكد مرة ثانية من توفر الكميات (ممكن يكون صار بيع مفرق بنفس الوقت)
  for (const it of wsDraftItems) {
    const product = state.products.find(p => p.id === it.productId);
    if (!product) { alert(`المنتج "${it.name}" لم يعد موجوداً`); return; }
    if (draftQtyBase(it.productId) > product.stock + 1e-9) { alert(`الكمية المتوفرة من "${it.name}" غير كافية (المتوفر: ${stockDisplay(product)})`); return; }
  }

  const date = document.getElementById('wi_date').value || todayStr();
  const rate = getRateForDate(date);
  const rep = repById(document.getElementById('wi_rep').value);
  const items = wsDraftItems.map(it => {
    const units = it.qtyBase / baseUnitFactor(it.unit);
    return { ...it, totalUSD: units * it.unitPriceUSD, costUSD: units * it.purchasePriceUSD };
  });
  const totalUSD = sum(items, 'totalUSD');
  const costUSD = sum(items, 'costUSD');
  const commissionPct = rep ? (rep.commissionPct || 0) : 0;
  const commissionUSD = totalUSD * commissionPct / 100;

  const method = document.getElementById('wi_paymentMethod').value;
  let paidUSD = 0;
  if (method === 'cash') paidUSD = totalUSD;
  else if (method === 'partial') {
    const amount = parseFloat(document.getElementById('wi_paidAmount').value) || 0;
    const currency = document.getElementById('wi_paidCurrency').value;
    paidUSD = currency === 'USD' ? amount : (rate ? amount / rate : null);
    if (paidUSD == null) { alert('لا يوجد سعر صرف لتحويل المبلغ من الليرة. أدخل سعر الصرف من لوحة التحكم أو اكتب المبلغ بالدولار.'); return; }
  }

  const number = state.meta.nextInvoiceNo || 1;
  state.meta.nextInvoiceNo = number + 1;
  const invoice = {
    id: uid(), number, date, time: timeStr(),
    shopId: shop.id, shopName: shop.name,
    repId: rep ? rep.id : null, repName: rep ? rep.name : '',
    items, totalUSD, costUSD, commissionPct, commissionUSD,
    profitUSD: totalUSD - costUSD - commissionUSD,
    paymentMethod: method, paidUSD, rate,
    note: document.getElementById('wi_note').value.trim()
  };
  state.wholesaleInvoices.push(invoice);
  items.forEach(it => {
    const product = state.products.find(p => p.id === it.productId);
    if (product) product.stock -= it.qtyBase;
  });

  clearInvoiceForm();
  save();
  if (andPrint) {
    openInvoiceView(invoice.id);
    printElement(document.getElementById('wv_printArea'));
  } else {
    alert(`تم حفظ الفاتورة رقم ${number}`);
  }
}

/* ----- قائمة الفواتير + عرض/طباعة فاتورة ----- */

function renderInvoiceList() {
  populateSimpleSelect(document.getElementById('wl_rep'), state.reps, 'كل المندوبين');
  const q = (document.getElementById('wl_search').value || '').trim().toLowerCase();
  const repId = document.getElementById('wl_rep').value;
  const from = document.getElementById('wl_from').value;
  const to = document.getElementById('wl_to').value;
  const list = state.wholesaleInvoices
    .filter(i => inDateRange(i.date, from, to))
    .filter(i => !repId || i.repId === repId)
    .filter(i => !q || String(i.number) === q || i.shopName.toLowerCase().includes(q) || (i.repName || '').toLowerCase().includes(q))
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time) || b.number - a.number);

  const tbody = document.getElementById('wl_tbody');
  tbody.innerHTML = list.length ? list.map(i => `
    <tr>
      <td>${i.number}</td><td>${i.date}</td><td>${escapeHtml(i.shopName)}</td><td>${escapeHtml(i.repName || '—')}</td>
      <td>${fmt(i.totalUSD, 2)}</td><td>${i.rate ? fmt(i.totalUSD * i.rate) : '—'}</td>
      <td>${fmt(i.paidUSD, 2)}</td><td>${fmt(i.commissionUSD, 2)}</td><td>${fmt(i.profitUSD, 2)}</td>
      <td>
        <button class="link-btn view-inv-btn" data-id="${i.id}">عرض/طباعة</button>
        <button class="link-btn del-inv-btn" data-id="${i.id}">حذف</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="10" class="empty-cell">لا توجد فواتير</td></tr>';

  tbody.querySelectorAll('.view-inv-btn').forEach(b => b.addEventListener('click', () => openInvoiceView(b.dataset.id)));
  tbody.querySelectorAll('.del-inv-btn').forEach(b => b.addEventListener('click', () => deleteInvoice(b.dataset.id)));

  document.getElementById('wl_totals').innerHTML = list.length ? `
    <span>عدد الفواتير: ${list.length}</span>
    <span>المجموع: ${fmt(sum(list, 'totalUSD'), 2)} $</span>
    <span>العمولات: ${fmt(sum(list, 'commissionUSD'), 2)} $</span>
    <span>الربح الصافي: ${fmt(sum(list, 'profitUSD'), 2)} $</span>` : '';

  renderInvoiceView();
}

function deleteInvoice(id) {
  const inv = state.wholesaleInvoices.find(i => i.id === id);
  if (!inv) return;
  if (!confirm(`حذف الفاتورة رقم ${inv.number}؟ سيتم إرجاع الكميات إلى المخزون وإلغاؤها من دفتر المحل والمندوب.`)) return;
  inv.items.forEach(it => {
    const product = state.products.find(p => p.id === it.productId);
    if (product) product.stock += it.qtyBase;
  });
  state.wholesaleInvoices = state.wholesaleInvoices.filter(i => i.id !== id);
  if (viewingInvoiceId === id) viewingInvoiceId = null;
  save();
}

function openInvoiceView(id) {
  viewingInvoiceId = id;
  showWsSub('ws-invoices');
  renderInvoiceView();
  document.getElementById('wv_card').scrollIntoView({ behavior: 'smooth' });
}

function renderInvoiceView() {
  const card = document.getElementById('wv_card');
  const inv = state.wholesaleInvoices.find(i => i.id === viewingInvoiceId);
  if (!inv) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const useSYP = document.getElementById('wv_currency').value === 'SYP' && inv.rate;
  const cur = useSYP ? 'ل.س' : '$';
  const money = usd => useSYP ? fmt(usd * inv.rate) : fmt(usd, 2);
  const shop = shopById(inv.shopId);
  const remaining = inv.totalUSD - (inv.paidUSD || 0);

  document.getElementById('wv_printArea').innerHTML = `
    <div class="doc-header">
      <h2>فاتورة مبيع جملة</h2>
      <div class="doc-meta-row"><span>رقم الفاتورة: <b>${inv.number}</b></span><span>التاريخ: <b>${inv.date}</b></span></div>
      <div class="doc-meta-row">
        <span>السادة: <b>${escapeHtml(inv.shopName)}</b>${shop && shop.phone ? ' — ' + escapeHtml(shop.phone) : ''}${shop && shop.address ? ' — ' + escapeHtml(shop.address) : ''}</span>
        ${inv.repName ? `<span>المندوب: <b>${escapeHtml(inv.repName)}</b></span>` : ''}
      </div>
    </div>
    <table>
      <thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر (${cur})</th><th>المجموع (${cur})</th></tr></thead>
      <tbody>${inv.items.map((it, idx) => `
        <tr><td>${idx + 1}</td><td>${escapeHtml(it.name)}</td><td>${qtyDisplay(it.unit, it.qtyBase, it.unitsPerCarton)}</td>
        <td>${money(it.unitPriceUSD)} ${unitPriceLabel(it.unit)}</td><td>${money(it.totalUSD)}</td></tr>`).join('')}</tbody>
      <tfoot>
        <tr><th colspan="4">المجموع</th><th>${money(inv.totalUSD)} ${cur}</th></tr>
        <tr><th colspan="4">المدفوع</th><th>${money(inv.paidUSD || 0)} ${cur}</th></tr>
        <tr><th colspan="4">الباقي</th><th>${money(remaining)} ${cur}</th></tr>
      </tfoot>
    </table>
    ${inv.note ? `<p>ملاحظة: ${escapeHtml(inv.note)}</p>` : ''}
    ${useSYP ? `<p class="muted"><small>سعر الصرف المعتمد: ${fmt(inv.rate)} ل.س / دولار</small></p>` : ''}
    <div class="signatures"><span>توقيع المستلم: ..................</span><span>توقيع المندوب: ..................</span></div>
  `;
}

/* ----- أسعار الجملة + نشرة الأسعار ----- */

// الصنف المحذوف من الجملة بيضل موجود بالمفرق والمخزون، بس ما بيطلع بالنشرة ولا بفواتير الجملة
function isWholesaleProduct(p) { return !p.wholesaleHidden; }

function setWholesaleHidden(id, hidden) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  if (hidden && !confirm(`حذف "${p.name}" من قائمة الجملة؟ (بيضل موجود بالمفرق والمخزون، وفيك ترجعه بأي وقت)`)) return;
  p.wholesaleHidden = hidden;
  save();
}

function renderWholesalePrices() {
  const tbody = document.getElementById('wp_tbody');
  const q = document.getElementById('wp_search').value;
  const rate = getCurrentRate();
  tbody.innerHTML = '';
  state.products.filter(p => isWholesaleProduct(p) && productMatches(p, q)).forEach(p => {
    const row = el(`
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.category || '—')}</td>
        <td>${unitPriceLabel(p.unit)}</td>
        <td>${fmt(p.purchasePriceUSD, 2)}</td>
        <td>${p.sellPriceUSD != null ? fmt(p.sellPriceUSD, 2) : '—'}</td>
        <td><input type="number" class="inline-edit ws-price-input" min="0" step="any" value="${p.wholesalePriceUSD ?? ''}" placeholder="غير محدد" data-id="${p.id}"></td>
        <td class="ws-price-syp">${p.wholesalePriceUSD != null && rate ? fmt(p.wholesalePriceUSD * rate) : '—'}</td>
        <td><button class="link-btn ws-hide-btn" data-id="${p.id}">حذف من الجملة</button></td>
      </tr>
    `);
    tbody.appendChild(row);
  });
  tbody.querySelectorAll('.ws-hide-btn').forEach(b => b.addEventListener('click', () => setWholesaleHidden(b.dataset.id, true)));

  const hiddenList = state.products.filter(p => !isWholesaleProduct(p) && productMatches(p, q));
  document.getElementById('wp_hiddenWrap').classList.toggle('hidden', !hiddenList.length);
  const hiddenTbody = document.getElementById('wp_hiddenTbody');
  hiddenTbody.innerHTML = hiddenList.map(p => `
    <tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category || '—')}</td>
    <td><button class="link-btn ws-unhide-btn" data-id="${p.id}">إرجاع للجملة</button></td></tr>`).join('');
  hiddenTbody.querySelectorAll('.ws-unhide-btn').forEach(b => b.addEventListener('click', () => setWholesaleHidden(b.dataset.id, false)));
  tbody.querySelectorAll('.ws-price-input').forEach(input => {
    // حفظ فوري مع كل حرف، وتحديث خانة الليرة والمعاينة فقط (بدون إعادة رسم الجدول حتى يضل التنقل بـ Tab سلس)
    input.addEventListener('input', () => {
      const p = state.products.find(x => x.id === input.dataset.id);
      if (!p) return;
      p.wholesalePriceUSD = input.value === '' ? null : parseFloat(input.value);
      persist();
      input.closest('tr').querySelector('.ws-price-syp').textContent =
        (p.wholesalePriceUSD != null && rate) ? fmt(p.wholesalePriceUSD * rate) : '—';
      buildPriceListPreview();
    });
  });

  const catSel = document.getElementById('wpp_category');
  const curCat = catSel.value;
  const cats = [...new Set(state.products.filter(isWholesaleProduct).map(p => p.category).filter(Boolean))];
  catSel.innerHTML = '<option value="">كل التصنيفات</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  catSel.value = cats.includes(curCat) ? curCat : '';
  populateSimpleSelect(document.getElementById('wpp_rep'), state.reps, '— بدون —');
  buildPriceListPreview();
}

function buildPriceListPreview() {
  const category = document.getElementById('wpp_category').value;
  const currency = document.getElementById('wpp_currency').value;
  const showCarton = document.getElementById('wpp_showCarton').checked;
  const showRetail = document.getElementById('wpp_showRetail').checked;
  const onlyPriced = document.getElementById('wpp_onlyPriced').checked;
  const rep = repById(document.getElementById('wpp_rep').value);
  const title = document.getElementById('wpp_title').value || 'نشرة أسعار الجملة';
  const rate = getCurrentRate();
  // "BOTH" = كل سعر بينطبع بعمودين: ليرة ودولار
  const currencies = currency === 'BOTH' ? ['SYP', 'USD'] : [currency];
  const curLabel = c => c === 'USD' ? '$' : 'ل.س';

  const priceText = (usd, unitLabel, cur) => {
    if (usd == null) return '<span class="fill-blank"></span>';
    if (cur === 'USD') return fmt(usd, 2) + (unitLabel ? ' / ' + unitLabel : '');
    if (!rate) return '<span class="fill-blank"></span>';
    return fmt(usd * rate) + (unitLabel ? ' / ' + unitLabel : '');
  };
  const priceCells = (usd, unitLabel, suffix) => currencies.map(c => priceText(usd, unitLabel, c) + (suffix || ''));
  const priceHeaders = label => currencies.map(c => `${label} (${curLabel(c)})`);

  const products = state.products
    .filter(isWholesaleProduct)
    .filter(p => !category || p.category === category)
    .filter(p => !onlyPriced || p.wholesalePriceUSD != null)
    .slice()
    .sort((a, b) => (a.category || '').localeCompare(b.category || '', 'ar') || a.name.localeCompare(b.name, 'ar'));

  const headers = ['#', 'الصنف', ...priceHeaders('سعر الجملة')];
  if (showCarton) headers.push(...priceHeaders('سعر الكرتونة'));
  if (showRetail) headers.push(...priceHeaders('سعر المفرق المقترح'));

  let lastCat = null, n = 0;
  const rowsHtml = products.map(p => {
    let html = '';
    const cat = p.category || 'بدون تصنيف';
    if (!category && cat !== lastCat) {
      html += `<tr class="group-row"><td colspan="${headers.length}">${escapeHtml(cat)}</td></tr>`;
      lastCat = cat;
    }
    n++;
    const unitLabel = p.unit === 'kg' ? 'كغ' : 'حبة';
    const cells = [String(n), escapeHtml(p.name), ...priceCells(p.wholesalePriceUSD, unitLabel)];
    if (showCarton) {
      cells.push(...(p.unit === 'piece' && p.unitsPerCarton
        ? priceCells(p.wholesalePriceUSD != null ? p.wholesalePriceUSD * p.unitsPerCarton : null, '', ` <small>(${p.unitsPerCarton} حبة)</small>`)
        : currencies.map(() => '—')));
    }
    if (showRetail) cells.push(...priceCells(p.sellPriceUSD, unitLabel));
    return html + '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
  }).join('');

  document.getElementById('wpp_printArea').innerHTML = `
    <div class="doc-header">
      <h2>${escapeHtml(title)}</h2>
      <div class="doc-meta-row"><span>التاريخ: ${todayStr()}${currency === 'BOTH' && rate ? ` — سعر الصرف: ${fmt(rate)} ل.س / دولار` : ''}</span>${rep ? `<span>المندوب: <b>${escapeHtml(rep.name)}</b>${rep.phone ? ' — ' + escapeHtml(rep.phone) : ''}</span>` : ''}</div>
    </div>
    <table>
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="${headers.length}" class="empty-cell">لا توجد أصناف</td></tr>`}</tbody>
    </table>
  `;
}

/* ----- عام ----- */

function showWsSub(subId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'wholesale'));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-wholesale'));
  document.querySelectorAll('#wsTabs .subtab-btn').forEach(b => b.classList.toggle('active', b.dataset.sub === subId));
  document.querySelectorAll('#view-wholesale .subview').forEach(v => v.classList.toggle('active', v.id === subId));
}

function renderWholesale() {
  populateSimpleSelect(document.getElementById('shop_rep'), state.reps, '— بدون —');
  renderInvoiceForm();
  renderInvoiceList();
  renderReps();
  renderShops();
  renderWholesalePrices();
}

// يطبع عنصر واحد فقط من الصفحة (فاتورة، دفتر، نشرة أسعار...)
function printElement(node) {
  document.querySelectorAll('.print-active').forEach(n => n.classList.remove('print-active'));
  node.classList.add('print-active');
  window.print();
}

function setupWholesale() {
  document.querySelectorAll('#wsTabs .subtab-btn').forEach(btn => btn.addEventListener('click', () => showWsSub(btn.dataset.sub)));

  // فاتورة جديدة
  document.getElementById('wi_shop').addEventListener('change', () => {
    const shop = shopById(document.getElementById('wi_shop').value);
    if (shop && shop.repId && repById(shop.repId)) document.getElementById('wi_rep').value = shop.repId;
    renderInvoiceDraft();
  });
  document.getElementById('wi_rep').addEventListener('change', renderInvoiceDraft);
  document.getElementById('wi_date').addEventListener('change', renderInvoiceDraft);
  const wiSearch = document.getElementById('wi_search');
  wiSearch.addEventListener('input', () => {
    const sel = document.getElementById('wi_product');
    const before = sel.value;
    populateSearchableProductSelect(sel, wiSearch.value, isWholesaleProduct);
    updateInvoiceAdderForProduct(sel.value !== before);
  });
  wiSearch.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    document.getElementById('wi_qty').focus();
  });
  document.getElementById('wi_product').addEventListener('change', () => updateInvoiceAdderForProduct(true));
  ['wi_qty', 'wi_price'].forEach(id => document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addInvoiceDraftItem(); }
  }));
  document.getElementById('wi_addItemBtn').addEventListener('click', addInvoiceDraftItem);
  document.getElementById('wi_paymentMethod').addEventListener('change', (e) => {
    document.getElementById('wi_paidWrap').classList.toggle('hidden', e.target.value !== 'partial');
  });
  document.getElementById('wi_saveBtn').addEventListener('click', () => saveInvoice(false));
  document.getElementById('wi_savePrintBtn').addEventListener('click', () => saveInvoice(true));
  document.getElementById('wi_clearBtn').addEventListener('click', () => {
    if (wsDraftItems.length && !confirm('تفريغ الفاتورة الحالية؟')) return;
    clearInvoiceForm();
  });

  // قائمة الفواتير
  document.getElementById('wl_search').addEventListener('input', renderInvoiceList);
  ['wl_rep', 'wl_from', 'wl_to'].forEach(id => document.getElementById(id).addEventListener('change', renderInvoiceList));
  document.getElementById('wv_currency').addEventListener('change', renderInvoiceView);
  document.getElementById('wv_printBtn').addEventListener('click', () => printElement(document.getElementById('wv_printArea')));
  document.getElementById('wv_closeBtn').addEventListener('click', () => { viewingInvoiceId = null; renderInvoiceView(); });

  // المندوبين
  document.getElementById('repForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      name: document.getElementById('rep_name').value.trim(),
      phone: document.getElementById('rep_phone').value.trim(),
      commissionPct: parseFloat(document.getElementById('rep_pct').value) || 0,
      notes: document.getElementById('rep_notes').value.trim()
    };
    if (!data.name) return;
    if (editingRepId) {
      Object.assign(repById(editingRepId), data);
      cancelEditRep();
    } else {
      state.reps.push({ id: uid(), ...data, payments: [], createdAt: new Date().toISOString() });
      e.target.reset();
    }
    save();
  });
  document.getElementById('rep_cancelEditBtn').addEventListener('click', cancelEditRep);
  ['rl_from', 'rl_to'].forEach(id => document.getElementById(id).addEventListener('change', renderRepLedger));
  document.getElementById('rl_closeBtn').addEventListener('click', () => { currentRepId = null; renderRepLedger(); });
  document.getElementById('rl_printBtn').addEventListener('click', () => printElement(document.getElementById('repLedgerPrint')));
  document.getElementById('repPayForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const rep = repById(currentRepId);
    if (!rep) return;
    const amount = parseFloat(document.getElementById('rp_amount').value);
    if (!amount || amount <= 0) { alert('أدخل مبلغاً صحيحاً'); return; }
    const pay = makePayment(amount, document.getElementById('rp_currency').value, document.getElementById('rp_note').value.trim());
    if (!pay) { alert('لا يوجد سعر صرف لتحويل المبلغ من الليرة. أدخل سعر الصرف من لوحة التحكم أو اكتب المبلغ بالدولار.'); return; }
    rep.payments.push(pay);
    document.getElementById('rp_amount').value = '';
    document.getElementById('rp_note').value = '';
    save();
  });

  // المحلات
  document.getElementById('shopForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      name: document.getElementById('shop_name').value.trim(),
      owner: document.getElementById('shop_owner').value.trim(),
      phone: document.getElementById('shop_phone').value.trim(),
      address: document.getElementById('shop_address').value.trim(),
      repId: document.getElementById('shop_rep').value || null
    };
    if (!data.name) return;
    if (editingShopId) {
      Object.assign(shopById(editingShopId), data);
      cancelEditShop();
    } else {
      state.shops.push({ id: uid(), ...data, payments: [], createdAt: new Date().toISOString() });
      e.target.reset();
    }
    save();
  });
  document.getElementById('shop_cancelEditBtn').addEventListener('click', cancelEditShop);
  document.getElementById('shopSearch').addEventListener('input', renderShops);
  document.getElementById('sl_closeBtn').addEventListener('click', () => { currentShopId = null; renderShopLedger(); });
  document.getElementById('sl_printBtn').addEventListener('click', () => printElement(document.getElementById('shopLedgerPrint')));
  document.getElementById('shopPayForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const shop = shopById(currentShopId);
    if (!shop) return;
    const amount = parseFloat(document.getElementById('sp_amount').value);
    if (!amount || amount <= 0) { alert('أدخل مبلغاً صحيحاً'); return; }
    const pay = makePayment(amount, document.getElementById('sp_currency').value, document.getElementById('sp_note').value.trim());
    if (!pay) { alert('لا يوجد سعر صرف لتحويل المبلغ من الليرة. أدخل سعر الصرف من لوحة التحكم أو اكتب المبلغ بالدولار.'); return; }
    shop.payments.push(pay);
    document.getElementById('sp_amount').value = '';
    document.getElementById('sp_note').value = '';
    save();
  });

  // أسعار الجملة والنشرة
  document.getElementById('wp_search').addEventListener('input', renderWholesalePrices);
  ['wpp_title', 'wpp_category', 'wpp_currency', 'wpp_rep', 'wpp_showCarton', 'wpp_showRetail', 'wpp_onlyPriced'].forEach(id => {
    document.getElementById(id).addEventListener('input', buildPriceListPreview);
    document.getElementById(id).addEventListener('change', buildPriceListPreview);
  });
  document.getElementById('wpp_printBtn').addEventListener('click', () => {
    buildPriceListPreview();
    printElement(document.getElementById('wpp_printArea'));
  });
}

/* ---------------- Event wiring ---------------- */

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
    });
  });
}

function setupDashboard() {
  document.getElementById('saveRateBtn').addEventListener('click', () => {
    const val = parseFloat(document.getElementById('rateInput').value);
    if (!val || val <= 0) { alert('أدخل سعر صرف صحيح'); return; }
    setTodayRate(val);
    document.getElementById('rateInput').value = '';
  });
}

function setupProducts() {
  const unitSelect = document.getElementById('p_unit');
  const cartonSizeInput = document.getElementById('p_cartonSize');
  function refreshLabels() {
    const isKg = unitSelect.value === 'kg';
    document.getElementById('p_qty_unit_label').textContent = isKg ? '(كغ)' : '(حبة)';
    document.getElementById('p_purchase_unit_label').textContent = isKg ? '(لكل كغ)' : '(لكل حبة)';
    document.getElementById('p_sell_unit_label').textContent = isKg ? '(لكل كغ)' : '(لكل حبة)';
    document.getElementById('p_wholesale_unit_label').textContent = isKg ? '(لكل كغ)' : '(لكل حبة)';
    document.getElementById('p_cartonSizeWrap').classList.toggle('hidden', isKg);
    document.getElementById('p_cartonHelperWrap').classList.toggle('hidden', isKg);
  }
  unitSelect.addEventListener('change', refreshLabels);
  refreshLabels();

  cartonSizeInput.addEventListener('input', () => {
    document.getElementById('p_cartonSizeEcho').textContent = cartonSizeInput.value || '—';
  });

  document.getElementById('p_cartonCalcBtn').addEventListener('click', () => {
    const cartons = parseFloat(document.getElementById('p_cartonsCount').value) || 0;
    const perCarton = parseFloat(cartonSizeInput.value) || 0;
    if (!cartons || !perCarton) { alert('أدخل عدد الكراتين وعدد القطع بالكرتونة أولاً'); return; }
    document.getElementById('p_qty').value = cartons * perCarton;
  });

  document.getElementById('productForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const sellVal = document.getElementById('p_sell').value;
    const wholesaleVal = document.getElementById('p_wholesale').value;
    const unit = unitSelect.value;
    const data = {
      name: document.getElementById('p_name').value.trim(),
      category: document.getElementById('p_category').value,
      unit,
      stock: parseFloat(document.getElementById('p_qty').value) || 0,
      purchasePriceUSD: parseFloat(document.getElementById('p_purchase').value) || 0,
      sellPriceUSD: sellVal === '' ? null : parseFloat(sellVal),
      wholesalePriceUSD: wholesaleVal === '' ? null : parseFloat(wholesaleVal),
      unitsPerCarton: unit === 'piece' ? (parseFloat(cartonSizeInput.value) || null) : null,
      supplierId: document.getElementById('p_supplier').value || null
    };

    if (editingProductId) {
      updateProduct(editingProductId, {
        name: data.name,
        category: data.category,
        unit: data.unit,
        stock: data.stock * baseUnitFactor(data.unit),
        purchasePriceUSD: data.purchasePriceUSD,
        sellPriceUSD: data.sellPriceUSD,
        wholesalePriceUSD: data.wholesalePriceUSD,
        unitsPerCarton: data.unitsPerCarton,
        supplierId: data.supplierId
      });
      cancelEditProduct();
    } else {
      addProduct(data);
      e.target.reset();
      refreshLabels();
      document.getElementById('p_cartonSizeEcho').textContent = '—';
    }
  });

  document.getElementById('cancelEditBtn').addEventListener('click', cancelEditProduct);

  document.getElementById('categoryForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('cat_name');
    addCategory(input.value);
    input.value = '';
  });

  document.getElementById('productSearch').addEventListener('input', renderProducts);
}

function setupInventory() {
  document.getElementById('invSearch').addEventListener('input', renderInventory);
}

function setupBackup() {
  document.getElementById('exportBtn').addEventListener('click', exportBackup);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importBackup(file);
    e.target.value = '';
  });
}

function setupSell() {
  document.getElementById('s_product').addEventListener('change', () => { updateSellFormForProduct(); updateSalePreview(); });
  const searchInput = document.getElementById('s_productSearch');
  searchInput.addEventListener('input', () => {
    populateSearchableProductSelect(document.getElementById('s_product'), searchInput.value);
    updateSellFormForProduct();
    updateSalePreview();
  });
  // Enter بخانة البحث: ينقل مباشرة لخانة الكمية/المبلغ بدل ما يرسل الفورم
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    document.getElementById(sellMode === 'qty' ? 's_qty' : 's_amount').focus();
  });
  document.querySelectorAll('#s_modeToggle .mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sellMode = btn.dataset.mode;
      document.querySelectorAll('#s_modeToggle .mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('s_qtyLabel').classList.toggle('hidden', sellMode !== 'qty');
      document.getElementById('s_amountLabel').classList.toggle('hidden', sellMode !== 'amount');
      updateSalePreview();
    });
  });
  document.getElementById('s_qty').addEventListener('input', updateSalePreview);
  document.getElementById('s_amount').addEventListener('input', updateSalePreview);

  document.getElementById('sellForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const productId = document.getElementById('s_product').value;
    const product = state.products.find(p => p.id === productId);
    if (!product) { alert('اختر منتجاً'); return; }
    const value = sellMode === 'qty' ? parseFloat(document.getElementById('s_qty').value) : parseFloat(document.getElementById('s_amount').value);
    if (!value || value <= 0) { alert('أدخل قيمة صحيحة'); return; }
    const customer = document.getElementById('s_customer').value.trim();
    const result = recordSale(product, sellMode, value, customer);
    if (result && result.error) { alert(result.error); return; }
    document.getElementById('s_qty').value = '';
    document.getElementById('s_amount').value = '';
    document.getElementById('s_customer').value = '';
    document.getElementById('s_preview').className = 'preview-box';
    searchInput.value = '';
    renderSell();
    searchInput.focus();
  });
}

function setupSuppliers() {
  document.getElementById('supplierForm').addEventListener('submit', (e) => {
    e.preventDefault();
    addSupplier({
      name: document.getElementById('sup_name').value.trim(),
      phone: document.getElementById('sup_phone').value.trim(),
      notes: document.getElementById('sup_notes').value.trim()
    });
    e.target.reset();
  });

  document.getElementById('closeSupplierDetail').addEventListener('click', () => {
    currentSupplierId = null;
    document.getElementById('supplierDetailCard').classList.add('hidden');
  });

  document.getElementById('addPurchaseItemBtn').addEventListener('click', () => {
    purchaseItemsDraft.push({ productId: '', qty: '', unitPriceUSD: '', desc: '' });
    renderPurchaseItemsDraft();
  });

  document.getElementById('pur_paymentMethod').addEventListener('change', (e) => {
    document.getElementById('pur_paidNowWrap').classList.toggle('hidden', e.target.value !== 'partial');
  });

  document.getElementById('purchaseForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const sup = state.suppliers.find(s => s.id === currentSupplierId);
    if (!sup) return;
    const items = purchaseItemsDraft.filter(r => (r.qty > 0) && (r.unitPriceUSD >= 0)).map(r => {
      const prod = r.productId ? state.products.find(p => p.id === r.productId) : null;
      return {
        productId: r.productId || null,
        label: prod ? prod.name : (r.desc || 'صنف يدوي'),
        qty: r.qty,
        unitPriceUSD: r.unitPriceUSD,
        totalUSD: r.qty * r.unitPriceUSD
      };
    });
    if (!items.length) { alert('أضف صنفاً واحداً على الأقل'); return; }
    const totalUSD = items.reduce((a, i) => a + i.totalUSD, 0);
    const method = document.getElementById('pur_paymentMethod').value;
    let paidUSD = 0;
    if (method === 'cash') paidUSD = totalUSD;
    else if (method === 'partial') paidUSD = parseFloat(document.getElementById('pur_paidNow').value) || 0;

    sup.transactions.push({
      id: uid(), date: todayStr(), type: 'purchase',
      items, totalUSD, paymentMethod: method, paidUSD
    });

    items.forEach(i => {
      if (i.productId) {
        const prod = state.products.find(p => p.id === i.productId);
        if (prod) prod.stock += i.qty * baseUnitFactor(prod.unit);
      }
    });

    purchaseItemsDraft = [{ productId: '', qty: '', unitPriceUSD: '', desc: '' }];
    renderPurchaseItemsDraft();
    document.getElementById('pur_paidNow').value = '';
    e.target.reset();
    save();
  });

  document.getElementById('paymentForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const sup = state.suppliers.find(s => s.id === currentSupplierId);
    if (!sup) return;
    const amount = parseFloat(document.getElementById('pay_amount').value);
    if (!amount || amount <= 0) { alert('أدخل مبلغاً صحيحاً'); return; }
    sup.transactions.push({
      id: uid(), date: todayStr(), type: 'payment',
      amountUSD: amount, note: document.getElementById('pay_note').value.trim()
    });
    e.target.reset();
    save();
  });
}

function setupReports() {
  document.getElementById('rep_date').addEventListener('change', renderReports);

  document.getElementById('saleSearch').addEventListener('input', renderSaleSearch);
  document.getElementById('saleSearchFrom').addEventListener('change', renderSaleSearch);
  document.getElementById('saleSearchTo').addEventListener('change', renderSaleSearch);
  document.getElementById('saleSearchClear').addEventListener('click', () => {
    document.getElementById('saleSearch').value = '';
    document.getElementById('saleSearchFrom').value = '';
    document.getElementById('saleSearchTo').value = '';
    renderSaleSearch();
  });
}

function setupPrint() {
  ['pr_category', 'pr_currency', 'pr_title', 'pr_showQty', 'pr_showCost', 'pr_showSell'].forEach(id => {
    document.getElementById(id).addEventListener('input', buildPrintPreview);
    document.getElementById(id).addEventListener('change', buildPrintPreview);
  });
  document.getElementById('pr_printBtn').addEventListener('click', () => {
    buildPrintPreview();
    printElement(document.getElementById('printArea'));
  });
}

/* ---------------- Init ---------------- */

function init() {
  loadState();
  setupTabs();
  setupDashboard();
  setupBackup();
  setupProducts();
  setupInventory();
  setupSell();
  setupWholesale();
  setupSuppliers();
  setupReports();
  setupPrint();
  document.getElementById('rep_date').value = todayStr();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
