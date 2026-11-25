// Усі суми всередині зберігаються в копійках (цілі числа), щоб не було похибок округлення.

const SB = (() => {
  const STORAGE_KEY = "spilnyi-budzhet-v2";
  const OLD_KEY = "spilnyi-budzhet-v1";
  // [ПРОДОВЖЕННЯ v2] валюти (суми тільки відображаються в обраній валюті, без перерахунку курсу)
  const CURRENCIES = { UAH: "грн", USD: "$", EUR: "€", PLN: "zł" };
  const sym = (g) => CURRENCIES[g.currency] || CURRENCIES.UAH;

  // ---------- Допоміжні ----------
  const toCents = (value) => {
    const n = Number(String(value).replace(",", ".").trim());
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  };
  const fromCents = (cents) => (cents / 100).toFixed(2);
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Стан ----------
  // state = { members: [{id,name}], expenses: [{id,payerId,amount,description,date,participantIds,weights,settled}] }
  // weights[i] – частка учасника participantIds[i] (ціле 1..100); усі 1 = поділ порівну
  const emptyState = () => ({ members: [], expenses: [], transfers: [], currency: "UAH" });

  // [ПРОДОВЖЕННЯ v2] кілька груп: root = { groups: [...], activeId }; кожна група має ту саму структуру, що й раніше state
  const newGroup = (name, currency) => ({ id: newId(), name, ...emptyState(), currency: CURRENCIES[currency] ? currency : "UAH" });
  const fixGroup = (g) => ({ id: g.id || newId(), name: String(g.name || "Група").slice(0, 50),
    currency: CURRENCIES[g.currency] ? g.currency : "UAH",
    members: g.members || [], expenses: g.expenses || [], transfers: g.transfers || [] });
  const active = (root) => root.groups.find((g) => g.id === root.activeId) || root.groups[0];

  const save = (root) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(root)); } catch (e) { /* немає localStorage */ }
  };
  const load = () => {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const r = JSON.parse(raw);
        if (r.groups && r.groups.length) { const groups = r.groups.map(fixGroup); return { groups, activeId: r.activeId || groups[0].id }; }
      }
      raw = localStorage.getItem(OLD_KEY); // міграція даних зі старої версії (одна група)
      if (raw) { const g = fixGroup({ ...JSON.parse(raw), name: "Моя група" }); return { groups: [g], activeId: g.id }; }
    } catch (e) { /* пошкоджені дані – починаємо з порожніх */ }
    const g = newGroup("Моя група", "UAH");
    return { groups: [g], activeId: g.id };
  };

  const addGroup = (root, name, currency) => {
    const n = String(name || "").trim();
    if (!n) return { ok: false, error: "Введіть назву групи" };
    if (n.length > 50) return { ok: false, error: "Назва не довша 50 символів" };
    if (root.groups.some((g) => g.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: "Група з такою назвою вже є" };
    const g = newGroup(n, currency);
    root.groups.push(g); root.activeId = g.id;
    return { ok: true };
  };
  const removeGroup = (root, id) => {
    if (root.groups.length < 2) return { ok: false, error: "Має лишитися хоча б одна група" };
    root.groups = root.groups.filter((g) => g.id !== id);
    if (root.activeId === id) root.activeId = root.groups[0].id;
    return { ok: true };
  };
  const setCurrency = (g, code) => {
    if (!CURRENCIES[code]) return { ok: false, error: "Невідома валюта" };
    g.currency = code; return { ok: true };
  };

  // ---------- Учасники ----------
  const addMember = (state, name) => {
    const n = String(name || "").trim();
    if (!n) return { ok: false, error: "Введіть ім'я учасника" };
    if (n.length > 50) return { ok: false, error: "Ім'я не довше 50 символів" };
    if (state.members.some((m) => m.name.toLowerCase() === n.toLowerCase()))
      return { ok: false, error: "Такий учасник уже є" };
    state.members.push({ id: newId(), name: n });
    return { ok: true };
  };

  const removeMember = (state, memberId) => {
    const used = state.expenses.some((e) => e.payerId === memberId || e.participantIds.includes(memberId))
      || state.transfers.some((t) => t.fromId === memberId || t.toId === memberId); // [ПРОДОВЖЕННЯ v2]
    if (used) return { ok: false, error: "Не можна видалити учасника, який є в витратах" };
    state.members = state.members.filter((m) => m.id !== memberId);
    return { ok: true };
  };

  // ---------- Витрати ----------
  const validWeights = (ws, n) =>
    Array.isArray(ws) && ws.length === n && ws.every((w) => Number.isInteger(w) && w >= 1 && w <= 100);
  // Частки витрати; якщо їх немає або вони хибні – порівну
  const weightsOf = (e) => (validWeights(e.weights, e.participantIds.length) ? e.weights : e.participantIds.map(() => 1));

  const validateExpense = (state, { payerId, amount, description, date, participantIds, weights }) => {
    const cents = toCents(amount);
    if (cents === null) return { ok: false, error: "Сума має бути додатним числом" };
    if (!state.members.some((m) => m.id === payerId)) return { ok: false, error: "Оберіть, хто заплатив" };
    if (!participantIds || participantIds.length === 0) return { ok: false, error: "Оберіть учасників розподілу" };
    if (participantIds.some((id) => !state.members.some((m) => m.id === id)))
      return { ok: false, error: "Невідомий учасник у розподілі" };
    const ws = weights || participantIds.map(() => 1);
    if (!validWeights(ws, participantIds.length)) return { ok: false, error: "Частка — ціле число від 1 до 100" };
    const d = date || todayISO();
    if (d > todayISO()) return { ok: false, error: "Дата не може бути в майбутньому" };
    const desc = String(description || "").trim();
    if (desc.length > 100) return { ok: false, error: "Опис не довше 100 символів" };
    return { ok: true, cents, date: d, desc, weights: [...ws] };
  };

  const addExpense = (state, data) => {
    const v = validateExpense(state, data);
    if (!v.ok) return v;
    state.expenses.push({
      id: newId(), payerId: data.payerId, amount: v.cents, description: v.desc,
      date: v.date, participantIds: [...data.participantIds], weights: v.weights, settled: false,
    });
    return { ok: true };
  };

  const updateExpense = (state, expenseId, data) => {
    const i = state.expenses.findIndex((e) => e.id === expenseId);
    if (i < 0) return { ok: false, error: "Витрату не знайдено" };
    const v = validateExpense(state, data);
    if (!v.ok) return v;
    state.expenses[i] = { ...state.expenses[i], payerId: data.payerId, amount: v.cents,
      description: v.desc, date: v.date, participantIds: [...data.participantIds], weights: v.weights };
    return { ok: true };
  };

  const removeExpense = (state, expenseId) => {
    state.expenses = state.expenses.filter((e) => e.id !== expenseId);
    return { ok: true };
  };

  const setSettled = (state, expenseId, settled) => {
    const e = state.expenses.find((x) => x.id === expenseId);
    if (!e) return { ok: false, error: "Витрату не знайдено" };
    e.settled = !!settled;
    return { ok: true };
  };

  // ---------- Фактичні перекази ---------- [ПРОДОВЖЕННЯ v2]
  const addTransfer = (state, { fromId, toId, amount, date }) => {
    const cents = toCents(amount);
    if (cents === null) return { ok: false, error: "Сума має бути додатним числом" };
    const has = (id) => state.members.some((m) => m.id === id);
    if (!has(fromId) || !has(toId)) return { ok: false, error: "Оберіть, хто і кому віддав" };
    if (fromId === toId) return { ok: false, error: "Не можна переказувати самому собі" };
    const d = date || todayISO();
    if (d > todayISO()) return { ok: false, error: "Дата не може бути в майбутньому" };
    state.transfers.push({ id: newId(), fromId, toId, amount: cents, date: d });
    return { ok: true };
  };
  const removeTransfer = (state, id) => { state.transfers = state.transfers.filter((t) => t.id !== id); return { ok: true }; };

  // ---------- Розрахунки ----------
  // Поділ суми пропорційно часткам у копійках. Залишок (менше n копійок) отримують
  // ті, у кого найбільший дробовий залишок; при рівності – перші за порядком.
  const splitWeighted = (cents, weights) => {
    const total = weights.reduce((a, b) => a + b, 0);
    const base = weights.map((w) => Math.floor((cents * w) / total));
    const frac = weights.map((w, i) => (cents * w) % total);
    let left = cents - base.reduce((a, b) => a + b, 0);
    weights.map((_, i) => i).sort((a, b) => frac[b] - frac[a] || a - b).forEach((i) => {
      if (left > 0) { base[i] += 1; left--; }
    });
    return base;
  };
  const splitEqual = (cents, n) => splitWeighted(cents, Array(n).fill(1));

  const computeBalances = (state) => {
    const map = new Map(state.members.map((m) => [m.id, { memberId: m.id, name: m.name, paid: 0, share: 0, sent: 0, received: 0, balance: 0 }]));
    state.expenses.filter((e) => !e.settled).forEach((e) => {
      const payer = map.get(e.payerId);
      if (payer) payer.paid += e.amount;
      const parts = splitWeighted(e.amount, weightsOf(e));
      e.participantIds.forEach((id, i) => { const m = map.get(id); if (m) m.share += parts[i]; });
    });
    // [ПРОДОВЖЕННЯ v2] фактичні перекази: хто віддав – його борг зменшується, хто отримав – зменшується його «плюс»
    state.transfers.forEach((t) => { const a = map.get(t.fromId), b = map.get(t.toId); if (a) a.sent += t.amount; if (b) b.received += t.amount; });
    map.forEach((m) => { m.balance = m.paid - m.share + m.sent - m.received; });
    return [...map.values()];
  };

  // Переказі «хто кому»: жадібний алгоритм, не більше n-1 переказів.
  const computeSettlements = (state) => {
    const bal = computeBalances(state);
    const creditors = bal.filter((b) => b.balance > 0).map((b) => ({ ...b })).sort((a, b) => b.balance - a.balance);
    const debtors = bal.filter((b) => b.balance < 0).map((b) => ({ ...b, balance: -b.balance })).sort((a, b) => b.balance - a.balance);
    const result = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].balance, creditors[j].balance);
      if (pay > 0) result.push({ fromId: debtors[i].memberId, fromName: debtors[i].name,
        toId: creditors[j].memberId, toName: creditors[j].name, amount: pay });
      debtors[i].balance -= pay;
      creditors[j].balance -= pay;
      if (debtors[i].balance === 0) i++;
      if (creditors[j].balance === 0) j++;
    }
    return result;
  };

  // ---------- Історія та експорт ----------
  const filterHistory = (state, { memberId, dateFrom, dateTo, query } = {}) =>
    state.expenses
      .filter((e) => { // [ПРОДОВЖЕННЯ v2] пошук за описом, платником і учасниками
        const q = String(query || "").trim().toLowerCase();
        if (!q) return true;
        return [e.description, memberName(state, e.payerId), ...e.participantIds.map((id) => memberName(state, id))].join(" ").toLowerCase().includes(q);
      })
      .filter((e) => !memberId || e.payerId === memberId || e.participantIds.includes(memberId))
      .filter((e) => !dateFrom || e.date >= dateFrom)
      .filter((e) => !dateTo || e.date <= dateTo)
      .sort((a, b) => (a.date < b.date ? 1 : -1));

  const memberName = (state, id) => (state.members.find((m) => m.id === id) || { name: "?" }).name;

  // Учасники витрати текстом; частку показуємо лише якщо вона не 1
  const participantsText = (state, e) => {
    const ws = weightsOf(e);
    return e.participantIds.map((id, i) => memberName(state, id) + (ws[i] !== 1 ? ` (×${ws[i]})` : ""));
  };

  const exportTxt = (state) => {
    const lines = ["СпільнийБюджет: підсумок — " + state.name, "", "Баланси:"];
    computeBalances(state).forEach((b) => lines.push(`  ${b.name}: ${b.balance >= 0 ? "+" : ""}${fromCents(b.balance)} ${sym(state)}`));
    lines.push("", "Хто кому скільки винен:");
    const s = computeSettlements(state);
    if (s.length === 0) lines.push("  Боргів немає");
    s.forEach((t) => lines.push(`  ${t.fromName} → ${t.toName}: ${fromCents(t.amount)} ${sym(state)}`));
    return lines.join("\n");
  };

  const exportCsv = (state) => {
    const rows = [["Дата", "Опис", "Сума, " + sym(state), "Заплатив", "Учасники"]];
    state.expenses.forEach((e) => rows.push([e.date, e.description, fromCents(e.amount),
      memberName(state, e.payerId), participantsText(state, e).join("; ")]));
    return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  };

  // ---------- Резервна копія (JSON) ---------- [ПРОДОВЖЕННЯ v2: усі групи, версія 2; файли версії 1 теж читаються]
  const exportJson = (root) => JSON.stringify({ version: 2, activeId: root.activeId, groups: root.groups }, null, 2);

  // Перевіряє одну групу; повертає очищену групу або null
  const cleanGroup = (d) => {
    if (!d || !Array.isArray(d.members) || !Array.isArray(d.expenses)) return null;
    const ids = new Set();
    for (const m of d.members) {
      if (!m || typeof m.id !== "string" || typeof m.name !== "string" || !m.name.trim()) return null;
      ids.add(m.id);
    }
    for (const e of d.expenses) {
      const good = e && typeof e.id === "string" && ids.has(e.payerId) && Number.isInteger(e.amount) && e.amount > 0
        && typeof e.date === "string" && Array.isArray(e.participantIds) && e.participantIds.length > 0
        && e.participantIds.every((id) => ids.has(id));
      if (!good) return null;
    }
    const trs = Array.isArray(d.transfers) ? d.transfers : [];
    for (const t of trs) {
      const good = t && typeof t.id === "string" && ids.has(t.fromId) && ids.has(t.toId) && t.fromId !== t.toId
        && Number.isInteger(t.amount) && t.amount > 0 && typeof t.date === "string";
      if (!good) return null;
    }
    return {
      id: typeof d.id === "string" ? d.id : newId(), name: String(d.name || "Група").slice(0, 50),
      currency: CURRENCIES[d.currency] ? d.currency : "UAH",
      members: d.members.map((m) => ({ id: m.id, name: m.name.trim().slice(0, 50) })),
      expenses: d.expenses.map((e) => ({
        id: e.id, payerId: e.payerId, amount: e.amount, description: String(e.description || "").slice(0, 100),
        date: e.date, participantIds: [...e.participantIds], weights: weightsOf(e), settled: !!e.settled })),
      transfers: trs.map((t) => ({ id: t.id, fromId: t.fromId, toId: t.toId, amount: t.amount, date: t.date })),
    };
  };

  // Перевіряє файл і лише при повному успіху замінює всі групи в root
  const importJson = (root, text) => {
    let d;
    try { d = JSON.parse(String(text).replace(/^\uFEFF/, "")); }
    catch (e) { return { ok: false, error: "Файл не є коректним JSON" }; }
    const list = Array.isArray(d && d.groups) ? d.groups : [{ ...d, name: "Імпортована група" }];
    if (list.length === 0) return { ok: false, error: "Невірна структура файлу" };
    const groups = list.map(cleanGroup);
    if (groups.some((g) => !g)) return { ok: false, error: "Невірні дані у файлі" };
    root.groups = groups;
    root.activeId = groups.some((g) => g.id === d.activeId) ? d.activeId : groups[0].id;
    return { ok: true };
  };

  return { CURRENCIES, sym, active, addGroup, removeGroup, setCurrency, addTransfer, removeTransfer, toCents, fromCents, escapeHtml, emptyState, load, save, addMember, removeMember,
    addExpense, updateExpense, removeExpense, setSettled, computeBalances, computeSettlements,
    filterHistory, memberName, participantsText, exportTxt, exportCsv, exportJson, importJson, splitWeighted };
})();

