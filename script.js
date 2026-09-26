// ==========================================
// 1. 変数の初期化
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

// Service Workerの登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('SW Registered!', reg))
      .catch((err) => console.log('SW Error:', err));
  });
}

// ==========================================
// 2. エラー監視（JavaScriptエラー時にアラート表示）
// ==========================================
window.addEventListener('error', (event) => {
  alert('⚠️ JSエラー発生:\n' + event.message + '\n(' + event.filename + ':' + event.lineno + ')');
});

// ==========================================
// 3. Firebase の初期化 ＆ 接続診断
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

    // 接続テストの実施（書き込み）
    db.ref('test_connection').set({
      last_test: new Date().toLocaleString()
    }).then(() => {
      alert('✅ Firebase接続テスト成功！リアルタイム同期が有効です。');
    }).catch((err) => {
      alert('⚠️ Firebaseルールエラー:\n' + err.message + '\n\nFirebaseコンソールの「Realtime Database」->「ルール」で read/write が true になっているか確認してください。');
    });
  }
} catch (e) {
  alert('❌ 初期化例外エラー:\n' + e.message);
}

// ==========================================
// 4. アプリ起動処理（リアルタイム同期）
// ==========================================
window.onload = () => {
  if (typeof changeTheme === 'function') changeTheme(currentTheme);
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) themeSelect.value = currentTheme;
  
  if (categoriesRef) {
    categoriesRef.on('value', (snapshot) => {
      const val = snapshot.val();
      if (val) {
        categories = val;
        if (typeof renderCategoryManager === 'function') renderCategoryManager();
      }
    });
  }

  if (budgetRef) {
    budgetRef.on('value', (snapshot) => {
      const val = snapshot.val();
      if (val !== null && val !== undefined) {
        monthlyBudget = val;
        const budgetInput = document.getElementById('monthlyBudgetInput');
        if (budgetInput) budgetInput.value = monthlyBudget;
        updateBudgetDisplay();
      }
    });
  }

  if (itemsRef) {
    itemsRef.on('value', (snapshot) => {
      const data = snapshot.val();
      items = data ? Object.values(data) : [];
      if (typeof applyFilters === 'function') applyFilters();
    });
  }

  const now = new Date();
  const thisMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthPicker = document.getElementById('catChartMonthPicker');
  const yearPicker = document.getElementById('catChartYearPicker');
  if (monthPicker) monthPicker.value = thisMonthStr;
  if (yearPicker) yearPicker.value = now.getFullYear();

  if (typeof onTrendScaleChange === 'function') onTrendScaleChange();
};

// ==========================================
// 5. データ保存関数
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
  }
  if (typeof renderCategoryBudgets === 'function') renderCategoryBudgets();
}

function updateBudgetDisplay() {
  const budgetInput = document.getElementById('monthlyBudgetInput');
  monthlyBudget = budgetInput ? (parseInt(budgetInput.value) || 0) : monthlyBudget;
  if (budgetRef) budgetRef.set(monthlyBudget);

  const now = new Date();
  const thisMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const thisMonthSpent = items.filter(i => i.date.startsWith(thisMonthStr)).reduce((s, i) => s + i.price, 0);
  const lastMonthSpent = items.filter(i => i.date.startsWith(lastMonthStr)).reduce((s, i) => s + i.price, 0);

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
