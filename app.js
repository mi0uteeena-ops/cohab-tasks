const $ = (sel) => document.querySelector(sel);

let taskState = { version: 2, updatedAt: new Date().toISOString(), tasks: [] };
let financeState = { version: 1, updatedAt: new Date().toISOString(), payments: [] };

const PRIORITY_ORDER = { "高": 0, "中": 1, "低": 2 };
const WD_ORDER = ["MO","TU","WE","TH","FR","SA","SU"];
const WD_LABEL = { MO:"月",TU:"火",WE:"水",TH:"木",FR:"金",SA:"土",SU:"日" };

function pad2(n){ return String(n).padStart(2,"0"); }
function toId(prefix){
  const d = new Date();
  return `${prefix}_${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}
function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#39;");
}
function isoDate(d){
  const x = new Date(d);
  if(Number.isNaN(x.getTime())) return "";
  return `${x.getFullYear()}-${pad2(x.getMonth()+1)}-${pad2(x.getDate())}`;
}
function todayIso(){ return isoDate(new Date()); }

async function loadJson(path, fallback){
  try{
    const res = await fetch(path, { cache:"no-store" });
    if(!res.ok) throw new Error(`${path} read failed`);
    return await res.json();
  }catch(e){
    console.warn(e);
    return fallback;
  }
}

function updateHints(){
  const names = new Set();
  taskState.tasks.forEach(t=>{ if(t.assignee) names.add(t.assignee); });
  financeState.payments.forEach(p=>{ if(p.payer) names.add(p.payer); });

  const dl1 = $("#assigneeHints");
  const dl2 = $("#personHints");
  const opts = [...names].sort().map(n=>`<option value="${escapeHtml(n)}"></option>`).join("");
  dl1.innerHTML = opts;
  dl2.innerHTML = opts;
}

/* ===================== Tabs ===================== */
function wireTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      $("#tab-tasks").classList.toggle("show", tab==="tasks");
      $("#tab-finance").classList.toggle("show", tab==="finance");
    });
  });
}

/* ===================== Repeat (weekly) ===================== */
function getSelectedWeekdays(selector){
  const arr = [...document.querySelectorAll(selector)]
    .filter(x=>x.checked).map(x=>x.value);
  arr.sort((a,b)=>WD_ORDER.indexOf(a)-WD_ORDER.indexOf(b));
  return arr;
}

function nextWeeklyDate(byweekday, startDate, fromDate){
  // Find the next date >= fromDate that matches weekday in byweekday and >= startDate
  const allowed = new Set(byweekday);
  let d = new Date(fromDate);
  const start = startDate ? new Date(startDate) : null;

  for(let i=0;i<366;i++){
    if(start && d < start){ d.setDate(d.getDate()+1); continue; }
    const js = d.getDay(); // 0 Sun .. 6 Sat
    const map = ["SU","MO","TU","WE","TH","FR","SA"][js];
    if(allowed.has(map)) return new Date(d);
    d.setDate(d.getDate()+1);
  }
  return null;
}

function getNextDue(task){
  // priority: explicit due > repeat next date > none
  if(task.due) return new Date(task.due);

  const rep = task.repeat;
  if(rep && rep.freq==="weekly" && Array.isArray(rep.byweekday) && rep.byweekday.length){
    const base = new Date();
    const next = nextWeeklyDate(rep.byweekday, rep.startDate, base);
    return next;
  }
  return null;
}

function repeatSummary(rep){
  if(!rep) return "";
  if(rep.freq==="weekly"){
    const days = (rep.byweekday||[]).map(w=>WD_LABEL[w]||w).join("・");
    const start = rep.startDate ? `（開始:${rep.startDate}）` : "";
    return `毎週：${days}${start}`;
  }
  return "";
}

function onCompleteRecurring(task){
  // When a recurring task is checked done:
  // -> create next instance with due = next occurrence
  const rep = task.repeat;
  if(!rep || rep.freq!=="weekly") return;

  const by = rep.byweekday || [];
  if(by.length===0) return;

  const from = new Date(); // "now"
  const next = nextWeeklyDate(by, rep.startDate, from);
  if(!next) return;

  // create a new open task (clone) with explicit due set to next occurrence
  const clone = {
    ...task,
    id: toId("t"),
    done: false,
    due: isoDate(next),
    createdAt: new Date().toISOString()
  };
  // keep repeat definition as-is
  taskState.tasks.unshift(clone);
}

/* ===================== Tasks UI ===================== */
function saveTasksInMemory(){
  taskState.updatedAt = new Date().toISOString();
}
function matchesTaskFilters(t){
  const q = ($("#q").value || "").trim().toLowerCase();
  const fs = $("#filterStatus").value;
  const fa = ($("#filterAssignee").value || "").trim().toLowerCase();
  const fc = $("#filterCategory").value;

  if(fs === "open" && t.done) return false;
  if(fs === "done" && !t.done) return false;
  if(fc !== "all" && t.category !== fc) return false;

  if(fa){
    const a = (t.assignee||"").toLowerCase();
    if(!a.includes(fa)) return false;
  }
  if(q){
    const hay = `${t.title} ${t.note||""}`.toLowerCase();
    if(!hay.includes(q)) return false;
  }
  return true;
}
function sortedTasks(tasks){
  const sortBy = $("#sortBy").value;
  const copy = [...tasks];

  if(sortBy === "next"){
    copy.sort((a,b)=>{
      const ad = getNextDue(a);
      const bd = getNextDue(b);
      const at = ad ? ad.getTime() : Number.POSITIVE_INFINITY;
      const bt = bd ? bd.getTime() : Number.POSITIVE_INFINITY;
      if(at !== bt) return at - bt;
      return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
    });
  }else if(sortBy === "created"){
    copy.sort((a,b)=> new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }else if(sortBy === "priority"){
    copy.sort((a,b)=> (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
  }
  return copy;
}
function renderTasks(){
  const list = $("#list");
  const tasks = sortedTasks(taskState.tasks.filter(matchesTaskFilters));

  const doneCount = taskState.tasks.filter(t=>t.done).length;
  const openCount = taskState.tasks.length - doneCount;

  $("#stats").innerHTML = `
    <span class="pill">未完了：<b>${openCount}</b></span>
    <span class="pill">完了：<b>${doneCount}</b></span>
    <span class="pill">合計：<b>${taskState.tasks.length}</b></span>
  `;

  if(tasks.length === 0){
    list.innerHTML = `<div class="muted" style="padding:10px;">表示できるタスクがありません</div>`;
    return;
  }

  list.innerHTML = tasks.map(t => {
    const next = getNextDue(t);
    const dueText = t.due ? `期限：${t.due}` : (next ? `次回：${isoDate(next)}` : "期限なし");
    const repText = t.repeat ? repeatSummary(t.repeat) : "";
    const priClass = t.priority === "高" ? "pri-high" : (t.priority === "低" ? "pri-low" : "");

    return `
      <div class="card ${t.done ? "done":""}" data-id="${t.id}">
        <div class="card-left">
          <input class="chk" type="checkbox" ${t.done ? "checked":""} aria-label="done toggle" />
          <div>
            <h3>${escapeHtml(t.title)}</h3>
            <div class="meta">
              ${t.assignee ? `<span class="tag">${escapeHtml(t.assignee)}</span>` : `<span class="tag">担当なし</span>`}
              <span class="tag">${escapeHtml(t.category)}</span>
              <span class="tag ${priClass}">優先：${escapeHtml(t.priority)}</span>
              <span class="tag">${escapeHtml(dueText)}</span>
              ${repText ? `<span class="tag">${escapeHtml(repText)}</span>` : ``}
            </div>
            ${t.note ? `<div class="note">${escapeHtml(t.note)}</div>` : ``}
          </div>
        </div>

        <div class="card-right">
          <button class="iconbtn" data-act="edit">編集</button>
          <button class="iconbtn danger" data-act="del">削除</button>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".card").forEach(card=>{
    const id = card.dataset.id;

    card.querySelector(".chk").addEventListener("change", (e)=>{
      const t = taskState.tasks.find(x=>x.id===id);
      if(!t) return;

      const wasDone = t.done;
      t.done = e.target.checked;

      // recurring: if just turned done => create next instance
      if(!wasDone && t.done){
        onCompleteRecurring(t);
      }

      saveTasksInMemory();
      updateHints();
      renderTasks();
    });

    card.querySelectorAll("button").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const act = btn.dataset.act;
        if(act==="edit") openEdit(id);
        if(act==="del") delTask(id);
      });
    });
  });
}
function addTask(task){
  taskState.tasks.unshift(task);
  saveTasksInMemory();
  updateHints();
  renderTasks();
}
function delTask(id){
  taskState.tasks = taskState.tasks.filter(t=>t.id !== id);
  saveTasksInMemory();
  updateHints();
  renderTasks();
}

