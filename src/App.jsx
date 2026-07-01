import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Coffee, Plus, Minus, Trash2, Package, Receipt, AlertTriangle, X, Check,
  TrendingUp, Edit2, Printer, ChevronLeft, ChevronRight, Settings, Bike, Store,
  Image as ImageIcon, Wallet, Users, QrCode, Star, Phone, ClipboardList, Smartphone,
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

// ---------- PromptPay QR (มาตรฐาน EMV QR ของไทย — ไม่ต้องพึ่ง payment gateway) ----------
function ppCrc16(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
function ppField(id, value) {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}
function ppSanitizeTarget(target) {
  let s = target.replace(/[^0-9]/g, "");
  if (s.length >= 13) return s.substring(0, 13);
  s = s.substring(s.length - 9);
  return `0066${s}`;
}
function generatePromptPayPayload(target, amount) {
  if (!target) return null;
  const formattedTarget = ppSanitizeTarget(target);
  let data =
    ppField("00", "01") +
    ppField("01", amount ? "12" : "11") +
    ppField("29", ppField("00", "A000000677010111") + ppField(formattedTarget.length === 13 ? "02" : "01", formattedTarget)) +
    ppField("58", "TH");
  if (amount) data += ppField("54", Number(amount).toFixed(2));
  data += "6304";
  return data + ppCrc16(data);
}

const DEFAULT_CATEGORIES = [
  { id: "c1", name: "กาแฟ" },
  { id: "c2", name: "ชา" },
];

const DEFAULT_STOCK = [
  { id: "i1", name: "เมล็ดกาแฟ", unit: "g", qty: 5000, low: 500, cost: 0.8 },
  { id: "i2", name: "นมสด", unit: "ml", qty: 6000, low: 1000, cost: 0.1 },
  { id: "i3", name: "ผงชาเขียว", unit: "g", qty: 800, low: 100, cost: 1.2 },
];

const DEFAULT_MENU = [
  { id: "m1", name: "เอสเปรสโซ่", price: 45, categoryId: "c1", recipe: [{ ing: "i1", qty: 18 }], addonGroupIds: [] },
  { id: "m2", name: "ลาเต้", price: 65, categoryId: "c1", recipe: [{ ing: "i1", qty: 18 }, { ing: "i2", qty: 150 }], addonGroupIds: ["ag1"] },
  { id: "m3", name: "ชาเขียวลาเต้", price: 60, categoryId: "c2", recipe: [{ ing: "i3", qty: 10 }, { ing: "i2", qty: 150 }], addonGroupIds: [] },
];

// ช่องทางขายเริ่มต้น — "walkin" เป็นช่องทางพื้นฐานที่ลบไม่ได้
const DEFAULT_CHANNELS = [
  { id: "walkin", name: "หน้าร้าน", gp: 0, builtin: true },
  { id: "grab", name: "Grab", gp: 30, orderPrefix: "GR" },
  { id: "lineman", name: "Lineman", gp: 30, orderPrefix: "LM" },
  { id: "shopee", name: "Shopee Food", gp: 25, orderPrefix: "SP" },
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
  walkinReset: "day", // day | month | year | never
  orderCounters: {},  // { walkin: {key, count}, grab: {count}, ... }
  pointsPerItem: 1,    // ได้กี่แต้มต่อ 1 แก้วที่ขาย
  redeemThreshold: 10, // ครบกี่แต้มแลกแก้วฟรีได้ 1 แก้ว
  freeDrinkValue: 50,  // มูลค่าแก้วฟรีสูงสุด (บาท) ถ้าราคาเกินนี้ลูกค้าจ่ายส่วนต่าง
  promptPayId: "",     // เบอร์โทร/เลขบัตรประชาชน PromptPay ของร้าน สำหรับรับเงินสั่งล่วงหน้า
};

function periodKeyFor(resetMode) {
  const d = new Date();
  if (resetMode === "day") return d.toISOString().slice(0, 10);
  if (resetMode === "month") return d.toISOString().slice(0, 7);
  if (resetMode === "year") return String(d.getFullYear());
  return "all";
}

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
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const customerPhoneParam = params?.get("customer");
  const isPreorderView = params?.get("preorder") === "1";
  if (customerPhoneParam) {
    return <CustomerPointsView phone={customerPhoneParam} />;
  }
  if (isPreorderView) {
    return <PreOrderView />;
  }
  return <CoffeeShopAdminApp />;
}

