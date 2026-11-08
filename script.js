'use strict';

/*
  Movie Home — a tiny, backend-free watchlist.
  All data lives in localStorage under one key.
*/
(() => {
  const STORAGE_KEY = 'movie-home:suggestions:v1';

  const ICONS = {
    watch: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M7 17 17 7"></path>
        <path d="M8 7h9v9"></path>
      </svg>`,
    edit: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
      </svg>`,
    trash: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 6h18"></path>
        <path d="M8 6V4h8v2"></path>
        <path d="M19 6l-1 14H6L5 6"></path>
        <path d="M10 11v5M14 11v5"></path>
      </svg>`
  };

  const els = {
    totalCount: document.getElementById('total-count'),
    totalLabel: document.getElementById('total-label'),
    totalSub: document.getElementById('total-sub'),
    addPanel: document.getElementById('add-suggestion'),
    addForm: document.getElementById('add-form'),
    addTitle: document.getElementById('add-title'),
    editDialog: document.getElementById('edit-dialog'),
    editForm: document.getElementById('edit-form'),
    deleteDialog: document.getElementById('delete-dialog'),
    deleteName: document.getElementById('delete-name'),
    cancelDelete: document.getElementById('cancel-delete'),
    confirmDelete: document.getElementById('confirm-delete'),
    list: document.getElementById('suggestion-list'),
    listPanel: document.querySelector('.list-panel'),
    listMeta: document.getElementById('list-meta'),
    searchWrap: document.getElementById('search-wrap'),
    searchInput: document.getElementById('search-input'),
    clearSearch: document.getElementById('clear-search'),
    emptyState: document.getElementById('empty-state'),
    emptyAddButton: document.getElementById('empty-add-button'),
    listAddButton: document.getElementById('list-add-button'),
    noResults: document.getElementById('no-results'),
    noResultsCopy: document.getElementById('no-results-copy'),
    noResultsClear: document.getElementById('no-results-clear'),
    toast: document.getElementById('toast')
  };

  let suggestions = [];
  let searchQuery = '';
  let editingId = null;
  let deletingId = null;
  let flashId = null;
  let flashTimerId = null;
  let toastTimerId = null;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  });
  const longDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  /* =======================================================
     Storage
     ======================================================= */

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `movie-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function sanitizeStoredItem(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const suggestedBy = typeof raw.suggestedBy === 'string' ? raw.suggestedBy.trim() : '';
    const platform = typeof raw.platform === 'string' ? raw.platform.trim() : '';
    const link = typeof raw.link === 'string' ? raw.link.trim() : '';

    if (!title || !suggestedBy || !platform || !link) return null;

    const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
    const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;

    return {
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : makeId(),
      title,
      suggestedBy,
      platform,
      link,
      createdAt,
      updatedAt
    };
  }

  function loadSuggestions() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed.map(sanitizeStoredItem).filter(Boolean);
    } catch (error) {
      console.warn('Movie Home could not read saved suggestions.', error);
      return [];
    }
  }

  function saveSuggestions() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(suggestions));
      return true;
    } catch (error) {
      console.warn('Movie Home could not save suggestions.', error);
      return false;
    }
  }

  function persistAndNotify(message) {
    if (saveSuggestions()) {
      showToast(message);
    } else {
      showToast('Saved for now, but this browser blocked local storage.', 'error');
    }
  }

  /* =======================================================
     Helper functions
     ======================================================= */

  function createElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function normalizeTitleKey(title) {
    return title.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function normalizeUrl(rawValue) {
    if (typeof rawValue !== 'string') return null;

    let value = rawValue.trim();
    if (!value) return null;

    // Be friendly: let people paste "netflix.com" without typing https://.
    if (!/^[a-z][a-z\d+.-]*:/i.test(value)) {
      value = `https://${value}`;
    }

    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      if (!url.hostname || !url.hostname.includes('.')) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    const formatter = date.getFullYear() === now.getFullYear()
      ? shortDateFormatter
      : longDateFormatter;

    return formatter.format(date);
  }

  function truncate(value, maxLength = 42) {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1).trimEnd()}…`;
  }

  function showToast(message, tone = 'success') {
    window.clearTimeout(toastTimerId);
    els.toast.textContent = message;
    els.toast.dataset.tone = tone;
    els.toast.classList.add('is-visible');

    toastTimerId = window.setTimeout(() => {
      els.toast.classList.remove('is-visible');
    }, 3000);
  }

  function flashSuggestion(id) {
    flashId = id;
    window.clearTimeout(flashTimerId);
    flashTimerId = window.setTimeout(() => {
      flashId = null;
    }, 2200);
  }

  function resetSearch() {
    searchQuery = '';
    els.searchInput.value = '';
    els.clearSearch.hidden = true;
  }

  function focusAddForm() {
    const behavior = prefersReducedMotion.matches ? 'auto' : 'smooth';
    els.addPanel.scrollIntoView({ behavior, block: 'start' });
    els.addTitle.focus({ preventScroll: true });
  }

  function returnToListOnNarrowScreens() {
    if (!window.matchMedia('(max-width: 980px)').matches) return;

    const behavior = prefersReducedMotion.matches ? 'auto' : 'smooth';
    window.requestAnimationFrame(() => {
      els.listPanel.scrollIntoView({ behavior, block: 'start' });
    });
  }

  /* =======================================================
     Rendering
     ======================================================= */

  function createCard(item) {
    const card = createElement('article', 'movie-card');
    card.dataset.id = item.id;
    if (flashId && flashId === item.id) card.classList.add('is-new');

    const info = createElement('div', 'movie-info');
    info.append(createElement('h3', 'movie-title', item.title));

    const meta = createElement('div', 'movie-meta');

    const platform = createElement('span', 'platform-chip', item.platform);
    platform.title = `Where to watch: ${item.platform}`;
    meta.append(platform);

    const suggestedBy = createElement('span', 'suggested-by');
    suggestedBy.append('Suggested by ');
    suggestedBy.append(createElement('strong', 'suggested-name', item.suggestedBy));
    meta.append(suggestedBy);

    const dateLabel = formatDate(item.createdAt);
    if (dateLabel) {
      const added = createElement('span', 'added-date', `Added ${dateLabel}`);
      const exactDate = new Date(item.createdAt);
      if (!Number.isNaN(exactDate.getTime())) {
        added.title = exactDate.toLocaleDateString();
      }
      meta.append(added);
    }

    info.append(meta);

    const actions = createElement('div', 'movie-actions');
    const href = normalizeUrl(item.link);

    if (href) {
      const watchLink = createElement('a', 'btn btn-watch');
      watchLink.href = href;
      watchLink.target = '_blank';
      watchLink.rel = 'noopener noreferrer';
      watchLink.title = `Open ${item.title} in a new tab`;
      watchLink.setAttribute('aria-label', `Watch ${item.title} (opens in a new tab)`);
      watchLink.innerHTML = `${ICONS.watch}<span>Watch</span>`;
      actions.append(watchLink);
    } else {
      const unavailable = createElement('span', 'btn btn-watch is-disabled', 'Link unavailable');
      unavailable.setAttribute('aria-disabled', 'true');
      actions.append(unavailable);
    }

    const editButton = createElement('button', 'icon-btn');
    editButton.type = 'button';
    editButton.dataset.action = 'edit';
    editButton.title = 'Edit suggestion';
    editButton.setAttribute('aria-label', `Edit ${item.title}`);
    editButton.innerHTML = ICONS.edit;

    const deleteButton = createElement('button', 'icon-btn icon-btn-danger');
    deleteButton.type = 'button';
    deleteButton.dataset.action = 'delete';
    deleteButton.title = 'Delete suggestion';
    deleteButton.setAttribute('aria-label', `Delete ${item.title}`);
    deleteButton.innerHTML = ICONS.trash;

    actions.append(editButton, deleteButton);
    card.append(info, actions);

    return card;
  }

  function render() {
    const total = suggestions.length;
    const uniqueTitles = new Set(suggestions.map((item) => normalizeTitleKey(item.title))).size;

    els.totalCount.textContent = String(uniqueTitles);
    els.totalLabel.textContent = uniqueTitles === 1 ? 'Unique title' : 'Unique titles';
    els.totalSub.textContent = total === 0
      ? 'No suggestions yet'
      : `${total} suggestion${total === 1 ? '' : 's'} saved`;

    const query = searchQuery.trim().toLowerCase();
    const sorted = suggestions
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt);
    const filtered = query
      ? sorted.filter((item) => (
        item.title.toLowerCase().includes(query) ||
        item.platform.toLowerCase().includes(query)
      ))
      : sorted;

    const fragment = document.createDocumentFragment();
    filtered.forEach((item) => fragment.append(createCard(item)));
    els.list.replaceChildren(fragment);

    const hasAny = total > 0;
    const hasResults = filtered.length > 0;

    els.searchWrap.hidden = !hasAny;
    els.clearSearch.hidden = els.searchInput.value.length === 0;
    els.emptyState.hidden = hasAny;
    els.noResults.hidden = !(hasAny && !hasResults);
    els.list.hidden = !hasResults;

    if (!hasAny) {
      els.listMeta.textContent = 'Nothing saved yet';
    } else if (!hasResults) {
      els.listMeta.textContent = 'No matches';
      els.noResultsCopy.textContent = `Nothing matches “${searchQuery.trim()}”. Try a different title or platform.`;
    } else if (query) {
      els.listMeta.textContent = `${filtered.length} of ${total} shown`;
    } else {
      els.listMeta.textContent = 'Newest first';
    }
  }

  /* =======================================================
     Validation
     ======================================================= */

  function readField(form, name) {
    const field = form.elements.namedItem(name);
    return field && typeof field.value === 'string' ? field.value : '';
  }

  function setFieldError(form, name, message) {
    const input = form.elements.namedItem(name);
    const errorBox = form.querySelector(`[data-error-for="${name}"]`);

    if (input && typeof input.setAttribute === 'function') {
      if (message) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
    }

    if (errorBox) errorBox.textContent = message;
  }

  function clearFormErrors(form) {
    form.querySelectorAll('.field-error').forEach((errorBox) => {
      errorBox.textContent = '';
    });
    form.querySelectorAll('[aria-invalid="true"]').forEach((input) => {
      input.removeAttribute('aria-invalid');
    });
  }

  function validateForm(form) {
    clearFormErrors(form);

    const values = {
      title: readField(form, 'title').trim(),
      suggestedBy: readField(form, 'suggestedBy').trim(),
      platform: readField(form, 'platform').trim(),
      link: readField(form, 'link').trim()
    };

    let valid = true;
    let firstInvalid = null;

    const fail = (name, message) => {
      valid = false;
      setFieldError(form, name, message);
      if (!firstInvalid) firstInvalid = form.elements.namedItem(name);
    };

    if (!values.title) {
      fail('title', 'Please add a movie or series title.');
    }

    if (!values.suggestedBy) {
      fail('suggestedBy', 'Let us know who suggested it.');
    }

    if (!values.platform) {
      fail('platform', 'Where can you watch it?');
    }

    let normalizedLink = '';

    if (!values.link) {
      fail('link', 'Add a watch or download link.');
    } else {
      normalizedLink = normalizeUrl(values.link);
      if (!normalizedLink) {
        fail('link', 'That link doesn’t look right. Try a full web address.');
      }
    }

    if (!valid) {
      if (firstInvalid && typeof firstInvalid.focus === 'function') {
        firstInvalid.focus();
      }
      return null;
    }

    return {
      title: values.title,
      suggestedBy: values.suggestedBy,
      platform: values.platform,
      link: normalizedLink
    };
  }

  /* =======================================================
     Dialogs
     ======================================================= */

  function openDialog(dialog) {
    document.body.classList.add('modal-open');
    if (!dialog.open) dialog.showModal();
  }

  function syncBodyScrollLock() {
    if (!els.editDialog.open && !els.deleteDialog.open) {
      document.body.classList.remove('modal-open');
    }
  }

  function openEditDialog(id) {
    const item = suggestions.find((entry) => entry.id === id);
    if (!item) {
      showToast('That suggestion is no longer available.', 'error');
      return;
    }

    editingId = id;
    const form = els.editForm;
    form.reset();
    clearFormErrors(form);

    form.elements.namedItem('title').value = item.title;
    form.elements.namedItem('suggestedBy').value = item.suggestedBy;
    form.elements.namedItem('platform').value = item.platform;
    form.elements.namedItem('link').value = item.link;

    openDialog(els.editDialog);

    const titleInput = form.elements.namedItem('title');
    titleInput.focus();
    titleInput.select();
  }

  function openDeleteDialog(id) {
    const item = suggestions.find((entry) => entry.id === id);
    if (!item) {
      showToast('That suggestion is no longer available.', 'error');
      return;
    }

    deletingId = id;
    els.deleteName.textContent = item.title;
    openDialog(els.deleteDialog);
    els.cancelDelete.focus();
  }

  /* =======================================================
     Events
     ======================================================= */

  els.addForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const values = validateForm(els.addForm);
    if (!values) return;

    const now = Date.now();
    const item = {
      id: makeId(),
      ...values,
      createdAt: now,
      updatedAt: now
    };

    suggestions.push(item);
    els.addForm.reset();
    clearFormErrors(els.addForm);
    resetSearch();
    flashSuggestion(item.id);
    render();
    persistAndNotify(`Added “${truncate(item.title)}”`);
    returnToListOnNarrowScreens();
  });

  els.editForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const values = validateForm(els.editForm);
    if (!values) return;

    const id = editingId;
    if (!id || !suggestions.some((entry) => entry.id === id)) {
      els.editDialog.close();
      showToast('That suggestion is no longer available.', 'error');
      return;
    }

    suggestions = suggestions.map((entry) => (
      entry.id === id
        ? { ...entry, ...values, updatedAt: Date.now() }
        : entry
    ));

    editingId = null;
    els.editDialog.close();
    flashSuggestion(id);
    render();
    persistAndNotify(`Updated “${truncate(values.title)}”`);
  });

  els.confirmDelete.addEventListener('click', () => {
    const id = deletingId;
    if (!id) return;

    const item = suggestions.find((entry) => entry.id === id);
    suggestions = suggestions.filter((entry) => entry.id !== id);
    deletingId = null;

    els.deleteDialog.close();

    if (suggestions.length === 0) {
      resetSearch();
    }

    if (flashId === id) {
      flashId = null;
      window.clearTimeout(flashTimerId);
    }

    render();
    persistAndNotify(item ? `Deleted “${truncate(item.title)}”` : 'Suggestion deleted');
  });

  els.cancelDelete.addEventListener('click', () => {
    deletingId = null;
    els.deleteDialog.close();
  });

  els.list.addEventListener('click', (event) => {
    const actionButton = event.target.closest('button[data-action]');
    if (!actionButton || !els.list.contains(actionButton)) return;

    const card = actionButton.closest('.movie-card');
    const id = card ? card.dataset.id : '';
    if (!id) return;

    if (actionButton.dataset.action === 'edit') {
      openEditDialog(id);
    } else if (actionButton.dataset.action === 'delete') {
      openDeleteDialog(id);
    }
  });

  els.searchInput.addEventListener('input', () => {
    searchQuery = els.searchInput.value;
    render();
  });

  els.clearSearch.addEventListener('click', () => {
    resetSearch();
    render();
    els.searchInput.focus();
  });

  els.noResultsClear.addEventListener('click', () => {
    resetSearch();
    render();
    els.searchInput.focus();
  });

  els.emptyAddButton.addEventListener('click', focusAddForm);
  els.listAddButton.addEventListener('click', focusAddForm);

  [els.addForm, els.editForm].forEach((form) => {
    form.addEventListener('input', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.name) return;

      const errorBox = form.querySelector(`[data-error-for="${input.name}"]`);
      if (errorBox) errorBox.textContent = '';
      input.removeAttribute('aria-invalid');
    });
  });

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = button.closest('dialog');
      if (dialog) dialog.close();
    });
  });

  [els.editDialog, els.deleteDialog].forEach((dialog) => {
    dialog.addEventListener('close', () => {
      // A close event from a previous close can arrive after the dialog has
      // already been reopened. Don't wipe the new dialog's state.
      if (dialog.open) return;

      if (dialog === els.editDialog) {
        editingId = null;
        els.editForm.reset();
        clearFormErrors(els.editForm);
      } else {
        deletingId = null;
      }
      syncBodyScrollLock();
    });

    // Native dialogs target the dialog itself when their backdrop is clicked.
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;

      const rect = dialog.getBoundingClientRect();
      const clickedInside = (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );

      if (!clickedInside) dialog.close();
    });
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;

    suggestions = loadSuggestions();
    if (suggestions.length === 0) resetSearch();
    render();
  });

  /* =======================================================
     Start
     ======================================================= */

  suggestions = loadSuggestions();
  render();
})();
