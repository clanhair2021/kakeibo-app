
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
// Firebase 初期化
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const expensesRef = database.ref("expenses");

// DOM要素の取得
const expenseForm = document.getElementById("expense-form");
const expenseList = document.getElementById("expense-list");
const syncStatus = document.getElementById("sync-status");
const dateInput = document.getElementById("date");

// モーダル用DOM要素
const detailModal = document.getElementById("detail-modal");
const modalClose = document.getElementById("modal-close");
const modalItemId = document.getElementById("modal-item-id");
const modalNote = document.getElementById("modal-note");
const modalImage = document.getElementById("modal-image");
const imagePreviewContainer = document.getElementById("image-preview-container");
const saveDetailBtn = document.getElementById("save-detail-btn");
const removeImageBtn = document.getElementById("remove-image-btn");

let currentImageData = ""; // 一時保存用画像Base64データ

// 本日の日付をデフォルト設定
if (dateInput) {
  dateInput.value = new Date().toISOString().split("T")[0];
}

// フォーム送信処理（新規追加）
expenseForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const newExpense = {
    date: document.getElementById("date").value,
    category: document.getElementById("category").value,
    item: document.getElementById("item").value,
    amount: Number(document.getElementById("amount").value),
    payer: document.getElementById("payer").value,
    note: "",
    image: "",
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };

  expensesRef.push(newExpense)
    .then(() => {
      expenseForm.reset();
      dateInput.value = new Date().toISOString().split("T")[0];
    })
    .catch((error) => {
      console.error("データ追加エラー:", error);
      alert("データの登録に失敗しました");
    });
});

// Firebase リアルタイム同期・一覧表示
expensesRef.on("value", (snapshot) => {
  syncStatus.textContent = "同期完了";
  syncStatus.style.background = "#2e7d32";
  expenseList.innerHTML = "";

  const data = snapshot.val();
  if (!data) {
    expenseList.innerHTML = '<tr><td colspan="7" style="text-align:center;">データがありません</td></tr>';
    return;
  }

  const entries = Object.entries(data);
  // 日付の降順でソート
  entries.sort((a, b) => new Date(b[1].date) - new Date(a[1].date));

  entries.forEach(([id, item]) => {
    const tr = document.createElement("tr");

    const hasNote = item.note && item.note.trim() !== "";
    const hasImage = item.image && item.image !== "";
    const badgeText = `${hasNote ? "📝" : ""}${hasImage ? "📷" : ""}` || "詳細";

    tr.innerHTML = `
      <td>${item.date}</td>
      <td>${item.category}</td>
      <td>${item.item}</td>
      <td>¥${Number(item.amount).toLocaleString()}</td>
      <td>${item.payer}</td>
      <td>
        <button class="btn-detail" onclick="openModal('${id}')">${badgeText}</button>
      </td>
      <td>
        <button class="btn-delete" onclick="deleteExpense('${id}')">削除</button>
      </td>
    `;
    expenseList.appendChild(tr);
  });
}, (error) => {
  console.error("同期エラー:", error);
  syncStatus.textContent = "同期エラー";
  syncStatus.style.background = "#c62828";
});

// 削除処理
window.deleteExpense = function(id) {
  if (confirm("このデータを削除してもよろしいですか？")) {
    expensesRef.child(id).remove();
  }
};

// --- モーダル（メモ・画像編集）関連処理 ---

window.openModal = function(id) {
  modalItemId.value = id;
  currentImageData = "";

  expensesRef.child(id).once("value").then((snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    modalNote.value = data.note || "";
    currentImageData = data.image || "";
    renderImagePreview();

    detailModal.style.display = "flex";
  });
};

// モーダル閉じる
modalClose.onclick = () => { detailModal.style.display = "none"; };
window.onclick = (e) => { if (e.target === detailModal) detailModal.style.display = "none"; };

// 画像選択時の圧縮処理
modalImage.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      // 画像を長辺最大800pxに圧縮
      const canvas = document.createElement("canvas");
      const maxDim = 800;
      let width = img.width;
      let height = img.height;

      if (width > height && width > maxDim) {
        height *= maxDim / width;
        width = maxDim;
      } else if (height > maxDim) {
        width *= maxDim / height;
        height = maxDim;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      // JPEG品質70%で軽量化
      currentImageData = canvas.toDataURL("image/jpeg", 0.7);
      renderImagePreview();
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

// プレビュー表示関数
function renderImagePreview() {
  imagePreviewContainer.innerHTML = "";
  if (currentImageData) {
    const img = document.createElement("img");
    img.src = currentImageData;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "200px";
    img.style.borderRadius = "8px";
    imagePreviewContainer.appendChild(img);
    removeImageBtn.style.display = "inline-block";
  } else {
    removeImageBtn.style.display = "none";
  }
}

// 画像削除ボタン
removeImageBtn.addEventListener("click", () => {
  currentImageData = "";
  modalImage.value = "";
  renderImagePreview();
});

// メモ・画像保存処理
saveDetailBtn.addEventListener("click", () => {
  const id = modalItemId.value;
  if (!id) return;

  expensesRef.child(id).update({
    note: modalNote.value,
    image: currentImageData
  }).then(() => {
    detailModal.style.display = "none";
  }).catch((error) => {
    console.error("更新エラー:", error);
    alert("保存に失敗しました");
  });
});
