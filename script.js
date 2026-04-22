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
  const THEME_KEY = 'mihira_theme';
  const ITEMS_PER_PAGE = 20;

  // ===== STATE =====
  let products = [];
  let filteredProducts = [];
  let currentFilter = 'all';
  let currentColorFilter = 'all';
  let currentSizeFilter = 'all';
  let currentStockFilter = 'all';
  let currentSort = 'default';
  let currentView = 'grid';
  let currentPage = 1;
  let currentModalProduct = null;
  let isInitialLoad = true;
  let pendingRefreshTimer = null;
  let priceMin = 0;
  let priceMax = Infinity;
  let chartInstances = { category: null, color: null, stock: null };
  let lowStockDismissed = false;

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
    categorySelect: $('#categorySelect'),
    colorSelect: $('#colorSelect'),
    sizeSelect: $('#sizeSelect'),
    stockSelect: $('#stockSelect'),
    sortSelect: $('#sortSelect'),
    priceMinInput: $('#priceMin'),
    priceMaxInput: $('#priceMax'),
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
    analyticsPanel: $('#analyticsPanel'),
    lowStockAlert: $('#lowStockAlert'),
    lowStockCount: $('#lowStockCount'),
    paginationBar: $('#paginationBar'),
    paginationPages: $('#paginationPages'),
    paginationInfo: $('#paginationInfo'),
    lightboxOverlay: $('#lightboxOverlay'),
    lightboxImage: $('#lightboxImage'),
    lightboxCaption: $('#lightboxCaption'),
    exportDropdown: $('#exportDropdown'),
    ptrContainer: $('#ptrContainer'),
    ptrText: $('#ptrText'),
  };

  // ===== HELPERS =====

  /** Safely set innerHTML, handling TrustedTypes policies */
  const safePolicy = (typeof window.trustedTypes !== 'undefined' && window.trustedTypes.createPolicy)
    ? window.trustedTypes.createPolicy('mihira', { createHTML: (s) => s })
    : null;

  function safeSetHTML(el, html) {
    if (!el) return;
    if (safePolicy) {
      el.innerHTML = safePolicy.createHTML(html);
    } else {
      el.innerHTML = html;
    }
  }

  /** Convert Google Drive share link to viewable thumbnail */
  function driveThumb(link, size = 400) {
    if (!link) return null;
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]+)/,
      /id=([a-zA-Z0-9_-]+)/,
      /\/d\/([a-zA-Z0-9_-]+)/,
    ];
    for (const pattern of patterns) {
      const m = link.match(pattern);
      if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w${size}`;
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

  // ===== DARK MODE =====

  function applyTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const icon = $('.dark-mode-icon');
    if (icon) icon.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    const meta = $('#metaThemeColor');
    if (meta) meta.content = savedTheme === 'dark' ? '#0d2a2c' : '#1F5A5D';
  }

  function toggleDarkMode() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme();
    // Re-render charts if analytics panel is open
    if (els.analyticsPanel && els.analyticsPanel.style.display !== 'none') {
      renderAnalytics();
    }
    showToast(next === 'dark' ? '🌙 Dark mode enabled' : '☀️ Light mode enabled', 'info');
  }

  // ===== DATA FETCHING =====

  async function fetchData() {
    els.contentArea.style.display = '';
    els.loadingState.style.display = '';
    els.productsGrid.style.display = 'none';
    els.tableWrapper.style.display = 'none';

    try {
      const cacheBustUrl = CSV_URL + '&_t=' + Date.now();
      const resp = await fetch(cacheBustUrl, { cache: 'no-store' });
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
          thumbHires: driveThumb(link, 1200),
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

      // Clear local sold cache — sheet data is now the single source of truth
      localStorage.removeItem(STORAGE_KEY);

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

  // ===== CATEGORY FILTERS WITH COUNT BADGES =====

  function buildCategoryFilters() {
    const catCounts = {};
    products.forEach(p => {
      if (p.category) catCounts[p.category] = (catCounts[p.category] || 0) + 1;
    });
    const cats = Object.keys(catCounts).sort();

    let optionsHtml = `<option value="all">All Category (${products.length})</option>`;
    cats.forEach(cat => {
      optionsHtml += `<option value="${cat}">${cat} (${catCounts[cat]})</option>`;
    });

    safeSetHTML(els.categorySelect, optionsHtml);

    // Use onchange to prevent duplicate listeners on re-build
    els.categorySelect.onchange = (e) => {
      currentFilter = e.target.value;
      currentPage = 1;
      buildColorFilters();
      applyFilters();
    };

    buildColorFilters();
  }

  function buildColorFilters() {
    const filtered = currentFilter === 'all' ? products : products.filter(p => p.category === currentFilter);
    const colorCounts = {};
    filtered.forEach(p => {
      if (p.color) colorCounts[p.color] = (colorCounts[p.color] || 0) + 1;
    });
    const colors = Object.keys(colorCounts).sort();

    let optionsHtml = `<option value="all">All Colors (${filtered.length})</option>`;
    colors.forEach(color => {
      optionsHtml += `<option value="${color}">${color} (${colorCounts[color]})</option>`;
    });

    safeSetHTML(els.colorSelect, optionsHtml);
    currentColorFilter = 'all';

    els.colorSelect.onchange = (e) => {
      currentColorFilter = e.target.value;
      currentPage = 1;
      buildSizeFilters();
      applyFilters();
    };

    buildSizeFilters();
  }

  function buildSizeFilters() {
    let filtered = products;
    if (currentFilter !== 'all') filtered = filtered.filter(p => p.category === currentFilter);
    if (currentColorFilter !== 'all') filtered = filtered.filter(p => p.color === currentColorFilter);

    const sizeCounts = {};
    filtered.forEach(p => {
      if (p.size) sizeCounts[p.size] = (sizeCounts[p.size] || 0) + 1;
    });
    const sizes = Object.keys(sizeCounts).sort();

    let optionsHtml = `<option value="all">All Sizes (${filtered.length})</option>`;
    sizes.forEach(size => {
      optionsHtml += `<option value="${size}">${size} (${sizeCounts[size]})</option>`;
    });

    safeSetHTML(els.sizeSelect, optionsHtml);
    currentSizeFilter = 'all';

    els.sizeSelect.onchange = (e) => {
      currentSizeFilter = e.target.value;
      currentPage = 1;
      applyFilters();
    };
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
    currentStockFilter = 'all';
    currentSort = 'default';
    currentPage = 1;
    priceMin = 0;
    priceMax = Infinity;
    els.searchInput.value = '';

    els.categorySelect.value = 'all';
    els.colorSelect.value = 'all';
    els.sizeSelect.value = 'all';
    els.stockSelect.value = 'all';
    if (els.sortSelect) els.sortSelect.value = 'default';
    if (els.priceMinInput) els.priceMinInput.value = '';
    if (els.priceMaxInput) els.priceMaxInput.value = '';

    // Rebuild dependent filters
    buildColorFilters();
    applyFilters();
    showToast('✕ All filters cleared', 'info');
  }

  /** Schedule a data refresh from the sheet (debounced) */
  function scheduleRefresh(delayMs = 2500) {
    if (pendingRefreshTimer) clearTimeout(pendingRefreshTimer);
    pendingRefreshTimer = setTimeout(() => {
      pendingRefreshTimer = null;
      showToast('⟳ Syncing with sheet...', 'info');
      fetchData();
    }, delayMs);
  }

  // ===== STOCK FILTERS =====
  function initStockFilters() {
    els.stockSelect.onchange = (e) => {
      currentStockFilter = e.target.value;
      currentPage = 1;
      applyFilters();
    };
  }

  // ===== FILTERING, SEARCH & SORTING =====

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

      // Price range filter
      const price = p.discountPrice || p.sellingPrice;
      if (priceMin > 0 && price < priceMin) return false;
      if (priceMax < Infinity && price > priceMax) return false;

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

    // Apply sorting
    applySorting(query);

    renderGrid();
    renderTable();
    renderPagination();
    updateStats();
  }

  function applySorting(query) {
    switch (currentSort) {
      case 'price_asc':
        filteredProducts.sort((a, b) => (a.discountPrice || a.sellingPrice) - (b.discountPrice || b.sellingPrice));
        break;
      case 'price_desc':
        filteredProducts.sort((a, b) => (b.discountPrice || b.sellingPrice) - (a.discountPrice || a.sellingPrice));
        break;
      case 'name_az':
        filteredProducts.sort((a, b) => `${a.category} ${a.color}`.localeCompare(`${b.category} ${b.color}`));
        break;
      case 'name_za':
        filteredProducts.sort((a, b) => `${b.category} ${b.color}`.localeCompare(`${a.category} ${a.color}`));
        break;
      case 'most_sold':
        filteredProducts.sort((a, b) => {
          const soldA = getSoldCount(a.key) + a.sheetSold;
          const soldB = getSoldCount(b.key) + b.sheetSold;
          return soldB - soldA;
        });
        break;
      default:
        // Default: popularity sort on initial load or when no specific filters
        if (isInitialLoad || (!query && currentFilter === 'all' && currentColorFilter === 'all' && currentSizeFilter === 'all')) {
          const popularity = getSearchPopularity();
          filteredProducts.sort((a, b) => (popularity[b.key] || 0) - (popularity[a.key] || 0));
        }
    }
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
      item.addEventListener('click', () => {
        els.searchInput.value = item.dataset.val;
        currentPage = 1;
        applyFilters();
        suggestionsEl.style.display = 'none';
      });
    });
  }

  // ===== PAGINATION =====

  function getPaginatedProducts() {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredProducts.slice(start, start + ITEMS_PER_PAGE);
  }

  function renderPagination() {
    const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);

    if (totalPages <= 1) {
      els.paginationBar.style.display = 'none';
      return;
    }

    els.paginationBar.style.display = 'flex';

    // Build page buttons with ellipsis
    const pages = new Set([1, totalPages]);
    for (let i = Math.max(1, currentPage - 1); i <= Math.min(totalPages, currentPage + 1); i++) {
      pages.add(i);
    }
    const sorted = [...pages].sort((a, b) => a - b);

    let pagesHtml = '';
    let prev = 0;
    sorted.forEach(p => {
      if (p - prev > 1) pagesHtml += '<span class="pagination-ellipsis">…</span>';
      pagesHtml += `<button class="pagination-page ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
      prev = p;
    });

    safeSetHTML(els.paginationPages, pagesHtml);

    const start = (currentPage - 1) * ITEMS_PER_PAGE + 1;
    const end = Math.min(currentPage * ITEMS_PER_PAGE, filteredProducts.length);
    els.paginationInfo.textContent = `${start}–${end} of ${filteredProducts.length}`;

    $('#paginationPrev').disabled = currentPage === 1;
    $('#paginationNext').disabled = currentPage === totalPages;

    // Click handlers for page numbers
    els.paginationPages.querySelectorAll('.pagination-page').forEach(btn => {
      btn.addEventListener('click', () => goToPage(parseInt(btn.dataset.page)));
    });
  }

  function goToPage(page) {
    const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
    currentPage = Math.max(1, Math.min(page, totalPages));
    renderGrid();
    renderTable();
    renderPagination();
    // Scroll to top of products
    const target = els.productsGrid.style.display !== 'none' ? els.productsGrid : els.tableWrapper;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ===== RENDER GRID =====

  function renderGrid() {
    const displayProducts = getPaginatedProducts();

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
    displayProducts.forEach((p, i) => {
      const sold = getSoldCount(p.key) + p.sheetSold;
      const available = Math.max(0, p.setQty - sold);
      const stockClass = available === 0 ? 'stock-out' : available <= 2 ? 'stock-low' : 'stock-in';
      const stockLabel = available === 0 ? 'Out of Stock' : available <= 2 ? 'Low Stock' : 'In Stock';

      const lightboxUrl = p.thumbHires || p.thumb || '';
      const lightboxCaption = `${p.category} — ${p.color} (#${p.serial})`;
      const escapedCaption = lightboxCaption.replace(/'/g, "\\'");

      html += `
        <div class="product-card" style="animation-delay: ${i * 0.04}s">
          <div class="product-image-wrapper" ${lightboxUrl ? `onclick="window.mihira.openLightbox('${lightboxUrl}', '${escapedCaption}')" style="cursor:pointer;" title="Click to enlarge"` : ''}>
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
    const displayProducts = getPaginatedProducts();

    if (filteredProducts.length === 0) {
      safeSetHTML(els.tableBody, `
        <tr>
          <td colspan="12" style="text-align:center; padding: 40px; color: var(--text-muted);">
            No products found
          </td>
        </tr>`);
      return;
    }

    let html = '';
    displayProducts.forEach(p => {
      const sold = getSoldCount(p.key) + p.sheetSold;
      const available = Math.max(0, p.setQty - sold);
      const stockClass = available === 0 ? 'stock-out' : available <= 2 ? 'stock-low' : 'stock-in';

      const lightboxUrl = p.thumbHires || p.thumb || '';
      const lightboxCaption = `${p.category} — ${p.color} (#${p.serial})`;
      const escapedCaption = lightboxCaption.replace(/'/g, "\\'");

      html += `
        <tr>
          <td>${p.serial}</td>
          <td>
            <div class="table-product-info">
              ${p.thumb ? `<img class="table-image" src="${p.thumb}" alt="" loading="lazy" onerror="this.style.display='none'" ${lightboxUrl ? `onclick="window.mihira.openLightbox('${lightboxUrl}', '${escapedCaption}')" style="cursor:pointer;"` : ''}>` : ''}
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

    // Check low stock after stats update
    checkLowStock();
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

  // ===== LOW STOCK ALERTS =====

  function checkLowStock() {
    if (lowStockDismissed) return;
    let count = 0;
    products.forEach(p => {
      const sold = getSoldCount(p.key) + p.sheetSold;
      const available = Math.max(0, p.setQty - sold);
      if (available <= 2) count++;
    });

    if (count > 0 && els.lowStockAlert) {
      els.lowStockCount.textContent = count;
      els.lowStockAlert.style.display = 'flex';
    } else if (els.lowStockAlert) {
      els.lowStockAlert.style.display = 'none';
    }
  }

  // ===== ANALYTICS / CHARTS =====
  // ===== COLOR NAME → CSS COLOR MAPPER =====

  /** Convert a product color name to an actual CSS color value */
  function colorNameToCSS(name) {
    if (!name) return '#888';
    const n = name.toLowerCase().replace(/[\s\-_]+/g, '');

    const MAP = {
      // Basics
      black: '#1a1a1a', white: '#ffffff', red: '#e53e3e', blue: '#3b82f6',
      green: '#22c55e', yellow: '#eab308', orange: '#f97316', pink: '#ec4899',
      purple: '#a855f7', violet: '#8b5cf6', brown: '#92400e', grey: '#6b7280',
      gray: '#6b7280', cream: '#fffdd0', ivory: '#fffff0', beige: '#f5f5dc',
      silver: '#c0c0c0', gold: '#d4a017', golden: '#daa520', copper: '#b87333',
      bronze: '#cd7f32', maroon: '#800000', navy: '#1e3a5f', teal: '#14b8a6',
      cyan: '#06b6d4', magenta: '#d946ef', indigo: '#6366f1', coral: '#f97171',
      peach: '#fdb68d', lavender: '#c084fc', turquoise: '#2dd4bf', olive: '#84cc16',
      rust: '#b45309', wine: '#722f37', burgundy: '#800020', khaki: '#bdb76b',
      salmon: '#fa8072', mint: '#a7f3d0', aqua: '#22d3ee', plum: '#9333ea',
      tan: '#d2b48c', chocolate: '#7b3f00', charcoal: '#374151', pearl: '#f0ead6',
      rani: '#ad1457', pista: '#93c572', mehendi: '#6b8e23', sandal: '#c2a66b',
      mustard: '#e3a008', lemon: '#fde047', strawberry: '#fc5c7d', cherry: '#de3163',

      // Deep variants
      deepblue: '#1e40af', deepblack: '#0a0a0a', deepred: '#991b1b',
      deepgreen: '#166534', deeppink: '#db2777', deeppurple: '#7e22ce',
      deeporange: '#ea580c', deepbrown: '#5c2d0e', deepteal: '#0f766e',
      deepmaroon: '#5a0012', deepgold: '#b8860b', deepviolet: '#5b21b6',

      // Sky / Light variants
      skyblue: '#38bdf8', skycolor: '#7dd3fc',
      lightblue: '#93c5fd', lightgreen: '#86efac', lightpink: '#f9a8d4',
      lightyellow: '#fef08a', lightpurple: '#d8b4fe', lightorange: '#fdba74',
      lightgray: '#d1d5db', lightgrey: '#d1d5db', lightbrown: '#b8860b',

      // Lite variants (common in bangle names)
      litepink: '#f9a8d4', liteblue: '#93c5fd', litegreen: '#86efac',
      litepurple: '#d8b4fe', liteorange: '#fdba74', litegold: '#fcd34d',

      // Rose variants
      rosegold: '#b76e79', rose: '#f43f5e', rosewater: '#f4c2c2',
      rosepink: '#ff66b2',

      // Multi / Mix
      mix: '#8b5cf6', multi: '#8b5cf6', multicolor: '#8b5cf6',
      rainbow: '#8b5cf6', assorted: '#8b5cf6',

      // Metals
      platinum: '#e5e4e2', nickel: '#727472', brass: '#b5a642',
      steel: '#71797e', metallic: '#aaa9ad',

      // Misc
      offwhite: '#f5f0e8', bottlegreen: '#006a4e', firozi: '#40e0d0',
      feroza: '#40e0d0', neon: '#39ff14', neongreen: '#39ff14',
      neonpink: '#ff6ec7', fluorescent: '#ccff00', transparent: '#d1d5db',
    };

    if (MAP[n]) return MAP[n];

    // Try partial matches: find the longest matching key in the name
    let best = null, bestLen = 0;
    for (const key of Object.keys(MAP)) {
      if (n.includes(key) && key.length > bestLen) {
        best = key;
        bestLen = key.length;
      }
    }
    if (best) return MAP[best];

    // Try CSS named color — create a temp element to check
    const testEl = document.createElement('span');
    testEl.style.color = name;
    if (testEl.style.color) return name;

    // Fallback: generate a stable color from the name hash
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return CHART_COLORS[Math.abs(hash) % CHART_COLORS.length];
  }


  const CHART_COLORS = [
    '#1F5A5D', '#D4A98A', '#C08B6B', '#2A7A7E', '#B8845F',
    '#164042', '#E3C0A8', '#A67350', '#3D9B9E', '#8B6F5A',
    '#10b981', '#ef4444', '#f59e0b', '#6366f1', '#ec4899',
  ];

  function destroyCharts() {
    Object.keys(chartInstances).forEach(k => {
      if (chartInstances[k]) {
        chartInstances[k].destroy();
        chartInstances[k] = null;
      }
    });
  }

  function renderAnalytics() {
    if (typeof Chart === 'undefined') {
      showToast('⚠️ Charts library not loaded. Check your internet.', 'error');
      return;
    }

    destroyCharts();

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    Chart.defaults.color = isDark ? '#9aa5b4' : '#666';
    const cardBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim() || '#fff';

    // 1. Sales by Category (Pie)
    const catData = {};
    products.forEach(p => {
      const sold = getSoldCount(p.key) + p.sheetSold;
      if (sold > 0) catData[p.category] = (catData[p.category] || 0) + sold;
    });

    if (Object.keys(catData).length > 0) {
      chartInstances.category = new Chart($('#chartCategory'), {
        type: 'pie',
        data: {
          labels: Object.keys(catData),
          datasets: [{
            data: Object.values(catData),
            backgroundColor: CHART_COLORS,
            borderWidth: 2,
            borderColor: cardBg
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, font: { family: 'Inter' } } }
          }
        }
      });
    }

    // 2. Sales by Color (Bar — top 10)
    const colorData = {};
    products.forEach(p => {
      const sold = getSoldCount(p.key) + p.sheetSold;
      if (sold > 0) colorData[p.color] = (colorData[p.color] || 0) + sold;
    });
    const sortedColors = Object.entries(colorData).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // Map color names to actual CSS colors for the bar chart
    const barColors = sortedColors.map(c => colorNameToCSS(c[0]));

    if (sortedColors.length > 0) {
      chartInstances.color = new Chart($('#chartColor'), {
        type: 'bar',
        data: {
          labels: sortedColors.map(c => c[0]),
          datasets: [{
            label: 'Sets Sold',
            data: sortedColors.map(c => c[1]),
            backgroundColor: barColors,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: barColors.map(c => c === '#ffffff' || c === '#fffdd0' || c === '#fffff0' ? '#ccc' : 'transparent')
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' } },
            x: { grid: { display: false } }
          }
        }
      });
    }

    // 3. Stock Overview (Doughnut)
    let inStock = 0, lowStock = 0, outOfStock = 0;
    products.forEach(p => {
      const sold = getSoldCount(p.key) + p.sheetSold;
      const available = Math.max(0, p.setQty - sold);
      if (available === 0) outOfStock++;
      else if (available <= 2) lowStock++;
      else inStock++;
    });

    chartInstances.stock = new Chart($('#chartStock'), {
      type: 'doughnut',
      data: {
        labels: ['In Stock', 'Low Stock', 'Out of Stock'],
        datasets: [{
          data: [inStock, lowStock, outOfStock],
          backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
          borderWidth: 2,
          borderColor: cardBg
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, font: { family: 'Inter' } } }
        }
      }
    });
  }

  function toggleAnalytics() {
    const panel = els.analyticsPanel;
    if (panel.style.display === 'none') {
      panel.style.display = 'block';
      renderAnalytics();
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      panel.style.display = 'none';
      destroyCharts();
    }
  }

  // ===== EXPORT =====

  function exportToExcel() {
    if (typeof XLSX === 'undefined') {
      showToast('⚠️ Excel library not loaded. Check your internet connection.', 'error');
      return;
    }

    const data = (filteredProducts.length ? filteredProducts : products).map(p => {
      const sold = getSoldCount(p.key) + p.sheetSold;
      const available = Math.max(0, p.setQty - sold);
      return {
        'Serial': p.serial,
        'Category': p.category,
        'Color': p.color,
        'Size': p.size,
        'Sets Qty': p.setQty,
        'Churi/Set': p.churiInSet,
        'Selling Price': p.sellingPrice,
        'New Price': p.newPrice,
        'Discount Price': p.discountPrice,
        'Sold': sold,
        'Available': available,
        'Last Sale': p.lastSaleDate || ''
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Mihira Products');
    XLSX.writeFile(wb, `Mihira_Sales_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('📗 Excel file downloaded!', 'success');
  }

  function exportToPDF() {
    if (!window.jspdf) {
      showToast('⚠️ PDF library not loaded. Check your internet connection.', 'error');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape');

    doc.setFontSize(18);
    doc.setTextColor(31, 90, 93);
    doc.text('Mihira Sales — Product Report', 14, 22);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleString()} | Products: ${filteredProducts.length || products.length}`, 14, 30);

    const rows = (filteredProducts.length ? filteredProducts : products).map(p => {
      const sold = getSoldCount(p.key) + p.sheetSold;
      const available = Math.max(0, p.setQty - sold);
      return [p.serial, p.category, p.color, p.size, p.setQty, p.churiInSet,
              p.sellingPrice, p.newPrice, p.discountPrice, sold, available, p.lastSaleDate || '—'];
    });

    doc.autoTable({
      startY: 36,
      head: [['S/N', 'Category', 'Color', 'Size', 'Sets', 'C/Set', 'Sell ৳', 'New ৳', 'Disc ৳', 'Sold', 'Avail', 'Last Sale']],
      body: rows,
      theme: 'striped',
      headStyles: { fillColor: [31, 90, 93], fontSize: 7, fontStyle: 'bold' },
      styles: { fontSize: 7, cellPadding: 3 },
      alternateRowStyles: { fillColor: [245, 237, 228] }
    });

    doc.save(`Mihira_Sales_${new Date().toISOString().slice(0, 10)}.pdf`);
    showToast('📕 PDF file downloaded!', 'success');
  }

  // ===== IMAGE LIGHTBOX =====

  function openLightbox(url, caption) {
    if (!url) return;
    els.lightboxImage.src = url;
    els.lightboxCaption.textContent = caption || '';
    els.lightboxOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    els.lightboxOverlay.classList.remove('active');
    setTimeout(() => { els.lightboxImage.src = ''; }, 300);
    document.body.style.overflow = '';
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
      await fetch(APPS_SCRIPT_URL, {
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

      // Optimistic local update for immediate UI feedback
      setSoldCount(p.key, currentSold + (isReturn ? -qty : qty));
      closeSaleModal();
      applyFilters();

      const actionText = isReturn ? 'returned to stock' : 'sold';
      showToast(`✅ ${qty} set(s) ${actionText} for ${p.category} ${p.color} — Syncing...`, 'success');

      // Re-fetch fresh data from sheet to stay in sync
      scheduleRefresh(2500);

    } catch (err) {
      console.error('Apps Script error:', err);
      // Still save locally even if sheet update fails
      setSoldCount(p.key, currentSold + (isReturn ? -qty : qty));
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

    const actionText = isReturn ? 'Return -1' : 'Sale +1';
    showToast(`⏳ Processing ${actionText} for ${p.category} ${p.color}...`, 'info');

    // Optimistically update UI immediately
    setSoldCount(p.key, currentSold + qty);
    applyFilters();

    try {
      await fetch(APPS_SCRIPT_URL, {
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
      showToast(`✅ 1 set ${successText} for ${p.category} ${p.color} — Syncing...`, 'success');

      // Re-fetch fresh data from sheet to stay in sync
      scheduleRefresh(2500);

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
    showToast('🔄 Resetting tracking data and pulling fresh data from sheet...', 'info');
    fetchData();
  }

  // ===== EXPORT DROPDOWN =====

  function toggleExportDropdown() {
    els.exportDropdown.classList.toggle('active');
  }

  // ===== EVENT LISTENERS =====

  function init() {
    // Apply saved theme on load
    applyTheme();

    initStockFilters();

    // Search
    els.searchInput.addEventListener('input', debounce(() => {
      currentPage = 1;
      applyFilters();
      showSuggestions();
    }, 300));

    // Hide suggestions / export dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrapper')) {
        const suggestionsEl = $('#searchSuggestions');
        if (suggestionsEl) suggestionsEl.style.display = 'none';
      }
      if (!e.target.closest('.export-dropdown-wrapper')) {
        els.exportDropdown?.classList.remove('active');
      }
    });

    // Sort
    if (els.sortSelect) {
      els.sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        currentPage = 1;
        applyFilters();
      });
    }

    // Price range
    const priceDebounce = debounce(() => {
      priceMin = parseFloat(els.priceMinInput?.value) || 0;
      priceMax = els.priceMaxInput?.value ? parseFloat(els.priceMaxInput.value) : Infinity;
      currentPage = 1;
      applyFilters();
    }, 400);
    if (els.priceMinInput) els.priceMinInput.addEventListener('input', priceDebounce);
    if (els.priceMaxInput) els.priceMaxInput.addEventListener('input', priceDebounce);

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

    // Dark mode toggle
    $('#btnDarkMode')?.addEventListener('click', toggleDarkMode);

    // Analytics toggle
    $('#btnAnalytics')?.addEventListener('click', toggleAnalytics);
    $('#btnCloseAnalytics')?.addEventListener('click', () => {
      els.analyticsPanel.style.display = 'none';
      destroyCharts();
    });

    // Export dropdown
    $('#btnExport')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleExportDropdown();
    });
    $('#btnExportExcel')?.addEventListener('click', () => {
      exportToExcel();
      els.exportDropdown.classList.remove('active');
    });
    $('#btnExportPDF')?.addEventListener('click', () => {
      exportToPDF();
      els.exportDropdown.classList.remove('active');
    });
    $('#btnCopySold')?.addEventListener('click', () => {
      copySoldData();
      els.exportDropdown.classList.remove('active');
    });

    // Header buttons
    $('#btnResetSold').addEventListener('click', resetSoldData);
    $('#btnRefresh').addEventListener('click', () => {
      isInitialLoad = true;
      showToast('⟳ Refreshing data...', 'info');
      fetchData();
    });

    // Clear filters button
    els.btnClearFilters.addEventListener('click', clearAllFilters);

    // Low stock alert actions
    $('#btnShowLowStock')?.addEventListener('click', () => {
      els.stockSelect.value = 'low_stock';
      currentStockFilter = 'low_stock';
      currentPage = 1;
      applyFilters();
      els.lowStockAlert.style.display = 'none';
    });
    $('#btnDismissAlert')?.addEventListener('click', () => {
      lowStockDismissed = true;
      els.lowStockAlert.style.display = 'none';
    });

    // Lightbox
    $('#lightboxClose')?.addEventListener('click', closeLightbox);
    els.lightboxOverlay?.addEventListener('click', (e) => {
      if (e.target === els.lightboxOverlay) closeLightbox();
    });

    // Pagination
    $('#paginationPrev')?.addEventListener('click', () => goToPage(currentPage - 1));
    $('#paginationNext')?.addEventListener('click', () => goToPage(currentPage + 1));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Escape: close lightbox → modal → analytics
      if (e.key === 'Escape') {
        if (els.lightboxOverlay?.classList.contains('active')) {
          closeLightbox();
        } else if (els.saleModal?.classList.contains('active')) {
          closeSaleModal();
        } else if (els.analyticsPanel?.style.display !== 'none') {
          els.analyticsPanel.style.display = 'none';
          destroyCharts();
        }
      }
      // "/" to focus search (when not already in an input)
      if (e.key === '/' && !e.target.closest('input, textarea, select')) {
        e.preventDefault();
        els.searchInput.focus();
      }
    });

    // Expose to global for onclick handlers
    window.mihira = {
      openSale: openSaleModal,
      quickSale: performQuickSale,
      openLightbox: openLightbox,
    };

    // ===== PULL-TO-REFRESH =====
    initPullToRefresh();

    // Initial load
    fetchData();
  }

  // ===== PULL-TO-REFRESH GESTURE =====

  function initPullToRefresh() {
    const ptrContainer = els.ptrContainer;
    const ptrText = els.ptrText;
    if (!ptrContainer) return;

    const PTR_THRESHOLD = 70;
    const PTR_MAX = 100;
    let startY = 0;
    let currentY = 0;
    let isPulling = false;
    let isRefreshing = false;

    function isAtTop() {
      return window.scrollY <= 0;
    }

    function isTouchDevice() {
      return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    }

    if (!isTouchDevice()) return;

    document.addEventListener('touchstart', (e) => {
      if (isRefreshing) return;
      if (!isAtTop()) return;
      // Don't trigger on modals, lightbox, or interactive elements
      if (e.target.closest('.modal-overlay, .lightbox-overlay, .controls-bar input, .controls-bar select')) return;

      startY = e.touches[0].clientY;
      isPulling = true;
      ptrContainer.style.transition = 'none';
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!isPulling || isRefreshing) return;
      if (!isAtTop()) {
        resetPTR();
        return;
      }

      currentY = e.touches[0].clientY;
      let pullDistance = currentY - startY;

      if (pullDistance < 0) {
        resetPTR();
        return;
      }

      // Apply resistance — diminishing returns as you pull further
      pullDistance = Math.min(PTR_MAX, pullDistance * 0.45);

      ptrContainer.style.height = pullDistance + 'px';
      ptrContainer.classList.add('pulling');

      // Rotate arrow proportionally
      const progress = Math.min(pullDistance / PTR_THRESHOLD, 1);
      const arrow = $('#ptrArrow');
      if (arrow) arrow.style.transform = `rotate(${progress * 180}deg)`;

      if (pullDistance >= PTR_THRESHOLD) {
        ptrContainer.classList.add('ready');
        ptrText.textContent = 'Release to refresh';
      } else {
        ptrContainer.classList.remove('ready');
        ptrText.textContent = 'Pull to refresh';
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!isPulling || isRefreshing) return;

      const pullDistance = (currentY - startY) * 0.45;
      isPulling = false;
      ptrContainer.style.transition = '';

      if (pullDistance >= PTR_THRESHOLD) {
        // Trigger refresh
        isRefreshing = true;
        ptrContainer.classList.remove('pulling', 'ready');
        ptrContainer.classList.add('refreshing');
        ptrContainer.style.height = '54px';
        ptrText.textContent = 'Refreshing...';

        // Perform refresh
        isInitialLoad = true;
        fetchData().then(() => {
          finishPTR();
        }).catch(() => {
          finishPTR();
        });
      } else {
        resetPTR();
      }

      startY = 0;
      currentY = 0;
    }, { passive: true });

    function resetPTR() {
      isPulling = false;
      ptrContainer.style.transition = '';
      ptrContainer.style.height = '0';
      ptrContainer.classList.remove('pulling', 'ready', 'refreshing');
      ptrText.textContent = 'Pull to refresh';
      const arrow = $('#ptrArrow');
      if (arrow) arrow.style.transform = '';
    }

    function finishPTR() {
      ptrText.textContent = 'Updated ✓';
      setTimeout(() => {
        isRefreshing = false;
        resetPTR();
      }, 800);
    }
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
