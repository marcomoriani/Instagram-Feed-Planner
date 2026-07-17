(() => {
  'use strict';

  const DB_NAME = 'rebecca-feed-planner';
  const DB_VERSION = 3;
  const DATA_VERSION = 3;
  const POSTS_STORE = 'posts';
  const META_STORE = 'meta';
  const INITIAL_COUNT = 14;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const els = {
    grid: $('#feedGrid'),
    empty: $('#emptyState'),
    count: $('#postCount'),
    menuButton: $('#plannerMenuButton'),
    sheet: $('#plannerSheet'),
    backdrop: $('#backdrop'),
    addButton: $('#addPostButton'),
    editButton: $('#editFeedButton'),
    exportButton: $('#exportButton'),
    importButton: $('#importButton'),
    resetButton: $('#resetButton'),
    editorBar: $('#editorBar'),
    finishEdit: $('#finishEditButton'),
    photoInput: $('#photoInput'),
    backupInput: $('#backupInput'),
    createModal: $('#createModal'),
    cancelCreate: $('#cancelCreateButton'),
    savePost: $('#savePostButton'),
    chooseMore: $('#chooseMoreButton'),
    cropStage: $('#cropStage'),
    cropImage: $('#cropImage'),
    zoom: $('#zoomRange'),
    selectedThumbs: $('#selectedThumbs'),
    selectedCount: $('#selectedCount'),
    coverSummary: $('#coverSummary'),
    setCover: $('#setCoverButton'),
    toast: $('#toast'),
    viewer: $('#postViewer'),
    viewerMedia: $('#viewerMedia'),
    viewerDots: $('#viewerDots'),
    closeViewer: $('#closeViewerButton')
  };

  let db;
  let posts = [];
  let editMode = false;
  let selection = [];
  let activeSelectionIndex = 0;
  let coverSelectionIndex = 0;
  let crop = { zoom: 1, x: 0, y: 0, baseScale: 1 };
  let cropByIndex = new Map();
  let pointerState = new Map();
  let dragInfo = null;
  let toastTimer;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    db = await openDatabase();
    await repairStoredPosts();
    await loadPosts();
    requestPersistentStorage();
    registerServiceWorker();
  }

  function bindEvents() {
    els.menuButton.addEventListener('click', openSheet);
    els.backdrop.addEventListener('click', closeSheet);
    $$('[data-close-sheet]').forEach(btn => btn.addEventListener('click', closeSheet));
    els.addButton.addEventListener('click', () => { closeSheet(); beginPhotoSelection(false); });
    els.editButton.addEventListener('click', () => { closeSheet(); setEditMode(true); });
    els.finishEdit.addEventListener('click', () => setEditMode(false));
    els.photoInput.addEventListener('change', onPhotosChosen);
    els.chooseMore.addEventListener('click', () => beginPhotoSelection(true));
    els.setCover.addEventListener('click', setActiveAsCover);
    els.cancelCreate.addEventListener('click', closeCreateModal);
    els.savePost.addEventListener('click', saveNewPost);
    els.zoom.addEventListener('input', () => {
      crop.zoom = Number(els.zoom.value);
      clampCrop();
      renderCrop();
      storeCurrentCrop();
    });
    els.cropStage.addEventListener('pointerdown', onCropPointerDown);
    els.cropStage.addEventListener('pointermove', onCropPointerMove);
    els.cropStage.addEventListener('pointerup', onCropPointerUp);
    els.cropStage.addEventListener('pointercancel', onCropPointerUp);
    els.exportButton.addEventListener('click', exportBackup);
    els.importButton.addEventListener('click', () => { closeSheet(); els.backupInput.click(); });
    els.backupInput.addEventListener('change', importBackup);
    els.resetButton.addEventListener('click', resetInitialFeed);
    els.closeViewer.addEventListener('click', closeViewer);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && editMode) setEditMode(false);
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        let postStore;
        if (!database.objectStoreNames.contains(POSTS_STORE)) {
          postStore = database.createObjectStore(POSTS_STORE, { keyPath: 'id' });
        } else {
          postStore = req.transaction.objectStore(POSTS_STORE);
        }
        if (postStore.indexNames.contains('order')) postStore.deleteIndex('order');
        postStore.createIndex('order', 'order', { unique: false });
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(storeName, mode = 'readonly') {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function requestToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllPosts() {
    const data = await requestToPromise(tx(POSTS_STORE).getAll());
    return data.sort((a, b) => a.order - b.order);
  }

  async function putPost(post) {
    await requestToPromise(tx(POSTS_STORE, 'readwrite').put(post));
  }

  async function deletePostRecord(id) {
    await requestToPromise(tx(POSTS_STORE, 'readwrite').delete(id));
  }

  async function clearPosts() {
    await requestToPromise(tx(POSTS_STORE, 'readwrite').clear());
  }

  async function getMeta(key) {
    const record = await requestToPromise(tx(META_STORE).get(key));
    return record?.value;
  }

  async function setMeta(key, value) {
    await requestToPromise(tx(META_STORE, 'readwrite').put({ key, value }));
  }

  function initialAssetPath(number) {
    return `./assets/posts/${String(number).padStart(2, '0')}.jpg`;
  }

  function isImageBlob(value) {
    return value instanceof Blob && value.size > 100 && (!value.type || value.type.startsWith('image/'));
  }

  async function fetchImageBlob(path) {
    const response = await fetch(new URL(path, window.location.href), { cache: 'reload' });
    if (!response.ok) throw new Error(`Impossibile caricare ${path}`);
    const blob = await response.blob();
    if (!isImageBlob(blob)) throw new Error(`File immagine non valido: ${path}`);
    return blob;
  }

  async function seedInitialPosts(force = false) {
    const existing = await getAllPosts();
    if (existing.length && !force) return;
    if (force) await clearPosts();

    for (let i = 1; i <= INITIAL_COUNT; i++) {
      const n = String(i).padStart(2, '0');
      const blob = await fetchImageBlob(initialAssetPath(i));
      await putPost({
        id: `initial-${n}`,
        order: i - 1,
        createdAt: Date.now() - i,
        cover: blob,
        images: [blob],
        coverIndex: 0,
        initial: true,
        isCarousel: false
      });
    }
    await setMeta('dataVersion', DATA_VERSION);
  }

  async function repairStoredPosts() {
    let existing = await getAllPosts();
    if (!existing.length) {
      await seedInitialPosts();
      return;
    }

    const storedVersion = Number(await getMeta('dataVersion') || 0);
    let changed = storedVersion < DATA_VERSION;

    for (const post of existing) {
      const images = Array.isArray(post.images) ? post.images.filter(isImageBlob) : [];
      const isInitial = /^initial-\d{2}$/.test(post.id || '');
      let cleanImages = images;
      let cleanCover = isImageBlob(post.cover) ? post.cover : images[0];

      if (isInitial && (storedVersion < DATA_VERSION || !cleanCover || images.length !== 1 || post.isCarousel)) {
        const number = Number(post.id.slice(-2));
        try {
          const blob = await fetchImageBlob(initialAssetPath(number));
          cleanImages = [blob];
          cleanCover = blob;
          changed = true;
        } catch (error) {
          console.warn('Ripristino post iniziale non riuscito:', error);
        }
      }

      const normalized = {
        ...post,
        cover: cleanCover,
        images: cleanImages,
        coverIndex: Number.isInteger(post.coverIndex) && post.coverIndex >= 0 && post.coverIndex < cleanImages.length ? post.coverIndex : 0,
        isCarousel: cleanImages.length > 1
      };

      if (!isImageBlob(normalized.cover) && normalized.images[0]) normalized.cover = normalized.images[0];
      if (changed || normalized.isCarousel !== post.isCarousel || normalized.coverIndex !== post.coverIndex) {
        await putPost(normalized);
      }
    }

    if (changed) await setMeta('dataVersion', DATA_VERSION);
  }

  async function loadPosts() {
    revokePostUrls();
    posts = await getAllPosts();
    posts.forEach(post => {
      const initialNumber = /^initial-(\d{2})$/.exec(post.id || '')?.[1];
      const fallbackUrl = initialNumber ? initialAssetPath(Number(initialNumber)) : '';
      post.coverUrl = isImageBlob(post.cover) ? URL.createObjectURL(post.cover) : fallbackUrl;
      post.imageUrls = (Array.isArray(post.images) ? post.images : [])
        .filter(isImageBlob)
        .map(blob => URL.createObjectURL(blob));
      if (!post.imageUrls.length && fallbackUrl) post.imageUrls = [fallbackUrl];
      post.coverIndex = Math.max(0, Math.min(Number(post.coverIndex) || 0, post.imageUrls.length - 1));
    });
    renderFeed();
  }

  function revokePostUrls() {
    posts.forEach(post => {
      if (post.coverUrl?.startsWith('blob:')) URL.revokeObjectURL(post.coverUrl);
      (post.imageUrls || []).forEach(url => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
    });
  }

  function renderFeed() {
    els.grid.classList.toggle('editing', editMode);
    els.grid.innerHTML = '';
    els.empty.hidden = posts.length > 0;
    els.count.textContent = String(posts.length);

    posts.forEach((post, index) => {
      const item = document.createElement('article');
      item.className = 'feed-item';
      item.dataset.id = post.id;
      item.dataset.index = String(index);
      item.setAttribute('aria-label', `Post ${index + 1} di ${posts.length}`);
      const image = document.createElement('img');
      image.src = post.coverUrl;
      image.alt = `Anteprima post ${index + 1}`;
      image.decoding = 'async';
      image.addEventListener('error', () => {
        const match = /^initial-(\d{2})$/.exec(post.id || '');
        if (match && !image.dataset.fallback) {
          image.dataset.fallback = '1';
          image.src = initialAssetPath(Number(match[1]));
        }
      });
      item.append(image);
      if ((post.images || []).length > 1) {
        const mark = document.createElement('span');
        mark.className = 'carousel-mark';
        mark.setAttribute('aria-label', 'Post con più foto');
        item.append(mark);
      }
      if (editMode) {
        const del = document.createElement('button');
        del.className = 'delete-post';
        del.type = 'button';
        del.setAttribute('aria-label', 'Elimina post');
        del.textContent = '×';
        del.addEventListener('click', event => {
          event.stopPropagation();
          confirmDelete(post.id);
        });
        item.append(del);
        bindLongPressDrag(item);
      } else {
        item.addEventListener('click', () => openViewer(index));
      }
      els.grid.append(item);
    });
  }

  function openSheet() {
    els.backdrop.hidden = false;
    els.sheet.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    els.backdrop.hidden = true;
    els.sheet.hidden = true;
    document.body.style.overflow = '';
  }

  function setEditMode(enabled) {
    editMode = enabled;
    els.editorBar.hidden = !enabled;
    document.body.style.paddingBottom = enabled ? '90px' : '';
    renderFeed();
    if (enabled) showToast('Tieni premuta una foto e trascinala nella nuova posizione');
  }

  function bindLongPressDrag(item) {
    let timer = null;
    let startX = 0;
    let startY = 0;

    const clear = () => { if (timer) clearTimeout(timer); timer = null; };

    item.addEventListener('pointerdown', event => {
      if (event.target.closest('.delete-post')) return;
      startX = event.clientX;
      startY = event.clientY;
      item.setPointerCapture?.(event.pointerId);
      timer = setTimeout(() => startGridDrag(item, event), 260);
    });
    item.addEventListener('pointermove', event => {
      if (dragInfo) {
        updateGridDrag(event);
        return;
      }
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) clear();
    });
    item.addEventListener('pointerup', event => {
      clear();
      if (dragInfo) finishGridDrag(event);
    });
    item.addEventListener('pointercancel', event => {
      clear();
      if (dragInfo) finishGridDrag(event);
    });
  }

  function startGridDrag(item, event) {
    const rect = item.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.innerHTML = `<img src="${$('img', item).src}" alt="">`;
    document.body.append(ghost);
    item.classList.add('drag-source');
    dragInfo = {
      id: item.dataset.id,
      source: item,
      ghost,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    positionGhost(event.clientX, event.clientY);
  }

  function updateGridDrag(event) {
    if (!dragInfo) return;
    event.preventDefault();
    positionGhost(event.clientX, event.clientY);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.feed-item');
    if (!target || target === dragInfo.source || !els.grid.contains(target)) return;
    const fromIndex = posts.findIndex(p => p.id === dragInfo.id);
    const toId = target.dataset.id;
    const toIndex = posts.findIndex(p => p.id === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const [moved] = posts.splice(fromIndex, 1);
    posts.splice(toIndex, 0, moved);
    els.grid.insertBefore(dragInfo.source, fromIndex < toIndex ? target.nextSibling : target);
  }

  function positionGhost(x, y) {
    dragInfo.ghost.style.left = `${x - dragInfo.offsetX}px`;
    dragInfo.ghost.style.top = `${y - dragInfo.offsetY}px`;
    const edge = 70;
    if (y < edge) window.scrollBy({ top: -12, behavior: 'auto' });
    if (y > window.innerHeight - edge) window.scrollBy({ top: 12, behavior: 'auto' });
  }

  async function finishGridDrag() {
    if (!dragInfo) return;
    dragInfo.source.classList.remove('drag-source');
    dragInfo.ghost.remove();
    dragInfo = null;
    await persistOrder();
    renderFeed();
    showToast('Nuovo ordine salvato');
  }

  async function persistOrder() {
    const transaction = db.transaction(POSTS_STORE, 'readwrite');
    const store = transaction.objectStore(POSTS_STORE);
    posts.forEach((post, order) => {
      post.order = order;
      const clean = stripRuntime(post);
      store.put(clean);
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function confirmDelete(id) {
    const ok = window.confirm('Eliminare questo post dall’anteprima?');
    if (!ok) return;
    await deletePostRecord(id);
    await loadPosts();
    if (editMode) renderFeed();
    showToast('Post eliminato');
  }

  function beginPhotoSelection(append) {
    els.photoInput.dataset.append = append ? '1' : '0';
    els.photoInput.value = '';
    els.photoInput.click();
  }

  async function onPhotosChosen(event) {
    const files = [...event.target.files].filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    const append = event.target.dataset.append === '1';
    if (!append) {
      disposeSelection();
      selection = [];
      activeSelectionIndex = 0;
      coverSelectionIndex = 0;
      cropByIndex.clear();
    }

    showToast('Preparazione delle foto…');
    try {
      for (const file of files) {
        const decoded = await decodeImage(file);
        selection.push({
          file,
          url: decoded.url,
          image: decoded.image,
          name: file.name,
          crop: { zoom: 1, x: 0, y: 0 }
        });
      }
      if (!append) activeSelectionIndex = 0;
      openCreateModal();
      renderSelection();
      activateSelection(activeSelectionIndex);
    } catch (error) {
      console.error(error);
      showToast('Una foto non è stata letta. Prova a salvarla come JPG o PNG.');
    }
  }

  function decodeImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => resolve({ url, image });
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Formato immagine non leggibile')); };
      image.src = url;
    });
  }

  function openCreateModal() {
    els.createModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeCreateModal() {
    els.createModal.hidden = true;
    document.body.style.overflow = '';
    disposeSelection();
    selection = [];
    coverSelectionIndex = 0;
    cropByIndex.clear();
  }

  function disposeSelection() {
    selection.forEach(item => item.url && URL.revokeObjectURL(item.url));
  }

  function renderSelection() {
    els.selectedThumbs.innerHTML = '';
    selection.forEach((item, index) => {
      const btn = document.createElement('button');
      btn.className = `selected-thumb${index === activeSelectionIndex ? ' active' : ''}`;
      btn.type = 'button';
      const coverBadge = index === coverSelectionIndex ? '<span class="cover-badge">COPERTINA</span>' : '';
      btn.innerHTML = `<img src="${item.url}" alt="Foto ${index + 1}"><span class="thumb-index">${index + 1}</span>${selection.length > 1 ? '<span class="thumb-remove">×</span>' : ''}${coverBadge}`;
      btn.addEventListener('click', event => {
        if (event.target.closest('.thumb-remove')) {
          event.stopPropagation();
          removeSelected(index);
        } else {
          activateSelection(index);
        }
      });
      els.selectedThumbs.append(btn);
    });
    els.selectedCount.textContent = `${selection.length} ${selection.length === 1 ? 'foto selezionata' : 'foto selezionate'}`;
    els.coverSummary.textContent = `Copertina: foto ${coverSelectionIndex + 1}`;
    const alreadyCover = activeSelectionIndex === coverSelectionIndex;
    els.setCover.disabled = selection.length < 2 || alreadyCover;
    els.setCover.textContent = alreadyCover ? 'Questa foto è la copertina' : `Usa la foto ${activeSelectionIndex + 1} come copertina`;
  }

  function setActiveAsCover() {
    if (!selection.length) return;
    storeCurrentCrop();
    coverSelectionIndex = activeSelectionIndex;
    renderSelection();
    showToast(`Foto ${coverSelectionIndex + 1} impostata come copertina`);
  }

  function removeSelected(index) {
    if (selection.length <= 1) return;
    const [removed] = selection.splice(index, 1);
    URL.revokeObjectURL(removed.url);
    const newMap = new Map();
    [...cropByIndex.entries()].forEach(([key, value]) => {
      if (key < index) newMap.set(key, value);
      if (key > index) newMap.set(key - 1, value);
    });
    cropByIndex = newMap;
    if (coverSelectionIndex === index) coverSelectionIndex = 0;
    else if (coverSelectionIndex > index) coverSelectionIndex -= 1;
    activeSelectionIndex = Math.min(activeSelectionIndex, selection.length - 1);
    renderSelection();
    activateSelection(activeSelectionIndex);
  }

  function activateSelection(index) {
    storeCurrentCrop();
    activeSelectionIndex = index;
    const item = selection[index];
    els.cropImage.src = item.url;
    const saved = cropByIndex.get(index) || item.crop || { zoom: 1, x: 0, y: 0 };
    crop = { ...saved, baseScale: 1 };
    els.cropImage.onload = () => {
      calculateBaseScale();
      clampCrop();
      renderCrop();
    };
    if (els.cropImage.complete) {
      calculateBaseScale();
      clampCrop();
      renderCrop();
    }
    els.zoom.value = String(crop.zoom);
    renderSelection();
  }

  function storeCurrentCrop() {
    if (!selection.length || activeSelectionIndex >= selection.length) return;
    cropByIndex.set(activeSelectionIndex, { zoom: crop.zoom, x: crop.x, y: crop.y });
  }

  function calculateBaseScale() {
    const image = selection[activeSelectionIndex]?.image;
    if (!image) return;
    const rect = els.cropStage.getBoundingClientRect();
    crop.baseScale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  }

  function clampCrop() {
    const image = selection[activeSelectionIndex]?.image;
    if (!image) return;
    const rect = els.cropStage.getBoundingClientRect();
    const scale = crop.baseScale * crop.zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const maxX = Math.max(0, (width - rect.width) / 2);
    const maxY = Math.max(0, (height - rect.height) / 2);
    crop.x = Math.max(-maxX, Math.min(maxX, crop.x));
    crop.y = Math.max(-maxY, Math.min(maxY, crop.y));
  }

  function renderCrop() {
    const scale = crop.baseScale * crop.zoom;
    els.cropImage.style.width = `${els.cropImage.naturalWidth}px`;
    els.cropImage.style.height = `${els.cropImage.naturalHeight}px`;
    els.cropImage.style.transform = `translate(-50%, -50%) translate(${crop.x}px, ${crop.y}px) scale(${scale})`;
    els.zoom.value = String(crop.zoom);
  }

  function onCropPointerDown(event) {
    els.cropStage.setPointerCapture?.(event.pointerId);
    pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerState.size === 1) {
      crop.dragStart = { x: event.clientX, y: event.clientY, cropX: crop.x, cropY: crop.y };
    } else if (pointerState.size === 2) {
      const points = [...pointerState.values()];
      crop.pinchStart = { distance: distance(points[0], points[1]), zoom: crop.zoom };
    }
  }

  function onCropPointerMove(event) {
    if (!pointerState.has(event.pointerId)) return;
    pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerState.size === 1 && crop.dragStart) {
      crop.x = crop.dragStart.cropX + event.clientX - crop.dragStart.x;
      crop.y = crop.dragStart.cropY + event.clientY - crop.dragStart.y;
    } else if (pointerState.size >= 2 && crop.pinchStart) {
      const points = [...pointerState.values()].slice(0, 2);
      const ratio = distance(points[0], points[1]) / Math.max(1, crop.pinchStart.distance);
      crop.zoom = Math.max(1, Math.min(3, crop.pinchStart.zoom * ratio));
    }
    clampCrop();
    renderCrop();
    storeCurrentCrop();
  }

  function onCropPointerUp(event) {
    pointerState.delete(event.pointerId);
    if (pointerState.size === 1) {
      const point = [...pointerState.values()][0];
      crop.dragStart = { x: point.x, y: point.y, cropX: crop.x, cropY: crop.y };
    } else {
      crop.dragStart = null;
      crop.pinchStart = null;
    }
    storeCurrentCrop();
  }

  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  async function saveNewPost() {
    if (!selection.length) return;
    els.savePost.disabled = true;
    els.savePost.textContent = 'Salvataggio…';
    showToast('Salvataggio del post…');
    try {
      storeCurrentCrop();
      const coverItem = selection[coverSelectionIndex];
      const coverCrop = cropByIndex.get(coverSelectionIndex) || coverItem.crop;
      const coverBlob = await createCoverBlob(coverItem.image, coverCrop);
      const images = [];
      for (const item of selection) images.push(await compressImage(item.image));

      await putPost({
        id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        order: -1,
        createdAt: Date.now(),
        cover: coverBlob,
        images,
        coverIndex: coverSelectionIndex,
        initial: false,
        isCarousel: images.length > 1
      });
      closeCreateModal();
      await loadPosts();
      await persistOrder();
      renderFeed();
      window.scrollTo({ top: document.querySelector('.profile-tabs').offsetTop, behavior: 'smooth' });
      showToast('Post aggiunto all’anteprima');
    } catch (error) {
      console.error(error);
      showToast('Il post non è stato salvato. Controlla lo spazio disponibile.');
    } finally {
      els.savePost.disabled = false;
      els.savePost.textContent = 'Aggiungi';
    }
  }

  function createCoverBlob(image, state) {
    const targetW = 1080;
    const targetH = 1440;
    const stage = els.cropStage.getBoundingClientRect();
    const frameW = stage.width;
    const frameH = frameW * 4 / 3;
    const baseScale = Math.max(frameW / image.naturalWidth, frameH / image.naturalHeight);
    const scale = baseScale * state.zoom;
    const sourceW = frameW / scale;
    const sourceH = frameH / scale;
    let sourceX = image.naturalWidth / 2 - state.x / scale - sourceW / 2;
    let sourceY = image.naturalHeight / 2 - state.y / scale - sourceH / 2;
    sourceX = Math.max(0, Math.min(image.naturalWidth - sourceW, sourceX));
    sourceY = Math.max(0, Math.min(image.naturalHeight - sourceH, sourceY));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetW, targetH);
    context.drawImage(image, sourceX, sourceY, sourceW, sourceH, 0, 0, targetW, targetH);
    return canvasToBlob(canvas, 'image/jpeg', .9);
  }

  function compressImage(image) {
    const maxSide = 2048;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvasToBlob(canvas, 'image/jpeg', .9);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Conversione immagine fallita')), type, quality));
  }

  function stripRuntime(post) {
    const { coverUrl, imageUrls, ...clean } = post;
    return clean;
  }

  async function resetInitialFeed() {
    const ok = window.confirm('Ripristinare i 14 post iniziali? Tutte le modifiche e le foto aggiunte verranno eliminate.');
    if (!ok) return;
    closeSheet();
    await seedInitialPosts(true);
    await loadPosts();
    setEditMode(false);
    showToast('Feed iniziale ripristinato');
  }

  async function exportBackup() {
    closeSheet();
    showToast('Creazione del backup…');
    const current = await getAllPosts();
    const payload = {
      app: 'Rebecca Feed Planner',
      version: 2,
      exportedAt: new Date().toISOString(),
      posts: []
    };
    for (const post of current) {
      payload.posts.push({
        id: post.id,
        order: post.order,
        createdAt: post.createdAt,
        initial: post.initial,
        isCarousel: post.images.length > 1,
        coverIndex: Number(post.coverIndex) || 0,
        cover: await blobToDataURL(post.cover),
        images: await Promise.all(post.images.map(blobToDataURL))
      });
    }
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup-feed-rebecca-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('Backup esportato');
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (payload.app !== 'Rebecca Feed Planner' || !Array.isArray(payload.posts)) throw new Error('Backup non valido');
      const ok = window.confirm(`Importare ${payload.posts.length} post? Il feed attuale verrà sostituito.`);
      if (!ok) return;
      await clearPosts();
      for (const post of payload.posts) {
        await putPost({
          id: post.id || `import-${Date.now()}-${Math.random()}`,
          order: Number(post.order),
          createdAt: post.createdAt || Date.now(),
          initial: Boolean(post.initial),
          isCarousel: Array.isArray(post.images) && post.images.length > 1,
          coverIndex: Number(post.coverIndex) || 0,
          cover: dataURLToBlob(post.cover),
          images: post.images.map(dataURLToBlob)
        });
      }
      await loadPosts();
      showToast('Backup importato');
    } catch (error) {
      console.error(error);
      showToast('File di backup non valido');
    }
  }

  function dataURLToBlob(dataURL) {
    const [header, body] = dataURL.split(',');
    const mime = header.match(/data:(.*?);base64/)?.[1] || 'image/jpeg';
    const bytes = atob(body);
    const array = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
    return new Blob([array], { type: mime });
  }

  function openViewer(index) {
    const post = posts[index];
    if (!post) return;
    els.viewerMedia.innerHTML = '';
    els.viewerDots.innerHTML = '';
    const startIndex = Math.max(0, Math.min(Number(post.coverIndex) || 0, post.imageUrls.length - 1));

    post.imageUrls.forEach((url, i) => {
      const slide = document.createElement('div');
      slide.className = 'viewer-slide';
      const image = document.createElement('img');
      image.src = url;
      image.alt = `Foto ${i + 1} del post`;
      image.addEventListener('load', () => {
        slide.dataset.ratio = String(clampViewerRatio(image.naturalWidth / image.naturalHeight));
        if (i === startIndex) setViewerRatio(i);
      });
      slide.append(image);
      els.viewerMedia.append(slide);
      if (post.imageUrls.length > 1) {
        const dot = document.createElement('i');
        if (i === startIndex) dot.className = 'active';
        els.viewerDots.append(dot);
      }
    });

    els.viewer.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      els.viewerMedia.scrollLeft = startIndex * els.viewerMedia.clientWidth;
      setViewerRatio(startIndex);
    });
    els.viewerMedia.onscroll = () => {
      const active = Math.round(els.viewerMedia.scrollLeft / Math.max(1, els.viewerMedia.clientWidth));
      $$('#viewerDots i').forEach((dot, i) => dot.classList.toggle('active', i === active));
      setViewerRatio(active);
    };
  }

  function clampViewerRatio(ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) return 1;
    return Math.max(.75, Math.min(1.91, ratio));
  }

  function setViewerRatio(index) {
    const slide = els.viewerMedia.children[index];
    if (!slide) return;
    const image = $('img', slide);
    const ratio = Number(slide.dataset.ratio) || (image?.naturalWidth ? clampViewerRatio(image.naturalWidth / image.naturalHeight) : 1);
    const width = els.viewerMedia.clientWidth || window.innerWidth;
    els.viewerMedia.style.height = `${Math.round(width / ratio)}px`;
  }

  function closeViewer() {
    els.viewer.hidden = true;
    document.body.style.overflow = '';
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  async function requestPersistentStorage() {
    try {
      if (navigator.storage?.persist) await navigator.storage.persist();
    } catch (_) {}
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker:', error));
    }
  }
})();
