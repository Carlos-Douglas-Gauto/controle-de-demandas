const express = require('express');
const { hashPassword, verifyPassword } = require('../auth');

function createAuthRoutes(db) {
  const router = express.Router();

  function setSessionCookie(res, token) {
    res.cookie('session_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
  }

  router.get('/status', (req, res) => {
    const initialized = db.hasAdminWithPassword();
    res.json({
      initialized,
      user: req.user || null
    });
  });

  router.post('/setup', (req, res) => {
    try {
      if (db.hasAdminWithPassword()) {
        return res.status(400).json({ error: 'Configuração inicial já realizada.' });
      }

      const { name, email, password, confirm_password } = req.body || {};
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Nome é obrigatório.' });
      }
      if (!email || !email.trim()) {
        return res.status(400).json({ error: 'E-mail é obrigatório.' });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'A senha deve ter no mínimo 8 caracteres.' });
      }
      if (password !== confirm_password) {
        return res.status(400).json({ error: 'As senhas informadas não conferem.' });
      }

      const passwordHash = hashPassword(password);
      const user = db.createUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        profile: 'Administrador',
        password_hash: passwordHash
      });

      const token = db.createSession(user.id);
      setSessionCookie(res, token);

      res.status(201).json({ user });
    } catch (error) {
      const msg = error.message.includes('UNIQUE') ? 'Este e-mail já está cadastrado.' : error.message;
      res.status(400).json({ error: msg });
    }
  });

  router.post('/register', (req, res) => {
    try {
      const { name, email, password, confirm_password } = req.body || {};
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Nome é obrigatório.' });
      }
      if (!email || !email.trim()) {
        return res.status(400).json({ error: 'E-mail é obrigatório.' });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'A senha deve ter no mínimo 8 caracteres.' });
      }
      if (password !== confirm_password) {
        return res.status(400).json({ error: 'As senhas informadas não conferem.' });
      }

      const passwordHash = hashPassword(password);
      const user = db.createUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        profile: 'Colaborador',
        password_hash: passwordHash
      });

      const token = db.createSession(user.id);
      setSessionCookie(res, token);

      res.status(201).json({ user });
    } catch (error) {
      const msg = error.message.includes('UNIQUE') ? 'Este e-mail já está cadastrado.' : error.message;
      res.status(400).json({ error: msg });
    }
  });

  router.post('/login', (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
      }

      const user = db.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }

      const passwordValid = verifyPassword(password, user.password_hash);
      if (!passwordValid) {
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }

      const token = db.createSession(user.id);
      setSessionCookie(res, token);

      const safeUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        profile: user.profile,
        created_at: user.created_at
      };

      res.json({ user: safeUser });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/reset-password', (req, res) => {
    try {
      const { email, password, confirm_password } = req.body || {};
      if (!email || !email.trim()) {
        return res.status(400).json({ error: 'E-mail é obrigatório.' });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'A senha deve ter no mínimo 8 caracteres.' });
      }
      if (password !== confirm_password) {
        return res.status(400).json({ error: 'As senhas informadas não conferem.' });
      }

      const user = db.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({ error: 'Conta não encontrada para o e-mail informado.' });
      }

      const newHash = hashPassword(password);
      db.updateUser(user.id, { password_hash: newHash });

      res.json({ message: 'Senha atualizada com sucesso. Faça login com a nova senha.' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/logout', (req, res) => {
    const token = req.cookies?.session_token || req.user?.token;
    if (token) {
      db.deleteSession(token);
    }
    res.clearCookie('session_token', { path: '/' });
    res.json({ message: 'Sessão encerrada com sucesso.' });
  });

  router.get('/me', (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }
    res.json({ user: req.user });
  });

  return router;
}

module.exports = {
  createAuthRoutes
};
