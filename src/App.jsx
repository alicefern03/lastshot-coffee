import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { Coffee, Plus, Minus, Trash2, Package, Receipt, AlertTriangle, X, Check, TrendingUp, Edit2, Printer } from "lucide-react";

// ============================================================
// 1) ตั้งค่า Supabase — ใส่ค่าของคุณเองตรงนี้
//    หาได้จาก Supabase Dashboard > Project Settings > API
// ============================================================
const SUPABASE_URL = "https://jclfotyhugivdsrricme.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_CdZkLzNYjlCeiJ_rt8cb-g_xd_J8EPd";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SHOP_NAME = "Lastshot Coffee"; // แก้ชื่อร้านได้ตรงนี้

// ---------- Helpers ----------
const THB = (n) => "฿" + Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const DEFAULT_MENU = [
  { id: "m1", name: "เอสเปรสโซ่", price: 45, category: "กาแฟ", recipe: [{ ing: "i1", qty: 18 }] },
  { id: "m2", name: "อเมริกาโน่", price: 55, category: "กาแฟ", recipe: [{ ing: "i1", qty: 18 }] },
  { id: "m3", name: "ลาเต้", price: 65, category: "กาแฟ", recipe: [{ ing: "i1", qty: 18 }, { ing: "i2", qty: 150 }] },
  { id: "m4", name: "คาปูชิโน่", price: 65, category: "กาแฟ", recipe: [{ ing: "i1", qty: 18 }, { ing: "i2", qty: 100 }] },
  { id: "m5", name: "ชาเขียวลาเต้", price: 60, category: "ชา", recipe: [{ ing: "i3", qty: 10 }, { ing: "i2", qty: 150 }] },
];
const DEFAULT_STOCK = [
  { id: "i1", name: "เมล็ดกาแฟ", unit: "g", qty: 5000, low: 500 },
  { id: "i2", name: "นมสด", unit: "ml", qty: 6000, low: 1000 },
  { id: "i3", name: "ผงชาเขียว", unit: "g", qty: 800, low: 100 },
  { id: "i4", name: "แก้วร้อน", unit: "ใบ", qty: 200, low: 30 },
];

// ============================================================
// 2) ฟังก์ชันอ่าน/เขียนข้อมูลจาก Supabase
//    ตาราง "app_data" มีคอลัมน์: key (text, primary key), value (jsonb)
// ============================================================
async function loadData(key, fallback) {
  const { data, error } = await supabase.from("app_data").select("value").eq("key", key).maybeSingle();
  if (error) {
    console.error("load error", key, error);
    return fallback;
  }
  return data ? data.value : fallback;
}
async function saveData(key, value) {
  const { error } = await supabase.from("app_data").upsert({ key, value });
  if (error) console.error("save error", key, error);
}