/* ===== Edit Dialog (Tasks) ===== */
function openEdit(id){
  const t = taskState.tasks.find(x=>x.id===id);
  if(!t) return;
  $("#eId").value = t.id;
  $("#eTitle").value = t.title;
  $("#eAssignee").value = t.assignee || "";
  $("#eCategory").value = t.category;
  $("#eDue").value = t.due || "";
  $("#ePriority").value = t.priority;
  $("#eNote").value = t.note || "";

  const rep = t.repeat;
  const on = !!rep && rep.freq==="weekly";
  $("#eRepeatOn").checked = on;
  $("#eRepeatWeekly").classList.toggle("show", on);

  // set weekday checks
  document.querySelectorAll(".ewd").forEach(x=>x.checked=false);
  if(on){
    const set = new Set(rep.byweekday || []);
    document.querySelectorAll(".ewd").forEach(x=>{
      if(set.has(x.value)) x.checked = true;
    });
    $("#eRepeatStart").value = rep.startDate || "";
  }else{
    $("#eRepeatStart").value = "";
  }

  $("#editDialog").showModal();
}
function closeEdit(){ $("#editDialog").close(); }

/* ===================== Finance ===================== */
function saveFinanceInMemory(){
  financeState.updatedAt = new Date().toISOString();
}
function inRange(dateStr, fromStr, toStr){
  if(!dateStr) return true;
  const d = new Date(dateStr).getTime();
  if(fromStr){
    const f = new Date(fromStr).getTime();
    if(d < f) return false;
  }
  if(toStr){
    const t = new Date(toStr).getTime();
    if(d > t) return false;
  }
  return true;
}
function getRange(){
  const from = $("#fromDate").value;
  const to = $("#toDate").value;
  return { from, to };
}
function calcSettlement(payments){
  // two-person settlement based on "payer" and "split"
  // We infer "me" and "partner" names from payer hints (free-form),
  // but settlement needs two main people. We'll compute net per person and show transfers.
  // For simplicity: show net balances for all payer names.
  const net = new Map(); // + means should receive, - means should pay
  const addNet = (name, delta)=> net.set(name, (net.get(name)||0) + delta);

  payments.forEach(p=>{
    const amount = Number(p.amount)||0;
    const payer = p.payer || "不明";
    addNet(payer, amount); // payer paid

    if(p.split === "both"){
      // both owe half each -> subtract half from everyone equally.
      // This requires knowing "two people". We'll split across: payer + (the other main person)
      // We'll detect top 2 frequent payers as the couple.
    }
  });

  // Determine couple as top 2 frequent payer names
  const freq = new Map();
  payments.forEach(p=>{
    const name = p.payer || "不明";
    freq.set(name, (freq.get(name)||0) + 1);
  });
  const couple = [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>x[0]);
  const [A,B] = couple;

  // If we don't have 2 people yet, return simple totals
  if(!A || !B){
    return { couple, transfers: [], totalsByPayer: net };
  }

  // Recalculate net properly for A,B
  const net2 = new Map([[A,0],[B,0]]);
  const add2 = (name, delta)=> net2.set(name, (net2.get(name)||0) + delta);

  payments.forEach(p=>{
    const amount = Number(p.amount)||0;
    const payer = p.payer || "不明";
    // payer pays amount
    if(payer===A || payer===B) add2(payer, amount);

    // allocate owed based on split
    if(p.split==="both"){
      add2(A, -amount/2);
      add2(B, -amount/2);
    }else if(p.split==="me"){
      // "me" means A (assume A is "私" side). If payer isn't A/B we ignore.
      add2(A, -amount);
    }else if(p.split==="partner"){
      add2(B, -amount);
    }
  });

  // if A positive and B negative -> B pays A that amount (and vice versa)
  const a = net2.get(A);
  const b = net2.get(B);
  const transfers = [];
  if(a > 0.5 && b < -0.5){
    transfers.push({ from: B, to: A, amount: Math.round(a) });
  }else if(b > 0.5 && a < -0.5){
    transfers.push({ from: A, to: B, amount: Math.round(b) });
  }

  return { couple:[A,B], transfers, totalsByPayer: net2 };
}

