import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Coffee, Plus, Minus, Trash2, Package, Receipt, AlertTriangle, X, Check,
  TrendingUp, Edit2, Printer, ChevronLeft, ChevronRight, Settings, Bike, Store,
} from "lucide-react";

// ============================================================
// 1) ตั้งค่า Supabase
// ============================================================
const SUPABASE_URL = "https://jclfotyhugivdsrricme.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_CdZkLzNYjlCeiJ_rt8cb-g_xd_J8EPd";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SHOP_NAME = "Lastshot Coffee";
const RECEIPT_WIDTH_MM = 80; // 58 หรือ 80

// ---------- ช่องทางขาย ----------
const CHANNELS = [
  { id: "walkin", name: "หน้าร้าน", icon: Store, gp: 0 },
  { id: "grab", name: "Grab", icon: Bike, gp: 30 },
  { id: "lineman", name: "Lineman", icon: Bike, gp: 30 },
  { id: "shopee", name: "Shopee Food", icon: Bike, gp: 25 },
];

// ---------- Helpers ----------
const THB = (n) => "฿" + Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ราคาที่ควรตั้งในแอพ delivery เพื่อให้ได้กำไรเท่าหน้าร้าน หลังหัก GP%
function suggestedChannelPrice(basePrice, gpPercent) {
  if (!gpPercent) return basePrice;
  const raw = basePrice / (1 - gpPercent / 100);
  return Math.ceil(raw / 5) * 5; // ปัดขึ้นให้ลงท้ายด้วย 0/5
}

const DEFAULT_CATEGORIES = [
  { id: "c1", name: "กาแฟ" },
  { id: "c2", name: "ชา" },
  { id: "c3", name: "เมนูร้อน" },
];

const DEFAULT_MENU = [
  { id: "m1", name: "เอสเปรสโซ่", price: 45, categoryId: "c1", recipe: [{ ing: "i1", qty: 18 }], addonGroups: [] },
  { id: "m2", name: "อเมริกาโน่", price: 55, categoryId: "c1", recipe: [{ ing: "i1", qty: 18 }], addonGroups: [] },
  {
    id: "m3", name: "ลาเต้", price: 65, categoryId: "c1",
    recipe: [{ ing: "i1", qty: 18 }, { ing: "i2", qty: 150 }],
    addonGroups: [
      {
        id: "ag1", name: "เลือกเมล็ดกาแฟ", multi: false,
        options: [{ id: "o1", name: "เมล็ดปกติ", price: 0 }, { id: "o2", name: "เมล็ดพิเศษ (Single Origin)", price: 15 }],
      },
      {
        id: "ag2", name: "นมทางเลือก", multi: false,
        options: [{ id: "o3", name: "นมสด", price: 0 }, { id: "o4", name: "นมโอ๊ต", price: 20 }, { id: "o5", name: "นมอัลมอนด์", price: 20 }],
      },
    ],
  },
  { id: "m4", name: "คาปูชิโน่", price: 65, categoryId: "c1", recipe: [{ ing: "i1", qty: 18 }, { ing: "i2", qty: 100 }], addonGroups: [] },
  {
    id: "m5", name: "ชาเขียวลาเต้", price: 60, categoryId: "c2",
    recipe: [{ ing: "i3", qty: 10 }, { ing: "i2", qty: 150 }],
    addonGroups: [
      {
        id: "ag3", name: "เกรดมัทฉะ", multi: false,
        options: [{ id: "o6", name: "เกรดทั่วไป", price: 0 }, { id: "o7", name: "เกรดพรีเมียม", price: 25 }],
      },
    ],
  },
];
const DEFAULT_STOCK = [
  { id: "i1", name: "เมล็ดกาแฟ", unit: "g", qty: 5000, low: 500 },
  { id: "i2", name: "นมสด", unit: "ml", qty: 6000, low: 1000 },
  { id: "i3", name: "ผงชาเขียว", unit: "g", qty: 800, low: 100 },
  { id: "i4", name: "แก้วร้อน", unit: "ใบ", qty: 200, low: 30 },
];
const DEFAULT_SETTINGS = { gp: { grab: 30, lineman: 30, shopee: 25 } };

// ============================================================
// 2) อ่าน/เขียนข้อมูลจาก Supabase
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
async function uploadMenuImage(file) {
  const ext = file.name.split(".").pop();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("menu-images").upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from("menu-images").getPublicUrl(path);
  return data.publicUrl;
}

