// ===== Cấu hình =====
// URL Apps Script Web App RIÊNG của sổ cá nhân — phải là deployment khác với
// sổ gia đình, trỏ vào một Google Sheet khác, để hai sổ hoàn toàn tách biệt.
// Deploy lại (New deployment) thì URL đổi, nhớ sửa ở đây.
const API_URL = "https://script.google.com/macros/s/AKfycbyojlwjaXl4iq4zguZFS0FtedtuCVjSxK_c55VYijDbATqdh7Lg655cAlhNSVYRIYsu/exec";

// Mỗi danh mục trỏ đúng một lọ (xem LO_THEO_DANH_MUC trong logic.js).
// Danh mục ở đây là chi tiêu RIÊNG: chợ búa, hoá đơn, đồ dùng gia đình
// thuộc sổ gia đình nên không đưa vào để khỏi ghi trùng hai nơi.
const CATEGORIES_CHI = [
  "Ăn uống", "Cà phê/Nhậu", "Đi lại", "Điện thoại/Internet",
  "Sức khoẻ", "Mua sắm cá nhân", "Thể thao", "Giải trí",
  "Học tập", "Khác"
];
const CATEGORIES_THU = [
  "Lương", "Thưởng", "Tiền tiêu vặt", "Kinh doanh",
  "Được tặng", "Khác"
];
// Sổ cá nhân chỉ có một chủ sổ. Vẫn ghi trường này xuống Sheet để giữ nguyên
// cấu trúc cột, nhưng giao diện không cần hỏi "ai chi" nữa.
const PAYERS = ["Chương"];

// ===== Trạng thái =====
// Tiền tố khoá PHẢI khác sổ gia đình: hai app cùng chạy trên
// nguyenthanhchuong.github.io, mà localStorage phân tách theo origin chứ không
// theo đường dẫn. Dùng chung tiền tố thì PIN đè nhau, và nguy hiểm hơn là hàng
// chờ offline của sổ này có thể bị sổ kia gửi nhầm sang Sheet của nó.
const store = {
  get pin()      { return localStorage.getItem("ctcn_pin") || ""; },
  set pin(v)     { localStorage.setItem("ctcn_pin", v); },
  get payer()    { return localStorage.getItem("ctcn_payer") || PAYERS[0]; },
  set payer(v)   { localStorage.setItem("ctcn_payer", v); },
  get queue()    { try { return JSON.parse(localStorage.getItem("ctcn_queue") || "[]"); } catch { return []; } },
  set queue(v)   { localStorage.setItem("ctcn_queue", JSON.stringify(v)); }
};

let selectedKind = "Chi";                    // Chi hoặc Thu
let selectedCategory = CATEGORIES_CHI[0];
let selectedPayer = store.payer;
let entries = [];

// Trạng thái màn hình thống kê
let statMode = "thang";   // tuan | thang | quy | nam
let statOffset = 0;       // 0 = kỳ hiện tại, -1 = kỳ trước

function danhMucHienTai() {
  return selectedKind === "Thu" ? CATEGORIES_THU : CATEGORIES_CHI;
}

// ===== Tiện ích =====
// Phần tính toán nằm trong logic.js để test riêng được (xem test.html).
const $ = id => document.getElementById(id);
const formatMoney = Logic.formatMoney;
const parseAmount = Logic.parseAmount;
const laKhoanThu = Logic.laKhoanThu;
// Dùng laKhoanChi chứ ĐỪNG viết !laKhoanThu: loại Chuyển không phải Thu, nên
// phủ định laKhoanThu sẽ gom luôn khoản chuyển lọ vào tổng chi.
const laKhoanChi = Logic.laKhoanChi;
const friendlyError = Logic.friendlyError;

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

function todayKey() {
  return Logic.thangKey(new Date());
}

function ngayHomNay() {
  return Logic.ngayKey(new Date());
}

// Ô chọn ngày ở màn hình nhập. Giữ nguyên ngày sau khi lưu để anh ghi liền
// nhiều khoản của cùng một ngày cũ, nhưng đổi viền cho dễ nhận ra là đang
// không phải hôm nay.
function capNhatOngay() {
  const o = $("entry-date");
  if (!o) return;
  const khac = o.value !== ngayHomNay();
  o.classList.toggle("khac-hom-nay", khac);
  const nut = $("btn-homnay");
  if (nut) nut.hidden = !khac;
}

function initNgay() {
  const o = $("entry-date");
  if (!o) return;
  o.value = ngayHomNay();
  o.addEventListener("change", capNhatOngay);
  const nut = $("btn-homnay");
  if (nut) {
    nut.addEventListener("click", () => {
      o.value = ngayHomNay();
      capNhatOngay();
    });
  }
  capNhatOngay();
}

// ===== Gọi API =====
// Tăng mỗi lần sửa app, hiển thị ở màn hình PIN để biết máy đang chạy bản nào.
const APP_VERSION = "7";

// ===== Nhật ký dò lỗi =====
// Ghi vào localStorage nên còn nguyên kể cả khi trang tự nạp lại — đây là
// cách duy nhất nhìn thấy chuyện gì xảy ra khi màn hình không báo gì cả.
function ghiNhatKy(viec) {
  const d = new Date();
  const gio = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  let dong = [];
  try { dong = JSON.parse(localStorage.getItem("ctcn_log") || "[]"); } catch { dong = []; }
  dong.unshift(`${gio} ${viec}`);
  localStorage.setItem("ctcn_log", JSON.stringify(dong.slice(0, 6)));
  hienNhatKy();
}

function hienNhatKy() {
  const el = document.getElementById("gate-log");
  if (!el) return;
  let dong = [];
  try { dong = JSON.parse(localStorage.getItem("ctcn_log") || "[]"); } catch { dong = []; }
  if (!dong.length) { el.hidden = true; return; }
  el.textContent = dong.join("\n");
  el.style.whiteSpace = "pre-line";
  el.hidden = false;
}

const RETRY_DELAYS = [700, 1800, 3500]; // giãn dần, tránh dội liên tục vào Google
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Apps Script chuyển hướng khi trả kết quả nên phải dùng text/plain:
// tránh preflight CORS, nếu dùng application/json trình duyệt sẽ chặn.
async function callApiOnce(action, payload) {
  if (!API_URL) throw new Error("Chưa cấu hình API_URL");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, pin: store.pin, ...payload })
  });
  if (!res.ok) throw new Error("Máy chủ trả lỗi " + res.status);
  const data = await res.json();
  if (!data.ok) {
    const err = new Error(data.error || "Lỗi không rõ");
    // Sai PIN là lỗi cố định: thử lại bao nhiêu lần cũng vẫn sai.
    if (String(data.error || "").includes("PIN")) err.pinError = true;
    throw err;
  }
  return data;
}

// Google có lúc trả 404/5xx nhất thời khi đang xoay vòng phiên bản deploy,
// nên lỗi mạng được thử lại vài lần trước khi báo cho người dùng.
async function callApi(action, payload = {}, options = {}) {
  const maxRetry = options.retries === undefined ? 2 : options.retries;
  let lastErr;

  for (let lan = 0; lan <= maxRetry; lan++) {
    try {
      return await callApiOnce(action, payload);
    } catch (err) {
      lastErr = err;
      if (err.pinError) throw err;
      if (lan < maxRetry) {
        if (options.onRetry) options.onRetry(lan + 1, maxRetry);
        await sleep(RETRY_DELAYS[lan] || 3500);
      }
    }
  }
  throw lastErr;
}

// ===== Màn hình PIN =====
function initGate() {
  const gate = $("gate");
  const input = $("pin-input");
  const error = $("gate-error");
  const submitBtn = $("pin-submit");

  // silent = lần thử ngầm bằng mã đã lưu trong máy, không phải người dùng bấm.
  const openWith = async (pin, silent) => {
    if (!pin) {
      error.textContent = "Anh nhập PIN nhé.";
      error.hidden = false;
      return;
    }

    error.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Đang kiểm tra…";

    store.pin = pin;
    ghiNhatKy(silent ? "thử ngầm mã đã lưu" : `bấm Mở sổ (${pin.length} ký tự)`);
    try {
      await loadEntries({
        retries: 3,
        onRetry: (lan, tong) => {
          submitBtn.textContent = `Mạng chậm, thử lại ${lan}/${tong}…`;
          ghiNhatKy(`mạng lỗi, thử lại ${lan}/${tong}`);
        }
      });
      gate.hidden = true;
      $("app").hidden = false;
      ghiNhatKy("MỞ SỔ THÀNH CÔNG");
      flushQueue();
      // Tỉ lệ lấy từ Sheet để hai máy dùng chung, xong mới dồn dư tháng trước.
      napCaiDat().then(() => { render(); chayDonDu(); });
    } catch (err) {
      store.pin = "";
      // Dọn sạch ô nhập: nếu để mã cũ nằm lại, mã mới người dùng gõ sẽ bị
      // nối vào đuôi mã cũ và luôn luôn sai dù gõ đúng.
      input.value = "";
      error.textContent = (silent && err.pinError)
        ? "Mã PIN đã đổi, anh nhập mã mới nhé."
        : friendlyError(err);
      error.hidden = false;
      ghiNhatKy("thất bại: " + String(err && err.message || err).slice(0, 90));
      input.focus();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Mở sổ";
    }
  };

  const tryOpen = () => openWith(input.value.replace(/\s/g, ""), false);

  submitBtn.addEventListener("click", tryOpen);
  input.addEventListener("keydown", e => { if (e.key === "Enter") tryOpen(); });
  // Chỉ ẩn lỗi khi người dùng thực sự gõ phím. Trước đây bắt sự kiện "input"
  // nên trình quản lý mật khẩu tự điền cũng làm mất luôn thông báo lỗi.
  input.addEventListener("keydown", () => { error.hidden = true; });

  // Có mã lưu sẵn thì thử ngầm, KHÔNG đổ vào ô nhập để tránh dính mã cũ.
  if (store.pin) openWith(store.pin, true);
}

