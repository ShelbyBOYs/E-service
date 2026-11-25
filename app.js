// Інтерфейс: зв'язує логіку з script.js (SB) і сторінку.
(() => {
  const $ = (id) => document.getElementById(id);
  const state = SB.load();
  let editingId = null;
  let toastTimer;

  const toast = (text, isError) => {
    const t = $("toast");
    t.textContent = text;
    t.className = "show" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = ""), 2800);
  };
  // Виконує дію зі стану; при успіху зберігає й перемальовує
  const run = (res, okText) => {
    if (!res.ok) { toast(res.error, true); return false; }
    SB.save(state); renderAll();
    if (okText) toast(okText);
    return true;
  };
  const money = (c) => SB.fromCents(c) + " грн";
  const fmtDate = (iso) => iso.split("-").reverse().join(".");
  const optionsHtml = (withAll) =>
    (withAll ? '<option value="">Усі</option>' : "") +
    state.members.map((m) => `<option value="${m.id}">${SB.escapeHtml(m.name)}</option>`).join("");

  // ---------- Рендер ----------
  function renderMembers() {
    const ul = $("member-list");
    ul.innerHTML = state.members.length
      ? state.members.map((m) => `<li>${SB.escapeHtml(m.name)}<button type="button" data-del-member="${m.id}" aria-label="Видалити ${SB.escapeHtml(m.name)}">×</button></li>`).join("")
      : '<li class="empty" style="border:0;background:none;padding:0">Додайте хоча б двох учасників, щоб почати.</li>';
  }

  function renderExpenseForm() {
    const payer = $("e-payer"), prev = payer.value;
    payer.innerHTML = optionsHtml(false);
    if (state.members.some((m) => m.id === prev)) payer.value = prev;
    const checked = new Set([...document.querySelectorAll("#e-parts input[type=checkbox]:checked")].map((i) => i.value));
    const prevW = {};
    document.querySelectorAll("#e-parts [data-w]").forEach((i) => (prevW[i.dataset.w] = i.value));
    const firstDraw = $("e-parts").children.length === 0;
    $("e-parts").innerHTML = state.members.map((m) =>
      `<label><input type="checkbox" value="${m.id}" ${firstDraw || checked.has(m.id) || !$("e-parts").dataset.init ? "checked" : ""}> ${SB.escapeHtml(m.name)} <input type="number" class="w" min="1" max="100" step="1" value="${prevW[m.id] || 1}" data-w="${m.id}" aria-label="Частка: ${SB.escapeHtml(m.name)}"></label>`).join("");
    $("e-parts").dataset.init = "1";
    $("e-date").max = new Date().toISOString().slice(0, 10);
  }

  function renderBalances() {
    const b = SB.computeBalances(state);
    $("balances").innerHTML = b.length
      ? b.map((x) => `<div class="bal"><div>${SB.escapeHtml(x.name)}<small>заплатив ${money(x.paid)} · його частка ${money(x.share)}</small></div>
          <span class="${x.balance >= 0 ? "pos" : "neg"}">${x.balance > 0 ? "+" : ""}${money(x.balance)}</span></div>`).join("")
      : '<p class="empty">Тут з\'являться баланси учасників.</p>';
  }

  function renderSettlements() {
    const s = SB.computeSettlements(state);
    $("settlements").innerHTML = s.length
      ? s.map((t) => `<li><span>${SB.escapeHtml(t.fromName)} → ${SB.escapeHtml(t.toName)}</span><b>${money(t.amount)}</b></li>`).join("")
      : '<li class="empty" style="border:0">Боргів немає.</li>';
  }

  function renderHistory() {
    const sel = $("f-member"), prev = sel.value;
    sel.innerHTML = optionsHtml(true);
    if (state.members.some((m) => m.id === prev)) sel.value = prev;
    const list = SB.filterHistory(state, { memberId: sel.value || undefined, dateFrom: $("f-from").value || undefined, dateTo: $("f-to").value || undefined });
    $("history").innerHTML = list.length
      ? list.map((e) => `<li class="${e.settled ? "settled" : ""}">
          <span class="title">${SB.escapeHtml(e.description || "Без опису")}</span>
          <span class="sum">${money(e.amount)}</span>
          <span class="meta">${fmtDate(e.date)} · заплатив ${SB.escapeHtml(SB.memberName(state, e.payerId))} · ділять: ${SB.participantsText(state, e).map(SB.escapeHtml).join(", ")}</span>
          <span class="acts">
            <label><input type="checkbox" data-settle="${e.id}" ${e.settled ? "checked" : ""}> Погашено</label>
            <button type="button" class="small ghost" data-edit="${e.id}">Редагувати</button>
            <button type="button" class="small danger" data-del="${e.id}">Видалити</button>
          </span></li>`).join("")
      : '<li class="empty">Витрат за цими умовами немає.</li>';
  }

  function renderAll() {
    renderMembers(); renderExpenseForm(); renderBalances(); renderSettlements(); renderHistory();
  }

  // ---------- Події ----------
  $("member-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (run(SB.addMember(state, $("member-name").value), "Учасника додано")) { $("member-name").value = ""; $("e-parts").dataset.init = ""; renderExpenseForm(); }
  });

  $("member-list").addEventListener("click", (ev) => {
    const id = ev.target.dataset.delMember;
    if (id) run(SB.removeMember(state, id), "Учасника видалено");
  });

  function resetExpenseForm() {
    editingId = null;
    $("expense-form").reset();
    $("e-submit").textContent = "Додати витрату";
    $("e-cancel").hidden = true;
    $("e-parts").dataset.init = "";
    renderExpenseForm();
  }

  $("expense-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const ids = [...document.querySelectorAll("#e-parts input[type=checkbox]:checked")].map((i) => i.value);
    const data = {
      payerId: $("e-payer").value, amount: $("e-amount").value, description: $("e-desc").value,
      date: $("e-date").value, participantIds: ids,
      weights: ids.map((id) => Number(document.querySelector(`#e-parts [data-w="${id}"]`).value)),
    };
    const res = editingId ? SB.updateExpense(state, editingId, data) : SB.addExpense(state, data);
    if (run(res, editingId ? "Витрату оновлено" : "Витрату додано")) resetExpenseForm();
  });
  $("e-cancel").addEventListener("click", resetExpenseForm);

  $("history").addEventListener("click", (ev) => {
    const d = ev.target.dataset;
    if (d.del && confirm("Видалити цю витрату?")) run(SB.removeExpense(state, d.del), "Витрату видалено");
    if (d.edit) {
      const e = state.expenses.find((x) => x.id === d.edit);
      editingId = e.id;
      $("e-payer").value = e.payerId; $("e-amount").value = SB.fromCents(e.amount);
      $("e-desc").value = e.description; $("e-date").value = e.date;
      document.querySelectorAll("#e-parts input[type=checkbox]").forEach((i) => {
        const k = e.participantIds.indexOf(i.value);
        i.checked = k >= 0;
        document.querySelector(`#e-parts [data-w="${i.value}"]`).value = k >= 0 && e.weights ? e.weights[k] : 1;
      });
      $("e-submit").textContent = "Зберегти зміни"; $("e-cancel").hidden = false;
      $("expense-form").scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
  $("history").addEventListener("change", (ev) => {
    if (ev.target.dataset.settle) run(SB.setSettled(state, ev.target.dataset.settle, ev.target.checked));
  });
  ["f-member", "f-from", "f-to"].forEach((id) => $(id).addEventListener("change", renderHistory));

  const download = (name, text, type) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + text], { type }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  };
  $("export-txt").addEventListener("click", () => download("pidsumok.txt", SB.exportTxt(state), "text/plain;charset=utf-8"));
  $("export-csv").addEventListener("click", () => download("vytraty.csv", SB.exportCsv(state), "text/csv;charset=utf-8"));

  $("export-json").addEventListener("click", () => download("kopiia-budzhetu.json", SB.exportJson(state), "application/json;charset=utf-8"));
  $("import-file").addEventListener("change", async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    if (!confirm("Поточні дані буде замінено даними з файлу. Продовжити?")) return;
    if (run(SB.importJson(state, await f.text()), "Дані відновлено")) resetExpenseForm();
  });

  $("e-date").value = new Date().toISOString().slice(0, 10);
  renderAll();
})();