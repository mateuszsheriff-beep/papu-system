// 1. INICJALIZACJA SUPABASE (Zmień na swoje klucze z Settings -> API w Supabase)
const SUPABASE_URL = 'https://TWÓJ_PROJEKT.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrY3pkemR5eWRjeHBwc3RrcXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MTA3NTMsImV4cCI6MjA5Nzk4Njc1M30.HSDRUEze1HD33Muv7krdTxn3F_AftfGrm9kJC63Q5sE';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let currentTable = null;
let currentOrderId = null;
let currentOrderTotal = 0;

// Zegar i Data
setInterval(() => {
    const now = new Date();
    const timeStr = now.toLocaleString('pl-PL');
    if(document.getElementById('datetime')) document.getElementById('datetime').innerText = timeStr;
    if(document.getElementById('clock')) document.getElementById('clock').innerText = timeStr;
}, 1000);

// --- LOGOWANIE ---
async function login() {
    const username = document.getElementById('username').value;
    const pin = document.getElementById('pin').value;

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .eq('pin_code', pin)
        .single();

    if (error || !data) {
        alert('Błędne dane logowania!');
        return;
    }

    currentUser = data;
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');
    document.getElementById('user-info').innerText = `Zalogowano jako: ${currentUser.username} (${currentUser.role})`;

    loadRoleView(currentUser.role);
}

function logout() {
    currentUser = null;
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('app-view').classList.add('hidden');
    document.getElementById('username').value = '';
    document.getElementById('pin').value = '';
}

function loadRoleView(role) {
    document.getElementById('waiter-panel').classList.add('hidden');
    document.getElementById('kitchen-panel').classList.add('hidden');
    document.getElementById('boss-panel').classList.add('hidden');

    if (role === 'waiter') {
        document.getElementById('waiter-panel').classList.remove('hidden');
        loadTablesForWaiter();
        loadMenu();
    } else if (role === 'cook') {
        document.getElementById('kitchen-panel').classList.remove('hidden');
        loadKitchenOrders();
    } else if (role === 'boss') {
        document.getElementById('boss-panel').classList.remove('hidden');
        loadBossPanel();
    }
}

// --- SYSTEM KELNERA ---
async function loadTablesForWaiter() {
    const { data, error } = await supabase.from('restaurant_tables').select('*').order('table_number');
    const grid = document.getElementById('tables-grid');
    grid.innerHTML = '';
    data.forEach(table => {
        const btn = document.createElement('button');
        btn.className = `table-btn ${table.status === 'occupied' ? 'occupied' : ''}`;
        btn.innerText = `Stół ${table.table_number}`;
        btn.onclick = () => openTable(table);
        grid.appendChild(btn);
    });
}

async function loadMenu() {
    const { data } = await supabase.from('menu').select('*');
    const select = document.getElementById('menu-select');
    select.innerHTML = '';
    data.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.dataset.price = item.price;
        opt.innerText = `${item.name} - ${item.price} zł`;
        select.appendChild(opt);
    });
}

async function openTable(table) {
    currentTable = table;
    document.getElementById('order-modal').classList.remove('hidden');
    document.getElementById('selected-table-title').innerText = `Obsługa: Stół ${table.table_number}`;
    
    // Sprawdź czy jest aktywne zamówienie
    const { data } = await supabase.from('orders').select('*').eq('table_id', table.id).eq('status', 'new').single();
    
    if (data) {
        currentOrderId = data.id;
        currentOrderTotal = data.total_amount;
    } else {
        // Stwórz nowe zamówienie
        const { data: newOrder } = await supabase.from('orders').insert([{ table_id: table.id, waiter_id: currentUser.id }]).select().single();
        currentOrderId = newOrder.id;
        currentOrderTotal = 0;
        await supabase.from('restaurant_tables').update({ status: 'occupied' }).eq('id', table.id);
        loadTablesForWaiter();
    }
    refreshOrderList();
}

async function addDishToOrder() {
    const select = document.getElementById('menu-select');
    const menuId = select.value;
    const price = parseFloat(select.options[select.selectedIndex].dataset.price);
    const notes = document.getElementById('special-request').value;

    await supabase.from('order_items').insert([{ order_id: currentOrderId, menu_id: menuId, special_requests: notes }]);
    
    currentOrderTotal += price;
    await supabase.from('orders').update({ total_amount: currentOrderTotal }).eq('id', currentOrderId);
    
    document.getElementById('special-request').value = '';
    refreshOrderList();
}

async function refreshOrderList() {
    const { data } = await supabase.from('order_items').select('*, menu(*)').eq('order_id', currentOrderId);
    const list = document.getElementById('current-order-list');
    list.innerHTML = '';
    data.forEach(item => {
        list.innerHTML += `<li>${item.menu.name} (Komentarz: ${item.special_requests || 'Brak'}) - Status kuchni: ${item.status}</li>`;
    });
    document.getElementById('total-price').innerText = currentOrderTotal.toFixed(2);
}

// --- SYSTEM PARAGONÓW I KASY ---
function calculateChange() {
    const total = currentOrderTotal;
    const tip = parseFloat(document.getElementById('tip-input').value || 0);
    const banknote = parseFloat(document.getElementById('banknote-input').value || 0);
    
    const finalTotal = total + tip;
    if (banknote >= finalTotal) {
        document.getElementById('change-due').innerText = (banknote - finalTotal).toFixed(2);
    } else {
        alert("Za mały banknot!");
    }
}

