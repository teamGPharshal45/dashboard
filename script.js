let packageData = [], classData = [], methodData = [], summaryData = [];
let currentPackage = null, currentClass = null;
let currentTab = 'all';
let currentSort = { key: null, order: 'asc' };
let currentLevel = 'package';    
let charts = {};

// ================= CSV Loader =================
async function loadCSV(file) {
    const res = await fetch(file);
    const text = await res.text();
    const rows = text.split('\n').filter(r => r.trim() !== '');
    if (rows.length === 0) return [];
    const headers = rows[0].split(',').map(h => h.trim());
    return rows.slice(1).map(row => {
        const cols = row.split(',');
        let obj = {};
        headers.forEach((h, i) => obj[h] = (cols[i] ?? '').trim());
        return obj;
    });
}

// ================= Helper Functions =================
function getCoverageClass(status = '') {
    switch (status.toLowerCase()) {
        case 'critical': return 'critical';
        case 'poor': return 'poor';
        case 'fair': return 'fair';
        case 'good': return 'good';
        case 'excellent': return 'excellent';
        default: return '';
    }
}

function showAlert(status = '') {
    const alertDiv = document.getElementById('alert');
    if (!status) { alertDiv.innerHTML = ''; return; }
    if (status.toLowerCase() === 'critical') {
        alertDiv.innerHTML = `<div class="alert alert-critical">⚠ Critical coverage! Add unit tests immediately.</div>`;
    } else if (status.toLowerCase() === 'poor') {
        alertDiv.innerHTML = `<div class="alert alert-poor">⚠ Poor coverage! Consider adding more tests.</div>`;
    } else {
        alertDiv.innerHTML = '';
    }
}

function updateBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    let html = `<span onclick="goHome()">Home</span>`;
    if (currentPackage) html += ` &gt; <span onclick="showPackage()">${currentPackage}</span>`;
    if (currentClass) html += ` &gt; <span onclick="showClass()">${currentClass}</span>`;
    bc.innerHTML = html;
}

function filterTab(tab, evt) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (evt && evt.target) evt.target.classList.add('active');
    currentTab = tab;
    goHome();
}

function findFieldKey(obj, regex) {
    if (!obj) return null;
    const keys = Object.keys(obj);
    for (let k of keys) {
        if (regex.test(k)) return k;
    }
    return null;
}

function parseNumberSafe(val) {
    if (val == null || val === '') return 0;
    const n = Number(String(val).replace(/[^0-9.-]+/g, ''));
    return isNaN(n) ? 0 : n;
}

function applySearchFilter(data) {
    const query = document.getElementById('searchBox').value.toLowerCase().trim();
    if (!query) return data;
    return data.filter(row => Object.values(row).some(val => String(val || '').toLowerCase().includes(query)));
}

function sortData(data, key) {
    if (!key) return data;
    if (currentSort.key === key) {
        currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.key = key;
        currentSort.order = 'asc';
    }
    const ord = currentSort.order === 'asc' ? 1 : -1;
    return data.sort((a, b) => {
        const x = a[key] ?? '';
        const y = b[key] ?? '';
        const xn = parseNumberSafe(x);
        const yn = parseNumberSafe(y);
        if (xn !== 0 || yn !== 0) {
            return (xn - yn) * ord;
        }
        return String(x).localeCompare(String(y)) * ord;
    });
}

function computeStats(data) {
    const coveredKey = findFieldKey(data[0] || {}, /covered/i);
    const missedKey = findFieldKey(data[0] || {}, /missed/i);
    let totalCovered = 0, totalMissed = 0;
    data.forEach(d => {
        totalCovered += parseNumberSafe(d[coveredKey]);
        totalMissed += parseNumberSafe(d[missedKey]);
    });
    const totalCoverage = (totalCovered + totalMissed) > 0 ? ((totalCovered / (totalCovered + totalMissed)) * 100) : 0;
    return { totalCoverage: Number(totalCoverage.toFixed(2)) };
}

