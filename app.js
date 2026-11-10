// ===== Cấu hình =====
// URL Apps Script Web App RIÊNG của sổ cá nhân — phải là deployment khác với
// sổ gia đình, trỏ vào một Google Sheet khác, để hai sổ hoàn toàn tách biệt.
// Deploy lại (New deployment) thì URL đổi, nhớ sửa ở đây.
const API_URL = "https://script.google.com/macros/s/AKfycbyojlwjaXl4iq4zguZFS0FtedtuCVjSxK_c55VYijDbATqdh7Lg655cAlhNSVYRIYsu/exec";

// Mỗi danh mục trỏ đúng một lọ (xem LO_THEO_DANH_MUC trong logic.js).
// Danh mục ở đây là chi tiêu RIÊNG: chợ búa, hoá đơn, đồ dùng gia đình
// thuộc sổ gia đình nên không đưa vào để khỏi ghi trùng hai nơi.
// Danh mục KHÔNG còn nằm cứng ở đây nữa: người dùng tự thêm/sửa/xoá qua
// "Sửa danh mục" ở màn hình nhập, lưu trong bảng CaiDat của Google Sheet
// (khoá "danhMuc") nên mọi thiết bị thấy giống nhau. Danh sách mặc định nằm
// trong logic.js và được dùng cho tới khi napCaiDat() tải xong cấu hình thật.
let danhMucCfg = Logic.chuanHoaDanhMuc(null);
function dsChi() { return danhMucCfg.chi.map(d => d.ten); }
function dsThu() { return danhMucCfg.thu.slice(); }

// Gọi mỗi khi danhMucCfg đổi: logic.js cần biết danh mục nào thuộc lọ nào.
function apDungDanhMuc() {
  danhMucCfg = Logic.chuanHoaDanhMuc(danhMucCfg);
  Logic.datDanhMucChi(danhMucCfg.chi);
  // Danh mục đang chọn có thể vừa bị xoá — kéo về mục đầu để không lưu
  // khoản vào một danh mục không còn tồn tại.
  const ds = danhMucHienTai();
  if (ds.indexOf(selectedCategory) < 0) selectedCategory = ds[0];
}
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
  set queue(v)   { localStorage.setItem("ctcn_queue", JSON.stringify(v)); },
  // CHỈ danh sách mã khoản đang có ảnh chờ gửi — bản thân ảnh nằm ở
  // IndexedDB. Để ở localStorage vì lúc vẽ danh sách cần biết NGAY khoản nào
  // có ảnh, mà IndexedDB thì phải chờ, không kịp cho một vòng vẽ.
  get anhCho()   { try { return JSON.parse(localStorage.getItem("ctcn_anh_cho") || "[]"); } catch { return []; } },
  get anhCho()   { try { return JSON.parse(localStorage.getItem("ctcn_anh_cho") || "[]"); } catch { return []; } },
  set anhCho(v)  { localStorage.setItem("ctcn_anh_cho", JSON.stringify(v)); },

  // Ba hàng chờ cho ba việc khác nhau, cố ý KHÔNG gộp chung:
  //   queue    — khoản mới, chưa có trên Sheet
  //   suaCho   — khoản đã có trên Sheet, đang chờ gửi bản sửa (giữ cả khoản)
  //   xoaCho   — mã khoản chờ xoá khỏi Sheet
  //   anhXoaCho— mã khoản chờ gỡ ảnh khỏi Sheet (gỡ ảnh, không xoá khoản)
  // Gộp chung thành một danh sách lệnh thì phải tự lo thứ tự giữa "sửa" và
  // "xoá" cùng một khoản; tách ra thì chỉ cần gửi đúng thứ tự ba vòng.
  get suaCho()    { try { return JSON.parse(localStorage.getItem("ctcn_sua_cho") || "[]"); } catch { return []; } },
  set suaCho(v)   { localStorage.setItem("ctcn_sua_cho", JSON.stringify(v)); },
  get xoaCho()    { try { return JSON.parse(localStorage.getItem("ctcn_xoa_cho") || "[]"); } catch { return []; } },
  set xoaCho(v)   { localStorage.setItem("ctcn_xoa_cho", JSON.stringify(v)); },
  get anhXoaCho() { try { return JSON.parse(localStorage.getItem("ctcn_anh_xoa_cho") || "[]"); } catch { return []; } },
  set anhXoaCho(v){ localStorage.setItem("ctcn_anh_xoa_cho", JSON.stringify(v)); }
};

let selectedKind = "Chi";                    // Chi hoặc Thu
let selectedCategory = dsChi()[0];
let selectedPayer = store.payer;
let entries = [];

// Trạng thái màn hình thống kê
let statMode = "thang";   // tuan | thang | quy | nam
let statOffset = 0;       // 0 = kỳ hiện tại, -1 = kỳ trước

// Kiểu sắp xếp danh sách giao dịch. Nhớ lại giữa các lần mở app, vì đây là
// thói quen xem sổ chứ không phải lựa chọn nhất thời.
let kieuSap = localStorage.getItem("ctcn_sap") || "nhap";

function danhMucHienTai() {
  return selectedKind === "Thu" ? dsThu() : dsChi();
}

// ===== Kho ảnh trong máy (IndexedDB) =====
// Hai ngăn:
//   cho   — ảnh chụp lúc chưa gửi được, chờ có mạng. MẤT NGĂN NÀY LÀ MẤT ẢNH.
//   cache — ảnh đã tải về từ Drive, giữ lại để xem nhanh và xem được khi mất
//           mạng. Mất ngăn này chỉ phải tải lại, không mất gì.
//
// VÌ SAO KHÔNG DÙNG localStorage NHƯ HÀNG CHỜ KHOẢN: chỗ đó chỉ có khoảng 5MB
// cho CẢ sổ, mà hàng chờ khoản cũng nằm đó. Vài tấm ảnh là đầy, và khi đầy thì
// localStorage ném lỗi — khoản ghi lúc mất mạng sẽ mất theo ảnh. IndexedDB
// rộng hàng trăm MB và nằm riêng.
const DB_TEN = "ctcn_anh";
const DB_BAN = 1;
const KHO_CHO = "cho";
const KHO_CACHE = "cache";

let _db = null;
function moDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((xong, hong) => {
    if (!window.indexedDB) return hong(new Error("Máy không có kho ảnh"));
    const r = indexedDB.open(DB_TEN, DB_BAN);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(KHO_CHO)) db.createObjectStore(KHO_CHO);
      if (!db.objectStoreNames.contains(KHO_CACHE)) db.createObjectStore(KHO_CACHE);
    };
    r.onsuccess = () => { _db = r.result; xong(_db); };
    r.onerror = () => hong(r.error || new Error("Không mở được kho ảnh"));
  });
}

function dbViec(kho, che, viec) {
  return moDb().then(db => new Promise((xong, hong) => {
    const t = db.transaction(kho, che);
    const req = viec(t.objectStore(kho));
    t.onerror = () => hong(t.error);
    t.onabort = () => hong(t.error || new Error("Kho ảnh từ chối ghi"));
    // Đợi oncomplete chứ không phải req.onsuccess: ghi xong trong bộ nhớ chưa
    // chắc đã nằm trên đĩa, mà ảnh chờ gửi thì phải chắc.
    t.oncomplete = () => xong(req ? req.result : undefined);
  }));
}

const dbGhi  = (kho, khoa, gt) => dbViec(kho, "readwrite", s => s.put(gt, khoa));
const dbDoc  = (kho, khoa)     => dbViec(kho, "readonly",  s => s.get(khoa));
const dbXoa  = (kho, khoa)     => dbViec(kho, "readwrite", s => s.delete(khoa));
const dbKhoa = (kho)           => dbViec(kho, "readonly",  s => s.getAllKeys());

// Dùng cho ngăn cache và các bước dọn dẹp: hỏng thì bỏ qua, đừng làm hỏng
// việc chính. Ngăn "cho" thì KHÔNG dùng hàm này — ở đó lỗi phải báo cho anh.
const dbThu = p => p.catch(() => null);

// ===== Ảnh hoá đơn =====
const ANH_CANH_TOI_DA = 1400;
const ANH_CHAT_LUONG = 0.72;
const CACHE_ANH_TOI_DA = 50;     // giữ 50 ảnh xem gần nhất, ~12MB

function anhUrl(a) {
  return `data:${(a && a.mime) || "image/jpeg"};base64,${(a && a.data) || ""}`;
}

// Base64 dài gấp 4/3 số byte thật, nên chia ngược lại ra cỡ file xấp xỉ.
function coAnhKb(data) {
  return Math.round(((String(data || "").length * 3) / 4) / 1024);
}

