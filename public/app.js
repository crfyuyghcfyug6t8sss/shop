/* =========================================================
   نظام محاسبة محل التوابل - المنطق الرئيسي
   التخزين: محلي في هذا المتصفح (localStorage) - بدون سيرفر وبدون قاعدة بيانات
   يفتح مباشرة بفتح index.html في المتصفح
   ========================================================= */

const STORAGE_KEY = 'spiceShopAccountingData_v1';

let state = { meta: {}, exchangeRates: [], products: [], suppliers: [], sales: [] };
let currentSupplierId = null;
let sellMode = 'qty';
let purchaseItemsDraft = [];

/* ---------------- Persistence (localStorage) ---------------- */

function defaultState() { return { meta: {}, exchangeRates: [], products: [], suppliers: [], sales: [] }; }

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : defaultState();
  } catch (e) {
    state = defaultState();
  }
  state.exchangeRates = state.exchangeRates || [];
  state.products = state.products || [];
  state.suppliers = state.suppliers || [];
  state.sales = state.sales || [];
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
      state.exchangeRates = state.exchangeRates || [];
      state.products = state.products || [];
      state.suppliers = state.suppliers || [];
      state.sales = state.sales || [];
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
  save();
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
  renderProducts();
  renderInventory();
  renderSell();
  renderSuppliers();
  renderReports();
  renderPrintOptions();
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
            <button class="link-btn del-product-btn" data-id="${p.id}">حذف</button>
          </td>
        </tr>
      `);
      tbody.appendChild(row);
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

function renderSell() {
  const sel = document.getElementById('s_product');
  populateProductSelect(sel, true);
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

function renderReports() {
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
    addProduct({
      name: document.getElementById('p_name').value.trim(),
      category: document.getElementById('p_category').value.trim(),
      unit: unitSelect.value,
      stock: parseFloat(document.getElementById('p_qty').value) || 0,
      purchasePriceUSD: parseFloat(document.getElementById('p_purchase').value) || 0,
      sellPriceUSD: sellVal === '' ? null : parseFloat(sellVal),
      unitsPerCarton: unitSelect.value === 'piece' ? (parseFloat(cartonSizeInput.value) || null) : null,
      supplierId: document.getElementById('p_supplier').value || null
    });
    e.target.reset();
    refreshLabels();
    document.getElementById('p_cartonSizeEcho').textContent = '—';
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
}

function setupPrint() {
  ['pr_category', 'pr_currency', 'pr_title', 'pr_showQty', 'pr_showCost', 'pr_showSell'].forEach(id => {
    document.getElementById(id).addEventListener('input', buildPrintPreview);
    document.getElementById(id).addEventListener('change', buildPrintPreview);
  });
  document.getElementById('pr_printBtn').addEventListener('click', () => {
    buildPrintPreview();
    window.print();
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
  setupSuppliers();
  setupReports();
  setupPrint();
  document.getElementById('rep_date').value = todayStr();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
