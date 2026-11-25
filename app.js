// Інтерфейс: зв'язує логіку з script.js (SB) і сторінку.
(() => {
  const $ = (id) => document.getElementById(id);
  // [ПРОДОВЖЕННЯ v2] перевірка: чи index.html відповідає цій версії app.js
  const missing = ["g-select", "g-add", "g-del", "g-currency", "cur-label", "print-title", "transfer-form", "t-from", "t-to", "t-amount", "t-date", "t-list", "f-q", "print-btn"].filter((id) => !$(id));
  if (missing.length) {
    document.body.insertAdjacentHTML("afterbegin", `<p style="background:#b3402e;color:#fff;padding:12px 20px;margin:0">Файл index.html старої версії: немає елементів ${missing.join(", ")}. Замініть index.html новим і оновіть сторінку (Ctrl+F5).</p>`);
    return;
  }
  const root = SB.load(); // [ПРОДОВЖЕННЯ v2] root = усі групи
  let state = SB.active(root); // поточна група
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
    SB.save(root); renderAll();
    if (okText) toast(okText);
    return true;
  };
  const money = (c) => SB.fromCents(c) + " " + SB.sym(state);
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
    const list = SB.filterHistory(state, { memberId: sel.value || undefined, dateFrom: $("f-from").value || undefined, dateTo: $("f-to").value || undefined, query: $("f-q").value });
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

  // [ПРОДОВЖЕННЯ v2] групи, валюта, фактичні перекази
  function renderGroups() {
    $("g-select").innerHTML = root.groups.map((g) => `<option value="${g.id}">${SB.escapeHtml(g.name)}</option>`).join("");
    $("g-select").value = state.id;
    $("g-currency").innerHTML = Object.entries(SB.CURRENCIES).map(([k, v]) => `<option value="${k}">${k} (${v})</option>`).join("");
    $("g-currency").value = state.currency;
    $("g-del").disabled = root.groups.length < 2;
    $("cur-label").textContent = SB.sym(state);
    $("print-title").textContent = `${state.name} — підсумок на ${fmtDate(new Date().toISOString().slice(0, 10))}`;
    document.title = `СпільнийБюджет — ${state.name}`;
  }

  function renderTransfers() {
    for (const id of ["t-from", "t-to"]) {
      const sel = $(id), prev = sel.value;
      sel.innerHTML = optionsHtml(false);
      if (state.members.some((m) => m.id === prev)) sel.value = prev;
    }
    if (state.members.length > 1 && $("t-to").value === $("t-from").value) $("t-to").selectedIndex = ($("t-from").selectedIndex + 1) % state.members.length;
    $("t-list").innerHTML = state.transfers.length
      ? [...state.transfers].sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) =>
          `<li><span>${fmtDate(t.date)} · ${SB.escapeHtml(SB.memberName(state, t.fromId))} → ${SB.escapeHtml(SB.memberName(state, t.toId))}</span><b>${money(t.amount)}</b><button type="button" class="small danger" data-del-tr="${t.id}">Видалити</button></li>`).join("")
      : '<li class="empty" style="border:0">Переказів ще немає.</li>';
  }

  function renderAll() {
    renderGroups(); renderMembers(); renderExpenseForm(); renderBalances(); renderSettlements(); renderTransfers(); renderHistory();
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

  // [ПРОДОВЖЕННЯ v2] події: групи, валюта, перекази, пошук, друк
  const switchGroup = (id) => { root.activeId = id; state = SB.active(root); SB.save(root); resetExpenseForm(); renderAll(); };
  $("g-select").addEventListener("change", (ev) => switchGroup(ev.target.value));
  $("g-add").addEventListener("click", () => {
    const name = prompt("Назва нової групи:");
    if (name === null) return;
    const res = SB.addGroup(root, name, state.currency);
    if (res.ok) { state = SB.active(root); SB.save(root); resetExpenseForm(); renderAll(); toast("Групу створено"); }
    else toast(res.error, true);
  });
  $("g-del").addEventListener("click", () => {
    if (!confirm(`Видалити групу «${state.name}» разом з усіма даними?`)) return;
    const res = SB.removeGroup(root, state.id);
    if (res.ok) { state = SB.active(root); SB.save(root); resetExpenseForm(); renderAll(); toast("Групу видалено"); }
    else toast(res.error, true);
  });
  $("g-currency").addEventListener("change", (ev) => run(SB.setCurrency(state, ev.target.value), "Валюту змінено (суми не перераховуються)"));

  $("transfer-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const res = SB.addTransfer(state, { fromId: $("t-from").value, toId: $("t-to").value, amount: $("t-amount").value, date: $("t-date").value });
    if (run(res, "Переказ записано")) $("t-amount").value = "";
  });
  $("t-list").addEventListener("click", (ev) => {
    const id = ev.target.dataset.delTr;
    if (id && confirm("Видалити цей запис про переказ?")) run(SB.removeTransfer(state, id), "Запис видалено");
  });
  $("f-q").addEventListener("input", renderHistory);
  $("print-btn").addEventListener("click", () => window.print());

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
    const res = SB.importJson(root, await f.text()); // [ПРОДОВЖЕННЯ v2] відновлює всі групи
    if (res.ok) state = SB.active(root);
    if (run(res, "Дані відновлено")) resetExpenseForm();
  });

  $("e-date").value = new Date().toISOString().slice(0, 10);
  $("t-date").value = $("t-date").max = new Date().toISOString().slice(0, 10);
  renderAll();
  // [ПРОДОВЖЕННЯ v2] PWA: службовий воркер для роботи офлайн
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();