export default function CoffeeShopSystem() {
  const [tab, setTab] = useState("pos");
  const [menu, setMenu] = useState(null);
  const [stock, setStock] = useState(null);
  const [sales, setSales] = useState(null);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const [toast, setToast] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [editStock, setEditStock] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showAddStock, setShowAddStock] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        let [m, s, sl] = await Promise.all([
          loadData("menu", null),
          loadData("stock", null),
          loadData("sales", null),
        ]);
        if (m === null) { m = DEFAULT_MENU; await saveData("menu", m); }
        if (s === null) { s = DEFAULT_STOCK; await saveData("stock", s); }
        if (sl === null) { sl = []; await saveData("sales", sl); }
        setMenu(m);
        setStock(s);
        setSales(sl);
      } catch (e) {
        console.error(e);
        setConnectionError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("app_data_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_data" }, (payload) => {
        const row = payload.new;
        if (!row) return;
        if (row.key === "menu") setMenu(row.value);
        if (row.key === "stock") setStock(row.value);
        if (row.key === "sales") setSales(row.value);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const stockMap = useMemo(() => {
    const map = {};
    (stock || []).forEach((s) => (map[s.id] = s));
    return map;
  }, [stock]);

  const addToCart = (item) => {
    setCart((c) => {
      const ex = c.find((x) => x.id === item.id);
      if (ex) return c.map((x) => (x.id === item.id ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { ...item, qty: 1 }];
    });
  };
  const changeQty = (id, delta) => {
    setCart((c) =>
      c.map((x) => (x.id === id ? { ...x, qty: x.qty + delta } : x)).filter((x) => x.qty > 0)
    );
  };
  const removeFromCart = (id) => setCart((c) => c.filter((x) => x.id !== id));
  const cartTotal = cart.reduce((s, x) => s + x.price * x.qty, 0);

  const checkout = async () => {
    if (cart.length === 0) return;
    const newStock = stock.map((s) => ({ ...s }));
    for (const item of cart) {
      const menuItem = menu.find((m) => m.id === item.id);
      (menuItem?.recipe || []).forEach((r) => {
        const s = newStock.find((x) => x.id === r.ing);
        if (s) s.qty = Math.max(0, s.qty - r.qty * item.qty);
      });
    }
    const order = {
      id: uid(),
      items: cart.map((x) => ({ id: x.id, name: x.name, price: x.price, qty: x.qty })),
      total: cartTotal,
      time: new Date().toISOString(),
    };
    const newSales = [order, ...sales];
    setStock(newStock);
    setSales(newSales);
    setCart([]);
    await Promise.all([saveData("stock", newStock), saveData("sales", newSales)]);
    showToast("บันทึกการขายแล้ว");
    setReceiptOrder(order);
  };

  const saveMenuItem = async (item) => {
    const newMenu = item.id ? menu.map((m) => (m.id === item.id ? item : m)) : [...menu, { ...item, id: uid() }];
    setMenu(newMenu);
    await saveData("menu", newMenu);
    setEditItem(null);
    setShowAddMenu(false);
    showToast("บันทึกเมนูแล้ว");
  };
  const deleteMenuItem = async (id) => {
    const newMenu = menu.filter((m) => m.id !== id);
    setMenu(newMenu);
    await saveData("menu", newMenu);
  };

  const saveStockItem = async (item) => {
    const newStock = item.id ? stock.map((s) => (s.id === item.id ? item : s)) : [...stock, { ...item, id: uid() }];
    setStock(newStock);
    await saveData("stock", newStock);
    setEditStock(null);
    setShowAddStock(false);
    showToast("บันทึกสต๊อกแล้ว");
  };
  const deleteStockItem = async (id) => {
    const newStock = stock.filter((s) => s.id !== id);
    setStock(newStock);
    await saveData("stock", newStock);
  };

  const today = new Date().toDateString();
  const todaySales = (sales || []).filter((s) => new Date(s.time).toDateString() === today);
  const todayRevenue = todaySales.reduce((s, o) => s + o.total, 0);
  const lowStockItems = (stock || []).filter((s) => s.qty <= s.low);

  if (connectionError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fbf7f0] p-6">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto text-red-500 mb-3" size={32} />
          <h2 className="font-bold text-lg mb-2">เชื่อมต่อฐานข้อมูลไม่ได้</h2>
          <p className="text-sm text-[#8a7a68]">
            ตรวจสอบว่าใส่ SUPABASE_URL และ SUPABASE_ANON_KEY ถูกต้อง และสร้างตาราง app_data แล้วในโปรเจกต์ Supabase
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1c1410]">
        <div className="text-[#d4a574] flex items-center gap-3 font-medium">
          <Coffee className="animate-spin" size={22} /> กำลังโหลด...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fbf7f0] text-[#2b1d14]">
      <header className="sticky top-0 z-20 bg-[#2b1d14] text-[#fbf7f0] shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg tracking-tight">
            <Coffee size={22} className="text-[#d4a574]" />
            <span>{SHOP_NAME} — ระบบจัดการ</span>
          </div>
          <nav className="flex gap-1 bg-[#1c1410] rounded-full p-1">
            {[
              ["pos", "ขายหน้าร้าน", Receipt],
              ["stock", "สต๊อก", Package],
              ["menu", "เมนู", Coffee],
              ["report", "รายงาน", TrendingUp],
            ].map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  tab === key ? "bg-[#d4a574] text-[#2b1d14]" : "text-[#cbb9a8] hover:text-white"
                }`}
              >
                <Icon size={15} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {lowStockItems.length > 0 && (
        <div className="bg-[#f5d6c6] text-[#7a3b1e] px-4 py-2 text-sm flex items-center gap-2 max-w-6xl mx-auto">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span>สต๊อกเหลือน้อย: {lowStockItems.map((s) => s.name).join(", ")}</span>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === "pos" && (
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <h2 className="font-bold text-lg mb-3">เมนู</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {menu.map((item) => {
                  const canMake = (item.recipe || []).every((r) => {
                    const s = stockMap[r.ing];
                    return s && s.qty >= r.qty;
                  });
                  return (
                    <button
                      key={item.id}
                      disabled={!canMake}
                      onClick={() => addToCart(item)}
                      className={`text-left p-3 rounded-xl border transition-all ${
                        canMake
                          ? "border-[#e3d2bd] bg-white hover:border-[#d4a574] hover:shadow-md active:scale-95"
                          : "border-[#e3d2bd] bg-[#f5f1ea] opacity-50 cursor-not-allowed"
                      }`}
                    >
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-full h-20 object-cover rounded-lg mb-2"
                          onError={(e) => (e.target.style.display = "none")}
                        />
                      ) : (
                        <div className="w-full h-20 rounded-lg mb-2 bg-[#f5f1ea] flex items-center justify-center">
                          <Coffee size={22} className="text-[#d4a574]" />
                        </div>
                      )}
                      <div className="font-semibold text-sm">{item.name}</div>
                      <div className="text-xs text-[#8a7a68] mt-0.5">{item.category}</div>
                      <div className="font-bold text-[#a6622f] mt-1.5">{THB(item.price)}</div>
                      {!canMake && <div className="text-[10px] text-red-600 mt-1">วัตถุดิบไม่พอ</div>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-[#e3d2bd] p-4 h-fit sticky top-20">
              <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
                <Receipt size={18} /> ออเดอร์
              </h2>
              {cart.length === 0 ? (
                <p className="text-sm text-[#8a7a68] py-6 text-center">ยังไม่มีรายการ</p>
              ) : (
                <div className="space-y-2 mb-3">
                  {cart.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <div className="flex-1">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-[#8a7a68]">{THB(item.price)}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => changeQty(item.id, -1)} className="w-6 h-6 rounded-full bg-[#f5f1ea] flex items-center justify-center hover:bg-[#e3d2bd]">
                          <Minus size={12} />
                        </button>
                        <span className="w-5 text-center">{item.qty}</span>
                        <button onClick={() => changeQty(item.id, 1)} className="w-6 h-6 rounded-full bg-[#f5f1ea] flex items-center justify-center hover:bg-[#e3d2bd]">
                          <Plus size={12} />
                        </button>
                        <button onClick={() => removeFromCart(item.id)} className="ml-1 text-red-400 hover:text-red-600">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-[#e3d2bd] pt-3 flex items-center justify-between font-bold">
                <span>รวม</span>
                <span className="text-[#a6622f]">{THB(cartTotal)}</span>
              </div>
              <button
                onClick={checkout}
                disabled={cart.length === 0}
                className="mt-3 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold disabled:opacity-40 hover:bg-[#3d2a1c] transition-colors"
              >
                ชำระเงิน
              </button>
            </div>
          </div>
        )}

        {tab === "stock" && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-lg">สต๊อกวัตถุดิบ</h2>
              <button onClick={() => setShowAddStock(true)} className="flex items-center gap-1 bg-[#2b1d14] text-white text-sm px-3 py-1.5 rounded-lg">
                <Plus size={14} /> เพิ่มรายการ
              </button>
            </div>
            <div className="bg-white rounded-xl border border-[#e3d2bd] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#f5f1ea] text-[#8a7a68]">
                  <tr>
                    <th className="text-left px-4 py-2">ชื่อ</th>
                    <th className="text-right px-4 py-2">คงเหลือ</th>
                    <th className="text-right px-4 py-2">หน่วย</th>
                    <th className="text-right px-4 py-2">แจ้งเตือนต่ำกว่า</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {stock.map((s) => (
                    <tr key={s.id} className={`border-t border-[#f0e6da] ${s.qty <= s.low ? "bg-[#fdf2ec]" : ""}`}>
                      <td className="px-4 py-2 font-medium">{s.name}</td>
                      <td className={`px-4 py-2 text-right ${s.qty <= s.low ? "text-red-600 font-semibold" : ""}`}>{s.qty.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-[#8a7a68]">{s.unit}</td>
                      <td className="px-4 py-2 text-right text-[#8a7a68]">{s.low.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => setEditStock(s)} className="text-[#a6622f] hover:underline mr-3 text-xs">แก้ไข</button>
                        <button onClick={() => deleteStockItem(s.id)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "menu" && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-lg">จัดการเมนู</h2>
              <button onClick={() => setShowAddMenu(true)} className="flex items-center gap-1 bg-[#2b1d14] text-white text-sm px-3 py-1.5 rounded-lg">
                <Plus size={14} /> เพิ่มเมนู
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {menu.map((item) => (
                <div key={item.id} className="bg-white rounded-xl border border-[#e3d2bd] p-3 flex items-start justify-between gap-3">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-14 h-14 object-cover rounded-lg flex-shrink-0"
                      onError={(e) => (e.target.style.display = "none")}
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-[#f5f1ea] flex items-center justify-center flex-shrink-0">
                      <Coffee size={20} className="text-[#d4a574]" />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="font-semibold">{item.name}</div>
                    <div className="text-xs text-[#8a7a68]">{item.category}</div>
                    <div className="font-bold text-[#a6622f] mt-1">{THB(item.price)}</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditItem(item)} className="text-[#a6622f] hover:text-[#7a4520]">
                      <Edit2 size={15} />
                    </button>
                    <button onClick={() => deleteMenuItem(item.id)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "report" && (
          <div>
            <h2 className="font-bold text-lg mb-3">รายงานยอดขาย</h2>
            <div className="grid sm:grid-cols-2 gap-4 mb-5">
              <div className="bg-white rounded-xl border border-[#e3d2bd] p-4">
                <div className="text-sm text-[#8a7a68]">ยอดขายวันนี้</div>
                <div className="text-2xl font-bold text-[#a6622f] mt-1">{THB(todayRevenue)}</div>
                <div className="text-xs text-[#8a7a68] mt-1">{todaySales.length} ออเดอร์</div>
              </div>
              <div className="bg-white rounded-xl border border-[#e3d2bd] p-4">
                <div className="text-sm text-[#8a7a68]">ยอดขายรวมทั้งหมด</div>
                <div className="text-2xl font-bold text-[#a6622f] mt-1">{THB((sales || []).reduce((s, o) => s + o.total, 0))}</div>
                <div className="text-xs text-[#8a7a68] mt-1">{(sales || []).length} ออเดอร์</div>
              </div>
            </div>
            <h3 className="font-semibold mb-2 text-sm text-[#8a7a68]">รายการล่าสุด</h3>
            <div className="bg-white rounded-xl border border-[#e3d2bd] overflow-hidden">
              {(sales || []).length === 0 ? (
                <p className="text-sm text-[#8a7a68] py-6 text-center">ยังไม่มีการขาย</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[#f5f1ea] text-[#8a7a68]">
                    <tr>
                      <th className="text-left px-4 py-2">เวลา</th>
                      <th className="text-left px-4 py-2">รายการ</th>
                      <th className="text-right px-4 py-2">รวม</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.slice(0, 30).map((o) => (
                      <tr key={o.id} className="border-t border-[#f0e6da]">
                        <td className="px-4 py-2 text-[#8a7a68]">
                          {new Date(o.time).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                        </td>
                        <td className="px-4 py-2">{o.items.map((i) => `${i.name} x${i.qty}`).join(", ")}</td>
                        <td className="px-4 py-2 text-right font-semibold">{THB(o.total)}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => setReceiptOrder(o)} className="text-[#a6622f] hover:text-[#7a4520]" title="พิมพ์ใบเสร็จ">
                            <Printer size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-[#2b1d14] text-white px-4 py-2 rounded-full text-sm flex items-center gap-2 shadow-lg z-50">
          <Check size={14} className="text-[#d4a574]" /> {toast}
        </div>
      )}

      {(editItem || showAddMenu) && (
        <MenuModal item={editItem} onClose={() => { setEditItem(null); setShowAddMenu(false); }} onSave={saveMenuItem} />
      )}
      {(editStock || showAddStock) && (
        <StockModal item={editStock} onClose={() => { setEditStock(null); setShowAddStock(false); }} onSave={saveStockItem} />
      )}
      {receiptOrder && (
        <ReceiptModal order={receiptOrder} onClose={() => setReceiptOrder(null)} />
      )}
    </div>
  );
}

async function uploadMenuImage(file) {
  const ext = file.name.split(".").pop();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("menu-images").upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from("menu-images").getPublicUrl(path);
  return data.publicUrl;
}

function MenuModal({ item, onClose, onSave }) {
  const [name, setName] = useState(item?.name || "");
  const [price, setPrice] = useState(item?.price ?? "");
  const [category, setCategory] = useState(item?.category || "กาแฟ");
  const [image, setImage] = useState(item?.image || "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const url = await uploadMenuImage(file);
      setImage(url);
    } catch (err) {
      console.error(err);
      setUploadError("อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง หรือใช้ลิงก์รูปแทน");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">{item ? "แก้ไขเมนู" : "เพิ่มเมนูใหม่"}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[#8a7a68]">ชื่อเมนู</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
          </div>
          <div>
            <label className="text-xs text-[#8a7a68]">ราคา (บาท)</label>
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
          </div>
          <div>
            <label className="text-xs text-[#8a7a68]">หมวดหมู่</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
          </div>
          <div>
            <label className="text-xs text-[#8a7a68]">รูปเมนู</label>
            <div className="flex items-center gap-3 mt-1">
              {image ? (
                <img
                  src={image}
                  alt="preview"
                  className="w-16 h-16 object-cover rounded-lg border border-[#e3d2bd]"
                  onError={(e) => (e.target.style.display = "none")}
                />
              ) : (
                <div className="w-16 h-16 rounded-lg border border-dashed border-[#e3d2bd] flex items-center justify-center text-[#cbb9a8]">
                  <Coffee size={20} />
                </div>
              )}
              <label className="flex-1 text-center border border-[#e3d2bd] rounded-lg py-2 text-xs font-medium cursor-pointer hover:bg-[#f5f1ea]">
                {uploading ? "กำลังอัปโหลด..." : "อัปโหลดรูป"}
                <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" disabled={uploading} />
              </label>
            </div>
            {uploadError && <div className="text-xs text-red-600 mt-1">{uploadError}</div>}
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="หรือวางลิงก์รูปภาพ (URL)"
              className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-2 text-xs"
            />
          </div>
        </div>
        <button
          onClick={() => name && price !== "" && onSave({ ...item, name, price: Number(price), category, image, recipe: item?.recipe || [] })}
          className="mt-4 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold text-sm"
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}

function StockModal({ item, onClose, onSave }) {
  const [name, setName] = useState(item?.name || "");
  const [qty, setQty] = useState(item?.qty ?? "");
  const [unit, setUnit] = useState(item?.unit || "");
  const [low, setLow] = useState(item?.low ?? "");

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">{item ? "แก้ไขสต๊อก" : "เพิ่มวัตถุดิบ"}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[#8a7a68]">ชื่อวัตถุดิบ</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-[#8a7a68]">คงเหลือ</label>
              <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
            </div>
            <div>
              <label className="text-xs text-[#8a7a68]">หน่วย</label>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-[#8a7a68]">แจ้งเตือนเมื่อต่ำกว่า</label>
            <input type="number" value={low} onChange={(e) => setLow(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
          </div>
        </div>
        <button
          onClick={() => name && qty !== "" && onSave({ ...item, name, qty: Number(qty), unit, low: Number(low || 0) })}
          className="mt-4 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold text-sm"
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}

// ---------- ใบเสร็จ ----------

function ReceiptModal({ order, onClose }) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 print:bg-white print:p-0">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #receipt-print-area, #receipt-print-area * { visibility: visible; }
          #receipt-print-area {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="bg-white rounded-xl w-full max-w-xs print:rounded-none print:max-w-full print:shadow-none">
        <div id="receipt-print-area" className="p-5 font-mono text-sm">
          <div className="text-center mb-3">
            <div className="font-bold text-base">{SHOP_NAME}</div>
            <div className="text-xs text-[#8a7a68]">ใบเสร็จรับเงิน</div>
          </div>
          <div className="text-xs text-[#8a7a68] mb-2">
            เลขที่: {order.id}
            <br />
            วันที่: {new Date(order.time).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
          </div>
          <div className="border-t border-dashed border-[#999] my-2" />
          {order.items.map((it, idx) => (
            <div key={idx} className="flex justify-between mb-1">
              <span>{it.name} x{it.qty}</span>
              <span>{THB(it.price * it.qty)}</span>
            </div>
          ))}
          <div className="border-t border-dashed border-[#999] my-2" />
          <div className="flex justify-between font-bold text-base">
            <span>รวม</span>
            <span>{THB(order.total)}</span>
          </div>
          <div className="text-center text-xs text-[#8a7a68] mt-4">ขอบคุณที่ใช้บริการ</div>
        </div>
        <div className="no-print flex gap-2 p-4 pt-0">
          <button onClick={onClose} className="flex-1 border border-[#e3d2bd] rounded-lg py-2 text-sm font-medium">
            ปิด
          </button>
          <button onClick={handlePrint} className="flex-1 bg-[#2b1d14] text-white rounded-lg py-2 text-sm font-semibold flex items-center justify-center gap-1.5">
            <Printer size={14} /> พิมพ์ใบเสร็จ
          </button>
        </div>
      </div>
    </div>
  );
}