// ================= Summary + Charts =================
function renderSummary() {
    const summary = document.getElementById('summary');
    summary.innerHTML = '';

    const totalPackages = packageData.length;
    const totalClasses = classData.length;
    const criticalPackages = packageData.filter(p => String(p['Status'] || '').toLowerCase() === 'critical').length;
    const totalCoverage = summaryData[0] ? parseNumberSafe(summaryData[0]['Total Coverage (%)']) : 0;

    summary.innerHTML = `
        <div class="summary-item"><strong>Packages:</strong> ${totalPackages}</div>
        <div class="summary-item"><strong>Classes:</strong> ${totalClasses}</div>
        <div class="summary-item"><strong>Critical:</strong> ${criticalPackages}</div>
        <div class="summary-item"><strong>Total Coverage:</strong> ${totalCoverage.toFixed(2)}%</div>
    `;

    renderSmallCharts(packageData);
}

function renderSmallCharts(baseData) {
    const statuses = ['Critical', 'Poor', 'Fair', 'Good', 'Excellent'];
    const counts = statuses.map(s => baseData.filter(p => String(p['Status'] || '').toLowerCase() === s.toLowerCase()).length);
    const totalCoverage = summaryData[0] ? parseNumberSafe(summaryData[0]['Total Coverage (%)']) : 0;

    Object.values(charts).forEach(c => { try { c.destroy(); } catch (e) {} });
    charts = {};

    const pkgCtx = document.getElementById('packageChart').getContext('2d');
    charts.package = new Chart(pkgCtx, {
        type: 'pie',
        data: {
            labels: statuses,
            datasets: [{
                data: counts,
                backgroundColor: ['#e53935','#fb8c00','#fbc02d','#43a047','#009688']
            }]
        },
        options: { plugins: { legend: { position: 'bottom' } }, maintainAspectRatio: false }
    });

    const avgCtx = document.getElementById('averageChart').getContext('2d');
    charts.average = new Chart(avgCtx, {
        type: 'doughnut',
        data: {
            labels: ['Total Coverage','Remaining'],
            datasets: [{
                data: [totalCoverage, Math.max(0, 100 - totalCoverage)],
                backgroundColor: ['#5c6bc0','#c5cae9']
            }]
        },
        options: { plugins: { legend: { position: 'bottom' } }, maintainAspectRatio: false }
    });
}

// ================= Table Rendering =================
function renderTable(data, level) {
    const container = document.getElementById('table-container');
    container.innerHTML = '';

    if (level === 'package') {
        if (currentTab === 'top') data = data.filter(p => parseNumberSafe(p['Instruction Coverage (%)']) >= 80);
        else if (currentTab === 'attention') data = data.filter(p => parseNumberSafe(p['Instruction Coverage (%)']) < 40);
    }

    data = applySearchFilter(data);
    if (!data.length) { container.innerHTML = '<p style="text-align:center;">No data to display</p>'; return; }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const keys = Object.keys(data[0]);

    keys.forEach(h => {
        const th = document.createElement('th');
        th.innerText = h;
        th.addEventListener('click', () => {
            data = sortData(data, h);
            renderTable(data, level);
            document.querySelectorAll('th').forEach(header => header.classList.remove('sort-asc','sort-desc'));
            th.classList.add(currentSort.order === 'asc' ? 'sort-asc' : 'sort-desc');
        });
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    data.forEach(row => {
        const tr = document.createElement('tr');
        keys.forEach(key => {
            const td = document.createElement('td');
            td.textContent = row[key];
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
}

// ================= Navigation =================
function goHome() {
    currentPackage = null;
    currentClass = null;
    updateBreadcrumb();
    renderSummary();
    renderTable(packageData, 'package');
}

// ================= Init =================
async function init() {
    document.getElementById('loader').style.display = 'flex';
    try {
        packageData = await loadCSV('package_report.csv');
        classData = await loadCSV('class_report.csv');
        methodData = await loadCSV('method_report.csv');
        summaryData = await loadCSV('summary.csv');

        renderSummary();
        renderTable(packageData, 'package');
    } catch (error) {
        console.error(error);
        document.getElementById('table-container').innerHTML = '<p style="text-align:center;color:red;">Error loading data.</p>';
    } finally {
        document.getElementById('loader').style.display = 'none';
    }
}

init();