function renderFinance(){
  const { from, to } = getRange();
  const filtered = financeState.payments
    .filter(p=>inRange(p.date, from, to))
    .sort((a,b)=> (b.date||"").localeCompare(a.date||""));

  const total = filtered.reduce((s,p)=>s+(Number(p.amount)||0),0);
  $("#financeStats").innerHTML = `
    <span class="pill">件数：<b>${filtered.length}</b></span>
    <span class="pill">合計：<b>${Math.round(total).toLocaleString()}円</b></span>
    ${from||to ? `<span class="pill">期間：<b>${from||"—"} 〜 ${to||"—"}</b></span>` : ``}
  `;

  const settlement = calcSettlement(filtered);
  const [A,B] = settlement.couple || [];
  const aNet = A ? (settlement.totalsByPayer.get(A)||0) : 0;
  const bNet = B ? (settlement.totalsByPayer.get(B)||0) : 0;

  $("#settlement").innerHTML = `
    <h3>精算（自動）</h3>
    <div class="kv">
      <div><div class="k">ペア推定</div><div class="v">${escapeHtml(A||"—")} / ${escapeHtml(B||"—")}</div></div>
      <div><div class="k">差額（+は受取）</div><div class="v">${A?`${escapeHtml(A)}: ${Math.round(aNet).toLocaleString()}円 / ${escapeHtml(B)}: ${Math.round(bNet).toLocaleString()}円`:"記録が少ないため算出中"}</div></div>
    </div>
    <div class="sep"></div>
    <div>
      ${settlement.transfers.length
        ? settlement.transfers.map(t=>`<div class="v">${escapeHtml(t.from)} → ${escapeHtml(t.to)} に <b>${t.amount.toLocaleString()}円</b> 支払う</div>`).join("")
        : `<div class="muted">今は精算不要（またはデータ不足）</div>`
      }
      <div class="muted" style="margin-top:8px;">※対象が「ふたり（折半）」の支出は、推定ペア（よく出る支払者2名）で割っています。</div>
    </div>
  `;

  const payList = $("#payList");
  if(filtered.length===0){
    payList.innerHTML = `<div class="muted" style="padding:10px;">記録がありません</div>`;
    return;
  }

  payList.innerHTML = filtered.map(p=>`
    <div class="card" data-id="${p.id}">
      <div class="card-left">
        <div>
          <h3>${escapeHtml(p.category)}：${Number(p.amount).toLocaleString()}円</h3>
          <div class="meta">
            <span class="tag">${escapeHtml(p.date||"")}</span>
            <span class="tag">支払：${escapeHtml(p.payer||"")}</span>
            <span class="tag">対象：${escapeHtml(p.split==="both"?"ふたり":(p.split==="me"?"私":"彼"))}</span>
          </div>
          ${p.note ? `<div class="note">${escapeHtml(p.note)}</div>` : ``}
        </div>
      </div>
      <div class="card-right">
        <button class="iconbtn danger" data-act="delpay">削除</button>
      </div>
    </div>
  `).join("");

  payList.querySelectorAll(".card").forEach(card=>{
    const id = card.dataset.id;
    card.querySelector("button").addEventListener("click", ()=>{
      financeState.payments = financeState.payments.filter(x=>x.id!==id);
      saveFinanceInMemory();
      updateHints();
      renderFinance();
    });
  });
}

