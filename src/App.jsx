import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Coffee, Plus, Minus, Trash2, Package, Receipt, AlertTriangle, X, Check,
  TrendingUp, Edit2, Printer, ChevronLeft, ChevronRight, Settings, Bike, Store,
  Image as ImageIcon,
} from "lucide-react";

// ============================================================
// 1) ตั้งค่า Supabase
// ============================================================
const SUPABASE_URL = "https://jclfotyhugivdsrricme.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_CdZkLzNYjlCeiJ_rt8cb-g_xd_J8EPd";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SHOP_NAME = "Lastshot Coffee";
const RECEIPT_WIDTH_MM = 80; // 58 หรือ 80

// ---------- Helpers ----------
const THB = (n) => "฿" + Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function suggestedChannelPrice(basePrice, gpPercent) {
  if (!gpPercent) return basePrice;
  const raw = basePrice / (1 - gpPercent / 100);
  return Math.ceil(raw / 5) * 5;
}

const DEFAULT_CATEGORIES = [
  { id: "c1", name: "กาแฟ" },
  { id: "c2", name: "ชา" },
];

const DEFAULT_STOCK = [
  { id: "i1", name: "เมล็ดกาแฟ", unit: "g", qty: 5000, low: 500 },
  { id: "i2", name: "นมสด", unit: "ml", qty: 6000, low: 1000 },
  { id: "i3", name: "ผงชาเขียว", unit: "g", qty: 800, low: 100 },
];

const DEFAULT_MENU = [
  { id: "m1", name: "เอสเปรสโซ่", price: 45, categoryId: "c1", recipe: [{ ing: "i1", qty: 18 }], addonGroupIds: [] },
  { id: "m2", name: "ลาเต้", price: 65, categoryId: "c1", recipe: [{ ing: "i1", qty: 18 }, { ing: "i2", qty: 150 }], addonGroupIds: ["ag1"] },
  { id: "m3", name: "ชาเขียวลาเต้", price: 60, categoryId: "c2", recipe: [{ ing: "i3", qty: 10 }, { ing: "i2", qty: 150 }], addonGroupIds: [] },
];

// ช่องทางขายเริ่มต้น — "walkin" เป็นช่องทางพื้นฐานที่ลบไม่ได้
const DEFAULT_CHANNELS = [
  { id: "walkin", name: "หน้าร้าน", gp: 0, builtin: true },
  { id: "grab", name: "Grab", gp: 30 },
  { id: "lineman", name: "Lineman", gp: 30 },
  { id: "shopee", name: "Shopee Food", gp: 25 },
];

// คลังตัวเลือกเสริม ใส่ครั้งเดียว ผูกกับหลายเมนูได้
const DEFAULT_ADDON_GROUPS = [
  {
    id: "ag1", name: "นมทางเลือก", multi: false,
    options: [{ id: "o1", name: "นมสด", price: 0 }, { id: "o2", name: "นมโอ๊ต", price: 20 }, { id: "o3", name: "นมอัลมอนด์", price: 20 }],
  },
];

