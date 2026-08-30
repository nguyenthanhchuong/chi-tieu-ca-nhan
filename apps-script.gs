/**
 * Sổ Chi Tiêu - phần chạy trên Google (Apps Script).
 *
 * CÁCH CÀI:
 *  1. Tạo một Google Sheet mới, đặt tên tuỳ ý.
 *  2. Trong Sheet: Tiện ích mở rộng (Extensions) > Apps Script.
 *  3. Xoá hết code mẫu, dán toàn bộ file này vào, rồi bấm LƯU (Ctrl+S).
 *  4. Đặt mã PIN — KHÔNG ghi vào code:
 *     Project Settings (bánh răng bên trái) > Script Properties >
 *     Add script property > Property: PIN | Value: mã riêng của anh > Save.
 *  5. Bấm Triển khai (Deploy) > Tuỳ chọn triển khai mới (New deployment)
 *     - Loại: Ứng dụng web (Web app)
 *     - Thực thi với tư cách (Execute as): Tôi (Me)
 *     - Ai có quyền truy cập (Who has access): Bất kỳ ai (Anyone)
 *  6. Copy URL nhận được, dán vào biến API_URL trong file app.js.
 *
 * ĐỔI PIN VỀ SAU: chỉ cần sửa lại giá trị trong Script Properties (bước 4).
 * Có hiệu lực NGAY, không phải deploy lại — vì PIN được đọc lúc chạy chứ
 * không nằm trong code đã đóng gói.
 *
 * Vì sao để PIN ở Script Properties thay vì trong code:
 *  - Code file này nằm trong repo GitHub public, ai cũng đọc được.
 *  - Sửa PIN trong code thì phải deploy phiên bản mới mới ăn; quên bước đó
 *    là PIN cũ vẫn dùng được mà không hề hay biết.
 *
 * Lưu ý: đặt "Anyone" là bắt buộc để trang web gọi được, nhưng mọi yêu cầu
 * đều phải kèm đúng PIN nên người lạ có URL cũng không đọc/ghi được.
 */

// Đọc lúc chạy nên đổi PIN trong Script Properties là ăn ngay.
function layPin_() {
  return PropertiesService.getScriptProperties().getProperty("PIN");
}

// ===== Khoá tạm khi nhập sai PIN nhiều lần =====
// Web App phải mở "Anyone" thì trang web mới gọi được, nên PIN là lớp chắn duy
// nhất. Không có cơ chế này thì người lạ có URL (URL nằm trong repo public) có
// thể dò PIN bằng cách thử liên tục không giới hạn.
//
// Đếm để trong CacheService: tự hết hạn, không phải dọn dẹp, và không đụng vào
// Script Properties nơi cất PIN.
const KHOA_BAC = [
  { tuLan: 12, giay: 1800 },  // sai 12 lần trở lên -> khoá 30 phút
  { tuLan:  8, giay:  300 },  // sai 8  lần trở lên -> khoá 5 phút
  { tuLan:  5, giay:   60 }   // sai 5  lần trở lên -> khoá 1 phút
];
const CACHE_DEM = "pin_sai_lien_tiep";
const CACHE_KHOA_DEN = "pin_khoa_den";
const DEM_HET_HAN_GIAY = 3600;   // 1 tiếng không sai thêm thì quên chuyện cũ

function cache_() { return CacheService.getScriptCache(); }

// Còn đang bị khoá thì trả về số giây phải chờ, ngược lại trả 0.
function conPhaiChoGiay_() {
  const den = Number(cache_().get(CACHE_KHOA_DEN) || 0);
  if (!den) return 0;
  const con = Math.ceil((den - Date.now()) / 1000);
  return con > 0 ? con : 0;
}

function ghiNhanSaiPin_() {
  // Khoá script khi cộng dồn: kẻ dò PIN sẽ bắn nhiều yêu cầu song song, không
  // có khoá thì các luồng cùng đọc một giá trị cũ và bộ đếm gần như đứng yên.
  // Chỉ khoá ở nhánh SAI nên lần đăng nhập đúng không bị chậm thêm.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (err) { return 0; }
  try {
    const c = cache_();
    const soLan = Number(c.get(CACHE_DEM) || 0) + 1;
    c.put(CACHE_DEM, String(soLan), DEM_HET_HAN_GIAY);

    const bac = KHOA_BAC.find(b => soLan >= b.tuLan);
    if (bac) {
      c.put(CACHE_KHOA_DEN, String(Date.now() + bac.giay * 1000), bac.giay + 60);
      return bac.giay;
    }
    return 0;
  } finally {
    lock.releaseLock();
  }
}

function xoaDauVetSaiPin_() {
  cache_().removeAll([CACHE_DEM, CACHE_KHOA_DEN]);
}

function moTaThoiGian_(giay) {
  if (giay >= 60) return Math.ceil(giay / 60) + " phút";
  return giay + " giây";
}