/* ===================== Export / Import ===================== */
function exportJson(obj, filename){
  const data = JSON.stringify(obj, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function importJson(file, onOk){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      onOk(data);
    }catch(e){
      alert("JSONの形式が正しくないみたい");
    }
  };
  reader.readAsText(file);
}

/* ===================== Wire UI ===================== */
function wireTaskRepeat(){
  const toggle = $("#fRepeatOn");
  const box = $("#repeatWeekly");
  toggle.addEventListener("change", ()=>{
    box.classList.toggle("show", toggle.checked);
    if(toggle.checked && !$("#fRepeatStart").value){
      $("#fRepeatStart").value = todayIso();
    }
  });

  const eToggle = $("#eRepeatOn");
  const eBox = $("#eRepeatWeekly");
  eToggle.addEventListener("change", ()=>{
    eBox.classList.toggle("show", eToggle.checked);
    if(eToggle.checked && !$("#eRepeatStart").value){
      $("#eRepeatStart").value = todayIso();
    }
  });
}

function wireTasksUI(){
  $("#taskForm").addEventListener("submit", (e)=>{
    e.preventDefault();
    const title = $("#fTitle").value.trim();
    if(!title) return;

    const assignee = $("#fAssignee").value.trim();
    const repeatOn = $("#fRepeatOn").checked;
    const byweekday = getSelectedWeekdays("#repeatWeekly .wd");
    const startDate = $("#fRepeatStart").value;

    const task = {
      id: toId("t"),
      title,
      assignee,
      category: $("#fCategory").value,
      due: $("#fDue").value,
      priority: $("#fPriority").value,
      note: $("#fNote").value.trim(),
      done: false,
      createdAt: new Date().toISOString()
    };

    if(repeatOn && byweekday.length){
      task.repeat = { freq:"weekly", byweekday, startDate: startDate || todayIso() };
      // If due empty, show next occurrence sorting properly (computed)
    }

    addTask(task);
    e.target.reset();
    $("#fCategory").value = "家事";
    $("#fPriority").value = "中";
    $("#repeatWeekly").classList.remove("show");
  });

  $("#btnReset").addEventListener("click", ()=> $("#taskForm").reset());

  ["#q","#filterStatus","#filterAssignee","#filterCategory","#sortBy"].forEach(sel=>{
    $(sel).addEventListener("input", renderTasks);
    $(sel).addEventListener("change", renderTasks);
  });

  // edit dialog
  $("#btnCancelEdit").addEventListener("click", closeEdit);
  $("#editForm").addEventListener("submit", (e)=>{
    e.preventDefault();
    const id = $("#eId").value;
    const t = taskState.tasks.find(x=>x.id===id);
    if(!t) return;

    t.title = $("#eTitle").value.trim();
    t.assignee = $("#eAssignee").value.trim();
    t.category = $("#eCategory").value;
    t.due = $("#eDue").value;
    t.priority = $("#ePriority").value;
    t.note = $("#eNote").value.trim();

    const on = $("#eRepeatOn").checked;
    const by = getSelectedWeekdays("#eRepeatWeekly .ewd");
    const start = $("#eRepeatStart").value;

    if(on && by.length){
      t.repeat = { freq:"weekly", byweekday: by, startDate: start || todayIso() };
    }else{
      delete t.repeat;
    }

    saveTasksInMemory();
    updateHints();
    closeEdit();
    renderTasks();
  });

  // export/import
  $("#btnExportTasks").addEventListener("click", ()=>exportJson(taskState, "tasks.json"));
  $("#fileImportTasks").addEventListener("change", (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    importJson(file, (data)=>{
      if(!data.tasks || !Array.isArray(data.tasks)) return alert("tasks配列が必要です");
      taskState = data;
      saveTasksInMemory();
      updateHints();
      renderTasks();
    });
    e.target.value = "";
  });
}