const DEFAULT_SETTINGS = {
  logoUrl: "",
  primaryColor: "#2b1d14",
  accentColor: "#d4a574",
  channels: DEFAULT_CHANNELS,
  addonGroups: DEFAULT_ADDON_GROUPS,
};

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
async function uploadImage(file, bucket = "menu-images") {
  const ext = file.name.split(".").pop();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
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
  const [addonItem, setAddonItem] = useState(null);
  const [editCategory, setEditCategory] = useState(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState(null);
  const [lowStockConfirmItem, setLowStockConfirmItem] = useState(null); // {item} pending confirm
  const [editChannel, setEditChannel] = useState(null);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [editAddonGroup, setEditAddonGroup] = useState(null);
  const [showAddAddonGroup, setShowAddAddonGroup] = useState(false);

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
        // migrate: ensure new settings fields exist for older saved settings
        st = { ...DEFAULT_SETTINGS, ...st, channels: st.channels || DEFAULT_CHANNELS, addonGroups: st.addonGroups || DEFAULT_ADDON_GROUPS };
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

  const channels = settings?.channels || DEFAULT_CHANNELS;
  const addonGroupsLib = settings?.addonGroups || [];
  const gpForChannel = (chId) => channels.find((c) => c.id === chId)?.gp || 0;

  const priceForChannel = (item, chId) => {
    if (chId === "walkin") return item.price;
    const override = item.channelPrices?.[chId];
    if (override != null && override !== "") return Number(override);
    return suggestedChannelPrice(item.price, gpForChannel(chId));
  };

  // ---- ตรวจสต๊อกแบบไม่บล็อก แค่เตือน ----
  const stockStatus = (item) => {
    const missing = [];
    (item.recipe || []).forEach((r) => {
      const s = stockMap[r.ing];
      if (!s || s.qty < r.qty) missing.push(s ? s.name : "วัตถุดิบที่ถูกลบไปแล้ว");
    });
    return { ok: missing.length === 0, missing };
  };

  // ---- Cart ----
  const addToCartDirect = (item, addons = [], unitPrice) => {
    const cartKey = item.id + "::" + addons.map((a) => a.id).sort().join(",");
    setCart((c) => {
      const ex = c.find((x) => x.cartKey === cartKey);
      if (ex) return c.map((x) => (x.cartKey === cartKey ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { cartKey, id: item.id, name: item.name, basePrice: unitPrice, addons, qty: 1 }];
    });
  };

  const resolvedAddonGroupsForItem = (item) =>
    (item.addonGroupIds || []).map((gid) => addonGroupsLib.find((g) => g.id === gid)).filter(Boolean);

  const handleItemClick = (item) => {
    const status = stockStatus(item);
    if (!status.ok) {
      setLowStockConfirmItem(item);
      return;
    }
    proceedAddItem(item);
  };

  const proceedAddItem = (item) => {
    const groups = resolvedAddonGroupsForItem(item);
    if (groups.length > 0) {
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
        id: x.id, name: x.name, price: x.basePrice, addons: x.addons, qty: x.qty, lineTotal: lineTotal(x),
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

  // ---- Settings: general ----
  const updateSettings = async (patch) => {
    const newSettings = { ...settings, ...patch };
    setSettings(newSettings);
    await saveData("settings", newSettings);
  };

  // ---- Settings: channels ----
  const saveChannel = async (ch) => {
    const list = settings.channels || [];
    const newChannels = ch.id && list.some((c) => c.id === ch.id)
      ? list.map((c) => (c.id === ch.id ? ch : c))
      : [...list, { ...ch, id: uid() }];
    await updateSettings({ channels: newChannels });
    setEditChannel(null);
    setShowAddChannel(false);
    showToast("บันทึกช่องทางแล้ว");
  };
  const deleteChannel = async (id) => {
    if (!window.confirm("ลบช่องทางนี้? ออเดอร์เก่าที่ใช้ช่องทางนี้จะยังแสดงผลตามปกติ")) return;
    await updateSettings({ channels: settings.channels.filter((c) => c.id !== id) });
  };

  // ---- Settings: addon groups (library) ----
  const saveAddonGroup = async (group) => {
    const list = settings.addonGroups || [];
    const newGroups = group.id && list.some((g) => g.id === group.id)
      ? list.map((g) => (g.id === group.id ? group : g))
      : [...list, { ...group, id: uid() }];
    await updateSettings({ addonGroups: newGroups });
    setEditAddonGroup(null);
    setShowAddAddonGroup(false);
    showToast("บันทึกตัวเลือกเสริมแล้ว");
  };
  const deleteAddonGroup = async (id) => {
    if (menu.some((m) => (m.addonGroupIds || []).includes(id))) {
      if (!window.confirm("ตัวเลือกเสริมนี้ถูกผูกกับเมนูอยู่ ลบแล้วเมนูจะไม่มีตัวเลือกนี้อีก ดำเนินการต่อไหม?")) return;
    }
    await updateSettings({ addonGroups: settings.addonGroups.filter((g) => g.id !== id) });
    // also unlink from menu items
    const newMenu = menu.map((m) => ({ ...m, addonGroupIds: (m.addonGroupIds || []).filter((gid) => gid !== id) }));
    setMenu(newMenu);
    await saveData("menu", newMenu);
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
          <p className="text-sm text-[#8a7a68]">ตรวจสอบว่าใส่ SUPABASE_URL และ SUPABASE_ANON_KEY ถูกต้อง</p>
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

  const primary = settings.primaryColor || "#2b1d14";
  const accent = settings.accentColor || "#d4a574";
  const openCategory = categories.find((c) => c.id === openCategoryId);
  const itemsInOpenCategory = openCategoryId ? menu.filter((m) => m.categoryId === openCategoryId) : [];

  return (
    <div className="min-h-screen bg-[#fbf7f0] text-[#2b1d14]">
      <header className="sticky top-0 z-20 text-[#fbf7f0] shadow-md" style={{ backgroundColor: primary }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg tracking-tight">
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt="logo" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <Coffee size={22} style={{ color: accent }} />
            )}
            <span>{SHOP_NAME} — ระบบจัดการ</span>
          </div>
          <nav className="flex gap-1 rounded-full p-1 flex-wrap" style={{ backgroundColor: "#00000030" }}>
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
                style={tab === key ? { backgroundColor: accent, color: primary } : { color: "#cbb9a8" }}
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
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                {channels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => switchChannel(ch.id)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border whitespace-nowrap transition-colors"
                    style={channel === ch.id ? { backgroundColor: primary, color: "#fff", borderColor: primary } : { backgroundColor: "#fff", color: "#5a4a3a", borderColor: "#e3d2bd" }}
                  >
                    {ch.id === "walkin" ? <Store size={14} /> : <Bike size={14} />} {ch.name}
                  </button>
                ))}
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
                          className="text-left p-4 rounded-xl border border-[#e3d2bd] bg-white hover:shadow-md transition-all flex items-center justify-between"
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
                  <button onClick={() => setOpenCategoryId(null)} className="flex items-center gap-1 text-sm mb-3 font-medium" style={{ color: accent }}>
                    <ChevronLeft size={16} /> กลับไปหมวดหมู่
                  </button>
                  <h2 className="font-bold text-lg mb-3">{openCategory?.name}</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {itemsInOpenCategory.map((item) => {
                      const status = stockStatus(item);
                      const price = priceForChannel(item, channel);
                      const groups = resolvedAddonGroupsForItem(item);
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleItemClick(item)}
                          className="text-left p-3 rounded-xl border transition-all bg-white hover:shadow-md active:scale-95"
                          style={{ borderColor: status.ok ? "#e3d2bd" : "#f0b88a" }}
                        >
                          {item.image ? (
                            <img src={item.image} alt={item.name} className="w-full h-20 object-cover rounded-lg mb-2" onError={(e) => (e.target.style.display = "none")} />
                          ) : (
                            <div className="w-full h-20 rounded-lg mb-2 bg-[#f5f1ea] flex items-center justify-center">
                              <Coffee size={22} style={{ color: accent }} />
                            </div>
                          )}
                          <div className="font-semibold text-sm">{item.name}</div>
                          {groups.length > 0 && <div className="text-[10px] mt-0.5" style={{ color: accent }}>มีตัวเลือกเสริม</div>}
                          <div className="font-bold mt-1.5" style={{ color: "#a6622f" }}>{THB(price)}</div>
                          {channel !== "walkin" && <div className="text-[10px] text-[#8a7a68]">(หน้าร้าน {THB(item.price)})</div>}
                          {!status.ok && <div className="text-[10px] text-orange-600 mt-1">⚠ {status.missing.join(", ")} ใกล้หมด/ไม่พอ</div>}
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
                ช่องทาง: <span className="font-semibold" style={{ color: "#a6622f" }}>{channels.find((c) => c.id === channel)?.name}</span>
              </div>
              {cart.length === 0 ? (
                <p className="text-sm text-[#8a7a68] py-6 text-center">ยังไม่มีรายการ</p>
              ) : (
                <div className="space-y-2 mb-3">
                  {cart.map((line) => (
                    <div key={line.cartKey} className="flex items-center justify-between text-sm">
                      <div className="flex-1">
                        <div className="font-medium">{line.name}</div>
                        {line.addons.length > 0 && <div className="text-[11px] text-[#8a7a68]">{line.addons.map((a) => a.name).join(", ")}</div>}
                        <div className="text-[#8a7a68]">{THB(line.basePrice + line.addons.reduce((s, a) => s + a.price, 0))}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => changeQty(line.cartKey, -1)} className="w-6 h-6 rounded-full bg-[#f5f1ea] flex items-center justify-center hover:bg-[#e3d2bd]"><Minus size={12} /></button>
                        <span className="w-5 text-center">{line.qty}</span>
                        <button onClick={() => changeQty(line.cartKey, 1)} className="w-6 h-6 rounded-full bg-[#f5f1ea] flex items-center justify-center hover:bg-[#e3d2bd]"><Plus size={12} /></button>
                        <button onClick={() => removeFromCart(line.cartKey)} className="ml-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-[#e3d2bd] pt-3 flex items-center justify-between font-bold">
                <span>รวม</span>
                <span style={{ color: "#a6622f" }}>{THB(cartTotal)}</span>
              </div>
              <button
                onClick={checkout}
                disabled={cart.length === 0}
                className="mt-3 w-full text-white rounded-lg py-2.5 font-semibold disabled:opacity-40 transition-colors"
                style={{ backgroundColor: primary }}
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
              <button onClick={() => setShowAddStock(true)} className="flex items-center gap-1 text-white text-sm px-3 py-1.5 rounded-lg" style={{ backgroundColor: primary }}>
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
                        <button onClick={() => setEditStock(s)} className="hover:underline mr-3 text-xs" style={{ color: "#a6622f" }}>แก้ไข</button>
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
              <button onClick={() => setShowAddCategory(true)} className="flex items-center gap-1 text-white text-sm px-3 py-1.5 rounded-lg" style={{ backgroundColor: primary }}>
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
                    <button onClick={() => setEditCategory(cat)} style={{ color: "#a6622f" }}><Edit2 size={15} /></button>
                    <button onClick={() => deleteCategory(cat.id)} className="text-red-400 hover:text-red-600"><Trash2 size={15} /></button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-lg">เมนูทั้งหมด</h2>
              <button onClick={() => setShowAddMenu(true)} className="flex items-center gap-1 text-white text-sm px-3 py-1.5 rounded-lg" style={{ backgroundColor: primary }}>
                <Plus size={14} /> เพิ่มเมนู
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {menu.map((item) => {
                const cat = categories.find((c) => c.id === item.categoryId);
                const groups = resolvedAddonGroupsForItem(item);
                return (
                  <div key={item.id} className="bg-white rounded-xl border border-[#e3d2bd] p-3 flex items-start justify-between gap-3">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-14 h-14 object-cover rounded-lg flex-shrink-0" onError={(e) => (e.target.style.display = "none")} />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-[#f5f1ea] flex items-center justify-center flex-shrink-0">
                        <Coffee size={20} style={{ color: accent }} />
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="font-semibold">{item.name}</div>
                      <div className="text-xs text-[#8a7a68]">{cat?.name || "ไม่มีหมวดหมู่"}</div>
                      <div className="font-bold mt-1" style={{ color: "#a6622f" }}>{THB(item.price)}</div>
                      <div className="text-[11px] text-[#8a7a68] mt-0.5">สูตร: {(item.recipe || []).length} วัตถุดิบ</div>
                      {groups.length > 0 && <div className="text-[11px] text-[#8a7a68] mt-0.5">ตัวเลือกเสริม: {groups.map((g) => g.name).join(", ")}</div>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditItem(item)} style={{ color: "#a6622f" }}><Edit2 size={15} /></button>
                      <button onClick={() => deleteMenuItem(item.id)} className="text-red-400 hover:text-red-600"><Trash2 size={15} /></button>
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
                <div className="text-2xl font-bold mt-1" style={{ color: "#a6622f" }}>{THB(todayRevenue)}</div>
                <div className="text-xs text-[#8a7a68] mt-1">{todaySales.length} ออเดอร์</div>
              </div>
              <div className="bg-white rounded-xl border border-[#e3d2bd] p-4">
                <div className="text-sm text-[#8a7a68]">ยอดขายรวมทั้งหมด</div>
                <div className="text-2xl font-bold mt-1" style={{ color: "#a6622f" }}>{THB((sales || []).reduce((s, o) => s + o.total, 0))}</div>
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
                        <td className="px-4 py-2 text-[#8a7a68] whitespace-nowrap">{new Date(o.time).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</td>
                        <td className="px-4 py-2 text-[#8a7a68]">{channels.find((c) => c.id === (o.channel || "walkin"))?.name || o.channel}</td>
                        <td className="px-4 py-2">{o.items.map((i) => `${i.name} x${i.qty}`).join(", ")}</td>
                        <td className="px-4 py-2 text-right font-semibold">{THB(o.total)}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <button onClick={() => setReceiptOrder(o)} className="mr-2" style={{ color: "#a6622f" }} title="พิมพ์ใบเสร็จ"><Printer size={15} /></button>
                          <button onClick={() => setConfirmDeleteOrder(o)} className="text-red-400 hover:text-red-600" title="ลบรายการ"><Trash2 size={15} /></button>
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
          <div className="space-y-8">
            {/* Branding */}
            <div>
              <h2 className="font-bold text-lg mb-3">โลโก้และสีธีมร้าน</h2>
              <div className="bg-white rounded-xl border border-[#e3d2bd] p-4 space-y-4">
                <BrandingEditor settings={settings} onSave={updateSettings} />
              </div>
            </div>

            {/* Channels */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-lg">ช่องทางขาย / Delivery</h2>
                <button onClick={() => setShowAddChannel(true)} className="flex items-center gap-1 text-white text-sm px-3 py-1.5 rounded-lg" style={{ backgroundColor: primary }}>
                  <Plus size={14} /> เพิ่มช่องทาง
                </button>
              </div>
              <div className="bg-white rounded-xl border border-[#e3d2bd] divide-y divide-[#f0e6da]">
                {channels.map((ch) => (
                  <div key={ch.id} className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-2 font-medium">
                      {ch.id === "walkin" ? <Store size={16} style={{ color: "#a6622f" }} /> : <Bike size={16} style={{ color: "#a6622f" }} />}
                      {ch.name} {ch.builtin && <span className="text-[10px] text-[#cbb9a8] font-normal">(พื้นฐาน)</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-[#8a7a68]">{ch.gp || 0}% GP</span>
                      <button onClick={() => setEditChannel(ch)} style={{ color: "#a6622f" }}><Edit2 size={15} /></button>
                      {!ch.builtin && <button onClick={() => deleteChannel(ch.id)} className="text-red-400 hover:text-red-600"><Trash2 size={15} /></button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Addon groups library */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-lg">คลังตัวเลือกเสริม</h2>
                <button onClick={() => setShowAddAddonGroup(true)} className="flex items-center gap-1 text-white text-sm px-3 py-1.5 rounded-lg" style={{ backgroundColor: primary }}>
                  <Plus size={14} /> เพิ่มกลุ่มตัวเลือก
                </button>
              </div>
              <p className="text-xs text-[#8a7a68] mb-3">ใส่ตัวเลือกเสริมที่นี่ครั้งเดียว แล้วไปผูกกับเมนูที่ต้องการได้ในหน้าแก้ไขเมนู</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {addonGroupsLib.map((g) => (
                  <div key={g.id} className="bg-white rounded-xl border border-[#e3d2bd] p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-sm">{g.name}</div>
                      <div className="flex gap-2">
                        <button onClick={() => setEditAddonGroup(g)} style={{ color: "#a6622f" }}><Edit2 size={14} /></button>
                        <button onClick={() => deleteAddonGroup(g.id)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div className="text-xs text-[#8a7a68] mt-1">{g.options.map((o) => o.name).join(", ")}</div>
                  </div>
                ))}
                {addonGroupsLib.length === 0 && <p className="text-xs text-[#cbb9a8]">ยังไม่มีตัวเลือกเสริม</p>}
              </div>
            </div>
          </div>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 text-white px-4 py-2 rounded-full text-sm flex items-center gap-2 shadow-lg z-50" style={{ backgroundColor: primary }}>
          <Check size={14} style={{ color: accent }} /> {toast}
        </div>
      )}

      {(editItem || showAddMenu) && (
        <MenuModal
          item={editItem}
          categories={categories}
          stock={stock}
          addonGroupsLib={addonGroupsLib}
          onClose={() => { setEditItem(null); setShowAddMenu(false); }}
          onSave={saveMenuItem}
          channels={channels}
        />
      )}
      {(editStock || showAddStock) && (
        <StockModal item={editStock} onClose={() => { setEditStock(null); setShowAddStock(false); }} onSave={saveStockItem} />
      )}
      {(editCategory || showAddCategory) && (
        <CategoryModal item={editCategory} onClose={() => { setEditCategory(null); setShowAddCategory(false); }} onSave={saveCategory} />
      )}
      {(editChannel || showAddChannel) && (
        <ChannelModal item={editChannel} onClose={() => { setEditChannel(null); setShowAddChannel(false); }} onSave={saveChannel} />
      )}
      {(editAddonGroup || showAddAddonGroup) && (
        <AddonGroupModal item={editAddonGroup} onClose={() => { setEditAddonGroup(null); setShowAddAddonGroup(false); }} onSave={saveAddonGroup} />
      )}
      {addonItem && (
        <AddonModal
          item={addonItem}
          groups={resolvedAddonGroupsForItem(addonItem)}
          basePrice={priceForChannel(addonItem, channel)}
          onClose={() => setAddonItem(null)}
          onConfirm={(chosenAddons) => {
            addToCartDirect(addonItem, chosenAddons, priceForChannel(addonItem, channel));
            setAddonItem(null);
          }}
        />
      )}
      {receiptOrder && <ReceiptModal order={receiptOrder} channels={channels} settings={settings} onClose={() => setReceiptOrder(null)} />}
      {confirmDeleteOrder && (
        <ConfirmModal
          title="ลบรายการขายนี้?"
          message={`ยอด ${THB(confirmDeleteOrder.total)} เวลา ${new Date(confirmDeleteOrder.time).toLocaleString("th-TH")} — การลบจะไม่คืนสต๊อกที่ตัดไปแล้ว`}
          onCancel={() => setConfirmDeleteOrder(null)}
          onConfirm={() => deleteOrder(confirmDeleteOrder.id)}
        />
      )}
      {lowStockConfirmItem && (
        <ConfirmModal
          title="วัตถุดิบไม่พอ / ใกล้หมด"
          message={`เมนู "${lowStockConfirmItem.name}" ขาด: ${stockStatus(lowStockConfirmItem).missing.join(", ")} — ยังต้องการขายต่อไหม? (ระบบจะตัดสต๊อกเท่าที่มี ไม่ติดลบ)`}
          confirmLabel="ขายต่อ"
          onCancel={() => setLowStockConfirmItem(null)}
          onConfirm={() => {
            const it = lowStockConfirmItem;
            setLowStockConfirmItem(null);
            proceedAddItem(it);
          }}
        />
      )}
    </div>
  );
}

// ---------- Modal: ยืนยัน ----------
function ConfirmModal({ title, message, onCancel, onConfirm, confirmLabel = "ลบ" }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm">
        <h3 className="font-bold mb-2">{title}</h3>
        <p className="text-sm text-[#8a7a68] mb-4">{message}</p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 border border-[#e3d2bd] rounded-lg py-2 text-sm font-medium">ยกเลิก</button>
          <button onClick={onConfirm} className="flex-1 bg-orange-500 text-white rounded-lg py-2 text-sm font-semibold">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Branding editor ----------
function BrandingEditor({ settings, onSave }) {
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl || "");
  const [primaryColor, setPrimaryColor] = useState(settings.primaryColor || "#2b1d14");
  const [accentColor, setAccentColor] = useState(settings.accentColor || "#d4a574");
  const [uploading, setUploading] = useState(false);

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImage(file, "menu-images");
      setLogoUrl(url);
    } catch (err) {
      console.error(err);
      alert("อัปโหลดโลโก้ไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div>
        <label className="text-xs text-[#8a7a68]">โลโก้ร้าน</label>
        <div className="flex items-center gap-3 mt-1">
          {logoUrl ? (
            <img src={logoUrl} alt="logo" className="w-16 h-16 object-cover rounded-full border border-[#e3d2bd]" onError={(e) => (e.target.style.display = "none")} />
          ) : (
            <div className="w-16 h-16 rounded-full border border-dashed border-[#e3d2bd] flex items-center justify-center text-[#cbb9a8]"><ImageIcon size={20} /></div>
          )}
          <label className="flex-1 text-center border border-[#e3d2bd] rounded-lg py-2 text-xs font-medium cursor-pointer hover:bg-[#f5f1ea]">
            {uploading ? "กำลังอัปโหลด..." : "อัปโหลดโลโก้"}
            <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" disabled={uploading} />
          </label>
        </div>
        <p className="text-[11px] text-[#cbb9a8] mt-1">โลโก้นี้จะแสดงที่หัวแอพและบนใบเสร็จ</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-[#8a7a68]">สีหลัก (หัวแอพ/ปุ่ม)</label>
          <div className="flex items-center gap-2 mt-1">
            <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-10 h-10 rounded border border-[#e3d2bd]" />
            <input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="flex-1 border border-[#e3d2bd] rounded-lg px-2 py-2 text-sm" />
          </div>
        </div>
        <div>
          <label className="text-xs text-[#8a7a68]">สีรอง (ไฮไลต์)</label>
          <div className="flex items-center gap-2 mt-1">
            <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-10 h-10 rounded border border-[#e3d2bd]" />
            <input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="flex-1 border border-[#e3d2bd] rounded-lg px-2 py-2 text-sm" />
          </div>
        </div>
      </div>
      <button
        onClick={() => onSave({ logoUrl, primaryColor, accentColor })}
        className="w-full text-white rounded-lg py-2.5 font-semibold text-sm"
        style={{ backgroundColor: primaryColor }}
      >
        บันทึก
      </button>
    </>
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
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
        <button onClick={() => name && onSave({ ...item, name })} className="mt-4 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold text-sm">บันทึก</button>
      </div>
    </div>
  );
}

// ---------- Modal: ช่องทางขาย ----------
function ChannelModal({ item, onClose, onSave }) {
  const [name, setName] = useState(item?.name || "");
  const [gp, setGp] = useState(item?.gp ?? 0);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">{item ? "แก้ไขช่องทาง" : "เพิ่มช่องทางใหม่"}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[#8a7a68]">ชื่อช่องทาง (เช่น Foodpanda, Robinhood)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
          </div>
          <div>
            <label className="text-xs text-[#8a7a68]">% GP ที่แพลตฟอร์มหัก</label>
            <input type="number" value={gp} onChange={(e) => setGp(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
          </div>
        </div>
        <button onClick={() => name && onSave({ ...item, name, gp: Number(gp) || 0 })} className="mt-4 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold text-sm">บันทึก</button>
      </div>
    </div>
  );
}

// ---------- Modal: กลุ่มตัวเลือกเสริม (คลังกลาง) ----------
function AddonGroupModal({ item, onClose, onSave }) {
  const [name, setName] = useState(item?.name || "");
  const [multi, setMulti] = useState(item?.multi || false);
  const [options, setOptions] = useState(item?.options || []);

  const addOption = () => setOptions((o) => [...o, { id: uid(), name: "", price: 0 }]);
  const updateOption = (id, patch) => setOptions((o) => o.map((opt) => (opt.id === id ? { ...opt, ...patch } : opt)));
  const removeOption = (id) => setOptions((o) => o.filter((opt) => opt.id !== id));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">{item ? "แก้ไขกลุ่มตัวเลือกเสริม" : "เพิ่มกลุ่มตัวเลือกเสริม"}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[#8a7a68]">ชื่อกลุ่ม เช่น เลือกเมล็ดกาแฟ, นมทางเลือก, เกรดมัทฉะ</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#5a4a3a]">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> เลือกได้หลายอันในกลุ่มนี้
          </label>
          <div>
            <div className="text-xs text-[#8a7a68] mb-1.5">ตัวเลือกในกลุ่มนี้</div>
            <div className="space-y-1.5">
              {options.map((opt) => (
                <div key={opt.id} className="flex items-center gap-2">
                  <input value={opt.name} onChange={(e) => updateOption(opt.id, { name: e.target.value })} placeholder="ชื่อตัวเลือก" className="flex-1 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-sm" />
                  <input type="number" value={opt.price} onChange={(e) => updateOption(opt.id, { price: Number(e.target.value) || 0 })} placeholder="+ราคา" className="w-20 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-sm text-right" />
                  <button onClick={() => removeOption(opt.id)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
                </div>
              ))}
              <button onClick={addOption} className="text-xs font-medium flex items-center gap-1 mt-1" style={{ color: "#a6622f" }}><Plus size={12} /> เพิ่มตัวเลือก</button>
            </div>
          </div>
        </div>
        <button
          onClick={() => name && options.length > 0 && onSave({ ...item, name, multi, options })}
          className="mt-4 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold text-sm"
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}

// ---------- Modal: ตัวเลือกเสริมก่อนใส่ตะกร้า ----------
function AddonModal({ item, groups, basePrice, onClose, onConfirm }) {
  const [selected, setSelected] = useState({});

  const toggleSingle = (groupId, optionId) => setSelected((s) => ({ ...s, [groupId]: optionId }));
  const toggleMulti = (groupId, optionId) =>
    setSelected((s) => {
      const cur = s[groupId] || [];
      const next = cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId];
      return { ...s, [groupId]: next };
    });

  const chosenAddons = [];
  groups.forEach((g) => {
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
          {groups.map((g) => (
            <div key={g.id}>
              <div className="text-sm font-semibold mb-1.5">{g.name}</div>
              <div className="space-y-1.5">
                {g.options.map((opt) => {
                  const isSelected = g.multi ? (selected[g.id] || []).includes(opt.id) : selected[g.id] === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => (g.multi ? toggleMulti(g.id, opt.id) : toggleSingle(g.id, opt.id))}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${isSelected ? "border-[#d4a574] bg-[#fdf2e9]" : "border-[#e3d2bd]"}`}
                    >
                      <span>{opt.name}</span>
                      <span style={{ color: "#a6622f" }}>{opt.price > 0 ? `+${THB(opt.price)}` : "ไม่มีค่าใช้จ่าย"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-[#e3d2bd] mt-4 pt-3 flex items-center justify-between font-bold">
          <span>รวม</span>
          <span style={{ color: "#a6622f" }}>{THB(total)}</span>
        </div>
        <button onClick={() => onConfirm(chosenAddons)} className="mt-3 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold text-sm">ใส่ตะกร้า</button>
      </div>
    </div>
  );
}

// ---------- Modal: เมนู ----------
function MenuModal({ item, categories, stock, addonGroupsLib, channels, onClose, onSave }) {
  const [name, setName] = useState(item?.name || "");
  const [price, setPrice] = useState(item?.price ?? "");
  const [categoryId, setCategoryId] = useState(item?.categoryId || categories[0]?.id || "");
  const [image, setImage] = useState(item?.image || "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [channelPrices, setChannelPrices] = useState(item?.channelPrices || {});
  const [addonGroupIds, setAddonGroupIds] = useState(item?.addonGroupIds || []);
  const [recipe, setRecipe] = useState(item?.recipe || []);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const url = await uploadImage(file, "menu-images");
      setImage(url);
    } catch (err) {
      console.error(err);
      setUploadError("อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง หรือใช้ลิงก์รูปแทน");
    } finally {
      setUploading(false);
    }
  };

  // ---- Recipe editing ----
  const addRecipeRow = () => setRecipe((r) => [...r, { ing: stock[0]?.id || "", qty: 0 }]);
  const updateRecipeRow = (idx, patch) => setRecipe((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  const removeRecipeRow = (idx) => setRecipe((r) => r.filter((_, i) => i !== idx));

  // ---- Addon group linking ----
  const toggleAddonGroup = (gid) =>
    setAddonGroupIds((ids) => (ids.includes(gid) ? ids.filter((x) => x !== gid) : [...ids, gid]));

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
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-[#8a7a68]">รูปเมนู</label>
            <div className="flex items-center gap-3 mt-1">
              {image ? (
                <img src={image} alt="preview" className="w-16 h-16 object-cover rounded-lg border border-[#e3d2bd]" onError={(e) => (e.target.style.display = "none")} />
              ) : (
                <div className="w-16 h-16 rounded-lg border border-dashed border-[#e3d2bd] flex items-center justify-center text-[#cbb9a8]"><Coffee size={20} /></div>
              )}
              <label className="flex-1 text-center border border-[#e3d2bd] rounded-lg py-2 text-xs font-medium cursor-pointer hover:bg-[#f5f1ea]">
                {uploading ? "กำลังอัปโหลด..." : "อัปโหลดรูป"}
                <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" disabled={uploading} />
              </label>
            </div>
            {uploadError && <div className="text-xs text-red-600 mt-1">{uploadError}</div>}
            <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="หรือวางลิงก์รูปภาพ (URL)" className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-2 text-xs" />
          </div>

          {/* Recipe editor */}
          <div className="border border-[#e3d2bd] rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-[#8a7a68]">สูตร / ส่วนผสมที่ใช้ตัดสต๊อก</div>
              <button onClick={addRecipeRow} className="text-xs font-medium flex items-center gap-1" style={{ color: "#a6622f" }}><Plus size={12} /> เพิ่มวัตถุดิบ</button>
            </div>
            <div className="space-y-1.5">
              {recipe.map((row, idx) => {
                const stockItem = stock.find((s) => s.id === row.ing);
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <select value={row.ing} onChange={(e) => updateRecipeRow(idx, { ing: e.target.value })} className="flex-1 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-xs bg-white">
                      {stock.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <input type="number" value={row.qty} onChange={(e) => updateRecipeRow(idx, { qty: Number(e.target.value) || 0 })} className="w-20 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-xs text-right" />
                    <span className="text-xs text-[#8a7a68] w-10">{stockItem?.unit || ""}</span>
                    <button onClick={() => removeRecipeRow(idx)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
                  </div>
                );
              })}
              {recipe.length === 0 && <p className="text-xs text-[#cbb9a8]">ยังไม่มีสูตร (เมนูนี้จะไม่ตัดสต๊อก)</p>}
            </div>
          </div>

          {/* Channel prices */}
          <div className="border border-[#e3d2bd] rounded-lg p-3">
            <div className="text-xs font-semibold text-[#8a7a68] mb-2">ราคาในแอพ Delivery (เว้นว่าง = คำนวณอัตโนมัติจาก % GP)</div>
            <div className="space-y-2">
              {channels.filter((c) => c.id !== "walkin").map((ch) => (
                <div key={ch.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-[#5a4a3a] w-24 truncate">{ch.name}</span>
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

          {/* Addon group linking */}
          <div className="border border-[#e3d2bd] rounded-lg p-3">
            <div className="text-xs font-semibold text-[#8a7a68] mb-2">ผูกตัวเลือกเสริม (จัดการคลังได้ในแท็บ "ตั้งค่า")</div>
            <div className="space-y-1.5">
              {addonGroupsLib.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={addonGroupIds.includes(g.id)} onChange={() => toggleAddonGroup(g.id)} />
                  {g.name}
                </label>
              ))}
              {addonGroupsLib.length === 0 && <p className="text-xs text-[#cbb9a8]">ยังไม่มีตัวเลือกเสริมในคลัง ไปเพิ่มที่แท็บ "ตั้งค่า" ก่อน</p>}
            </div>
          </div>
        </div>
        <button
          onClick={() =>
            name && price !== "" &&
            onSave({ ...item, name, price: Number(price), categoryId, image, channelPrices, addonGroupIds, recipe })
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
        <button onClick={() => name && qty !== "" && onSave({ ...item, name, qty: Number(qty), unit, low: Number(low || 0) })} className="mt-4 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold text-sm">บันทึก</button>
      </div>
    </div>
  );
}

// ---------- ใบเสร็จ ----------
function ReceiptModal({ order, channels, settings, onClose }) {
  const handlePrint = () => window.print();
  const chName = channels.find((c) => c.id === (order.channel || "walkin"))?.name;

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
            {settings.logoUrl && <img src={settings.logoUrl} alt="logo" className="w-10 h-10 object-cover rounded-full mx-auto mb-2" />}
            <div className="font-bold text-base">{SHOP_NAME}</div>
            <div className="text-xs text-[#8a7a68]">ใบเสร็จรับเงิน · {chName}</div>
          </div>
          <div className="text-xs text-[#8a7a68] mb-2">
            เลขที่: {order.id}<br />
            วันที่: {new Date(order.time).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
          </div>
          <div className="border-t border-dashed border-[#999] my-2" />
          {order.items.map((it, idx) => (
            <div key={idx} className="mb-1">
              <div className="flex justify-between">
                <span>{it.name} x{it.qty}</span>
                <span>{THB(it.lineTotal != null ? it.lineTotal : it.price * it.qty)}</span>
              </div>
              {it.addons?.length > 0 && <div className="text-[10px] text-[#8a7a68] pl-2">{it.addons.map((a) => a.name).join(", ")}</div>}
            </div>
          ))}
          <div className="border-t border-dashed border-[#999] my-2" />
          <div className="flex justify-between font-bold text-base">
            <span>รวม</span><span>{THB(order.total)}</span>
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