// Cho phép người dùng tự dọn bản cũ kẹt trong máy mà không cần vào cài đặt
// trình duyệt: gỡ service worker, xoá cache, rồi tải lại kèm đuôi chống đệm.
function initResetButton() {
  const nhan = $("app-version");
  if (nhan) nhan.textContent = "bản " + APP_VERSION;
  hienNhatKy();

  const btn = $("btn-reset");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Đang dọn…";
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      localStorage.removeItem("ctcn_pin");
      localStorage.removeItem("ctcn_log");
    } catch (err) {
      // Dọn được tới đâu hay tới đó, vẫn tải lại để lấy bản mới.
    }
    location.replace(location.pathname + "?moi=" + Date.now());
  });
}

// ===== Dựng các nút chọn =====
function renderChips() {
  // Chọn Thu hay Chi
  const kindBox = $("kinds");
  kindBox.innerHTML = "";
  ["Chi", "Thu"].forEach(k => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (k === selectedKind ? " on" : "");
    btn.textContent = k === "Chi" ? "Khoản chi" : "Khoản thu";
    btn.addEventListener("click", () => {
      if (selectedKind === k) return;
      selectedKind = k;
      // Danh mục hai loại khác nhau nên phải chọn lại mục đầu tiên,
      // tránh giữ lại danh mục không còn tồn tại trong danh sách mới.
      selectedCategory = danhMucHienTai()[0];
      renderChips();
    });
    kindBox.appendChild(btn);
  });

  // Sổ một người: hàng chọn người chi bị ẩn, chỉ dựng lại khi có từ 2 người.
  const payerRow = document.querySelector(".payer-row");
  if (payerRow) payerRow.hidden = PAYERS.length < 2;
  const payerLabel = $("payer-label");
  if (payerLabel) payerLabel.textContent = selectedKind === "Thu" ? "Người thu" : "Người chi";
  $("btn-save").textContent = selectedKind === "Thu" ? "Lưu khoản thu" : "Lưu khoản chi";

  const catBox = $("categories");
  catBox.innerHTML = "";
  danhMucHienTai().forEach(cat => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (cat === selectedCategory ? " on" : "");
    btn.textContent = cat;
    btn.addEventListener("click", () => {
      selectedCategory = cat;
      renderChips();
    });
    catBox.appendChild(btn);
  });

  const payBox = $("payers");
  payBox.innerHTML = "";
  PAYERS.forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (p === selectedPayer ? " on" : "");
    btn.textContent = p;
    btn.addEventListener("click", () => {
      selectedPayer = p;
      store.payer = p;
      renderChips();
    });
    payBox.appendChild(btn);
  });
}

function tatCaKhoan() {
  const queue = store.queue;
  return [...queue.map(q => ({ ...q, unsent: true })), ...entries];
}

