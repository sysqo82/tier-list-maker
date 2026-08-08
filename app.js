function newId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  if (window.crypto && typeof window.crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeDefaultTiers() {
  return ["S", "A", "B", "C", "D"].map(label => ({
    id: newId(),
    label,
    tiles: [],
  }));
}

const state = {
  tiers: makeDefaultTiers(),
  albumResults: [],
  savedLists: [],
  currentListId: null,
};

const API_BASE = window.location.port === "5500"
  ? `${window.location.protocol}//${window.location.hostname}:3002`
  : "";

const tierList = document.getElementById("tier-list");
const userEmail = document.getElementById("user-email");
const logoutBtn = document.getElementById("logout-btn");
const savedListSelect = document.getElementById("saved-list-select");
const savedListName = document.getElementById("saved-list-name");
const newListBtn = document.getElementById("new-list-btn");
const saveListBtn = document.getElementById("save-list-btn");
const deleteListBtn = document.getElementById("delete-list-btn");
const addTierForm = document.getElementById("add-tier-form");
const tierNameInput = document.getElementById("tier-name");
const addTextForm = document.getElementById("add-text-tile-form");
const textTierSelect = document.getElementById("text-tier-select");
const textTileInput = document.getElementById("text-tile");
const deezerForm = document.getElementById("deezer-form");
const albumTierSelect = document.getElementById("album-tier-select");
const albumQuery = document.getElementById("album-query");
const albumResults = document.getElementById("album-results");
const addAlbumBtn = document.getElementById("add-album-btn");
const exportBtn = document.getElementById("export-btn");
const resetBtn = document.getElementById("reset-btn");

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    window.location.href = "./login.html";
    throw new Error("Not authenticated");
  }

  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function normalizeTile(tile) {
  if (!tile || typeof tile !== "object") return null;

  if (tile.type === "album") {
    if (!tile.title || typeof tile.title !== "string") return null;
    return {
      id: typeof tile.id === "string" ? tile.id : newId(),
      type: "album",
      title: tile.title,
      cover: typeof tile.cover === "string" ? tile.cover : "",
      artist: typeof tile.artist === "string" ? tile.artist : "",
    };
  }

  if (!tile.text || typeof tile.text !== "string") return null;
  return {
    id: typeof tile.id === "string" ? tile.id : newId(),
    type: "text",
    text: tile.text,
  };
}

function normalizeTiers(rawTiers) {
  if (!Array.isArray(rawTiers)) return [];
  return rawTiers
    .filter(t => t && typeof t === "object")
    .map(t => ({
      id: typeof t.id === "string" ? t.id : newId(),
      label: typeof t.label === "string" && t.label.trim() ? t.label.trim() : "Tier",
      tiles: Array.isArray(t.tiles) ? t.tiles.map(normalizeTile).filter(Boolean) : [],
    }))
    .filter(t => t.label.length > 0);
}

function payloadFromState() {
  return { tiers: state.tiers };
}

function applyPayload(payload) {
  const tiers = normalizeTiers(payload?.tiers);
  state.tiers = tiers.length ? tiers : makeDefaultTiers();
}

function tierColor(index, total) {
  const hueStart = 355;
  const hueEnd = 120;
  const hue = total <= 1
    ? hueStart
    : hueStart + ((hueEnd - hueStart) * index) / (total - 1);
  return `hsl(${hue} 95% 74%)`;
}

function makeTextTile(text) {
  return { id: newId(), type: "text", text };
}

function makeAlbumTile(album) {
  return {
    id: newId(),
    type: "album",
    title: album.title,
    cover: album.cover_medium || album.cover || "",
    artist: album.artist?.name || "",
  };
}

function refreshTierSelects() {
  const options = state.tiers.map(t => `<option value="${t.id}">${t.label}</option>`).join("");
  textTierSelect.innerHTML = options;
  albumTierSelect.innerHTML = options;
}

