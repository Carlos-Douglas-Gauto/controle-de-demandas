const express = require('express');

function createTaskRoutes(db, { requireAuth }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    try {
      let filterOwnerIds = null;
      if (req.user.profile === 'Administrador' && req.query.owner_ids) {
        const raw = Array.isArray(req.query.owner_ids)
          ? req.query.owner_ids.join(',')
          : String(req.query.owner_ids);
        filterOwnerIds = raw
          .split(',')
          .map((id) => parseInt(id.trim(), 10))
          .filter((id) => !isNaN(id));
      }

      const tasks = db.listTasks(req.user, filterOwnerIds);
      res.json({ tasks });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/', (req, res) => {
    try {
      const task = db.createTask(req.body || {}, req.user);
      res.status(201).json({ task });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const task = db.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Demanda não encontrada.' });
      }
      if (req.user.profile !== 'Administrador' && task.owner_id !== req.user.id) {
        return res.status(403).json({ error: 'Acesso negado: demanda pertence a outro usuário.' });
      }
      res.json({ task });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/:id', (req, res) => {
    try {
      const task = db.updateTask(req.params.id, req.body || {}, req.user);
      res.json({ task });
    } catch (error) {
      const status = error.message.includes('Acesso negado') ? 403 : 400;
      res.status(status).json({ error: error.message });
    }
  });

  router.patch('/:id/status', (req, res) => {
    try {
      const { status } = req.body || {};
      if (!status) {
        return res.status(400).json({ error: 'Status é obrigatório.' });
      }
      const result = db.moveTaskStatus(req.params.id, status, req.user);
      res.json(result);
    } catch (error) {
      const code = error.message.includes('Acesso negado') ? 403 : 400;
      res.status(code).json({ error: error.message });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      db.deleteTask(req.params.id, req.user);
      res.json({ message: 'Demanda removida com sucesso.' });
    } catch (error) {
      const code = error.message.includes('Acesso negado') ? 403 : 400;
      res.status(code).json({ error: error.message });
    }
  });

  return router;
}

module.exports = {
  createTaskRoutes
};