// ===== Hiển thị dữ liệu =====
function render() {
  const month = todayKey();
  const queue = store.queue;
  const all = tatCaKhoan();

  const inMonth = all.filter(e => String(e.date || "").startsWith(month));
  const tongChi = inMonth.filter(laKhoanChi)
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  $("month-amount").textContent = formatMoney(tongChi) + " đ";

  const d = new Date();
  $("month-label").textContent = `Chi tháng ${d.getMonth() + 1}/${d.getFullYear()}`;

  // Tổng chi theo từng người. Một người thì con số này trùng hệt tổng tháng
  // ở ngay trên, nên bỏ hẳn cho đỡ rối.
  const box = $("by-person");
  box.innerHTML = "";
  box.hidden = PAYERS.length < 2;
  if (PAYERS.length >= 2) PAYERS.forEach(p => {
    const sum = inMonth
      .filter(e => e.payer === p && laKhoanChi(e))
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const card = document.createElement("div");
    card.className = "person-card";
    card.innerHTML = `<div class="person-name">${p}</div>
                      <div class="person-total">${formatMoney(sum)} đ</div>`;
    box.appendChild(card);
  });

  // Danh sách gần đây — hoặc kết quả tìm kiếm nếu đang lọc
  const list = $("recent-list");
  const dangLoc = coDieuKienLoc();
  const ketQua = dangLoc ? Logic.locKhoan(all, docDieuKienLoc()) : all;
  const recent = dangLoc ? ketQua.slice(0, 200) : ketQua.slice(0, 25);

  $("recent-title").textContent = dangLoc ? "Kết quả tìm" : "Gần đây";
  capNhatKetQuaLoc(ketQua, recent.length);

  if (!recent.length) {
    list.innerHTML = dangLoc
      ? '<p class="empty">Không tìm thấy khoản nào khớp.</p>'
      : '<p class="empty">Chưa có khoản nào.</p>';
  } else {
    list.innerHTML = "";
    recent.forEach(e => {
      const thu = laKhoanThu(e);
      const chuyen = Logic.laChuyenLo(e);
      const row = document.createElement("div");
      row.className = "item" + (e.unsent ? " unsent" : "");
      // Khoản chuyển lọ tiền không rời túi, nên không được hiện giống hệt một
      // khoản chi: chỉ ra chiều chuyển và dùng màu riêng, tránh nhìn nhầm.
      const tenLo = k => (Logic.timLo(k) || {}).ten || k || "?";
      const meta = chuyen
        ? [e.date, `${tenLo(e.jar)} → ${tenLo(e.jarTo)}`, e.note].filter(Boolean).join(" · ")
        : [e.date, e.payer, e.note].filter(Boolean).join(" · ");
      const lopTien = thu ? " thu" : (chuyen ? " chuyen" : "");
      const dauTien = thu ? "+" : (chuyen ? "⇄ " : "");
      row.innerHTML = `
        <div class="item-main">
          <div class="item-cat">${e.category || "Khác"}${e.unsent ? " ⏳" : ""}</div>
          <div class="item-meta">${meta}</div>
        </div>
        <div class="item-amount${lopTien}">${dauTien}${formatMoney(e.amount)} đ</div>`;
      // Khoản còn nằm trong hàng chờ thì chưa có trên Sheet, sửa chưa được.
      if (!e.unsent) {
        row.addEventListener("click", () => moHopSua(e.id));
      }
      list.appendChild(row);
    });
  }

  const badge = $("pending-badge");
  if (queue.length) {
    badge.textContent = `${queue.length} khoản chờ gửi`;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  renderStats();
  renderJars();
  renderVi();
}

// ===== Ví / nguồn tiền =====
// Ví trả lời "tiền đang NẰM Ở ĐÂU", lọ trả lời "tiền DÀNH CHO việc gì".
// Một khoản chi vừa trừ lọ vừa trừ ví — hai chiều độc lập nhau.
let caiDatVi = { ds: Logic.VI_MAC_DINH.slice(), soDuDau: {} };
let viDangChon = localStorage.getItem("ctcn_vi") || "";

function dsVi() { return Logic.danhSachVi(caiDatVi); }

function renderChipVi() {
  const box = $("vis");
  if (!box) return;
  const ds = dsVi();
  if (!ds.includes(viDangChon)) viDangChon = ds[0] || "";
  box.innerHTML = ds.map(v =>
    `<button type="button" class="chip${v === viDangChon ? " on" : ""}" data-vi="${v}">${v}</button>`
  ).join("");
  box.querySelectorAll(".chip").forEach(b => {
    b.addEventListener("click", () => {
      viDangChon = b.dataset.vi;
      localStorage.setItem("ctcn_vi", viDangChon);
      renderChipVi();
    });
  });
}

function renderVi() {
  const box = $("vi-list");
  if (!box) return;
  const kq = Logic.soDuCacVi(tatCaKhoan(), caiDatVi);

  // Khoản cũ chưa gán ví thì số dư chưa phản ánh đủ — phải nói rõ, nếu không
  // anh sẽ tin vào một con số thiếu mà không biết.
  const note = $("vi-chuagan");
  if (kq.chuaGanVi > 0) {
    note.textContent = `${kq.chuaGanVi} khoản cũ chưa gán ví nên chưa được tính vào số dư bên dưới. `
      + `Số dư đầu trong Cài đặt ví là chỗ để bù phần này.`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }

  const tong = kq.thuTu.reduce((s, v) => s + kq.vi[v].con, 0);
  box.innerHTML = kq.thuTu.map(v => {
    const o = kq.vi[v];
    const am = o.con < 0 ? " am" : "";
    return `
      <div class="jar">
        <div class="jar-top">
          <span class="jar-name">${o.ten}${o.ngoaiDs ? '<span class="jar-tag">đã bỏ</span>' : ""}</span>
          <span class="jar-left${am}">${formatMoney(o.con)} đ</span>
        </div>
        <div class="jar-sub">
          ${o.soDuDau ? `đầu ${formatMoney(o.soDuDau)}đ · ` : ""}vào ${formatMoney(o.thu + o.den)}đ · ra ${formatMoney(o.chi + o.di)}đ
        </div>
      </div>`;
  }).join("") + `
    <div class="jar vi-tong">
      <div class="jar-top">
        <span class="jar-name">Tổng các ví</span>
        <span class="jar-left${tong < 0 ? " am" : ""}">${formatMoney(tong)} đ</span>
      </div>
    </div>`;

  // Lịch sử chuyển ví gần đây
  const ls = tatCaKhoan().filter(Logic.laChuyenVi).slice(0, 8);
  $("vi-history").innerHTML = ls.length
    ? `<h3>Chuyển ví gần đây</h3>` + ls.map(e => `
        <div class="mv">
          <div class="mv-main">
            <div class="mv-name">${e.wallet} → ${e.walletTo}</div>
            <div class="mv-meta">${[e.date, e.note].filter(Boolean).join(" · ")}</div>
          </div>
          <div class="mv-num">${formatMoney(e.amount)} đ</div>
        </div>`).join("")
    : "";
}

function moHopChuyenVi() {
  const ds = dsVi();
  const opt = ds.map(v => `<option value="${v}">${v}</option>`).join("");
  $("cv-from").innerHTML = opt;
  $("cv-to").innerHTML = opt;
  if (ds[1]) $("cv-to").value = ds[1];
  $("cv-amount").value = "";
  $("cv-note").value = "";
  $("cv-date").value = ngayHomNay();
  $("cv-error").hidden = true;
  $("chuyenvi-sheet").hidden = false;
}

async function luuChuyenVi() {
  const tu = $("cv-from").value;
  const den = $("cv-to").value;
  const tien = parseAmount($("cv-amount").value);

  const kt = Logic.kiemTraChuyenVi(tu, den, tien);
  if (!kt.duoc) {
    $("cv-error").textContent = kt.loi;
    $("cv-error").hidden = false;
    return;
  }

  const entry = {
    id: "cv-" + Date.now(),
    date: $("cv-date").value || ngayHomNay(),
    amount: tien,
    category: "Chuyển ví",
    note: $("cv-note").value.trim(),
    payer: selectedPayer,
    type: "Chuyển ví",
    wallet: tu,
    walletTo: den
  };

  const nut = $("cv-ok");
  nut.disabled = true;
  nut.textContent = "Đang chuyển…";
  try {
    await callApi("add", { entry }, { retries: 2 });
    entries.unshift(entry);
    $("chuyenvi-sheet").hidden = true;
    showToast(`Đã chuyển ${formatMoney(tien)} đ`);
    render();
  } catch (err) {
    $("cv-error").textContent = friendlyError(err);
    $("cv-error").hidden = false;
  } finally {
    nut.disabled = false;
    nut.textContent = "Chuyển";
  }
}

function moHopCaiDatVi() {
  veDongCaiDatVi(dsVi());
  $("caidatvi-error").hidden = true;
  $("caidatvi-sheet").hidden = false;
}

function veDongCaiDatVi(ds) {
  const box = $("caidatvi-rows");
  box.innerHTML = ds.map((v, i) => `
    <div class="vi-nhap" data-i="${i}">
      <input type="text" class="note-input vi-ten" value="${v}" placeholder="Tên ví">
      <input type="text" class="note-input vi-dau" inputmode="numeric"
             placeholder="Số dư đầu"
             value="${caiDatVi.soDuDau[v] ? formatMoney(caiDatVi.soDuDau[v]) : ""}">
      <button type="button" class="vi-xoa" title="Bỏ ví này">✕</button>
    </div>`).join("");

  box.querySelectorAll(".vi-dau").forEach(o => {
    o.addEventListener("input", () => {
      const n = parseAmount(o.value);
      o.value = n ? formatMoney(n) : "";
    });
  });
  box.querySelectorAll(".vi-xoa").forEach(b => {
    b.addEventListener("click", () => b.closest(".vi-nhap").remove());
  });
}

async function luuCaiDatVi() {
  const ds = [];
  const soDuDau = {};
  $("caidatvi-rows").querySelectorAll(".vi-nhap").forEach(d => {
    const ten = d.querySelector(".vi-ten").value.trim();
    if (!ten || ds.includes(ten)) return;
    ds.push(ten);
    const n = parseAmount(d.querySelector(".vi-dau").value);
    if (n > 0) soDuDau[ten] = n;
  });

  if (!ds.length) {
    $("caidatvi-error").textContent = "Cần ít nhất một ví.";
    $("caidatvi-error").hidden = false;
    return;
  }

  const nut = $("caidatvi-ok");
  nut.disabled = true;
  nut.textContent = "Đang lưu…";
  try {
    const moi = { ds, soDuDau };
    await callApi("setSettings", { settings: { vi: moi } }, { retries: 2 });
    caiDatVi = moi;
    $("caidatvi-sheet").hidden = true;
    showToast("Đã lưu cài đặt ví");
    renderChipVi();
    render();
  } catch (err) {
    $("caidatvi-error").textContent = friendlyError(err);
    $("caidatvi-error").hidden = false;
  } finally {
    nut.disabled = false;
    nut.textContent = "Lưu";
  }
}

function initVi() {
  renderChipVi();
  if ($("btn-chuyen-vi")) $("btn-chuyen-vi").addEventListener("click", moHopChuyenVi);
  if ($("cv-cancel")) $("cv-cancel").addEventListener("click", () => { $("chuyenvi-sheet").hidden = true; });
  if ($("cv-ok")) $("cv-ok").addEventListener("click", luuChuyenVi);
  if ($("btn-caidat-vi")) $("btn-caidat-vi").addEventListener("click", moHopCaiDatVi);
  if ($("caidatvi-cancel")) $("caidatvi-cancel").addEventListener("click", () => { $("caidatvi-sheet").hidden = true; });
  if ($("caidatvi-ok")) $("caidatvi-ok").addEventListener("click", luuCaiDatVi);
  if ($("btn-them-vi")) {
    $("btn-them-vi").addEventListener("click", () => {
      const dangCo = [...$("caidatvi-rows").querySelectorAll(".vi-ten")].map(o => o.value.trim());
      veDongCaiDatVi(dangCo.concat([""]));
    });
  }
}

// ===== Hạn mức chi tiêu =====
let hanMuc = {};   // { "Ăn uống": 3000000, ... }, lấy từ Sheet cùng chỗ với tỉ lệ lọ

function thangDangXem() {
  // Hạn mức chỉ có nghĩa theo tháng, nên dùng đúng tháng đang chọn ở Thống kê.
  // khoangKy trả về đối tượng Date, KHÔNG phải chuỗi — cắt chuỗi thẳng sẽ ra
  // "Tue Sep" thay vì "2026-09", làm hạn mức không khớp khoản nào.
  const { dau } = Logic.khoangKy("thang", statOffset, new Date());
  return Logic.thangKey(dau);
}

function renderHanMuc() {
  const box = $("hanmuc-block");
  if (!box) return;

  // Xem theo tuần/quý/năm thì ghép hạn mức tháng vào sẽ ra số vô nghĩa.
  if (statMode !== "thang") {
    box.innerHTML = `
      <div class="stat-head">
        <h3>Hạn mức chi</h3>
        <button type="button" class="link-btn" id="btn-hanmuc">Đặt hạn mức</button>
      </div>
      <p class="hm-trong">Hạn mức tính theo tháng — chuyển sang mục <b>Tháng</b> để xem.</p>`;
    ganNutHanMuc();
    return;
  }

  const thang = thangDangXem();
  const ds = Logic.trangThaiHanMuc(tatCaKhoan(), thang, hanMuc);
  const tt = Logic.tomTatHanMuc(ds);

  // Một dòng hạn mức (dùng chung cho cả lọ và mục con)
  const veDong = (x, la) => {
    const rong = Math.min(100, x.phanTram);
    const conLai = x.conLai >= 0
      ? `còn ${formatMoney(x.conLai)}đ`
      : `vượt ${formatMoney(-x.conLai)}đ`;
    return `
      <div class="hm-hang ${x.mucDo}${la ? " la" : ""}">
        <div class="hm-dong1">
          <span class="hm-ten">${x.ten}</span>
          <span class="hm-phantram">${x.phanTram}%</span>
        </div>
        <div class="hm-thanh"><span style="width:${rong}%"></span></div>
        <div class="hm-dong2">
          <span>${formatMoney(x.daChi)} / ${formatMoney(x.hanMuc)}đ</span>
          <span class="hm-conlai">${conLai}</span>
        </div>
      </div>`;
  };

  let than;
  if (!ds.length) {
    than = `<p class="hm-trong">Chưa đặt hạn mức nào. Đặt hạn mức cho cả lọ
            (vd Thiết yếu) và cho mục nhỏ bên trong (vd Ăn uống) để app cảnh báo sớm.</p>`;
  } else {
    const canhBao = tt.vuot
      ? `<p class="hm-tomtat vuot">${tt.vuot} mức đã bị vượt</p>`
      : (tt.sapVuot ? `<p class="hm-tomtat sap-vuot">${tt.sapVuot} mức sắp chạm trần</p>` : "");

    than = canhBao + ds.map(lo => {
      // Lọ có đặt hạn mức thì vẽ thanh; không đặt thì chỉ làm tiêu đề nhóm
      const dauLo = lo.hanMuc
        ? veDong(lo, false)
        : `<div class="hm-nhomlo">
             <span class="hm-ten">${lo.ten}</span>
             <span class="hm-daChi">đã chi ${formatMoney(lo.daChi)}đ</span>
           </div>`;
      const con = lo.mucCon.map(m => veDong(m, true)).join("");
      return `<div class="hm-lo">${dauLo}${con}</div>`;
    }).join("");
  }

  box.innerHTML = `
    <div class="stat-head">
      <h3>Hạn mức tháng ${Number(thang.slice(5, 7))}</h3>
      <button type="button" class="link-btn" id="btn-hanmuc">Đặt hạn mức</button>
    </div>
    ${than}`;
  ganNutHanMuc();
}

function ganNutHanMuc() {
  const n = $("btn-hanmuc");
  if (n) n.addEventListener("click", moHopHanMuc);
}

function moHopHanMuc() {
  const box = $("hanmuc-rows");
  const hm = Logic.chuanHoaHanMuc(hanMuc);

  // Gom danh mục chi theo lọ để anh thấy rõ mục nào nằm trong lọ nào
  const theoLo = {};
  CATEGORIES_CHI.forEach(muc => {
    const k = Logic.doanLo(muc);
    (theoLo[k] = theoLo[k] || []).push(muc);
  });

  box.innerHTML = Logic.LOS.filter(lo => theoLo[lo.key]).map(lo => `
    <div class="hm-nhom">
      <div class="hm-nhom-dau">
        <span class="hm-nhom-ten">${lo.ten}</span>
        <span class="hm-nhom-tag">cả lọ</span>
      </div>
      <input type="text" class="note-input" data-lo="${lo.key}"
             inputmode="numeric" placeholder="Không đặt"
             value="${hm.lo[lo.key] ? formatMoney(hm.lo[lo.key]) : ""}">
      ${theoLo[lo.key].map(muc => `
        <div class="hm-nhap con">
          <label class="sheet-label">${muc}</label>
          <input type="text" class="note-input" data-muc="${muc}"
                 inputmode="numeric" placeholder="Không đặt"
                 value="${hm.muc[muc] ? formatMoney(hm.muc[muc]) : ""}">
        </div>`).join("")}
    </div>`).join("");

  // Gõ tới đâu chấm phân cách tới đó cho dễ đọc số lớn
  box.querySelectorAll("input").forEach(o => {
    o.addEventListener("input", () => {
      const v = parseAmount(o.value);
      o.value = v ? formatMoney(v) : "";
    });
  });

  $("hanmuc-error").hidden = true;
  $("hanmuc-sheet").hidden = false;
}

async function luuHanMuc() {
  const moi = { lo: {}, muc: {} };
  $("hanmuc-rows").querySelectorAll("input").forEach(o => {
    const v = parseAmount(o.value);
    if (!(v > 0)) return;
    if (o.dataset.lo) moi.lo[o.dataset.lo] = v;
    else if (o.dataset.muc) moi.muc[o.dataset.muc] = v;
  });

  const nut = $("hanmuc-ok");
  nut.disabled = true;
  nut.textContent = "Đang lưu…";
  try {
    // ghiCaiDat bên Apps Script ghi theo TỪNG KHOÁ, nên gửi mỗi hanMuc
    // không làm mất tỉ lệ lọ đang lưu.
    await callApi("setSettings", { settings: { hanMuc: moi } }, { retries: 2 });
    hanMuc = moi;
    $("hanmuc-sheet").hidden = true;
    showToast("Đã lưu hạn mức");
    render();
  } catch (err) {
    $("hanmuc-error").textContent = friendlyError(err);
    $("hanmuc-error").hidden = false;
  } finally {
    nut.disabled = false;
    nut.textContent = "Lưu hạn mức";
  }
}

// Cảnh báo ngay lúc vừa ghi xong — đây mới là lúc nhắc có tác dụng,
// chứ vào Thống kê xem thì tiền đã tiêu rồi.
function canhBaoSauKhiGhi(khoan) {
  if (!khoan || !laKhoanChi(khoan)) return;
  const thang = String(khoan.date || "").slice(0, 7);
  const loKey = Logic.loCuaKhoan(khoan);
  const ds = Logic.trangThaiHanMuc(tatCaKhoan(), thang, hanMuc);
  const lo = ds.find(l => l.key === loKey);
  if (!lo) return;

  // Ưu tiên báo mục nhỏ (cụ thể hơn), không có thì báo cả lọ.
  const mucCon = (lo.mucCon || []).find(m => m.muc === khoan.category);
  const x = (mucCon && mucCon.mucDo !== "an-toan") ? mucCon
          : (lo.hanMuc && lo.mucDo !== "an-toan" ? lo : mucCon);
  if (!x || x.mucDo === "an-toan") return;

  if (x.mucDo === "vuot") {
    showToast(`⚠️ ${x.ten} đã vượt hạn mức ${formatMoney(-x.conLai)}đ`);
  } else {
    showToast(`${x.ten} còn ${formatMoney(x.conLai)}đ là chạm hạn mức`);
  }
}

function initHanMuc() {
  if ($("hanmuc-cancel")) {
    $("hanmuc-cancel").addEventListener("click", () => { $("hanmuc-sheet").hidden = true; });
  }
  if ($("hanmuc-ok")) $("hanmuc-ok").addEventListener("click", luuHanMuc);
}

// ===== Tìm kiếm khoản =====
const LOAI_LOC = [
  { key: "tat-ca", ten: "Tất cả" },
  { key: "chi",    ten: "Chi" },
  { key: "thu",    ten: "Thu" },
  { key: "chuyen", ten: "Chuyển" }
];
let loaiLocDangChon = "tat-ca";

function docDieuKienLoc() {
  return {
    chu: ($("tim-chu") && $("tim-chu").value) || "",
    loai: loaiLocDangChon,
    tu: ($("tim-tu") && $("tim-tu").value) || "",
    den: ($("tim-den") && $("tim-den").value) || ""
  };
}

function coDieuKienLoc() {
  const d = docDieuKienLoc();
  return !!(d.chu.trim() || d.tu || d.den || d.loai !== "tat-ca");
}

// Hiện số khoản tìm được và tổng tiền — con số này mới là thứ đáng xem,
// chứ không phải chỉ danh sách.
function capNhatKetQuaLoc(ketQua, soHien) {
  const o = $("tim-ketqua");
  if (!o) return;
  if (!coDieuKienLoc()) { o.textContent = ""; return; }
  const t = Logic.tongKetLoc(ketQua);
  const phan = [`${t.soKhoan} khoản`];
  if (t.chi) phan.push(`chi ${formatMoney(t.chi)}đ`);
  if (t.thu) phan.push(`thu ${formatMoney(t.thu)}đ`);
  if (t.chuyen) phan.push(`chuyển ${formatMoney(t.chuyen)}đ`);
  if (soHien < t.soKhoan) phan.push(`(hiện ${soHien})`);
  o.textContent = phan.join(" · ");
}

function renderChipLoc() {
  const box = $("tim-loai");
  if (!box) return;
  box.innerHTML = LOAI_LOC.map(l =>
    `<button type="button" class="chip${l.key === loaiLocDangChon ? " on" : ""}" data-loai="${l.key}">${l.ten}</button>`
  ).join("");
  box.querySelectorAll(".chip").forEach(b => {
    b.addEventListener("click", () => {
      loaiLocDangChon = b.dataset.loai;
      renderChipLoc();
      render();
    });
  });
}

function xoaLoc() {
  if ($("tim-chu")) $("tim-chu").value = "";
  if ($("tim-tu")) $("tim-tu").value = "";
  if ($("tim-den")) $("tim-den").value = "";
  loaiLocDangChon = "tat-ca";
  renderChipLoc();
  render();
}

function initTim() {
  const nut = $("btn-tim");
  const box = $("tim-box");
  if (!nut || !box) return;
  renderChipLoc();

  nut.addEventListener("click", () => {
    box.hidden = !box.hidden;
    nut.textContent = box.hidden ? "Tìm khoản" : "Đóng tìm";
    if (!box.hidden && $("tim-chu")) $("tim-chu").focus();
    // Đóng bảng tìm thì bỏ luôn bộ lọc, tránh anh tưởng sổ mất khoản
    if (box.hidden && coDieuKienLoc()) xoaLoc();
  });

  let hen;
  const goTim = () => { clearTimeout(hen); hen = setTimeout(render, 250); };
  if ($("tim-chu")) $("tim-chu").addEventListener("input", goTim);
  if ($("tim-tu")) $("tim-tu").addEventListener("change", render);
  if ($("tim-den")) $("tim-den").addEventListener("change", render);
  if ($("btn-xoa-tim")) $("btn-xoa-tim").addEventListener("click", xoaLoc);
}

// ===== Thống kê =====
const STAT_MODES = [
  { key: "tuan",  ten: "Tuần" },
  { key: "thang", ten: "Tháng" },
  { key: "quy",   ten: "Quý" },
  { key: "nam",   ten: "Năm" }
];

function theTongKet(ten, tien, kieu) {
  return `<div class="stat-card${kieu === "con" ? " wide" : ""}">
            <div class="stat-name">${ten}</div>
            <div class="stat-value ${kieu}">${tien}</div>
          </div>`;
}

// Vẽ danh sách có thanh tỉ lệ, dùng chung cho phần theo danh mục và theo người.
function veThanh(container, tieuDe, hang, kieu, loaiChiTiet) {
  if (!hang.length) {
    container.innerHTML = `<h3>${tieuDe}</h3><p class="empty">Chưa có số liệu.</p>`;
    return;
  }
  const lonNhat = Math.max(...hang.map(h => h.tien));
  const tong = hang.reduce((s, h) => s + h.tien, 0);

  container.innerHTML = `<h3>${tieuDe}</h3>` + hang.map(h => {
    const rong = lonNhat > 0 ? Math.round((h.tien / lonNhat) * 100) : 0;
    const pct = tong > 0 ? Math.round((h.tien / tong) * 100) : 0;
    return `<div class="bar-row${loaiChiTiet ? " bam-duoc" : ""}" data-muc="${h.ten}">
              <div class="bar-head">
                <span class="bar-name">${h.ten}</span>
                <span class="bar-num">${formatMoney(h.tien)} đ<span class="bar-pct">${pct}%</span></span>
              </div>
              <div class="bar-track">
                <div class="bar-fill${kieu === "thu" ? " thu" : ""}" style="width:${rong}%"></div>
              </div>
            </div>`;
  }).join("");

  if (loaiChiTiet) {
    container.querySelectorAll(".bar-row").forEach(el => {
      el.addEventListener("click", () => moChiTietMuc(loaiChiTiet, el.dataset.muc));
    });
  }
}

// ===== Biểu đồ diễn biến theo tháng =====
// Vẽ bằng SVG viết tay, không kéo thư viện ngoài: app phải mở được cả khi
// mất mạng, mà thư viện tải từ CDN thì hỏng đúng lúc đó.
const CHART_SO_THANG = 6;

// Đọc màu từ biến CSS thay vì ghi cứng, để đổi tông màu chỉ phải sửa một chỗ
// trong style.css và biểu đồ tự đổi theo cả chế độ sáng lẫn tối.
function mauCss(ten, duPhong) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(ten).trim();
  return v || duPhong;
}

