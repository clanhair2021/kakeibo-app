// ==========================================
// 0. エラー監視（エラー発生時に画面へ表示）
// ==========================================
window.addEventListener('error', (event) => {
  alert('⚠️ JSエラー発生:\n' + event.message + '\n(' + event.filename + ':' + event.lineno + '行目)');
});

// ==========================================
// 1. 変数の初期化（先頭配置）
// ==========================================
const defaultCategories = ["食費", "日用品", "衣類", "趣味・娯楽", "固定費", "その他"];
let categories = JSON.parse(localStorage.getItem('receipt_categories')) || defaultCategories;
let categoryBudgets = JSON.parse(localStorage.getItem('receipt_cat_budgets')) || {};
let items = JSON.parse(localStorage.getItem('receipt_items')) || [];
let monthlyBudget = parseInt(localStorage.getItem('receipt_budget')) || 100000;
let currentTheme = localStorage.getItem('receipt_theme') || 'mono';

let activeDayDateStr = '';
let catChart = null;
let trendChart = null;
let currentCalendarDate = new Date();

// Service Workerの登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.log('SW Error:', err));
  });
}

// ==========================================
// 2. Firebase の初期化 ＆ 接続診断
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyASWXfL7e8cnrnMre9cLqffgPf06Ccb_wc",
  authDomain: "kakeibo-app-c8e8c.firebaseapp.com",
  databaseURL: "https://kakeibo-app-c8e8c-default-rtdb.firebaseio.com",
  projectId: "kakeibo-app-c8e8c",
  storageBucket: "kakeibo-app-c8e8c.firebasestorage.app",
  messagingSenderId: "319296627332",
  appId: "1:319296627332:web:4cb8038a9b58902b8458d1"
};

let db, itemsRef, budgetRef, categoriesRef;

try {
  if (typeof firebase === 'undefined') {
    alert('❌ エラー: Firebaseライブラリ(SDK)が読み込まれていません。\nindex.html の <script> タグを確認してください。');
  } else {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.database();
    itemsRef = db.ref('kakeibo_items');
    budgetRef = db.ref('kakeibo_budget');
    categoriesRef = db.ref('kakeibo_categories');

    // 接続テスト（書き込み確認）
    db.ref('test_connection').set({
      last_test: new Date().toLocaleString()
    }).then(() => {
      alert('✅ Firebase接続テスト成功！リアルタイム同期が有効です。');
    }).catch((err) => {
      alert('⚠️ Firebaseルールエラー:\n' + err.message);
    });
  }
} catch (e) {
  alert('❌ 初期化例外エラー:\n' + e.message);
}

// ==========================================
// 3. アプリ起動処理（リアルタイム受信）
// ==========================================
window.onload = () => {
  if (typeof changeTheme === 'function') changeTheme(currentTheme);
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) themeSelect.value = currentTheme;
  const budgetInput = document.getElementById('monthlyBudgetInput');
  if (budgetInput) budgetInput.value = monthlyBudget;

  if (categoriesRef) {
    categoriesRef.on('value', (snapshot) => {
      const val = snapshot.val();
      if (val) {
        categories = val;
        renderCategoryManager();
      }
    });
  }

  if (budgetRef) {
    budgetRef.on('value', (snapshot) => {
      const val = snapshot.val();
      if (val !== null && val !== undefined) {
        monthlyBudget = val;
        if (budgetInput) budgetInput.value = monthlyBudget;
        updateBudgetDisplay();
      }
    });
  }

  if (itemsRef) {
    itemsRef.on('value', (snapshot) => {
      const data = snapshot.val();
      items = data ? Object.values(data) : [];
      applyFilters();
    });
  }

  const now = new Date();
  const thisMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthPicker = document.getElementById('catChartMonthPicker');
  const yearPicker = document.getElementById('catChartYearPicker');
  if (monthPicker) monthPicker.value = thisMonthStr;
  if (yearPicker) yearPicker.value = now.getFullYear();

  onTrendScaleChange();
  renderCategoryManager();
  applyFilters();
};

