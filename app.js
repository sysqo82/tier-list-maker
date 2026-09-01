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
  return ["S", "A", "B", "C", "D"].map((label, i) => ({
    id: newId(),
    label,
    color: tierColor(i, 5),
    tiles: [],
  }));
}

const state = {
  tiers: makeDefaultTiers(),
  tray: [],
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
const exportBtn = document.getElementById("export-btn");
const resetBtn = document.getElementById("reset-btn");
const uploadBtn = document.getElementById("upload-btn");
const imageUpload = document.getElementById("image-upload");

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
    if (typeof tile.title !== "string") return null;
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
  const arr = rawTiers.filter(t => t && typeof t === "object");
  return arr
    .map((t, i) => ({
      id: typeof t.id === "string" ? t.id : newId(),
      label: typeof t.label === "string" && t.label.trim() ? t.label.trim() : "Tier",
      color: typeof t.color === "string" && t.color ? t.color : tierColor(i, arr.length || 5),
      tiles: Array.isArray(t.tiles) ? t.tiles.map(normalizeTile).filter(Boolean) : [],
    }))
    .filter(t => t.label.length > 0);
}

function payloadFromState() {
  return { tiers: state.tiers, tray: state.tray };
}

function applyPayload(payload) {
  const tiers = normalizeTiers(payload?.tiers);
  state.tiers = tiers.length ? tiers : makeDefaultTiers();
  state.tray = Array.isArray(payload?.tray) ? payload.tray.map(normalizeTile).filter(Boolean) : [];
}

function rgbToHex(rgbStr) {
  if (rgbStr.startsWith("#")) return rgbStr;
  const match = rgbStr.match(/\d+/g);
  if (!match || match.length < 3) return "#ffffff";
  return "#" + match.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, "0")).join("");
}

