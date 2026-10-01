const express = require('express');

function createMeetingRoutes(db, { requireAdmin }) {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/', (req, res) => {
    try {
      const tasks = db.listMeetingTasks();
      res.json({ tasks });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch('/:id', (req, res) => {
    try {
      const { meeting_notes, due_date } = req.body || {};
      const updated = db.updateMeetingTask(req.params.id, {
        meeting_notes,
        due_date
      });
      res.json({ task: updated });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}

module.exports = {
  createMeetingRoutes
};
