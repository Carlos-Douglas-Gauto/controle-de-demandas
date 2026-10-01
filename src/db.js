const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const STATUSES = ['Demanda', 'Em andamento', 'Realizado'];
const PRIORITIES = ['Alta', 'Média', 'Baixa'];
const PROFILES = ['Administrador', 'Colaborador', 'Visualizador'];

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath || process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initialize();
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        email TEXT NOT NULL UNIQUE CHECK(length(trim(email)) > 0),
        profile TEXT NOT NULL DEFAULT 'Colaborador'
          CHECK(profile IN ('Administrador', 'Colaborador', 'Visualizador')),
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Demanda'
          CHECK(status IN ('Demanda', 'Em andamento', 'Realizado')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
        priority TEXT NOT NULL DEFAULT 'Média'
          CHECK(priority IN ('Alta', 'Média', 'Baixa')),
        due_date TEXT,
        meeting_notes TEXT NOT NULL DEFAULT '',
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
  }

  now() {
    return new Date().toISOString();
  }

  hasAdminWithPassword() {
    const stmt = this.db.prepare(`
      SELECT id FROM users
      WHERE profile = 'Administrador' AND length(password_hash) > 0
      LIMIT 1
    `);
    return Boolean(stmt.get());
  }

  getUserByEmail(email) {
    if (!email) return null;
    const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email.trim().toLowerCase()) || null;
  }

  getUserById(id) {
    const stmt = this.db.prepare('SELECT id, name, email, profile, created_at FROM users WHERE id = ?');
    return stmt.get(id) || null;
  }

  getUserWithPasswordById(id) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id) || null;
  }

  listUsers() {
    const stmt = this.db.prepare(`
      SELECT u.id, u.name, u.email, u.profile, u.created_at,
             COUNT(t.id) AS task_count
      FROM users u
      LEFT JOIN tasks t ON t.owner_id = u.id
      GROUP BY u.id
      ORDER BY u.name COLLATE NOCASE ASC
    `);
    return stmt.all();
  }

  createUser({ name, email, profile, password_hash }) {
    const trimmedName = (name || '').trim();
    const normalizedEmail = (email || '').trim().toLowerCase();
    const chosenProfile = profile || 'Colaborador';

    if (!trimmedName) throw new Error('Nome é obrigatório.');
    if (!normalizedEmail) throw new Error('E-mail é obrigatório.');
    if (!PROFILES.includes(chosenProfile)) throw new Error('Perfil inválido.');
    if (!password_hash) throw new Error('Senha é obrigatória.');

    const stmt = this.db.prepare(`
      INSERT INTO users (name, email, profile, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(trimmedName, normalizedEmail, chosenProfile, password_hash, this.now());
    return this.getUserById(result.lastInsertRowid);
  }

  updateUser(id, { name, email, profile, password_hash }) {
    const existing = this.getUserWithPasswordById(id);
    if (!existing) throw new Error('Pessoa não encontrada.');

    const trimmedName = name !== undefined ? name.trim() : existing.name;
    const normalizedEmail = email !== undefined ? email.trim().toLowerCase() : existing.email;
    const chosenProfile = profile !== undefined ? profile : existing.profile;
    const hash = password_hash || existing.password_hash;

    if (!trimmedName) throw new Error('Nome é obrigatório.');
    if (!normalizedEmail) throw new Error('E-mail é obrigatório.');
    if (!PROFILES.includes(chosenProfile)) throw new Error('Perfil inválido.');

    const stmt = this.db.prepare(`
      UPDATE users
      SET name = ?, email = ?, profile = ?, password_hash = ?
      WHERE id = ?
    `);
    stmt.run(trimmedName, normalizedEmail, chosenProfile, hash, id);
    return this.getUserById(id);
  }

  deleteUser(id) {
    const taskCountStmt = this.db.prepare('SELECT COUNT(*) as count FROM tasks WHERE owner_id = ?');
    const { count } = taskCountStmt.get(id);
    if (count > 0) {
      throw new Error('Não é possível remover uma pessoa que possui demandas.');
    }

    const stmt = this.db.prepare('DELETE FROM users WHERE id = ?');
    const res = stmt.run(id);
    if (res.changes === 0) {
      throw new Error('Pessoa não encontrada.');
    }
    return true;
  }

  listTasks(user, filterOwnerIds = null) {
    let whereClause = '';
    const params = [];

    if (user.profile !== 'Administrador') {
      whereClause = 'WHERE tasks.owner_id = ?';
      params.push(user.id);
    } else if (Array.isArray(filterOwnerIds) && filterOwnerIds.length > 0) {
      const placeholders = filterOwnerIds.map(() => '?').join(',');
      whereClause = `WHERE tasks.owner_id IN (${placeholders})`;
      params.push(...filterOwnerIds);
    }

    const query = `
      SELECT tasks.*,
             users.name AS owner_name,
             users.email AS owner_email,
             users.profile AS owner_profile
      FROM tasks
      JOIN users ON users.id = tasks.owner_id
      ${whereClause}
      ORDER BY
        CASE priority WHEN 'Alta' THEN 1 WHEN 'Média' THEN 2 ELSE 3 END ASC,
        CASE WHEN due_date IS NOT NULL AND due_date != '' THEN 0 ELSE 1 END ASC,
        due_date ASC,
        updated_at DESC
    `;
    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  getTask(id) {
    const stmt = this.db.prepare(`
      SELECT tasks.*,
             users.name AS owner_name,
             users.email AS owner_email,
             users.profile AS owner_profile
      FROM tasks
      JOIN users ON users.id = tasks.owner_id
      WHERE tasks.id = ?
    `);
    return stmt.get(id) || null;
  }

  createTask(data, user) {
    const title = (data.title || '').trim();
    if (!title) throw new Error('Título é obrigatório.');

    const description = (data.description || '').trim();
    const status = data.status || 'Demanda';
    if (!STATUSES.includes(status)) throw new Error('Status inválido.');

    const priority = data.priority || 'Média';
    if (!PRIORITIES.includes(priority)) throw new Error('Prioridade inválida.');

    let progress = Number.isInteger(Number(data.progress)) ? Number(data.progress) : 0;
    if (progress < 0 || progress > 100) throw new Error('Progresso deve estar entre 0 e 100.');
    if (status === 'Realizado') {
      progress = 100;
    }

    const dueDate = (data.due_date || '').trim() || null;
    const meetingNotes = (data.meeting_notes || '').trim();

    let ownerId = user.id;
    if (user.profile === 'Administrador' && data.owner_id) {
      ownerId = Number(data.owner_id);
    }

    const owner = this.getUserById(ownerId);
    if (!owner) throw new Error('Escolha uma pessoa responsável válida.');

    const now = this.now();
    const stmt = this.db.prepare(`
      INSERT INTO tasks (title, description, status, progress, priority, due_date, meeting_notes, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(title, description, status, progress, priority, dueDate, meetingNotes, ownerId, now, now);
    return this.getTask(result.lastInsertRowid);
  }

  updateTask(id, data, user) {
    const task = this.getTask(id);
    if (!task) throw new Error('Demanda não encontrada.');

    if (user.profile !== 'Administrador' && task.owner_id !== user.id) {
      throw new Error('Acesso negado: você só pode editar suas próprias demandas.');
    }

    const title = data.title !== undefined ? data.title.trim() : task.title;
    if (!title) throw new Error('Título é obrigatório.');

    const description = data.description !== undefined ? data.description.trim() : task.description;
    const status = data.status !== undefined ? data.status : task.status;
    if (!STATUSES.includes(status)) throw new Error('Status inválido.');

    const priority = data.priority !== undefined ? data.priority : task.priority;
    if (!PRIORITIES.includes(priority)) throw new Error('Prioridade inválida.');

    let progress = data.progress !== undefined ? Number(data.progress) : task.progress;
    if (progress < 0 || progress > 100) throw new Error('Progresso deve estar entre 0 e 100.');

    if (status === 'Realizado') {
      progress = 100;
    }

    const dueDate = data.due_date !== undefined ? (data.due_date.trim() || null) : task.due_date;
    const meetingNotes = data.meeting_notes !== undefined ? data.meeting_notes.trim() : task.meeting_notes;

    let ownerId = task.owner_id;
    if (user.profile === 'Administrador' && data.owner_id !== undefined) {
      ownerId = Number(data.owner_id);
      const owner = this.getUserById(ownerId);
      if (!owner) throw new Error('Escolha uma pessoa responsável válida.');
    }

    const stmt = this.db.prepare(`
      UPDATE tasks
      SET title = ?, description = ?, status = ?, progress = ?, priority = ?,
          due_date = ?, meeting_notes = ?, owner_id = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(title, description, status, progress, priority, dueDate, meetingNotes, ownerId, this.now(), id);
    return this.getTask(id);
  }

  moveTaskStatus(id, newStatus, user) {
    const task = this.getTask(id);
    if (!task) throw new Error('Demanda não encontrada.');

    if (user.profile !== 'Administrador' && task.owner_id !== user.id) {
      throw new Error('Acesso negado: você só pode mover suas próprias demandas.');
    }

    if (!STATUSES.includes(newStatus)) throw new Error('Status inválido.');

    let progress = task.progress;
    if (newStatus === 'Realizado') {
      progress = 100;
    }

    const stmt = this.db.prepare(`
      UPDATE tasks
      SET status = ?, progress = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(newStatus, progress, this.now(), id);

    return {
      id: task.id,
      status: newStatus,
      progress
    };
  }

  deleteTask(id, user) {
    const task = this.getTask(id);
    if (!task) throw new Error('Demanda não encontrada.');

    if (user.profile !== 'Administrador' && task.owner_id !== user.id) {
      throw new Error('Acesso negado: você só pode remover suas próprias demandas.');
    }

    const stmt = this.db.prepare('DELETE FROM tasks WHERE id = ?');
    stmt.run(id);
    return true;
  }

  listMeetingTasks() {
    const stmt = this.db.prepare(`
      SELECT tasks.*,
             users.name AS owner_name,
             users.email AS owner_email,
             users.profile AS owner_profile
      FROM tasks
      JOIN users ON users.id = tasks.owner_id
      ORDER BY
        CASE priority WHEN 'Alta' THEN 1 WHEN 'Média' THEN 2 ELSE 3 END ASC,
        CASE status WHEN 'Em andamento' THEN 1 WHEN 'Demanda' THEN 2 ELSE 3 END ASC,
        CASE WHEN due_date IS NOT NULL AND due_date != '' THEN 0 ELSE 1 END ASC,
        due_date ASC,
        updated_at DESC
    `);
    return stmt.all();
  }

  updateMeetingTask(id, { meeting_notes, due_date }) {
    const task = this.getTask(id);
    if (!task) throw new Error('Demanda não encontrada.');

    const notes = meeting_notes !== undefined ? meeting_notes.trim() : task.meeting_notes;
    const dueDate = due_date !== undefined ? (due_date.trim() || null) : task.due_date;

    const stmt = this.db.prepare(`
      UPDATE tasks
      SET meeting_notes = ?, due_date = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(notes, dueDate, this.now(), id);
    return this.getTask(id);
  }

  createSession(userId) {
    const crypto = require('node:crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO sessions (token, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(token, userId, now.toISOString(), expiresAt);
    return token;
  }

  getSession(token) {
    if (!token) return null;
    const stmt = this.db.prepare(`
      SELECT s.token, s.expires_at, u.id, u.name, u.email, u.profile
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `);
    const session = stmt.get(token);
    if (!session) return null;

    if (new Date(session.expires_at) < new Date()) {
      this.deleteSession(token);
      return null;
    }
    return session;
  }

  deleteSession(token) {
    if (!token) return;
    const stmt = this.db.prepare('DELETE FROM sessions WHERE token = ?');
    stmt.run(token);
  }

  close() {
    this.db.close();
  }
}

module.exports = {
  Database,
  STATUSES,
  PRIORITIES,
  PROFILES
};
