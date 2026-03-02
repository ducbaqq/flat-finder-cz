/* app.js — Flat Finder CZ Application */

(function () {
  'use strict';

  const API_BASE = window.location.origin;
  const API = `${API_BASE}/api`;

  // ============================================
  // State
  // ============================================
  const state = {
    page: 1,
    perPage: 20,
    total: 0,
    totalPages: 0,
    listings: [],
    filters: {
      transaction_type: '',
      property_type: '',
      location: '',
      price_min: '',
      price_max: '',
      size_min: '',
      size_max: '',
      layout: '',
      condition: '',
      construction: '',
      ownership: '',
      furnishing: '',
      energy_rating: '',
      amenities: '',
      source: '',
      sort: 'newest'
    },
    mapReady: false,
    seeded: false,
    mapBounds: null
  };

  let map, markerCluster, debounceTimer;

  // ============================================
  // DOM Elements
  // ============================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ============================================
  // Helpers
  // ============================================
  function formatPrice(price, currency) {
    if (!price) return '—';
    const p = Math.round(price);
    return p.toLocaleString('cs-CZ') + ' ' + (currency || 'Kč');
  }

  function relativeTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr.replace(' ', 'T') + 'Z');
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'právě teď';
    if (diff < 3600) return `před ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `před ${Math.floor(diff / 3600)} h`;
    const days = Math.floor(diff / 86400);
    if (days === 1) return 'včera';
    if (days < 7) return `před ${days} dny`;
    if (days < 30) return `před ${Math.floor(days / 7)} týd.`;
    return `před ${Math.floor(days / 30)} měs.`;
  }

  const propertyTypeLabels = {
    flat: 'Byt', house: 'Dům', commercial: 'Komerční', garage: 'Garáž',
    residential_building: 'Činžovní dům', land: 'Pozemek', cottage: 'Chata'
  };

  const conditionLabels = {
    very_good: 'Velmi dobrý', good: 'Dobrý', bad: 'Špatný', new_build: 'Novostavba',
    after_renovation: 'Po rekonstrukci', before_renovation: 'Před rekonstrukcí',
    under_construction: 'Ve výstavbě', project: 'Projekt', for_demolition: 'K demolici'
  };

  const constructionLabels = {
    brick: 'Cihlová', panel: 'Panelová', wooden: 'Dřevěná',
    stone: 'Kamenná', mixed: 'Smíšená', prefab: 'Montovaná', skeletal: 'Skeletová'
  };

  const ownershipLabels = {
    private: 'Osobní', cooperative: 'Družstevní', municipal: 'Obecní'
  };

  const furnishingLabels = {
    furnished: 'Zařízené', partially: 'Částečně', unfurnished: 'Nezařízené'
  };

  // ============================================
  // Source URL builders — construct correct links to original listing sites
  // ============================================
  const SREALITY_TRANS_CZ = { sale: 'prodej', rent: 'pronajem', auction: 'drazby' };
  const SREALITY_PROP_CZ = { flat: 'byt', house: 'dum', land: 'pozemek', commercial: 'komercni', other: 'ostatni', garage: 'garaz' };

  const SOURCE_URLS = {
    sreality(listing) {
      const hashId = (listing.external_id || '').replace('sreality_', '');
      if (!hashId) return null;
      const trans = SREALITY_TRANS_CZ[listing.transaction_type] || listing.transaction_type;
      const prop = SREALITY_PROP_CZ[listing.property_type] || listing.property_type;
      // Use layout as disposition slug for flats (e.g. "2+kk"); fall back to "x"
      const slug = (listing.property_type === 'flat' && listing.layout) ? listing.layout : 'x';
      return `https://www.sreality.cz/detail/${trans}/${prop}/${slug}/x/${hashId}`;
    },
    ulovdomov(listing) {
      const offerId = (listing.external_id || '').replace('ulovdomov_', '');
      if (!offerId) return null;
      return `https://www.ulovdomov.cz/inzerat/x/${offerId}`;
    },
    bezrealitky(listing) {
      // Bezrealitky source_url from the DB is usually correct (built from API uri).
      // Only override if it looks broken (missing or just a bare numeric fallback).
      if (listing.source_url && listing.source_url.includes('/nemovitosti-byty-domy/')) {
        return listing.source_url;
      }
      const advertId = (listing.external_id || '').replace('bezrealitky_', '');
      if (!advertId) return null;
      return `https://www.bezrealitky.cz/nemovitosti-byty-domy/${advertId}`;
    },
  };

  function buildSourceUrl(listing) {
    const builder = SOURCE_URLS[listing.source];
    if (builder) return builder(listing);
    return listing.source_url || null;
  }

  const amenityLabels = {
    balcony: 'Balkón', elevator: 'Výtah', parking: 'Parkování', cellar: 'Sklep',
    garden: 'Zahrada', terrace: 'Terasa', loggia: 'Lodžie', garage: 'Garáž',
    dishwasher: 'Myčka', washing_machine: 'Pračka'
  };

  // ============================================
  // API Calls
  // ============================================
  async function apiCall(endpoint, params = {}) {
    let base = API + endpoint;
    const qsParts = [];
    Object.entries(params).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) {
        qsParts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      }
    });
    if (qsParts.length) base += '?' + qsParts.join('&');
    const res = await fetch(base);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  async function seedIfNeeded() {
    try {
      const stats = await apiCall('/stats');
      if (stats.total > 0) {
        state.seeded = true;
        return;
      }
    } catch (e) { /* proceed to seed */ }

    try {
      await apiCall('/seed');
      state.seeded = true;
    } catch (e) {
      console.error('Seed failed:', e);
    }
  }

  // ============================================
  // Build Filter Params
  // ============================================
  function getFilterParams() {
    const f = state.filters;
    const params = { page: state.page, per_page: state.perPage };

    if (f.transaction_type) params.transaction_type = f.transaction_type;
    if (f.property_type) params.property_type = f.property_type;
    if (f.location) params.location = f.location;
    if (f.price_min) params.price_min = f.price_min;
    if (f.price_max) params.price_max = f.price_max;
    if (f.size_min) params.size_min = f.size_min;
    if (f.size_max) params.size_max = f.size_max;
    if (f.layout) params.layout = f.layout;
    if (f.condition) params.condition = f.condition;
    if (f.construction) params.construction = f.construction;
    if (f.ownership) params.ownership = f.ownership;
    if (f.furnishing) params.furnishing = f.furnishing;
    if (f.energy_rating) params.energy_rating = f.energy_rating;
    if (f.amenities) params.amenities = f.amenities;
    if (f.source) params.source = f.source;
    if (f.sort) params.sort = f.sort;

    // Include map viewport bounds so listings match what's visible on map
    if (state.mapBounds) {
      params.sw_lat = state.mapBounds.sw_lat;
      params.sw_lng = state.mapBounds.sw_lng;
      params.ne_lat = state.mapBounds.ne_lat;
      params.ne_lng = state.mapBounds.ne_lng;
    }

    return params;
  }

  // ============================================
  // Read Filters from DOM
  // ============================================
  function readFiltersFromDOM() {
    // Transaction type (single select)
    const activeTransBtn = $('#transactionType .btn-toggle.active');
    state.filters.transaction_type = activeTransBtn ? activeTransBtn.dataset.value : '';

    // Property type (multi-select)
    const activePropBtns = $$('#propertyType .btn-toggle.active');
    state.filters.property_type = Array.from(activePropBtns).map(b => b.dataset.value).join(',');

    // Location
    state.filters.location = $('#locationInput').value.trim();

    // Price
    state.filters.price_min = $('#priceMin').value;
    state.filters.price_max = $('#priceMax').value;

    // Size
    state.filters.size_min = $('#sizeMin').value;
    state.filters.size_max = $('#sizeMax').value;

    // Layout (multi-select)
    const activeLayoutBtns = $$('#layoutFilter .btn-toggle.active');
    state.filters.layout = Array.from(activeLayoutBtns).map(b => b.dataset.value).join(',');

    // Condition (checkboxes)
    const condChecked = $$('#conditionFilter input:checked');
    state.filters.condition = Array.from(condChecked).map(c => c.value).join(',');

    // Construction (checkboxes)
    const constrChecked = $$('#constructionFilter input:checked');
    state.filters.construction = Array.from(constrChecked).map(c => c.value).join(',');

    // Ownership (checkboxes)
    const ownChecked = $$('#ownershipFilter input:checked');
    state.filters.ownership = Array.from(ownChecked).map(c => c.value).join(',');

    // Furnishing (single select from btn-group)
    const activeFurnBtn = $('#furnishingFilter .btn-toggle.active');
    state.filters.furnishing = activeFurnBtn ? activeFurnBtn.dataset.value : '';

    // Energy (multi-select)
    const activeEnergyBtns = $$('#energyFilter .btn-toggle.active');
    state.filters.energy_rating = Array.from(activeEnergyBtns).map(b => b.dataset.value).join(',');

    // Amenities (checkboxes)
    const amenChecked = $$('#amenitiesFilter input:checked');
    state.filters.amenities = Array.from(amenChecked).map(c => c.value).join(',');

    // Source (checkboxes)
    const srcChecked = $$('#sourceFilter input:checked');
    state.filters.source = Array.from(srcChecked).map(c => c.value).join(',');

    // Sort
    state.filters.sort = $('#sortSelect').value;
  }

  // ============================================
  // Render Listings
  // ============================================
  function renderListings(listings) {
    const grid = $('#listingGrid');
    if (!listings.length) {
      grid.innerHTML = '';
      $('#emptyState').style.display = 'block';
      $('#pagination').style.display = 'none';
      return;
    }

    $('#emptyState').style.display = 'none';
    grid.innerHTML = listings.map((l, idx) => `
      <article class="listing-card" data-id="${l.id}" style="animation: fadeIn 300ms ${idx * 40}ms both ease-out;">
        <div class="card-image-wrap">
          <img class="card-image" src="${l.thumbnail_url || 'https://picsum.photos/seed/placeholder/400/300'}" alt="${l.title || ''}" loading="lazy" width="400" height="300"
            onerror="this.src='https://picsum.photos/seed/fallback${l.id}/400/300'">
          <div class="card-badges">
            <span class="badge badge-source ${l.source}">${l.source}.cz</span>
            <span class="badge badge-type">${propertyTypeLabels[l.property_type] || l.property_type}</span>
          </div>
        </div>
        <div class="card-body">
          <div class="card-title">${l.title || '—'}</div>
          <div class="card-address">${l.address || l.city || '—'}</div>
          <div class="card-price">
            ${formatPrice(l.price, l.currency)}${l.transaction_type === 'rent' ? '/měs.' : ''}
            ${l.price_note ? `<span class="card-price-note">${l.price_note}</span>` : ''}
          </div>
          <div class="card-meta">
            ${l.size_m2 ? `<span class="card-meta-item">${l.size_m2} m²</span>` : ''}
            ${l.layout ? `<span class="card-meta-item">${l.layout}</span>` : ''}
            ${l.floor !== null && l.floor !== undefined ? `<span class="card-meta-item">${l.floor}. patro</span>` : ''}
          </div>
          ${l.amenities && l.amenities.length ? `
            <div class="card-tags">
              ${l.amenities.slice(0, 4).map(a => `<span class="card-tag">${amenityLabels[a] || a}</span>`).join('')}
            </div>
          ` : ''}
          <div class="card-footer">
            <span class="card-date">${relativeTime(l.listed_at)}</span>
          </div>
        </div>
      </article>
    `).join('');

    // Attach click listeners
    grid.querySelectorAll('.listing-card').forEach(card => {
      card.addEventListener('click', () => openDetail(parseInt(card.dataset.id)));
    });
  }

  // ============================================
  // Render Pagination
  // ============================================
  function renderPagination() {
    const pag = $('#pagination');
    if (state.totalPages <= 1) {
      pag.style.display = 'none';
      return;
    }
    pag.style.display = 'flex';

    const start = (state.page - 1) * state.perPage + 1;
    const end = Math.min(state.page * state.perPage, state.total);

    let html = `<span class="page-info">Zobrazeno ${start}–${end} z ${state.total}</span>`;

    html += `<button class="page-btn" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>‹</button>`;

    const maxVisible = 5;
    let startPage = Math.max(1, state.page - Math.floor(maxVisible / 2));
    let endPage = Math.min(state.totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
      html += `<button class="page-btn" data-page="1">1</button>`;
      if (startPage > 2) html += `<span class="page-btn" style="border:none;cursor:default;">…</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="page-btn ${i === state.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    if (endPage < state.totalPages) {
      if (endPage < state.totalPages - 1) html += `<span class="page-btn" style="border:none;cursor:default;">…</span>`;
      html += `<button class="page-btn" data-page="${state.totalPages}">${state.totalPages}</button>`;
    }

    html += `<button class="page-btn" data-page="${state.page + 1}" ${state.page >= state.totalPages ? 'disabled' : ''}>›</button>`;

    pag.innerHTML = html;

    pag.querySelectorAll('.page-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page);
        if (p >= 1 && p <= state.totalPages && p !== state.page) {
          state.page = p;
          loadListings();
          // Scroll listings to top
          $('#main-content').scrollTop = 0;
        }
      });
    });
  }

  // ============================================
  // Load Listings
  // ============================================
  async function loadListings() {
    const params = getFilterParams();

    try {
      const data = await apiCall('/listings', params);
      state.listings = data.listings;
      state.total = data.total;
      state.totalPages = data.total_pages;
      state.page = data.page;

      renderListings(data.listings);
      renderPagination();
      updateResultsCount();
    } catch (e) {
      console.error('Failed to load listings:', e);
      $('#listingGrid').innerHTML = '<p style="color:var(--color-error);padding:var(--space-4);">Error loading listings.</p>';
    }
  }

  function updateResultsCount() {
    const el = $('#resultsCount');
    el.textContent = `${state.total} nemovitostí nalezeno (${state.total} listings)`;
    $('#statTotal').textContent = `${state.total} nemovitostí`;
  }

  // ============================================
  // Map
  // ============================================
  function initMap() {
    map = L.map('map', {
      center: [49.8, 15.5],
      zoom: 7,
      zoomControl: true,
      attributionControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    markerCluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: function (cluster) {
        const count = cluster.getChildCount();
        let size, className;
        if (count < 10) { size = 36; className = 'marker-cluster-small'; }
        else if (count < 50) { size = 42; className = 'marker-cluster-medium'; }
        else { size = 48; className = 'marker-cluster-large'; }
        return L.divIcon({
          html: '<div>' + count + '</div>',
          className: 'marker-cluster ' + className,
          iconSize: L.point(size, size)
        });
      }
    });

    map.addLayer(markerCluster);
    state.mapReady = true;

    // Sync listing grid with visible map viewport
    map.on('moveend', () => {
      updateMapBounds();
      state.page = 1;
      loadListings();
    });
  }

  async function loadMarkers() {
    if (!state.mapReady) return;

    const params = getFilterParams();
    params.zoom = map.getZoom();
    delete params.page;
    delete params.per_page;

    try {
      const data = await apiCall('/markers', params);
      markerCluster.clearLayers();

      const tealIcon = L.divIcon({
        className: 'custom-marker',
        html: '<div style="width:12px;height:12px;background:var(--color-primary,#0D9488);border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });

      data.markers.forEach(cluster => {
        cluster.listings.forEach(listing => {
          const lat = listing.lat || cluster.lat;
          const lng = listing.lng || cluster.lng;
          const marker = L.marker([lat, lng], { icon: tealIcon });

          const popupHtml = `
            <img class="popup-img" src="${listing.thumbnail_url || 'https://picsum.photos/seed/p' + listing.id + '/300/200'}" 
              alt="" loading="lazy" onerror="this.src='https://picsum.photos/seed/fallback/300/200'">
            <div class="popup-content">
              <div class="popup-title">${listing.title || '—'}</div>
              <div class="popup-price">${formatPrice(listing.price, 'Kč')}${listing.transaction_type === 'rent' ? '/měs.' : ''}</div>
              <div class="popup-address">${listing.city || ''} · ${listing.size_m2 ? listing.size_m2 + ' m²' : ''}</div>
              <a class="popup-link" onclick="window._openDetail(${listing.id})">Zobrazit detail →</a>
            </div>
          `;

          marker.bindPopup(popupHtml, {
            maxWidth: 260,
            minWidth: 220,
            className: 'custom-popup'
          });

          markerCluster.addLayer(marker);
        });
      });
    } catch (e) {
      console.error('Failed to load markers:', e);
    }
  }

  // Expose for popup onclick
  window._openDetail = function (id) {
    openDetail(id);
  };

  // ============================================
  // Detail Modal
  // ============================================
  let detailMap = null;

  async function openDetail(id) {
    const overlay = $('#modalOverlay');
    const body = $('#modalBody');

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    body.innerHTML = '<div style="padding:var(--space-8);text-align:center;"><div class="seed-spinner"></div></div>';

    try {
      const listing = await apiCall(`/listings/${id}`);

      const images = listing.image_urls || [];
      const galleryHtml = images.length ? `
        <div class="modal-gallery">
          ${images.map(url => `<img class="modal-gallery-img" src="${url}" alt="" loading="lazy" onerror="this.style.display='none'">`).join('')}
        </div>
      ` : '';

      body.innerHTML = `
        ${galleryHtml}
        <div class="modal-header">
          <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-2);">
            <span class="badge badge-source ${listing.source}">${listing.source}.cz</span>
            <span class="badge badge-type">${propertyTypeLabels[listing.property_type] || listing.property_type}</span>
          </div>
          <h2 class="modal-title">${listing.title || '—'}</h2>
          <div class="modal-price">
            ${formatPrice(listing.price, listing.currency)}${listing.transaction_type === 'rent' ? '/měs.' : ''}
            ${listing.price_note ? `<span class="modal-price-note">${listing.price_note}</span>` : ''}
          </div>
          <div class="modal-address">${listing.address || ''}, ${listing.city || ''}</div>
        </div>

        <div class="modal-details">
          <div class="detail-grid">
            ${listing.size_m2 ? `<div class="detail-item"><div class="detail-item-label">Plocha (Size)</div><div class="detail-item-value">${listing.size_m2} m²</div></div>` : ''}
            ${listing.layout ? `<div class="detail-item"><div class="detail-item-label">Dispozice (Layout)</div><div class="detail-item-value">${listing.layout}</div></div>` : ''}
            ${listing.floor !== null && listing.floor !== undefined ? `<div class="detail-item"><div class="detail-item-label">Patro (Floor)</div><div class="detail-item-value">${listing.floor}${listing.total_floors ? ' / ' + listing.total_floors : ''}</div></div>` : ''}
            ${listing.condition ? `<div class="detail-item"><div class="detail-item-label">Stav (Condition)</div><div class="detail-item-value">${conditionLabels[listing.condition] || listing.condition}</div></div>` : ''}
            ${listing.construction ? `<div class="detail-item"><div class="detail-item-label">Konstrukce (Construction)</div><div class="detail-item-value">${constructionLabels[listing.construction] || listing.construction}</div></div>` : ''}
            ${listing.ownership ? `<div class="detail-item"><div class="detail-item-label">Vlastnictví (Ownership)</div><div class="detail-item-value">${ownershipLabels[listing.ownership] || listing.ownership}</div></div>` : ''}
            ${listing.furnishing ? `<div class="detail-item"><div class="detail-item-label">Vybavenost (Furnishing)</div><div class="detail-item-value">${furnishingLabels[listing.furnishing] || listing.furnishing}</div></div>` : ''}
            ${listing.energy_rating ? `<div class="detail-item"><div class="detail-item-label">PENB (Energy)</div><div class="detail-item-value">${listing.energy_rating}</div></div>` : ''}
          </div>
        </div>

        ${listing.description ? `
          <div class="modal-description">
            <h3>Popis (Description)</h3>
            <p>${listing.description}</p>
          </div>
        ` : ''}

        ${listing.amenities && listing.amenities.length ? `
          <div class="modal-amenities">
            <h3>Vybavení (Amenities)</h3>
            <div class="amenity-tags">
              ${listing.amenities.map(a => `<span class="amenity-tag">${amenityLabels[a] || a}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        ${(() => { const _url = buildSourceUrl(listing); return _url ? `
          <div class="modal-source">
            <a class="source-link" href="${_url}" target="_blank" rel="noopener noreferrer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Zobrazit na ${listing.source}.cz
            </a>
          </div>
        ` : ''; })()}

        ${listing.latitude && listing.longitude ? `<div class="modal-map" id="detailMapContainer"></div>` : ''}
      `;

      // Init mini-map
      if (listing.latitude && listing.longitude) {
        setTimeout(() => {
          const container = document.getElementById('detailMapContainer');
          if (container) {
            if (detailMap) { detailMap.remove(); detailMap = null; }
            detailMap = L.map(container, {
              center: [listing.latitude, listing.longitude],
              zoom: 15,
              zoomControl: false,
              attributionControl: false,
              dragging: false,
              scrollWheelZoom: false
            });
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
              subdomains: 'abcd',
              maxZoom: 20
            }).addTo(detailMap);
            L.marker([listing.latitude, listing.longitude]).addTo(detailMap);
          }
        }, 100);
      }
    } catch (e) {
      body.innerHTML = '<p style="padding:var(--space-8);text-align:center;color:var(--color-error);">Failed to load listing details.</p>';
    }
  }

  function closeModal() {
    const overlay = $('#modalOverlay');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    if (detailMap) { detailMap.remove(); detailMap = null; }
  }

  // ============================================
  // Filter Event Handlers
  // ============================================
  function setupFilters() {
    // Single-select button groups (transaction, furnishing)
    ['transactionType', 'furnishingFilter'].forEach(groupId => {
      const group = document.getElementById(groupId);
      if (!group) return;
      group.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-toggle');
        if (!btn) return;
        group.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        debouncedSearch();
      });
    });

    // Multi-select button groups (property type, layout, energy)
    ['propertyType', 'layoutFilter', 'energyFilter'].forEach(groupId => {
      const group = document.getElementById(groupId);
      if (!group) return;
      group.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-toggle');
        if (!btn) return;
        btn.classList.toggle('active');
        debouncedSearch();
      });
    });

    // Text/number inputs
    ['locationInput', 'priceMin', 'priceMax', 'sizeMin', 'sizeMax'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', debouncedSearch);
    });

    // Checkboxes
    ['conditionFilter', 'constructionFilter', 'ownershipFilter', 'amenitiesFilter', 'sourceFilter'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', debouncedSearch);
    });

    // Sort
    $('#sortSelect').addEventListener('change', () => {
      state.page = 1;
      triggerSearch();
    });

    // Search button
    $('#searchBtn').addEventListener('click', () => {
      state.page = 1;
      triggerSearch();
    });

    // Clear filters
    $('#clearFilters').addEventListener('click', clearFilters);
  }

  function debouncedSearch() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.page = 1;
      triggerSearch();
    }, 300);
  }

  function updateMapBounds() {
    if (state.mapReady && map) {
      const b = map.getBounds();
      state.mapBounds = {
        sw_lat: b.getSouthWest().lat.toFixed(6),
        sw_lng: b.getSouthWest().lng.toFixed(6),
        ne_lat: b.getNorthEast().lat.toFixed(6),
        ne_lng: b.getNorthEast().lng.toFixed(6)
      };
    }
  }

  function triggerSearch() {
    readFiltersFromDOM();
    updateMapBounds();
    loadListings();
    loadMarkers();
  }

  function clearFilters() {
    // Reset all toggle buttons
    $$('.btn-group .btn-toggle').forEach(b => b.classList.remove('active'));
    // Set "All" as active on transaction type
    const allBtn = $('#transactionType .btn-toggle[data-value=""]');
    if (allBtn) allBtn.classList.add('active');

    // Reset inputs
    $('#locationInput').value = '';
    $('#priceMin').value = '';
    $('#priceMax').value = '';
    $('#sizeMin').value = '';
    $('#sizeMax').value = '';

    // Reset checkboxes
    $$('.checkbox-grid input[type="checkbox"]').forEach(c => c.checked = false);

    // Reset sort
    $('#sortSelect').value = 'newest';

    // Reset state
    Object.keys(state.filters).forEach(k => state.filters[k] = '');
    state.filters.sort = 'newest';
    state.page = 1;

    triggerSearch();
  }

  // ============================================
  // Sidebar Toggle (mobile)
  // ============================================
  function setupSidebar() {
    const toggle = $('#sidebarToggle');
    const sidebar = $('#sidebar');
    const overlay = $('#sidebarOverlay');

    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('active');
    });

    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  }

  // ============================================
  // Map Collapse
  // ============================================
  function setupMapCollapse() {
    const section = $('#mapSection');
    const btn = $('#mapCollapseBtn');

    btn.addEventListener('click', () => {
      section.classList.toggle('collapsed');
      if (map && !section.classList.contains('collapsed')) {
        setTimeout(() => map.invalidateSize(), 310);
      }
    });
  }

  // ============================================
  // Modal
  // ============================================
  function setupModal() {
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalOverlay').addEventListener('click', (e) => {
      if (e.target === $('#modalOverlay')) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
        closeWatchdog();
      }
    });
  }

  // ============================================
  // Theme Toggle
  // ============================================
  function setupTheme() {
    const toggle = $('[data-theme-toggle]');
    const root = document.documentElement;
    let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    root.setAttribute('data-theme', theme);

    if (toggle) {
      toggle.addEventListener('click', () => {
        theme = theme === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', theme);
        toggle.innerHTML = theme === 'dark'
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

        // Update map tiles if needed
        if (map) map.invalidateSize();
      });
    }
  }

  // ============================================
  // Watchdog
  // ============================================
  let watchdogEmail = '';
  let watchdogs = [];

  function getFilterSummaryTags(filters) {
    const tags = [];
    const f = filters || state.filters;

    const transLabels = { rent: 'Pronájem', sale: 'Prodej' };
    if (f.transaction_type) tags.push({ label: 'Typ', value: transLabels[f.transaction_type] || f.transaction_type });
    if (f.property_type) {
      const types = f.property_type.split(',').map(t => propertyTypeLabels[t] || t);
      tags.push({ label: 'Nemovitost', value: types.join(', ') });
    }
    if (f.location) tags.push({ label: 'Lokalita', value: f.location });
    if (f.price_min || f.price_max) {
      const parts = [];
      if (f.price_min) parts.push('od ' + Number(f.price_min).toLocaleString('cs-CZ'));
      if (f.price_max) parts.push('do ' + Number(f.price_max).toLocaleString('cs-CZ'));
      tags.push({ label: 'Cena', value: parts.join(' ') + ' Kč' });
    }
    if (f.size_min || f.size_max) {
      const parts = [];
      if (f.size_min) parts.push('od ' + f.size_min);
      if (f.size_max) parts.push('do ' + f.size_max);
      tags.push({ label: 'Plocha', value: parts.join(' ') + ' m²' });
    }
    if (f.layout) tags.push({ label: 'Dispozice', value: f.layout });
    if (f.condition) tags.push({ label: 'Stav', value: f.condition.split(',').map(c => conditionLabels[c] || c).join(', ') });
    if (f.construction) tags.push({ label: 'Konstrukce', value: f.construction.split(',').map(c => constructionLabels[c] || c).join(', ') });
    if (f.ownership) tags.push({ label: 'Vlastnictví', value: f.ownership.split(',').map(o => ownershipLabels[o] || o).join(', ') });
    if (f.furnishing) tags.push({ label: 'Vybavenost', value: furnishingLabels[f.furnishing] || f.furnishing });
    if (f.energy_rating) tags.push({ label: 'PENB', value: f.energy_rating });
    if (f.amenities) tags.push({ label: 'Vybavení', value: f.amenities.split(',').map(a => amenityLabels[a] || a).join(', ') });
    if (f.source) tags.push({ label: 'Zdroj', value: f.source.split(',').map(s => s + '.cz').join(', ') });

    return tags;
  }

  function renderFilterSummary() {
    readFiltersFromDOM();
    const tags = getFilterSummaryTags(state.filters);
    const container = $('#watchdogFiltersSummary');

    if (tags.length === 0) {
      container.innerHTML = '<p class="watchdog-filters-empty">Žádné filtry — hlídací pes bude sledovat všechny nabídky.<br><small>No filters — the watchdog will watch all listings.</small></p>';
    } else {
      container.innerHTML = '<div class="filter-tags">' +
        tags.map(t => `<span class="filter-tag"><strong>${t.label}:</strong> ${t.value}</span>`).join('') +
        '</div>';
    }
  }

  function renderWatchdogList() {
    const list = $('#watchdogList');
    if (!watchdogs.length) {
      list.innerHTML = '<p class="watchdog-list-empty">Zatím nemáte žádné hlídací psy.<br><small>You don\'t have any watchdogs yet.</small></p>';
      return;
    }

    list.innerHTML = watchdogs.map(w => {
      const tags = getFilterSummaryTags(w.filters);
      const label = w.label || 'Hlídací pes #' + w.id;
      const isActive = w.active;
      return `
        <div class="watchdog-item ${isActive ? '' : 'inactive'}" data-id="${w.id}">
          <div class="watchdog-item-info">
            <div class="watchdog-item-label">${label}</div>
            <div class="watchdog-item-email">${w.email}</div>
            ${tags.length ? '<div class="watchdog-item-filters">' + tags.map(t => `<span class="filter-tag">${t.label}: ${t.value}</span>`).join('') + '</div>' : '<div class="watchdog-item-filters"><span class="filter-tag">Vše (All listings)</span></div>'}
          </div>
          <div class="watchdog-item-actions">
            <button class="toggle-btn" data-wid="${w.id}" title="${isActive ? 'Pozastavit (Pause)' : 'Aktivovat (Activate)'}">
              ${isActive
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
              }
            </button>
            <button class="delete-btn" data-wid="${w.id}" title="Smazat (Delete)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Event listeners
    list.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const wid = btn.dataset.wid;
        try {
          await fetch(`${API}/watchdogs/${wid}/toggle`, { method: 'PATCH' });
          await loadWatchdogs();
        } catch (e) { console.error('Toggle failed', e); }
      });
    });

    list.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const wid = btn.dataset.wid;
        try {
          await fetch(`${API}/watchdogs/${wid}`, { method: 'DELETE' });
          await loadWatchdogs();
          showToast('Hlídací pes smazán (Watchdog deleted)');
        } catch (e) { console.error('Delete failed', e); }
      });
    });
  }

  function updateWatchdogBadge() {
    const badge = $('#watchdogBadge');
    const activeCount = watchdogs.filter(w => w.active).length;
    if (activeCount > 0) {
      badge.textContent = activeCount;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  async function loadWatchdogs() {
    if (!watchdogEmail) {
      watchdogs = [];
      renderWatchdogList();
      updateWatchdogBadge();
      return;
    }
    try {
      const data = await apiCall('/watchdogs', { email: watchdogEmail });
      watchdogs = data.watchdogs || [];
      renderWatchdogList();
      updateWatchdogBadge();
    } catch (e) {
      console.error('Failed to load watchdogs:', e);
    }
  }

  async function saveWatchdog() {
    const email = $('#watchdogEmail').value.trim();
    const label = $('#watchdogLabel').value.trim();

    if (!email || !email.includes('@')) {
      $('#watchdogEmail').focus();
      $('#watchdogEmail').style.borderColor = 'oklch(0.6 0.2 25)';
      setTimeout(() => { $('#watchdogEmail').style.borderColor = ''; }, 2000);
      return;
    }

    readFiltersFromDOM();
    const filtersToSave = { ...state.filters };
    delete filtersToSave.sort;

    try {
      const res = await fetch(`${API}/watchdogs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, filters: filtersToSave, label })
      });
      if (!res.ok) throw new Error('Save failed');

      watchdogEmail = email;
      await loadWatchdogs();

      $('#watchdogLabel').value = '';
      showToast('Hlídací pes uložen (Watchdog saved)');
    } catch (e) {
      console.error('Save failed:', e);
      showToast('Chyba při ukládání (Save failed)');
    }
  }

  function showToast(message) {
    let toast = document.querySelector('.watchdog-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'watchdog-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 3000);
  }

  function openWatchdog() {
    renderFilterSummary();
    const overlay = $('#watchdogOverlay');
    overlay.classList.add('active');

    // If email was previously entered, auto-load
    if (watchdogEmail) {
      $('#watchdogEmail').value = watchdogEmail;
      loadWatchdogs();
    }
  }

  function closeWatchdog() {
    $('#watchdogOverlay').classList.remove('active');
  }

  function setupWatchdog() {
    $('#watchdogBtn').addEventListener('click', openWatchdog);
    $('#watchdogClose').addEventListener('click', closeWatchdog);
    $('#watchdogOverlay').addEventListener('click', (e) => {
      if (e.target === $('#watchdogOverlay')) closeWatchdog();
    });
    $('#watchdogSave').addEventListener('click', saveWatchdog);

    // Load watchdogs when email is entered (on blur)
    $('#watchdogEmail').addEventListener('blur', () => {
      const email = $('#watchdogEmail').value.trim();
      if (email && email.includes('@') && email !== watchdogEmail) {
        watchdogEmail = email;
        loadWatchdogs();
      }
    });
  }

  // ============================================
  // Fade-in animation
  // ============================================
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(styleEl);

  // ============================================
  // Init
  // ============================================
  async function init() {
    const seedOverlay = $('#seedOverlay');

    setupTheme();
    setupSidebar();
    setupMapCollapse();
    setupModal();
    setupFilters();
    setupWatchdog();
    initMap();

    // Seed if needed
    await seedIfNeeded();

    // Hide seed overlay
    seedOverlay.classList.add('hidden');
    setTimeout(() => seedOverlay.remove(), 500);

    // Capture initial map bounds before loading
    updateMapBounds();

    // Initial load
    await Promise.all([loadListings(), loadMarkers()]);

    // Invalidate map size after rendering
    setTimeout(() => map.invalidateSize(), 200);
  }

  // Run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
