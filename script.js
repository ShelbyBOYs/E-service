
// Усі суми всередині зберігаються в копійках (цілі числа), щоб не було похибок округлення.

const SB = (() => {
  const STORAGE_KEY = "spilnyi-budzhet-v1";

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
  // state = { members: [{id,name}], expenses: [{id,payerId,amount,description,date,participantIds,settled}] }
  const emptyState = () => ({ members: [], expenses: [] });

  const save = (state) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* немає localStorage */ }
  };
  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const s = JSON.parse(raw);
      return { members: s.members || [], expenses: s.expenses || [] };
    } catch (e) { return emptyState(); }
  };

  // ---------- Учасники ----------
  // Повертають { ok: true } або { ok: false, error: "текст помилки" }
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
    const used = state.expenses.some((e) => e.payerId === memberId || e.participantIds.includes(memberId));
    if (used) return { ok: false, error: "Не можна видалити учасника, який є в витратах" };
    state.members = state.members.filter((m) => m.id !== memberId);
    return { ok: true };
  };

  // ---------- Витрати ----------
  const validateExpense = (state, { payerId, amount, description, date, participantIds }) => {
    const cents = toCents(amount);
    if (cents === null) return { ok: false, error: "Сума має бути додатним числом" };
    if (!state.members.some((m) => m.id === payerId)) return { ok: false, error: "Оберіть, хто заплатив" };
    if (!participantIds || participantIds.length === 0) return { ok: false, error: "Оберіть учасників розподілу" };
    if (participantIds.some((id) => !state.members.some((m) => m.id === id)))
      return { ok: false, error: "Невідомий учасник у розподілі" };
    const d = date || todayISO();
    if (d > todayISO()) return { ok: false, error: "Дата не може бути в майбутньому" };
    const desc = String(description || "").trim();
    if (desc.length > 100) return { ok: false, error: "Опис не довше 100 символів" };
    return { ok: true, cents, date: d, desc };
  };

  const addExpense = (state, data) => {
    const v = validateExpense(state, data);
    if (!v.ok) return v;
    state.expenses.push({
      id: newId(), payerId: data.payerId, amount: v.cents, description: v.desc,
      date: v.date, participantIds: [...data.participantIds], settled: false,
    });
    return { ok: true };
  };

  const updateExpense = (state, expenseId, data) => {
    const i = state.expenses.findIndex((e) => e.id === expenseId);
    if (i < 0) return { ok: false, error: "Витрату не знайдено" };
    const v = validateExpense(state, data);
    if (!v.ok) return v;
    state.expenses[i] = { ...state.expenses[i], payerId: data.payerId, amount: v.cents,
      description: v.desc, date: v.date, participantIds: [...data.participantIds] };
    return { ok: true };
  };

  const removeExpense = (state, expenseId) => {
    state.expenses = state.expenses.filter((e) => e.id !== expenseId);
    return { ok: true };
  };

  // Позначити витрату як погашену / ні (погашені не входять у розрахунок)
  const setSettled = (state, expenseId, settled) => {
    const e = state.expenses.find((x) => x.id === expenseId);
    if (!e) return { ok: false, error: "Витрату не знайдено" };
    e.settled = !!settled;
    return { ok: true };
  };

  // ---------- Розрахунки ----------
  // Поділ суми порівну між n людьми в копійках; залишок розкидається по 1 копійці перших учасників.
  const splitEqual = (cents, n) => {
    const base = Math.floor(cents / n);
    const rest = cents - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
  };

  // Баланси: для кожного учасника { memberId, name, paid, share, balance } (в копійках).
  // balance > 0 : йому винні; balance < 0 : він винен.
  const computeBalances = (state) => {
    const map = new Map(state.members.map((m) => [m.id, { memberId: m.id, name: m.name, paid: 0, share: 0, balance: 0 }]));
    state.expenses.filter((e) => !e.settled).forEach((e) => {
      const payer = map.get(e.payerId);
      if (payer) payer.paid += e.amount;
      const parts = splitEqual(e.amount, e.participantIds.length);
      e.participantIds.forEach((id, i) => { const m = map.get(id); if (m) m.share += parts[i]; });
    });
    map.forEach((m) => { m.balance = m.paid - m.share; });
    return [...map.values()];
  };

  // Переказі «хто кому»: жадібний алгоритм (найбільший боржник -> найбільший кредитор).
  // Повертає [{ fromId, fromName, toId, toName, amount }] (amount в копійках), не більше n-1 переказів.
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
  // Фільтр: { memberId?, dateFrom?, dateTo? } ; новіші зверху
  const filterHistory = (state, { memberId, dateFrom, dateTo } = {}) =>
    state.expenses
      .filter((e) => !memberId || e.payerId === memberId || e.participantIds.includes(memberId))
      .filter((e) => !dateFrom || e.date >= dateFrom)
      .filter((e) => !dateTo || e.date <= dateTo)
      .sort((a, b) => (a.date < b.date ? 1 : -1));

  const memberName = (state, id) => (state.members.find((m) => m.id === id) || { name: "?" }).name;

  const exportTxt = (state) => {
    const lines = ["СпільнийБюджет: підсумок", ""];
    lines.push("Баланси:");
    computeBalances(state).forEach((b) => lines.push(`  ${b.name}: ${b.balance >= 0 ? "+" : ""}${fromCents(b.balance)} грн`));
    lines.push("", "Хто кому скільки винен:");
    const s = computeSettlements(state);
    if (s.length === 0) lines.push("  Боргів немає");
    s.forEach((t) => lines.push(`  ${t.fromName} → ${t.toName}: ${fromCents(t.amount)} грн`));
    return lines.join("\n");
  };

  const exportCsv = (state) => {
    const rows = [["Дата", "Опис", "Сума, грн", "Заплатив", "Учасники"]];
    state.expenses.forEach((e) => rows.push([e.date, e.description, fromCents(e.amount),
      memberName(state, e.payerId), e.participantIds.map((id) => memberName(state, id)).join("; ")]));
    return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  };

  return { toCents, fromCents, escapeHtml, emptyState, load, save, addMember, removeMember,
    addExpense, updateExpense, removeExpense, setSettled, computeBalances, computeSettlements,
    filterHistory, memberName, exportTxt, exportCsv };
})();

if (typeof module !== "undefined") module.exports = SB; // для перевірки в Node