export default function CoffeeShopSystem() {
  const [tab, setTab] = useState("pos");
  const [menu, setMenu] = useState(null);
  const [categories, setCategories] = useState(null);
  const [stock, setStock] = useState(null);
  const [sales, setSales] = useState(null);
  const [settings, setSettings] = useState(null);
  const [cart, setCart] = useState([]);
  const [channel, setChannel] = useState("walkin");
  const [openCategoryId, setOpenCategoryId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const [toast, setToast] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [editStock, setEditStock] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showAddStock, setShowAddStock] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState(null);
  const [addonItem, setAddonItem] = useState(null); // menu item being configured before adding to cart
  const [editCategory, setEditCategory] = useState(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        let [m, c, s, sl, st] = await Promise.all([
          loadData("menu", null),
          loadData("categories", null),
          loadData("stock", null),
          loadData("sales", null),
          loadData("settings", null),
        ]);
        if (m === null) { m = DEFAULT_MENU; await saveData("menu", m); }
        if (c === null) { c = DEFAULT_CATEGORIES; await saveData("categories", c); }
        if (s === null) { s = DEFAULT_STOCK; await saveData("stock", s); }
        if (sl === null) { sl = []; await saveData("sales", sl); }
        if (st === null) { st = DEFAULT_SETTINGS; await saveData("settings", st); }
        setMenu(m);
        setCategories(c);
        setStock(s);
        setSales(sl);
        setSettings(st);
      } catch (e) {
        console.error(e);
        setConnectionError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const ch = supabase
      .channel("app_data_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_data" }, (payload) => {
        const row = payload.new;
        if (!row) return;
        if (row.key === "menu") setMenu(row.value);
        if (row.key === "categories") setCategories(row.value);
        if (row.key === "stock") setStock(row.value);
        if (row.key === "sales") setSales(row.value);
        if (row.key === "settings") setSettings(row.value);
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
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

  const gpForChannel = (chId) => (settings?.gp || {})[chId] || 0;

  const priceForChannel = (item, chId) => {
    if (chId === "walkin") return item.price;
    const override = item.channelPrices?.[chId];
    if (override != null && override !== "") return Number(override);
    return suggestedChannelPrice(item.price, gpForChannel(chId));
  };

  // ---- Cart: items may have chosen addons ----
  const addToCartDirect = (item, addons = [], unitPrice) => {
    const cartKey = item.id + "::" + addons.map((a) => a.id).sort().join(",");
    setCart((c) => {
      const ex = c.find((x) => x.cartKey === cartKey);
      if (ex) return c.map((x) => (x.cartKey === cartKey ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { cartKey, id: item.id, name: item.name, basePrice: unitPrice, addons, qty: 1 }];
    });
  };

  const handleItemClick = (item) => {
    if (item.addonGroups && item.addonGroups.length > 0) {
      setAddonItem(item);
    } else {
      addToCartDirect(item, [], priceForChannel(item, channel));
    }
  };

  const changeQty = (cartKey, delta) => {
    setCart((c) =>
      c.map((x) => (x.cartKey === cartKey ? { ...x, qty: x.qty + delta } : x)).filter((x) => x.qty > 0)
    );
  };
  const removeFromCart = (cartKey) => setCart((c) => c.filter((x) => x.cartKey !== cartKey));
  const lineTotal = (line) => (line.basePrice + line.addons.reduce((s, a) => s + a.price, 0)) * line.qty;
  const cartTotal = cart.reduce((s, line) => s + lineTotal(line), 0);

  // reset cart & category view when switching channel
  const switchChannel = (chId) => {
    if (cart.length > 0 && chId !== channel) {
      if (!window.confirm("เปลี่ยนช่องทางจะล้างตะกร้าปัจจุบัน ดำเนินการต่อไหม?")) return;
    }
    setChannel(chId);
    setCart([]);
  };

  const checkout = async () => {
    if (cart.length === 0) return;
    const newStock = stock.map((s) => ({ ...s }));
    for (const line of cart) {
      const menuItem = menu.find((m) => m.id === line.id);
      (menuItem?.recipe || []).forEach((r) => {
        const s = newStock.find((x) => x.id === r.ing);
        if (s) s.qty = Math.max(0, s.qty - r.qty * line.qty);
      });
    }
    const order = {
      id: uid(),
      channel,
      items: cart.map((x) => ({
        id: x.id,
        name: x.name,
        price: x.basePrice,
        addons: x.addons,
        qty: x.qty,
        lineTotal: lineTotal(x),
      })),
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

  const deleteOrder = async (orderId) => {
    const newSales = sales.filter((s) => s.id !== orderId);
    setSales(newSales);
    await saveData("sales", newSales);
    setConfirmDeleteOrder(null);
    showToast("ลบรายการแล้ว");
  };

  // ---- Menu ops ----
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

  // ---- Category ops ----
  const saveCategory = async (cat) => {
    const newCats = cat.id ? categories.map((c) => (c.id === cat.id ? cat : c)) : [...categories, { ...cat, id: uid() }];
    setCategories(newCats);
    await saveData("categories", newCats);
    setEditCategory(null);
    setShowAddCategory(false);
    showToast("บันทึกหมวดหมู่แล้ว");
  };
  const deleteCategory = async (id) => {
    if (menu.some((m) => m.categoryId === id)) {
      if (!window.confirm("หมวดนี้มีเมนูอยู่ ลบหมวดจะทำให้เมนูเหล่านั้นไม่มีหมวดหมู่ ดำเนินการต่อไหม?")) return;
    }
    const newCats = categories.filter((c) => c.id !== id);
    setCategories(newCats);
    await saveData("categories", newCats);
  };

  // ---- Stock ops ----
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

  // ---- Settings ops ----
  const saveGp = async (chId, value) => {
    const newSettings = { ...settings, gp: { ...settings.gp, [chId]: Number(value) || 0 } };
    setSettings(newSettings);
    await saveData("settings", newSettings);
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

  const openCategory = categories.find((c) => c.id === openCategoryId);
  const itemsInOpenCategory = openCategoryId ? menu.filter((m) => m.categoryId === openCategoryId) : [];

  return (
    <div className="min-h-screen bg-[#fbf7f0] text-[#2b1d14]">
      <header className="sticky top-0 z-20 bg-[#2b1d14] text-[#fbf7f0] shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg tracking-tight">
            <Coffee size={22} className="text-[#d4a574]" />
            <span>{SHOP_NAME} — ระบบจัดการ</span>
          </div>
          <nav className="flex gap-1 bg-[#1c1410] rounded-full p-1 flex-wrap">
            {[
              ["pos", "ขายหน้าร้าน", Receipt],
              ["stock", "สต๊อก", Package],
              ["menu", "เมนู", Coffee],
              ["report", "รายงาน", TrendingUp],
              ["settings", "ตั้งค่า", Settings],
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
              {/* Channel selector */}
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                {CHANNELS.map((ch) => {
                  const Icon = ch.icon;
                  return (
                    <button
                      key={ch.id}
                      onClick={() => switchChannel(ch.id)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border whitespace-nowrap transition-colors ${
                        channel === ch.id
                          ? "bg-[#2b1d14] text-white border-[#2b1d14]"
                          : "bg-white text-[#5a4a3a] border-[#e3d2bd] hover:border-[#d4a574]"
                      }`}
                    >
                      <Icon size={14} /> {ch.name}
                    </button>
                  );
                })}
              </div>

              {!openCategoryId ? (
                <>
                  <h2 className="font-bold text-lg mb-3">หมวดหมู่</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {categories.map((cat) => {
                      const count = menu.filter((m) => m.categoryId === cat.id).length;
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setOpenCategoryId(cat.id)}
                          className="text-left p-4 rounded-xl border border-[#e3d2bd] bg-white hover:border-[#d4a574] hover:shadow-md transition-all flex items-center justify-between"
                        >
                          <div>
                            <div className="font-semibold">{cat.name}</div>
                            <div className="text-xs text-[#8a7a68] mt-0.5">{count} เมนู</div>
                          </div>
                          <ChevronRight size={18} className="text-[#cbb9a8]" />
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setOpenCategoryId(null)}
                    className="flex items-center gap-1 text-sm text-[#a6622f] mb-3 font-medium"
                  >
                    <ChevronLeft size={16} /> กลับไปหมวดหมู่
                  </button>
                  <h2 className="font-bold text-lg mb-3">{openCategory?.name}</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {itemsInOpenCategory.map((item) => {
                      const canMake = (item.recipe || []).every((r) => {
                        const s = stockMap[r.ing];
                        return s && s.qty >= r.qty;
                      });
                      const price = priceForChannel(item, channel);
                      return (
                        <button
                          key={item.id}
                          disabled={!canMake}
                          onClick={() => handleItemClick(item)}
                          className={`text-left p-3 rounded-xl border transition-all ${
                            canMake
                              ? "border-[#e3d2bd] bg-white hover:border-[#d4a574] hover:shadow-md active:scale-95"
                              : "border-[#e3d2bd] bg-[#f5f1ea] opacity-50 cursor-not-allowed"
                          }`}
                        >
                          {item.image ? (
                            <img src={item.image} alt={item.name} className="w-full h-20 object-cover rounded-lg mb-2" onError={(e) => (e.target.style.display = "none")} />
                          ) : (
                            <div className="w-full h-20 rounded-lg mb-2 bg-[#f5f1ea] flex items-center justify-center">
                              <Coffee size={22} className="text-[#d4a574]" />
                            </div>
                          )}
                          <div className="font-semibold text-sm">{item.name}</div>
                          {item.addonGroups?.length > 0 && (
                            <div className="text-[10px] text-[#a6622f] mt-0.5">มีตัวเลือกเสริม</div>
                          )}
                          <div className="font-bold text-[#a6622f] mt-1.5">{THB(price)}</div>
                          {channel !== "walkin" && (
                            <div className="text-[10px] text-[#8a7a68]">(หน้าร้าน {THB(item.price)})</div>
                          )}
                          {!canMake && <div className="text-[10px] text-red-600 mt-1">วัตถุดิบไม่พอ</div>}
                        </button>
                      );
                    })}
                    {itemsInOpenCategory.length === 0 && (
                      <p className="text-sm text-[#8a7a68] col-span-full py-6 text-center">ยังไม่มีเมนูในหมวดนี้</p>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="bg-white rounded-xl border border-[#e3d2bd] p-4 h-fit sticky top-20">
              <h2 className="font-bold text-lg mb-1 flex items-center gap-2">
                <Receipt size={18} /> ออเดอร์
              </h2>
              <div className="text-xs text-[#8a7a68] mb-3">
                ช่องทาง: <span className="font-semibold text-[#a6622f]">{CHANNELS.find((c) => c.id === channel)?.name}</span>
              </div>
              {cart.length === 0 ? (
                <p className="text-sm text-[#8a7a68] py-6 text-center">ยังไม่มีรายการ</p>
              ) : (
                <div className="space-y-2 mb-3">
                  {cart.map((line) => (
                    <div key={line.cartKey} className="flex items-center justify-between text-sm">
                      <div className="flex-1">
                        <div className="font-medium">{line.name}</div>
                        {line.addons.length > 0 && (
                          <div className="text-[11px] text-[#8a7a68]">
                            {line.addons.map((a) => a.name).join(", ")}
                          </div>
                        )}
                        <div className="text-[#8a7a68]">{THB(line.basePrice + line.addons.reduce((s, a) => s + a.price, 0))}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => changeQty(line.cartKey, -1)} className="w-6 h-6 rounded-full bg-[#f5f1ea] flex items-center justify-center hover:bg-[#e3d2bd]">
                          <Minus size={12} />
                        </button>
                        <span className="w-5 text-center">{line.qty}</span>
                        <button onClick={() => changeQty(line.cartKey, 1)} className="w-6 h-6 rounded-full bg-[#f5f1ea] flex items-center justify-center hover:bg-[#e3d2bd]">
                          <Plus size={12} />
                        </button>
                        <button onClick={() => removeFromCart(line.cartKey)} className="ml-1 text-red-400 hover:text-red-600">
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
              <h2 className="font-bold text-lg">หมวดหมู่เมนู</h2>
              <button onClick={() => setShowAddCategory(true)} className="flex items-center gap-1 bg-[#2b1d14] text-white text-sm px-3 py-1.5 rounded-lg">
                <Plus size={14} /> เพิ่มหมวดหมู่
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 mb-6">
              {categories.map((cat) => (
                <div key={cat.id} className="bg-white rounded-xl border border-[#e3d2bd] p-3 flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{cat.name}</div>
                    <div className="text-xs text-[#8a7a68]">{menu.filter((m) => m.categoryId === cat.id).length} เมนู</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditCategory(cat)} className="text-[#a6622f] hover:text-[#7a4520]">
                      <Edit2 size={15} />
                    </button>
                    <button onClick={() => deleteCategory(cat.id)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-lg">เมนูทั้งหมด</h2>
              <button onClick={() => setShowAddMenu(true)} className="flex items-center gap-1 bg-[#2b1d14] text-white text-sm px-3 py-1.5 rounded-lg">
                <Plus size={14} /> เพิ่มเมนู
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {menu.map((item) => {
                const cat = categories.find((c) => c.id === item.categoryId);
                return (
                  <div key={item.id} className="bg-white rounded-xl border border-[#e3d2bd] p-3 flex items-start justify-between gap-3">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-14 h-14 object-cover rounded-lg flex-shrink-0" onError={(e) => (e.target.style.display = "none")} />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-[#f5f1ea] flex items-center justify-center flex-shrink-0">
                        <Coffee size={20} className="text-[#d4a574]" />
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="font-semibold">{item.name}</div>
                      <div className="text-xs text-[#8a7a68]">{cat?.name || "ไม่มีหมวดหมู่"}</div>
                      <div className="font-bold text-[#a6622f] mt-1">{THB(item.price)}</div>
                      {item.addonGroups?.length > 0 && (
                        <div className="text-[11px] text-[#8a7a68] mt-0.5">ตัวเลือกเสริม: {item.addonGroups.map((g) => g.name).join(", ")}</div>
                      )}
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
                );
              })}
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
                      <th className="text-left px-4 py-2">ช่องทาง</th>
                      <th className="text-left px-4 py-2">รายการ</th>
                      <th className="text-right px-4 py-2">รวม</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.slice(0, 50).map((o) => (
                      <tr key={o.id} className="border-t border-[#f0e6da]">
                        <td className="px-4 py-2 text-[#8a7a68] whitespace-nowrap">
                          {new Date(o.time).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                        </td>
                        <td className="px-4 py-2 text-[#8a7a68]">{CHANNELS.find((c) => c.id === (o.channel || "walkin"))?.name}</td>
                        <td className="px-4 py-2">{o.items.map((i) => `${i.name} x${i.qty}`).join(", ")}</td>
                        <td className="px-4 py-2 text-right font-semibold">{THB(o.total)}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <button onClick={() => setReceiptOrder(o)} className="text-[#a6622f] hover:text-[#7a4520] mr-2" title="พิมพ์ใบเสร็จ">
                            <Printer size={15} />
                          </button>
                          <button onClick={() => setConfirmDeleteOrder(o)} className="text-red-400 hover:text-red-600" title="ลบรายการ">
                            <Trash2 size={15} />
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

        {tab === "settings" && (
          <div>
            <h2 className="font-bold text-lg mb-3">ตั้งค่า % GP ของแต่ละช่องทาง Delivery</h2>
            <p className="text-sm text-[#8a7a68] mb-4">
              ระบบจะคำนวณราคาที่ควรตั้งในแอพ delivery ให้อัตโนมัติ เพื่อให้ได้กำไรเท่ากับขายหน้าร้าน หลังหัก GP — ยังแก้ราคาเองรายเมนูได้ในหน้าจัดการเมนู
            </p>
            <div className="bg-white rounded-xl border border-[#e3d2bd] divide-y divide-[#f0e6da]">
              {CHANNELS.filter((c) => c.id !== "walkin").map((ch) => (
                <div key={ch.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-2 font-medium">
                    <Bike size={16} className="text-[#a6622f]" /> {ch.name}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={settings.gp[ch.id] ?? 0}
                      onChange={(e) => saveGp(ch.id, e.target.value)}
                      className="w-20 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-sm text-right"
                    />
                    <span className="text-sm text-[#8a7a68]">% GP</span>
                  </div>
                </div>
              ))}
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
        <MenuModal
          item={editItem}
          categories={categories}
          onClose={() => { setEditItem(null); setShowAddMenu(false); }}
          onSave={saveMenuItem}
        />
      )}
      {(editStock || showAddStock) && (
        <StockModal item={editStock} onClose={() => { setEditStock(null); setShowAddStock(false); }} onSave={saveStockItem} />
      )}
      {(editCategory || showAddCategory) && (
        <CategoryModal item={editCategory} onClose={() => { setEditCategory(null); setShowAddCategory(false); }} onSave={saveCategory} />
      )}
      {addonItem && (
        <AddonModal
          item={addonItem}
          basePrice={priceForChannel(addonItem, channel)}
          onClose={() => setAddonItem(null)}
          onConfirm={(chosenAddons) => {
            addToCartDirect(addonItem, chosenAddons, priceForChannel(addonItem, channel));
            setAddonItem(null);
          }}
        />
      )}
      {receiptOrder && <ReceiptModal order={receiptOrder} onClose={() => setReceiptOrder(null)} />}
      {confirmDeleteOrder && (
        <ConfirmModal
          title="ลบรายการขายนี้?"
          message={`ยอด ${THB(confirmDeleteOrder.total)} เวลา ${new Date(confirmDeleteOrder.time).toLocaleString("th-TH")} — การลบจะไม่คืนสต๊อกที่ตัดไปแล้ว`}
          onCancel={() => setConfirmDeleteOrder(null)}
          onConfirm={() => deleteOrder(confirmDeleteOrder.id)}
        />
      )}
    </div>
  );
}

// ---------- Modal: ยืนยันการลบ ----------
function ConfirmModal({ title, message, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm">
        <h3 className="font-bold mb-2">{title}</h3>
        <p className="text-sm text-[#8a7a68] mb-4">{message}</p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 border border-[#e3d2bd] rounded-lg py-2 text-sm font-medium">ยกเลิก</button>
          <button onClick={onConfirm} className="flex-1 bg-red-500 text-white rounded-lg py-2 text-sm font-semibold">ลบ</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Modal: หมวดหมู่ ----------
function CategoryModal({ item, onClose, onSave }) {
  const [name, setName] = useState(item?.name || "");
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">{item ? "แก้ไขหมวดหมู่" : "เพิ่มหมวดหมู่ใหม่"}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <label className="text-xs text-[#8a7a68]">ชื่อหมวดหมู่</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="เช่น เมนูเย็น, ของหวาน"
          className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm"
        />
        <button
          onClick={() => name && onSave({ ...item, name })}
          className="mt-4 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold text-sm"
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}

// ---------- Modal: ตัวเลือกเสริมก่อนใส่ตะกร้า ----------
function AddonModal({ item, basePrice, onClose, onConfirm }) {
  const [selected, setSelected] = useState({}); // groupId -> optionId or [optionIds]

  const toggleSingle = (groupId, optionId) => {
    setSelected((s) => ({ ...s, [groupId]: optionId }));
  };
  const toggleMulti = (groupId, optionId) => {
    setSelected((s) => {
      const cur = s[groupId] || [];
      const next = cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId];
      return { ...s, [groupId]: next };
    });
  };

  const chosenAddons = [];
  (item.addonGroups || []).forEach((g) => {
    const sel = selected[g.id];
    if (g.multi) {
      (sel || []).forEach((optId) => {
        const opt = g.options.find((o) => o.id === optId);
        if (opt) chosenAddons.push({ id: opt.id, name: `${g.name}: ${opt.name}`, price: opt.price });
      });
    } else if (sel) {
      const opt = g.options.find((o) => o.id === sel);
      if (opt) chosenAddons.push({ id: opt.id, name: `${g.name}: ${opt.name}`, price: opt.price });
    }
  });
  const total = basePrice + chosenAddons.reduce((s, a) => s + a.price, 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">{item.name}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-4">
          {(item.addonGroups || []).map((g) => (
            <div key={g.id}>
              <div className="text-sm font-semibold mb-1.5">{g.name}</div>
              <div className="space-y-1.5">
                {g.options.map((opt) => {
                  const isSelected = g.multi ? (selected[g.id] || []).includes(opt.id) : selected[g.id] === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => (g.multi ? toggleMulti(g.id, opt.id) : toggleSingle(g.id, opt.id))}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${
                        isSelected ? "border-[#d4a574] bg-[#fdf2e9]" : "border-[#e3d2bd]"
                      }`}
                    >
                      <span>{opt.name}</span>
                      <span className="text-[#a6622f]">{opt.price > 0 ? `+${THB(opt.price)}` : "ไม่มีค่าใช้จ่าย"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-[#e3d2bd] mt-4 pt-3 flex items-center justify-between font-bold">
          <span>รวม</span>
          <span className="text-[#a6622f]">{THB(total)}</span>
        </div>
        <button
          onClick={() => onConfirm(chosenAddons)}
          className="mt-3 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold text-sm"
        >
          ใส่ตะกร้า
        </button>
      </div>
    </div>
  );
}

// ---------- Modal: เมนู (พร้อมหมวดหมู่, ราคาแยกช่องทาง, ตัวเลือกเสริม) ----------
function MenuModal({ item, categories, onClose, onSave }) {
  const [name, setName] = useState(item?.name || "");
  const [price, setPrice] = useState(item?.price ?? "");
  const [categoryId, setCategoryId] = useState(item?.categoryId || categories[0]?.id || "");
  const [image, setImage] = useState(item?.image || "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [channelPrices, setChannelPrices] = useState(item?.channelPrices || {});
  const [addonGroups, setAddonGroups] = useState(item?.addonGroups || []);

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

  // ---- Addon group editing ----
  const addGroup = () => setAddonGroups((g) => [...g, { id: uid(), name: "", multi: false, options: [] }]);
  const updateGroup = (id, patch) => setAddonGroups((g) => g.map((grp) => (grp.id === id ? { ...grp, ...patch } : grp)));
  const removeGroup = (id) => setAddonGroups((g) => g.filter((grp) => grp.id !== id));
  const addOption = (groupId) =>
    setAddonGroups((g) => g.map((grp) => (grp.id === groupId ? { ...grp, options: [...grp.options, { id: uid(), name: "", price: 0 }] } : grp)));
  const updateOption = (groupId, optId, patch) =>
    setAddonGroups((g) =>
      g.map((grp) =>
        grp.id === groupId ? { ...grp, options: grp.options.map((o) => (o.id === optId ? { ...o, ...patch } : o)) } : grp
      )
    );
  const removeOption = (groupId, optId) =>
    setAddonGroups((g) => g.map((grp) => (grp.id === groupId ? { ...grp, options: grp.options.filter((o) => o.id !== optId) } : grp)));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
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
            <label className="text-xs text-[#8a7a68]">ราคาหน้าร้าน (บาท)</label>
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
          </div>
          <div>
            <label className="text-xs text-[#8a7a68]">หมวดหมู่</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm bg-white">
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-[#8a7a68]">รูปเมนู</label>
            <div className="flex items-center gap-3 mt-1">
              {image ? (
                <img src={image} alt="preview" className="w-16 h-16 object-cover rounded-lg border border-[#e3d2bd]" onError={(e) => (e.target.style.display = "none")} />
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

          {/* Channel prices */}
          <div className="border border-[#e3d2bd] rounded-lg p-3">
            <div className="text-xs font-semibold text-[#8a7a68] mb-2">ราคาในแอพ Delivery (เว้นว่าง = คำนวณอัตโนมัติจาก % GP)</div>
            <div className="space-y-2">
              {CHANNELS.filter((c) => c.id !== "walkin").map((ch) => (
                <div key={ch.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-[#5a4a3a] w-24">{ch.name}</span>
                  <input
                    type="number"
                    placeholder={price ? String(suggestedChannelPrice(Number(price), ch.gp)) : "—"}
                    value={channelPrices[ch.id] ?? ""}
                    onChange={(e) => setChannelPrices((cp) => ({ ...cp, [ch.id]: e.target.value }))}
                    className="flex-1 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-sm text-right"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Addon groups */}
          <div className="border border-[#e3d2bd] rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-[#8a7a68]">ตัวเลือกเสริม (เช่น เมล็ดกาแฟ, นมทางเลือก, เกรดมัทฉะ)</div>
              <button onClick={addGroup} className="text-xs text-[#a6622f] font-medium flex items-center gap-1">
                <Plus size={12} /> เพิ่มกลุ่ม
              </button>
            </div>
            <div className="space-y-3">
              {addonGroups.map((g) => (
                <div key={g.id} className="border border-[#f0e6da] rounded-lg p-2.5 bg-[#fdfaf6]">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      value={g.name}
                      onChange={(e) => updateGroup(g.id, { name: e.target.value })}
                      placeholder="ชื่อกลุ่ม เช่น เลือกเมล็ดกาแฟ"
                      className="flex-1 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-sm"
                    />
                    <label className="flex items-center gap-1 text-xs text-[#8a7a68] whitespace-nowrap">
                      <input type="checkbox" checked={g.multi} onChange={(e) => updateGroup(g.id, { multi: e.target.checked })} />
                      เลือกได้หลายอัน
                    </label>
                    <button onClick={() => removeGroup(g.id)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="space-y-1.5 pl-2">
                    {g.options.map((opt) => (
                      <div key={opt.id} className="flex items-center gap-2">
                        <input
                          value={opt.name}
                          onChange={(e) => updateOption(g.id, opt.id, { name: e.target.value })}
                          placeholder="ชื่อตัวเลือก"
                          className="flex-1 border border-[#e3d2bd] rounded-lg px-2 py-1 text-xs"
                        />
                        <input
                          type="number"
                          value={opt.price}
                          onChange={(e) => updateOption(g.id, opt.id, { price: Number(e.target.value) || 0 })}
                          placeholder="+ราคา"
                          className="w-20 border border-[#e3d2bd] rounded-lg px-2 py-1 text-xs text-right"
                        />
                        <button onClick={() => removeOption(g.id, opt.id)} className="text-red-400 hover:text-red-600">
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => addOption(g.id)} className="text-xs text-[#a6622f] font-medium flex items-center gap-1 mt-1">
                      <Plus size={11} /> เพิ่มตัวเลือก
                    </button>
                  </div>
                </div>
              ))}
              {addonGroups.length === 0 && <p className="text-xs text-[#cbb9a8]">ยังไม่มีตัวเลือกเสริม</p>}
            </div>
          </div>
        </div>
        <button
          onClick={() =>
            name &&
            price !== "" &&
            onSave({
              ...item,
              name,
              price: Number(price),
              categoryId,
              image,
              channelPrices,
              addonGroups: addonGroups.filter((g) => g.name && g.options.length > 0),
              recipe: item?.recipe || [],
            })
          }
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
  const handlePrint = () => window.print();
  const chName = CHANNELS.find((c) => c.id === (order.channel || "walkin"))?.name;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 print:bg-white print:p-0">
      <style>{`
        @media print {
          @page { size: ${RECEIPT_WIDTH_MM}mm auto; margin: 0; }
          html, body { width: ${RECEIPT_WIDTH_MM}mm; margin: 0; padding: 0; }
          body * { visibility: hidden; }
          #receipt-print-area, #receipt-print-area * { visibility: visible; }
          #receipt-print-area { position: absolute; top: 0; left: 0; width: ${RECEIPT_WIDTH_MM}mm; padding: 4mm; font-size: 12px; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="bg-white rounded-xl w-full max-w-xs print:rounded-none print:max-w-full print:shadow-none">
        <div id="receipt-print-area" className="p-5 font-mono text-sm">
          <div className="text-center mb-3">
            <div className="font-bold text-base">{SHOP_NAME}</div>
            <div className="text-xs text-[#8a7a68]">ใบเสร็จรับเงิน · {chName}</div>
          </div>
          <div className="text-xs text-[#8a7a68] mb-2">
            เลขที่: {order.id}
            <br />
            วันที่: {new Date(order.time).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
          </div>
          <div className="border-t border-dashed border-[#999] my-2" />
          {order.items.map((it, idx) => (
            <div key={idx} className="mb-1">
              <div className="flex justify-between">
                <span>{it.name} x{it.qty}</span>
                <span>{THB((it.lineTotal != null ? it.lineTotal : it.price * it.qty))}</span>
              </div>
              {it.addons?.length > 0 && (
                <div className="text-[10px] text-[#8a7a68] pl-2">{it.addons.map((a) => a.name).join(", ")}</div>
              )}
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
          <button onClick={onClose} className="flex-1 border border-[#e3d2bd] rounded-lg py-2 text-sm font-medium">ปิด</button>
          <button onClick={handlePrint} className="flex-1 bg-[#2b1d14] text-white rounded-lg py-2 text-sm font-semibold flex items-center justify-center gap-1.5">
            <Printer size={14} /> พิมพ์ใบเสร็จ
          </button>
        </div>
      </div>
    </div>
  );
}