let chartKieu = "cot";        // cot | duong
let chartChuoi = "thuchi";    // thuchi | danhMucChi:Ăn uống | nguonThu:Lương ...

function nhanThangNgan(thang) {
  const [n, t] = String(thang).split("-");
  return `T${Number(t)}`;
}

// Trả về các chuỗi số liệu cần vẽ, tuỳ lựa chọn của người dùng.
function layDuLieuBieuDo() {
  const denThang = thangHienTai();
  const ds = tatCaKhoan();

  if (chartChuoi === "thuchi") {
    const d = Logic.dienBienTheoThang(ds, denThang, CHART_SO_THANG);
    return {
      thangs: d.map(x => x.thang),
      chuoi: [
        { ten: "Thu", mau: mauCss("--thu", "#2f7d5f"), giaTri: d.map(x => x.thu) },
        { ten: "Chi", mau: mauCss("--accent", "#b85252"), giaTri: d.map(x => x.chi) }
      ]
    };
  }

  const [loai, giaTri] = chartChuoi.split(":");
  const d = Logic.dienBienMuc(ds, denThang, CHART_SO_THANG, loai, giaTri);
  return {
    thangs: d.map(x => x.thang),
    chuoi: [{
      ten: giaTri,
      mau: loai === "nguonThu" ? mauCss("--thu", "#2f7d5f") : mauCss("--accent", "#b85252"),
      giaTri: d.map(x => x.tien)
    }]
  };
}

