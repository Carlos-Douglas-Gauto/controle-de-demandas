// Mesa de Demandas — Frontend Client Controller

const state = {
  user: null,
  isInitialized: true,
  currentView: 'board', // 'board', 'my_tasks', 'meeting', 'users', 'auth'
  authMode: 'login',   // 'login', 'register', 'reset', 'setup'
  tasks: [],
  meetingTasks: [],
  usersList: [],
  selectedOwnerFilters: [],
  editingTask: null,
  editingUser: null
};

// --- DOM References ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  setupGlobalEvents();
  await checkAuthStatus();
});

function setupGlobalEvents() {
  // Navigation
  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) {
      e.preventDefault();
      const view = navBtn.dataset.nav;
      switchView(view);
    }

    const authSwitch = e.target.closest('[data-auth-switch]');
    if (authSwitch) {
      e.preventDefault();
      state.authMode = authSwitch.dataset.authSwitch;
      renderAuthView();
    }
  });

  // Logout button
  $('#btn-logout')?.addEventListener('click', async () => {
    try {
      await API.auth.logout();
      state.user = null;
      showNotice('Sessão encerrada.', 'success');
      await checkAuthStatus();
    } catch (err) {
      showNotice(err.message, 'error');
    }
  });

  // New Demand button
  $('#btn-new-task')?.addEventListener('click', () => {
    openTaskModal();
  });

  // Tecla ESC para fechar qualquer modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  });
}

async function checkAuthStatus() {
  try {
    const status = await API.auth.status();
    state.isInitialized = status.initialized;
    state.user = status.user;

    if (!state.isInitialized) {
      state.authMode = 'setup';
      renderAuthView();
      return;
    }

    if (!state.user) {
      state.authMode = 'login';
      renderAuthView();
      return;
    }

    // User is logged in
    updateTopbar();
    if (state.user.profile === 'Administrador') {
      await loadUsersList();
    }
    await switchView('board');
  } catch (err) {
    showNotice(err.message, 'error');
  }
}

function updateTopbar() {
  const topbar = $('#app-topbar');
  const userMeta = $('#topbar-user-meta');
  const nav = $('#topbar-nav');

  if (!state.user) {
    topbar.style.display = 'none';
    return;
  }

  topbar.style.display = 'flex';
  userMeta.innerHTML = `
    <div class="user-meta">
      <div class="name">${escapeHtml(state.user.name)}</div>
      <div class="role">${escapeHtml(state.user.profile)}</div>
    </div>
  `;

  // Render navigation according to profile
  const isAdmin = state.user.profile === 'Administrador';
  nav.innerHTML = `
    <button class="nav-link ${state.currentView === 'board' ? 'active' : ''}" data-nav="board">Quadro</button>
    ${isAdmin ? `
      <button class="nav-link ${state.currentView === 'my_tasks' ? 'active' : ''}" data-nav="my_tasks">Minhas demandas</button>
      <button class="nav-link ${state.currentView === 'meeting' ? 'active' : ''}" data-nav="meeting">Reunião</button>
      <button class="nav-link ${state.currentView === 'users' ? 'active' : ''}" data-nav="users">Pessoas</button>
    ` : ''}
  `;
}

async function switchView(viewName) {
  state.currentView = viewName;
  updateTopbar();

  $('#auth-container').style.display = 'none';
  $('#app-container').style.display = 'block';

  if (viewName === 'board' || viewName === 'my_tasks') {
    await loadAndRenderBoard(viewName === 'my_tasks');
  } else if (viewName === 'meeting') {
    await loadAndRenderMeeting();
  } else if (viewName === 'users') {
    await loadAndRenderUsers();
  }
}