// ==========================================
// 4. データ保存関数（Firebase連携）
// ==========================================
function saveData() {
  if (itemsRef) {
    itemsRef.set(items);
  } else {
    localStorage.setItem('receipt_items', JSON.stringify(items));
  }
}

function saveCatBudget(cat, val) {
  categoryBudgets[cat] = parseInt(val) || 0;
  if (db) {
    db.ref('kakeibo_cat_budgets').set(categoryBudgets);
  } else {
    localStorage.setItem('receipt_cat_budgets', JSON.stringify(categoryBudgets));
  }
  renderCategoryBudgets();
}

function updateBudgetDisplay() {
  const budgetInput = document.getElementById('monthlyBudgetInput');
  monthlyBudget = budgetInput ? (parseInt(budgetInput.value) || 0) : monthlyBudget;
  if (budgetRef) budgetRef.set(monthlyBudget);

  const now = new Date();
  const thisMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const thisMonthSpent = items.filter(i => i.date && i.date.startsWith(thisMonthStr)).reduce((s, i) => s + i.price, 0);
  const lastMonthSpent = items.filter(i => i.date && i.date.startsWith(lastMonthStr)).reduce((s, i) => s + i.price, 0);

  const diff = thisMonthSpent - lastMonthSpent;
  const diffStr = diff >= 0 ? `前月比: +¥${diff.toLocaleString()}` : `前月比: -¥${Math.abs(diff).toLocaleString()}`;

  const remaining = monthlyBudget - thisMonthSpent;
  const percent = monthlyBudget > 0 ? Math.min(Math.round((thisMonthSpent / monthlyBudget) * 100), 100) : 0;

  const elSpent = document.getElementById('thisMonthSpent');
  const elCompare = document.getElementById('monthCompare');
  const elRemaining = document.getElementById('budgetRemaining');
  const elFill = document.getElementById('progressBarFill');

  if (elSpent) elSpent.innerText = thisMonthSpent.toLocaleString();
  if (elCompare) elCompare.innerText = diffStr;
  if (elRemaining) elRemaining.innerText = remaining.toLocaleString();
  if (elFill) elFill.style.width = `${percent}%`;
}

// ==========================================
// 5. UI・操作関連関数
// ==========================================
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');
  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.classList.add('active');
  }
}

function openModal(id) { const el = document.getElementById(id); if (el) el.style.display = 'flex'; }
function closeModal(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

function changeTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('receipt_theme', theme);
  renderDashboard();
}

function searchBottomPrice() {
  const input = document.getElementById('bottomPriceSearch');
  if (!input) return;
  const query = input.value.toLowerCase().trim();
  const resDiv = document.getElementById('bottomPriceResult');
  if (!query) return alert('商品名を入力してください。');

  const matched = items.filter(i => i.name && i.name.toLowerCase().includes(query));
  if (matched.length === 0) {
    resDiv.innerHTML = '<span style="color:var(--text-muted);">該当する商品の購入履歴が見つかりませんでした。</span>';
  } else {
    matched.sort((a, b) => a.price - b.price);
    const cheapest = matched[0];
    resDiv.innerHTML = `
      <div>検索キーワード: <strong>「${escapeHtml(query)}」</strong></div>
      <hr style="margin:8px 0; border:none; border-top:1px solid var(--border);">
      <div style="font-size:1.1rem; color:var(--primary); font-weight:bold;">最安値: ¥${cheapest.price.toLocaleString()}</div>
      <div style="margin-top:4px;">店舗: <strong>${escapeHtml(cheapest.store)}</strong></div>
      <div>日付: ${cheapest.date}</div>
      <div>商品名: ${escapeHtml(cheapest.name)}</div>
    `;
  }
  openModal('bottomPriceModal');
}