function veBieuDo() {
  const khung = $("chart-area");
  if (!khung) return;

  const { thangs, chuoi } = layDuLieuBieuDo();
  const tatCaSo = chuoi.reduce((a, c) => a.concat(c.giaTri), []);
  const dinh = Math.max(...tatCaSo, 0);

  if (dinh <= 0) {
    khung.innerHTML = `<p class="chart-empty">Chưa có số liệu trong ${CHART_SO_THANG} tháng gần đây.</p>`;
    $("chart-legend").innerHTML = "";
    return;
  }

  // Toạ độ trong hệ viewBox, SVG tự co giãn theo bề ngang màn hình.
  const W = 320, H = 170, traiL = 34, phaiL = 6, trenL = 10, duoiL = 22;
  const vungW = W - traiL - phaiL;
  const vungH = H - trenL - duoiL;
  const y = v => trenL + vungH - (v / dinh) * vungH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ theo tháng">`;

  // Ba đường kẻ ngang làm mốc đọc
  [0, 0.5, 1].forEach(p => {
    const yy = trenL + vungH - p * vungH;
    svg += `<line x1="${traiL}" y1="${yy}" x2="${W - phaiL}" y2="${yy}"
                  stroke="var(--line)" stroke-width="1"/>`;
    svg += `<text x="${traiL - 4}" y="${yy + 3}" text-anchor="end"
                  font-size="8" fill="var(--muted)">${Logic.formatNgan(dinh * p)}</text>`;
  });

  const buoc = vungW / thangs.length;

  if (chartKieu === "cot") {
    const rongCum = buoc * 0.62;
    const rongCot = rongCum / chuoi.length;
    thangs.forEach((t, i) => {
      const x0 = traiL + i * buoc + (buoc - rongCum) / 2;
      chuoi.forEach((c, j) => {
        const v = c.giaTri[i];
        const cao = Math.max(0, trenL + vungH - y(v));
        svg += `<rect x="${x0 + j * rongCot}" y="${y(v)}"
                      width="${rongCot - 1.5}" height="${cao}"
                      fill="${c.mau}" rx="1.5"><title>${c.ten} ${nhanThangNgan(t)}: ${formatMoney(v)} đ</title></rect>`;
      });
    });
  } else {
    chuoi.forEach(c => {
      const diem = c.giaTri.map((v, i) => `${traiL + buoc * (i + 0.5)},${y(v)}`).join(" ");
      svg += `<polyline points="${diem}" fill="none" stroke="${c.mau}"
                        stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      c.giaTri.forEach((v, i) => {
        svg += `<circle cx="${traiL + buoc * (i + 0.5)}" cy="${y(v)}" r="2.6"
                        fill="${c.mau}"><title>${c.ten} ${nhanThangNgan(thangs[i])}: ${formatMoney(v)} đ</title></circle>`;
      });
    });
  }

  thangs.forEach((t, i) => {
    svg += `<text x="${traiL + buoc * (i + 0.5)}" y="${H - 7}" text-anchor="middle"
                  font-size="9" fill="var(--muted)">${nhanThangNgan(t)}</text>`;
  });

  svg += `</svg>`;
  khung.innerHTML = svg;

  $("chart-legend").innerHTML = chuoi.map(c =>
    `<span><i style="background:${c.mau}"></i>${c.ten}</span>`).join("");
}

function renderChartControls() {
  const oKieu = $("chart-kind");
  if (!oKieu) return;

  oKieu.innerHTML = [["cot", "Cột"], ["duong", "Đường"]].map(([k, ten]) =>
    `<button type="button" class="chip${k === chartKieu ? " on" : ""}" data-kieu="${k}">${ten}</button>`
  ).join("");
  oKieu.querySelectorAll(".chip").forEach(b => {
    b.addEventListener("click", () => {
      chartKieu = b.dataset.kieu;
      renderChartControls();
      veBieuDo();
    });
  });

  // Danh sách chọn: gộp cả nguồn thu, danh mục chi và người, để anh xem
  // diễn biến của đúng mục mình quan tâm.
  const oChuoi = $("chart-series");
  const nhomThu = CATEGORIES_THU.map(c => `<option value="nguonThu:${c}">Thu · ${c}</option>`).join("");
  const nhomChi = CATEGORIES_CHI.map(c => `<option value="danhMucChi:${c}">Chi · ${c}</option>`).join("");
  // Một người thì "Chi bởi X" trùng với tổng chi, bỏ cho gọn danh sách.
  const nhomNguoi = PAYERS.length < 2 ? ""
    : PAYERS.map(p => `<option value="nguoiChi:${p}">Chi bởi ${p}</option>`).join("");

  oChuoi.innerHTML =
    `<option value="thuchi">Tổng thu và tổng chi</option>` + nhomThu + nhomChi + nhomNguoi;
  oChuoi.value = chartChuoi;
  oChuoi.onchange = () => { chartChuoi = oChuoi.value; veBieuDo(); };
}

function renderStats() {
  const modeBox = $("stat-modes");
  if (!modeBox) return;

  modeBox.innerHTML = "";
  STAT_MODES.forEach(m => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (m.key === statMode ? " on" : "");
    btn.textContent = m.ten;
    btn.addEventListener("click", () => {
      if (statMode === m.key) return;
      statMode = m.key;
      statOffset = 0;   // đổi kiểu kỳ thì quay về kỳ hiện tại cho khỏi lạc
      renderStats();
    });
    modeBox.appendChild(btn);
  });

  const { dau, cuoi } = Logic.khoangKy(statMode, statOffset);
  $("stat-label").textContent = Logic.nhanKy(statMode, dau, cuoi);
  $("stat-next").disabled = statOffset >= 0;   // không cho xem tương lai

  const kq = Logic.tongHopKy(
    tatCaKhoan(), Logic.ngayKey(dau), Logic.ngayKey(cuoi), PAYERS
  );

  $("stat-summary").innerHTML =
    theTongKet("Thu", formatMoney(kq.tongThu) + " đ", "thu") +
    theTongKet("Chi", formatMoney(kq.tongChi) + " đ", "chi") +
    theTongKet("Còn lại",
      (kq.conLai < 0 ? "−" : "") + formatMoney(Math.abs(kq.conLai)) + " đ",
      kq.conLai < 0 ? "am con" : "con");

  renderChartControls();
  veBieuDo();

  veThanh($("stat-by-income"), "Thu theo nguồn", kq.theoNguonThu, "thu", "nguonThu");
  veThanh($("stat-by-cat"), "Chi theo danh mục", kq.theoDanhMuc, "chi", "danhMucChi");
  veThanh($("stat-by-person"), "Chi theo người", kq.theoNguoi, "chi", "nguoiChi");
}

// ===== Màn hình bốn lọ =====
// Hai đích chỉ nhận chuyển vào, không tham gia phân bổ: tiền vào đây là
// tài sản (vàng, sổ tiết kiệm), không còn là tiền mặt trong lọ.
const DICH_TAI_SAN = [
  { key: "DAU_TU",    ten: "Đã đầu tư" },
  { key: "TIET_KIEM", ten: "Đã gửi tiết kiệm" }
];

let tiLeLo = Logic.tiLeMacDinh();
let loNhanDu = Logic.LO_MAC_DINH_NHAN_DU;

function thangHienTai() { return Logic.thangKey(new Date()); }

function tenDich(key) {
  const ts = DICH_TAI_SAN.find(d => d.key === key);
  if (ts) return ts.ten;
  const lo = Logic.timLo(key);
  return lo ? lo.ten : key;
}

// Số dư hai đích tài sản: chỉ cộng những gì đã chuyển vào.
function soDuTaiSan(khoan) {
  const kq = {};
  DICH_TAI_SAN.forEach(d => { kq[d.key] = 0; });
  (khoan || []).filter(Logic.laChuyenLo).forEach(e => {
    if (kq[e.jarTo] !== undefined) kq[e.jarTo] += Number(e.amount) || 0;
  });
  return kq;
}

function renderJars() {
  const box = $("jar-list");
  if (!box) return;

  const thang = thangHienTai();
  const ds = tatCaKhoan();
  const soDu = Logic.soDuCacLo(ds, thang, tiLeLo);

  const d = new Date();
  $("jar-month").textContent = `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;

  box.innerHTML = Logic.LOS.map(lo => {
    const s = soDu[lo.key];
    const tiLeDung = s.vao > 0 ? Math.min(100, Math.round((s.ra / s.vao) * 100)) : 0;
    const am = s.con < 0;
    return `
      <div class="jar" data-lo="${lo.key}">
        <div class="jar-top">
          <span class="jar-name">${lo.ten}<span class="jar-tag">${lo.congDon ? "cộng dồn" : "theo tháng"}</span></span>
          <span class="jar-left${am ? " am" : ""}">${am ? "−" : ""}${formatMoney(Math.abs(s.con))} đ</span>
        </div>
        <div class="jar-sub">Vào ${formatMoney(s.vao)} đ · đã dùng ${formatMoney(s.ra)} đ<span class="jar-more">xem chi tiết ›</span></div>
        <div class="jar-bar">
          <div class="jar-fill${am ? " hetsach" : ""}" style="width:${am ? 100 : tiLeDung}%"></div>
        </div>
      </div>`;
  }).join("");

  box.querySelectorAll(".jar").forEach(el => {
    el.addEventListener("click", () => moChiTietLo(el.dataset.lo));
  });

  // Phần đã chuyển thành tài sản
  const ts = soDuTaiSan(ds);
  const coTaiSan = DICH_TAI_SAN.some(d2 => ts[d2.key] > 0);
  $("jar-assets").innerHTML = coTaiSan
    ? `<h3>Đã chuyển thành tài sản</h3>` + DICH_TAI_SAN
        .filter(d2 => ts[d2.key] > 0)
        .map(d2 => `<div class="bar-row"><div class="bar-head">
              <span class="bar-name">${d2.ten}</span>
              <span class="bar-num">${formatMoney(ts[d2.key])} đ</span>
            </div></div>`).join("")
    : `<h3>Đã chuyển thành tài sản</h3><p class="empty">Chưa có. Khi anh mang tiền đi đầu tư hay gửi tiết kiệm, chuyển vào đây để lọ phản ánh đúng tiền mặt còn lại.</p>`;

  // Lịch sử chuyển lọ
  const ls = ds.filter(Logic.laChuyenLo).slice(0, 12);
  $("jar-history").innerHTML = `<h3>Lịch sử chuyển lọ</h3>` + (ls.length
    ? ls.map(e => `<div class="ca-move bar-row"><div class="bar-head">
          <span class="bar-name">${tenDich(e.jar)} → ${tenDich(e.jarTo)}</span>
          <span class="bar-num">${formatMoney(e.amount)} đ</span>
        </div><div class="item-meta">${[e.date, e.note].filter(Boolean).join(" · ")}</div></div>`).join("")
    : `<p class="empty">Chưa có lần chuyển nào.</p>`);
}

// ===== Sửa / xoá một khoản đã ghi =====
let khoanDangSua = null;

function moHopSua(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  khoanDangSua = e;

  const laThu = laKhoanThu(e);
  const laChuyen = Logic.laChuyenLo(e);

  $("edit-meta").textContent =
    `${laThu ? "Khoản thu" : laChuyen ? "Chuyển lọ" : "Khoản chi"} · ghi ngày ${e.date}`;

  // Lệnh dồn dư do app tự tạo: xoá xong lần mở sau app sẽ tạo lại đúng lệnh đó,
  // vì nó dựa trên phần dư thực tế chứ không phải trên dòng đã ghi.
  const canhBao = $("edit-warn");
  if (String(e.id).startsWith("auto-")) {
    canhBao.textContent = "Đây là lệnh dồn dư app tự tạo. Xoá đi thì lần mở app sau nó sẽ được tạo lại, vì phần dư tháng đó vẫn còn.";
    canhBao.hidden = false;
  } else {
    canhBao.hidden = true;
  }

  $("edit-amount").value = formatMoney(e.amount);
  $("edit-date").value = e.date || ngayHomNay();

  // Chuyển lọ không có danh mục để chọn, chỉ sửa được số tiền và ghi chú.
  const oDanhMuc = $("edit-category");
  const dsDanhMuc = laChuyen ? ["Chuyển lọ"] : (laThu ? CATEGORIES_THU : CATEGORIES_CHI);
  oDanhMuc.innerHTML = dsDanhMuc.map(c =>
    `<option value="${c}"${c === e.category ? " selected" : ""}>${c}</option>`).join("");
  oDanhMuc.disabled = laChuyen;

  const oNguoi = $("edit-payer");
  oNguoi.innerHTML = PAYERS.map(p =>
    `<option value="${p}"${p === e.payer ? " selected" : ""}>${p}</option>`).join("");

  // Ví: cho phép để trống, vì khoản cũ nhập trước khi có tính năng này
  // đều chưa gán ví — ép chọn sẽ gán bừa và làm sai số dư.
  const oVi = $("edit-wallet");
  if (oVi) {
    const ds = dsVi();
    const hienTai = e.wallet || "";
    const themLa = hienTai && !ds.includes(hienTai) ? [hienTai] : [];
    oVi.innerHTML = `<option value=""${!hienTai ? " selected" : ""}>— chưa gán —</option>`
      + ds.concat(themLa).map(v =>
          `<option value="${v}"${v === hienTai ? " selected" : ""}>${v}</option>`).join("");
  }

  $("edit-note").value = e.note || "";
  $("edit-error").hidden = true;
  datLaiNutXoa();
  $("edit-sheet").hidden = false;
}

// Xoá là việc không lấy lại được, nên bắt bấm hai lần thay vì hộp xác nhận
// riêng — trên điện thoại hộp chồng hộp rất dễ bấm nhầm.
function datLaiNutXoa() {
  const btn = $("edit-delete");
  btn.textContent = "Xoá khoản này";
  btn.classList.remove("xacnhan");
  btn.dataset.xacnhan = "";
}

async function luuSuaKhoan() {
  if (!khoanDangSua) return;
  const tien = parseAmount($("edit-amount").value);
  const loi = $("edit-error");

  if (tien <= 0) {
    loi.textContent = "Số tiền phải lớn hơn 0.";
    loi.hidden = false;
    return;
  }
  loi.hidden = true;

  const cu = khoanDangSua;
  const laThu = laKhoanThu(cu);
  const danhMuc = $("edit-category").value;

  const moi = {
    ...cu,
    amount: tien,
    date: $("edit-date").value || cu.date,
    category: danhMuc,
    payer: $("edit-payer").value,
    note: $("edit-note").value.trim(),
    // Sửa số tiền khoản thu thì phải chia lại vào các lọ, nếu không số dư lọ
    // sẽ vẫn theo số cũ. Chia theo tỉ lệ hiện tại.
    alloc: laThu ? Logic.phanBo(tien, tiLeLo) : (cu.alloc || null),
    jar: Logic.laChuyenLo(cu) ? cu.jar : (laThu ? "" : Logic.doanLo(danhMuc)),
    // Khoản chuyển ví giữ nguyên cặp ví, không cho sửa lệch một đầu
    wallet: Logic.laChuyenVi(cu) ? cu.wallet : (($("edit-wallet") && $("edit-wallet").value) || "")
  };

  const btn = $("edit-save");
  btn.disabled = true;
  btn.textContent = "Đang lưu…";
  try {
    await callApi("update", { entry: moi }, { retries: 2 });
    const i = entries.findIndex(x => x.id === cu.id);
    if (i >= 0) entries[i] = moi;
    $("edit-sheet").hidden = true;
    showToast("Đã cập nhật khoản này");
    render();
  } catch (err) {
    loi.textContent = friendlyError(err);
    loi.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Lưu";
  }
}

async function xoaKhoanDangSua() {
  const btn = $("edit-delete");

  if (btn.dataset.xacnhan !== "roi") {
    btn.dataset.xacnhan = "roi";
    btn.textContent = "Bấm lần nữa để xoá hẳn";
    btn.classList.add("xacnhan");
    return;
  }

  if (!khoanDangSua) return;
  const loi = $("edit-error");
  btn.disabled = true;
  btn.textContent = "Đang xoá…";
  try {
    await callApi("delete", { id: khoanDangSua.id }, { retries: 2 });
    entries = entries.filter(x => x.id !== khoanDangSua.id);
    $("edit-sheet").hidden = true;
    showToast("Đã xoá khoản này");
    render();
  } catch (err) {
    loi.textContent = friendlyError(err);
    loi.hidden = false;
    datLaiNutXoa();
  } finally {
    btn.disabled = false;
  }
}

function initEdit() {
  if (!$("edit-sheet")) return;
  $("edit-cancel").addEventListener("click", () => { $("edit-sheet").hidden = true; });
  $("edit-save").addEventListener("click", luuSuaKhoan);
  $("edit-delete").addEventListener("click", xoaKhoanDangSua);
  $("edit-amount").addEventListener("input", e => {
    const n = parseAmount(e.target.value);
    e.target.value = n ? formatMoney(n) : "";
  });
}

// Hộp chi tiết dùng chung cho cả màn hình lọ lẫn bảng thống kê.
function moHopChiTiet(tieuDe, tomTat, ds, khiRong) {
  $("jar-detail-name").textContent = tieuDe;
  $("jar-detail-sum").textContent = tomTat;
  $("jar-detail-list").innerHTML = ds.length
    ? ds.map(d => `
        <div class="mv">
          <div class="mv-main">
            <div class="mv-name">${d.moTa}</div>
            <div class="mv-meta">${[d.date, d.note].filter(Boolean).join(" · ")}</div>
          </div>
          <div class="mv-num ${d.chieu}">${d.chieu === "vao" ? "+" : "−"}${formatMoney(d.tien)} đ</div>
        </div>`).join("")
    : `<p class="empty">${khiRong}</p>`;
  $("jar-sheet").hidden = false;
}

// Chi tiết một lọ: liệt kê mọi khoản đã tác động lên lọ đó.
// Danh sách này cộng lại đúng bằng số dư đang hiện (có ca test canh).
function moChiTietLo(loKey) {
  const lo = Logic.timLo(loKey);
  if (!lo) return;

  const thang = thangHienTai();
  const ds = Logic.chiTietLo(tatCaKhoan(), loKey, thang, tiLeLo);
  const soDu = Logic.soDuCacLo(tatCaKhoan(), thang, tiLeLo)[loKey];

  moHopChiTiet(
    lo.ten,
    `Còn ${formatMoney(soDu.con)} đ · vào ${formatMoney(soDu.vao)} đ · ra ${formatMoney(soDu.ra)} đ` +
      (lo.congDon ? " · cộng dồn từ trước tới nay" : " · tính trong tháng này"),
    ds,
    "Lọ này chưa có khoản nào trong kỳ đang xem."
  );
}

// Chi tiết một dòng trong bảng thống kê (nguồn thu / danh mục chi / người chi).
function moChiTietMuc(loai, giaTri) {
  const { dau, cuoi } = Logic.khoangKy(statMode, statOffset);
  const tuNgay = Logic.ngayKey(dau), denNgay = Logic.ngayKey(cuoi);
  const ds = Logic.chiTietMuc(tatCaKhoan(), tuNgay, denNgay, loai, giaTri);
  const tong = ds.reduce((s, d) => s + d.tien, 0);

  const nhan = {
    nguonThu: "Thu từ",
    danhMucChi: "Chi cho",
    nguoiChi: "Chi bởi"
  }[loai] || "";

  moHopChiTiet(
    `${nhan} ${giaTri}`,
    `${ds.length} khoản · tổng ${formatMoney(tong)} đ · ${Logic.nhanKy(statMode, dau, cuoi)}`,
    ds,
    "Không có khoản nào trong kỳ này."
  );
}

// Dồn dư tháng trước: chạy ngầm, ghi lịch sử, không hỏi anh mỗi lần.
async function chayDonDu() {
  const lenh = Logic.lenhChuyenTuDong(tatCaKhoan(), thangHienTai(), tiLeLo, loNhanDu);
  const nhan = $("jar-sweep-note");
  if (!lenh.length) { if (nhan) nhan.hidden = true; return; }

  try {
    await callApi("addMany", { entries: lenh });
    lenh.forEach(l => entries.unshift(l));
    if (nhan) {
      nhan.textContent = `Đã tự dồn phần dư tháng trước vào ${tenDich(loNhanDu)}: ` +
        lenh.map(l => `${tenDich(l.jar)} ${formatMoney(l.amount)} đ`).join(", ") +
        ". Xem chi tiết ở mục Lịch sử chuyển lọ.";
      nhan.hidden = false;
    }
    render();
  } catch (err) {
    if (nhan) {
      nhan.textContent = "Chưa dồn được phần dư tháng trước (" + friendlyError(err) +
        "). Tiền vẫn còn nguyên trên sổ, app sẽ thử lại lần mở sau.";
      nhan.hidden = false;
    }
  }
}

// ----- Hộp thoại chuyển tiền -----
function moHopChuyen() {
  const soDu = Logic.soDuCacLo(tatCaKhoan(), thangHienTai(), tiLeLo);

  const nguon = $("move-from"), dich = $("move-to");
  nguon.innerHTML = Logic.LOS.map(l =>
    `<option value="${l.key}">${l.ten} — còn ${formatMoney(soDu[l.key].con)} đ</option>`).join("");
  dich.innerHTML =
    Logic.LOS.map(l => `<option value="${l.key}">${l.ten}</option>`).join("") +
    DICH_TAI_SAN.map(d => `<option value="${d.key}">${d.ten}</option>`).join("");
  dich.value = "LTSS";

  $("move-amount").value = "";
  $("move-note").value = "";
  $("move-error").hidden = true;
  capNhatCanhBaoChuyen();
  $("move-sheet").hidden = false;
}

function capNhatCanhBaoChuyen() {
  const soDu = Logic.soDuCacLo(tatCaKhoan(), thangHienTai(), tiLeLo);
  const kt = Logic.kiemTraChuyen(
    $("move-from").value, $("move-to").value,
    parseAmount($("move-amount").value) || 1, soDu
  );
  const el = $("move-warn");
  if (kt.canhBao) { el.textContent = kt.canhBao; el.hidden = false; }
  else el.hidden = true;
}

async function luuChuyenLo() {
  const soDu = Logic.soDuCacLo(tatCaKhoan(), thangHienTai(), tiLeLo);
  const nguon = $("move-from").value, dich = $("move-to").value;
  const tien = parseAmount($("move-amount").value);
  const kt = Logic.kiemTraChuyen(nguon, dich, tien, soDu);

  const loi = $("move-error");
  if (!kt.duoc) { loi.textContent = kt.loi; loi.hidden = false; return; }
  loi.hidden = true;

  const now = new Date();
  const entry = {
    id: `mv-${now.getTime()}`,
    date: Logic.ngayKey(now),
    amount: tien,
    type: "Chuyển",
    jar: nguon,
    jarTo: dich,
    category: "Chuyển lọ",
    note: $("move-note").value.trim(),
    payer: selectedPayer
  };

  const btn = $("move-ok");
  btn.disabled = true;
  btn.textContent = "Đang chuyển…";
  try {
    await callApi("add", { entry }, { retries: 2 });
    entries.unshift(entry);
    $("move-sheet").hidden = true;
    showToast(`Đã chuyển ${formatMoney(tien)} đ sang ${tenDich(dich)}`);
    render();
  } catch (err) {
    loi.textContent = friendlyError(err);
    loi.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Chuyển";
  }
}

// ----- Hộp thoại chỉnh tỉ lệ -----
function moHopTiLe() {
  $("ratio-rows").innerHTML = Logic.LOS.map(l => `
    <div class="ratio-row">
      <span class="ratio-name">${l.ten}</span>
      <input type="text" class="ratio-input" data-lo="${l.key}"
             inputmode="numeric" value="${tiLeLo[l.key]}">
      <span class="ratio-name" style="flex:none">%</span>
    </div>`).join("");

  $("ratio-rows").querySelectorAll(".ratio-input")
    .forEach(i => i.addEventListener("input", capNhatTongTiLe));
  $("ratio-error").hidden = true;
  capNhatTongTiLe();
  $("ratio-sheet").hidden = false;
}

function docTiLeDangNhap() {
  const r = {};
  $("ratio-rows").querySelectorAll(".ratio-input").forEach(i => {
    r[i.dataset.lo] = parseAmount(i.value);
  });
  return r;
}

function capNhatTongTiLe() {
  const r = docTiLeDangNhap();
  const tong = Object.keys(r).reduce((s, k) => s + r[k], 0);
  const el = $("ratio-total");
  el.textContent = `Tổng: ${tong}%`;
  el.className = "ratio-total " + (tong === 100 ? "dung" : "sai");
}

async function luuTiLe() {
  const r = docTiLeDangNhap();
  const tong = Object.keys(r).reduce((s, k) => s + r[k], 0);
  const loi = $("ratio-error");

  // Tổng khác 100 thì tiền sẽ thiếu hoặc thừa so với khoản thu, phải chặn.
  if (tong !== 100) {
    loi.textContent = `Tổng đang là ${tong}%, phải đúng 100% thì tiền mới chia hết.`;
    loi.hidden = false;
    return;
  }
  loi.hidden = true;

  const btn = $("ratio-ok");
  btn.disabled = true;
  btn.textContent = "Đang lưu…";
  try {
    await callApi("setSettings", { settings: { tiLe: r, loNhanDu } }, { retries: 2 });
    tiLeLo = r;
    $("ratio-sheet").hidden = true;
    showToast("Đã lưu tỉ lệ mới");
    render();
  } catch (err) {
    loi.textContent = friendlyError(err);
    loi.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Lưu tỉ lệ";
  }
}

async function napCaiDat() {
  try {
    const d = await callApi("getSettings", {}, { retries: 1 });
    const s = d.settings || {};
    if (s.tiLe && typeof s.tiLe === "object") tiLeLo = s.tiLe;
    if (s.loNhanDu) loNhanDu = s.loNhanDu;
    if (s.hanMuc && typeof s.hanMuc === "object") hanMuc = s.hanMuc;
    if (s.vi && typeof s.vi === "object") {
      caiDatVi = { ds: Logic.danhSachVi(s.vi), soDuDau: s.vi.soDuDau || {} };
      renderChipVi();
    }
  } catch (err) {
    // Không lấy được thì dùng tỉ lệ mặc định, app vẫn chạy.
  }
}

function initJars() {
  const nut = $("btn-move");
  if (!nut) return;

  nut.addEventListener("click", moHopChuyen);
  $("move-cancel").addEventListener("click", () => { $("move-sheet").hidden = true; });
  $("move-ok").addEventListener("click", luuChuyenLo);
  $("move-from").addEventListener("change", capNhatCanhBaoChuyen);
  $("move-to").addEventListener("change", capNhatCanhBaoChuyen);
  $("move-amount").addEventListener("input", e => {
    const n = parseAmount(e.target.value);
    e.target.value = n ? formatMoney(n) : "";
    capNhatCanhBaoChuyen();
  });

  $("jar-detail-close").addEventListener("click", () => { $("jar-sheet").hidden = true; });
  $("btn-tile").addEventListener("click", moHopTiLe);
  $("ratio-cancel").addEventListener("click", () => { $("ratio-sheet").hidden = true; });
  $("ratio-ok").addEventListener("click", luuTiLe);
}

function initTabs() {
  const cacTab = [
    { nut: "tab-btn-nhap",    khung: "tab-nhap" },
    { nut: "tab-btn-lo",      khung: "tab-lo" },
    { nut: "tab-btn-vi",      khung: "tab-vi" },
    { nut: "tab-btn-thongke", khung: "tab-thongke" }
  ];
  if (!$(cacTab[0].nut)) return;

  const chuyen = key => {
    cacTab.forEach(t => {
      const dangChon = t.khung === key;
      $(t.nut).classList.toggle("on", dangChon);
      $(t.khung).hidden = !dangChon;
    });
    if (key === "tab-lo") renderJars();
    if (key === "tab-vi") renderVi();
    if (key === "tab-thongke") renderStats();
    window.scrollTo(0, 0);
  };

  cacTab.forEach(t => $(t.nut).addEventListener("click", () => chuyen(t.khung)));

  $("stat-prev").addEventListener("click", () => { statOffset -= 1; renderStats(); });
  $("stat-next").addEventListener("click", () => {
    if (statOffset < 0) { statOffset += 1; renderStats(); }
  });
}

async function loadEntries(options = {}) {
  const data = await callApi("list", {}, options);
  entries = data.entries || [];
  render();
}

// ===== Lưu khoản chi =====
// Gửi thất bại thì cất vào hàng chờ, không để mất dữ liệu người dùng đã gõ.
async function saveEntry() {
  const amount = parseAmount($("amount").value);
  const error = $("entry-error");

  if (amount <= 0) {
    error.textContent = "Anh nhập số tiền nhé.";
    error.hidden = false;
    return;
  }
  error.hidden = true;

  const now = new Date();
  const entry = {
    id: `${now.getTime()}-${Math.round(now.getTime() % 9973)}`,
    // Ngày do người dùng chọn, mặc định hôm nay.
    date: ($("entry-date") && $("entry-date").value) || ngayHomNay(),
    amount,
    category: selectedCategory,
    note: $("note").value.trim(),
    payer: selectedPayer,
    type: selectedKind,
    // Khoản chi trừ vào lọ nào (suy từ danh mục).
    // Khoản thu lưu kèm bảng phân bổ tại thời điểm ghi: tỉ lệ có thể đổi
    // về sau nhưng lịch sử thì không được đổi theo.
    jar: selectedKind === "Thu" ? "" : Logic.doanLo(selectedCategory),
    alloc: selectedKind === "Thu" ? Logic.phanBo(amount, tiLeLo) : null,
    // Tiền ra khỏi (hoặc vào) ví nào
    wallet: viDangChon || ""
  };

  const nhanLoai = selectedKind === "Thu" ? "khoản thu" : "khoản chi";
  const btn = $("btn-save");
  const chuNut = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Đang lưu…";

  try {
    await callApi("add", { entry }, {
      retries: 2,
      onRetry: (lan, tong) => { btn.textContent = `Mạng chậm, thử lại ${lan}/${tong}…`; }
    });
    entries.unshift(entry);
    showToast(`Đã lưu ${nhanLoai} ${formatMoney(amount)} đ`);
  } catch (err) {
    // Đã thử lại vẫn không được thì cất vào hàng chờ, không để mất dữ liệu.
    store.queue = [entry, ...store.queue];
    showToast(err.pinError
      ? "PIN đã đổi, anh mở lại sổ nhé"
      : "Chưa gửi được, đã lưu tạm và sẽ tự gửi lại");
  } finally {
    $("amount").value = "";
    $("note").value = "";
    btn.disabled = false;
    btn.textContent = chuNut;   // trả về đúng chữ của loại đang chọn
    render();
  }
}

// Thử gửi lại những khoản còn kẹt trong hàng chờ
async function flushQueue() {
  const queue = store.queue;
  if (!queue.length) return;

  const remain = [];
  for (const entry of queue) {
    try {
      await callApi("add", { entry });
      entries.unshift(entry);
    } catch {
      remain.push(entry);
    }
  }
  store.queue = remain;
  if (remain.length < queue.length) {
    showToast(`Đã gửi ${queue.length - remain.length} khoản còn kẹt`);
  }
  render();
}

// ===== Khởi động =====
function init() {
  // Mốc này lộ ra việc trang có tự nạp lại hay không: nếu nhật ký hiện hai
  // dòng "trang khởi động" liền nhau thì đúng là trang bị nạp lại giữa chừng.
  ghiNhatKy(`trang khởi động (bản ${APP_VERSION})`);
  renderChips();
  initTabs();
  initJars();
  initEdit();
  initNgay();
  initTim();
  initHanMuc();
  initVi();

  // Vừa gõ vừa chấm phân cách nghìn cho dễ đọc
  $("amount").addEventListener("input", e => {
    const n = parseAmount(e.target.value);
    e.target.value = n ? formatMoney(n) : "";
  });

  $("btn-save").addEventListener("click", saveEntry);

  $("btn-refresh").addEventListener("click", async () => {
    const btn = $("btn-refresh");
    btn.classList.add("spinning");
    try {
      await flushQueue();
      await loadEntries();
    } catch (err) {
      showToast(friendlyError(err));
    } finally {
      btn.classList.remove("spinning");
    }
  });

  // Quay lại app sau khi khoá màn hình thì gửi nốt phần còn kẹt
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !$("app").hidden) flushQueue();
  });

  initResetButton();
  initGate();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