function refreshSavedListSelect() {
  const options = state.savedLists
    .map(l => `<option value="${l.id}">${l.name}</option>`)
    .join("");
  savedListSelect.innerHTML = options;
  if (state.currentListId) {
    savedListSelect.value = state.currentListId;
  }
}

function addTileToTier(tierId, tile) {
  const tier = state.tiers.find(t => t.id === tierId);
  if (!tier) return;
  tier.tiles.push(tile);
}

function removeTile(tileId) {
  for (const tier of state.tiers) {
    const idx = tier.tiles.findIndex(t => t.id === tileId);
    if (idx >= 0) return tier.tiles.splice(idx, 1)[0];
  }
  return null;
}

function renderTile(tile) {
  if (tile.type === "album") {
    const artist = tile.artist ? ` • ${tile.artist}` : "";
    return `
      <article class="tile album" draggable="true" data-tile-id="${tile.id}">
        <button type="button" class="remove-tile" data-tile-id="${tile.id}" title="Remove tile">×</button>
        <img src="${tile.cover}" alt="${tile.title}" crossorigin="anonymous" />
        <div class="caption" title="${tile.title}${artist}">${tile.title}${artist}</div>
      </article>
    `;
  }

  return `
    <article class="tile" draggable="true" data-tile-id="${tile.id}">
      <button type="button" class="remove-tile" data-tile-id="${tile.id}" title="Remove tile">×</button>
      ${tile.text}
    </article>
  `;
}

function render() {
  refreshTierSelects();
  refreshSavedListSelect();

  tierList.innerHTML = state.tiers.map((tier, i) => {
    const color = tierColor(i, state.tiers.length);
    return `
      <section class="tier-row" data-tier-id="${tier.id}">
        <div class="tier-label" style="background:${color}">
          <span>${tier.label}</span>
          <button type="button" class="edit-tier" data-tier-id="${tier.id}" title="Edit tier">✎</button>
          <button type="button" class="remove-tier" data-tier-id="${tier.id}" title="Remove tier">×</button>
        </div>
        <div class="tier-zone" data-tier-id="${tier.id}">
          ${tier.tiles.map(renderTile).join("")}
        </div>
      </section>
    `;
  }).join("");

  setTileSizes();
  bindDnD();
}

function setTileSizes() {
  const tierHeightRaw = getComputedStyle(document.documentElement).getPropertyValue("--tier-height");
  const tierHeight = Number.parseInt(tierHeightRaw, 10);
  const size = Math.max(56, (Number.isNaN(tierHeight) ? 96 : tierHeight) - 14);
  document.querySelectorAll(".tier-zone").forEach(zone => {
    zone.style.setProperty("--tile-size", `${size}px`);
  });
}

function getDragAfterElement(zone, x) {
  const draggableElements = [...zone.querySelectorAll(".tile:not(.dragging)")];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

  for (const child of draggableElements) {
    const box = child.getBoundingClientRect();
    const offset = x - (box.left + box.width / 2);
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  }

  return closest.element;
}

function bindDnD() {
  const tiles = tierList.querySelectorAll(".tile");
  const zones = tierList.querySelectorAll(".tier-zone");

  tiles.forEach(tile => {
    tile.addEventListener("dragstart", () => tile.classList.add("dragging"));
    tile.addEventListener("dragend", () => {
      tile.classList.remove("dragging");
      syncFromDOM();
    });
  });

  zones.forEach(zone => {
    zone.addEventListener("dragover", e => {
      e.preventDefault();
      zone.classList.add("over");
      const dragging = document.querySelector(".dragging");
      if (!dragging) return;
      const after = getDragAfterElement(zone, e.clientX);
      if (!after) zone.appendChild(dragging);
      else zone.insertBefore(dragging, after);
    });

    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", () => zone.classList.remove("over"));
  });
}