async function finalizeOrder() {
    const tip = parseFloat(document.getElementById('tip-input').value || 0);
    
    // Zakończ zamówienie
    await supabase.from('orders').update({ status: 'paid', tip: tip }).eq('id', currentOrderId);
    await supabase.from('restaurant_tables').update({ status: 'free' }).eq('id', currentTable.id);
    
    // Aktualizacja kasy (w dużym uproszczeniu: pobieramy dzisiejszy stan i dodajemy)
    const { data: cashData } = await supabase.from('cash_register').select('*').eq('work_date', new Date().toISOString().split('T')[0]).single();
    if(cashData) {
        await supabase.from('cash_register').update({ current_cash: parseFloat(cashData.current_cash) + currentOrderTotal }).eq('id', cashData.id);
    }

    document.getElementById('order-modal').classList.add('hidden');
    loadTablesForWaiter();
    alert('Rachunek zamknięty!');
}

// --- SYSTEM KUCHNI ---
async function loadKitchenOrders() {
    const { data } = await supabase.from('order_items').select('*, menu(*), orders(table_id)').in('status', ['pending', 'prep']);
    
    document.getElementById('k-new').innerHTML = '<h4>Oczekujące</h4>';
    document.getElementById('k-prep').innerHTML = '<h4>W przygotowaniu</h4>';
    
    data.forEach(item => {
        const div = document.createElement('div');
        div.innerHTML = `<strong>Stół ${item.orders.table_id}</strong>: ${item.menu.name} <br> <em>Uwagi: ${item.special_requests}</em> <br>`;
        
        const btn = document.createElement('button');
        if(item.status === 'pending') {
            btn.innerText = 'Gotuj';
            btn.onclick = () => updateKitchenStatus(item.id, 'prep');
            div.appendChild(btn);
            document.getElementById('k-new').appendChild(div);
        } else if (item.status === 'prep') {
            btn.innerText = 'Wydaj (Do odbioru)';
            btn.onclick = () => updateKitchenStatus(item.id, 'ready');
            div.appendChild(btn);
            document.getElementById('k-prep').appendChild(div);
        }
    });
}

async function updateKitchenStatus(itemId, status) {
    await supabase.from('order_items').update({ status: status }).eq('id', itemId);
    loadKitchenOrders(); // odśwież
}

// --- SYSTEM SZEFA (Edytor stołów i statystyki) ---
async function loadBossPanel() {
    // Pobierz notatki
    const { data: notes } = await supabase.from('notes').select('*');
    const ul = document.getElementById('notes-list');
    ul.innerHTML = '';
    notes.forEach(n => ul.innerHTML += `<li>${new Date(n.created_at).toLocaleDateString()}: ${n.content}</li>`);

    // Stan kasy
    const { data: cashData } = await supabase.from('cash_register').select('*').eq('work_date', new Date().toISOString().split('T')[0]).single();
    if(cashData) document.getElementById('current-cash-display').innerText = cashData.current_cash;

    // Pobieranie zamówień dla ilości klientów (jedno zamówienie = 1 stolik = grupa klientów)
    const { data: orders } = await supabase.from('orders').select('id').eq('status', 'paid');
    document.getElementById('daily-clients').innerText = orders ? orders.length : 0;

    // Załaduj wizualizację stołów (Drag and Drop)
    loadBossTables();
}

async function setStartCash() {
    const amount = document.getElementById('start-cash').value;
    await supabase.from('cash_register').insert([{ start_cash: amount, current_cash: amount }]);
    loadBossPanel();
}

async function addNote() {
    const content = document.getElementById('note-content').value;
    await supabase.from('notes').insert([{ author_id: currentUser.id, content: content }]);
    loadBossPanel();
}

// Logika Drag&Drop dla stolików
async function loadBossTables() {
    const { data } = await supabase.from('restaurant_tables').select('*');
    const container = document.getElementById('boss-tables');
    container.innerHTML = '';
    
    data.forEach(table => {
        const div = document.createElement('div');
        div.className = 'draggable-table';
        div.innerText = table.table_number;
        div.style.left = table.pos_x + 'px';
        div.style.top = table.pos_y + 'px';
        div.dataset.id = table.id;
        
        // Prosty system Drag
        div.onmousedown = function(e) {
            let shiftX = e.clientX - div.getBoundingClientRect().left;
            let shiftY = e.clientY - div.getBoundingClientRect().top;
            
            function moveAt(pageX, pageY) {
                div.style.left = pageX - shiftX - container.getBoundingClientRect().left + 'px';
                div.style.top = pageY - shiftY - container.getBoundingClientRect().top + 'px';
            }
            
            function onMouseMove(event) { moveAt(event.pageX, event.pageY); }
            document.addEventListener('mousemove', onMouseMove);
            
            div.onmouseup = function() {
                document.removeEventListener('mousemove', onMouseMove);
                div.onmouseup = null;
            };
        };
        div.ondragstart = function() { return false; };
        
        container.appendChild(div);
    });
}

async function saveTableLayout() {
    const tables = document.querySelectorAll('.draggable-table');
    for (let table of tables) {
        const id = table.dataset.id;
        const x = parseInt(table.style.left) || 0;
        const y = parseInt(table.style.top) || 0;
        await supabase.from('restaurant_tables').update({ pos_x: x, pos_y: y }).eq('id', id);
    }
    alert('Zapisano układ!');
}