const SHEET_NAME = "ChiTieu";
const SHEET_CAIDAT = "CaiDat";

// Cột thêm về sau luôn nối vào CUỐI: hàng cũ để trống ô mới và vẫn đọc được.
//  Loại    : Chi | Thu | Chuyển
//  Lọ      : khoản chi trừ lọ nào; lệnh chuyển thì đây là lọ nguồn
//  Lọ đích : chỉ dùng cho lệnh chuyển
//  Phân bổ : với khoản thu, lưu số tiền đã chia vào từng lọ tại thời điểm ghi.
//            Phải lưu lại vì tỉ lệ có thể đổi về sau mà lịch sử thì không được đổi.
const HEADERS = ["ID", "Ngày", "Số tiền", "Danh mục", "Ghi chú", "Người chi",
                 "Thời điểm ghi", "Loại", "Lọ", "Lọ đích", "Phân bổ"];

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    return sheet;
  }

  // Sheet đã có từ trước và thiếu cột mới thì bổ sung tiêu đề còn thiếu,
  // không đụng tới dữ liệu đang có.
  const soCot = sheet.getLastColumn();
  if (soCot < HEADERS.length) {
    const thieu = HEADERS.slice(soCot);
    sheet.getRange(1, soCot + 1, 1, thieu.length)
      .setValues([thieu])
      .setFontWeight("bold");
  }
  return sheet;
}

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const pinThat = layPin_();

    // Chưa cài PIN thì KHOÁ HẲN, không cho đi tiếp. Nếu bỏ qua bước này,
    // pinThat là null và người gửi pin null/thiếu sẽ khớp -> mở toang sổ.
    if (!pinThat) {
      return reply({
        ok: false,
        error: "Chưa cài PIN: vào Project Settings > Script Properties, thêm khoá PIN.",
      });
    }

    // Đang trong thời gian khoá thì chặn trước, KHÔNG so PIN. Nếu vẫn so, kẻ dò
    // vẫn biết được mã nào đúng qua việc thử lúc sắp hết khoá.
    const choGiay = conPhaiChoGiay_();
    if (choGiay > 0) {
      return reply({
        ok: false,
        error: "Sai PIN nhiều lần, tạm khoá. Thử lại sau " + moTaThoiGian_(choGiay) + ".",
      });
    }

    if (typeof body.pin !== "string" || body.pin !== pinThat) {
      const khoaGiay = ghiNhanSaiPin_();
      if (khoaGiay > 0) {
        return reply({
          ok: false,
          error: "Sai PIN nhiều lần, tạm khoá. Thử lại sau " + moTaThoiGian_(khoaGiay) + ".",
        });
      }
      return reply({ ok: false, error: "PIN không đúng" });
    }

    // Đúng PIN thì xoá sạch dấu vết, để vài lần gõ nhầm rải rác không cộng dồn
    // rồi khoá oan người dùng thật.
    xoaDauVetSaiPin_();

    if (body.action === "list") {
      return reply({ ok: true, entries: listEntries() });
    }

    if (body.action === "add") {
      return reply(addEntry(body.entry));
    }

    // Nhiều lệnh trong một lần gọi: dùng khi app tự dồn dư nhiều tháng.
    if (body.action === "addMany") {
      const ds = body.entries || [];
      let daGhi = 0;
      for (let i = 0; i < ds.length; i++) {
        const r = addEntry(ds[i]);
        if (r.ok && !r.duplicated) daGhi++;
      }
      return reply({ ok: true, daGhi: daGhi, tong: ds.length });
    }

    if (body.action === "update") {
      return reply(suaKhoan(body.entry));
    }

    if (body.action === "delete") {
      return reply(xoaKhoan(body.id));
    }

    if (body.action === "getSettings") {
      return reply({ ok: true, settings: docCaiDat() });
    }

    if (body.action === "setSettings") {
      return reply(ghiCaiDat(body.settings));
    }

    return reply({ ok: false, error: "Không rõ yêu cầu: " + body.action });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

// Trả về các khoản gần nhất, mới nhất lên đầu.
// Giới hạn nới rộng vì màn hình thống kê cần dữ liệu cả năm, 100 dòng không đủ.
const GIOI_HAN = 3000;

function listEntries() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const start = Math.max(2, lastRow - GIOI_HAN + 1);
  const rows = sheet.getRange(start, 1, lastRow - start + 1, HEADERS.length).getValues();

  return rows.map(function (r) {
    return {
      id: String(r[0]),
      date: formatDate(r[1]),
      amount: Number(r[2]) || 0,
      category: String(r[3] || ""),
      note: String(r[4] || ""),
      payer: String(r[5] || ""),
      // Hàng cũ chưa có cột này, mặc định là khoản chi.
      type: String(r[7] || "Chi"),
      jar: String(r[8] || ""),
      jarTo: String(r[9] || ""),
      alloc: docPhanBo(r[10])
    };
  }).reverse();
}