function changeCalendarMonth(diff) {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + diff);
  renderCalendar();
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  if (!grid) return;
  grid.innerHTML = '';
  
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();

  const titleEl = document.getElementById('calendarMonthTitle');
  if (titleEl) titleEl.innerText = `${year}年${month + 1}月`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
  
  daysOfWeek.forEach(d => grid.innerHTML += `<div class="calendar-day-header">${d}</div>`);

  for (let i = 0; i < firstDay; i++) {
    grid.innerHTML += `<div class="calendar-cell" style="background:transparent; border:none;"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTotal = items.filter(i => i.date === dateStr).reduce((sum, i) => sum + i.price, 0);

    grid.innerHTML += `
      <div class="calendar-cell" onclick="showDayDetails('${dateStr}')">
        <span class="day-num">${day}</span>
        <span class="day-amount">${dayTotal > 0 ? '¥' + dayTotal.toLocaleString() : ''}</span>
      </div>
    `;
  }
}

function showDayDetails(dateStr) {
  activeDayDateStr = dateStr;
  const title = document.getElementById('modalDateTitle');
  if (title) title.innerText = dateStr;
  const filterSelect = document.getElementById('dayCategoryFilter');
  if (filterSelect) {
    filterSelect.innerHTML = '<option value="">すべて</option>';
    categories.forEach(cat => { filterSelect.innerHTML += `<option value="${cat}">${cat}</option>`; });
  }
  filterDayDetails();
  openModal('dayDetailModal');
}

function filterDayDetails() {
  const filterEl = document.getElementById('dayCategoryFilter');
  const selectedCat = filterEl ? filterEl.value : '';
  const dayItems = items.filter(i => i.date === activeDayDateStr && (!selectedCat || i.category === selectedCat));
  const tbody = document.getElementById('dayDetailTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (dayItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">該当する購入履歴はありません</td></tr>';
  } else {
    dayItems.forEach(item => {
      tbody.innerHTML += `
        <tr>
          <td><span class="badge">${escapeHtml(item.category)}</span></td>
          <td>${escapeHtml(item.name)}</td>
          <td class="price">¥${item.price.toLocaleString()}</td>
          <td>${escapeHtml(item.store)}</td>
        </tr>
      `;
    });
  }
}

function renderCategoryManager() {
  const container = document.getElementById('categoryListContainer');
  const select = document.getElementById('categoryFilter');
  const editSelect = document.getElementById('editCategory');
  
  if (!container || !select || !editSelect) return;

  container.innerHTML = '';
  select.innerHTML = '<option value="">すべて</option>';
  editSelect.innerHTML = '';

  categories.forEach(cat => {
    container.innerHTML += `<div class="cat-tag">${cat} <button onclick="removeCategory('${cat}')">×</button></div>`;
    select.innerHTML += `<option value="${cat}">${cat}</option>`;
    editSelect.innerHTML += `<option value="${cat}">${cat}</option>`;
  });

  localStorage.setItem('receipt_categories', JSON.stringify(categories));
  renderCategoryBudgets();
}

function addCategory() {
  const input = document.getElementById('newCategoryInput');
  if (!input) return;
  const val = input.value.trim();
  if (val && !categories.includes(val)) {
    categories.push(val);
    input.value = '';
    if (categoriesRef) categoriesRef.set(categories);
    renderCategoryManager();
  }
}

function removeCategory(cat) {
  if (confirm(`「${cat}」カテゴリーを削除しますか？`)) {
    categories = categories.filter(c => c !== cat);
    if (categoriesRef) categoriesRef.set(categories);
    renderCategoryManager();
  }
}

function renderCategoryBudgets() {
  const grid = document.getElementById('categoryBudgetGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  categories.forEach(cat => {
    const bAmount = categoryBudgets[cat] || 0;
    const spent = items
      .filter(i => i.category === cat && i.date && i.date.startsWith(currentMonthStr))
      .reduce((sum, i) => sum + i.price, 0);

    grid.innerHTML += `
      <div class="cat-budget-item">
        <div style="font-weight:bold; margin-bottom:2px;">${cat}</div>
        <div>使用: ¥${spent.toLocaleString()}</div>
        <div style="margin-top:2px;">予算: 
          <input type="number" style="width:65px; padding:2px;" value="${bAmount}" onchange="saveCatBudget('${cat}', this.value)">円
        </div>
      </div>
    `;
  });
}

function parsePrice(priceStr) {
  if (!priceStr) return 0;
  let clean = priceStr.trim().replace(/[^0-9*]/g, '');
  if (clean.includes('*')) {
    const parts = clean.split('*');
    return (parseInt(parts[0]) || 0) * (parseInt(parts[1]) || 1);
  }
  return parseInt(clean) || 0;
}

async function readFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return alert('クリップボードが空です。');
    const pasteArea = document.getElementById('pasteArea');
    if (pasteArea) pasteArea.value = text;
    registerData();
  } catch (err) { alert('クリップボードの読み取り許可が必要です。'); }
}

function registerData() {
  const pasteArea = document.getElementById('pasteArea');
  if (!pasteArea) return;
  const text = pasteArea.value.trim();
  if (!text) return alert('テキストを入力してください。');

  const lines = text.split('\n');
  const newItems = [];
  const duplicates = [];

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const cols = line.split('\t');

    if (cols.length >= 4) {
      let rawDate = cols[0]?.trim().replace(/\//g, '-') || new Date().toISOString().split('T')[0];
      let store = cols[1]?.trim() || '不明';
      let name = cols[2]?.trim() || '未分類商品';
      let price = parsePrice(cols[3]);
      let category = cols[4]?.trim() || 'その他';

      const isDup = items.some(i => i.date === rawDate && i.store === store && i.name === name && i.price === price);
      if (isDup) duplicates.push(`${rawDate} ${store} - ${name} (¥${price})`);
      newItems.push({ id: Date.now() + index, date: rawDate, store, name, price, category });
    }
  });

  if (duplicates.length > 0) {
    if (!confirm(`⚠️ 重複の可能性があるデータがあります：\n\n${duplicates.join('\n')}\n\n登録を続行しますか？`)) return;
  }

  if (newItems.length > 0) {
    items.push(...newItems);
    saveData();
    pasteArea.value = '';
    applyFilters();
    alert(`${newItems.length} 件登録しました！`);
  }
}

function applyFilters() {
  const startEl = document.getElementById('startDate');
  const endEl = document.getElementById('endDate');
  const catEl = document.getElementById('categoryFilter');
  const kwEl = document.getElementById('keywordFilter');

  const startDate = startEl ? startEl.value : '';
  const endDate = endEl ? endEl.value : '';
  const category = catEl ? catEl.value : '';
  const keyword = kwEl ? kwEl.value.toLowerCase().trim() : '';

  const filtered = items.filter(item => {
    if (startDate && item.date < startDate) return false;
    if (endDate && item.date > endDate) return false;
    if (category && item.category !== category) return false;
    if (keyword && (!item.name || !item.name.toLowerCase().includes(keyword)) && (!item.store || !item.store.toLowerCase().includes(keyword))) return false;
    return true;
  });

  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
  renderTable(filtered);
  renderDashboard(filtered);
  updateBudgetDisplay();
  renderCalendar();
  renderCategoryBudgets();
}

function renderTable(dataList) {
  const tbody = document.getElementById('dataTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  let total = 0;

  if (dataList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">該当データがありません。</td></tr>';
  } else {
    dataList.forEach(item => {
      total += item.price;
      tbody.innerHTML += `
        <tr>
          <td><span class="badge">${escapeHtml(item.category || '')}</span></td>
          <td class="price">¥${item.price.toLocaleString()}</td>
          <td><strong>${escapeHtml(item.name || '')}</strong></td>
          <td>${item.date || ''}</td>
          <td>${escapeHtml(item.store || '')}</td>
          <td>
            <button class="action-btn edit-btn" onclick="openEditModal(${item.id})">編集</button>
            <button class="action-btn delete-btn" onclick="deleteItem(${item.id})">削除</button>
          </td>
        </tr>
      `;
    });
  }

  const recCount = document.getElementById('recordCount');
  const grandCount = document.getElementById('grandTotalCount');
  const totAmt = document.getElementById('totalAmount');

  if (recCount) recCount.innerText = dataList.length;
  if (grandCount) grandCount.innerText = items.length;
  if (totAmt) totAmt.innerText = total.toLocaleString();
}

function onCatTypeChange() {
  const typeEl = document.getElementById('catChartType');
  if (!typeEl) return;
  const type = typeEl.value;
  const monthPicker = document.getElementById('catChartMonthPicker');
  const yearPicker = document.getElementById('catChartYearPicker');

  if (monthPicker && yearPicker) {
    if (type === 'month') {
      monthPicker.style.display = 'inline-block';
      yearPicker.style.display = 'none';
    } else if (type === 'year') {
      monthPicker.style.display = 'none';
      yearPicker.style.display = 'inline-block';
    } else {
      monthPicker.style.display = 'none';
      yearPicker.style.display = 'none';
    }
  }
  renderDashboard();
}

function onTrendScaleChange() {
  const scaleEl = document.getElementById('trendChartScale');
  const limitSelect = document.getElementById('trendChartLimit');
  if (!scaleEl || !limitSelect) return;

  const scale = scaleEl.value;
  limitSelect.innerHTML = '';

  if (scale === 'month') {
    limitSelect.innerHTML = `
      <option value="12">直近12ヶ月</option>
      <option value="24">直近24ヶ月</option>
      <option value="all">全期間</option>
    `;
  } else {
    limitSelect.innerHTML = `
      <option value="5">直近5年</option>
      <option value="10">直近10年</option>
      <option value="all">全期間</option>
    `;
  }
  renderDashboard();
}

function renderDashboard(filteredData) {
  if (typeof Chart === 'undefined') return;
  const chartColors = getThemeChartColors();
  const textColor = getCssVar('--text-bright') || '#ffffff';

  const catTypeEl = document.getElementById('catChartType');
  const catType = catTypeEl ? catTypeEl.value : 'all';
  let catDataTarget = items;

  if (catType === 'month') {
    const mEl = document.getElementById('catChartMonthPicker');
    if (mEl && mEl.value) catDataTarget = items.filter(i => i.date && i.date.startsWith(mEl.value));
  } else if (catType === 'year') {
    const yEl = document.getElementById('catChartYearPicker');
    if (yEl && yEl.value) catDataTarget = items.filter(i => i.date && i.date.startsWith(yEl.value));
  }

  const catTotals = {};
  catDataTarget.forEach(item => { catTotals[item.category] = (catTotals[item.category] || 0) + item.price; });

  const catCanvas = document.getElementById('categoryChart');
  if (catCanvas) {
    if (catChart) catChart.destroy();
    catChart = new Chart(catCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: Object.keys(catTotals),
        datasets: [{ 
          data: Object.values(catTotals), 
          backgroundColor: chartColors.pie,
          borderColor: getCssVar('--border') || '#000',
          borderWidth: 1
        }]
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        plugins: { 
          legend: { 
            position: 'bottom', 
            labels: { boxWidth: 10, font: { size: 9 }, color: textColor } 
          } 
        } 
      }
    });
  }

  const trendScaleEl = document.getElementById('trendChartScale');
  const trendLimitEl = document.getElementById('trendChartLimit');
  const trendScale = trendScaleEl ? trendScaleEl.value : 'month';
  const trendLimit = trendLimitEl ? trendLimitEl.value : '12';
  const timeTotals = {};

  items.forEach(item => {
    if (item.date) {
      const key = trendScale === 'month' ? item.date.substring(0, 7) : item.date.substring(0, 4);
      timeTotals[key] = (timeTotals[key] || 0) + item.price;
    }
  });

  let sortedKeys = Object.keys(timeTotals).sort();
  if (trendLimit !== 'all') {
    const limitNum = parseInt(trendLimit);
    sortedKeys = sortedKeys.slice(-limitNum);
  }
  const trendValues = sortedKeys.map(k => timeTotals[k]);

  const innerWrapper = document.getElementById('trendChartScrollInner');
  if (innerWrapper) {
    const calculatedWidth = Math.max(280, sortedKeys.length * 45);
    innerWrapper.style.width = `${calculatedWidth}px`;
  }

  const trendCanvas = document.getElementById('monthlyTrendChart');
  if (trendCanvas) {
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(trendCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: sortedKeys,
        datasets: [{ 
          label: '支出', 
          data: trendValues, 
          backgroundColor: chartColors.bar,
          borderColor: getCssVar('--border') || '#000',
          borderWidth: 1
        }]
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        scales: {
          x: { ticks: { color: textColor }, grid: { display: false } },
          y: { ticks: { color: textColor }, grid: { color: 'rgba(255,255,255,0.1)' } }
        },
        plugins: { legend: { display: false } } 
      }
    });
  }

  const storeTarget = filteredData || items;
  const storeTotals = {};
  storeTarget.forEach(item => { if (item.store) storeTotals[item.store] = (storeTotals[item.store] || 0) + item.price; });
  const sortedStores = Object.entries(storeTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const storeBody = document.getElementById('storeSummaryBody');
  if (storeBody) {
    storeBody.innerHTML = '';
    if (sortedStores.length === 0) storeBody.innerHTML = '<tr><td colspan="2" style="text-align:center;">データなし</td></tr>';
    else sortedStores.forEach(([store, total]) => storeBody.innerHTML += `<tr><td>${escapeHtml(store)}</td><td class="price">¥${total.toLocaleString()}</td></tr>`);
  }
}

function openEditModal(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;

  const idEl = document.getElementById('editId');
  const dateEl = document.getElementById('editDate');
  const storeEl = document.getElementById('editStore');
  const nameEl = document.getElementById('editName');
  const priceEl = document.getElementById('editPrice');
  const catEl = document.getElementById('editCategory');

  if (idEl) idEl.value = item.id;
  if (dateEl) dateEl.value = item.date;
  if (storeEl) storeEl.value = item.store;
  if (nameEl) nameEl.value = item.name;
  if (priceEl) priceEl.value = item.price;
  if (catEl) catEl.value = item.category;

  openModal('editModal');
}

function saveEdit() {
  const idEl = document.getElementById('editId');
  if (!idEl) return;
  const id = parseInt(idEl.value);
  const item = items.find(i => i.id === id);
  if (item) {
    const dateEl = document.getElementById('editDate');
    const storeEl = document.getElementById('editStore');
    const nameEl = document.getElementById('editName');
    const priceEl = document.getElementById('editPrice');
    const catEl = document.getElementById('editCategory');

    if (dateEl) item.date = dateEl.value;
    if (storeEl) item.store = storeEl.value.trim();
    if (nameEl) item.name = nameEl.value.trim();
    if (priceEl) item.price = parseInt(priceEl.value) || 0;
    if (catEl) item.category = catEl.value;

    saveData();
    closeModal('editModal');
    applyFilters();
  }
}

function deleteItem(id) {
  if (confirm('削除しますか？')) {
    items = items.filter(item => item.id !== id);
    saveData();
    applyFilters();
  }
}

function resetFilters() {
  const s = document.getElementById('startDate');
  const e = document.getElementById('endDate');
  const c = document.getElementById('categoryFilter');
  const k = document.getElementById('keywordFilter');

  if (s) s.value = '';
  if (e) e.value = '';
  if (c) c.value = '';
  if (k) k.value = '';
  applyFilters();
}

function exportToCSV() {
  if (items.length === 0) return alert('データがありません。');
  let csvContent = "\uFEFF日付,店舗名,商品名,金額,カテゴリ\n";
  items.forEach(item => { csvContent += `"${item.date || ''}","${item.store || ''}","${item.name || ''}",${item.price || 0},"${item.category || ''}"\n`; });
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `kakeibo_data_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}

function getCssVar(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function getThemeChartColors() {
  if (currentTheme === 'neon') {
    return {
      bar: '#00ff88',
      pie: ['#00ff88', '#00ccff', '#ff00ff', '#ffaa00', '#ff2244', '#888888']
    };
  } else if (currentTheme === 'retro-tv') {
    return {
      bar: '#ffaa00',
      pie: ['#ffaa00', '#ff6b4a', '#00d4aa', '#ffff00', '#d4a470', '#8a6a50']
    };
  } else if (currentTheme === 'retro-ui') {
    return {
      bar: '#111111',
      pie: ['#111111', '#444444', '#777777', '#aaaaaa', '#cccccc', '#e0e0e0']
    };
  } else {
    return {
      bar: '#ffffff',
      pie: ['#ffffff', '#cccccc', '#999999', '#666666', '#444444', '#222222']
    };
  }
}