function syncFromDOM() {
  const fresh = state.tiers.map(t => ({ ...t, tiles: [] }));
  const map = new Map();
  state.tiers.forEach(t => t.tiles.forEach(tile => map.set(tile.id, tile)));

  document.querySelectorAll(".tier-zone").forEach(zone => {
    const tierId = zone.dataset.tierId;
    const targetTier = fresh.find(t => t.id === tierId);
    if (!targetTier) return;

    [...zone.querySelectorAll(".tile")].forEach(el => {
      const tile = map.get(el.dataset.tileId);
      if (tile) targetTier.tiles.push(tile);
    });
  });

  state.tiers = fresh;
  render();
}

function getCurrentList() {
  return state.savedLists.find(l => l.id === state.currentListId) || null;
}

function selectList(listId) {
  const list = state.savedLists.find(l => l.id === listId);
  if (!list) return;
  state.currentListId = list.id;
  savedListName.value = list.name;
  applyPayload(list.payload);
  render();
}

function syncCurrentListCache() {
  const list = getCurrentList();
  if (!list) return;
  list.name = savedListName.value.trim() || "Untitled";
  list.payload = payloadFromState();
}

async function loadLists() {
  const { lists } = await api("/api/lists", { method: "GET" });
  state.savedLists = lists.map(l => ({
    id: l.id,
    name: l.name,
    payload: { tiers: normalizeTiers(l.payload?.tiers) },
  }));

  if (!state.savedLists.length) {
    const payload = { tiers: makeDefaultTiers() };
    const name = "My Tier List";
    const { id } = await api("/api/lists", {
      method: "POST",
      body: JSON.stringify({ name, payload }),
    });
    state.savedLists = [{ id, name, payload }];
  }

  state.currentListId = state.savedLists[0].id;
  selectList(state.currentListId);
}

async function saveCurrentList() {
  if (!state.currentListId) return;
  const name = savedListName.value.trim() || "Untitled";
  const payload = payloadFromState();
  await api(`/api/lists/${state.currentListId}`, {
    method: "PUT",
    body: JSON.stringify({ name, payload }),
  });
  syncCurrentListCache();
  render();
}

async function createNewList() {
  const name = (savedListName.value.trim() || "Untitled").slice(0, 80);
  const payload = { tiers: makeDefaultTiers() };

  const { id } = await api("/api/lists", {
    method: "POST",
    body: JSON.stringify({ name, payload }),
  });

  state.savedLists.unshift({ id, name, payload });
  state.currentListId = id;
  savedListName.value = name;
  applyPayload(payload);
  render();
}

async function deleteCurrentList() {
  if (!state.currentListId) return;
  await api(`/api/lists/${state.currentListId}`, { method: "DELETE" });

  state.savedLists = state.savedLists.filter(l => l.id !== state.currentListId);
  if (!state.savedLists.length) {
    await createNewList();
    return;
  }

  state.currentListId = state.savedLists[0].id;
  selectList(state.currentListId);
}

addTierForm.addEventListener("submit", e => {
  e.preventDefault();
  const label = tierNameInput.value.trim();
  if (!label) return;
  state.tiers.push({ id: newId(), label, tiles: [] });
  tierNameInput.value = "";
  render();
});

tierList.addEventListener("click", e => {
  const removeTileBtn = e.target.closest(".remove-tile");
  if (removeTileBtn) {
    const tileId = removeTileBtn.dataset.tileId;
    if (!tileId) return;
    removeTile(tileId);
    render();
    return;
  }

  const editTierBtn = e.target.closest(".edit-tier");
  if (editTierBtn) {
    const tierId = editTierBtn.dataset.tierId;
    if (!tierId) return;
    const tier = state.tiers.find(t => t.id === tierId);
    if (!tier) return;

    const nextLabel = prompt("Tier label:", tier.label);
    if (nextLabel === null) return;
    const trimmed = nextLabel.trim();
    if (!trimmed) return;

    tier.label = trimmed;
    render();
    return;
  }

  const btn = e.target.closest(".remove-tier");
  if (!btn) return;

  const id = btn.dataset.tierId;
  const idx = state.tiers.findIndex(t => t.id === id);
  if (idx < 0) return;

  const removed = state.tiers.splice(idx, 1)[0];
  if (state.tiers.length > 0) {
    state.tiers[Math.max(0, idx - 1)].tiles.push(...removed.tiles);
  }
  render();
});