function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function tierColor(index, total) {
  const hueStart = 355;
  const hueEnd = 120;
  const hue = total <= 1
    ? hueStart
    : hueStart + ((hueEnd - hueStart) * index) / (total - 1);
  return hslToHex(hue, 95, 74);
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

function removeTile(tileId) {
  for (const tier of state.tiers) {
    const idx = tier.tiles.findIndex(t => t.id === tileId);
    if (idx >= 0) return tier.tiles.splice(idx, 1)[0];
  }
  const trayIdx = state.tray.findIndex(t => t.id === tileId);
  if (trayIdx >= 0) return state.tray.splice(trayIdx, 1)[0];
  return null;
}

function renderTile(tile) {
  if (tile.type === "album") {
    const artist = tile.artist ? ` • ${tile.artist}` : "";
    const captionText = `${tile.title}${artist}`;
    const captionDiv = captionText ? `<div class="caption" title="${captionText}">${captionText}</div>` : "";
    
    return `
      <article class="tile album" draggable="true" data-tile-id="${tile.id}">
        <button type="button" class="remove-tile" data-tile-id="${tile.id}" title="Remove tile">×</button>
        <img src="${tile.cover}" alt="${tile.title}" crossorigin="anonymous" />
        ${captionDiv}
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
  refreshSavedListSelect();

  tierList.innerHTML = state.tiers.map((tier, i) => {
    if (!tier.color) {
      tier.color = tierColor(i, state.tiers.length);
    }
    const color = tier.color;
    let hexColor = color;
    if (color.startsWith("rgb")) hexColor = rgbToHex(color);
    else if (color.startsWith("hsl")) {
      const match = color.match(/\d+/g);
      if(match && match.length >= 3) {
          hexColor = hslToHex(Number(match[0]), Number(match[1]), Number(match[2]));
      }
    }

    return `
      <section class="tier-row" data-tier-id="${tier.id}" draggable="true">
        <div class="tier-label" style="background:${color}">
          <div class="top-buttons">
            <div class="add-menu-container">
              <button type="button" class="add-tier-menu-btn" title="Add Tier">↕</button>
              <div class="add-tier-dropdown">
                <button type="button" class="add-tier-above" data-tier-id="${tier.id}">Add Above</button>
                <button type="button" class="add-tier-below" data-tier-id="${tier.id}">Add Below</button>
              </div>
            </div>
            <button type="button" class="remove-tier" data-tier-id="${tier.id}" title="Remove tier">×</button>
          </div>
          <input type="text" class="tier-name-input" data-tier-id="${tier.id}" value="${tier.label}" />
          <input type="color" class="tier-color-input" data-tier-id="${tier.id}" value="${hexColor}" />
        </div>
        <div class="tier-zone" data-tier-id="${tier.id}">
          ${tier.tiles.map(renderTile).join("")}
        </div>
      </section>
    `;
  }).join("");

  const trayZone = document.getElementById("image-tray");
  if (trayZone) {
    trayZone.innerHTML = state.tray.map(renderTile).join("");
  }

  setTileSizes();
  bindDnD();
}

function setTileSizes() {
  const tierHeightRaw = getComputedStyle(document.documentElement).getPropertyValue("--tier-height");
  const tierHeight = Number.parseInt(tierHeightRaw, 10);
  const size = Number.isNaN(tierHeight) ? 96 : tierHeight;
  document.querySelectorAll(".tier-zone").forEach(zone => {
    zone.style.setProperty("--tile-size", `${size}px`);
  });
}

function getDragAfterElement(zone, x, y) {
  const draggableElements = [...zone.querySelectorAll(".tile:not(.dragging)")];
  if (draggableElements.length === 0) return null;

  // Group tiles by row so X comparisons only happen within the row under the cursor.
  const rows = [];
  for (const child of draggableElements) {
    const box = child.getBoundingClientRect();
    let row = rows.find(r => Math.abs(r.top - box.top) < box.height / 2);
    if (!row) {
      row = { top: box.top, height: box.height, elements: [] };
      rows.push(row);
    }
    row.elements.push(child);
  }
  rows.sort((a, b) => a.top - b.top);

  let targetRow = rows.find(r => y < r.top + r.height);
  if (!targetRow) targetRow = rows[rows.length - 1];

  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const child of targetRow.elements) {
    const box = child.getBoundingClientRect();
    const offset = x - (box.left + box.width / 2);
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  }
  return closest.element;
}

function getDragAfterRow(container, y) {
  const draggableElements = [...container.querySelectorAll(".tier-row:not(.dragging-row)")];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

  for (const child of draggableElements) {
    const box = child.getBoundingClientRect();
    const offset = y - (box.top + box.height / 2);
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  }
  return closest.element;
}

function bindDnD() {
  const tiles = document.querySelectorAll(".tile");
  const zones = document.querySelectorAll(".tier-zone");
  const rows = document.querySelectorAll(".tier-row");

  tiles.forEach(tile => {
    tile.addEventListener("dragstart", (e) => {
      e.stopPropagation(); 
      tile.classList.add("dragging");
    });
    tile.addEventListener("dragend", (e) => {
      e.stopPropagation();
      tile.classList.remove("dragging");
      syncFromDOM();
    });
  });

  zones.forEach(zone => {
    zone.addEventListener("dragover", e => {
      e.preventDefault();
      e.stopPropagation();
      const dragging = document.querySelector(".tile.dragging");
      if (!dragging) return;
      zone.classList.add("over");
      const after = getDragAfterElement(zone, e.clientX, e.clientY);
      if (!after) zone.appendChild(dragging);
      else zone.insertBefore(dragging, after);
    });

    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", (e) => {
      e.stopPropagation();
      zone.classList.remove("over");
    });
  });

  rows.forEach(row => {
    row.addEventListener("dragstart", (e) => {
      if (e.target.closest('.tile') || e.target.closest('.tier-color-input') || e.target.closest('.tier-name-input') || e.target.closest('.top-buttons')) return;
      row.classList.add("dragging-row");
    });
    row.addEventListener("dragend", (e) => {
      row.classList.remove("dragging-row");
      syncRowsFromDOM();
    });
  });

  tierList.addEventListener("dragover", e => {
    const draggingRow = document.querySelector(".dragging-row");
    if (!draggingRow) return;
    e.preventDefault();
    const after = getDragAfterRow(tierList, e.clientY);
    if (!after) tierList.appendChild(draggingRow);
    else tierList.insertBefore(draggingRow, after);
  });
}

function syncRowsFromDOM() {
  const newTiers = [];
  document.querySelectorAll(".tier-row").forEach(row => {
    const id = row.dataset.tierId;
    const tier = state.tiers.find(t => t.id === id);
    if (tier) newTiers.push(tier);
  });
  state.tiers = newTiers;
  syncCurrentListCache();
}

function syncFromDOM() {
  const freshTiers = state.tiers.map(t => ({ ...t, tiles: [] }));
  const freshTray = [];
  const map = new Map();

  state.tiers.forEach(t => t.tiles.forEach(tile => map.set(tile.id, tile)));
  state.tray.forEach(tile => map.set(tile.id, tile));

  document.querySelectorAll(".tier-zone").forEach(zone => {
    const tierId = zone.dataset.tierId;
    const targetTier = freshTiers.find(t => t.id === tierId);

    [...zone.querySelectorAll(".tile")].forEach(el => {
      const tile = map.get(el.dataset.tileId);
      if (tile) {
        if (tierId === "tray") freshTray.push(tile);
        else if (targetTier) targetTier.tiles.push(tile);
      }
    });
  });

  state.tiers = freshTiers;
  state.tray = freshTray;
  syncCurrentListCache();
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
    payload: { 
      tiers: normalizeTiers(l.payload?.tiers),
      tray: Array.isArray(l.payload?.tray) ? l.payload.tray.map(normalizeTile).filter(Boolean) : []
    },
  }));

  if (!state.savedLists.length) {
    const payload = { tiers: makeDefaultTiers(), tray: [] };
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
  const payload = { tiers: makeDefaultTiers(), tray: [] };

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

// Auto-scroll functionality while dragging
document.addEventListener("dragover", e => {
  const draggingTile = document.querySelector(".tile.dragging");
  const draggingRow = document.querySelector(".dragging-row");
  if (!draggingTile && !draggingRow) return;

  const edgeSize = 60;
  const scrollSpeed = 15;

  if (e.clientY < edgeSize) {
    window.scrollBy(0, -scrollSpeed);
  } else if (window.innerHeight - e.clientY < edgeSize) {
    window.scrollBy(0, scrollSpeed);
  }
});

document.addEventListener("change", e => {
  if (e.target.classList.contains("tier-name-input")) {
    const tierId = e.target.dataset.tierId;
    const tier = state.tiers.find(t => t.id === tierId);
    if (tier) {
      tier.label = e.target.value.trim() || "Tier";
      syncCurrentListCache();
    }
  }

  if (e.target.classList.contains("tier-color-input")) {
    const tierId = e.target.dataset.tierId;
    const tier = state.tiers.find(t => t.id === tierId);
    if (tier) {
      tier.color = e.target.value;
      syncCurrentListCache();
      render();
    }
  }
});

document.addEventListener("click", e => {
  document.querySelectorAll('.add-menu-container').forEach(c => {
     if (!c.contains(e.target)) {
       c.classList.remove('open');
     }
  });

  const menuBtn = e.target.closest(".add-tier-menu-btn");
  if (menuBtn) {
    const container = menuBtn.closest(".add-menu-container");
    container.classList.toggle("open");
    return;
  }

  const removeTileBtn = e.target.closest(".remove-tile");
  if (removeTileBtn) {
    const tileId = removeTileBtn.dataset.tileId;
    if (!tileId) return;
    removeTile(tileId);
    syncCurrentListCache();
    render();
    return;
  }

  const addAboveBtn = e.target.closest(".add-tier-above");
  if (addAboveBtn) {
    const id = addAboveBtn.dataset.tierId;
    const idx = state.tiers.findIndex(t => t.id === id);
    if (idx >= 0) {
      state.tiers.splice(idx, 0, { id: newId(), label: "New Tier", color: "#a0a0a0", tiles: [] });
      syncCurrentListCache();
      render();
    }
    return;
  }

  const addBelowBtn = e.target.closest(".add-tier-below");
  if (addBelowBtn) {
    const id = addBelowBtn.dataset.tierId;
    const idx = state.tiers.findIndex(t => t.id === id);
    if (idx >= 0) {
      state.tiers.splice(idx + 1, 0, { id: newId(), label: "New Tier", color: "#a0a0a0", tiles: [] });
      syncCurrentListCache();
      render();
    }
    return;
  }

  const removeBtn = e.target.closest(".remove-tier");
  if (removeBtn) {
    const id = removeBtn.dataset.tierId;
    const idx = state.tiers.findIndex(t => t.id === id);
    if (idx < 0) return;

    const removed = state.tiers.splice(idx, 1)[0];
    if (state.tiers.length > 0) {
      state.tiers[Math.max(0, idx - 1)].tiles.push(...removed.tiles);
    } else {
      state.tray.push(...removed.tiles);
    }
    syncCurrentListCache();
    render();
  }
});

uploadBtn.addEventListener("click", () => imageUpload.click());
imageUpload.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  const readPromises = files.map(file => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.tray.push({
          id: newId(),
          type: "album", 
          title: "", 
          cover: ev.target.result,
          artist: ""
        });
        resolve();
      };
      reader.readAsDataURL(file);
    });
  });

  await Promise.all(readPromises);
  syncCurrentListCache();
  render();
  imageUpload.value = "";
});

async function exportTierListPng() {
  if (typeof window.html2canvas !== "function") {
    alert("Export library not loaded.");
    return;
  }

  const targetElement = document.getElementById("tier-list");
  
  // Apply export mode class to hide interactive elements
  targetElement.classList.add("export-mode");
  
  const tierHeightRaw = getComputedStyle(document.documentElement).getPropertyValue("--tier-height");
  const tierHeight = Number.parseInt(tierHeightRaw, 10);
  const size = Number.isNaN(tierHeight) ? 96 : tierHeight;

  const allTiles = targetElement.querySelectorAll(".tile");
  const albumTiles = targetElement.querySelectorAll(".tile.album");

  // Fix html2canvas object-fit bug by completely hiding the <img> tag
  // and dynamically loading it as a CSS background-image instead.
  albumTiles.forEach(t => {
    const img = t.querySelector("img");
    if (img) {
      t.style.backgroundImage = `url("${img.src}")`;
      t.style.backgroundSize = "cover";
      t.style.backgroundPosition = "center";
    }
  });

  // Enforce rigid pixel sizing to prevent layout shifts
  allTiles.forEach(t => {
    t.style.width = `${size}px`;
    t.style.height = `${size}px`;
  });

  // Wait a fraction of a second to ensure DOM updates apply before drawing
  await new Promise(r => setTimeout(r, 50));

  const width = targetElement.scrollWidth;
  const height = targetElement.scrollHeight;
  const maxDim = Math.max(width, height);
  const scale = Math.max(2, Math.min(4, Math.floor(10000 / Math.max(1, maxDim))));

  try {
    const canvas = await window.html2canvas(targetElement, {
      backgroundColor: "#111",
      useCORS: true,
      allowTaint: false,
      scale,
      logging: false,
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");
    link.download = `tier-list-${stamp}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch {
    alert("Export failed. Some external covers may block image capture.");
  } finally {
    // Revert layout back to normal
    targetElement.classList.remove("export-mode");
    allTiles.forEach(t => {
      t.style.width = "";
      t.style.height = "";
      t.style.backgroundImage = "";
      t.style.backgroundSize = "";
      t.style.backgroundPosition = "";
    });
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
  }
  window.location.href = "./login.html";
});

exportBtn.addEventListener("click", exportTierListPng);

resetBtn.addEventListener("click", () => {
  state.tiers = makeDefaultTiers();
  state.tray = [];
  syncCurrentListCache();
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