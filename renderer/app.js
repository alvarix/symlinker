/**
 * Renderer logic. Talks to the main process via window.api.
 */

const state = {
  projects: [],
  currentProjectId: null,
};

// ---------- Utilities ----------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function isDryRun() {
  return $('#dry-run-toggle').checked;
}

function toast(message, kind = 'info', timeout = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

function statusLabel(state) {
  switch (state) {
    case 'linked': return 'Linked';
    case 'unlinked': return 'Not moved';
    case 'broken-target': return 'Broken (wrong target)';
    case 'broken-dangling': return 'Broken (target gone)';
    case 'missing-source': return 'Source missing';
    case 'conflict': return 'Conflict';
    case 'missing-both': return 'Missing';
    default: return state;
  }
}

// ---------- Rendering ----------

function renderProjectList() {
  const ul = $('#project-list');
  ul.innerHTML = '';
  if (!state.projects.length) {
    const empty = document.createElement('li');
    empty.className = 'muted';
    empty.style.cursor = 'default';
    empty.textContent = 'No projects yet.';
    ul.appendChild(empty);
    return;
  }
  for (const p of state.projects) {
    const li = document.createElement('li');
    if (p.id === state.currentProjectId) li.classList.add('active');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = p.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const linked = (p.itemStatuses || []).filter((s) => s.state === 'linked').length;
    const total = (p.items || []).length;
    meta.textContent = `${linked}/${total} linked`;
    li.appendChild(name);
    li.appendChild(meta);
    li.addEventListener('click', () => selectProject(p.id));
    ul.appendChild(li);
  }
}

function renderProject(project) {
  $('#empty-state').hidden = !!project;
  $('#project-detail').hidden = !project;
  if (!project) return;

  $('#project-name').textContent = project.name;
  $('#project-source').textContent = project.sourceRoot;
  $('#project-source').dataset.path = project.sourceRoot;
  $('#project-dest').textContent = project.destRoot;
  $('#project-dest').dataset.path = project.destRoot;

  const tbody = $('#items-body');
  tbody.innerHTML = '';
  const items = project.items || [];
  $('#items-empty').hidden = items.length > 0;

  for (const item of items) {
    const tr = document.createElement('tr');

    const tdStatus = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `status-pill status-${item.state}`;
    pill.textContent = statusLabel(item.state);
    tdStatus.appendChild(pill);
    tr.appendChild(tdStatus);

    const tdPath = document.createElement('td');
    tdPath.className = 'path';
    const code = document.createElement('code');
    code.textContent = item.relPath === '.' ? (item.displayName || (project.sourceRoot.split('/').filter(Boolean).pop() + '/')) : item.relPath;
    tdPath.appendChild(code);
    tr.appendChild(tdPath);

    const tdType = document.createElement('td');
    tdType.textContent = item.relPath === '.' ? 'project folder' : (item.isFolder === false ? 'file' : (item.type || 'folder'));
    tr.appendChild(tdType);

    const tdActions = document.createElement('td');
    tdActions.className = 'actions';

    const reverseBtn = document.createElement('button');
    reverseBtn.className = 'ghost';
    reverseBtn.textContent = 'Reverse';
    reverseBtn.addEventListener('click', () => onReverseItem(project.id, item.relPath));
    tdActions.appendChild(reverseBtn);

    const repairBtn = document.createElement('button');
    repairBtn.className = 'ghost';
    repairBtn.textContent = 'Re-link';
    repairBtn.title = 'Re-create the symlink (e.g. after a broken state)';
    repairBtn.addEventListener('click', () => onRelinkItem(project.id, item.relPath));
    tdActions.appendChild(repairBtn);

    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }
}

async function loadSourceBrowser(project) {
  const folderName = project.sourceRoot.split('/').filter(Boolean).pop();
  const rootNameEl = $('#link-root-name');
  const linkRootBtn = $('#link-root-btn');

  rootNameEl.textContent = folderName + '/';

  const alreadyLinkedRoot = (project.items || []).some(i => i.relPath === '.');
  linkRootBtn.disabled = alreadyLinkedRoot;
  linkRootBtn.textContent = alreadyLinkedRoot ? 'Folder linked' : 'Link folder';

  linkRootBtn.onclick = async () => {
    linkRootBtn.disabled = true;
    linkRootBtn.textContent = 'Linking…';
    try {
      const result = await window.api.items.linkRoot(project.id, { dryRun: isDryRun() });
      if (result.skipped) {
        toast('Already linked', 'info');
      } else {
        toast(isDryRun() ? `Dry run: would link ${result.folderName}/` : `Linked ${result.folderName}/`, 'success');
      }
    } catch (err) {
      toast(err.message, 'error', 6000);
      linkRootBtn.disabled = false;
      linkRootBtn.textContent = 'Link folder';
    }
    await refresh();
  };

  const list = $('#source-file-list');
  const emptyMsg = $('#source-browser-empty');
  const linkBtn = $('#link-selected-btn');
  const selectAll = $('#select-all-check');

  list.innerHTML = '';
  emptyMsg.hidden = true;
  linkBtn.disabled = true;
  selectAll.checked = false;
  selectAll.indeterminate = false;
  selectAll.disabled = false;

  let entries;
  try {
    entries = await window.api.source.list(project.sourceRoot);
  } catch (err) {
    toast(`Could not read source folder: ${err.message}`, 'error');
    return;
  }

  const tracked = new Set((project.items || []).map(i => i.relPath));
  const available = entries.filter(e => !tracked.has(e.relPath));

  if (available.length === 0) {
    emptyMsg.hidden = false;
    selectAll.disabled = true;
    return;
  }

  for (const entry of available) {
    const li = document.createElement('li');
    li.className = 'source-file-item';

    const label = document.createElement('label');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.value = entry.relPath;
    checkbox.addEventListener('change', syncSelectAll);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    const dir = entry.relPath.includes('/') ? entry.relPath.slice(0, entry.relPath.lastIndexOf('/') + 1) : '';
    if (dir) {
      const dirSpan = document.createElement('span');
      dirSpan.className = 'file-dir muted';
      dirSpan.textContent = dir;
      nameSpan.appendChild(dirSpan);
    }
    nameSpan.appendChild(document.createTextNode(entry.name));

    const typeSpan = document.createElement('span');
    typeSpan.className = 'file-type muted';
    typeSpan.textContent = entry.type;

    label.appendChild(checkbox);
    label.appendChild(nameSpan);
    label.appendChild(typeSpan);
    li.appendChild(label);
    list.appendChild(li);
  }

  selectAll.checked = true;
  linkBtn.disabled = false;

  function syncSelectAll() {
    const all = $$('#source-file-list input[type="checkbox"]');
    const checked = all.filter(cb => cb.checked);
    linkBtn.disabled = checked.length === 0;
    selectAll.checked = checked.length === all.length;
    selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
  }

  selectAll.onclick = () => {
    $$('#source-file-list input[type="checkbox"]').forEach(cb => {
      cb.checked = selectAll.checked;
    });
    syncSelectAll();
  };

  linkBtn.onclick = async () => {
    const relPaths = $$('#source-file-list input[type="checkbox"]:checked').map(cb => cb.value);
    if (!relPaths.length) return;

    linkBtn.disabled = true;
    linkBtn.textContent = 'Linking…';

    let succeeded = 0;
    for (const relPath of relPaths) {
      try {
        await window.api.items.add(project.id, relPath, { dryRun: isDryRun() });
        succeeded++;
      } catch (err) {
        toast(`Failed: ${relPath} — ${err.message}`, 'error', 6000);
      }
    }

    if (succeeded) {
      toast(
        isDryRun()
          ? `Dry run: ${succeeded} item(s) would be linked`
          : `Linked ${succeeded} item(s)`,
        'success'
      );
    }

    linkBtn.textContent = 'Link selected';
    await refresh();
  };
}

// ---------- Actions ----------

async function refresh() {
  state.projects = await window.api.projects.list();
  renderProjectList();
  if (state.currentProjectId) {
    const project = await window.api.projects.get(state.currentProjectId).catch(() => null);
    renderProject(project);
    if (project) await loadSourceBrowser(project);
  } else {
    renderProject(null);
  }
}

async function selectProject(id) {
  state.currentProjectId = id;
  const project = await window.api.projects.get(id);
  renderProjectList();
  renderProject(project);
  await loadSourceBrowser(project);
}

async function onCreateProject(form) {
  const data = new FormData(form);
  const name = data.get('name')?.trim();
  const sourceRoot = data.get('sourceRoot')?.trim();
  const destRoot = data.get('destRoot')?.trim();
  const errBox = $('#new-project-error');
  errBox.hidden = true;
  try {
    const project = await window.api.projects.create({
      name: name || undefined,
      sourceRoot,
      destRoot,
    });
    state.currentProjectId = project.id;
    await refresh();
    toast('Project created', 'success');
    $('#new-project-dialog').close();
    form.reset();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  }
}

async function onReverseItem(projectId, relPath) {
  const ok = await confirmDialog({
    title: 'Reverse this link?',
    body: `Will move "${relPath}" back from the destination to the source. The symlink will be removed.`,
    confirmLabel: 'Reverse',
  });
  if (!ok) return;
  try {
    await window.api.items.remove(projectId, relPath, { dryRun: isDryRun() });
    toast(isDryRun() ? `Dry run: would reverse ${relPath}` : `Reversed ${relPath}`, 'success');
    await refresh();
  } catch (err) {
    toast(err.message, 'error', 6000);
  }
}

async function onRelinkItem(projectId, relPath) {
  try {
    const result = await window.api.items.add(projectId, relPath, { dryRun: isDryRun() });
    toast(
      isDryRun()
        ? `Dry run: ${result.plan?.length || 0} ops`
        : (result.skipped ? 'Already linked' : `Re-linked ${relPath}`),
      'success'
    );
    await refresh();
  } catch (err) {
    toast(err.message, 'error', 6000);
  }
}

async function onReverseAll() {
  const project = await window.api.projects.get(state.currentProjectId);
  const ok = await confirmDialog({
    title: 'Reverse every link in this project?',
    body: `Will move ${project.items.length} item(s) back to "${project.sourceRoot}". The destination locations will be emptied. This cannot be undone in one click.`,
    confirmLabel: 'Reverse all',
  });
  if (!ok) return;
  try {
    const results = await window.api.items.reverseAll(project.id, { dryRun: isDryRun() });
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      toast(`${results.length - failed.length} reversed, ${failed.length} failed`, 'error', 8000);
    } else {
      toast(isDryRun() ? `Dry run: ${results.length} would reverse` : `Reversed ${results.length} items`, 'success');
    }
    await refresh();
  } catch (err) {
    toast(err.message, 'error', 6000);
  }
}