addTextForm.addEventListener("submit", e => {
  e.preventDefault();
  const tierId = textTierSelect.value;
  const text = textTileInput.value.trim();
  if (!tierId || !text) return;
  addTileToTier(tierId, makeTextTile(text));
  textTileInput.value = "";
  render();
});

function deezerJsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = `dz_cb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const script = document.createElement("script");
    const sep = url.includes("?") ? "&" : "?";
    const full = `${url}${sep}output=jsonp&callback=${cb}`;

    window[cb] = data => {
      cleanup();
      resolve(data);
    };

    script.src = full;
    script.onerror = () => {
      cleanup();
      reject(new Error("Deezer request failed"));
    };

    function cleanup() {
      delete window[cb];
      script.remove();
    }

    document.body.appendChild(script);
  });
}

deezerForm.addEventListener("submit", async e => {
  e.preventDefault();
  const q = albumQuery.value.trim();
  if (!q) return;
  albumResults.innerHTML = "<option>Searching...</option>";

  try {
    const data = await deezerJsonp(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}`);
    state.albumResults = (data?.data || []).slice(0, 20);
    if (!state.albumResults.length) {
      albumResults.innerHTML = "<option>No results</option>";
      return;
    }

    albumResults.innerHTML = state.albumResults
      .map((a, i) => `<option value="${i}">${a.title} • ${a.artist?.name || ""}</option>`)
      .join("");
  } catch {
    albumResults.innerHTML = "<option>Search failed</option>";
  }
});

addAlbumBtn.addEventListener("click", () => {
  const tierId = albumTierSelect.value;
  const idx = Number(albumResults.value);
  if (!tierId || Number.isNaN(idx) || !state.albumResults[idx]) return;
  addTileToTier(tierId, makeAlbumTile(state.albumResults[idx]));
  render();
});

async function exportTierListPng() {
  if (typeof window.html2canvas !== "function") {
    alert("Export library not loaded.");
    return;
  }

  const width = tierList.scrollWidth;
  const height = tierList.scrollHeight;
  const maxDim = Math.max(width, height);
  const scale = Math.max(2, Math.min(4, Math.floor(10000 / Math.max(1, maxDim))));

  try {
    const canvas = await window.html2canvas(tierList, {
      backgroundColor: "#111",
      useCORS: true,
      allowTaint: false,
      scale,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      scrollX: 0,
      scrollY: 0,
      logging: false,
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");
    link.download = `tier-list-${stamp}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch {
    alert("Export failed. Some external covers may block image capture.");
  }
}

savedListSelect.addEventListener("change", () => {
  const id = savedListSelect.value;
  if (!id) return;
  selectList(id);
});

newListBtn.addEventListener("click", async () => {
  try {
    await createNewList();
  } catch (err) {
    alert(err.message);
  }
});

saveListBtn.addEventListener("click", async () => {
  try {
    await saveCurrentList();
    alert("Tier list saved.");
  } catch (err) {
    alert(err.message);
  }
});

deleteListBtn.addEventListener("click", async () => {
  if (!confirm("Delete this tier list?")) return;
  try {
    await deleteCurrentList();
  } catch (err) {
    alert(err.message);
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    // Continue with redirect even if logout API fails.
  }
  window.location.href = "./login.html";
});

exportBtn.addEventListener("click", exportTierListPng);

resetBtn.addEventListener("click", () => {
  state.tiers = makeDefaultTiers();
  state.albumResults = [];
  tierNameInput.value = "";
  textTileInput.value = "";
  albumQuery.value = "";
  albumResults.innerHTML = "";
  render();
});

window.addEventListener("resize", setTileSizes);

(async () => {
  try {
    const me = await api("/api/me", { method: "GET" });
    userEmail.textContent = me.email;
    await loadLists();
    render();
  } catch {
    window.location.href = "./login.html";
  }
})();