// Thu nhỏ và nén ảnh NGAY TRÊN MÁY trước khi gửi.
// Trả về { data (base64 trần, không có tiền tố), mime }.
function nenAnh(file) {
  return new Promise((xong, hong) => {
    const fr = new FileReader();
    fr.onerror = () => hong(new Error("Không đọc được tệp này"));
    fr.onload = () => {
      const img = new Image();
      // iPhone chụp định dạng HEIC. Khi chọn qua ô tệp thì iOS thường tự đổi
      // sang JPEG, nhưng không phải lúc nào cũng vậy — rơi vào nhánh này thì
      // phải nói rõ, đừng để anh bấm lại ba lần mà không hiểu vì sao.
      img.onerror = () => hong(new Error("Không mở được ảnh này. Thử chụp lại hoặc chọn ảnh khác."));
      img.onload = () => {
        const { w, h } = Logic.kichThuocMoi(img.width, img.height, ANH_CANH_TOI_DA);
        if (!w || !h) return hong(new Error("Ảnh không hợp lệ"));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        // Luôn ra JPEG: ảnh chụp màn hình dạng PNG nặng gấp mấy lần JPEG cùng
        // độ nét, mà hoá đơn thì không cần nền trong suốt.
        const url = c.toDataURL("image/jpeg", ANH_CHAT_LUONG);
        xong({ data: url.slice(url.indexOf(",") + 1), mime: "image/jpeg" });
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// Cất ảnh vào máy rồi ghi tên khoản vào danh sách chờ.
// Thứ tự quan trọng: ghi bytes TRƯỚC, ghi tên SAU. Ngược lại thì có lúc danh
// sách chờ trỏ tới một mã không có ảnh nào đằng sau.
async function catAnhChoCho(id, anh) {
  try {
    await dbGhi(KHO_CHO, id, { data: anh.data, mime: anh.mime, luc: Date.now() });
    const ds = store.anhCho;
    if (!ds.includes(id)) store.anhCho = [...ds, id];
    return true;
  } catch (err) {
    showToast("Máy không cho lưu ảnh tạm nên ảnh chưa được giữ lại. Khoản vẫn lưu bình thường.");
    return false;
  }
}

// Gửi ảnh lên Drive. Không được thì cất vào hàng chờ.
async function ganAnhVaoKhoan(id, anh) {
  try {
    const kq = await callApi("uploadAnh", { id, data: anh.data, mime: anh.mime }, { retries: 1 });
    const i = entries.findIndex(x => x.id === id);
    if (i >= 0) entries[i] = { ...entries[i], anh: kq.anhId };
    // Đang cầm sẵn bytes thì cất luôn vào cache, khỏi phải tải lại khi xem.
    await dbThu(dbGhi(KHO_CACHE, kq.anhId, { data: anh.data, mime: anh.mime, luc: Date.now() }));
    await dbThu(dbXoa(KHO_CHO, id));
    store.anhCho = store.anhCho.filter(x => x !== id);
    return true;
  } catch (err) {
    return catAnhChoCho(id, anh);
  }
}

// Gửi nốt những ảnh còn kẹt. Gọi SAU flushQueue, vì ảnh chỉ gắn được khi
// khoản của nó đã nằm trên Sheet.
async function flushAnh() {
  const cho = store.anhCho;
  if (!cho.length) return 0;

  const con = [];
  let daGui = 0;

  for (const id of cho) {
    const goi = await dbThu(dbDoc(KHO_CHO, id));
    // Không còn bytes thì giữ tên lại cũng vô ích, chỉ làm dấu chờ hiện mãi.
    if (!goi || !goi.data) continue;

    try {
      const kq = await callApi("uploadAnh", { id, data: goi.data, mime: goi.mime }, { retries: 1 });
      const i = entries.findIndex(x => x.id === id);
      if (i >= 0) entries[i] = { ...entries[i], anh: kq.anhId };
      await dbThu(dbGhi(KHO_CACHE, kq.anhId, { data: goi.data, mime: goi.mime, luc: Date.now() }));
      await dbThu(dbXoa(KHO_CHO, id));
      daGui++;
    } catch (err) {
      // Khoản chưa lên Sheet thì giữ ảnh lại, vòng sau gửi tiếp. Mọi lỗi khác
      // cũng giữ: thà hiện dấu chờ còn hơn lặng lẽ vứt ảnh của anh.
      con.push(id);
    }
  }

  store.anhCho = con;
  if (daGui) showToast(`Đã gửi ${daGui} ảnh hoá đơn còn kẹt`);
  return daGui;
}

// Lấy ảnh của một khoản để xem: ưu tiên những gì đang có sẵn trong máy.
async function layAnhDeXem(e) {
  if (store.anhCho.includes(e.id)) {
    const goi = await dbThu(dbDoc(KHO_CHO, e.id));
    if (goi && goi.data) return goi;
  }
  if (!e.anh) return null;

  const sanCo = await dbThu(dbDoc(KHO_CACHE, e.anh));
  if (sanCo && sanCo.data) return sanCo;

  const kq = await callApi("getAnh", { anhId: e.anh }, { retries: 1 });
  const goi = { data: kq.data, mime: kq.mime || "image/jpeg", luc: Date.now() };
  await dbThu(dbGhi(KHO_CACHE, e.anh, goi));
  donCacheAnh();
  return goi;
}

// Giữ cache không phình mãi. Chạy ngầm, hỏng cũng không sao.
async function donCacheAnh() {
  try {
    const khoa = await dbKhoa(KHO_CACHE);
    if (khoa.length <= CACHE_ANH_TOI_DA) return;
    const ds = [];
    for (const k of khoa) {
      const v = await dbDoc(KHO_CACHE, k);
      ds.push({ k, luc: (v && v.luc) || 0 });
    }
    ds.sort((a, b) => b.luc - a.luc);
    for (const x of ds.slice(CACHE_ANH_TOI_DA)) await dbXoa(KHO_CACHE, x.k);
  } catch (err) { /* dọn dẹp hỏng thì thôi */ }
}

// Dọn sạch mọi dấu vết ảnh của một khoản trong máy. Gọi khi xoá khoản hoặc
// gỡ ảnh — không gọi thì ảnh cũ vẫn hiện lại từ cache dù trên Drive đã xoá.
async function donAnhTrongMay(id, anhId) {
  await dbThu(dbXoa(KHO_CHO, id));
  if (anhId) await dbThu(dbXoa(KHO_CACHE, anhId));
  store.anhCho = store.anhCho.filter(x => x !== id);
}

// ===== Hộp xem ảnh =====
let anhDangXem = null;

async function moHopXemAnh(e) {
  anhDangXem = e;
  const hop = $("anh-xem");
  const img = $("anh-xem-img");
  const tt = $("anh-trangthai");
  if (!hop) return;

  img.hidden = true;
  img.removeAttribute("src");
  tt.textContent = "Đang mở ảnh…";
  tt.hidden = false;
  hop.hidden = false;

  try {
    const goi = await layAnhDeXem(e);
    if (anhDangXem !== e) return;        // anh đã đóng hoặc mở ảnh khác
    if (!goi) throw new Error("Khoản này chưa có ảnh");
    img.src = anhUrl(goi);
    img.hidden = false;
    tt.hidden = true;
  } catch (err) {
    if (anhDangXem !== e) return;
    tt.textContent = navigator.onLine
      ? friendlyError(err)
      : "Đang mất mạng và ảnh này chưa có sẵn trong máy. Có mạng rồi mở lại nhé.";
  }
}

function dongHopXemAnh() {
  anhDangXem = null;
  const hop = $("anh-xem");
  if (!hop) return;
  hop.hidden = true;
  // Bỏ src để trình duyệt nhả bộ nhớ, ảnh nền mỗi tấm vài trăm KB.
  $("anh-xem-img").removeAttribute("src");
}

// ===== Ảnh ở màn nhập =====
let anhDangChon = null;

function veXemTruocAnh() {
  const khoi = $("anh-xt");
  if (!khoi) return;
  if (!anhDangChon) {
    khoi.hidden = true;
    $("anh-xt-img").removeAttribute("src");
    $("btn-anh").textContent = "📷 Ảnh hoá đơn";
    return;
  }
  $("anh-xt-img").src = anhUrl(anhDangChon);
  $("anh-co").textContent = `${coAnhKb(anhDangChon.data)} KB`;
  khoi.hidden = false;
  $("btn-anh").textContent = "📷 Đổi ảnh";
}

async function chonAnh(file, datVao) {
  if (!file) return;
  try {
    const anh = await nenAnh(file);
    datVao(anh);
  } catch (err) {
    showToast(err.message || "Không dùng được ảnh này");
  }
}

function initAnh() {
  if (!$("anh-file")) return;

  $("btn-anh").addEventListener("click", () => $("anh-file").click());
  $("anh-file").addEventListener("change", async ev => {
    const f = ev.target.files && ev.target.files[0];
    // Xoá value ngay để chọn LẠI ĐÚNG tệp vừa rồi vẫn kích hoạt change.
    ev.target.value = "";
    await chonAnh(f, a => { anhDangChon = a; veXemTruocAnh(); });
  });
  $("anh-bo").addEventListener("click", () => { anhDangChon = null; veXemTruocAnh(); });
  $("anh-xt-img").addEventListener("click", () => {
    if (anhDangChon) moHopAnhTam(anhDangChon);
  });

  $("anh-dong").addEventListener("click", dongHopXemAnh);
  $("anh-xem").addEventListener("click", ev => {
    if (ev.target === $("anh-xem")) dongHopXemAnh();
  });

  // Ảnh ở hộp sửa
  if ($("edit-anh-file")) {
    $("edit-anh-them").addEventListener("click", () => $("edit-anh-file").click());
    $("edit-anh-file").addEventListener("change", async ev => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      await chonAnh(f, a => { anhSuaMoi = a; anhSuaXoa = false; veAnhHopSua(); });
    });
    $("edit-anh-bo").addEventListener("click", () => {
      // Chọn ảnh mới rồi lại bỏ thì chỉ bỏ ảnh mới, ảnh cũ trên Drive vẫn còn.
      if (anhSuaMoi) anhSuaMoi = null;
      else anhSuaXoa = true;
      veAnhHopSua();
    });
    // Bắt cả khung chứ không riêng ảnh: khi khoản có ảnh trên Drive thì khung
    // chỉ hiện dòng chữ, chưa có ảnh nào để mà bấm vào.
    $("edit-anh-xem").addEventListener("click", () => {
      if (anhSuaMoi) moHopAnhTam(anhSuaMoi);
      else if (!anhSuaXoa && khoanDangSua && Logic.coAnh(khoanDangSua, store.anhCho)) {
        moHopXemAnh(khoanDangSua);
      }
    });
  }
}

// Xem ảnh đang cầm trong tay, chưa gửi đi đâu.
function moHopAnhTam(anh) {
  anhDangXem = null;
  const hop = $("anh-xem");
  if (!hop) return;
  $("anh-xem-img").src = anhUrl(anh);
  $("anh-xem-img").hidden = false;
  $("anh-trangthai").hidden = true;
  hop.hidden = false;
}

// ===== Gợi ý nội dung =====
// Anh đã gõ "Coop Bình Minh" 8 lần, "Netflix" 5 lần. Gõ lại tiếng Việt
// có dấu trên điện thoại là lý do chính khiến người ta bỏ cuộc rồi bấm bừa.
// Chip bấm một cái là xong, và vì chọn lại đúng chuỗi cũ nên báo cáo không bị
// tách đôi vì gõ lệch một dấu.
function veChipGoiY(oNhap, oChip, danhMuc) {
  const box = $(oChip);
  if (!box) return;
  const ds = Logic.goiYNoiDung(tatCaKhoan(), danhMuc, $(oNhap).value, 8);
  box.innerHTML = ds.map(t =>
    `<button type="button" class="chip goi-y-chip">${t}</button>`).join("");
  box.querySelectorAll(".goi-y-chip").forEach((b, i) => {
    b.addEventListener("click", () => {
      $(oNhap).value = ds[i];
      veChipGoiY(oNhap, oChip, danhMuc);
      $(oNhap).focus();
    });
  });
}

function capNhatGoiYNhap() {
  veChipGoiY("note", "note-goiy", selectedCategory);
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
const APP_VERSION = "18";

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
    // Khoản đã bị xoá khỏi Sheet thì lệnh sửa này hỏng vĩnh viễn — thử lại
    // nghìn lần cũng vẫn hỏng, phải bỏ ra khỏi hàng chờ chứ không giữ gửi mãi.
    if (String(data.error || "").includes("Không tìm thấy")) err.khongTim = true;
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
    btn.dataset.ten = cat;
    btn.addEventListener("click", () => {
      // Sau một lần kéo, trình duyệt vẫn bắn click. Bỏ qua, nếu không thì
      // kéo xong là danh mục đang chọn bị đổi theo chỗ vừa thả.
      if (vuaKeoXong) { vuaKeoXong = false; return; }
      selectedCategory = cat;
      renderChips();
    });
    ganKeoChip(btn);
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

  // Đổi danh mục thì gợi ý phải đổi theo: nội dung của Ăn uống không có
  // nghĩa gì ở Điện thoại/Internet.
  capNhatGoiYNhap();
}

function tatCaKhoan() {
  const queue = store.queue;
  return [...queue.map(q => ({ ...q, unsent: true })), ...entries];
}

// ===== Hiển thị dữ liệu =====
function render() {
  const month = todayKey();
  const queue = store.queue;
  // Đọc một lần cho cả vòng vẽ, thay vì đọc lại localStorage ở từng dòng.
  const anhCho = store.anhCho;
  // Khoản đã sửa trong máy nhưng bản sửa chưa lên Sheet cũng phải mang dấu ⏳.
  // Không đánh dấu thì màn hình hiện số mới trong khi Sheet còn số cũ, mà
  // nhìn vào không có cách nào biết.
  const suaCho = store.suaCho.map(e => e.id);
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
  // Sắp xếp áp cho cả danh sách gần đây lẫn kết quả tìm — tìm xong mà thứ tự
  // nhảy về kiểu khác thì anh phải dò lại từ đầu.
  const ketQua = Logic.sapXepKhoan(
    dangLoc ? Logic.locKhoan(all, docDieuKienLoc()) : all, kieuSap
  );
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
      const chuyenVi = Logic.laChuyenVi(e);
      const no = Logic.laKhoanNo(e);
      const chuyen = Logic.laChuyenLo(e) || chuyenVi;
      const row = document.createElement("div");
      row.className = "item" + (e.unsent ? " unsent" : "");
      // Khoản chuyển lọ tiền không rời túi, nên không được hiện giống hệt một
      // khoản chi: chỉ ra chiều chuyển và dùng màu riêng, tránh nhìn nhầm.
      const tenLo = k => (Logic.timLo(k) || {}).ten || k || "?";
      const meta = chuyenVi
        ? [e.date, `${e.wallet} → ${e.walletTo}`, e.note].filter(Boolean).join(" · ")
        : chuyen
        ? [e.date, `${tenLo(e.jar)} → ${tenLo(e.jarTo)}`, e.note].filter(Boolean).join(" · ")
        : no
        ? [e.date, e.doiTuong, e.wallet, e.note].filter(Boolean).join(" · ")
        : [e.date, e.payer, e.wallet, e.note].filter(Boolean).join(" · ");
      // Khoản vay nợ dùng chung màu "chuyển": tiền có đổi chỗ nhưng không
      // phải thu cũng không phải chi, hiện màu chi là nhìn nhầm ngay.
      const lopTien = thu ? " thu" : (chuyen || no ? " chuyen" : "");
      const dauTien = thu ? "+" : (chuyen ? "⇄ " : (no ? (Logic.noLamTienRa(e) ? "↗ " : "↙ ") : ""));
      row.innerHTML = `
        <div class="item-main">
          <div class="item-cat">${e.category || "Khác"}${(e.unsent || suaCho.indexOf(e.id) >= 0) ? " ⏳" : ""}${Logic.coAnh(e, anhCho) ? " 📎" : ""}</div>
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
  renderNo();
  // Nạp xong dữ liệu mới có cái để gợi ý; lúc khởi động sổ còn rỗng.
  capNhatGoiYNhap();
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
      <input type="text" class="note-input vi-ten" value="${thoatHtml(v)}" placeholder="Tên ví">
      <input type="text" class="note-input vi-dau" inputmode="numeric"
             placeholder="Số dư đầu"
             value="${caiDatVi.soDuDau[v] ? formatMoney(caiDatVi.soDuDau[v]) : ""}">
      <button type="button" class="vi-xoa" title="Bỏ ví này">✕</button>
    </div>`).join("");

  box.querySelectorAll(".vi-dau").forEach(o => {
    o.addEventListener("input", () => {
      const am = Logic.coDauAm(o.value);
      const n = Logic.parseAmountCoAm(o.value);
      // Giữ lại dấu trừ khi chưa gõ chữ số nào. Nếu xoá luôn thì không bao giờ
      // gõ được số âm: vừa bấm "-" là ô tự trống lại.
      o.value = n ? formatMoney(n) : (am ? "-" : "");
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
    // Nhận cả số âm: thẻ tín dụng đang nợ thì số dư đầu là số âm.
    const n = Logic.parseAmountCoAm(d.querySelector(".vi-dau").value);
    if (n) soDuDau[ten] = n;
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

// Tên ví và tên danh mục do người dùng gõ rồi được nhét thẳng vào innerHTML.
// Một dấu nháy kép trong tên là đủ làm vỡ thuộc tính value và mất dòng đó.
function thoatHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ===== Kéo chip để đổi thứ tự danh mục =====
// Chip vừa là nút CHỌN danh mục — thao tác dùng nhiều nhất trong app — vừa là
// thứ kéo được. Ranh giới giữa hai việc: phải GIỮ đủ lâu mà KHÔNG trượt tay.
// Trượt tay sớm nghĩa là đang cuộn trang, phải nhường cho cuộn.
const GIU_MS = 450;
const TRUOT_HUY = 10;

let keo = null;           // { el, timer, x0, y0, dangKeo }
let vuaKeoXong = false;   // chặn cú click trình duyệt bắn ra ngay sau khi thả

function ganKeoChip(btn) {
  btn.addEventListener("touchstart", e => {
    const t = e.touches[0];
    batDauGiu(btn, t.clientX, t.clientY);
  }, { passive: true });
  btn.addEventListener("mousedown", e => batDauGiu(btn, e.clientX, e.clientY));
}

function batDauGiu(el, x, y) {
  huyKeo();
  const k = { el, x0: x, y0: y, dangKeo: false, timer: null };
  k.timer = setTimeout(() => {
    if (keo !== k) return;
    k.dangKeo = true;
    el.classList.add("chip-keo");
    // Chip đang kéo phải trong suốt với con trỏ, nếu không elementFromPoint
    // chỉ trả về chính nó và không bao giờ tìm được chip nằm dưới ngón tay.
    el.style.pointerEvents = "none";
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) {} }
  }, GIU_MS);
  keo = k;
}

// Trả true khi đang thật sự kéo, để nơi gọi chặn cuộn trang.
function diChuyenKeo(x, y) {
  if (!keo) return false;
  if (!keo.dangKeo) {
    if (Math.abs(x - keo.x0) > TRUOT_HUY || Math.abs(y - keo.y0) > TRUOT_HUY) huyKeo();
    return false;
  }
  const duoi = document.elementFromPoint(x, y);
  const dich = (duoi && duoi.closest) ? duoi.closest(".chip") : null;
  if (dich && dich !== keo.el && dich.parentElement === keo.el.parentElement) {
    // Xen trước hay sau tuỳ chiều di chuyển, để lưới chảy đúng hướng ngón tay.
    const dichDungTruoc = !!(dich.compareDocumentPosition(keo.el) & Node.DOCUMENT_POSITION_FOLLOWING);
    keo.el.parentElement.insertBefore(keo.el, dichDungTruoc ? dich : dich.nextSibling);
  }
  return true;
}

function thaKeo() {
  if (!keo) return;
  const daKeo = keo.dangKeo;
  const el = keo.el;
  clearTimeout(keo.timer);
  el.classList.remove("chip-keo");
  el.style.pointerEvents = "";
  keo = null;
  if (!daKeo) return;
  vuaKeoXong = true;
  // Hai lớp dọn cờ: cú click giả tự dọn, và hẹn giờ phòng khi click không tới
  // (nếu kẹt lại, cú CHẠM THẬT kế tiếp sẽ bị nuốt mất).
  setTimeout(() => { vuaKeoXong = false; }, 500);
  luuThuTuDanhMuc();
}

function huyKeo() {
  if (!keo) return;
  clearTimeout(keo.timer);
  keo.el.classList.remove("chip-keo");
  keo.el.style.pointerEvents = "";
  keo = null;
}

function luuThuTuDanhMuc() {
  const ten = Array.from($("categories").querySelectorAll(".chip")).map(b => b.dataset.ten);
  const laThu = selectedKind === "Thu";
  const goc = laThu ? danhMucCfg.thu : danhMucCfg.chi.map(d => d.ten);

  // CHỐT AN TOÀN: nếu số lượng lệch thì có gì đó sai, mà chuanHoaDanhMuc gặp
  // danh sách rỗng sẽ trả về MẶC ĐỊNH — tức là xoá sạch danh mục anh tự đặt.
  // Thà không đổi thứ tự còn hơn mất cấu hình.
  if (ten.length !== goc.length || ten.some(t => goc.indexOf(t) < 0)) {
    renderChips();
    return;
  }

  if (laThu) {
    danhMucCfg = Logic.chuanHoaDanhMuc({ chi: danhMucCfg.chi, thu: ten });
  } else {
    const theoTen = {};
    danhMucCfg.chi.forEach(d => { theoTen[d.ten] = d; });
    danhMucCfg = Logic.chuanHoaDanhMuc({ chi: ten.map(t => theoTen[t]), thu: danhMucCfg.thu });
  }
  apDungDanhMuc();

  // Gửi nền: đổi thứ tự là việc nhỏ, không đáng bắt anh đứng chờ 3 giây.
  callApi("setSettings", { settings: { danhMuc: danhMucCfg } }, { retries: 2 })
    .then(() => showToast("Đã đổi thứ tự danh mục"))
    .catch(err => showToast("Chưa lưu được thứ tự — " + friendlyError(err)));
}

function initKeoChip() {
  document.addEventListener("touchmove", e => {
    if (!keo) return;
    const t = e.touches[0];
    // Chặn cuộn CHỈ khi đã vào chế độ kéo; trước đó phải để anh cuộn bình thường.
    if (diChuyenKeo(t.clientX, t.clientY)) e.preventDefault();
  }, { passive: false });
  document.addEventListener("touchend", thaKeo);
  document.addEventListener("touchcancel", huyKeo);
  document.addEventListener("mousemove", e => { if (keo) diChuyenKeo(e.clientX, e.clientY); });
  document.addEventListener("mouseup", thaKeo);
}

// ===== Quản lý danh mục =====
function moHopDanhMuc() {
  veDongDanhMuc();
  $("danhmuc-error").hidden = true;
  $("danhmuc-sheet").hidden = false;
}

function oChonLo(loKey) {
  return Logic.LOS.map(l =>
    `<option value="${l.key}"${l.key === loKey ? " selected" : ""}>${thoatHtml(l.ten)}</option>`
  ).join("");
}

function veDongDanhMuc() {
  // Đếm khoản đang dùng từng danh mục: xoá một mục đang có khoản thì khoản cũ
  // vẫn giữ nguyên tên và lọ đã đóng, nhưng người dùng cần biết trước.
  const dem = Logic.demKhoanTheoDanhMuc(tatCaKhoan());

  $("dm-chi-rows").innerHTML = danhMucCfg.chi.map(d => `
    <div class="dm-nhap">
      <input type="text" class="note-input dm-ten" value="${thoatHtml(d.ten)}"
             placeholder="Tên danh mục">
      <select class="note-input dm-lo">${oChonLo(d.lo)}</select>
      ${hangNut(dem[d.ten] ? dem[d.ten] + " khoản" : "")}
    </div>`).join("");

  $("dm-thu-rows").innerHTML = danhMucCfg.thu.map(t => `
    <div class="dm-nhap">
      <input type="text" class="note-input dm-ten" value="${thoatHtml(t)}"
             placeholder="Tên danh mục">
      ${hangNut("")}
    </div>`).join("");

  ganNutDongDanhMuc($("danhmuc-sheet"));
}

// Các nút nằm ở DÒNG RIÊNG bên dưới. Nhét chung một hàng với ô tên và ô lọ
// thì trên màn hình 375px tên bị cắt còn "Mua sắm cá…", không phân biệt nổi.
// ↑ ↓ là đường lùi cho việc kéo chip: luôn sắp xếp được kể cả khi kéo chưa mượt.
function hangNut(ghiChu) {
  return `<div class="dm-nut">
            <span class="dm-dem">${thoatHtml(ghiChu)}</span>
            <button type="button" class="dm-len" title="Lên trên">↑</button>
            <button type="button" class="dm-xuong" title="Xuống dưới">↓</button>
            <button type="button" class="dm-xoa" title="Bỏ danh mục này">✕</button>
          </div>`;
}

function ganNutDongDanhMuc(goc) {
  goc.querySelectorAll(".dm-xoa").forEach(b => {
    b.addEventListener("click", () => b.closest(".dm-nhap").remove());
  });
  goc.querySelectorAll(".dm-len").forEach(b => {
    b.addEventListener("click", () => {
      const d = b.closest(".dm-nhap");
      if (d.previousElementSibling) d.parentElement.insertBefore(d, d.previousElementSibling);
    });
  });
  goc.querySelectorAll(".dm-xuong").forEach(b => {
    b.addEventListener("click", () => {
      const d = b.closest(".dm-nhap");
      const sau = d.nextElementSibling;
      if (sau) d.parentElement.insertBefore(sau, d);
    });
  });
}

function themDongDanhMuc(loai) {
  const box = $(loai === "thu" ? "dm-thu-rows" : "dm-chi-rows");
  const d = document.createElement("div");
  d.className = "dm-nhap";
  d.innerHTML = loai === "thu"
    ? `<input type="text" class="note-input dm-ten" placeholder="Tên danh mục">
       ${hangNut("")}`
    : `<input type="text" class="note-input dm-ten" placeholder="Tên danh mục">
       <select class="note-input dm-lo">${oChonLo("NEC")}</select>
       ${hangNut("")}`;
  ganNutDongDanhMuc(d);
  box.appendChild(d);
  d.querySelector(".dm-ten").focus();
}

async function luuDanhMuc() {
  const chi = [];
  const tenChi = new Set();
  let trung = "";
  $("dm-chi-rows").querySelectorAll(".dm-nhap").forEach(d => {
    const ten = d.querySelector(".dm-ten").value.trim();
    if (!ten) return;
    if (tenChi.has(ten)) { trung = ten; return; }
    tenChi.add(ten);
    chi.push({ ten, lo: d.querySelector(".dm-lo").value });
  });

  const thu = [];
  const tenThu = new Set();
  $("dm-thu-rows").querySelectorAll(".dm-nhap").forEach(d => {
    const ten = d.querySelector(".dm-ten").value.trim();
    if (!ten) return;
    if (tenThu.has(ten)) { trung = ten; return; }
    tenThu.add(ten);
    thu.push(ten);
  });

  const loi = $("danhmuc-error");
  if (trung) {
    loi.textContent = `Danh mục "${trung}" bị trùng tên. Mỗi tên chỉ dùng một lần.`;
    loi.hidden = false;
    return;
  }
  if (!chi.length || !thu.length) {
    loi.textContent = "Cần ít nhất một danh mục chi và một danh mục thu.";
    loi.hidden = false;
    return;
  }

  const nut = $("danhmuc-ok");
  nut.disabled = true;
  nut.textContent = "Đang lưu…";
  try {
    const moi = { chi, thu };
    await callApi("setSettings", { settings: { danhMuc: moi } }, { retries: 2 });
    danhMucCfg = Logic.chuanHoaDanhMuc(moi);
    apDungDanhMuc();
    $("danhmuc-sheet").hidden = true;
    showToast("Đã lưu danh mục");
    renderChips();
    render();
  } catch (err) {
    loi.textContent = friendlyError(err);
    loi.hidden = false;
  } finally {
    nut.disabled = false;
    nut.textContent = "Lưu";
  }
}

function initDanhMuc() {
  initKeoChip();
  const mo = $("btn-sua-danhmuc");
  if (mo) mo.addEventListener("click", moHopDanhMuc);
  if ($("danhmuc-cancel")) {
    $("danhmuc-cancel").addEventListener("click", () => { $("danhmuc-sheet").hidden = true; });
  }
  if ($("danhmuc-ok")) $("danhmuc-ok").addEventListener("click", luuDanhMuc);
  if ($("btn-them-dm-chi")) $("btn-them-dm-chi").addEventListener("click", () => themDongDanhMuc("chi"));
  if ($("btn-them-dm-thu")) $("btn-them-dm-thu").addEventListener("click", () => themDongDanhMuc("thu"));
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

// ===== Vay nợ =====
// Bốn loại khoản, khác nhau ở chiều tiền và chiều nợ. Không loại nào là thu
// hay chi: cho vay 20 triệu thì tiền vẫn của mình, chỉ đang nằm chỗ khác.
function renderNo() {
  const box = $("no-list");
  if (!box) return;

  const ds = Logic.soDuNo(tatCaKhoan());
  const tt = Logic.tomTatNo(ds);

  $("no-tomtat").innerHTML = ds.length ? `
    <h3>Tổng quan</h3>
    <div class="no-hang">
      <div class="no-than">
        <div class="no-ten">Người ta nợ mình</div>
        <div class="no-chieu">tiền sẽ thu về</div>
      </div>
      <div class="no-so ho-no-minh">${formatMoney(tt.hoNoMinh)} đ</div>
    </div>
    <div class="no-hang">
      <div class="no-than">
        <div class="no-ten">Mình nợ người ta</div>
        <div class="no-chieu">tiền sẽ phải trả</div>
      </div>
      <div class="no-so minh-no-ho">${formatMoney(tt.minhNoHo)} đ</div>
    </div>
    <div class="no-hang">
      <div class="no-than">
        <div class="no-ten">Còn lại</div>
        <div class="no-chieu">${tt.soNguoi} đối tượng, ${tt.xong} đã tất toán</div>
      </div>
      <div class="no-so ${tt.rong > 0 ? "ho-no-minh" : (tt.rong < 0 ? "minh-no-ho" : "xong")}">${formatMoney(tt.rong)} đ</div>
    </div>` : "";

  if (!ds.length) {
    box.innerHTML = '<p class="empty">Chưa ghi khoản vay nợ nào.</p>';
    return;
  }

  const nhan = { "ho-no-minh": "còn nợ mình", "minh-no-ho": "mình còn nợ", "xong": "đã tất toán" };
  box.innerHTML = `<h3 class="no-nhom">Theo từng người</h3>` + ds.map(o => {
    // Ghi rõ cả bốn con số cộng dồn: nhìn thấy "cho vay 20tr, thu 5tr" thì
    // mới tin được số dư 15tr, chứ chỉ một con số thì không kiểm được.
    const chiTiet = [
      o.choVay ? `cho vay ${formatMoney(o.choVay)}đ` : "",
      o.thuNo ? `đã thu ${formatMoney(o.thuNo)}đ` : "",
      o.diVay ? `đi vay ${formatMoney(o.diVay)}đ` : "",
      o.traNo ? `đã trả ${formatMoney(o.traNo)}đ` : ""
    ].filter(Boolean).join(" · ");
    return `
      <div class="no-hang">
        <div class="no-than">
          <div class="no-ten">${o.ten}</div>
          <div class="no-chieu">${nhan[o.chieu]}</div>
          <div class="no-chitiet">${chiTiet}</div>
        </div>
        <div class="no-so ${o.chieu}">${formatMoney(Math.abs(o.con))} đ</div>
      </div>`;
  }).join("");
}

function moHopNo() {
  const ds = dsVi();
  $("no-vi").innerHTML = ds.map(v => `<option value="${v}">${v}</option>`).join("");
  if (viDangChon && ds.includes(viDangChon)) $("no-vi").value = viDangChon;

  // Gợi ý tên đã từng ghi để không gõ mỗi lần một kiểu ("Anh Hùng" / "anh hung"),
  // vì số dư nợ gom theo tên: gõ lệch một chữ là tách thành hai người.
  const daCo = Logic.soDuNo(tatCaKhoan()).map(o => o.ten);
  $("no-doituong-goi").innerHTML = daCo.map(t => `<option value="${t}"></option>`).join("");

  $("no-loai").value = "Cho vay";
  $("no-doituong").value = "";
  $("no-amount").value = "";
  $("no-note").value = "";
  $("no-date").value = ngayHomNay();
  $("no-error").hidden = true;
  $("no-sheet").hidden = false;
}

async function luuNo() {
  const loai = $("no-loai").value;
  const ai = $("no-doituong").value.trim();
  const tien = parseAmount($("no-amount").value);
  const loi = $("no-error");

  if (!ai) { loi.textContent = "Ghi tên người vay/cho vay nhé."; loi.hidden = false; return; }
  if (!(tien > 0)) { loi.textContent = "Số tiền phải lớn hơn 0."; loi.hidden = false; return; }
  loi.hidden = true;

  const entry = {
    id: "no-" + Date.now(),
    date: $("no-date").value || ngayHomNay(),
    amount: tien,
    category: loai,
    note: $("no-note").value.trim(),
    payer: selectedPayer,
    type: loai,
    doiTuong: ai,
    wallet: $("no-vi").value
  };

  const nut = $("no-ok");
  nut.disabled = true;
  nut.textContent = "Đang ghi…";
  try {
    await callApi("add", { entry }, { retries: 2 });
    entries.unshift(entry);
    $("no-sheet").hidden = true;
    showToast(`Đã ghi ${loai.toLowerCase()} ${formatMoney(tien)} đ`);
    render();
    renderNo();
  } catch (err) {
    loi.textContent = friendlyError(err);
    loi.hidden = false;
  } finally {
    nut.disabled = false;
    nut.textContent = "Ghi";
  }
}

// ===== Sổ tiết kiệm =====
// Lưu trong cài đặt (key/value trên Sheet) chứ không phải bảng khoản chi: sổ
// tiết kiệm là một TRẠNG THÁI đang tồn tại, không phải một lần tiền đổi chỗ.
let dsTietKiem = [];
let tkDangSua = -1;      // -1 là thêm mới

function renderTietKiem() {
  const box = $("tk-list");
  if (!box) return;

  const ds = Logic.trangThaiTietKiem(dsTietKiem);
  const tt = Logic.tomTatTietKiem(ds);

  $("tk-tomtat").innerHTML = ds.length ? `
    <h3>Tổng quan</h3>
    <div class="no-hang">
      <div class="no-than">
        <div class="no-ten">${tt.soSo} sổ đang gửi</div>
        <div class="no-chieu">lãi dự kiến khi giữ đủ kỳ hạn ${formatMoney(tt.tongLai)}đ</div>
      </div>
      <div class="no-so ho-no-minh">${formatMoney(tt.tongGoc)} đ</div>
    </div>` : "";

  if (!ds.length) {
    box.innerHTML = '<p class="empty">Chưa có sổ tiết kiệm nào.</p>';
    return;
  }

  box.innerHTML = ds.map((s, i) => {
    const khi = s.conLaiNgay < 0 ? `quá hạn ${-s.conLaiNgay} ngày`
      : s.conLaiNgay === 0 ? "đáo hạn hôm nay"
      : `còn ${s.conLaiNgay} ngày`;
    return `
      <div class="tk-hang ${s.mucDo}" data-i="${i}">
        <div class="tk-dong1">
          <span class="tk-ten">${s.ten || "Sổ không tên"}</span>
          <span class="tk-goc">${formatMoney(s.soTien)} đ</span>
        </div>
        <div class="tk-dong2">
          <span>${[s.noiGui, s.kyHanThang + " tháng", (Number(s.laiSuat) || 0) + "%/năm"].filter(Boolean).join(" · ")}</span>
          <span class="tk-han ${s.mucDo}">${khi}</span>
        </div>
        <div class="tk-dong2">
          <span>đáo hạn ${s.ngayDaoHan}</span>
          <span>nhận về ${formatMoney(s.tongNhan)} đ</span>
        </div>
      </div>`;
  }).join("");

  box.querySelectorAll(".tk-hang").forEach(d => {
    d.addEventListener("click", () => moHopTietKiem(Number(d.dataset.i)));
  });

  // Cảnh báo lặp lại ngay dưới danh sách: nhắc trong app chỉ ăn khi anh mở
  // app, nên phải nói rõ có email nhắc chứ đừng để anh tưởng app tự báo.
  const note = $("tk-nhac-note");
  if (note) {
    const gap = tt.quaHan + tt.sapDaoHan;
    note.textContent = gap
      ? `${gap} sổ sắp/đã đáo hạn. Google cũng gửi email nhắc lúc 8h sáng mỗi ngày.`
      : "Google sẽ gửi email nhắc lúc 8h sáng khi có sổ còn dưới 7 ngày là đáo hạn.";
  }
}

function moHopTietKiem(i) {
  tkDangSua = (typeof i === "number" && i >= 0) ? i : -1;
  // Danh sách hiển thị đã được sắp xếp lại theo mức độ, nên phải lấy sổ theo
  // đúng bản đã sắp xếp — dùng chỉ số vào dsTietKiem gốc là sửa sai sổ.
  const daSapXep = Logic.trangThaiTietKiem(dsTietKiem);
  const s = tkDangSua >= 0 ? daSapXep[tkDangSua] : null;
  if (s) tkDangSua = dsTietKiem.findIndex(x => x.id === s.id);

  $("tk-title").textContent = s ? "Sửa sổ tiết kiệm" : "Thêm sổ tiết kiệm";
  $("tk-ten").value = s ? (s.ten || "") : "";
  $("tk-noi").value = s ? (s.noiGui || "") : "";
  $("tk-sotien").value = s && s.soTien ? formatMoney(s.soTien) : "";
  $("tk-laisuat").value = s && s.laiSuat ? String(s.laiSuat) : "";
  $("tk-ngaygui").value = s ? (s.ngayGui || ngayHomNay()) : ngayHomNay();
  $("tk-kyhan").value = s ? String(s.kyHanThang || 6) : "6";
  $("tk-xoa").hidden = !s;
  $("tk-error").hidden = true;
  capNhatXemTruocTk();
  $("tk-sheet").hidden = false;
}

// Xem trước ngày đáo hạn và tiền nhận về NGAY LÚC GÕ. Không có nó thì anh
// phải lưu rồi mới biết mình chọn kỳ hạn sai.
function capNhatXemTruocTk() {
  const el = $("tk-xem-truoc");
  if (!el) return;
  const so = docHopTietKiem();
  if (!so.ngayGui || !(so.soTien > 0)) { el.textContent = ""; return; }
  const dh = Logic.ngayDaoHan(so);
  const lai = Logic.laiDuKien(so);
  el.textContent = `Đáo hạn ${dh} · lãi dự kiến ${formatMoney(lai)}đ · `
    + `nhận về ${formatMoney(so.soTien + lai)}đ`;
}

function docHopTietKiem() {
  return {
    ten: $("tk-ten").value.trim(),
    noiGui: $("tk-noi").value.trim(),
    soTien: parseAmount($("tk-sotien").value),
    laiSuat: Number(String($("tk-laisuat").value).replace(",", ".")) || 0,
    ngayGui: $("tk-ngaygui").value,
    kyHanThang: Number($("tk-kyhan").value) || 0
  };
}

async function ghiDsTietKiem(moi, thongBao) {
  const nut = $("tk-ok");
  const loi = $("tk-error");
  nut.disabled = true;
  nut.textContent = "Đang lưu…";
  try {
    await callApi("setSettings", { settings: { tietKiem: moi } }, { retries: 2 });
    dsTietKiem = moi;
    $("tk-sheet").hidden = true;
    showToast(thongBao);
    renderTietKiem();
  } catch (err) {
    loi.textContent = friendlyError(err);
    loi.hidden = false;
  } finally {
    nut.disabled = false;
    nut.textContent = "Lưu sổ";
  }
}

async function luuTietKiem() {
  const so = docHopTietKiem();
  const loi = $("tk-error");

  if (!(so.soTien > 0)) { loi.textContent = "Số tiền gốc phải lớn hơn 0."; loi.hidden = false; return; }
  if (!so.ngayGui) { loi.textContent = "Chọn ngày gửi nhé."; loi.hidden = false; return; }
  if (!(so.kyHanThang > 0)) { loi.textContent = "Chọn kỳ hạn nhé."; loi.hidden = false; return; }
  loi.hidden = true;

  const moi = dsTietKiem.slice();
  if (tkDangSua >= 0 && moi[tkDangSua]) {
    moi[tkDangSua] = Object.assign({}, moi[tkDangSua], so);
  } else {
    // ID cố định để sửa/xoá không bị lệch khi danh sách được sắp xếp lại
    moi.push(Object.assign({ id: "tk-" + Date.now() }, so));
  }
  await ghiDsTietKiem(moi, tkDangSua >= 0 ? "Đã sửa sổ" : "Đã thêm sổ");
}

async function xoaTietKiem() {
  if (tkDangSua < 0 || !dsTietKiem[tkDangSua]) return;
  const s = dsTietKiem[tkDangSua];
  if (!confirm(`Xoá sổ "${s.ten || "không tên"}" (${formatMoney(s.soTien)}đ)?`)) return;
  const moi = dsTietKiem.filter((_, i) => i !== tkDangSua);
  await ghiDsTietKiem(moi, "Đã xoá sổ");
}

function initNo() {
  if ($("btn-ghi-no")) $("btn-ghi-no").addEventListener("click", moHopNo);
  if ($("no-cancel")) $("no-cancel").addEventListener("click", () => { $("no-sheet").hidden = true; });
  if ($("no-ok")) $("no-ok").addEventListener("click", luuNo);
  if ($("no-amount")) {
    $("no-amount").addEventListener("input", e => {
      const n = parseAmount(e.target.value);
      e.target.value = n ? formatMoney(n) : "";
    });
  }

  if ($("btn-them-tk")) $("btn-them-tk").addEventListener("click", () => moHopTietKiem(-1));
  if ($("tk-cancel")) $("tk-cancel").addEventListener("click", () => { $("tk-sheet").hidden = true; });
  if ($("tk-ok")) $("tk-ok").addEventListener("click", luuTietKiem);
  if ($("tk-xoa")) $("tk-xoa").addEventListener("click", xoaTietKiem);
  if ($("tk-sotien")) {
    $("tk-sotien").addEventListener("input", e => {
      const n = parseAmount(e.target.value);
      e.target.value = n ? formatMoney(n) : "";
      capNhatXemTruocTk();
    });
  }
  ["tk-laisuat", "tk-ngaygui", "tk-kyhan"].forEach(id => {
    if ($(id)) $(id).addEventListener("input", capNhatXemTruocTk);
  });
  if ($("tk-kyhan")) $("tk-kyhan").addEventListener("change", capNhatXemTruocTk);
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
  dsChi().forEach(muc => {
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
  { key: "chuyen", ten: "Chuyển" },
  { key: "no",     ten: "Nợ" }
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
  if (t.no) phan.push(`vay nợ ${formatMoney(t.no)}đ`);
  if (soHien < t.soKhoan) phan.push(`(hiện ${soHien})`);
  o.textContent = phan.join(" · ");
}

function renderChipSapXep() {
  const box = $("sap-xep");
  if (!box) return;
  box.innerHTML = Logic.KIEU_SAP.map(k =>
    `<button type="button" class="chip${k.key === kieuSap ? " on" : ""}" data-sap="${k.key}">${k.ten}</button>`
  ).join("");
  box.querySelectorAll(".chip").forEach(b => {
    b.addEventListener("click", () => {
      if (kieuSap === b.dataset.sap) return;
      kieuSap = b.dataset.sap;
      localStorage.setItem("ctcn_sap", kieuSap);
      renderChipSapXep();
      render();
    });
  });
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
  renderChipSapXep();

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
  const nhomThu = dsThu().map(c => `<option value="nguonThu:${c}">Thu · ${c}</option>`).join("");
  const nhomChi = dsChi().map(c => `<option value="danhMucChi:${c}">Chi · ${c}</option>`).join("");
  // Một người thì "Chi bởi X" trùng với tổng chi, bỏ cho gọn danh sách.
  const nhomNguoi = PAYERS.length < 2 ? ""
    : PAYERS.map(p => `<option value="nguoiChi:${p}">Chi bởi ${p}</option>`).join("");

  oChuoi.innerHTML =
    `<option value="thuchi">Tổng thu và tổng chi</option>` + nhomThu + nhomChi + nhomNguoi;
  oChuoi.value = chartChuoi;
  oChuoi.onchange = () => { chartChuoi = oChuoi.value; veBieuDo(); };
}

// ===== Tình hình hiện tại =====
// Khối này nằm trên cùng tab Thống kê và KHÔNG chịu ảnh hưởng của bộ chọn kỳ:
// nó là ảnh chụp tại hôm nay, trong khi phần còn lại của tab là số của một kỳ.
// Trộn hai thứ vào một bộ lọc là cách chắc chắn nhất để ra số sai.
function hangHienTai(ten, phu, tien, kieu, bamVao, themLop) {
  const am = tien < 0;
  const so = (am ? "−" : "") + formatMoney(Math.abs(tien)) + " đ";
  const the = bamVao ? "button" : "div";
  const them = bamVao ? ` data-mo="${bamVao}"` : "";
  return `<${the} type="button" class="hn-hang${bamVao ? " bam" : ""}${themLop ? " " + themLop : ""}"${them}>
            <div class="hn-than">
              <div class="hn-ten">${ten}</div>
              <div class="hn-phu">${phu}</div>
            </div>
            <div class="hn-so ${kieu}">${so}</div>
          </${the}>`;
}

function renderHienTai() {
  const box = $("hiennay-block");
  if (!box) return;

  const t = Logic.tinhHinhHienTai(tatCaKhoan(), caiDatVi, dsTietKiem);

  // Chỉ đếm ví có phát sinh hoặc có số dư đầu — ví mặc định chưa dùng bao giờ
  // mà đếm vào thì câu "trong 4 ví" là nói dối.
  const viDung = t.thuTuVi.filter(v => {
    const o = t.vi[v];
    return o.con !== 0 || o.thu || o.chi || o.den || o.di || o.soDuDau;
  }).length;

  let html = `<h3>Tình hình hiện tại</h3>`;

  html += hangHienTai(
    "Tiền còn",
    viDung ? `đang nằm trong ${viDung} ví` : "chưa có ví nào có tiền",
    t.tienCon, t.tienCon < 0 ? "am" : "con", "tab-btn-vi"
  );

  if (t.tietKiem > 0) {
    html += hangHienTai(
      "Gửi tiết kiệm", `${t.soSoTietKiem} sổ, tiền của mình nhưng chưa rút được`,
      t.tietKiem, "con", "tab-btn-no"
    );
  }

  html += hangHienTai(
    "Người ta nợ mình", "tiền sẽ thu về",
    t.hoNoMinh, "ho-no-minh", "tab-btn-no"
  );
  html += hangHienTai(
    "Mình đang nợ", "tiền sẽ phải trả",
    t.minhNoHo, "minh-no-ho", "tab-btn-no"
  );

  html += hangHienTai(
    "Tiền mặt ròng", "cộng hết lại, trừ phần phải trả",
    t.rong, t.rong < 0 ? "am" : "con", null, "hn-tong"
  );

  // Dòng này là bắt buộc. Vay 900 triệu mua nhà thì "tiền mặt ròng" âm gần 900 triệu,
  // đúng về số nhưng sai về tình hình — sổ không có chỗ ghi căn nhà.
  html += `<p class="hn-chu">Chưa tính nhà, đất, xe và tài sản khác — sổ này
           chỉ theo dõi tiền.</p>`;

  if (t.chuaGanVi) {
    html += `<p class="hn-canh">${t.chuaGanVi} khoản chưa gán ví nên không nằm
             trong “Tiền còn”.</p>`;
  }

  box.innerHTML = html;

  box.querySelectorAll("[data-mo]").forEach(n => {
    n.addEventListener("click", () => {
      const nut = $(n.getAttribute("data-mo"));
      if (nut) nut.click();
    });
  });
}

function renderStats() {
  const modeBox = $("stat-modes");
  if (!modeBox) return;

  renderHienTai();

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

  renderHanMuc();

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
  const laNo = Logic.laKhoanNo(e);

  $("edit-meta").textContent =
    (laThu ? "Khoản thu" : laChuyen ? "Chuyển lọ"
      : laNo ? `${e.type}${e.doiTuong ? " · " + e.doiTuong : ""}` : "Khoản chi")
    + ` · ghi ngày ${e.date}`;

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
  // Vay nợ cũng khoá danh mục lại. Không khoá thì danh mục bị thay bằng mục
  // chi đầu tiên và khoản cho vay biến thành khoản chi ngay lần lưu kế tiếp.
  const dsDanhMuc = laChuyen ? ["Chuyển lọ"]
    : laNo ? [e.type]
    : (laThu ? dsThu() : dsChi());
  // Khoản CŨ có thể mang danh mục đã bị xoá khỏi cấu hình. Nếu không đưa nó
  // trở lại danh sách thì ô select không khớp mục nào, trình duyệt tự chọn
  // mục ĐẦU TIÊN, và chỉ cần bấm Lưu là khoản âm thầm đổi cả danh mục lẫn lọ.
  if (!laChuyen && !laNo && e.category && dsDanhMuc.indexOf(e.category) < 0) {
    dsDanhMuc.unshift(e.category);
  }
  oDanhMuc.innerHTML = dsDanhMuc.map(c =>
    `<option value="${thoatHtml(c)}"${c === e.category ? " selected" : ""}>${thoatHtml(c)}</option>`
  ).join("");
  oDanhMuc.disabled = laChuyen || laNo;

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
  veChipGoiY("edit-note", "edit-note-goiy", oDanhMuc.value);
  anhSuaMoi = null;
  anhSuaXoa = false;
  veAnhHopSua();
  $("edit-error").hidden = true;
  datLaiNutXoa();
  $("edit-sheet").hidden = false;
}

// ===== Ảnh trong hộp sửa =====
// anhSuaMoi: ảnh vừa chọn, chưa gửi. anhSuaXoa: anh muốn gỡ ảnh đang có.
// Hai thứ này CHỈ được áp dụng khi bấm Lưu, không áp dụng ngay — bấm nhầm rồi
// đóng hộp thì không mất gì.
let anhSuaMoi = null;
let anhSuaXoa = false;

function veAnhHopSua() {
  const khoi = $("edit-anh");
  if (!khoi || !khoanDangSua) return;

  const img = $("edit-anh-img");
  const nhan = $("edit-anh-nhan");
  const boNut = $("edit-anh-bo");
  const themNut = $("edit-anh-them");

  // Khoản còn chờ gửi thì ảnh của nó cũng đang nằm trong máy.
  const coSan = !anhSuaXoa && Logic.coAnh(khoanDangSua, store.anhCho);

  if (anhSuaMoi) {
    img.src = anhUrl(anhSuaMoi);
    img.hidden = false;
    nhan.textContent = `Ảnh mới ${coAnhKb(anhSuaMoi.data)} KB · bấm Lưu để áp dụng`;
    boNut.hidden = false;
    themNut.textContent = "📷 Chọn ảnh khác";
  } else if (anhSuaXoa) {
    img.hidden = true;
    img.removeAttribute("src");
    nhan.textContent = "Sẽ gỡ ảnh khi bấm Lưu";
    boNut.hidden = true;
    themNut.textContent = "📷 Thêm ảnh";
  } else if (coSan) {
    // KHÔNG tải ảnh về ở đây: mở hộp sửa chỉ để đổi số tiền thì tải ảnh về là
    // phí mạng. Bấm vào khung mới mở ảnh.
    img.hidden = true;
    img.removeAttribute("src");
    nhan.textContent = "Có ảnh hoá đơn — bấm vào đây để xem";
    boNut.hidden = false;
    boNut.textContent = "Gỡ ảnh";
    themNut.textContent = "📷 Đổi ảnh";
  } else {
    img.hidden = true;
    img.removeAttribute("src");
    nhan.textContent = "Chưa có ảnh hoá đơn";
    boNut.hidden = true;
    themNut.textContent = "📷 Thêm ảnh";
  }

  if (anhSuaMoi) boNut.textContent = "Bỏ ảnh mới";
  nhan.classList.toggle("co-anh", coSan && !anhSuaMoi);
  khoi.hidden = false;
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

  // Chặn cả ở đây, nếu không thì sửa một khoản là xoá sạch nội dung được —
  // bắt buộc ở màn nhập mà bỏ ngỏ ở màn sửa thì coi như không bắt buộc.
  const noiDungMoi = $("edit-note").value.trim();
  if (!noiDungMoi) {
    loi.textContent = "Nội dung không được để trống.";
    loi.hidden = false;
    $("edit-note").focus();
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
    note: noiDungMoi,
    // Sửa số tiền khoản thu thì phải chia lại vào các lọ, nếu không số dư lọ
    // sẽ vẫn theo số cũ. Chia theo tỉ lệ hiện tại.
    alloc: laThu ? Logic.phanBo(tien, tiLeLo) : (cu.alloc || null),
    // Khoản vay nợ không thuộc lọ nào: nó không tiêu tiền của lọ nào cả.
    jar: Logic.laChuyenLo(cu) ? cu.jar
      : (laThu || Logic.laKhoanNo(cu)) ? "" : Logic.doanLo(danhMuc),
    // Khoản chuyển ví giữ nguyên cặp ví, không cho sửa lệch một đầu
    wallet: Logic.laChuyenVi(cu) ? cu.wallet : (($("edit-wallet") && $("edit-wallet").value) || "")
  };

  // Cập nhật trong máy trước, gửi lên Sheet ở nền — cùng lối với lúc ghi khoản
  // mới. Hộp sửa chỉ mở cho khoản ĐÃ có trên Sheet (dòng còn ⏳ không bấm vào
  // được), nên ở đây không có ca "sửa khoản đang bay lên mạng".
  const i = entries.findIndex(x => x.id === cu.id);
  if (i >= 0) entries[i] = moi;

  // Ảnh xử lý RIÊNG. Gộp vào một lệnh thì ảnh hỏng sẽ kéo theo cả phần sửa
  // số tiền trượt mất.
  if (anhSuaXoa && !anhSuaMoi) {
    themVaoCho("anhXoaCho", cu.id);
    await donAnhTrongMay(cu.id, cu.anh);
    const j = entries.findIndex(x => x.id === cu.id);
    if (j >= 0) entries[j] = { ...entries[j], anh: "" };
    moi.anh = "";
  } else if (anhSuaMoi) {
    // Ảnh cũ do Apps Script tự bỏ vào thùng rác khi nhận ảnh mới; ở đây chỉ
    // cần dọn bản sao trong máy, không thì cache vẫn trả ra ảnh cũ.
    if (cu.anh) await dbThu(dbXoa(KHO_CACHE, cu.anh));
    try {
      await catAnhChoCho(cu.id, anhSuaMoi);
    } catch (err) {
      showToast("Không cất được ảnh trong máy, phần sửa vẫn đã ghi");
    }
    // Gỡ ảnh rồi lại chọn ảnh mới trong cùng một lần sửa: bỏ lệnh gỡ đi,
    // không thì lệnh gỡ chạy sau sẽ xoá mất chính tấm vừa gửi lên.
    boKhoiCho("anhXoaCho", cu.id);
  }

  themSuaCho(moi);

  anhSuaMoi = null;
  anhSuaXoa = false;
  $("edit-sheet").hidden = true;
  showToast("Đã cập nhật khoản này");
  render();

  flushQueue({ im: true });
}

// Thêm/bớt một mã trong các hàng chờ chỉ chứa mã
function themVaoCho(ten, id) {
  const ds = store[ten];
  if (ds.indexOf(id) < 0) store[ten] = [...ds, id];
}
function boKhoiCho(ten, id) {
  store[ten] = store[ten].filter(x => x !== id);
}

// Hàng chờ sửa giữ CẢ khoản, và mỗi khoản chỉ nằm một lần: sửa đi sửa lại ba
// lần thì chỉ bản cuối cần lên Sheet, gửi cả ba là tốn ba lượt gọi vô ích.
function themSuaCho(entry) {
  store.suaCho = [...store.suaCho.filter(e => e.id !== entry.id), entry];
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
  const id = khoanDangSua.id;

  // Xoá khỏi máy ngay, gửi lệnh xoá lên Sheet ở nền.
  entries = entries.filter(x => x.id !== id);

  // Khoản này đang chờ gửi bản sửa thì bỏ luôn lệnh sửa đi: sửa một dòng sắp
  // bị xoá là vô nghĩa, mà còn chắc chắn hỏng vì lúc đó dòng không còn nữa.
  store.suaCho = store.suaCho.filter(e => e.id !== id);
  boKhoiCho("anhXoaCho", id);

  themVaoCho("xoaCho", id);
  await donAnhTrongMay(id, khoanDangSua.anh);

  $("edit-sheet").hidden = true;
  showToast("Đã xoá khoản này");
  render();

  flushQueue({ im: true });
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
  $("edit-note").addEventListener("input", () => {
    veChipGoiY("edit-note", "edit-note-goiy", $("edit-category").value);
  });
  $("edit-category").addEventListener("change", () => {
    veChipGoiY("edit-note", "edit-note-goiy", $("edit-category").value);
  });
}

// Hộp chi tiết dùng chung cho cả màn hình lọ lẫn bảng thống kê.
function moHopChiTiet(tieuDe, tomTat, ds, khiRong, khoanGoc) {
  $("jar-detail-name").textContent = tieuDe;
  $("jar-detail-sum").textContent = tomTat;

  // Tổng hợp theo nội dung: trong "Ăn uống" thì hủ tíu hết bao nhiêu.
  // Chỉ hiện khi có từ 2 nội dung trở lên — một dòng thì bảng thành thừa.
  const oND = $("jar-detail-noidung");
  if (oND) {
    const gom = khoanGoc ? Logic.gomTheoNoiDung(khoanGoc) : [];
    oND.innerHTML = gom.length > 1
      ? `<div class="nd-khoi"><div class="nd-tieude">Theo nội dung</div>` +
        gom.map(g => `
          <div class="nd-dong">
            <span class="nd-ten">${g.noiDung}</span>
            <span class="nd-so">${g.so > 1 ? `×${g.so} · ` : ""}${formatMoney(g.tien)} đ</span>
          </div>`).join("") + `</div>`
      : "";
  }
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
  const goc = Logic.khoanCuaMuc(tatCaKhoan(), tuNgay, denNgay, loai, giaTri);
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
    "Không có khoản nào trong kỳ này.",
    goc
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
    if (s.danhMuc && typeof s.danhMuc === "object") {
      danhMucCfg = Logic.chuanHoaDanhMuc(s.danhMuc);
      apDungDanhMuc();
      renderChips();
    }
    if (s.vi && typeof s.vi === "object") {
      caiDatVi = { ds: Logic.danhSachVi(s.vi), soDuDau: s.vi.soDuDau || {} };
      renderChipVi();
    }
    if (Array.isArray(s.tietKiem)) {
      dsTietKiem = s.tietKiem;
      renderTietKiem();
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
    { nut: "tab-btn-no",      khung: "tab-no" },
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
    if (key === "tab-no") { renderNo(); renderTietKiem(); }
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

  // Nội dung bắt buộc. Danh mục chỉ nói "Ăn uống", nội dung mới nói "Hủ tíu
  // Nam Vang" — thiếu nó thì vài tháng sau nhìn lại không nhớ tiêu vào đâu.
  const noiDung = $("note").value.trim();
  if (!noiDung) {
    error.textContent = "Anh ghi nội dung nhé, ví dụ “Hủ tíu Nam Vang”.";
    error.hidden = false;
    $("note").focus();
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
    note: noiDung,
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

  // Giữ lại rồi xoá khỏi màn hình ngay, để anh ghi khoản tiếp mà không sợ
  // ảnh cũ dính sang khoản mới.
  const anhKem = anhDangChon;
  anhDangChon = null;

  // Ghi vào hàng chờ TRƯỚC, gửi mạng sau và không chờ kết quả.
  //
  // Một lượt gọi Apps Script mất 2,5–5 giây, gần hết là thời gian Google khởi
  // động container và chuyển hướng sang script.googleusercontent.com — không
  // sửa được từ phía app. Bắt người dùng ngồi nhìn "Đang lưu…" chừng đó là vô
  // ích: khoản đã nằm an toàn trong máy ngay từ dòng dưới đây rồi, gửi lên
  // Sheet được hay không chỉ còn là việc của nền.
  //
  // Đây cũng chính là đường đi cũ khi mất mạng, nay thành đường đi DUY NHẤT —
  // nhờ vậy lúc có mạng và lúc mất mạng chạy cùng một mã, không còn hai nhánh
  // mà chỉ một nhánh được thử kỹ.
  store.queue = [entry, ...store.queue];
  try {
    if (anhKem) await catAnhChoCho(entry.id, anhKem);
  } catch (err) {
    // Kho ảnh hỏng thì mất ảnh, nhưng khoản thì không được mất theo.
    showToast("Không cất được ảnh trong máy, khoản vẫn đã ghi");
  }

  showToast(`Đã ghi ${nhanLoai} ${formatMoney(amount)} đ`);

  $("amount").value = "";
  $("note").value = "";
  veXemTruocAnh();
  render();

  // Nhắc hạn mức ngay lúc vừa ghi, chờ 2 giây cho toast trước hiện xong
  setTimeout(() => canhBaoSauKhiGhi(entry), 2000);

  // Cố ý KHÔNG await: gửi xong thì dấu ⏳ tự mất, gửi hỏng thì hàng chờ giữ
  // lại và lần sau tự thử tiếp.
  flushQueue({ im: true });
}

// Chặn hai lượt gửi chạy chồng lên nhau. Giờ mỗi lần lưu khoản đều gọi hàm
// này, nên ghi nhanh ba khoản liền tay là có ba lượt cùng chạy trên cùng một
// hàng chờ: cùng gửi một khoản nhiều lần (máy chủ chặn trùng theo ID nên Sheet
// không sao) và tệ hơn là unshift nó nhiều lần vào entries, làm khoản hiện
// hai dòng trên màn hình.
let dangGuiHangCho = false;

// Thử gửi lại những khoản còn kẹt trong hàng chờ.
// im = true khi lượt gửi này là hệ quả của việc vừa lưu khoản, không phải
// người dùng chủ động yêu cầu gửi lại — lúc đó gửi trót lọt thì im lặng, vì
// dấu ⏳ biến mất đã là lời báo đủ rồi.
async function flushQueue(options = {}) {
  if (dangGuiHangCho) return;
  dangGuiHangCho = true;
  try {
    await guiHangCho(options);
  } finally {
    dangGuiHangCho = false;
  }
}

async function guiHangCho({ im = false } = {}) {
  let daGuiXong = 0;
  let loiPin = false;
  let matDong = 0;          // lệnh sửa trỏ vào dòng không còn trên Sheet
  const hong = new Set();   // id đã thử và hỏng trong lượt này, đừng thử lại ngay

  // Thứ tự ba việc là có chủ ý, không đổi được:
  //   1. THÊM  — phải xong trước, vì sửa và xoá đều cần dòng đã có trên Sheet
  //   2. SỬA   — trước khi xoá, dù lúc xoá đã bỏ lệnh sửa của chính khoản đó
  //   3. XOÁ   — cuối cùng
  // Riêng gỡ ảnh đi kèm vòng sửa vì cùng là "đổi một dòng đang có".

  // ----- 1. Khoản mới -----
  // Vòng lặp đọc lại store.queue ở MỖI bước, cố ý không chụp hàng chờ một lần
  // từ đầu rồi gán đè `store.queue = remain` ở cuối.
  //
  // Lý do: anh ghi khoản mới ngay trong lúc khoản trước còn đang bay lên mạng
  // (mất 2,5–5 giây, thừa thời gian gõ thêm hai khoản nữa). Bản chụp từ đầu
  // không có những khoản đó, nên câu gán đè ở cuối sẽ XOÁ SẠCH chúng. Đã dính
  // đúng lỗi này khi thử ghi nhanh ba khoản: chỉ khoản đầu lên Sheet, hai
  // khoản sau biến mất không dấu vết.
  while (true) {
    const tiep = store.queue.find(e => !hong.has(e.id));
    if (!tiep) break;
    try {
      await callApi("add", { entry: tiep });
      entries.unshift(tiep);
      store.queue = store.queue.filter(e => e.id !== tiep.id);
      daGuiXong++;
    } catch (err) {
      if (err && err.pinError) loiPin = true;
      hong.add(tiep.id);
    }
  }

  // ----- 2. Bản sửa -----
  while (true) {
    // Bỏ qua khoản đã nằm trong hàng chờ xoá: gửi bản sửa cho một dòng sắp bị
    // xoá là tốn một lượt gọi 2,5 giây để ghi vào chỗ sắp biến mất.
    const tiep = store.suaCho.find(
      e => !hong.has("sua:" + e.id) && store.xoaCho.indexOf(e.id) < 0
    );
    if (!tiep) break;
    try {
      await callApi("update", { entry: tiep });
      store.suaCho = store.suaCho.filter(e => e.id !== tiep.id);
      daGuiXong++;
    } catch (err) {
      if (err && err.pinError) loiPin = true;
      if (err && err.khongTim) {
        // Dòng không còn trên Sheet — ai đó đã xoá ở máy khác. Giữ lại lệnh
        // sửa thì nó hỏng mãi mãi, nên bỏ đi và báo cho anh biết.
        store.suaCho = store.suaCho.filter(e => e.id !== tiep.id);
        entries = entries.filter(e => e.id !== tiep.id);
        matDong++;
      } else {
        hong.add("sua:" + tiep.id);
      }
    }
  }

  // ----- 2b. Gỡ ảnh khỏi khoản (khoản vẫn còn) -----
  while (true) {
    const id = store.anhXoaCho.find(x => !hong.has("anhxoa:" + x));
    if (!id) break;
    try {
      await callApi("xoaAnh", { id });
      boKhoiCho("anhXoaCho", id);
    } catch (err) {
      if (err && err.pinError) loiPin = true;
      hong.add("anhxoa:" + id);
    }
  }

  // ----- 3. Xoá khoản -----
  // Apps Script trả ok kể cả khi dòng đã biến mất (daXoaTruocDo), nên lệnh xoá
  // gửi lại nhiều lần không sao.
  while (true) {
    const id = store.xoaCho.find(x => !hong.has("xoa:" + x));
    if (!id) break;
    try {
      await callApi("delete", { id });
      boKhoiCho("xoaCho", id);
      daGuiXong++;
    } catch (err) {
      if (err && err.pinError) loiPin = true;
      hong.add("xoa:" + id);
    }
  }

  const conKet = store.queue.length + store.suaCho.length
               + store.xoaCho.length + store.anhXoaCho.length;

  if (loiPin) {
    // Nuốt lỗi PIN ở đây là tình huống nguy hiểm nhất của cách lưu nền: việc
    // nằm mãi trong hàng chờ mà anh đã thấy chữ "Đã ghi" nên tưởng xong rồi.
    showToast("PIN đã đổi, chưa gửi được lên Sheet — anh mở lại sổ nhé");
  } else if (matDong) {
    showToast(`${matDong} khoản đã bị xoá ở nơi khác, không sửa được nữa`);
  } else if (conKet) {
    showToast(`${conKet} việc chưa gửi được, sẽ tự gửi lại`);
  } else if (daGuiXong && !im) {
    showToast(`Đã gửi ${daGuiXong} việc còn kẹt`);
  }

  // Ảnh gửi sau khoản: ảnh chỉ gắn được vào khoản đã nằm trên Sheet. Đảo thứ
  // tự thì ảnh của khoản vừa gửi luôn trượt sang vòng sau.
  await flushAnh();
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
  initDanhMuc();
  initAnh();
  initNo();

  // Vừa gõ vừa chấm phân cách nghìn cho dễ đọc
  $("amount").addEventListener("input", e => {
    const n = parseAmount(e.target.value);
    e.target.value = n ? formatMoney(n) : "";
  });

  // Vừa gõ vừa lọc gợi ý, không dấu cũng ra
  $("note").addEventListener("input", capNhatGoiYNhap);

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

  // Vừa có sóng lại thì gửi ngay, không bắt anh phải mở app ra lần nữa. Quan
  // trọng với ảnh: ghi khoản trong hầm gửi xe, lên tới mặt đất là ảnh tự đi.
  window.addEventListener("online", () => {
    if (!$("app").hidden) flushQueue();
  });

  // Bấm nút lùi trên Android khi đang xem ảnh thì đóng ảnh, đừng thoát app.
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !$("anh-xem").hidden) dongHopXemAnh();
  });

  initResetButton();
  initGate();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
