const express = require('express');
const { hashPassword } = require('../auth');

function createUserRoutes(db, { requireAdmin }) {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/', (req, res) => {
    try {
      const users = db.listUsers();
      res.json({ users });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/', (req, res) => {
    try {
      const { name, email, profile, password } = req.body || {};
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Nome é obrigatório.' });
      }
      if (!email || !email.trim()) {
        return res.status(400).json({ error: 'E-mail é obrigatório.' });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'A senha deve ter no mínimo 8 caracteres.' });
      }

      const passwordHash = hashPassword(password);
      const user = db.createUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        profile: profile || 'Colaborador',
        password_hash: passwordHash
      });

      res.status(201).json({ user });
    } catch (error) {
      const msg = error.message.includes('UNIQUE') ? 'Este e-mail já está cadastrado.' : error.message;
      res.status(400).json({ error: msg });
    }
  });

  router.put('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, email, profile, password } = req.body || {};

      let passwordHash = undefined;
      if (password && password.trim().length > 0) {
        if (password.length < 8) {
          return res.status(400).json({ error: 'A nova senha deve ter no mínimo 8 caracteres.' });
        }
        passwordHash = hashPassword(password);
      }

      const user = db.updateUser(id, {
        name,
        email,
        profile,
        password_hash: passwordHash
      });

      res.json({ user });
    } catch (error) {
      const msg = error.message.includes('UNIQUE') ? 'Este e-mail já está cadastrado.' : error.message;
      res.status(400).json({ error: msg });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (req.user.id === id) {
        return res.status(400).json({ error: 'O administrador não pode remover a própria conta.' });
      }

      db.deleteUser(id);
      res.json({ message: 'Pessoa removida com sucesso.' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}

module.exports = {
  createUserRoutes
};
