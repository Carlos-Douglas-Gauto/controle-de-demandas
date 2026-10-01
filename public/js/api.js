const API = {
  async request(path, options = {}) {
    const url = `/api${path}`;
    const opts = {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    };

    if (opts.body && typeof opts.body === 'object') {
      opts.body = JSON.stringify(opts.body);
    }

    const response = await fetch(url, opts);
    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message = data?.error || `Erro ${response.status}: falha na comunicação.`;
      const err = new Error(message);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    return data;
  },

  auth: {
    status: () => API.request('/auth/status'),
    setup: (payload) => API.request('/auth/setup', { method: 'POST', body: payload }),
    login: (payload) => API.request('/auth/login', { method: 'POST', body: payload }),
    register: (payload) => API.request('/auth/register', { method: 'POST', body: payload }),
    resetPassword: (payload) => API.request('/auth/reset-password', { method: 'POST', body: payload }),
    logout: () => API.request('/auth/logout', { method: 'POST' }),
    me: () => API.request('/auth/me')
  },

  tasks: {
    list: (ownerIds = null) => {
      let query = '';
      if (Array.isArray(ownerIds) && ownerIds.length > 0) {
        query = `?owner_ids=${encodeURIComponent(ownerIds.join(','))}`;
      }
      return API.request(`/tasks${query}`);
    },
    create: (payload) => API.request('/tasks', { method: 'POST', body: payload }),
    update: (id, payload) => API.request(`/tasks/${id}`, { method: 'PUT', body: payload }),
    moveStatus: (id, status) => API.request(`/tasks/${id}/status`, { method: 'PATCH', body: { status } }),
    delete: (id) => API.request(`/tasks/${id}`, { method: 'DELETE' })
  },

  users: {
    list: () => API.request('/users'),
    create: (payload) => API.request('/users', { method: 'POST', body: payload }),
    update: (id, payload) => API.request(`/users/${id}`, { method: 'PUT', body: payload }),
    delete: (id) => API.request(`/users/${id}`, { method: 'DELETE' })
  },

  meeting: {
    list: () => API.request('/meeting'),
    update: (id, payload) => API.request(`/meeting/${id}`, { method: 'PATCH', body: payload })
  }
};