// Bảng phân bổ lưu dạng JSON. Hàng cũ để trống thì trả null, khi đó app tự
// chia lại theo tỉ lệ hiện tại.
function docPhanBo(o) {
  const s = String(o || "").trim();
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return (v && typeof v === "object") ? v : null;
  } catch (err) {
    return null;
  }
}

function addEntry(entry) {
  if (!entry || !entry.id) return { ok: false, error: "Thiếu dữ liệu khoản chi" };

  const sheet = getSheet();

  // Chặn ghi trùng: hàng chờ ngoài app có thể gửi lại cùng một khoản.
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(entry.id)) {
        return { ok: true, duplicated: true };
      }
    }
  }

  const loai = (entry.type === "Thu" || entry.type === "Chuyển") ? entry.type : "Chi";

  sheet.appendRow([
    entry.id,
    entry.date || "",
    Number(entry.amount) || 0,
    entry.category || "",
    entry.note || "",
    entry.payer || "",
    new Date(),
    loai,
    entry.jar || "",
    entry.jarTo || "",
    entry.alloc ? JSON.stringify(entry.alloc) : ""
  ]);

  return { ok: true };
}

// Tìm số dòng theo ID. Trả 0 nếu không có.
function timDongTheoId(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || !id) return 0;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return 0;
}

// Sửa khoản đã ghi. Giữ nguyên ID và cột "Thời điểm ghi" để còn truy được
// khoản này được tạo lúc nào.
function suaKhoan(entry) {
  if (!entry || !entry.id) return { ok: false, error: "Thiếu mã khoản cần sửa" };

  const sheet = getSheet();
  const dong = timDongTheoId(sheet, entry.id);
  if (!dong) return { ok: false, error: "Không tìm thấy khoản này, có thể đã bị xoá" };

  const loai = (entry.type === "Thu" || entry.type === "Chuyển") ? entry.type : "Chi";

  // Ghi lại từ cột Ngày (2) tới cột Danh mục/Ghi chú/Người, bỏ qua cột 7.
  sheet.getRange(dong, 2, 1, 5).setValues([[
    entry.date || "",
    Number(entry.amount) || 0,
    entry.category || "",
    entry.note || "",
    entry.payer || ""
  ]]);

  sheet.getRange(dong, 8, 1, 4).setValues([[
    loai,
    entry.jar || "",
    entry.jarTo || "",
    entry.alloc ? JSON.stringify(entry.alloc) : ""
  ]]);

  return { ok: true };
}

function xoaKhoan(id) {
  if (!id) return { ok: false, error: "Thiếu mã khoản cần xoá" };

  const sheet = getSheet();
  const dong = timDongTheoId(sheet, id);
  if (!dong) return { ok: true, daXoaTruocDo: true };

  sheet.deleteRow(dong);
  return { ok: true };
}

// ===== Cài đặt dùng chung cho mọi thiết bị =====
// Để trong Sheet chứ không để trong máy, vì hai vợ chồng dùng hai điện thoại
// khác nhau mà tỉ lệ các lọ thì phải giống nhau.
function getSheetCaiDat() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_CAIDAT);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_CAIDAT);
    sheet.appendRow(["Khoá", "Giá trị"]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 2).setFontWeight("bold");
  }
  return sheet;
}

function docCaiDat() {
  const sheet = getSheetCaiDat();
  const lastRow = sheet.getLastRow();
  const kq = {};
  if (lastRow < 2) return kq;

  const rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  rows.forEach(function (r) {
    const khoa = String(r[0] || "").trim();
    if (!khoa) return;
    const tho = String(r[1] || "");
    try { kq[khoa] = JSON.parse(tho); } catch (err) { kq[khoa] = tho; }
  });
  return kq;
}

function ghiCaiDat(caiDat) {
  if (!caiDat || typeof caiDat !== "object") {
    return { ok: false, error: "Thiếu dữ liệu cài đặt" };
  }

  const sheet = getSheetCaiDat();
  const lastRow = sheet.getLastRow();
  const dangCo = {};
  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    rows.forEach(function (r, i) { dangCo[String(r[0] || "").trim()] = i + 2; });
  }

  Object.keys(caiDat).forEach(function (khoa) {
    const gt = JSON.stringify(caiDat[khoa]);
    if (dangCo[khoa]) {
      sheet.getRange(dangCo[khoa], 2).setValue(gt);
    } else {
      sheet.appendRow([khoa, gt]);
    }
  });

  return { ok: true, settings: docCaiDat() };
}

// Sheet trả ô ngày về dưới dạng đối tượng Date. Không dùng "instanceof Date"
// vì trong Apps Script phép này không đáng tin, làm ngày lọt ra ngoài dạng
// "Sat Aug 08 2026..." khiến app lọc theo tháng không khớp và báo tổng 0đ.
function formatDate(value) {
  if (value && typeof value.getTime === "function") {
    return Utilities.formatDate(new Date(value.getTime()),
                                Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value || "");
}
