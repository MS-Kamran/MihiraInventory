// ===== MIHIRA SALES PRICE LIST — MAIN SCRIPT =====

(() => {
  'use strict';

  // ===== CONFIG =====
  const SHEET_ID = '17ZJSpPDYqA9fqdod7g8DDwnVmOwk8frNzhcNh1MYFF0';
  const GID = '299415952';
  const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
  const STORAGE_KEY = 'mihira_sold_data';

  // ===== STATE =====
  let products = [];
  let filteredProducts = [];
  let currentFilter = 'all';
  let currentView = 'grid';
  let currentModalProduct = null;

  // ===== DOM REFS =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    contentArea: $('#contentArea'),
    loadingState: $('#loadingState'),
    productsGrid: $('#productsGrid'),
    tableWrapper: $('#tableWrapper'),
    tableBody: $('#tableBody'),
    searchInput: $('#searchInput'),
    filterGroup: $('#filterGroup'),
    saleModal: $('#saleModal'),
    modalPreview: $('#modalPreview'),
    saleQty: $('#saleQty'),
    saleHint: $('#saleHint'),
    toastContainer: $('#toastContainer'),
    statProducts: $('#statProducts'),
    statAvailable: $('#statAvailable'),
    statSold: $('#statSold'),
  };

  // ===== HELPERS =====

  /** Safely set innerHTML, handling TrustedTypes policies */
  const safePolicy = (typeof window.trustedTypes !== 'undefined' && window.trustedTypes.createPolicy)
    ? window.trustedTypes.createPolicy('mihira', { createHTML: (s) => s })
    : null;

  function safeSetHTML(el, html) {
    if (safePolicy) {
      el.innerHTML = safePolicy.createHTML(html);
    } else {
      el.innerHTML = html;
    }
  }

  /** Convert Google Drive share link to viewable thumbnail */
  function driveThumb(link) {
    if (!link) return null;
    // Extract file ID from various Drive URL formats
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]+)/,
      /id=([a-zA-Z0-9_-]+)/,
      /\/d\/([a-zA-Z0-9_-]+)/,
    ];
    for (const pattern of patterns) {
      const m = link.match(pattern);
      if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w400`;
    }
    return null;
  }

  /** Parse CSV text into array of arrays */
  function parseCSV(text) {
    const rows = [];
    let current = '';
    let inQuotes = false;
    let row = [];

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row.push(current.trim());
          current = '';
        } else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(current.trim());
          if (row.some(c => c !== '')) rows.push(row);
          row = [];
          current = '';
        } else {
          current += ch;
        }
      }
    }
    // Last row
    row.push(current.trim());
    if (row.some(c => c !== '')) rows.push(row);
    return rows;
  }

  /** Get sold data from localStorage */
  function getSoldData() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  /** Save sold data to localStorage */
  function saveSoldData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  /** Get sold count for a product row key */
  function getSoldCount(key) {
    return getSoldData()[key] || 0;
  }

  /** Set sold count for a product row key */
  function setSoldCount(key, count) {
    const data = getSoldData();
    data[key] = count;
    saveSoldData(data);
  }

  /** Make a unique key for a product row */
  function productKey(p) {
    return `${p.serial}_${p.category}_${p.color}_${p.size}`;
  }

  /** Format number as currency */
  function formatPrice(n) {
    if (isNaN(n) || n === '' || n === null || n === undefined) return '—';
    return '৳' + Number(n).toLocaleString('en-BD');
  }

  /** Show a toast notification */
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    safeSetHTML(toast, message);
    els.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ===== DATA FETCHING =====

  async function fetchData() {
    els.contentArea.style.display = '';
    els.loadingState.style.display = '';
    els.productsGrid.style.display = 'none';
    els.tableWrapper.style.display = 'none';

    try {
      const resp = await fetch(CSV_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const rows = parseCSV(text);

      if (rows.length < 2) throw new Error('No data found');

      // Header is first row
      const headers = rows[0];
      products = [];

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r[0] && !r[1] && !r[2]) continue; // Skip empty rows

        const serial = r[0] || '';
        const category = r[1] || '';
        const color = r[2] || '';
        const link = r[3] || '';
        const size = r[5] || '';
        const setQty = r[6] || '';
        const churiInSet = r[7] || '';
        // Columns I, J are hidden — skip index 8, 9
        const sellingPrice = r[10] || '';
        const newPrice = r[11] || '';
        const discountPrice = r[12] || '';
        const sheetSold = r[13] || '';
        const availableSets = r[14] || '';

        const key = `${serial}_${category}_${color}_${size}`;

        products.push({
          serial,
          category,
          color,
          link,
          thumb: driveThumb(link),
          size,
          setQty: parseInt(setQty) || 0,
          churiInSet: parseInt(churiInSet) || 0,
          sellingPrice: parseFloat(sellingPrice) || 0,
          newPrice: parseFloat(newPrice) || 0,
          discountPrice: parseFloat(discountPrice) || 0,
          sheetSold: parseInt(sheetSold) || 0,
          sheetAvailable: parseInt(availableSets) || 0,
          key,
        });
      }

      buildCategoryFilters();
      applyFilters();
      updateStats();

      els.contentArea.style.display = 'none';
      showView(currentView);
      showToast('✅ Products loaded successfully', 'success');

    } catch (err) {
      console.error('Fetch error:', err);
      els.loadingState.style.display = 'none';
      safeSetHTML(els.contentArea, `
        <div class="error-container">
          <div class="error-icon">⚠️</div>
          <div class="error-message">Failed to load data</div>
          <div class="error-hint">
            Make sure the spreadsheet is published to the web.<br>
            Go to <b>File → Share → Publish to web</b> in Google Sheets,<br>
            select "PRICE LIST" sheet and "CSV" format, then click Publish.<br><br>
            <small>Error: ${err.message}</small>
          </div>
          <button class="btn btn-primary" onclick="location.reload()">⟳ Try Again</button>
        </div>`);
    }
  }

  // ===== CATEGORY FILTERS =====

  function buildCategoryFilters() {
    const cats = [...new Set(products.map(p => p.category).filter(Boolean))];
    let html = '<button class="filter-btn active" data-filter="all">All</button>';
    cats.forEach(cat => {
      html += `<button class="filter-btn" data-filter="${cat}">${cat}</button>`;
    });
    safeSetHTML(els.filterGroup, html);

    els.filterGroup.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        els.filterGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        applyFilters();
      });
    });
  }

  // ===== FILTERING & SEARCH =====

  function applyFilters() {
    const query = els.searchInput.value.toLowerCase().trim();

    filteredProducts = products.filter(p => {
      // Category filter
      if (currentFilter !== 'all' && p.category !== currentFilter) return false;
      // Search query
      if (query) {
        const haystack = `${p.serial} ${p.category} ${p.color} ${p.size}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    renderGrid();
    renderTable();
    updateStats();
  }

  // ===== RENDER GRID =====

  function renderGrid() {
    if (filteredProducts.length === 0) {
      safeSetHTML(els.productsGrid, `
        <div class="no-results" style="grid-column: 1 / -1;">
          <div class="no-results-icon">🔍</div>
          <div class="no-results-text">No products found</div>
          <div class="no-results-hint">Try adjusting your search or filter</div>
        </div>`);
      return;
    }

    let html = '';
    filteredProducts.forEach((p, i) => {
      const sold = getSoldCount(p.key) + p.sheetSold;
      const available = Math.max(0, p.setQty - sold);
      const stockClass = available === 0 ? 'stock-out' : available <= 2 ? 'stock-low' : 'stock-in';
      const stockLabel = available === 0 ? 'Out of Stock' : available <= 2 ? 'Low Stock' : 'In Stock';

      html += `
        <div class="product-card" style="animation-delay: ${i * 0.04}s">
          <div class="product-image-wrapper">
            ${p.thumb
              ? `<img class="product-image" src="${p.thumb}" alt="${p.category} ${p.color}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'product-image-placeholder\\'>📸</div>'">`
              : '<div class="product-image-placeholder">📸</div>'}
            <span class="product-badge badge-category">${p.category || 'N/A'}</span>
            <span class="stock-badge ${stockClass}">${stockLabel}</span>
          </div>
          <div class="product-info">
            <div class="product-header">
              <div class="product-name">${p.category} — ${p.color}</div>
              <div class="product-serial">#${p.serial}</div>
            </div>
            <div class="product-details">
              <div class="detail-item">
                <span class="detail-label">Size</span>
                <span class="detail-value">${p.size || '—'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Sets Qty</span>
                <span class="detail-value">${p.setQty}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Churi/Set</span>
                <span class="detail-value">${p.churiInSet}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Available</span>
                <span class="detail-value" style="color: ${available === 0 ? 'var(--danger, #ef4444)' : '#10b981'}">${available}</span>
              </div>
            </div>
            <div class="price-section">
              <span class="current-price">${formatPrice(p.discountPrice || p.sellingPrice)}</span>
              ${p.newPrice && p.newPrice !== p.sellingPrice
                ? `<span class="original-price">${formatPrice(p.newPrice)}</span>`
                : ''}
              ${p.discountPrice ? '<span class="discount-tag">16% OFF</span>' : ''}
            </div>
            <div class="product-footer">
              <button class="btn btn-primary" onclick="window.mihira.openSale('${p.key}')">
                🛒 Record Sale
              </button>
              ${p.link ? `<a class="btn" href="${p.link}" target="_blank" rel="noopener">🖼 View Image</a>` : ''}
            </div>
          </div>
        </div>`;
    });

    safeSetHTML(els.productsGrid, html);
  }

  // ===== RENDER TABLE =====

  function renderTable() {
    if (filteredProducts.length === 0) {
      safeSetHTML(els.tableBody, `
        <tr>
          <td colspan="11" style="text-align:center; padding: 40px; color: var(--text-muted);">
            No products found
          </td>
        </tr>`);
      return;
    }

    let html = '';
    filteredProducts.forEach(p => {
      const sold = getSoldCount(p.key) + p.sheetSold;
      const available = Math.max(0, p.setQty - sold);
      const stockClass = available === 0 ? 'stock-out' : available <= 2 ? 'stock-low' : 'stock-in';

      html += `
        <tr>
          <td>${p.serial}</td>
          <td>
            <div class="table-product-info">
              ${p.thumb ? `<img class="table-image" src="${p.thumb}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
              <div>
                <div class="table-product-name">${p.category}</div>
                <div class="table-product-color">${p.color}</div>
              </div>
            </div>
          </td>
          <td>${p.size}</td>
          <td>${p.setQty}</td>
          <td>${p.churiInSet}</td>
          <td class="table-price">${formatPrice(p.sellingPrice)}</td>
          <td class="table-price">${formatPrice(p.newPrice)}</td>
          <td class="table-price">${formatPrice(p.discountPrice)}</td>
          <td><span style="font-weight:600; color: var(--warning);">${sold}</span></td>
          <td><span class="table-stock ${stockClass}">${available}</span></td>
          <td>
            <button class="btn btn-primary" style="padding:6px 14px; font-size:0.78rem;" onclick="window.mihira.openSale('${p.key}')">
              🛒 Sell
            </button>
          </td>
        </tr>`;
    });

    safeSetHTML(els.tableBody, html);
  }

  // ===== VIEW TOGGLE =====

  function showView(view) {
    currentView = view;
    if (view === 'grid') {
      els.productsGrid.style.display = '';
      els.tableWrapper.style.display = 'none';
      $('#viewGrid').classList.add('active');
      $('#viewTable').classList.remove('active');
    } else {
      els.productsGrid.style.display = 'none';
      els.tableWrapper.style.display = 'block';
      $('#viewGrid').classList.remove('active');
      $('#viewTable').classList.add('active');
    }
  }

  // ===== STATS =====

  function updateStats() {
    const list = filteredProducts.length ? filteredProducts : products;
    let totalProducts = list.length;
    let totalSold = 0;
    let totalAvailable = 0;
    let revenue = 0;

    list.forEach(p => {
      const sold = getSoldCount(p.key) + p.sheetSold;
      const avail = Math.max(0, p.setQty - sold);
      totalSold += sold;
      totalAvailable += avail;
      revenue += sold * (p.discountPrice || p.sellingPrice);
    });

    animateCounter(els.statProducts, totalProducts);
    animateCounter(els.statAvailable, totalAvailable);
    animateCounter(els.statSold, totalSold);
  }

  function animateCounter(el, target) {
    const current = parseInt(el.textContent) || 0;
    if (current === target) { el.textContent = target; return; }
    const diff = target - current;
    const duration = 500;
    const steps = 20;
    const increment = diff / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      if (step >= steps) {
        el.textContent = target;
        clearInterval(timer);
      } else {
        el.textContent = Math.round(current + increment * step);
      }
    }, duration / steps);
  }

  // ===== SALE MODAL =====

  function openSaleModal(key) {
    const p = products.find(x => x.key === key);
    if (!p) return;
    currentModalProduct = p;
    const sold = getSoldCount(p.key) + p.sheetSold;
    const available = Math.max(0, p.setQty - sold);

    safeSetHTML(els.modalPreview, `
      ${p.thumb ? `<img class="modal-product-img" src="${p.thumb}" alt="">` : ''}
      <div class="modal-product-details">
        <h4>${p.category} — ${p.color}</h4>
        <p>Size: ${p.size} | Serial: #${p.serial} | Price: ${formatPrice(p.discountPrice || p.sellingPrice)}</p>
      </div>`);

    els.saleHint.textContent = `Available: ${available} sets | Already sold: ${sold}`;
    els.saleQty.value = '';
    els.saleQty.max = available;
    els.saleModal.classList.add('active');
    setTimeout(() => els.saleQty.focus(), 200);
  }

  function closeSaleModal() {
    els.saleModal.classList.remove('active');
    currentModalProduct = null;
  }

  function confirmSale() {
    if (!currentModalProduct) return;
    const p = currentModalProduct;
    const qty = parseInt(els.saleQty.value);

    if (isNaN(qty) || qty <= 0) {
      showToast('⚠️ Please enter a valid quantity', 'error');
      return;
    }

    const currentSold = getSoldCount(p.key);
    const totalSoldAfter = currentSold + p.sheetSold + qty;
    const available = p.setQty - totalSoldAfter;

    if (available < 0) {
      showToast('⚠️ Not enough stock available!', 'error');
      return;
    }

    setSoldCount(p.key, currentSold + qty);
    closeSaleModal();
    applyFilters();
    showToast(`✅ Recorded ${qty} set(s) sold for ${p.category} ${p.color} (Size ${p.size})`, 'success');
  }

  // ===== COPY SOLD DATA =====

  function copySoldData() {
    const soldData = getSoldData();
    if (Object.keys(soldData).length === 0) {
      showToast('ℹ️ No sold data to copy', 'info');
      return;
    }

    let text = 'Mihira Sales — Sold Items Report\n';
    text += '================================\n\n';
    text += 'Serial | Category | Color | Size | Qty Sold\n';
    text += '-------|----------|-------|------|---------\n';

    for (const [key, count] of Object.entries(soldData)) {
      if (count <= 0) continue;
      const parts = key.split('_');
      const serial = parts[0] || '';
      const category = parts[1] || '';
      const color = parts[2] || '';
      const size = parts[3] || '';
      text += `${serial} | ${category} | ${color} | ${size} | ${count}\n`;
    }

    navigator.clipboard.writeText(text).then(() => {
      showToast('📋 Sold data copied to clipboard!', 'success');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('📋 Sold data copied to clipboard!', 'success');
    });
  }

  // ===== RESET SOLD DATA =====

  function resetSoldData() {
    if (!confirm('Are you sure you want to reset all sold tracking data? This cannot be undone.')) return;
    localStorage.removeItem(STORAGE_KEY);
    applyFilters();
    showToast('🔄 Sold data has been reset', 'info');
  }

  // ===== EVENT LISTENERS =====

  function init() {
    // Search
    els.searchInput.addEventListener('input', debounce(applyFilters, 300));

    // View toggle
    $('#viewGrid').addEventListener('click', () => showView('grid'));
    $('#viewTable').addEventListener('click', () => showView('table'));

    // Modal
    $('#modalClose').addEventListener('click', closeSaleModal);
    $('#modalCancel').addEventListener('click', closeSaleModal);
    $('#modalConfirm').addEventListener('click', confirmSale);
    els.saleModal.addEventListener('click', (e) => {
      if (e.target === els.saleModal) closeSaleModal();
    });

    // Enter key in modal
    els.saleQty.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmSale();
    });

    // Header buttons
    $('#btnCopySold').addEventListener('click', copySoldData);
    $('#btnResetSold').addEventListener('click', resetSoldData);
    $('#btnRefresh').addEventListener('click', () => {
      showToast('⟳ Refreshing data...', 'info');
      fetchData();
    });

    // Expose to global for onclick handlers
    window.mihira = { openSale: openSaleModal };

    // Initial load
    fetchData();
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