function CoffeeShopAdminApp() {
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
  const [channelRef, setChannelRef] = useState("");
  const [acctDate, setAcctDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expenses, setExpenses] = useState(null);
  const [editExpense, setEditExpense] = useState(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [accountingRange, setAccountingRange] = useState("today"); // today | week | month | all
  const [customers, setCustomers] = useState(null);
  const [customerPhone, setCustomerPhone] = useState("");
  const [editCustomer, setEditCustomer] = useState(null);
  const [qrCustomer, setQrCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [redeemMode, setRedeemMode] = useState(false);
  const [preorders, setPreorders] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        let [m, c, s, sl, st, ex, cu, po] = await Promise.all([
          loadData("menu", null),
          loadData("categories", null),
          loadData("stock", null),
          loadData("sales", null),
          loadData("settings", null),
          loadData("expenses", null),
          loadData("customers", null),
          loadData("preorders", null),
        ]);
        if (m === null) { m = DEFAULT_MENU; await saveData("menu", m); }
        if (c === null) { c = DEFAULT_CATEGORIES; await saveData("categories", c); }
        if (s === null) { s = DEFAULT_STOCK; await saveData("stock", s); }
        if (sl === null) { sl = []; await saveData("sales", sl); }
        if (st === null) { st = DEFAULT_SETTINGS; await saveData("settings", st); }
        if (ex === null) { ex = []; await saveData("expenses", ex); }
        if (cu === null) { cu = []; await saveData("customers", cu); }
        if (po === null) { po = []; await saveData("preorders", po); }
        // migrate: ensure new settings fields exist for older saved settings
        let mergedChannels = st.channels || DEFAULT_CHANNELS;
        if (!mergedChannels.some((c2) => c2.id === "preorder")) {
          mergedChannels = [...mergedChannels, { id: "preorder", name: "สั่งล่วงหน้า", gp: 0, builtin: true }];
        }
        st = {
          ...DEFAULT_SETTINGS,
          ...st,
          channels: mergedChannels,
          addonGroups: st.addonGroups || DEFAULT_ADDON_GROUPS,
          walkinReset: st.walkinReset || "day",
          orderCounters: st.orderCounters || {},
          pointsPerItem: st.pointsPerItem || 1,
          redeemThreshold: st.redeemThreshold || 10,
          freeDrinkValue: st.freeDrinkValue ?? 50,
          promptPayId: st.promptPayId || "",
        };
        setMenu(m);
        setCategories(c);
        setStock(s);
        setSales(sl);
        setSettings(st);
        setExpenses(ex);
        setCustomers(cu);
        setPreorders(po);
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
        if (row.key === "expenses") setExpenses(row.value);
        if (row.key === "customers") setCustomers(row.value);
        if (row.key === "preorders") setPreorders(row.value);
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

  const foundCustomer = useMemo(() => {
    if (!customerPhone || customerPhone.length < 9) return null;
    return (customers || []).find((c) => c.phone === customerPhone) || null;
  }, [customers, customerPhone]);

  const frequentItemsForCustomer = (customer) => {
    if (!customer?.history) return [];
    const counts = {};
    customer.history.forEach((h) => (h.items || []).forEach((it) => { counts[it.id] = (counts[it.id] || 0) + it.qty; }));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => menu.find((m) => m.id === id))
      .filter(Boolean);
  };

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
    const isRedeem = redeemMode;
    const freeValue = settings.freeDrinkValue ?? 50;
    const finalPrice = isRedeem ? Math.max(0, unitPrice - freeValue) : unitPrice;
    const cartKey = item.id + "::" + addons.map((a) => a.id).sort().join(",") + (isRedeem ? "::redeemed" : "");
    setCart((c) => {
      const ex = c.find((x) => x.cartKey === cartKey);
      if (ex) return c.map((x) => (x.cartKey === cartKey ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { cartKey, id: item.id, name: item.name, basePrice: finalPrice, originalPrice: unitPrice, addons, qty: 1, redeemed: isRedeem }];
    });
    if (isRedeem) setRedeemMode(false);
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
    setChannelRef("");
    setRedeemMode(false);
  };

  // ---- เลขออเดอร์: หน้าร้านเรียง 1,2,3... รีเซ็ตตามรอบ / ช่องทางอื่นใช้เลขจากแอปจริงที่พนักงานพิมพ์ ----
  const getNextOrderNumber = (chId, manualRef) => {
    const counters = settings.orderCounters || {};
    if (chId === "walkin") {
      const mode = settings.walkinReset || "day";
      const key = periodKeyFor(mode);
      const entry = counters.walkin && counters.walkin.key === key ? counters.walkin : { key, count: 0 };
      const next = entry.count + 1;
      const newCounters = { ...counters, walkin: { key, count: next } };
      return { display: String(next), newCounters };
    }
    // ช่องทาง delivery: ใช้เลขที่พนักงานพิมพ์จากแอปจริงถ้ามี ไม่งั้น fallback เป็นเลขรันภายใน
    if (manualRef && manualRef.trim()) {
      return { display: manualRef.trim(), newCounters: counters };
    }
    const entry = counters[chId] || { count: 0 };
    const next = entry.count + 1;
    const newCounters = { ...counters, [chId]: { count: next } };
    const ch = channels.find((c) => c.id === chId);
    const prefix = ch?.orderPrefix || (ch?.name || "OD").slice(0, 2).toUpperCase();
    return { display: `${prefix}-${String(next).padStart(3, "0")}`, newCounters };
  };

  const checkout = async () => {
    if (cart.length === 0) return;
    const newStock = stock.map((s) => ({ ...s }));
    let cogs = 0;
    for (const line of cart) {
      const menuItem = menu.find((m) => m.id === line.id);
      (menuItem?.recipe || []).forEach((r) => {
        const s = newStock.find((x) => x.id === r.ing);
        if (s) {
          s.qty = Math.max(0, s.qty - r.qty * line.qty);
          cogs += r.qty * line.qty * (s.cost || 0);
        }
      });
      (line.addons || []).forEach((a) => {
        if (a.stockIng && a.stockQty) {
          const s = newStock.find((x) => x.id === a.stockIng);
          if (s) {
            s.qty = Math.max(0, s.qty - a.stockQty * line.qty);
            cogs += a.stockQty * line.qty * (s.cost || 0);
          }
        }
      });
    }
    const { display: orderNumber, newCounters } = getNextOrderNumber(channel, channelRef);
    const redeemedQty = cart.filter((l) => l.redeemed).reduce((s, l) => s + l.qty, 0);
    const redeemThreshold = settings.redeemThreshold || 10;
    const pointsUsed = redeemedQty * redeemThreshold;
    const phone = customerPhone.trim();
    const isLinkedCustomer = phone.length >= 9;

    if (redeemedQty > 0) {
      if (!isLinkedCustomer) {
        alert("ต้องใส่เบอร์โทรลูกค้าก่อนถึงจะแลกแต้มได้");
        return;
      }
      const existing = customers.find((c) => c.phone === phone);
      if (!existing || (existing.points || 0) < pointsUsed) {
        alert(`ลูกค้าแต้มไม่พอ ต้องใช้ ${pointsUsed} แต้ม แต่มี ${existing?.points || 0} แต้ม`);
        return;
      }
    }

    const earnedQty = cart.filter((l) => !l.redeemed).reduce((s, l) => s + l.qty, 0);
    const pointsPerItem = settings.pointsPerItem ?? 1;
    let pointsEarned = 0;
    let newCustomers = customers;
    if (isLinkedCustomer) {
      pointsEarned = earnedQty * pointsPerItem;
      const netPoints = pointsEarned - pointsUsed;
      const existing = customers.find((c) => c.phone === phone);
      const historyEntry = { time: new Date().toISOString(), items: cart.map((x) => ({ id: x.id, name: x.name, qty: x.qty })), total: cartTotal };
      if (existing) {
        newCustomers = customers.map((c) =>
          c.phone === phone
            ? { ...c, points: Math.max(0, (c.points || 0) + netPoints), history: [historyEntry, ...(c.history || [])].slice(0, 30) }
            : c
        );
      } else {
        newCustomers = [...customers, { id: uid(), phone, name: "", points: Math.max(0, pointsEarned), history: [historyEntry] }];
      }
    }
    const order = {
      id: uid(),
      orderNumber,
      channel,
      items: cart.map((x) => ({
        id: x.id, name: x.name, price: x.basePrice, addons: x.addons, qty: x.qty, lineTotal: lineTotal(x), redeemed: x.redeemed || false,
      })),
      total: cartTotal,
      cogs: Math.round(cogs * 100) / 100,
      time: new Date().toISOString(),
      customerPhone: isLinkedCustomer ? phone : null,
      pointsEarned,
      pointsUsed,
    };
    const newSales = [order, ...sales];
    const newSettings = { ...settings, orderCounters: newCounters };
    setStock(newStock);
    setSales(newSales);
    setSettings(newSettings);
    setCustomers(newCustomers);
    setCart([]);
    setChannelRef("");
    setCustomerPhone("");
    await Promise.all([
      saveData("stock", newStock),
      saveData("sales", newSales),
      saveData("settings", newSettings),
      saveData("customers", newCustomers),
    ]);
    let msg = `บันทึกการขายแล้ว · เลขออเดอร์ ${orderNumber}`;
    if (pointsUsed > 0) msg += ` · แลกแต้มไป ${pointsUsed}`;
    if (pointsEarned > 0) msg += ` · ได้ ${pointsEarned} แต้ม`;
    showToast(msg);
    setReceiptOrder(order);
  };

  const deleteOrder = async (orderId) => {
    const newSales = sales.filter((s) => s.id !== orderId);
    setSales(newSales);
    await saveData("sales", newSales);
    setConfirmDeleteOrder(null);
    showToast("ลบรายการแล้ว");
  };

  // ---- Customer ops ----
  const saveCustomer = async (cust) => {
    const newCustomers = customers.map((c) => (c.id === cust.id ? { ...c, name: cust.name } : c));
    setCustomers(newCustomers);
    await saveData("customers", newCustomers);
    setEditCustomer(null);
    showToast("บันทึกข้อมูลลูกค้าแล้ว");
  };
  const deleteCustomer = async (id) => {
    if (!window.confirm("ลบลูกค้าคนนี้และแต้มสะสมทั้งหมด?")) return;
    const newCustomers = customers.filter((c) => c.id !== id);
    setCustomers(newCustomers);
    await saveData("customers", newCustomers);
  };

  // ---- Preorder ops ----
  const confirmPreorder = async (po) => {
    const newStock = stock.map((s) => ({ ...s }));
    let cogs = 0;
    po.items.forEach((line) => {
      const menuItem = menu.find((m) => m.id === line.id);
      (menuItem?.recipe || []).forEach((r) => {
        const s = newStock.find((x) => x.id === r.ing);
        if (s) {
          s.qty = Math.max(0, s.qty - r.qty * line.qty);
          cogs += (s.cost || 0) * r.qty * line.qty;
        }
      });
      (line.addons || []).forEach((a) => {
        if (a.stockIng && a.stockQty) {
          const s = newStock.find((x) => x.id === a.stockIng);
          if (s) {
            s.qty = Math.max(0, s.qty - a.stockQty * line.qty);
            cogs += (s.cost || 0) * a.stockQty * line.qty;
          }
        }
      });
    });

    const counters = settings.orderCounters || {};
    const poEntry = counters.preorder || { count: 0 };
    const nextNum = poEntry.count + 1;
    const orderNumber = `PO-${String(nextNum).padStart(3, "0")}`;
    const newCounters = { ...counters, preorder: { count: nextNum } };

    let pointsEarned = 0;
    let newCustomers = customers;
    const phone = po.customerPhone;
    if (phone) {
      const pointsPerItem = settings.pointsPerItem ?? 1;
      const qtySum = po.items.reduce((s, l) => s + l.qty, 0);
      pointsEarned = qtySum * pointsPerItem;
      const existing = customers.find((c) => c.phone === phone);
      const historyEntry = { time: new Date().toISOString(), items: po.items.map((x) => ({ id: x.id, name: x.name, qty: x.qty })), total: po.total };
      if (existing) {
        newCustomers = customers.map((c) =>
          c.phone === phone
            ? { ...c, name: c.name || po.customerName || "", points: (c.points || 0) + pointsEarned, history: [historyEntry, ...(c.history || [])].slice(0, 30) }
            : c
        );
      } else {
        newCustomers = [...customers, { id: uid(), phone, name: po.customerName || "", points: pointsEarned, history: [historyEntry] }];
      }
    }

    const order = {
      id: uid(),
      orderNumber,
      channel: "preorder",
      items: po.items,
      total: po.total,
      cogs: Math.round(cogs * 100) / 100,
      time: new Date().toISOString(),
      customerPhone: phone || null,
      pointsEarned,
      pointsUsed: 0,
    };

    const newSales = [order, ...sales];
    const newSettings = { ...settings, orderCounters: newCounters };
    const newPreorders = preorders.map((p) => (p.id === po.id ? { ...p, status: "confirmed", confirmedOrderId: order.id, orderNumber } : p));

    setStock(newStock);
    setSales(newSales);
    setSettings(newSettings);
    setCustomers(newCustomers);
    setPreorders(newPreorders);

    await Promise.all([
      saveData("stock", newStock),
      saveData("sales", newSales),
      saveData("settings", newSettings),
      saveData("customers", newCustomers),
      saveData("preorders", newPreorders),
    ]);
    showToast(`ยืนยันออเดอร์ ${orderNumber} แล้ว`);
  };

  const cancelPreorder = async (po) => {
    if (!window.confirm("ยกเลิกออเดอร์ล่วงหน้านี้?")) return;
    const newPreorders = preorders.map((p) => (p.id === po.id ? { ...p, status: "cancelled" } : p));
    setPreorders(newPreorders);
    await saveData("preorders", newPreorders);
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

  // ---- Expense ops ----
  const saveExpense = async (exp) => {
    const newExpenses = exp.id ? expenses.map((e) => (e.id === exp.id ? exp : e)) : [...expenses, { ...exp, id: uid() }];
    setExpenses(newExpenses);
    await saveData("expenses", newExpenses);
    setEditExpense(null);
    setShowAddExpense(false);
    showToast("บันทึกค่าใช้จ่ายแล้ว");
  };
  const deleteExpense = async (id) => {
    const newExpenses = expenses.filter((e) => e.id !== id);
    setExpenses(newExpenses);
    await saveData("expenses", newExpenses);
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
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full border-2 border-[#d4a574]/30 border-t-[#d4a574] animate-spin" />
          <div className="text-[#d4a574] font-medium text-sm">กำลังโหลด...</div>
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
      <header className="sticky top-0 z-20 text-[#fbf7f0] shadow-lg" style={{ backgroundImage: `linear-gradient(135deg, ${primary}, ${primary}dd)` }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 font-bold text-base sm:text-lg tracking-tight flex-shrink-0">
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt="logo" className="w-8 h-8 rounded-full object-cover ring-2" style={{ "--tw-ring-color": accent }} />
            ) : (
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: "#00000030" }}>
                <Coffee size={17} style={{ color: accent }} />
              </div>
            )}
            <span className="hidden sm:inline">{SHOP_NAME} — ระบบจัดการ</span>
            <span className="sm:hidden">{SHOP_NAME}</span>
          </div>
          <nav className="flex gap-1 rounded-full p-1 overflow-x-auto scroll-thin flex-shrink-0 max-w-full" style={{ backgroundColor: "#00000030" }}>
            {[
              ["pos", "ขายหน้าร้าน", Receipt],
              ["stock", "สต๊อก", Package],
              ["menu", "เมนู", Coffee],
              ["report", "รายงาน", TrendingUp],
              ["accounting", "บัญชี", Wallet],
              ["customers", "ลูกค้า", Users],
              ["preorders", "ออเดอร์ล่วงหน้า", ClipboardList],
              ["settings", "ตั้งค่า", Settings],
            ].map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap"
                style={tab === key ? { backgroundColor: accent, color: primary } : { color: "#cbb9a8" }}
              >
                <Icon size={15} />
                <span className="hidden md:inline">{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {lowStockItems.length > 0 && (
        <div className="max-w-6xl mx-auto px-4 pt-3">
          <div className="bg-[#fdf0e4] border border-[#f0c89a] text-[#9a5a1e] px-4 py-2.5 rounded-xl text-sm flex items-center gap-2">
            <AlertTriangle size={16} className="flex-shrink-0" />
            <span><strong className="font-semibold">สต๊อกเหลือน้อย:</strong> {lowStockItems.map((s) => s.name).join(", ")}</span>
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === "pos" && (
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <div className="flex gap-2 mb-5 overflow-x-auto scroll-thin pb-1">
                {channels.filter((ch) => ch.id !== "preorder").map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => switchChannel(ch.id)}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold border-2 whitespace-nowrap transition-all active:scale-95"
                    style={channel === ch.id ? { backgroundColor: primary, color: "#fff", borderColor: primary } : { backgroundColor: "#fff", color: "#5a4a3a", borderColor: "#f0e6da" }}
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
                          className="text-left p-4 rounded-2xl border border-[#e3d2bd] bg-white shadow-sm hover:shadow-md active:scale-[0.98] transition-all flex items-center justify-between"
                        >
                          <div>
                            <div className="w-9 h-9 rounded-full flex items-center justify-center mb-2" style={{ backgroundColor: `${accent}22` }}>
                              <Coffee size={16} style={{ color: accent }} />
                            </div>
                            <div className="font-semibold">{cat.name}</div>
                            <div className="text-xs text-[#8a7a68] mt-0.5">{count} เมนู</div>
                          </div>
                          <ChevronRight size={18} className="text-[#cbb9a8]" />
                        </button>
                      );
                    })}
                    {categories.length === 0 && (
                      <div className="col-span-full py-10 text-center text-[#8a7a68] text-sm">
                        ยังไม่มีหมวดหมู่ — ไปเพิ่มได้ที่แท็บ "เมนู"
                      </div>
                    )}
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
                          className="text-left p-3 rounded-2xl border-2 transition-all bg-white shadow-sm hover:shadow-md active:scale-95"
                          style={{ borderColor: status.ok ? "#f0e6da" : "#f0b88a" }}
                        >
                          {item.image ? (
                            <img src={item.image} alt={item.name} className="w-full h-20 object-cover rounded-xl mb-2" onError={(e) => (e.target.style.display = "none")} />
                          ) : (
                            <div className="w-full h-20 rounded-xl mb-2 flex items-center justify-center" style={{ backgroundColor: `${accent}1a` }}>
                              <Coffee size={22} style={{ color: accent }} />
                            </div>
                          )}
                          <div className="font-semibold text-sm leading-snug">{item.name}</div>
                          {groups.length > 0 && <div className="text-[10px] mt-0.5 font-medium" style={{ color: accent }}>✦ มีตัวเลือกเสริม</div>}
                          <div className="font-bold mt-1.5 text-base" style={{ color: "#a6622f" }}>{THB(price)}</div>
                          {channel !== "walkin" && <div className="text-[10px] text-[#8a7a68]">(หน้าร้าน {THB(item.price)})</div>}
                          {!status.ok && <div className="text-[10px] text-orange-600 mt-1 font-medium">⚠ {status.missing.join(", ")} ใกล้หมด/ไม่พอ</div>}
                        </button>
                      );
                    })}
                    {itemsInOpenCategory.length === 0 && (
                      <div className="col-span-full py-12 text-center text-[#8a7a68]">
                        <Coffee size={28} className="mx-auto mb-2 opacity-40" />
                        <p className="text-sm">ยังไม่มีเมนูในหมวดนี้</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-[#f0e6da] shadow-sm p-4 h-fit sticky top-24">
              <h2 className="font-bold text-lg mb-1 flex items-center gap-2">
                <Receipt size={18} /> ออเดอร์
              </h2>
              <div className="text-xs text-[#8a7a68] mb-3">
                ช่องทาง: <span className="font-semibold" style={{ color: "#a6622f" }}>{channels.find((c) => c.id === channel)?.name}</span>
              </div>
              {channel !== "walkin" && (
                <div className="mb-3">
                  <label className="text-xs text-[#8a7a68]">เลขที่ออเดอร์จากแอป (เช่น GF-001)</label>
                  <input
                    value={channelRef}
                    onChange={(e) => setChannelRef(e.target.value)}
                    placeholder="พิมพ์เลขที่ที่เห็นในแอป (เว้นว่างได้)"
                    className="w-full border border-[#e3d2bd] rounded-xl px-3 py-2.5 mt-1 text-sm focus:outline-none focus:ring-2"
                    style={{ "--tw-ring-color": accent }}
                  />
                </div>
              )}

              <div className="mb-3">
                <label className="text-xs text-[#8a7a68] flex items-center gap-1"><Phone size={11} /> เบอร์โทรลูกค้า (ไม่บังคับ)</label>
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                  placeholder="0812345678"
                  inputMode="numeric"
                  className="w-full border border-[#e3d2bd] rounded-xl px-3 py-2.5 mt-1 text-sm focus:outline-none focus:ring-2"
                  style={{ "--tw-ring-color": accent }}
                />
                {foundCustomer && (
                  <div className="mt-2 p-2.5 rounded-xl text-sm" style={{ backgroundColor: `${accent}1a` }}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold flex items-center gap-1"><Star size={13} style={{ color: accent }} /> {foundCustomer.name || "ลูกค้าประจำ"}</span>
                      <span className="font-bold" style={{ color: "#a6622f" }}>{foundCustomer.points || 0} แต้ม</span>
                    </div>
                    {(foundCustomer.points || 0) >= (settings.redeemThreshold || 10) && (
                      <button
                        onClick={() => setRedeemMode((v) => !v)}
                        className="mt-2 w-full text-xs font-semibold py-2 rounded-lg border-2 transition-all"
                        style={redeemMode ? { backgroundColor: "#a6622f", color: "#fff", borderColor: "#a6622f" } : { borderColor: "#a6622f", color: "#a6622f" }}
                      >
                        {redeemMode ? "กำลังแลกแก้วฟรี — กดเลือกเมนู" : `🎁 ใช้ ${settings.redeemThreshold || 10} แต้ม แลกแก้วฟรี`}
                      </button>
                    )}
                    {frequentItemsForCustomer(foundCustomer).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {frequentItemsForCustomer(foundCustomer).map((mi) => (
                          <button
                            key={mi.id}
                            onClick={() => handleItemClick(mi)}
                            className="text-xs px-2.5 py-1.5 rounded-full bg-white border border-[#e3d2bd] font-medium active:scale-95 transition-all"
                          >
                            + {mi.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {customerPhone.length >= 9 && !foundCustomer && (
                  <p className="text-[11px] text-[#8a7a68] mt-1.5">ลูกค้าใหม่ — จะสร้างให้อัตโนมัติตอนชำระเงิน</p>
                )}
              </div>
              {redeemMode && (
                <div className="mb-3 -mt-1 px-3 py-2 rounded-lg text-xs font-medium text-center" style={{ backgroundColor: "#fdf0e4", color: "#9a5a1e" }}>
                  เลือกเมนูที่ต้องการแลก 1 แก้ว — ถ้าราคาเกิน {THB(settings.freeDrinkValue ?? 50)} ลูกค้าจ่ายส่วนต่าง
                </div>
              )}

              {cart.length === 0 ? (
                <div className="py-10 text-center text-[#8a7a68]">
                  <Receipt size={26} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">เลือกเมนูเพื่อเริ่มออเดอร์</p>
                </div>
              ) : (
                <div className="space-y-3 mb-3">
                  {cart.map((line) => (
                    <div key={line.cartKey} className="flex items-center justify-between text-sm pb-2 border-b border-[#f5f1ea] last:border-0 last:pb-0">
                      <div className="flex-1 pr-2">
                        <div className="font-medium flex items-center gap-1.5">
                          {line.name}
                          {line.redeemed && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "#a6622f", color: "#fff" }}>🎁 แลกแต้ม</span>}
                        </div>
                        {line.addons.length > 0 && <div className="text-[11px] text-[#8a7a68]">{line.addons.map((a) => a.name).join(", ")}</div>}
                        <div className="text-[#8a7a68]">
                          {line.redeemed && line.originalPrice > line.basePrice && (
                            <span className="line-through mr-1.5 opacity-60">{THB(line.originalPrice)}</span>
                          )}
                          {THB(line.basePrice + line.addons.reduce((s, a) => s + a.price, 0))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => changeQty(line.cartKey, -1)} className="w-7 h-7 rounded-full bg-[#f5f1ea] flex items-center justify-center hover:bg-[#e3d2bd] active:scale-90 transition-all"><Minus size={13} /></button>
                        <span className="w-5 text-center font-medium">{line.qty}</span>
                        <button onClick={() => changeQty(line.cartKey, 1)} className="w-7 h-7 rounded-full bg-[#f5f1ea] flex items-center justify-center hover:bg-[#e3d2bd] active:scale-90 transition-all"><Plus size={13} /></button>
                        <button onClick={() => removeFromCart(line.cartKey)} className="ml-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-[#f0e6da] pt-3 flex items-center justify-between font-bold text-lg">
                <span>รวม</span>
                <span style={{ color: "#a6622f" }}>{THB(cartTotal)}</span>
              </div>
              <button
                onClick={checkout}
                disabled={cart.length === 0}
                className="mt-3 w-full text-white rounded-xl py-3.5 font-semibold text-base disabled:opacity-40 transition-all active:scale-[0.98] shadow-sm"
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
                    <th className="text-right px-4 py-2">ต้นทุน/หน่วย</th>
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
                      <td className="px-4 py-2 text-right text-[#8a7a68]">{s.cost ? THB(s.cost) : "—"}</td>
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
                      <th className="text-left px-4 py-2">เลขออเดอร์</th>
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
                        <td className="px-4 py-2 font-semibold whitespace-nowrap" style={{ color: "#a6622f" }}>{o.orderNumber || "—"}</td>
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

        {tab === "accounting" && (
          <AccountingTab
            sales={sales}
            expenses={expenses}
            channels={channels}
            acctDate={acctDate}
            setAcctDate={setAcctDate}
            onAddExpense={() => setShowAddExpense(true)}
            onEditExpense={(exp) => setEditExpense(exp)}
            onDeleteExpense={deleteExpense}
            primary={primary}
          />
        )}

        {tab === "customers" && (
          <div>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="font-bold text-lg">ลูกค้าประจำ</h2>
              <input
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="ค้นหาเบอร์โทรหรือชื่อ"
                className="border border-[#e3d2bd] rounded-xl px-3 py-2 text-sm w-56"
              />
            </div>
            <p className="text-xs text-[#8a7a68] mb-4">
              ลูกค้าจะถูกสร้างอัตโนมัติเมื่อพนักงานใส่เบอร์โทรตอนขายในหน้า "ขายหน้าร้าน" — แต้มสะสมตามอัตราที่ตั้งไว้ในแท็บ "ตั้งค่า"
            </p>
            <div className="bg-white rounded-2xl border border-[#f0e6da] overflow-hidden">
              {(customers || []).filter((c) => !customerSearch || c.phone.includes(customerSearch) || (c.name || "").includes(customerSearch)).length === 0 ? (
                <div className="py-12 text-center text-[#8a7a68]">
                  <Users size={26} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">ยังไม่มีลูกค้าในระบบ</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[#f5f1ea] text-[#8a7a68]">
                    <tr>
                      <th className="text-left px-4 py-2">เบอร์โทร</th>
                      <th className="text-left px-4 py-2">ชื่อ</th>
                      <th className="text-right px-4 py-2">แต้มสะสม</th>
                      <th className="text-right px-4 py-2">สั่งล่าสุด</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers
                      .filter((c) => !customerSearch || c.phone.includes(customerSearch) || (c.name || "").includes(customerSearch))
                      .sort((a, b) => (b.points || 0) - (a.points || 0))
                      .map((c) => (
                        <tr key={c.id} className="border-t border-[#f0e6da]">
                          <td className="px-4 py-2 font-medium">{c.phone}</td>
                          <td className="px-4 py-2 text-[#8a7a68]">{c.name || <span className="italic text-[#cbb9a8]">ยังไม่ระบุ</span>}</td>
                          <td className="px-4 py-2 text-right font-bold" style={{ color: "#a6622f" }}>{c.points || 0}</td>
                          <td className="px-4 py-2 text-right text-[#8a7a68] whitespace-nowrap">
                            {c.history?.[0]?.time ? new Date(c.history[0].time).toLocaleDateString("th-TH") : "—"}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            <button onClick={() => setQrCustomer(c)} className="mr-2" style={{ color: "#a6622f" }} title="QR สะสมแต้ม"><QrCode size={15} /></button>
                            <button onClick={() => setEditCustomer(c)} className="mr-2" style={{ color: "#a6622f" }} title="แก้ไขชื่อ"><Edit2 size={15} /></button>
                            <button onClick={() => deleteCustomer(c.id)} className="text-red-400 hover:text-red-600" title="ลบ"><Trash2 size={15} /></button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {tab === "preorders" && (
          <div>
            <h2 className="font-bold text-lg mb-1">ออเดอร์ล่วงหน้า</h2>
            <p className="text-xs text-[#8a7a68] mb-4">
              ออเดอร์ที่ลูกค้าสั่งและโอนเงินผ่านลิงก์สั่งล่วงหน้า — เช็คยอดโอนเข้าบัญชีร้านในแอปธนาคารก่อน แล้วกด "ยืนยันรับเงินแล้ว" เพื่อตัดสต๊อกและให้แต้มลูกค้า
            </p>
            <div className="space-y-3">
              {(preorders || []).filter((p) => p.status === "pending_confirm").length === 0 && (
                <div className="bg-white rounded-2xl border border-[#f0e6da] py-12 text-center text-[#8a7a68]">
                  <ClipboardList size={26} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">ยังไม่มีออเดอร์ล่วงหน้าที่รออยู่</p>
                </div>
              )}
              {(preorders || [])
                .filter((p) => p.status === "pending_confirm")
                .sort((a, b) => new Date(b.time) - new Date(a.time))
                .map((po) => (
                  <div key={po.id} className="bg-white rounded-2xl border border-[#f0e6da] p-4">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <div>
                        <span className="font-semibold">{po.customerName || "ลูกค้า"}</span>
                        <span className="text-[#8a7a68] text-sm ml-2">{po.customerPhone}</span>
                      </div>
                      <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-[#fdf0e4] text-[#9a5a1e]">รอยืนยันรับเงิน</span>
                    </div>
                    <div className="text-sm text-[#5a4a3a] mb-2">
                      {po.items.map((it) => `${it.name} x${it.qty}`).join(", ")}
                    </div>
                    <div className="text-xs text-[#8a7a68] mb-3">
                      สั่งเมื่อ {new Date(po.time).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                      {po.pickupNote && <> · รับ: {po.pickupNote}</>}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-lg" style={{ color: "#a6622f" }}>{THB(po.total)}</span>
                      <div className="flex gap-2">
                        <button onClick={() => cancelPreorder(po)} className="text-sm px-3 py-1.5 rounded-lg border border-red-300 text-red-500 font-medium">ยกเลิก</button>
                        <button onClick={() => confirmPreorder(po)} className="text-sm px-3 py-1.5 rounded-lg text-white font-semibold" style={{ backgroundColor: primary }}>
                          ✓ ยืนยันรับเงินแล้ว
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>

            {(preorders || []).some((p) => p.status !== "pending_confirm") && (
              <div className="mt-8">
                <h3 className="font-semibold text-sm text-[#8a7a68] mb-2">ประวัติ</h3>
                <div className="bg-white rounded-2xl border border-[#f0e6da] divide-y divide-[#f0e6da]">
                  {preorders
                    .filter((p) => p.status !== "pending_confirm")
                    .sort((a, b) => new Date(b.time) - new Date(a.time))
                    .slice(0, 20)
                    .map((po) => (
                      <div key={po.id} className="flex items-center justify-between p-3 text-sm">
                        <span>{po.customerName || po.customerPhone} · {po.items.map((it) => it.name).join(", ")}</span>
                        <span className={po.status === "confirmed" ? "text-green-600 font-medium" : "text-red-400"}>
                          {po.status === "confirmed" ? `✓ ${po.orderNumber || ""}` : "ยกเลิกแล้ว"}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
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

            {/* Order numbering */}
            <div>
              <h2 className="font-bold text-lg mb-3">เลขที่ออเดอร์ (หน้าร้าน)</h2>
              <div className="bg-white rounded-xl border border-[#e3d2bd] p-4">
                <p className="text-xs text-[#8a7a68] mb-3">
                  ออเดอร์หน้าร้านจะเรียงเลข 1, 2, 3... แล้วรีเซ็ตกลับเป็น 1 ตามรอบที่เลือก —
                  ส่วนออเดอร์จากแอป delivery ให้พนักงานพิมพ์เลขที่จากแอปจริงตอนขาย (ดูได้ในหน้าขายหน้าร้าน)
                </p>
                <div className="flex gap-2 flex-wrap">
                  {[
                    ["day", "รีเซ็ตรายวัน (แนะนำ)"],
                    ["month", "รีเซ็ตรายเดือน"],
                    ["year", "รีเซ็ตรายปี"],
                    ["never", "ไม่รีเซ็ต (เรียงไปเรื่อยๆ)"],
                  ].map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => updateSettings({ walkinReset: val })}
                      className="px-3 py-2 rounded-lg text-sm font-medium border"
                      style={(settings.walkinReset || "day") === val ? { backgroundColor: primary, color: "#fff", borderColor: primary } : { borderColor: "#e3d2bd", color: "#5a4a3a" }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Loyalty points */}
            <div>
              <h2 className="font-bold text-lg mb-3">ระบบสะสมแต้ม</h2>
              <div className="bg-white rounded-xl border border-[#e3d2bd] p-4 space-y-3">
                <p className="text-xs text-[#8a7a68]">
                  ลูกค้าได้แต้มทุกครั้งที่ซื้อโดยใส่เบอร์โทรตอนขาย เมื่อแต้มครบจะแลกแก้วฟรีได้ในหน้าขายหน้าร้าน
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-[#5a4a3a] w-44">ได้แต้มต่อแก้วที่ขาย</span>
                  <input
                    type="number"
                    value={settings.pointsPerItem ?? 1}
                    onChange={(e) => updateSettings({ pointsPerItem: Number(e.target.value) || 0 })}
                    className="w-20 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-sm text-center"
                  />
                  <span className="text-sm text-[#5a4a3a]">แต้ม / แก้ว</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-[#5a4a3a] w-44">ครบกี่แต้มแลกแก้วฟรี</span>
                  <input
                    type="number"
                    value={settings.redeemThreshold ?? 10}
                    onChange={(e) => updateSettings({ redeemThreshold: Number(e.target.value) || 1 })}
                    className="w-20 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-sm text-center"
                  />
                  <span className="text-sm text-[#5a4a3a]">แต้ม</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-[#5a4a3a] w-44">มูลค่าแก้วฟรีสูงสุด</span>
                  <input
                    type="number"
                    value={settings.freeDrinkValue ?? 50}
                    onChange={(e) => updateSettings({ freeDrinkValue: Number(e.target.value) || 0 })}
                    className="w-20 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-sm text-center"
                  />
                  <span className="text-sm text-[#5a4a3a]">บาท (เกินนี้ลูกค้าจ่ายส่วนต่าง)</span>
                </div>
              </div>
            </div>

            {/* Online ordering / PromptPay */}
            <div>
              <h2 className="font-bold text-lg mb-3">สั่งล่วงหน้าออนไลน์ + รับเงิน PromptPay</h2>
              <div className="bg-white rounded-xl border border-[#e3d2bd] p-4 space-y-3">
                <p className="text-xs text-[#8a7a68]">
                  ใส่เบอร์โทรหรือเลขบัตรประชาชนที่ผูก PromptPay ของร้าน ลูกค้าจะสั่งและจ่ายผ่าน QR ได้ทันที —
                  <strong> ระบบยังไม่ยืนยันเงินอัตโนมัติ</strong> พนักงานต้องเช็คยอดในแอปธนาคารแล้วกดยืนยันเองที่แท็บ "ออเดอร์ล่วงหน้า"
                </p>
                <div>
                  <label className="text-xs text-[#8a7a68]">เบอร์โทร/เลขบัตร PromptPay ของร้าน</label>
                  <input
                    value={settings.promptPayId || ""}
                    onChange={(e) => updateSettings({ promptPayId: e.target.value.replace(/[^0-9]/g, "") })}
                    placeholder="0812345678"
                    className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm"
                  />
                </div>
                {settings.promptPayId && (
                  <div className="pt-2 border-t border-[#f0e6da]">
                    <p className="text-xs text-[#8a7a68] mb-2">ลิงก์สั่งล่วงหน้าสำหรับลูกค้า — แชร์หรือติด QR ที่หน้าร้าน:</p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={`${window.location.origin}${window.location.pathname}?preorder=1`}
                        className="flex-1 border border-[#e3d2bd] rounded-lg px-3 py-2 text-xs bg-[#f5f1ea]"
                        onClick={(e) => e.target.select()}
                      />
                    </div>
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(`${window.location.origin}${window.location.pathname}?preorder=1`)}`}
                      alt="QR สั่งล่วงหน้า"
                      className="mt-3 rounded-lg border border-[#e3d2bd]"
                      width={140}
                      height={140}
                    />
                  </div>
                )}
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 text-white pl-3 pr-4 py-2.5 rounded-full text-sm font-medium flex items-center gap-2 shadow-xl z-50" style={{ backgroundColor: primary }}>
          <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: accent }}>
            <Check size={12} style={{ color: primary }} />
          </span>
          {toast}
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
        <AddonGroupModal item={editAddonGroup} stock={stock} onClose={() => { setEditAddonGroup(null); setShowAddAddonGroup(false); }} onSave={saveAddonGroup} />
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
      {(editExpense || showAddExpense) && (
        <ExpenseModal
          item={editExpense}
          defaultDate={acctDate}
          onClose={() => { setEditExpense(null); setShowAddExpense(false); }}
          onSave={saveExpense}
        />
      )}
      {editCustomer && (
        <CustomerEditModal item={editCustomer} onClose={() => setEditCustomer(null)} onSave={saveCustomer} />
      )}
      {qrCustomer && (
        <CustomerQrModal customer={qrCustomer} onClose={() => setQrCustomer(null)} />
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
function AddonGroupModal({ item, stock, onClose, onSave }) {
  const [name, setName] = useState(item?.name || "");
  const [multi, setMulti] = useState(item?.multi || false);
  const [options, setOptions] = useState(item?.options || []);

  const addOption = () => setOptions((o) => [...o, { id: uid(), name: "", price: 0, stockIng: "", stockQty: "" }]);
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
            <p className="text-[11px] text-[#cbb9a8] mb-2">
              ถ้าตัวเลือกนี้ควรตัดสต๊อกด้วย (เช่น เลือก "คั่วเข้ม" ให้ตัดสต๊อกคั่วเข้ม) ใส่วัตถุดิบ+ปริมาณต่อแก้วได้เลย ไม่ใส่ก็ได้ถ้าไม่ต้องตัดสต๊อก
            </p>
            <div className="space-y-2.5">
              {options.map((opt) => (
                <div key={opt.id} className="border border-[#f0e6da] rounded-lg p-2.5 bg-[#fdfaf6]">
                  <div className="flex items-center gap-2">
                    <input value={opt.name} onChange={(e) => updateOption(opt.id, { name: e.target.value })} placeholder="ชื่อตัวเลือก" className="flex-1 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-sm" />
                    <input type="number" value={opt.price} onChange={(e) => updateOption(opt.id, { price: Number(e.target.value) || 0 })} placeholder="+ราคา" className="w-20 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-sm text-right" />
                    <button onClick={() => removeOption(opt.id)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 pl-1">
                    <span className="text-[11px] text-[#8a7a68] whitespace-nowrap">ตัดสต๊อก:</span>
                    <select
                      value={opt.stockIng || ""}
                      onChange={(e) => updateOption(opt.id, { stockIng: e.target.value })}
                      className="flex-1 border border-[#e3d2bd] rounded-lg px-2 py-1 text-xs bg-white"
                    >
                      <option value="">— ไม่ตัดสต๊อก —</option>
                      {stock.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <input
                      type="number"
                      value={opt.stockQty || ""}
                      onChange={(e) => updateOption(opt.id, { stockQty: e.target.value })}
                      placeholder="ปริมาณ"
                      disabled={!opt.stockIng}
                      className="w-20 border border-[#e3d2bd] rounded-lg px-2 py-1 text-xs text-right disabled:bg-[#f5f1ea]"
                    />
                    <span className="text-[11px] text-[#8a7a68] w-10">{stock.find((s) => s.id === opt.stockIng)?.unit || ""}</span>
                  </div>
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
        if (opt) chosenAddons.push({ id: opt.id, name: `${g.name}: ${opt.name}`, price: opt.price, stockIng: opt.stockIng || null, stockQty: Number(opt.stockQty) || 0 });
      });
    } else if (sel) {
      const opt = g.options.find((o) => o.id === sel);
      if (opt) chosenAddons.push({ id: opt.id, name: `${g.name}: ${opt.name}`, price: opt.price, stockIng: opt.stockIng || null, stockQty: Number(opt.stockQty) || 0 });
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
  const [recipe, setRecipe] = useState(() =>
    (item?.recipe || []).map((row) => {
      const exists = stock.some((s) => s.id === row.ing);
      return exists ? row : { ...row, ing: stock[0]?.id || "", _wasOrphaned: true };
    })
  );

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
                  <div key={idx}>
                    {row._wasOrphaned && (
                      <div className="text-[11px] text-red-600 mb-1">
                        ⚠ วัตถุดิบเดิมของแถวนี้ถูกลบไปแล้ว ระบบเลือกตัวแรกให้ชั่วคราว — กรุณาเลือกวัตถุดิบที่ถูกต้องแล้วกดบันทึก
                      </div>
                    )}
                    <div className={`flex items-center gap-2 ${row._wasOrphaned ? "ring-2 ring-red-300 rounded-lg p-1" : ""}`}>
                      <select
                        value={row.ing}
                        onChange={(e) => updateRecipeRow(idx, { ing: e.target.value, _wasOrphaned: false })}
                        className="flex-1 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-xs bg-white"
                      >
                        {stock.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <input type="number" value={row.qty} onChange={(e) => updateRecipeRow(idx, { qty: Number(e.target.value) || 0 })} className="w-20 border border-[#e3d2bd] rounded-lg px-2 py-1.5 text-xs text-right" />
                      <span className="text-xs text-[#8a7a68] w-10">{stockItem?.unit || ""}</span>
                      <button onClick={() => removeRecipeRow(idx)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
                    </div>
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
            onSave({ ...item, name, price: Number(price), categoryId, image, channelPrices, addonGroupIds, recipe: recipe.map(({ _wasOrphaned, ...r }) => r) })
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
  const [cost, setCost] = useState(item?.cost ?? "");

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
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-[#8a7a68]">แจ้งเตือนเมื่อต่ำกว่า</label>
              <input type="number" value={low} onChange={(e) => setLow(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
            </div>
            <div>
              <label className="text-xs text-[#8a7a68]">ต้นทุน/หน่วย (บาท)</label>
              <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="เช่น 0.8" className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
            </div>
          </div>
          <p className="text-[11px] text-[#cbb9a8]">ต้นทุน/หน่วย ใช้คำนวณต้นทุนวัตถุดิบอัตโนมัติในหน้า "บัญชี" — เว้นว่างได้ถ้ายังไม่อยากคิดต้นทุน</p>
        </div>
        <button onClick={() => name && qty !== "" && onSave({ ...item, name, qty: Number(qty), unit, low: Number(low || 0), cost: cost === "" ? 0 : Number(cost) })} className="mt-4 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold text-sm">บันทึก</button>
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
            เลขที่ออเดอร์: <strong>{order.orderNumber || order.id}</strong><br />
            วันที่: {new Date(order.time).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
          </div>
          <div className="border-t border-dashed border-[#999] my-2" />
          {order.items.map((it, idx) => (
            <div key={idx} className="mb-1">
              <div className="flex justify-between">
                <span>{it.name} x{it.qty}{it.redeemed ? " (แลกแต้ม)" : ""}</span>
                <span>{THB(it.lineTotal != null ? it.lineTotal : it.price * it.qty)}</span>
              </div>
              {it.addons?.length > 0 && <div className="text-[10px] text-[#8a7a68] pl-2">{it.addons.map((a) => a.name).join(", ")}</div>}
            </div>
          ))}
          <div className="border-t border-dashed border-[#999] my-2" />
          <div className="flex justify-between font-bold text-base">
            <span>รวม</span><span>{THB(order.total)}</span>
          </div>
          {order.customerPhone && (
            <div className="text-xs text-[#8a7a68] mt-2 pt-2 border-t border-dashed border-[#999]">
              ลูกค้า: {order.customerPhone}
              {order.pointsUsed > 0 && <> · แลกแต้มไป <strong>{order.pointsUsed}</strong></>}
              {order.pointsEarned > 0 && <> · ได้แต้มสะสม <strong>{order.pointsEarned}</strong></>}
            </div>
          )}
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

// ---------- แท็บบัญชี: รายรับ-รายจ่าย ต้นทุน กำไร/ขาดทุน ----------
function AccountingTab({ sales, expenses, channels, acctDate, setAcctDate, onAddExpense, onEditExpense, onDeleteExpense, primary }) {
  const dayKey = (iso) => new Date(iso).toISOString().slice(0, 10);
  const daySales = (sales || []).filter((s) => dayKey(s.time) === acctDate);
  const dayExpenses = (expenses || []).filter((e) => e.date === acctDate);

  const revenue = daySales.reduce((s, o) => s + o.total, 0);
  const cogs = daySales.reduce((s, o) => s + (o.cogs || 0), 0);
  const grossProfit = revenue - cogs;
  const totalExpenses = dayExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const netProfit = grossProfit - totalExpenses;

  const byChannel = channels.map((ch) => ({
    ...ch,
    revenue: daySales.filter((s) => (s.channel || "walkin") === ch.id).reduce((s, o) => s + o.total, 0),
    count: daySales.filter((s) => (s.channel || "walkin") === ch.id).length,
  })).filter((c) => c.count > 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-bold text-lg">บัญชีรับ-จ่าย</h2>
        <input
          type="date"
          value={acctDate}
          onChange={(e) => setAcctDate(e.target.value)}
          className="border border-[#e3d2bd] rounded-lg px-3 py-1.5 text-sm bg-white"
        />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-[#e3d2bd] p-4">
          <div className="text-xs text-[#8a7a68]">รายรับ (ขายได้)</div>
          <div className="text-xl font-bold mt-1" style={{ color: "#a6622f" }}>{THB(revenue)}</div>
          <div className="text-[11px] text-[#8a7a68] mt-1">{daySales.length} ออเดอร์</div>
        </div>
        <div className="bg-white rounded-xl border border-[#e3d2bd] p-4">
          <div className="text-xs text-[#8a7a68]">ต้นทุนวัตถุดิบ (COGS)</div>
          <div className="text-xl font-bold mt-1 text-orange-600">{THB(cogs)}</div>
          <div className="text-[11px] text-[#8a7a68] mt-1">คำนวณจากสูตร+ตัวเลือกเสริมที่ตัดจริง</div>
        </div>
        <div className="bg-white rounded-xl border border-[#e3d2bd] p-4">
          <div className="text-xs text-[#8a7a68]">รายจ่ายอื่น (ค่าเช่า/ค่าแรง ฯลฯ)</div>
          <div className="text-xl font-bold mt-1 text-red-500">{THB(totalExpenses)}</div>
          <div className="text-[11px] text-[#8a7a68] mt-1">{dayExpenses.length} รายการ</div>
        </div>
        <div className="bg-white rounded-xl border border-[#e3d2bd] p-4">
          <div className="text-xs text-[#8a7a68]">กำไร/ขาดทุนสุทธิ</div>
          <div className={`text-xl font-bold mt-1 ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>{THB(netProfit)}</div>
          <div className="text-[11px] text-[#8a7a68] mt-1">กำไรขั้นต้น {THB(grossProfit)}</div>
        </div>
      </div>

      {byChannel.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-sm text-[#8a7a68] mb-2">ยอดขายแยกตามช่องทาง</h3>
          <div className="bg-white rounded-xl border border-[#e3d2bd] divide-y divide-[#f0e6da]">
            {byChannel.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3 text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="text-[#8a7a68]">{c.count} ออเดอร์</span>
                <span className="font-semibold" style={{ color: "#a6622f" }}>{THB(c.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm text-[#8a7a68]">รายจ่ายอื่นของวันนี้</h3>
        <button onClick={onAddExpense} className="flex items-center gap-1 text-white text-sm px-3 py-1.5 rounded-lg" style={{ backgroundColor: primary }}>
          <Plus size={14} /> เพิ่มรายจ่าย
        </button>
      </div>
      <div className="bg-white rounded-xl border border-[#e3d2bd] overflow-hidden">
        {dayExpenses.length === 0 ? (
          <p className="text-sm text-[#8a7a68] py-6 text-center">ยังไม่มีรายจ่ายในวันนี้</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#f5f1ea] text-[#8a7a68]">
              <tr>
                <th className="text-left px-4 py-2">รายการ</th>
                <th className="text-right px-4 py-2">จำนวน</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {dayExpenses.map((e) => (
                <tr key={e.id} className="border-t border-[#f0e6da]">
                  <td className="px-4 py-2">{e.name}</td>
                  <td className="px-4 py-2 text-right font-semibold text-red-500">{THB(e.amount)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => onEditExpense(e)} className="mr-2" style={{ color: "#a6622f" }}><Edit2 size={14} /></button>
                    <button onClick={() => onDeleteExpense(e.id)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-[#cbb9a8] mt-4">
        ต้นทุนวัตถุดิบ (COGS) คำนวณจาก "ต้นทุน/หน่วย" ที่ตั้งไว้ในหน้าสต๊อก × ปริมาณที่ใช้จริงต่อออเดอร์ —
        ถ้าเมนูไหนยังไม่ตั้งต้นทุนวัตถุดิบไว้ ตัวเลข COGS จะนับเป็น 0 สำหรับเมนูนั้น ไปตั้งได้ที่หน้า "สต๊อก" ปุ่มแก้ไขแต่ละรายการ
      </p>
    </div>
  );
}

// ---------- Modal: รายจ่าย ----------
function ExpenseModal({ item, defaultDate, onClose, onSave }) {
  const [name, setName] = useState(item?.name || "");
  const [amount, setAmount] = useState(item?.amount ?? "");
  const [date, setDate] = useState(item?.date || defaultDate);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">{item ? "แก้ไขรายจ่าย" : "เพิ่มรายจ่าย"}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[#8a7a68]">รายการ เช่น ค่าเช่า, ค่าแรงพนักงาน, ค่าน้ำไฟ</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
          </div>
          <div>
            <label className="text-xs text-[#8a7a68]">จำนวนเงิน (บาท)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
          </div>
          <div>
            <label className="text-xs text-[#8a7a68]">วันที่</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
          </div>
        </div>
        <button
          onClick={() => name && amount !== "" && onSave({ ...item, name, amount: Number(amount), date })}
          className="mt-4 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold text-sm"
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}

// ---------- Modal: แก้ไขชื่อลูกค้า ----------
function CustomerEditModal({ item, onClose, onSave }) {
  const [name, setName] = useState(item?.name || "");
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">แก้ไขข้อมูลลูกค้า</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <p className="text-xs text-[#8a7a68] mb-3">เบอร์โทร: {item.phone}</p>
        <label className="text-xs text-[#8a7a68]">ชื่อลูกค้า</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น คุณสมชาย" className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2 mt-1 text-sm" />
        <button onClick={() => onSave({ ...item, name })} className="mt-4 w-full bg-[#2b1d14] text-white rounded-lg py-2.5 font-semibold text-sm">บันทึก</button>
      </div>
    </div>
  );
}

// ---------- Modal: QR สะสมแต้มของลูกค้า ----------
function CustomerQrModal({ customer, onClose }) {
  const pointsUrl = `${window.location.origin}${window.location.pathname}?customer=${encodeURIComponent(customer.phone)}`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(pointsUrl)}`;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-sm text-center">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold">QR สะสมแต้ม</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <p className="text-sm text-[#8a7a68] mb-3">{customer.name || "ลูกค้า"} · {customer.phone}</p>
        <img src={qrImg} alt="QR points" className="mx-auto rounded-lg border border-[#e3d2bd]" width={240} height={240} />
        <p className="text-xs text-[#8a7a68] mt-3">ให้ลูกค้าสแกนเพื่อดูแต้มสะสมของตัวเอง — บันทึกรูปหรือพิมพ์แจกลูกค้าได้</p>
        <p className="text-[11px] text-[#cbb9a8] mt-1 break-all">{pointsUrl}</p>
      </div>
    </div>
  );
}

// ---------- หน้าลูกค้าดูแต้มของตัวเอง (เข้าผ่านลิงก์ QR ไม่ต้อง login) ----------
function CustomerPointsView({ phone }) {
  const [customer, setCustomer] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await loadData("customers", []);
        const found = (list || []).find((c) => c.phone === phone);
        if (found) setCustomer(found);
        else setNotFound(true);
      } catch (e) {
        console.error(e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [phone]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1c1410]">
        <div className="w-10 h-10 rounded-full border-2 border-[#d4a574]/30 border-t-[#d4a574] animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fbf7f0] p-6">
        <div className="text-center">
          <Users size={32} className="mx-auto mb-3 text-[#cbb9a8]" />
          <p className="text-[#5a4a3a]">ไม่พบข้อมูลลูกค้า เบอร์ {phone}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fbf7f0] flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-sm text-center border border-[#f0e6da]">
        <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: "#d4a57422" }}>
          <Star size={28} style={{ color: "#a6622f" }} />
        </div>
        <h1 className="font-bold text-xl" style={{ color: "#2b1d14" }}>{SHOP_NAME}</h1>
        <p className="text-sm text-[#8a7a68] mt-1">{customer.name || "ลูกค้าประจำ"} · {customer.phone}</p>
        <div className="mt-6">
          <div className="text-5xl font-extrabold" style={{ color: "#a6622f" }}>{customer.points || 0}</div>
          <div className="text-sm text-[#8a7a68] mt-1">แต้มสะสม</div>
        </div>
        {customer.history?.length > 0 && (
          <div className="mt-6 text-left">
            <div className="text-xs font-semibold text-[#8a7a68] mb-2">การสั่งล่าสุด</div>
            <div className="space-y-1.5">
              {customer.history.slice(0, 5).map((h, i) => (
                <div key={i} className="text-xs text-[#5a4a3a] flex justify-between border-b border-[#f5f1ea] pb-1.5">
                  <span>{h.items.map((it) => it.name).join(", ")}</span>
                  <span className="text-[#8a7a68] flex-shrink-0 ml-2">{new Date(h.time).toLocaleDateString("th-TH")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="text-[11px] text-[#cbb9a8] mt-6">แจ้งพนักงานเพื่อใช้แต้มแลกของได้ที่หน้าร้าน</p>
      </div>
    </div>
  );
}

// ---------- หน้าสั่งล่วงหน้าออนไลน์สำหรับลูกค้า (เข้าผ่านลิงก์/QR ไม่ต้อง login) ----------
function PreOrderView() {
  const [menu, setMenu] = useState(null);
  const [categories, setCategories] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openCategoryId, setOpenCategoryId] = useState(null);
  const [cart, setCart] = useState([]);
  const [addonItem, setAddonItem] = useState(null);
  const [step, setStep] = useState("menu"); // menu | info | pay | done
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [pickupNote, setPickupNote] = useState("ตอนนี้");
  const [submittedOrder, setSubmittedOrder] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const [m, c, st] = await Promise.all([
        loadData("menu", []),
        loadData("categories", []),
        loadData("settings", DEFAULT_SETTINGS),
      ]);
      setMenu(m || []);
      setCategories(c || []);
      setSettings({ ...DEFAULT_SETTINGS, ...st });
      setLoading(false);
    })();
  }, []);

  if (loading || !settings) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1c1410]">
        <div className="w-10 h-10 rounded-full border-2 border-[#d4a574]/30 border-t-[#d4a574] animate-spin" />
      </div>
    );
  }

  const primary = settings.primaryColor || "#2b1d14";
  const accent = settings.accentColor || "#d4a574";

  const addonGroupsLib = settings.addonGroups || [];
  const resolvedAddonGroupsForItem = (item) => (item.addonGroupIds || []).map((gid) => addonGroupsLib.find((g) => g.id === gid)).filter(Boolean);

  const addToCartDirect = (item, addons = []) => {
    const cartKey = item.id + "::" + addons.map((a) => a.id).sort().join(",");
    setCart((c) => {
      const ex = c.find((x) => x.cartKey === cartKey);
      if (ex) return c.map((x) => (x.cartKey === cartKey ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { cartKey, id: item.id, name: item.name, basePrice: item.price, addons, qty: 1 }];
    });
  };
  const handleItemClick = (item) => {
    const groups = resolvedAddonGroupsForItem(item);
    if (groups.length > 0) setAddonItem(item);
    else addToCartDirect(item, []);
  };
  const changeQty = (cartKey, delta) => setCart((c) => c.map((x) => (x.cartKey === cartKey ? { ...x, qty: x.qty + delta } : x)).filter((x) => x.qty > 0));
  const lineTotal = (line) => (line.basePrice + line.addons.reduce((s, a) => s + a.price, 0)) * line.qty;
  const cartTotal = cart.reduce((s, l) => s + lineTotal(l), 0);

  const submitOrder = async () => {
    if (!customerPhone || customerPhone.length < 9) {
      alert("กรุณาใส่เบอร์โทรให้ครบ 9-10 หลัก");
      return;
    }
    setSubmitting(true);
    try {
      const existing = await loadData("preorders", []);
      const newPreorder = {
        id: uid(),
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        pickupNote,
        items: cart.map((x) => ({ id: x.id, name: x.name, price: x.basePrice, addons: x.addons, qty: x.qty, lineTotal: lineTotal(x) })),
        total: cartTotal,
        status: "pending_confirm",
        time: new Date().toISOString(),
      };
      await saveData("preorders", [newPreorder, ...existing]);
      setSubmittedOrder(newPreorder);
      setStep("done");
    } catch (e) {
      console.error(e);
      alert("ส่งออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  };

  const openCategory = (categories || []).find((c) => c.id === openCategoryId);
  const itemsInOpenCategory = openCategoryId ? (menu || []).filter((m) => m.categoryId === openCategoryId) : [];
  const ppPayload = settings.promptPayId ? generatePromptPayPayload(settings.promptPayId, cartTotal) : null;
  const ppQrImg = ppPayload ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(ppPayload)}` : null;

  return (
    <div className="min-h-screen bg-[#fbf7f0]">
      <header className="sticky top-0 z-20 text-[#fbf7f0] shadow-md py-3 px-4 flex items-center gap-2" style={{ backgroundColor: primary }}>
        {settings.logoUrl ? (
          <img src={settings.logoUrl} alt="logo" className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <Coffee size={20} style={{ color: accent }} />
        )}
        <span className="font-bold">{SHOP_NAME} · สั่งล่วงหน้า</span>
      </header>

      <main className="max-w-md mx-auto px-4 py-5 pb-32">
        {step === "menu" && (
          <>
            {!openCategoryId ? (
              <>
                <h2 className="font-bold text-lg mb-3">เลือกหมวดหมู่</h2>
                <div className="grid grid-cols-2 gap-3">
                  {(categories || []).map((cat) => (
                    <button key={cat.id} onClick={() => setOpenCategoryId(cat.id)} className="text-left p-4 rounded-2xl border border-[#e3d2bd] bg-white shadow-sm">
                      <div className="font-semibold">{cat.name}</div>
                      <div className="text-xs text-[#8a7a68] mt-0.5">{(menu || []).filter((m) => m.categoryId === cat.id).length} เมนู</div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <button onClick={() => setOpenCategoryId(null)} className="flex items-center gap-1 text-sm mb-3 font-medium" style={{ color: accent }}>
                  <ChevronLeft size={16} /> กลับไปหมวดหมู่
                </button>
                <h2 className="font-bold text-lg mb-3">{openCategory?.name}</h2>
                <div className="grid grid-cols-2 gap-3">
                  {itemsInOpenCategory.map((item) => (
                    <button key={item.id} onClick={() => handleItemClick(item)} className="text-left p-3 rounded-2xl border-2 border-[#f0e6da] bg-white shadow-sm active:scale-95 transition-all">
                      {item.image ? (
                        <img src={item.image} alt={item.name} className="w-full h-20 object-cover rounded-xl mb-2" onError={(e) => (e.target.style.display = "none")} />
                      ) : (
                        <div className="w-full h-20 rounded-xl mb-2 flex items-center justify-center" style={{ backgroundColor: `${accent}1a` }}>
                          <Coffee size={22} style={{ color: accent }} />
                        </div>
                      )}
                      <div className="font-semibold text-sm">{item.name}</div>
                      <div className="font-bold mt-1" style={{ color: "#a6622f" }}>{THB(item.price)}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {step === "info" && (
          <div>
            <h2 className="font-bold text-lg mb-3">ข้อมูลผู้สั่ง</h2>
            <div className="bg-white rounded-2xl border border-[#f0e6da] p-4 space-y-3">
              <div>
                <label className="text-xs text-[#8a7a68]">ชื่อ</label>
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2.5 mt-1 text-sm" placeholder="เช่น คุณสมชาย" />
              </div>
              <div>
                <label className="text-xs text-[#8a7a68]">เบอร์โทร (ใช้รับแต้มสะสมด้วย)</label>
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                  inputMode="numeric"
                  className="w-full border border-[#e3d2bd] rounded-lg px-3 py-2.5 mt-1 text-sm"
                  placeholder="0812345678"
                />
              </div>
              <div>
                <label className="text-xs text-[#8a7a68]">จะมารับเมื่อไหร่</label>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {["ตอนนี้", "15 นาที", "30 นาที", "1 ชั่วโมง"].map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setPickupNote(opt)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium border"
                      style={pickupNote === opt ? { backgroundColor: primary, color: "#fff", borderColor: primary } : { borderColor: "#e3d2bd", color: "#5a4a3a" }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "pay" && (
          <div className="text-center">
            <h2 className="font-bold text-lg mb-3">สแกนจ่ายเงิน</h2>
            {ppQrImg ? (
              <>
                <img src={ppQrImg} alt="PromptPay QR" className="mx-auto rounded-xl border border-[#e3d2bd]" width={240} height={240} />
                <p className="text-2xl font-extrabold mt-3" style={{ color: "#a6622f" }}>{THB(cartTotal)}</p>
                <p className="text-xs text-[#8a7a68] mt-1">เปิดแอปธนาคารแล้วสแกน QR นี้เพื่อโอนเงิน</p>
              </>
            ) : (
              <p className="text-sm text-red-500">ร้านยังไม่ได้ตั้งค่า PromptPay กรุณาติดต่อพนักงาน</p>
            )}
            <button
              onClick={submitOrder}
              disabled={submitting || !ppQrImg}
              className="mt-6 w-full text-white rounded-xl py-3.5 font-semibold disabled:opacity-50"
              style={{ backgroundColor: primary }}
            >
              {submitting ? "กำลังส่งออเดอร์..." : "✓ ฉันโอนเงินแล้ว"}
            </button>
          </div>
        )}

        {step === "done" && submittedOrder && (
          <div className="text-center pt-6">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: `${accent}22` }}>
              <Check size={28} style={{ color: "#a6622f" }} />
            </div>
            <h2 className="font-bold text-xl">ส่งออเดอร์แล้ว!</h2>
            <p className="text-sm text-[#8a7a68] mt-2">
              ร้านจะตรวจสอบยอดโอนและเตรียมเครื่องดื่มให้ — มารับได้ตามเวลาที่แจ้งไว้ ({pickupNote})
            </p>
            <div className="bg-white rounded-2xl border border-[#f0e6da] p-4 mt-5 text-left">
              {submittedOrder.items.map((it, i) => (
                <div key={i} className="flex justify-between text-sm mb-1">
                  <span>{it.name} x{it.qty}</span>
                  <span>{THB(it.lineTotal)}</span>
                </div>
              ))}
              <div className="border-t border-[#f0e6da] mt-2 pt-2 flex justify-between font-bold">
                <span>รวม</span><span style={{ color: "#a6622f" }}>{THB(submittedOrder.total)}</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {step === "menu" && cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#f0e6da] p-4 shadow-lg">
          <div className="max-w-md mx-auto">
            <div className="flex items-center justify-between text-sm mb-2 max-h-24 overflow-y-auto">
              <div className="space-y-1 flex-1">
                {cart.map((line) => (
                  <div key={line.cartKey} className="flex items-center justify-between">
                    <span>{line.name} x{line.qty}</span>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => changeQty(line.cartKey, -1)} className="w-6 h-6 rounded-full bg-[#f5f1ea] flex items-center justify-center"><Minus size={12} /></button>
                      <button onClick={() => changeQty(line.cartKey, 1)} className="w-6 h-6 rounded-full bg-[#f5f1ea] flex items-center justify-center"><Plus size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between font-bold mb-2">
              <span>รวม</span><span style={{ color: "#a6622f" }}>{THB(cartTotal)}</span>
            </div>
            <button onClick={() => setStep("info")} className="w-full text-white rounded-xl py-3 font-semibold" style={{ backgroundColor: primary }}>
              ต่อไป
            </button>
          </div>
        </div>
      )}
      {step === "info" && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#f0e6da] p-4 shadow-lg">
          <div className="max-w-md mx-auto flex gap-2">
            <button onClick={() => setStep("menu")} className="flex-1 border border-[#e3d2bd] rounded-xl py-3 font-medium">กลับ</button>
            <button
              onClick={() => (customerPhone.length >= 9 ? setStep("pay") : alert("กรุณาใส่เบอร์โทรให้ครบ"))}
              className="flex-1 text-white rounded-xl py-3 font-semibold"
              style={{ backgroundColor: primary }}
            >
              ไปจ่ายเงิน
            </button>
          </div>
        </div>
      )}

      {addonItem && (
        <AddonModal
          item={addonItem}
          groups={resolvedAddonGroupsForItem(addonItem)}
          basePrice={addonItem.price}
          onClose={() => setAddonItem(null)}
          onConfirm={(chosenAddons) => {
            addToCartDirect(addonItem, chosenAddons);
            setAddonItem(null);
          }}
        />
      )}
    </div>
  );
}
