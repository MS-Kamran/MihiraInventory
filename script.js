// ===== MIHIRA SALES PRICE LIST — MAIN SCRIPT =====

(() => {
  'use strict';

  // ===== CONFIG =====
  const SHEET_ID = '17ZJSpPDYqA9fqdod7g8DDwnVmOwk8frNzhcNh1MYFF0';
  const GID = '299415952';
  const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzy9NWqJDOd-Bae7sCny9HI6K7iJAp3i9As9wOfmOm9pglIWuNp_srhGszpdKcjuJUJjw/exec';
  const STORAGE_KEY = 'mihira_sold_data';
  const SEARCH_HISTORY_KEY = 'mihira_search_popularity';

  // ===== STATE =====
  let products = [];
  let filteredProducts = [];
  let currentFilter = 'all';
  let currentColorFilter = 'all';
  let currentSizeFilter = 'all';
  let currentStockFilter = 'all';
  let currentView = 'grid';
  let currentModalProduct = null;
  let isInitialLoad = true;

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
    colorFilterGroup: $('#colorFilterGroup'),
    sizeFilterGroup: $('#sizeFilterGroup'),
    stockFilterGroup: $('#stockFilterGroup'),
    categorySelect: $('#categorySelect'),
    colorSelect: $('#colorSelect'),
    sizeSelect: $('#sizeSelect'),
    stockSelect: $('#stockSelect'),
    saleModal: $('#saleModal'),
    modalTitle: $('#modalTitle'),
    modalPreview: $('#modalPreview'),
    saleQty: $('#saleQty'),
    qtyInputLabel: $('#qtyInputLabel'),
    saleHint: $('#saleHint'),
    toastContainer: $('#toastContainer'),
    statProducts: $('#statProducts'),
    statAvailable: $('#statAvailable'),
    statSold: $('#statSold'),
    statDailySales: $('#statDailySales'),
    btnClearFilters: $('#btnClearFilters'),
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
        const lastSaleDate = r[15] || '';

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
          lastSaleDate: lastSaleDate.trim(),
          key,
        });
      }

      buildCategoryFilters();
      applyFilters();
      updateStats();

      // After first load, disable initial load sorting
      isInitialLoad = false;

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
    const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
    
    let optionsHtml = '<option value="all">All Category</option>';
    cats.forEach(cat => {
      optionsHtml += `<option value="${cat}">${cat}</option>`;
    });
    
    safeSetHTML(els.categorySelect, optionsHtml);

    els.categorySelect.addEventListener('change', (e) => {
      currentFilter = e.target.value;
      buildColorFilters();
      applyFilters();
    });

    buildColorFilters();
  }

  function buildColorFilters() {
    const filtered = currentFilter === 'all' ? products : products.filter(p => p.category === currentFilter);
    const colors = [...new Set(filtered.map(p => p.color).filter(Boolean))].sort();
    
    let optionsHtml = '<option value="all">All Colors</option>';
    colors.forEach(color => {
      optionsHtml += `<option value="${color}">${color}</option>`;
    });
    
    safeSetHTML(els.colorSelect, optionsHtml);
    currentColorFilter = 'all';

    els.colorSelect.addEventListener('change', (e) => {
      currentColorFilter = e.target.value;
      buildSizeFilters();
      applyFilters();
    });

    buildSizeFilters();
  }

  function buildSizeFilters() {
    let filtered = products;
    if (currentFilter !== 'all') filtered = filtered.filter(p => p.category === currentFilter);
    if (currentColorFilter !== 'all') filtered = filtered.filter(p => p.color === currentColorFilter);
    
    const sizes = [...new Set(filtered.map(p => p.size).filter(Boolean))].sort();
    
    let optionsHtml = '<option value="all">All Sizes</option>';
    sizes.forEach(size => {
      optionsHtml += `<option value="${size}">${size}</option>`;
    });
    
    safeSetHTML(els.sizeSelect, optionsHtml);
    currentSizeFilter = 'all';

    els.sizeSelect.addEventListener('change', (e) => {
      currentSizeFilter = e.target.value;
      applyFilters();
    });
  }

  // ===== SEARCH POPULARITY TRACKING =====

  function getSearchPopularity() {
    try {
      return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function trackSearchPopularity(query, matchedProducts) {
    if (!query || matchedProducts.length === 0) return;
    const popularity = getSearchPopularity();
    matchedProducts.forEach(p => {
      popularity[p.key] = (popularity[p.key] || 0) + 1;
    });
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(popularity));
  }

  // ===== CLEAR ALL FILTERS =====

  function clearAllFilters() {
    currentFilter = 'all';
    currentColorFilter = 'all';
    currentSizeFilter = 'all';
    els.searchInput.value = '';

    els.categorySelect.value = 'all';
    els.colorSelect.value = 'all';
    els.sizeSelect.value = 'all';

    // Rebuild dependent filters
    buildColorFilters();
    applyFilters();
    showToast('✕ All filters cleared', 'info');
  }

  // ===== STOCK FILTERS =====
  function initStockFilters() {
    els.stockSelect.addEventListener('change', (e) => {
      currentStockFilter = e.target.value;
      applyFilters();
    });
  }

  // ===== FILTERING & SEARCH =====

  function applyFilters() {
    let query = els.searchInput.value.toLowerCase().trim();
    let prefixType = null;
    let prefixValue = null;

    // Detect smart search prefix
    if (query.startsWith('cat:')) {
      prefixType = 'category';
      prefixValue = query.substring(4).trim();
    } else if (query.startsWith('c:')) {
      prefixType = 'color';
      prefixValue = query.substring(2).trim();
    } else if (query.startsWith('s:')) {
      prefixType = 'size';
      prefixValue = query.substring(2).trim();
    }

    filteredProducts = products.filter(p => {
      // Category filter
      if (currentFilter !== 'all' && p.category !== currentFilter) return false;
      // Color filter
      if (currentColorFilter !== 'all' && p.color !== currentColorFilter) return false;
      // Size filter
      if (currentSizeFilter !== 'all' && p.size !== currentSizeFilter) return false;

      // Stock filter
      const sold = getSoldCount(p.key) + p.sheetSold;
      const available = Math.max(0, p.setQty - sold);
      if (currentStockFilter === 'in_stock' && available === 0) return false;
      if (currentStockFilter === 'low_stock' && (available > 2 || available === 0)) return false;
      if (currentStockFilter === 'out_of_stock' && available > 0) return false;

      // Search query
      if (query) {
        if (prefixType) {
          // Smart prefix search
          if (!p[prefixType].toLowerCase().includes(prefixValue)) return false;
        } else {
          // Standard global search
          const haystack = `${p.serial} ${p.category} ${p.color} ${p.size}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
      }
      return true;
    });

    // Track search popularity when user searches
    if (query) {
      trackSearchPopularity(query, filteredProducts);
    }

    // On initial load (no filters active), sort by search popularity
    if (isInitialLoad || (!query && currentFilter === 'all' && currentColorFilter === 'all' && currentSizeFilter === 'all')) {
      const popularity = getSearchPopularity();
      filteredProducts.sort((a, b) => (popularity[b.key] || 0) - (popularity[a.key] || 0));
    }

    renderGrid();
    renderTable();
    updateStats();
  }

  // ===== SEARCH SUGGESTIONS =====
  function showSuggestions() {
    const query = els.searchInput.value.toLowerCase().trim();
    const suggestionsEl = $('#searchSuggestions');
    
    if (!query) {
      suggestionsEl.style.display = 'none';
      return;
    }

    // Determine matching categories, colors, series
    const cats = [...new Set(products.filter(p => p.category.toLowerCase().includes(query)).map(p => p.category))].slice(0, 3);
    const colors = [...new Set(products.filter(p => p.color.toLowerCase().includes(query)).map(p => p.color))].slice(0, 3);
    const serials = [...new Set(products.filter(p => p.serial.toLowerCase().includes(query)).map(p => p.serial))].slice(0, 3);

    if (cats.length === 0 && colors.length === 0 && serials.length === 0) {
      suggestionsEl.style.display = 'none';
      return;
    }

    let html = '';
    
    cats.forEach(c => {
      html += `<div class="search-suggestion-item" data-val="${c}" data-type="category">
        <span class="suggestion-icon">📂</span> <span class="suggestion-text">Category: <b>${c}</b></span>
      </div>`;
    });
    
    colors.forEach(c => {
      html += `<div class="search-suggestion-item" data-val="${c}" data-type="color">
        <span class="suggestion-icon">🎨</span> <span class="suggestion-text">Color: <b>${c}</b></span>
      </div>`;
    });
    
    serials.forEach(s => {
      html += `<div class="search-suggestion-item" data-val="${s}" data-type="serial">
        <span class="suggestion-icon">#️⃣</span> <span class="suggestion-text">Serial: <b>${s}</b></span>
      </div>`;
    });

    safeSetHTML(suggestionsEl, html);
    suggestionsEl.style.display = 'block';

    // Click handler for suggestions
    suggestionsEl.querySelectorAll('.search-suggestion-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const val = item.dataset.val;
        els.searchInput.value = val;
        applyFilters();
        suggestionsEl.style.display = 'none';
      });
    });
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
              <div class="product-name"><span class="name-category">${p.category}</span> <span class="name-color">— ${p.color}</span></div>
              <div class="product-serial">#${p.serial}</div>
            </div>
            <div class="product-details">
              <div class="detail-item">
                <span class="detail-label">Size</span>
                <span class="detail-value detail-highlight-size">${p.size || '—'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Churi/Set</span>
                <span class="detail-value">${p.churiInSet}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Available</span>
                <span class="detail-value detail-highlight-avail ${available === 0 ? 'avail-out' : ''}">${available}</span>
              </div>
            </div>
            ${p.lastSaleDate ? `
            <div class="last-sale-date">
              <span class="last-sale-icon">📅</span>
              <span class="last-sale-text">Last Sale: ${p.lastSaleDate}</span>
            </div>` : ''}
            <div class="price-section">
              <span class="current-price">${formatPrice(p.discountPrice || p.sellingPrice)}</span>
              ${p.newPrice && p.newPrice !== p.sellingPrice
                ? `<span class="original-price">${formatPrice(p.newPrice)}</span>`
                : ''}
              ${p.discountPrice ? '<span class="discount-tag">16% OFF</span>' : ''}
            </div>
            <div class="product-footer" style="display: flex; gap: 4px;">
              <button class="btn btn-primary" style="flex: 1;" onclick="window.mihira.openSale('${p.key}')">
                🛒 Sell
              </button>
              <button class="btn btn-quick" onclick="window.mihira.quickSale('${p.key}', 1)" title="Quick Sale +1">+1</button>
              <button class="btn btn-quick" onclick="window.mihira.quickSale('${p.key}', -1)" title="Quick Return -1">-1</button>
              ${p.link ? `<a class="btn" style="flex: 0 0 32px; padding: 0; display: flex; align-items: center; justify-content: center;" href="${p.link}" target="_blank" rel="noopener" title="View Image">🖼</a>` : ''}
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
          <td><span class="table-last-sale">${p.lastSaleDate || '—'}</span></td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-primary" style="padding:6px 14px; font-size:0.78rem;" onclick="window.mihira.openSale('${p.key}')">
                🛒 Sell
              </button>
              <button class="btn btn-quick" style="padding:6px; font-size:0.75rem;" onclick="window.mihira.quickSale('${p.key}', 1)">+1</button>
              <button class="btn btn-quick" style="padding:6px; font-size:0.75rem;" onclick="window.mihira.quickSale('${p.key}', -1)">-1</button>
            </div>
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

  /** Get today's date string in common formats for comparison */
  function getTodayStrings() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    // Return multiple common formats for flexible matching
    return [
      `${yyyy}-${mm}-${dd}`,       // 2026-03-16
      `${dd}/${mm}/${yyyy}`,       // 16/03/2026
      `${mm}/${dd}/${yyyy}`,       // 03/16/2026
      `${dd}-${mm}-${yyyy}`,       // 16-03-2026
      `${mm}-${dd}-${yyyy}`,       // 03-16-2026
    ];
  }

  function updateStats() {
    const list = filteredProducts.length ? filteredProducts : products;
    let totalProducts = list.length;
    let totalSold = 0;
    let totalAvailable = 0;
    let dailySales = 0;

    const todayStrings = getTodayStrings();

    list.forEach(p => {
      const sold = getSoldCount(p.key) + p.sheetSold;
      const avail = Math.max(0, p.setQty - sold);
      totalSold += sold;
      totalAvailable += avail;

      // Count daily sales based on Last Sale Date matching today
      if (p.lastSaleDate) {
        const saleDate = p.lastSaleDate.trim();
        if (todayStrings.some(fmt => saleDate.includes(fmt))) {
          dailySales += sold;
        }
      }
    });

    animateCounter(els.statProducts, totalProducts);
    animateCounter(els.statAvailable, totalAvailable);
    animateCounter(els.statSold, totalSold);
    animateCounter(els.statDailySales, dailySales);
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
    
    // Reset toggle to Sale
    const saleRadio = document.querySelector('input[name="saleAction"][value="sale"]');
    if (saleRadio) saleRadio.checked = true;
    updateModalContext();

    setTimeout(() => els.saleQty.focus(), 200);
  }

  function updateModalContext() {
    if (!currentModalProduct) return;
    const isReturn = document.querySelector('input[name="saleAction"]:checked').value === 'return';
    const p = currentModalProduct;
    const sold = getSoldCount(p.key) + p.sheetSold;
    const available = Math.max(0, p.setQty - sold);

    if (isReturn) {
      els.modalTitle.textContent = '↩️ Record Return';
      els.qtyInputLabel.textContent = 'Quantity Returned (Sets)';
      els.saleHint.textContent = `Maximum you can return: ${sold} sets`;
      els.saleQty.max = sold;
    } else {
      els.modalTitle.textContent = '🛒 Record Sale';
      els.qtyInputLabel.textContent = 'Quantity Sold (Sets)';
      els.saleHint.textContent = `Available: ${available} sets | Already sold: ${sold}`;
      els.saleQty.max = available;
    }
  }

  // Listen to toggle changes
  document.querySelectorAll('input[name="saleAction"]').forEach(radio => {
    radio.addEventListener('change', updateModalContext);
  });

  function closeSaleModal() {
    els.saleModal.classList.remove('active');
    currentModalProduct = null;
  }

  async function confirmSale() {
    if (!currentModalProduct) return;
    const p = currentModalProduct;
    const qty = parseInt(els.saleQty.value);

    if (isNaN(qty) || qty <= 0) {
      showToast('⚠️ Please enter a valid quantity', 'error');
      return;
    }

    const isReturn = document.querySelector('input[name="saleAction"]:checked').value === 'return';

    // Disable confirm button and show loading
    const confirmBtn = $('#modalConfirm');
    const originalText = confirmBtn.textContent;
    confirmBtn.textContent = '⏳ Updating...';
    confirmBtn.disabled = true;

    // Validate logic based on action
    const currentSold = getSoldCount(p.key);
    const totalSoldAfter = currentSold + p.sheetSold + (isReturn ? -qty : qty);
    const available = p.setQty - totalSoldAfter;

    if (!isReturn && available < 0) {
      showToast('⚠️ Not enough stock available!', 'error');
      confirmBtn.textContent = originalText;
      confirmBtn.disabled = false;
      return;
    }

    if (isReturn && totalSoldAfter < 0) {
      showToast('⚠️ Cannot return more than total sold!', 'error');
      confirmBtn.textContent = originalText;
      confirmBtn.disabled = false;
      return;
    }

    try {
      // Send to Google Sheet via Apps Script
      // For returns, we send negative qty so the sheet logic can just add it
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial: p.serial,
          category: p.category,
          color: p.color,
          size: p.size,
          soldQty: isReturn ? -qty : qty,
          timestamp: new Date().toISOString(),
          date: new Date().toLocaleDateString('en-GB'),
          time: new Date().toLocaleTimeString('en-GB')
        })
      });

      // Also save to localStorage as backup
      setSoldCount(p.key, currentSold + (isReturn ? -qty : qty));
      closeSaleModal();
      applyFilters();
      
      const actionText = isReturn ? 'returned to stock' : 'sold';
      showToast(`✅ ${qty} set(s) ${actionText} for ${p.category} ${p.color} — Sheet updated!`, 'success');

    } catch (err) {
      console.error('Apps Script error:', err);
      // Still save locally even if sheet update fails
      setSoldCount(p.key, currentSold + qty);
      closeSaleModal();
      applyFilters();
      showToast(`⚠️ Saved locally but sheet update may have failed. Error: ${err.message}`, 'error');
    } finally {
      confirmBtn.textContent = originalText;
      confirmBtn.disabled = false;
    }
  }

  // ===== QUICK SALE (+1 / -1) =====

  async function performQuickSale(key, qty) {
    const p = products.find(x => x.key === key);
    if (!p) return;

    const isReturn = qty < 0;
    const absQty = Math.abs(qty);
    const currentSold = getSoldCount(p.key);
    const totalSoldAfter = currentSold + p.sheetSold + qty;
    const available = p.setQty - totalSoldAfter;

    if (!isReturn && available < 0) {
      showToast('⚠️ Not enough stock available for +1!', 'error');
      return;
    }

    if (isReturn && totalSoldAfter < 0) {
      showToast('⚠️ Cannot return more than total sold!', 'error');
      return;
    }

    const toastId = Math.random().toString(36).substring(7);
    const actionText = isReturn ? 'Return -1' : 'Sale +1';
    showToast(`⏳ Processing ${actionText} for ${p.category} ${p.color}...`, 'info');

    // Optimistically update UI immediately
    setSoldCount(p.key, currentSold + qty);
    applyFilters();

    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial: p.serial,
          category: p.category,
          color: p.color,
          size: p.size,
          soldQty: qty,
          timestamp: new Date().toISOString(),
          date: new Date().toLocaleDateString('en-GB'),
          time: new Date().toLocaleTimeString('en-GB')
        })
      });

      const successText = isReturn ? 'returned to stock' : 'sold';
      showToast(`✅ 1 set ${successText} for ${p.category} ${p.color} — Sheet updated!`, 'success');

    } catch (err) {
      console.error('Apps Script error on Quick Sale:', err);
      // It's still saved locally via optimistic update
      showToast(`⚠️ Local quick-save OK. Sheet update failed: ${err.message}`, 'error');
    }
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
    
    // Pull fresh data from sheet after reset
    isInitialLoad = true;
    showToast('🔄 Resetting tracking data and pooling fresh data from sheet...', 'info');
    fetchData();
  }

  // ===== EVENT LISTENERS =====

  function init() {
    initStockFilters();

    // Search
    els.searchInput.addEventListener('input', debounce(() => {
      applyFilters();
      showSuggestions();
    }, 300));
    
    // Hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrapper')) {
        const suggestionsEl = $('#searchSuggestions');
        if (suggestionsEl) suggestionsEl.style.display = 'none';
      }
    });

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
      isInitialLoad = true;
      showToast('⟳ Refreshing data...', 'info');
      fetchData();
    });

    // Clear filters button
    els.btnClearFilters.addEventListener('click', clearAllFilters);

    // Expose to global for onclick handlers
    window.mihira = { 
      openSale: openSaleModal,
      quickSale: performQuickSale
    };

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