async function onDeleteProject() {
  const project = await window.api.projects.get(state.currentProjectId);
  const ok = await confirmDialog({
    title: 'Delete this project?',
    body: `Removes "${project.name}" from Symlinker's records. Files and symlinks on disk are NOT touched. Reverse the items first if you want to undo the moves.`,
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  await window.api.projects.remove(project.id);
  state.currentProjectId = null;
  toast('Project deleted', 'success');
  await refresh();
}

async function onRenameProject() {
  const project = await window.api.projects.get(state.currentProjectId);
  const next = prompt('New name', project.name);
  if (!next || next === project.name) return;
  await window.api.projects.rename(project.id, next.trim());
  await refresh();
}

// ---------- Confirm dialog (promise wrapper) ----------

function confirmDialog({ title, body, confirmLabel = 'Confirm' }) {
  return new Promise((resolve) => {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    $('#confirm-ok').textContent = confirmLabel;
    const form = $('#confirm-form');
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      resolve(dialog.returnValue === 'default');
    };
    // Forms inside <dialog method="dialog"> set returnValue from the
    // submit button's value. We use the form's submit to mean "yes".
    const onSubmit = (e) => {
      e.preventDefault();
      form.removeEventListener('submit', onSubmit);
      dialog.close('default');
    };
    form.addEventListener('submit', onSubmit);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}

// ---------- Wire up ----------

function wireDialogs() {
  // Generic close buttons
  $$('dialog [data-close]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  });

  // New project dialog
  $('#new-project-btn').addEventListener('click', () => {
    $('#new-project-error').hidden = true;
    $('#new-project-dialog').showModal();
  });
  $('#new-project-form').addEventListener('submit', (e) => {
    e.preventDefault();
    onCreateProject(e.target);
  });
  $$('#new-project-form [data-pick]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const field = btn.dataset.pick;
      const input = $(`#new-project-form [name="${field}"]`);
      const picked = await window.api.dialog.pickDirectory({
        title: field === 'sourceRoot' ? 'Pick source root' : 'Pick destination root',
        defaultPath: input.value || undefined,
      });
      if (picked) input.value = picked;
    });
  });

  // Project actions
  $('#refresh-btn').addEventListener('click', refresh);
  $('#delete-project-btn').addEventListener('click', onDeleteProject);
  $('#reverse-all-btn').addEventListener('click', onReverseAll);
  $('#rename-project-btn').addEventListener('click', onRenameProject);

  // Reveal buttons
  $$('.reveal-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      const code = target === 'source' ? $('#project-source') : $('#project-dest');
      if (code.dataset.path) window.api.shell.reveal(code.dataset.path);
    });
  });
}

// Initial load
wireDialogs();
refresh().catch((err) => toast(err.message, 'error'));