function wireFinanceUI(){
  $("#financeForm").addEventListener("submit", (e)=>{
    e.preventDefault();
    const date = $("#pDate").value;
    const amount = Number($("#pAmount").value);
    const payer = $("#pPayer").value.trim();
    if(!date || !payer || !(amount>=0)) return;

    financeState.payments.unshift({
      id: toId("p"),
      date,
      amount,
      payer,
      split: $("#pSplit").value,
      category: $("#pCategory").value,
      note: $("#pNote").value.trim()
    });

    saveFinanceInMemory();
    updateHints();
    renderFinance();
    e.target.reset();
    $("#pDate").value = todayIso();
    $("#pSplit").value = "both";
    $("#pCategory").value = "食費";
  });

  $("#btnResetPay").addEventListener("click", ()=> $("#financeForm").reset());

  $("#btnExportFinance").addEventListener("click", ()=>exportJson(financeState, "finance.json"));
  $("#fileImportFinance").addEventListener("change", (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    importJson(file, (data)=>{
      if(!data.payments || !Array.isArray(data.payments)) return alert("payments配列が必要です");
      financeState = data;
      saveFinanceInMemory();
      updateHints();
      renderFinance();
    });
    e.target.value = "";
  });

  // range filters
  ["#fromDate","#toDate"].forEach(sel=>{
    $(sel).addEventListener("change", renderFinance);
  });
  $("#btnThisMonth").addEventListener("click", ()=>{
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth()+1, 0);
    $("#fromDate").value = isoDate(from);
    $("#toDate").value = isoDate(to);
    renderFinance();
  });
  $("#btnClearRange").addEventListener("click", ()=>{
    $("#fromDate").value = "";
    $("#toDate").value = "";
    renderFinance();
  });

  // init date
  $("#pDate").value = todayIso();
}

/* ===================== Boot ===================== */
async function boot(){
  wireTabs();
  wireTaskRepeat();

  taskState = await loadJson("./tasks.json", taskState);
  financeState = await loadJson("./finance.json", financeState);

  updateHints();
  wireTasksUI();
  wireFinanceUI();

  renderTasks();
  renderFinance();

  // show tasks tab by default
  $("#tab-tasks").classList.add("show");
  $("#tab-finance").classList.remove("show");
}
boot();