// --- Notifications ---
function showNotice(message, type = 'success') {
  const area = $('#notice-area');
  const notice = document.createElement('div');
  notice.className = `notice notice-${type}`;
  notice.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button class="icon-button" style="font-size:16px; margin-left:8px;" onclick="this.parentElement.remove()">×</button>
  `;
  area.appendChild(notice);

  setTimeout(() => {
    notice.style.opacity = '0';
    notice.style.transition = 'opacity 0.3s ease';
    setTimeout(() => notice.remove(), 300);
  }, 4500);
}

// ==========================================
// --- KANBAN BOARD ---
// ==========================================

async function loadAndRenderBoard(isMyTasksOnly = false) {
  const main = $('#view-content');
  const isAdmin = state.user.profile === 'Administrador';

  let filterIds = null;
  if (isMyTasksOnly) {
    filterIds = [state.user.id];
  } else if (isAdmin && state.selectedOwnerFilters.length > 0) {
    filterIds = state.selectedOwnerFilters;
  }

  try {
    const data = await API.tasks.list(filterIds);
    state.tasks = data.tasks || [];
  } catch (err) {
    showNotice(err.message, 'error');
    return;
  }

  const grouped = {
    'Demanda': state.tasks.filter((t) => t.status === 'Demanda'),
    'Em andamento': state.tasks.filter((t) => t.status === 'Em andamento'),
    'Realizado': state.tasks.filter((t) => t.status === 'Realizado')
  };

  const pageTitle = isMyTasksOnly
    ? 'Minhas Demandas'
    : (isAdmin ? 'Operação Geral' : 'Minhas Demandas');

  const pageLede = isMyTasksOnly
    ? 'Acompanhamento focado nas tarefas atribuídas diretamente a você.'
    : (isAdmin
      ? 'Acompanhe todas as demandas da equipe, filtre por pessoa e mova os cards entre as etapas.'
      : 'Acompanhe seu fluxo diário de trabalho, atualize o avanço e mova suas demandas.');

  let filterBarHtml = '';
  if (isAdmin && !isMyTasksOnly && state.usersList.length > 0) {
    filterBarHtml = `
      <div class="filter-bar">
        <span class="filter-title">Filtrar responsáveis:</span>
        <div class="filter-options">
          ${state.usersList.map((u) => {
            const isChecked = state.selectedOwnerFilters.includes(u.id);
            return `
              <label class="filter-chip">
                <input type="checkbox" value="${u.id}" ${isChecked ? 'checked' : ''} onchange="handleFilterChange(this)" />
                <span>${escapeHtml(u.name)}</span>
              </label>
            `;
          }).join('')}
          ${state.selectedOwnerFilters.length > 0 ? `
            <button class="text-button" onclick="clearOwnerFilters()" style="font-size:12px; margin-left:8px;">Limpar filtros</button>
          ` : ''}
        </div>
      </div>
    `;
  }

  const welcomeCardHtml = state.tasks.length === 0 ? `
    <div class="welcome-card">
      <div class="welcome-content">
        <h2>👋 Olá, ${escapeHtml(state.user.name)}! Seja bem-vindo(a) à sua Mesa de Trabalho.</h2>
        <p>Seu quadro está limpo para hoje. Clique no botão <strong>+ Nova Demanda</strong> acima para registrar sua primeira tarefa.</p>
      </div>
    </div>
  ` : '';

  main.innerHTML = `
    <div class="page-heading">
      <div>
        <p class="eyebrow">Mesa de Trabalho</p>
        <h1>${pageTitle}</h1>
        <p class="lede">${pageLede}</p>
      </div>
      <button class="button button-primary" id="btn-create-task-head" onclick="openTaskModal()">
        + Nova Demanda
      </button>
    </div>

    ${welcomeCardHtml}
    ${filterBarHtml}

    <div class="board">
      ${renderLane('Demanda', '01', 'Novas demandas registradas que aguardam início.', grouped['Demanda'])}
      ${renderLane('Em andamento', '02', 'Demandas em execução ativa pelo responsável.', grouped['Em andamento'])}
      ${renderLane('Realizado', '03', 'Demandas concluídas com 100% de avanço.', grouped['Realizado'])}
    </div>
  `;

  attachDragAndDropHandlers();
}

function renderLane(status, indexStr, desc, laneTasks) {
  return `
    <section class="lane" data-status="${status}">
      <div class="lane-header">
        <div>
          <span class="lane-index">${indexStr}</span>
          <h2>${status}</h2>
        </div>
        <span class="count">${laneTasks.length}</span>
      </div>
      <p class="lane-description">${desc}</p>
      <div class="drop-zone" data-status="${status}">
        ${laneTasks.length === 0 ? `
          <div class="drop-hint">Arraste uma demanda para cá.</div>
        ` : laneTasks.map((t) => renderCard(t)).join('')}
      </div>
    </section>
  `;
}

function renderCard(task) {
  const priorityClass = `priority-${task.priority.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`;
  const dueDateStr = task.due_date ? formatDate(task.due_date) : '';

  return `
    <article class="task-card" draggable="true" data-task-id="${task.id}" data-status="${task.status}" onclick="handleCardClick(${task.id})">
      <div class="task-card-inner">
        <div class="card-topline">
          <span class="priority ${priorityClass}">${escapeHtml(task.priority)}</span>
          <span class="drag-handle" title="Arraste para mover">⋮⋮</span>
        </div>
        <h3>${escapeHtml(task.title)}</h3>
        ${task.description ? `<p>${escapeHtml(task.description)}</p>` : '<p style="min-height:18px;"></p>'}
        <div class="progress-meta">
          <span>Avanço</span>
          <strong>${task.progress}%</strong>
        </div>
        <div class="progress">
          <span style="transform: scaleX(${task.progress / 100});"></span>
        </div>
        <div class="card-footer">
          <span class="card-owner">👤 ${escapeHtml(task.owner_name || 'Desconhecido')}</span>
          ${dueDateStr ? `<span class="card-due">📅 ${dueDateStr}</span>` : ''}
        </div>
      </div>
    </article>
  `;
}

function handleFilterChange(checkbox) {
  const id = parseInt(checkbox.value, 10);
  if (checkbox.checked) {
    if (!state.selectedOwnerFilters.includes(id)) {
      state.selectedOwnerFilters.push(id);
    }
  } else {
    state.selectedOwnerFilters = state.selectedOwnerFilters.filter((x) => x !== id);
  }
  loadAndRenderBoard(state.currentView === 'my_tasks');
}

function clearOwnerFilters() {
  state.selectedOwnerFilters = [];
  loadAndRenderBoard(state.currentView === 'my_tasks');
}

// --- Drag & Drop Implementation ---
let draggedTaskId = null;

function attachDragAndDropHandlers() {
  const cards = $$('.task-card');
  cards.forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      draggedTaskId = card.dataset.taskId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedTaskId);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedTaskId = null;
      $$('.drop-zone').forEach((dz) => dz.classList.remove('is-over'));
    });
  });

  const dropZones = $$('.drop-zone');
  dropZones.forEach((zone) => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('is-over');
    });

    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) {
        zone.classList.remove('is-over');
      }
    });

    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      const targetStatus = zone.dataset.status;
      const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;

      if (!taskId || !targetStatus) return;

      const currentCard = $(`[data-task-id="${taskId}"]`);
      if (currentCard && currentCard.dataset.status === targetStatus) {
        return; // mesmo status
      }

      try {
        const result = await API.tasks.moveStatus(taskId, targetStatus);
        showNotice(`Demanda movida para ${targetStatus}.`, 'success');
        // "Após um arraste bem-sucedido, recarregar os dados do servidor."
        await loadAndRenderBoard(state.currentView === 'my_tasks');
      } catch (err) {
        showNotice(err.message, 'error');
      }
    });
  });
}

function handleCardClick(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (task) {
    openTaskModal(task);
  }
}

// ==========================================
// --- TASK CREATE / EDIT MODAL ---
// ==========================================

function openTaskModal(task = null) {
  state.editingTask = task;
  const isEdit = Boolean(task);
  const isAdmin = state.user.profile === 'Administrador';

  let modalHtml = `
    <div class="dialog-overlay" id="task-modal-overlay" onclick="closeModalOnBackdrop(event, this)">
      <div class="dialog">
        <div class="dialog-header">
          <h2>${isEdit ? 'Editar Demanda' : 'Nova Demanda'}</h2>
          <button class="icon-button" onclick="closeModal()">×</button>
        </div>
        <form id="task-form" onsubmit="handleTaskSubmit(event)" class="form-grid">
          <label>
            Título da Demanda *
            <input type="text" name="title" required value="${isEdit ? escapeHtml(task.title) : ''}" placeholder="Ex: Ajustar alinhamento no relatório" />
          </label>

          <label>
            Descrição
            <textarea name="description" rows="3" placeholder="Contexto, objetivo ou detalhes operacionais...">${isEdit ? escapeHtml(task.description || '') : ''}</textarea>
          </label>

          <div class="three-fields">
            <label>
              Etapa
              <select name="status" id="task-status-select" onchange="handleStatusChange(this)">
                <option value="Demanda" ${isEdit && task.status === 'Demanda' ? 'selected' : ''}>Demanda</option>
                <option value="Em andamento" ${isEdit && task.status === 'Em andamento' ? 'selected' : (!isEdit ? '' : '')}>Em andamento</option>
                <option value="Realizado" ${isEdit && task.status === 'Realizado' ? 'selected' : ''}>Realizado</option>
              </select>
            </label>

            <label>
              Avanço (%)
              <input type="number" name="progress" id="task-progress-input" min="0" max="100" value="${isEdit ? task.progress : 0}" />
            </label>

            <label>
              Prioridade
              <select name="priority">
                <option value="Alta" ${isEdit && task.priority === 'Alta' ? 'selected' : ''}>Alta</option>
                <option value="Média" ${!isEdit || task.priority === 'Média' ? 'selected' : ''}>Média</option>
                <option value="Baixa" ${isEdit && task.priority === 'Baixa' ? 'selected' : ''}>Baixa</option>
              </select>
            </label>
          </div>

          <div class="two-fields">
            <label>
              Prazo Estimado
              <input type="date" name="due_date" value="${isEdit && task.due_date ? task.due_date : ''}" />
            </label>

            ${isAdmin ? `
              <label>
                Responsável
                <select name="owner_id">
                  ${state.usersList.map((u) => `
                    <option value="${u.id}" ${isEdit ? (task.owner_id === u.id ? 'selected' : '') : (u.id === state.user.id ? 'selected' : '')}>
                      ${escapeHtml(u.name)} (${escapeHtml(u.profile)})
                    </option>
                  `).join('')}
                </select>
              </label>
            ` : `
              <input type="hidden" name="owner_id" value="${state.user.id}" />
            `}
          </div>

          ${isAdmin ? `
            <label>
              Observações da Reunião
              <textarea name="meeting_notes" rows="2" placeholder="Notas e alinhamentos de pauta...">${isEdit ? escapeHtml(task.meeting_notes || '') : ''}</textarea>
            </label>
          ` : ''}

          <div class="form-actions">
            <div>
              ${isEdit ? `
                <button type="button" class="button button-danger" onclick="handleTaskDelete(${task.id})">Excluir</button>
              ` : ''}
            </div>
            <div class="form-actions-right">
              <button type="button" class="button button-secondary" onclick="closeModal()">Cancelar</button>
              <button type="submit" class="button button-primary">Salvar</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function handleStatusChange(select) {
  const progressInput = $('#task-progress-input');
  if (select.value === 'Realizado') {
    progressInput.value = 100;
  }
}

async function handleTaskSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const payload = {
    title: formData.get('title'),
    description: formData.get('description'),
    status: formData.get('status'),
    progress: parseInt(formData.get('progress') || '0', 10),
    priority: formData.get('priority'),
    due_date: formData.get('due_date') || null,
    owner_id: formData.get('owner_id') ? parseInt(formData.get('owner_id'), 10) : undefined,
    meeting_notes: formData.get('meeting_notes') || ''
  };

  try {
    if (state.editingTask) {
      await API.tasks.update(state.editingTask.id, payload);
      showNotice('Demanda atualizada.', 'success');
    } else {
      await API.tasks.create(payload);
      showNotice('Demanda criada com sucesso.', 'success');
    }
    closeModal();
    if (state.currentView === 'meeting') {
      await loadAndRenderMeeting();
    } else {
      await loadAndRenderBoard(state.currentView === 'my_tasks');
    }
  } catch (err) {
    showNotice(err.message, 'error');
  }
}

function handleTaskDelete(taskId) {
  openDeleteTaskModal(taskId);
}

function openDeleteTaskModal(taskId) {
  const task = state.tasks.find((t) => t.id === taskId) || state.editingTask;
  const title = task ? task.title : 'esta demanda';

  const modalHtml = `
    <div class="dialog-overlay" id="confirm-task-modal-overlay" onclick="closeModalOnBackdrop(event, this)">
      <div class="dialog" style="max-width: 460px;">
        <div class="dialog-header">
          <h2>Excluir Demanda</h2>
          <button class="icon-button" onclick="closeModal()">×</button>
        </div>
        <div style="padding: 24px;">
          <p style="margin: 0 0 12px; font-size: 16px; color: var(--ink);">
            Tem certeza que deseja excluir a demanda <strong>${escapeHtml(title)}</strong>?
          </p>
          <p style="margin: 0 0 20px; font-size: 13px; color: var(--muted); line-height: 1.4;">
            Esta ação removerá permanentemente a demanda do quadro e da ata de reunião.
          </p>
          <div class="form-actions" style="border: 0; padding-top: 0; margin-top: 16px; justify-content: flex-end;">
            <div style="display: flex; gap: 8px;">
              <button type="button" class="button button-secondary" onclick="closeModal()">Cancelar</button>
              <button type="button" class="button button-primary" style="background: var(--red); color: white;" onclick="executeDeleteTask(${taskId})">Sim, Excluir</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function executeDeleteTask(taskId) {
  try {
    await API.tasks.delete(taskId);
    showNotice('Demanda excluída.', 'success');
    closeModal();
    if (state.currentView === 'meeting') {
      await loadAndRenderMeeting();
    } else {
      await loadAndRenderBoard(state.currentView === 'my_tasks');
    }
  } catch (err) {
    showNotice(err.message, 'error');
    closeModal();
  }
}

function closeModal() {
  document.querySelectorAll('.dialog-overlay').forEach((el) => el.remove());
}

function closeModalOnBackdrop(e, element) {
  if (e.target === element) {
    closeModal();
  }
}

// ==========================================
// --- MEETING VIEW (ADMIN) ---
// ==========================================

async function loadAndRenderMeeting() {
  const main = $('#view-content');
  try {
    const data = await API.meeting.list();
    state.meetingTasks = data.tasks || [];
  } catch (err) {
    showNotice(err.message, 'error');
    return;
  }

  main.innerHTML = `
    <div class="page-heading compact">
      <div>
        <p class="eyebrow">Alinhamento Operacional</p>
        <h1>Mesa de Reunião</h1>
        <p class="lede">Revise todas as demandas em pauta, alinhe novos prazos e registre os combinados diretamente na ata.</p>
      </div>
    </div>

    <div class="meeting-container">
      <div class="meeting-header-row">
        <div>Prioridade</div>
        <div>Demanda / Descrição</div>
        <div>Responsável</div>
        <div>Etapa</div>
        <div>Observações da Reunião</div>
        <div>Prazo Alinhado</div>
        <div>Ação</div>
      </div>
      ${state.meetingTasks.length === 0 ? `
        <div style="padding: 40px; text-align:center; color: var(--muted);">Nenhuma demanda registrada no sistema.</div>
      ` : state.meetingTasks.map((t) => renderMeetingRow(t)).join('')}
    </div>
  `;
}

function renderMeetingRow(task) {
  const priorityClass = `priority-${task.priority.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`;
  return `
    <div class="meeting-row" id="meeting-row-${task.id}">
      <div>
        <span class="priority ${priorityClass}">${escapeHtml(task.priority)}</span>
      </div>
      <div>
        <div class="meeting-demand-title">${escapeHtml(task.title)}</div>
        ${task.description ? `<div class="meeting-demand-desc">${escapeHtml(task.description)}</div>` : ''}
      </div>
      <div>
        <strong>${escapeHtml(task.owner_name)}</strong>
      </div>
      <div class="meeting-progress-col">
        <span>${escapeHtml(task.status)} (${task.progress}%)</span>
        <div class="progress" style="margin:0;">
          <span style="transform: scaleX(${task.progress / 100}); ${task.status === 'Realizado' ? 'background: var(--green);' : ''}"></span>
        </div>
      </div>
      <div>
        <textarea id="meeting-notes-${task.id}" rows="2" placeholder="Registrar alinhamento...">${escapeHtml(task.meeting_notes || '')}</textarea>
      </div>
      <div>
        <input type="date" id="meeting-due-${task.id}" value="${task.due_date || ''}" />
      </div>
      <div>
        <button class="button button-primary button-sm" onclick="saveMeetingRow(${task.id})">Salvar</button>
      </div>
    </div>
  `;
}

async function saveMeetingRow(taskId) {
  const notesInput = $(`#meeting-notes-${taskId}`);
  const dueInput = $(`#meeting-due-${taskId}`);

  try {
    await API.meeting.update(taskId, {
      meeting_notes: notesInput.value,
      due_date: dueInput.value || null
    });
    showNotice('Alinhamento de reunião salvo com sucesso.', 'success');
  } catch (err) {
    showNotice(err.message, 'error');
  }
}

// ==========================================
// --- USERS MANAGEMENT (ADMIN) ---
// ==========================================

async function loadUsersList() {
  try {
    const data = await API.users.list();
    state.usersList = data.users || [];
  } catch (err) {
    console.error('Falha ao listar usuários:', err);
  }
}

async function loadAndRenderUsers() {
  const main = $('#view-content');
  await loadUsersList();

  main.innerHTML = `
    <div class="page-heading compact">
      <div>
        <p class="eyebrow">Administração</p>
        <h1>Pessoas e Acessos</h1>
        <p class="lede">Gerencie as contas de acesso à mesa, atribua perfis de permissão e cadastre novos colaboradores.</p>
      </div>
    </div>

    <div class="people-layout">
      <!-- Formulário de cadastro de usuário -->
      <section class="person-form">
        <h2>Cadastrar Nova Pessoa</h2>
        <form onsubmit="handleCreateUser(event)" class="form-grid" style="padding:0;">
          <label>
            Nome Completo *
            <input type="text" name="name" required placeholder="Ex: Mariana Silva" />
          </label>

          <label>
            E-mail Profissional *
            <input type="email" name="email" required placeholder="mariana@empresa.com" />
          </label>

          <label>
            Perfil de Permissão
            <select name="profile">
              <option value="Colaborador">Colaborador (Visualiza e edita apenas as próprias)</option>
              <option value="Administrador">Administrador (Acesso total, reunião e gestão)</option>
              <option value="Visualizador">Visualizador (Acompanha próprias demandas)</option>
            </select>
          </label>

          <label>
            Senha Inicial (mínimo 8 caracteres) *
            <input type="password" name="password" required minlength="8" placeholder="••••••••" />
          </label>

          <div style="margin-top:8px;">
            <button type="submit" class="button button-primary" style="width:100%;">Cadastrar Pessoa</button>
          </div>
        </form>
      </section>

      <!-- Lista de usuários -->
      <section class="people-list">
        <h2>Pessoas Cadastradas (${state.usersList.length})</h2>
        <div>
          ${state.usersList.map((u) => renderPersonRow(u)).join('')}
        </div>
      </section>
    </div>
  `;
}

function renderPersonRow(user) {
  const initials = user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  const isSelf = user.id === state.user.id;

  return `
    <div class="person-row">
      <div class="avatar">${initials}</div>
      <div class="person-info">
        <h3>${escapeHtml(user.name)} ${isSelf ? '<span style="font-size:12px; color:var(--blue); font-weight:normal;">(Você)</span>' : ''}</h3>
        <p>${escapeHtml(user.email)} • ${user.task_count || 0} demanda(s) atribuída(s)</p>
      </div>
      <div>
        <span class="person-profile-badge">${escapeHtml(user.profile)}</span>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="button button-secondary button-sm" onclick="openEditUserModal(${user.id})">Editar</button>
        ${!isSelf ? `
          <button class="button button-danger button-sm" onclick="openDeleteUserModal(${user.id})">Excluir</button>
        ` : ''}
      </div>
    </div>
  `;
}

async function handleCreateUser(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const payload = {
    name: formData.get('name'),
    email: formData.get('email'),
    profile: formData.get('profile'),
    password: formData.get('password')
  };

  try {
    await API.users.create(payload);
    showNotice('Pessoa cadastrada com sucesso.', 'success');
    form.reset();
    await loadAndRenderUsers();
  } catch (err) {
    showNotice(err.message, 'error');
  }
}

function openEditUserModal(userId) {
  const user = state.usersList.find((u) => u.id === userId);
  if (!user) return;
  state.editingUser = user;

  const modalHtml = `
    <div class="dialog-overlay" id="user-modal-overlay" onclick="closeModalOnBackdrop(event, this)">
      <div class="dialog" style="max-width:480px;">
        <div class="dialog-header">
          <h2>Editar Pessoa</h2>
          <button class="icon-button" onclick="closeModal()">×</button>
        </div>
        <form onsubmit="handleEditUserSubmit(event)" class="form-grid">
          <label>
            Nome *
            <input type="text" name="name" required value="${escapeHtml(user.name)}" />
          </label>

          <label>
            E-mail *
            <input type="email" name="email" required value="${escapeHtml(user.email)}" />
          </label>

          <label>
            Perfil
            <select name="profile">
              <option value="Colaborador" ${user.profile === 'Colaborador' ? 'selected' : ''}>Colaborador</option>
              <option value="Administrador" ${user.profile === 'Administrador' ? 'selected' : ''}>Administrador</option>
              <option value="Visualizador" ${user.profile === 'Visualizador' ? 'selected' : ''}>Visualizador</option>
            </select>
          </label>

          <label>
            Nova Senha (deixe em branco para manter a atual)
            <input type="password" name="password" minlength="8" placeholder="Opcional (mínimo 8 caracteres)" />
          </label>

          <div class="form-actions">
            <div></div>
            <div class="form-actions-right">
              <button type="button" class="button button-secondary" onclick="closeModal()">Cancelar</button>
              <button type="submit" class="button button-primary">Salvar Alterações</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function handleEditUserSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const payload = {
    name: formData.get('name'),
    email: formData.get('email'),
    profile: formData.get('profile')
  };
  const pwd = formData.get('password');
  if (pwd && pwd.trim().length > 0) {
    payload.password = pwd.trim();
  }

  try {
    await API.users.update(state.editingUser.id, payload);
    showNotice('Cadastro atualizado com sucesso.', 'success');
    closeModal();
    await loadAndRenderUsers();
  } catch (err) {
    showNotice(err.message, 'error');
  }
}

function openDeleteUserModal(userId) {
  const user = state.usersList.find((u) => u.id === userId);
  if (!user) return;

  const modalHtml = `
    <div class="dialog-overlay" id="confirm-user-modal-overlay" onclick="closeModalOnBackdrop(event, this)">
      <div class="dialog" style="max-width: 460px;">
        <div class="dialog-header">
          <h2>Excluir Pessoa</h2>
          <button class="icon-button" onclick="closeModal()">×</button>
        </div>
        <div style="padding: 24px;">
          <p style="margin: 0 0 12px; font-size: 16px; color: var(--ink);">
            Tem certeza que deseja excluir <strong>${escapeHtml(user.name)}</strong>?
          </p>
          <p style="margin: 0 0 20px; font-size: 13px; color: var(--muted); line-height: 1.4;">
            Esta ação não pode ser desfeita. Se esta pessoa tiver demandas vinculadas, a exclusão será bloqueada para preservar o histórico.
          </p>
          <div class="form-actions" style="border: 0; padding-top: 0; margin-top: 16px; justify-content: flex-end;">
            <div style="display: flex; gap: 8px;">
              <button type="button" class="button button-secondary" onclick="closeModal()">Cancelar</button>
              <button type="button" class="button button-primary" style="background: var(--red); color: white;" onclick="executeDeleteUser(${user.id})">Sim, Excluir</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function executeDeleteUser(userId) {
  try {
    await API.users.delete(userId);
    showNotice('Pessoa removida com sucesso.', 'success');
    closeModal();
    await loadAndRenderUsers();
  } catch (err) {
    showNotice(err.message, 'error');
    closeModal();
  }
}

// ==========================================
// --- AUTHENTICATION VIEWS ---
// ==========================================

function renderAuthView() {
  $('#app-topbar').style.display = 'none';
  $('#app-container').style.display = 'none';
  const container = $('#auth-container');
  container.style.display = 'flex';

  const mode = state.authMode;
  let cardHtml = '';

  if (mode === 'setup') {
    cardHtml = `
      <div class="auth-card">
        <p class="eyebrow">Primeiro Acesso</p>
        <h1>Configuração Inicial</h1>
        <p class="subtitle">Cadastre o primeiro administrador do sistema para iniciar o uso da Mesa de Demandas.</p>
        <form onsubmit="handleAuthSubmit(event, 'setup')" class="form-grid" style="padding:0;">
          <label>
            Nome Completo
            <input type="text" name="name" required placeholder="Ex: Administrador do Sistema" />
          </label>
          <label>
            E-mail
            <input type="email" name="email" required placeholder="admin@empresa.com" />
          </label>
          <label>
            Senha (mínimo 8 caracteres)
            <input type="password" name="password" required minlength="8" placeholder="••••••••" />
          </label>
          <label>
            Confirmar Senha
            <input type="password" name="confirm_password" required minlength="8" placeholder="••••••••" />
          </label>
          <div style="margin-top:12px;">
            <button type="submit" class="button button-primary" style="width:100%;">Criar Administrador e Iniciar</button>
          </div>
        </form>
      </div>
    `;
  } else if (mode === 'register') {
    cardHtml = `
      <div class="auth-card">
        <p class="eyebrow">Cadastro Público</p>
        <h1>Criar Conta de Colaborador</h1>
        <p class="subtitle">Cadastre-se para acompanhar e registrar suas próprias demandas de trabalho.</p>
        <form onsubmit="handleAuthSubmit(event, 'register')" class="form-grid" style="padding:0;">
          <label>
            Nome Completo
            <input type="text" name="name" required placeholder="Ex: Carlos Eduardo" />
          </label>
          <label>
            E-mail
            <input type="email" name="email" required placeholder="carlos@empresa.com" />
          </label>
          <label>
            Senha (mínimo 8 caracteres)
            <input type="password" name="password" required minlength="8" placeholder="••••••••" />
          </label>
          <label>
            Confirmar Senha
            <input type="password" name="confirm_password" required minlength="8" placeholder="••••••••" />
          </label>
          <div style="margin-top:12px;">
            <button type="submit" class="button button-primary" style="width:100%;">Cadastrar e Entrar</button>
          </div>
        </form>
        <div class="auth-links">
          <span>Já possui uma conta? <a data-auth-switch="login">Fazer login</a></span>
        </div>
      </div>
    `;
  } else if (mode === 'reset') {
    cardHtml = `
      <div class="auth-card">
        <p class="eyebrow">Segurança</p>
        <h1>Redefinir Senha</h1>
        <p class="subtitle">Informe seu e-mail cadastrado e defina uma nova senha para sua conta.</p>
        <form onsubmit="handleAuthSubmit(event, 'reset')" class="form-grid" style="padding:0;">
          <label>
            E-mail Cadastrado
            <input type="email" name="email" required placeholder="seuemail@empresa.com" />
          </label>
          <label>
            Nova Senha (mínimo 8 caracteres)
            <input type="password" name="password" required minlength="8" placeholder="••••••••" />
          </label>
          <label>
            Confirmar Nova Senha
            <input type="password" name="confirm_password" required minlength="8" placeholder="••••••••" />
          </label>
          <div style="margin-top:12px;">
            <button type="submit" class="button button-primary" style="width:100%;">Salvar Nova Senha</button>
          </div>
        </form>
        <div class="auth-links">
          <span>Lembrou sua senha? <a data-auth-switch="login">Voltar ao Login</a></span>
        </div>
      </div>
    `;
  } else {
    // Login
    cardHtml = `
      <div class="auth-card">
        <p class="eyebrow">Mesa de Trabalho</p>
        <h1>Entrar na Mesa</h1>
        <p class="subtitle">Acesse sua conta para visualizar e organizar suas demandas diárias.</p>
        <form onsubmit="handleAuthSubmit(event, 'login')" class="form-grid" style="padding:0;">
          <label>
            E-mail
            <input type="email" name="email" required placeholder="seuemail@empresa.com" />
          </label>
          <label>
            Senha
            <input type="password" name="password" required placeholder="••••••••" />
          </label>
          <div style="margin-top:12px;">
            <button type="submit" class="button button-primary" style="width:100%;">Entrar na Conta</button>
          </div>
        </form>
        <div class="auth-links">
          <span><a data-auth-switch="reset">Esqueceu sua senha? Redefinir</a></span>
          <span>Ainda não é cadastrado? <a data-auth-switch="register">Faça o cadastro aqui</a></span>
        </div>
      </div>
    `;
  }

  container.innerHTML = cardHtml;
}

async function handleAuthSubmit(e, actionType) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  try {
    if (actionType === 'setup') {
      const res = await API.auth.setup(Object.fromEntries(formData));
      state.user = res.user;
      showNotice('Configuração inicial concluída com sucesso.', 'success');
      await checkAuthStatus();
    } else if (actionType === 'register') {
      const res = await API.auth.register(Object.fromEntries(formData));
      state.user = res.user;
      showNotice('Conta criada com sucesso! Bem-vindo(a).', 'success');
      await checkAuthStatus();
    } else if (actionType === 'login') {
      const res = await API.auth.login(Object.fromEntries(formData));
      state.user = res.user;
      showNotice('Login efetuado com sucesso.', 'success');
      await checkAuthStatus();
    } else if (actionType === 'reset') {
      const res = await API.auth.resetPassword(Object.fromEntries(formData));
      showNotice(res.message || 'Senha alterada com sucesso.', 'success');
      state.authMode = 'login';
      renderAuthView();
    }
  } catch (err) {
    showNotice(err.message, 'error');
  }
}

// --- Helpers ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dateIso) {
  if (!dateIso) return '';
  const parts = dateIso.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateIso;
}
