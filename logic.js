// Phần tính toán thuần: không đụng tới DOM, không gọi mạng.
// Tách riêng để test được độc lập (xem test.html).
const Logic = (function () {

  function formatMoney(n) {
    return new Intl.NumberFormat("vi-VN").format(Math.round(n));
  }

  // Lấy số thuần từ chuỗi người dùng gõ ("50.000" -> 50000)
  function parseAmount(text) {
    const digits = String(text == null ? "" : text).replace(/[^\d]/g, "");
    return digits ? parseInt(digits, 10) : 0;
  }

  // Giống parseAmount nhưng GIỮ dấu âm.
  //
  // CHỈ dùng cho số dư đầu ví. Thẻ tín dụng đang nợ thì số dư đầu là số ÂM:
  // thẻ không chứa tiền của mình, nó chứa khoản mình nợ ngân hàng. Trước đây ô
  // này dùng parseAmount, mà parseAmount xoá sạch ký tự không phải chữ số, nên
  // gõ "−5.000.000" lại lưu thành "+5.000.000" — sai ngược hẳn mà không báo gì.
  //
  // TUYỆT ĐỐI không dùng cho số tiền của khoản thu/chi: một khoản chi âm là vô
  // nghĩa và sẽ làm hỏng mọi phép cộng trong sổ.
  //
  // Nhận cả bốn kiểu gạch ngang vì bàn phím điện thoại và chính app cho ra
  // những ký tự khác nhau: "-" (ASCII), "−" (dấu trừ thật, app dùng khi hiện
  // số âm), "–" và "—" (gạch nối dài, bàn phím iOS hay tự đổi thành).
  function coDauAm(text) {
    return /^\s*[-−–—]/.test(String(text == null ? "" : text));
  }

  function parseAmountCoAm(text) {
    const n = parseAmount(text);
    return coDauAm(text) ? -n : n;
  }

  function ngayKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function thangKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // Hàng cũ trong Sheet chưa có cột Loại nên mặc định là khoản chi.
  function laKhoanThu(e) {
    return e && e.type === "Thu";
  }

  // Chuyển tiền giữa hai lọ: tổng tiền trong nhà không đổi.
  // Phải loại khỏi mọi phép tính Thu/Chi, nếu không báo cáo sẽ phồng lên
  // cả hai đầu mà nhìn vẫn hợp lý nên rất khó phát hiện.
  function laChuyenLo(e) {
    return e && e.type === "Chuyển";
  }

  // ===== Vay nợ =====
  // Bốn loại, khác nhau ở CHIỀU TIỀN và CHIỀU NỢ:
  //   Cho vay : tiền ra, họ nợ mình tăng
  //   Thu nợ  : tiền vào, họ nợ mình giảm
  //   Đi vay  : tiền vào, mình nợ họ tăng
  //   Trả nợ  : tiền ra, mình nợ họ giảm
  // KHÔNG cái nào là thu/chi: cho vay 20 triệu thì tiền vẫn của mình, chỉ đang
  // nằm chỗ khác. Tính vào chi tiêu sẽ làm báo cáo sai hẳn.
  const LOAI_NO = ["Cho vay", "Thu nợ", "Đi vay", "Trả nợ"];

  function laKhoanNo(e) {
    return !!(e && LOAI_NO.indexOf(e.type) >= 0);
  }

  // Khoản nợ làm tiền RỜI ví hay VÀO ví
  function noLamTienRa(e) {
    return e && (e.type === "Cho vay" || e.type === "Trả nợ");
  }

  function laKhoanChi(e) {
    return !laKhoanThu(e) && !laChuyenLo(e) && !laChuyenVi(e) && !laKhoanNo(e);
  }

  // Chuyển tiền giữa hai VÍ (vd rút ngân hàng ra tiền mặt). Tiền không rời
  // túi nên KHÔNG phải khoản chi.
  function laChuyenVi(e) {
    return e && e.type === "Chuyển ví";
  }

  // ===== Bốn chiếc lọ (bản cá nhân) =====
  // Sổ gia đình đã lo phần khung: chợ búa, hoá đơn, tiết kiệm mua nhà, hiếu hỉ.
  // Sổ này chỉ theo dõi tiền riêng, nên bỏ các lọ trùng vai (Tự do tài chính,
  // Tiết kiệm dài hạn, Cho đi) và hạ Thiết yếu xuống vì phần lớn chi thiết yếu
  // của hộ không đi qua đây.
  //
  // congDon: true = tiền để dành, cộng dồn qua các tháng.
  //          false = tiêu theo tháng, hết tháng phần dư được chuyển đi.
  // canhBaoRut: lọ mà việc rút ra đi ngược mục đích tiết kiệm.
  const LOS = [
    { key: "NEC",  ten: "Thiết yếu",     tiLe: 45, congDon: false },
    { key: "PLAY", ten: "Hưởng thụ",     tiLe: 25, congDon: false },
    { key: "SAVE", ten: "Tích luỹ riêng", tiLe: 20, congDon: true,  canhBaoRut: true },
    { key: "EDU",  ten: "Học tập",       tiLe: 10, congDon: true }
  ];

  const LO_MAC_DINH_NHAN_DU = "SAVE";   // phần dư cuối tháng dồn về đây

  function timLo(key) {
    return LOS.find(l => l.key === key) || null;
  }

  function tiLeMacDinh() {
    const r = {};
    LOS.forEach(l => { r[l.key] = l.tiLe; });
    return r;
  }

  // Danh mục chi suy ra lọ nào. Người dùng sửa được từng khoản.
  const LO_THEO_DANH_MUC = {
    "Ăn uống": "NEC", "Đi lại": "NEC",
    "Điện thoại/Internet": "NEC", "Sức khoẻ": "NEC",
    "Cà phê/Nhậu": "PLAY", "Mua sắm cá nhân": "PLAY",
    "Thể thao": "PLAY", "Giải trí": "PLAY", "Mua sắm": "PLAY",
    "Học tập": "EDU",
    // Danh mục cũ của sổ gia đình: giữ lại để khoản nhập từ trước vẫn đọc được.
    "Chợ/Siêu thị": "NEC", "Hoá đơn": "NEC", "Đồ dùng gia đình": "NEC",
    "Biếu tặng": "PLAY", "Từ thiện": "PLAY", "Đầu tư": "SAVE", "Mua tài sản": "SAVE"
  };

  // Danh mục mặc định, dùng khi người dùng chưa tự cấu hình gì.
  // Thứ tự ở đây chính là thứ tự chip hiện ra trên màn hình nhập.
  const DANH_MUC_CHI_MAC_DINH = [
    { ten: "Ăn uống", lo: "NEC" },
    { ten: "Cà phê/Nhậu", lo: "PLAY" },
    { ten: "Đi lại", lo: "NEC" },
    { ten: "Điện thoại/Internet", lo: "NEC" },
    { ten: "Sức khoẻ", lo: "NEC" },
    { ten: "Mua sắm cá nhân", lo: "PLAY" },
    { ten: "Thể thao", lo: "PLAY" },
    { ten: "Giải trí", lo: "PLAY" },
    { ten: "Học tập", lo: "EDU" },
    { ten: "Mua tài sản", lo: "SAVE" },
    { ten: "Khác", lo: "NEC" }
  ];

  const DANH_MUC_THU_MAC_DINH = [
    "Lương", "Thưởng", "Tiền tiêu vặt", "Kinh doanh", "Được tặng", "Khác"
  ];

  // Bản đồ danh mục→lọ do NGƯỜI DÙNG cấu hình. Để ở phạm vi module thay vì
  // truyền tham số vì doanLo được gọi từ 6 chỗ sâu bên trong logic này
  // (soDuCacLo, tongKetLoc, chuanHoaHanMuc…); thêm tham số vào tất cả sẽ
  // phải sửa cả chuỗi hàm gọi nhau, rủi ro hơn nhiều so với một biến ở đây.
  // ĐÁNH ĐỔI: đây là trạng thái dùng chung. Test phải gọi datDanhMucChi(null)
  // để trả về mặc định, nếu không nhóm test này sẽ làm sai nhóm test khác.
  let loNguoiDungDat = null;

  function datDanhMucChi(dsChi) {
    if (!Array.isArray(dsChi) || !dsChi.length) { loNguoiDungDat = null; return; }
    const m = {};
    dsChi.forEach(d => {
      const ten = String((d && d.ten) || "").trim();
      if (ten && timLo((d && d.lo) || "")) m[ten] = d.lo;
    });
    loNguoiDungDat = Object.keys(m).length ? m : null;
  }

  // Thứ tự tra: cấu hình của người dùng → bảng gốc → NEC.
  // Bảng gốc phải giữ lại vì khoản CŨ có thể mang danh mục người dùng đã xoá,
  // hoặc danh mục của sổ gia đình; mất bảng này là chúng rơi hết vào NEC.
  function doanLo(danhMuc) {
    if (loNguoiDungDat && loNguoiDungDat[danhMuc]) return loNguoiDungDat[danhMuc];
    return LO_THEO_DANH_MUC[danhMuc] || "NEC";
  }

  // Làm sạch cấu hình danh mục đọc từ Sheet: bỏ tên rỗng, bỏ trùng (giữ cái
  // đầu), ép lọ về một key có thật. Hỏng hoặc rỗng thì trả về mặc định —
  // sổ không bao giờ được rơi vào trạng thái không có danh mục nào để chọn.
  function chuanHoaDanhMuc(cfg) {
    const nguonChi = (cfg && Array.isArray(cfg.chi)) ? cfg.chi : null;
    const nguonThu = (cfg && Array.isArray(cfg.thu)) ? cfg.thu : null;

    const daCo = new Set();
    const chi = [];
    (nguonChi || []).forEach(d => {
      const ten = String((d && d.ten) || "").trim();
      if (!ten || daCo.has(ten)) return;
      daCo.add(ten);
      const lo = timLo((d && d.lo) || "") ? d.lo : (LO_THEO_DANH_MUC[ten] || "NEC");
      chi.push({ ten, lo });
    });

    const daCoThu = new Set();
    const thu = [];
    (nguonThu || []).forEach(t => {
      const ten = String(t || "").trim();
      if (!ten || daCoThu.has(ten)) return;
      daCoThu.add(ten);
      thu.push(ten);
    });

    return {
      chi: chi.length ? chi : DANH_MUC_CHI_MAC_DINH.map(d => ({ ten: d.ten, lo: d.lo })),
      thu: thu.length ? thu : DANH_MUC_THU_MAC_DINH.slice()
    };
  }

  // Đếm số khoản đang dùng từng danh mục chi — để cảnh báo trước khi xoá.
  function demKhoanTheoDanhMuc(khoan) {
    const kq = {};
    (khoan || []).forEach(e => {
      if (!laKhoanChi(e)) return;
      const c = String((e && e.category) || "").trim();
      if (c) kq[c] = (kq[c] || 0) + 1;
    });
    return kq;
  }

  // Chia khoản thu vào các lọ theo tỉ lệ.
  // Phần lẻ do làm tròn dồn hết vào lọ lớn nhất để TỔNG LUÔN BẰNG số tiền gốc —
  // nếu để hụt vài đồng mỗi lần, sau vài trăm giao dịch sổ sẽ lệch không truy được.
  function phanBo(soTien, tiLe) {
    const tien = Math.round(Number(soTien) || 0);
    const ty = tiLe || tiLeMacDinh();
    const tongTy = LOS.reduce((s, l) => s + (Number(ty[l.key]) || 0), 0);
    if (tien <= 0 || tongTy <= 0) {
      const rong = {}; LOS.forEach(l => { rong[l.key] = 0; }); return rong;
    }

    const kq = {};
    let daChia = 0;
    LOS.forEach(l => {
      const phan = Math.floor(tien * (Number(ty[l.key]) || 0) / tongTy);
      kq[l.key] = phan;
      daChia += phan;
    });

    const loLonNhat = LOS.slice().sort((a, b) =>
      (Number(ty[b.key]) || 0) - (Number(ty[a.key]) || 0))[0];
    kq[loLonNhat.key] += tien - daChia;
    return kq;
  }

  // Số tiền một khoản thu rót vào một lọ. Ưu tiên bảng phân bổ đã lưu cùng
  // khoản thu đó: tỉ lệ có thể đổi về sau, nhưng lịch sử phải giữ nguyên.
  function phanBoCuaKhoanThu(e, tiLeHienTai) {
    if (e && e.alloc && typeof e.alloc === "object") return e.alloc;
    return phanBo(e ? e.amount : 0, tiLeHienTai);
  }

  // Số dư các lọ tính tại thời điểm thangXem ("YYYY-MM").
  // Lọ cộng dồn: tính từ đầu tới hết tháng đó.
  // Lọ theo tháng: chỉ tính trong đúng tháng đó.
  function soDuCacLo(khoan, thangXem, tiLeHienTai) {
    const ds = khoan || [];
    const trongThang = e => String(e.date || "").slice(0, 7) === thangXem;
    const tinhToiNay = e => String(e.date || "").slice(0, 7) <= thangXem;

    const kq = {};
    LOS.forEach(lo => {
      const lay = lo.congDon ? tinhToiNay : trongThang;
      let vao = 0, ra = 0;

      ds.filter(lay).forEach(e => {
        if (laKhoanThu(e)) {
          vao += Number(phanBoCuaKhoanThu(e, tiLeHienTai)[lo.key] || 0);
        } else if (laChuyenLo(e)) {
          if (e.jarTo === lo.key) vao += Number(e.amount) || 0;
          if (e.jar === lo.key)   ra  += Number(e.amount) || 0;
        } else if (laKhoanChi(e) && (e.jar || doanLo(e.category)) === lo.key) {
          // laKhoanChi loại luôn chuyển ví và vay nợ: hai loại đó không phải
          // tiêu tiền, cộng vào lọ sẽ thổi phồng số đã chi.
          ra += Number(e.amount) || 0;
        }
      });

      kq[lo.key] = { key: lo.key, ten: lo.ten, congDon: lo.congDon, vao, ra, con: vao - ra };
    });
    return kq;
  }

  // Liệt kê mọi khoản đã tác động lên một lọ, mới nhất lên đầu.
  // Dùng đúng bộ lọc thời gian như soDuCacLo, nhờ vậy cộng lại luôn ra
  // đúng số dư đang hiện — nếu lệch thì người dùng không hiểu số ở đâu ra.
  function chiTietLo(khoan, loKey, thangXem, tiLeHienTai) {
    const lo = timLo(loKey);
    if (!lo) return [];

    const trongThang = e => String(e.date || "").slice(0, 7) === thangXem;
    const tinhToiNay = e => String(e.date || "").slice(0, 7) <= thangXem;
    const lay = lo.congDon ? tinhToiNay : trongThang;

    const ra = [];
    (khoan || []).filter(lay).forEach(e => {
      if (laKhoanThu(e)) {
        const phan = Number(phanBoCuaKhoanThu(e, tiLeHienTai)[loKey] || 0);
        if (phan > 0) {
          ra.push({
            date: e.date, tien: phan, chieu: "vao",
            moTa: "Chia từ khoản thu" + (e.category ? " · " + e.category : ""),
            note: e.note || ""
          });
        }
      } else if (laChuyenLo(e)) {
        if (e.jarTo === loKey) {
          ra.push({ date: e.date, tien: Number(e.amount) || 0, chieu: "vao",
                    moTa: "Chuyển vào", note: e.note || "" });
        }
        if (e.jar === loKey) {
          ra.push({ date: e.date, tien: Number(e.amount) || 0, chieu: "ra",
                    moTa: "Chuyển đi", note: e.note || "" });
        }
      } else if (laKhoanChi(e) && (e.jar || doanLo(e.category)) === loKey) {
        ra.push({ date: e.date, tien: Number(e.amount) || 0, chieu: "ra",
                  moTa: e.category || "Khác",
                  note: [e.payer, e.note].filter(Boolean).join(" · ") });
      }
    });

    return ra.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  // Rút gọn số tiền cho nhãn biểu đồ: 15.000.000 -> "15tr", 500.000 -> "500k".
  // Trục biểu đồ hẹp, ghi đủ số sẽ chồng chữ lên nhau.
  function formatNgan(n) {
    const t = Math.round(Number(n) || 0);
    if (Math.abs(t) >= 1000000) {
      const tr = t / 1000000;
      return (Math.abs(tr) >= 10 ? Math.round(tr) : Math.round(tr * 10) / 10) + "tr";
    }
    if (Math.abs(t) >= 1000) return Math.round(t / 1000) + "k";
    return String(t);
  }

  // Dãy tháng liên tiếp kết thúc ở denThang. Tự cuộn qua năm.
  function chuoiThang(denThang, soThang) {
    const [n, t] = String(denThang).split("-").map(Number);
    const ra = [];
    for (let i = soThang - 1; i >= 0; i--) {
      const d = new Date(n, t - 1 - i, 1);
      ra.push(thangKey(d));
    }
    return ra;
  }

  // Thu / chi / còn lại của từng tháng. Tháng không có khoản nào vẫn xuất
  // hiện với giá trị 0 để biểu đồ không bị đứt quãng.
  function dienBienTheoThang(khoan, denThang, soThang) {
    const ds = khoan || [];
    return chuoiThang(denThang, soThang).map(thang => {
      const trong = ds.filter(e => String(e.date || "").slice(0, 7) === thang);
      const cong = list => list.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const thu = cong(trong.filter(laKhoanThu));
      const chi = cong(trong.filter(laKhoanChi));
      return { thang, thu, chi, conLai: thu - chi };
    });
  }

  // Diễn biến theo tháng của riêng một mục (một danh mục chi, một nguồn thu,
  // hoặc một người).
  function dienBienMuc(khoan, denThang, soThang, loai, giaTri) {
    const ds = khoan || [];
    const nhan = e => (e && e.category) || "Khác";

    return chuoiThang(denThang, soThang).map(thang => {
      const trong = ds.filter(e => String(e.date || "").slice(0, 7) === thang);
      let loc;
      if (loai === "nguonThu") {
        loc = trong.filter(e => laKhoanThu(e) && nhan(e) === giaTri);
      } else if (loai === "danhMucChi") {
        loc = trong.filter(e => laKhoanChi(e) && nhan(e) === giaTri);
      } else if (loai === "nguoiChi") {
        loc = trong.filter(e => laKhoanChi(e) && e && e.payer === giaTri);
      } else {
        loc = [];
      }
      return { thang, tien: loc.reduce((s, e) => s + (Number(e.amount) || 0), 0) };
    });
  }

  // Liệt kê các khoản đứng sau một dòng trong bảng thống kê.
  // loai: "nguonThu" | "danhMucChi" | "nguoiChi"
  // Cộng lại phải bằng đúng con số trên thanh, nếu không người dùng bấm vào
  // xem sẽ thấy số khác với số vừa nhìn thấy.
  // Các khoản GỐC đứng sau một dòng thống kê. Tách riêng khỏi chiTietMuc để
  // chỗ khác (vd gom theo nội dung) dùng lại được đúng bộ lọc đó — hai nơi
  // lọc theo hai cách là kiểu bug số liệu khó thấy nhất.
  function khoanCuaMuc(khoan, tuNgay, denNgay, loai, giaTri) {
    const trongKy = (khoan || []).filter(e => trongKhoang(e && e.date, tuNgay, denNgay));
    const nhan = e => (e && e.category) || "Khác";

    if (loai === "nguonThu")   return trongKy.filter(e => laKhoanThu(e) && nhan(e) === giaTri);
    if (loai === "danhMucChi") return trongKy.filter(e => laKhoanChi(e) && nhan(e) === giaTri);
    if (loai === "nguoiChi")   return trongKy.filter(e => laKhoanChi(e) && e && e.payer === giaTri);
    return [];
  }

  function chiTietMuc(khoan, tuNgay, denNgay, loai, giaTri) {
    const nhan = e => (e && e.category) || "Khác";
    const ds = khoanCuaMuc(khoan, tuNgay, denNgay, loai, giaTri);
    const vao = loai === "nguonThu";
    return ds
      .map(e => ({
        date: e.date,
        tien: Number(e.amount) || 0,
        chieu: vao ? "vao" : "ra",
        moTa: vao ? (nhan(e)) : (loai === "nguoiChi" ? nhan(e) : (e.payer || "—")),
        note: [vao ? e.payer : null, e.note].filter(Boolean).join(" · ")
      }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  // Phần dư của các lọ theo tháng ở những tháng ĐÃ QUA mà chưa được chuyển đi.
  // Bình thường luôn bằng 0 vì app tự chuyển; khác 0 nghĩa là có lệnh chuyển
  // chưa gửi được, tiền vẫn còn trên sổ chứ không bốc hơi.
  function duChuaChuyen(khoan, thangHienTai, tiLeHienTai) {
    const ds = khoan || [];
    const cacThang = [...new Set(ds.map(e => String(e.date || "").slice(0, 7)))]
      .filter(t => t && t < thangHienTai)
      .sort();

    const ra = [];
    cacThang.forEach(thang => {
      const soDu = soDuCacLo(ds, thang, tiLeHienTai);
      LOS.filter(l => !l.congDon).forEach(lo => {
        const con = soDu[lo.key].con;
        if (con > 0) ra.push({ thang, lo: lo.key, ten: lo.ten, tien: con });
      });
    });
    return ra;
  }

  // Mã cố định theo tháng và lọ: mở app bao nhiêu lần cũng chỉ sinh đúng
  // một lệnh chuyển, vì Apps Script từ chối ghi trùng mã.
  function maChuyenTuDong(thang, loNguon) {
    return `auto-${thang}-${loNguon}`;
  }

  // Dựng các lệnh chuyển tự động cho phần dư tháng trước.
  function lenhChuyenTuDong(khoan, thangHienTai, tiLeHienTai, loNhan) {
    const dich = loNhan || LO_MAC_DINH_NHAN_DU;
    const daCo = new Set((khoan || []).filter(laChuyenLo).map(e => e.id));

    return duChuaChuyen(khoan, thangHienTai, tiLeHienTai)
      .filter(d => d.lo !== dich)
      .map(d => ({
        id: maChuyenTuDong(d.thang, d.lo),
        date: ngayCuoiThang(d.thang),
        amount: d.tien,
        type: "Chuyển",
        jar: d.lo,
        jarTo: dich,
        category: "Chuyển lọ",
        note: `Tự động dồn dư ${d.ten} tháng ${d.thang}`,
        payer: ""
      }))
      .filter(l => !daCo.has(l.id));
  }

  function ngayCuoiThang(thang) {
    const [n, t] = String(thang).split("-").map(Number);
    return ngayKey(new Date(n, t, 0));
  }

  // Rút khỏi lọ tiết kiệm đi ngược mục đích của phương pháp chia lọ:
  // cho phép nhưng phải cảnh báo rõ.
  function cankhoCanhBao(loNguon) {
    const lo = timLo(loNguon);
    return !!(lo && lo.canhBaoRut);
  }

  function kiemTraChuyen(loNguon, loDich, soTien, soDu) {
    if (!loNguon || !loDich) return { duoc: false, loi: "Chọn lọ nguồn và lọ đích nhé." };
    if (loNguon === loDich)  return { duoc: false, loi: "Hai lọ phải khác nhau." };
    if (!(Number(soTien) > 0)) return { duoc: false, loi: "Số tiền phải lớn hơn 0." };

    const con = soDu && soDu[loNguon] ? soDu[loNguon].con : 0;
    const vuot = Number(soTien) > con;
    return {
      duoc: true,
      vuotSoDu: vuot,
      canhBao: cankhoCanhBao(loNguon)
        ? `Đây là tiền để dành. Rút khỏi "${timLo(loNguon).ten}" là đi ngược mục tiêu tích luỹ — chỉ nên làm khi thật cần.`
        : (vuot ? `Lọ "${timLo(loNguon).ten}" chỉ còn ${formatMoney(con)} đ, chuyển đi nhiều hơn sẽ bị âm.` : "")
    };
  }

  // Khoảng ngày của kỳ đang xem. offset 0 = kỳ hiện tại, -1 = kỳ trước.
  // Tham số now tách ra để test cố định được ngày, không phụ thuộc hôm nay.
  // Date của JS tự cuộn năm khi tháng vượt 0..11 nên không cần xử lý riêng.
  function khoangKy(mode, offset, now) {
    now = now || new Date();
    let dau, cuoi;

    if (mode === "tuan") {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const thu = (d.getDay() + 6) % 7;          // quy về thứ Hai = 0
      d.setDate(d.getDate() - thu + offset * 7);
      dau = d;
      cuoi = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
    } else if (mode === "thang") {
      dau = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      cuoi = new Date(dau.getFullYear(), dau.getMonth() + 1, 0);
    } else if (mode === "quy") {
      const quyHienTai = Math.floor(now.getMonth() / 3);
      dau = new Date(now.getFullYear(), (quyHienTai + offset) * 3, 1);
      cuoi = new Date(dau.getFullYear(), dau.getMonth() + 3, 0);
    } else {
      dau = new Date(now.getFullYear() + offset, 0, 1);
      cuoi = new Date(now.getFullYear() + offset, 11, 31);
    }
    return { dau, cuoi };
  }

  function nhanKy(mode, dau, cuoi) {
    const dm = d => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (mode === "tuan") return `${dm(dau)} – ${dm(cuoi)}/${cuoi.getFullYear()}`;
    if (mode === "thang") return `Tháng ${dau.getMonth() + 1}/${dau.getFullYear()}`;
    if (mode === "quy") return `Quý ${Math.floor(dau.getMonth() / 3) + 1}/${dau.getFullYear()}`;
    return `Năm ${dau.getFullYear()}`;
  }

  // Ngày lưu dạng "YYYY-MM-DD" nên so sánh chuỗi là đủ và đúng thứ tự.
  // Hai đầu mốc đều tính vào trong kỳ.
  function trongKhoang(ngay, tuNgay, denNgay) {
    const d = String(ngay || "");
    return d >= tuNgay && d <= denNgay;
  }

  // Gộp số liệu một kỳ. Trả về tổng thu, tổng chi, còn lại và
  // phần chi tách theo danh mục và theo người, đã xếp từ lớn xuống nhỏ.
  function tongHopKy(khoan, tuNgay, denNgay, dsNguoi) {
    const trongKy = (khoan || []).filter(e => trongKhoang(e && e.date, tuNgay, denNgay));
    const khoanThu = trongKy.filter(laKhoanThu);
    // Lệnh chuyển lọ KHÔNG phải khoản chi: tiền chỉ đổi chỗ giữa hai lọ.
    // Tính nhầm vào đây sẽ làm báo cáo phồng lên mà nhìn vẫn hợp lý.
    const khoanChi = trongKy.filter(laKhoanChi);

    const cong = ds => ds.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const tongThu = cong(khoanThu);
    const tongChi = cong(khoanChi);

    const gomDanhMuc = {};
    khoanChi.forEach(e => {
      const k = (e && e.category) || "Khác";
      gomDanhMuc[k] = (gomDanhMuc[k] || 0) + (Number(e.amount) || 0);
    });

    // Nguồn thu: gom khoản thu theo danh mục (Lương, Thưởng, Kinh doanh...)
    const gomNguonThu = {};
    khoanThu.forEach(e => {
      const k = (e && e.category) || "Khác";
      gomNguonThu[k] = (gomNguonThu[k] || 0) + (Number(e.amount) || 0);
    });
    const theoNguonThu = Object.keys(gomNguonThu)
      .map(k => ({ ten: k, tien: gomNguonThu[k] }))
      .sort((a, b) => b.tien - a.tien);

    const theoNguoiThu = (dsNguoi || [])
      .map(p => ({ ten: p, tien: cong(khoanThu.filter(e => e && e.payer === p)) }))
      .filter(h => h.tien > 0)
      .sort((a, b) => b.tien - a.tien);

    const theoDanhMuc = Object.keys(gomDanhMuc)
      .map(k => ({ ten: k, tien: gomDanhMuc[k] }))
      .sort((a, b) => b.tien - a.tien);

    const theoNguoi = (dsNguoi || [])
      .map(p => ({ ten: p, tien: cong(khoanChi.filter(e => e && e.payer === p)) }))
      .filter(h => h.tien > 0)
      .sort((a, b) => b.tien - a.tien);

    return {
      soKhoan: trongKy.length,
      tongThu,
      tongChi,
      conLai: tongThu - tongChi,
      theoDanhMuc,
      theoNguoi,
      theoNguonThu,
      theoNguoiThu
    };
  }

  // Đổi lỗi kỹ thuật thành câu người dùng đọc hiểu được.
  function friendlyError(err) {
    const msg = String((err && err.message) || err || "");
    // Thông báo tạm khoá phải hiện nguyên văn vì nó kèm thời gian chờ. Nếu để
    // rơi vào nhánh pinError bên dưới, người dùng chỉ thấy "PIN không đúng" rồi
    // gõ lại liên tục mà không hiểu vì sao mãi không vào được.
    if (/tạm khoá/i.test(msg)) return msg;
    if (err && err.pinError) return "PIN không đúng.";
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
      return "Không kết nối được, anh kiểm tra mạng giúp nhé.";
    }
    if (/\b(4\d\d|5\d\d)\b/.test(msg)) {
      return "Máy chủ đang bận, anh thử lại sau chút nhé.";
    }
    if (/JSON|Unexpected token/i.test(msg)) {
      return "Máy chủ trả dữ liệu lạ, anh thử lại giúp nhé.";
    }
    return "Có trục trặc, anh thử lại giúp nhé.";
  }

  // ===== Ví / nguồn tiền =====
  // Ví trả lời câu hỏi "tiền đang NẰM Ở ĐÂU", khác hẳn lọ (tiền DÀNH CHO việc gì).
  // Một khoản chi vừa trừ lọ Thiết yếu, vừa trừ ví Tiền mặt — hai chiều độc lập.
  const VI_MAC_DINH = ["Tiền mặt", "Ngân hàng", "Momo", "Thẻ tín dụng"];

  function danhSachVi(caiDat) {
    const ds = caiDat && Array.isArray(caiDat.ds) ? caiDat.ds.filter(Boolean) : null;
    return (ds && ds.length) ? ds : VI_MAC_DINH.slice();
  }

  // Số dư từng ví = số dư đầu + thu vào − chi ra + chuyển đến − chuyển đi.
  // Cộng dồn từ đầu sổ, không theo tháng: ví là số dư thực tại một thời điểm.
  // Khoản chuyển LỌ không đụng tới ví (tiền vẫn nằm nguyên chỗ cũ).
  function soDuCacVi(khoan, caiDatVi) {
    const ds = danhSachVi(caiDatVi);
    const dau = (caiDatVi && caiDatVi.soDuDau) || {};
    const kq = {};
    ds.forEach(v => {
      kq[v] = { ten: v, soDuDau: Number(dau[v]) || 0, thu: 0, chi: 0, den: 0, di: 0 };
    });
    // Khoản gắn ví đã bị xoá khỏi danh sách vẫn phải hiện, nếu không tiền
    // sẽ "bốc hơi" mà không ai biết.
    const baoDam = v => {
      if (!v) return null;
      if (!kq[v]) kq[v] = { ten: v, soDuDau: 0, thu: 0, chi: 0, den: 0, di: 0, ngoaiDs: true };
      return kq[v];
    };

    let chuaGanVi = 0;
    (khoan || []).forEach(e => {
      const tien = Number(e.amount) || 0;
      if (laChuyenLo(e)) return;                       // không ảnh hưởng ví
      if (laChuyenVi(e)) {
        const a = baoDam(e.wallet), b = baoDam(e.walletTo);
        if (a) a.di += tien;
        if (b) b.den += tien;
        return;
      }
      if (!e.wallet) { chuaGanVi++; return; }          // khoản cũ chưa gán ví
      const o = baoDam(e.wallet);
      // Khoản vay nợ cũng làm tiền rời/vào ví, dù không phải thu chi.
      // Bỏ qua thì cho vay 20 triệu mà số dư ví vẫn đứng yên.
      if (laKhoanNo(e)) {
        if (noLamTienRa(e)) o.di += tien; else o.den += tien;
        return;
      }
      if (laKhoanThu(e)) o.thu += tien; else o.chi += tien;
    });

    Object.keys(kq).forEach(v => {
      const o = kq[v];
      o.con = o.soDuDau + o.thu - o.chi + o.den - o.di;
    });
    return { vi: kq, thuTu: Object.keys(kq), chuaGanVi };
  }

  // Kiểm tra trước khi cho chuyển giữa hai ví.
  function kiemTraChuyenVi(viNguon, viDich, soTien) {
    if (!viNguon || !viDich) return { duoc: false, loi: "Chọn ví nguồn và ví đích nhé." };
    if (viNguon === viDich)  return { duoc: false, loi: "Hai ví phải khác nhau." };
    if (!(Number(soTien) > 0)) return { duoc: false, loi: "Số tiền phải lớn hơn 0." };
    return { duoc: true };
  }

  // Số dư nợ theo từng đối tượng.
  // con > 0 : người ta còn nợ mình
  // con < 0 : mình còn nợ người ta
  function soDuNo(khoan) {
    const kq = {};
    (khoan || []).forEach(e => {
      if (!laKhoanNo(e)) return;
      const ai = (e.doiTuong || "").trim() || "Không ghi tên";
      const tien = Number(e.amount) || 0;
      if (!kq[ai]) kq[ai] = { ten: ai, choVay: 0, thuNo: 0, diVay: 0, traNo: 0 };
      if (e.type === "Cho vay") kq[ai].choVay += tien;
      else if (e.type === "Thu nợ") kq[ai].thuNo += tien;
      else if (e.type === "Đi vay") kq[ai].diVay += tien;
      else if (e.type === "Trả nợ") kq[ai].traNo += tien;
    });

    const ds = Object.keys(kq).map(ai => {
      const o = kq[ai];
      o.con = (o.choVay - o.thuNo) - (o.diVay - o.traNo);
      o.chieu = o.con > 0 ? "ho-no-minh" : (o.con < 0 ? "minh-no-ho" : "xong");
      return o;
    });
    // Còn nợ để trên, đã tất toán xuống dưới; trong mỗi nhóm số lớn lên trước
    ds.sort((a, b) => Math.abs(b.con) - Math.abs(a.con));
    return ds;
  }

  function tomTatNo(ds) {
    let hoNoMinh = 0, minhNoHo = 0, xong = 0;
    (ds || []).forEach(o => {
      if (o.con > 0) hoNoMinh += o.con;
      else if (o.con < 0) minhNoHo += -o.con;
      else xong++;
    });
    return { hoNoMinh, minhNoHo, rong: hoNoMinh - minhNoHo, soNguoi: (ds || []).length, xong };
  }

  // ===== Sổ tiết kiệm có kỳ hạn =====
  // Khác lọ: lọ cho biết ĐỂ DÀNH bao nhiêu, sổ tiết kiệm cho biết khoản đó
  // đang gửi ở đâu, lãi bao nhiêu, KHI NÀO lấy ra được.
  const NGUONG_SAP_DAO_HAN = 7;   // ngày, dưới mức này thì cảnh báo

  function themThang(ngay, soThang) {
    const d = new Date(ngay + "T00:00:00");
    const ngayGoc = d.getDate();
    d.setMonth(d.getMonth() + Number(soThang || 0));
    // Gửi ngày 31 mà tháng đích chỉ có 30 ngày thì JS nhảy sang tháng sau,
    // phải kéo lùi về ngày cuối tháng đích.
    if (d.getDate() < ngayGoc) d.setDate(0);
    return ngayKey(d);
  }

  function ngayDaoHan(so) {
    if (!so || !so.ngayGui) return "";
    if (so.ngayDaoHan) return so.ngayDaoHan;      // nhập tay thì ưu tiên
    return themThang(so.ngayGui, so.kyHanThang);
  }

  function soNgayConLai(denNgay, homNay) {
    if (!denNgay) return null;
    const a = new Date(denNgay + "T00:00:00");
    const b = new Date((homNay || ngayKey(new Date())) + "T00:00:00");
    return Math.round((a - b) / 86400000);
  }

  // Lãi đơn dự kiến khi giữ đủ kỳ hạn. Cố ý KHÔNG tính lãi kép: sổ có kỳ hạn
  // ở Việt Nam trả lãi cuối kỳ, tính kép sẽ ra số cao hơn thực nhận.
  function laiDuKien(so) {
    const tien = Number(so && so.soTien) || 0;
    const ls = Number(so && so.laiSuat) || 0;      // %/năm
    const thang = Number(so && so.kyHanThang) || 0;
    return Math.round(tien * (ls / 100) * (thang / 12));
  }

  function trangThaiTietKiem(danhSach, homNay) {
    const nay = homNay || ngayKey(new Date());
    const ds = (danhSach || []).filter(s => s && Number(s.soTien) > 0).map(s => {
      const dh = ngayDaoHan(s);
      const conLai = soNgayConLai(dh, nay);
      let mucDo = "con-han";
      if (conLai !== null && conLai < 0) mucDo = "qua-han";
      else if (conLai !== null && conLai <= NGUONG_SAP_DAO_HAN) mucDo = "sap-dao-han";
      return Object.assign({}, s, {
        ngayDaoHan: dh,
        conLaiNgay: conLai,
        lai: laiDuKien(s),
        tongNhan: (Number(s.soTien) || 0) + laiDuKien(s),
        mucDo
      });
    });
    const thuTu = { "qua-han": 0, "sap-dao-han": 1, "con-han": 2 };
    ds.sort((a, b) => (thuTu[a.mucDo] - thuTu[b.mucDo]) || ((a.conLaiNgay || 0) - (b.conLaiNgay || 0)));
    return ds;
  }

  function tomTatTietKiem(ds) {
    const tongGoc = (ds || []).reduce((s, x) => s + (Number(x.soTien) || 0), 0);
    const tongLai = (ds || []).reduce((s, x) => s + (x.lai || 0), 0);
    return {
      soSo: (ds || []).length,
      tongGoc, tongLai,
      quaHan: (ds || []).filter(x => x.mucDo === "qua-han").length,
      sapDaoHan: (ds || []).filter(x => x.mucDo === "sap-dao-han").length
    };
  }

  // ===== Tình hình hiện tại =====
  // Ảnh chụp tại HÔM NAY, không theo kỳ: "giờ còn bao nhiêu, nợ ai, ai nợ mình".
  // Tiền còn lấy theo VÍ (tiền thật đang nắm), không theo lọ — lọ chỉ nói tiền
  // đó DÀNH cho việc gì, xem ở tab Lọ.
  //
  // CẢNH BÁO: "rong" KHÔNG phải tài sản ròng. Sổ này không ghi nhà/đất/xe, nên
  // một khoản vay mua nhà kéo số này âm rất sâu trong khi căn nhà đối ứng không
  // nằm ở đâu cả. Chỗ nào hiện "rong" cũng phải hiện kèm dòng "chưa tính nhà/đất",
  // nếu không người xem sẽ tưởng mình đang vỡ nợ.
  function tinhHinhHienTai(khoan, caiDatVi, soTietKiem) {
    const vi = soDuCacVi(khoan, caiDatVi);
    const tienCon = Object.keys(vi.vi)
      .reduce((s, k) => s + (Number(vi.vi[k].con) || 0), 0);

    const dsNo = soDuNo(khoan);
    const no = tomTatNo(dsNo);

    const tk = tomTatTietKiem(trangThaiTietKiem(soTietKiem || []));

    // Gộp mọi thứ là tiền: trong ví + đang gửi + người ta sẽ trả mình,
    // trừ đi phần mình sẽ phải trả người ta.
    const rong = tienCon + tk.tongGoc + no.hoNoMinh - no.minhNoHo;

    return {
      tienCon,
      vi: vi.vi,
      thuTuVi: vi.thuTu,
      chuaGanVi: vi.chuaGanVi,
      tietKiem: tk.tongGoc,
      soSoTietKiem: tk.soSo,
      hoNoMinh: no.hoNoMinh,
      minhNoHo: no.minhNoHo,
      dsNo,
      soNguoiNo: no.soNguoi,
      rong
    };
  }


  // ===== Nội dung khoản =====
  // "Nội dung" là thứ anh thật sự tiêu: danh mục là Ăn uống, nội dung là
  // "Hủ tíu Nam Vang". Đây vốn là cột Ghi chú, nay thành bắt buộc.

  // Khoá gom nhóm: bỏ dấu, gộp khoảng trắng. Nhờ vậy "Coop Bình Minh"
  // và "coop binh minh" được tính là một — nếu không, mỗi lần gõ lệch
  // một dấu là báo cáo tách thành hai dòng riêng.
  function khoaNoiDung(s) {
    return boDau(s).replace(/\s+/g, " ").trim();
  }

  // Gợi ý nội dung đã từng ghi trong ĐÚNG danh mục đang chọn.
  // Xếp theo số lần dùng, rồi tới lần dùng gần nhất.
  // chu: phần anh đang gõ dở; lọc theo đầu âm tiết và KHÔNG cần dấu, vì mục
  // đích của gợi ý chính là để khỏi phải gõ tiếng Việt có dấu trên điện thoại.
  function goiYNoiDung(khoan, danhMuc, chu, gioiHan) {
    const dem = {};
    (khoan || []).forEach(e => {
      if (!e || String(e.category || "") !== String(danhMuc || "")) return;
      const tho = String(e.note || "").trim();
      const k = khoaNoiDung(tho);
      if (!k) return;
      if (!dem[k]) dem[k] = { text: tho, so: 0, moiNhat: "" };
      dem[k].so++;
      // Giữ cách viết của lần gần nhất: đó thường là cách anh muốn dùng tiếp.
      const ngay = String(e.date || "");
      if (ngay >= dem[k].moiNhat) { dem[k].moiNhat = ngay; dem[k].text = tho; }
    });

    const am = s => boDau(s).split(/[^a-z0-9]+/).filter(Boolean);
    const tuKhoa = am(chu || "");
    const khop = o => {
      if (!tuKhoa.length) return true;
      const kho = am(o.text);
      return tuKhoa.every(t => kho.some(w => w.startsWith(t)));
    };

    return Object.keys(dem).map(k => dem[k])
      .filter(khop)
      .sort((a, b) => (b.so - a.so) || b.moiNhat.localeCompare(a.moiNhat))
      .slice(0, gioiHan || 40)
      .map(o => o.text);
  }

  // Gom tiền theo nội dung, để trả lời "trong Ăn uống thì hủ tíu hết bao nhiêu".
  function gomTheoNoiDung(danhSach) {
    const m = {};
    (danhSach || []).forEach(e => {
      const tho = String((e && e.note) || "").trim();
      const k = khoaNoiDung(tho) || "(chưa ghi nội dung)";
      if (!m[k]) m[k] = { noiDung: tho || "(chưa ghi nội dung)", so: 0, tien: 0 };
      m[k].so++;
      m[k].tien += Number(e && e.amount) || 0;
    });
    return Object.keys(m).map(k => m[k]).sort((a, b) => b.tien - a.tien);
  }

  // ===== Hạn mức chi tiêu theo danh mục =====
  // Khác với sáu lọ: lọ là CHIA TIỀN VÀO khi có thu, hạn mức là CHẶN TIỀN RA
  // theo từng danh mục trong một tháng. Hai thứ bổ sung nhau, không trùng.
  const NGUONG_SAP_VUOT = 0.8;   // từ 80% hạn mức trở lên là cảnh báo

  // Tổng đã chi từng danh mục trong một tháng ("2026-08").
  // Chỉ tính khoản chi thật; khoản thu và chuyển lọ không tính.
  function daChiTheoMuc(danhSach, thang) {
    const kq = {};
    (danhSach || []).forEach(e => {
      if (!laKhoanChi(e)) return;
      if (thang && !String(e.date || "").startsWith(thang)) return;
      const muc = e.category || "Khác";
      kq[muc] = (kq[muc] || 0) + (Number(e.amount) || 0);
    });
    return kq;
  }

  // Lọ mà một khoản chi thuộc về. Dùng ĐÚNG quy tắc của soDuCacLo:
  // ưu tiên lọ đã ghi trên khoản, không có thì suy từ danh mục — nếu khác
  // nhau thì con số hạn mức sẽ đá với màn hình Lọ.
  function loCuaKhoan(e) {
    return e.jar || doanLo(e.category);
  }

  // Tổng đã chi từng LỌ trong một tháng.
  function daChiTheoLo(danhSach, thang) {
    const kq = {};
    (danhSach || []).forEach(e => {
      if (!laKhoanChi(e)) return;
      if (thang && !String(e.date || "").startsWith(thang)) return;
      const lo = loCuaKhoan(e);
      kq[lo] = (kq[lo] || 0) + (Number(e.amount) || 0);
    });
    return kq;
  }

  // Hạn mức có hai tầng: theo lọ và theo mục nhỏ trong lọ.
  // Chấp nhận cả dạng cũ (phẳng theo danh mục) để không vỡ dữ liệu đã lưu.
  function chuanHoaHanMuc(hm) {
    if (!hm || typeof hm !== "object") return { lo: {}, muc: {} };
    if (hm.lo || hm.muc) return { lo: hm.lo || {}, muc: hm.muc || {} };
    return { lo: {}, muc: hm };
  }

  function mucDoHanMuc(daChi, han) {
    const tiLe = daChi / han;
    if (tiLe > 1) return "vuot";
    if (tiLe >= NGUONG_SAP_VUOT) return "sap-vuot";
    return "an-toan";
  }

  function motDong(ten, han, daChi) {
    return {
      ten, hanMuc: han, daChi,
      conLai: han - daChi,
      phanTram: Math.round((daChi / han) * 100),
      mucDo: mucDoHanMuc(daChi, han)
    };
  }

  // Trả về danh sách LỌ, mỗi lọ kèm các mục con có đặt hạn mức.
  // Lọ được hiện nếu bản thân nó có hạn mức HOẶC có mục con đặt hạn mức.
  // Sắp xếp: vượt trước, rồi sắp vượt — cái cần chú ý nằm trên cùng.
  function trangThaiHanMuc(danhSach, thang, hanMucTho) {
    const hm = chuanHoaHanMuc(hanMucTho);
    const chiMuc = daChiTheoMuc(danhSach, thang);
    const chiLo = daChiTheoLo(danhSach, thang);
    const thuTu = { "vuot": 0, "sap-vuot": 1, "an-toan": 2 };

    const canHien = new Set();
    Object.keys(hm.lo).forEach(k => { if (Number(hm.lo[k]) > 0) canHien.add(k); });
    Object.keys(hm.muc).forEach(m => { if (Number(hm.muc[m]) > 0) canHien.add(doanLo(m)); });

    const ds = [...canHien].map(loKey => {
      const lo = timLo(loKey) || { key: loKey, ten: loKey };
      const hanLo = Number(hm.lo[loKey]) > 0 ? Number(hm.lo[loKey]) : null;
      const daChiLo = chiLo[loKey] || 0;

      const mucCon = Object.keys(hm.muc)
        .filter(m => Number(hm.muc[m]) > 0 && doanLo(m) === loKey)
        .map(m => Object.assign(motDong(m, Number(hm.muc[m]), chiMuc[m] || 0), { muc: m }))
        .sort((a, b) => (thuTu[a.mucDo] - thuTu[b.mucDo]) || (b.phanTram - a.phanTram));

      const dong = hanLo
        ? Object.assign(motDong(lo.ten, hanLo, daChiLo), { key: loKey, mucCon })
        : { key: loKey, ten: lo.ten, hanMuc: null, daChi: daChiLo,
            conLai: null, phanTram: null, mucDo: null, mucCon };
      return dong;
    });

    // Lọ không đặt hạn mức riêng thì xếp theo mục con nặng nhất của nó
    const hangCuaLo = x => x.mucDo ? thuTu[x.mucDo]
      : (x.mucCon.length ? thuTu[x.mucCon[0].mucDo] : 3);
    ds.sort((a, b) => (hangCuaLo(a) - hangCuaLo(b)) || ((b.phanTram || 0) - (a.phanTram || 0)));
    return ds;
  }

  // Đếm gộp cả hai tầng để hiện một dòng tóm tắt.
  function tomTatHanMuc(ds) {
    let vuot = 0, sapVuot = 0, soLo = 0, soMuc = 0;
    (ds || []).forEach(lo => {
      if (lo.hanMuc) {
        soLo++;
        if (lo.mucDo === "vuot") vuot++;
        else if (lo.mucDo === "sap-vuot") sapVuot++;
      }
      (lo.mucCon || []).forEach(m => {
        soMuc++;
        if (m.mucDo === "vuot") vuot++;
        else if (m.mucDo === "sap-vuot") sapVuot++;
      });
    });
    return { soLo, soMuc, vuot, sapVuot };
  }

  // ===== Tìm kiếm / lọc khoản =====
  // Bỏ dấu tiếng Việt để gõ "an uong" vẫn tìm ra "Ăn uống".
  function boDau(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d").replace(/Đ/g, "D")
      .toLowerCase();
  }

  // dieuKien: { chu, loai: "tat-ca"|"thu"|"chi"|"chuyen", tu, den }
  // Trả về mảng đã lọc, giữ nguyên thứ tự đầu vào.
  function locKhoan(danhSach, dieuKien) {
    const dk = dieuKien || {};
    const chu = boDau(dk.chu).trim();
    const loai = dk.loai || "tat-ca";
    const tu = dk.tu || "";
    const den = dk.den || "";

    return (danhSach || []).filter(e => {
      if (loai === "thu" && !laKhoanThu(e)) return false;
      if (loai === "chuyen" && !laChuyenLo(e)) return false;
      if (loai === "chi" && !laKhoanChi(e)) return false;
      if (loai === "no" && !laKhoanNo(e)) return false;

      const ngay = String(e.date || "");
      if (tu && ngay < tu) return false;
      if (den && ngay > den) return false;

      if (chu) {
        // So khớp theo ĐẦU ÂM TIẾT, không phải chuỗi con bất kỳ.
        // Lỗi thật đã gặp: dùng includes() thì tìm "an uong" lại ra khoản
        // "Lương tháng 8", vì "thang" chứa "an" và "luong" chứa "uong".
        const am = s => boDau(s).split(/[^a-z0-9]+/).filter(Boolean);
        const kho = am([e.category, e.note, e.payer, e.jar, e.jarTo,
                        e.wallet, e.walletTo, e.doiTuong, e.type].join(" "));
        const tuKhoa = am(chu);
        // Mọi từ khoá đều phải là phần đầu của một âm tiết nào đó
        if (!tuKhoa.every(t => kho.some(w => w.startsWith(t)))) return false;
      }
      return true;
    });
  }

  // Tổng tiền của một danh sách, tách riêng thu và chi (bỏ qua khoản chuyển lọ
  // vì tiền không rời túi).
  function tongKetLoc(danhSach) {
    let thu = 0, chi = 0, chuyen = 0, no = 0;
    (danhSach || []).forEach(e => {
      const tien = Number(e.amount) || 0;
      if (laChuyenLo(e) || laChuyenVi(e)) chuyen += tien;
      else if (laKhoanNo(e)) no += tien;     // không phải thu, cũng không phải chi
      else if (laKhoanThu(e)) thu += tien;
      else chi += tien;
    });
    return { thu, chi, chuyen, no, soKhoan: (danhSach || []).length };
  }

  // ===== Sắp xếp danh sách giao dịch =====
  //
  // Hai mốc thời gian khác nhau, rất dễ lẫn:
  //   date    — NGÀY GIAO DỊCH, do người dùng chọn, mặc định hôm nay
  //   lúc nhập— LÚC BẤM LƯU, lấy từ chính mã khoản
  // Ghi hôm nay một bữa ăn của tuần trước thì hai mốc này lệch nhau cả tuần.

  // Mã khoản có bốn dạng, đều nhúng mốc thời gian mili giây:
  //   "1793632992517-2574"  khoản thu/chi
  //   "cv-1793632992517"    chuyển ví
  //   "mv-1793632992517"    chuyển lọ
  //   "no-1793632992517"    khoản vay nợ
  // Nhờ vậy biết được lúc nhập mà KHÔNG phải đọc thêm cột "Thời điểm ghi"
  // trên Sheet — đọc cột đó sẽ phải sửa Apps Script rồi deploy lại.
  //
  // Lấy cụm chữ số từ 10 ký tự trở lên để không vớ nhầm mẩu số ngắn trong
  // tiền tố. Mã lạ không có cụm nào thì trả 0, và nhờ sort của JS ổn định,
  // những khoản đó giữ nguyên thứ tự cũ thay vì xáo lung tung.
  function lucNhap(e) {
    const m = String((e && e.id) || "").match(/\d{10,}/);
    return m ? Number(m[0]) : 0;
  }

  const KIEU_SAP = [
    { key: "nhap", ten: "Mới nhập" },
    { key: "ngay", ten: "Ngày giao dịch" }
  ];

  function sapXepKhoan(danhSach, kieu) {
    const ds = (danhSach || []).slice();
    if (kieu === "ngay") {
      // Cùng một ngày giao dịch thì khoản nhập sau nằm trên, để thứ tự trong
      // ngày vẫn là thứ tự mình ghi.
      ds.sort((a, b) =>
        String(b.date || "").localeCompare(String(a.date || "")) ||
        (lucNhap(b) - lucNhap(a))
      );
    } else {
      ds.sort((a, b) => lucNhap(b) - lucNhap(a));
    }
    return ds;
  }

  // ===== Ảnh hoá đơn =====

  // Khổ ảnh sau khi thu nhỏ, giữ nguyên tỉ lệ.
  //
  // Ảnh điện thoại thường 3000–4000px và nặng 3–6MB. Hoá đơn chỉ cần đọc được
  // chữ, 1400px là thừa, mà file xuống còn khoảng một phần hai mươi. Không có
  // bước này thì ghi một khoản bằng 4G phải chờ cả phút.
  function kichThuocMoi(rong, cao, canhToiDa) {
    const w = Number(rong) || 0;
    const h = Number(cao) || 0;
    const max = Number(canhToiDa) || 0;
    if (w <= 0 || h <= 0) return { w: 0, h: 0 };

    const canhLon = Math.max(w, h);
    // Ảnh vốn đã nhỏ hơn mức cần thì GIỮ NGUYÊN. Phóng to chỉ làm file nặng
    // thêm chứ không thêm được một nét chữ nào.
    if (!max || canhLon <= max) return { w, h };

    const ti = max / canhLon;
    // Làm tròn có thể ra 0 với ảnh rất dẹt (vd 4000×2), mà canvas rộng 0 thì
    // vẽ ra ảnh trắng.
    return { w: Math.max(1, Math.round(w * ti)), h: Math.max(1, Math.round(h * ti)) };
  }

  // Khoản này có ảnh hoá đơn chưa? `choGui` là danh sách mã khoản có ảnh còn
  // nằm trong máy chờ gửi — ảnh chụp lúc mất mạng cũng phải được tính là có.
  function coAnh(e, choGui) {
    if (!e) return false;
    if (e.anh) return true;
    return !!(choGui && choGui.indexOf(e.id) >= 0);
  }

  return {
    kichThuocMoi, coAnh,
    formatMoney, formatNgan, parseAmount, parseAmountCoAm, coDauAm, ngayKey, thangKey,
    chuoiThang, dienBienTheoThang, dienBienMuc,
    laKhoanThu, laChuyenLo, laChuyenVi, laKhoanChi,
    LOAI_NO, laKhoanNo, noLamTienRa, soDuNo, tomTatNo,
    NGUONG_SAP_DAO_HAN, themThang, ngayDaoHan, soNgayConLai,
    laiDuKien, trangThaiTietKiem, tomTatTietKiem, tinhHinhHienTai,
    VI_MAC_DINH, danhSachVi, soDuCacVi, kiemTraChuyenVi,
    NGUONG_SAP_VUOT, daChiTheoMuc, daChiTheoLo, loCuaKhoan,
    chuanHoaHanMuc, trangThaiHanMuc, tomTatHanMuc,
    boDau, locKhoan, tongKetLoc, lucNhap, KIEU_SAP, sapXepKhoan,
    khoaNoiDung, goiYNoiDung, gomTheoNoiDung,
    khoangKy, nhanKy, trongKhoang, tongHopKy, friendlyError,
    // Bốn chiếc lọ
    LOS, LO_MAC_DINH_NHAN_DU, timLo, tiLeMacDinh, doanLo,
    DANH_MUC_CHI_MAC_DINH, DANH_MUC_THU_MAC_DINH,
    chuanHoaDanhMuc, datDanhMucChi, demKhoanTheoDanhMuc,
    phanBo, phanBoCuaKhoanThu, soDuCacLo, chiTietLo, chiTietMuc, khoanCuaMuc, duChuaChuyen,
    maChuyenTuDong, lenhChuyenTuDong, ngayCuoiThang, kiemTraChuyen
  };
})();
