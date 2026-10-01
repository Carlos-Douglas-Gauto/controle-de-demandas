const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Database } = require('../src/db');
const { createApp } = require('../src/server');

async function runTests() {
  console.log('--- Iniciando Validação dos Cenários Mínimos da Especificação ---');

  const testDbPath = path.join(__dirname, 'test_board.sqlite');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  const db = new Database(testDbPath);
  const { app } = createApp(db);

  // Helper para simular requisições HTTP internas sem depender de portas de rede
  async function apiRequest(method, urlPath, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const http = require('node:http');
      const server = app.listen(0, async () => {
        const port = server.address().port;
        const options = {
          hostname: '127.0.0.1',
          port: port,
          path: urlPath,
          method: method,
          headers: {
            'Content-Type': 'application/json',
            ...headers
          }
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            server.close();
            let parsed = null;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
            resolve({ status: res.statusCode, headers: res.headers, body: parsed });
          });
        });

        req.on('error', (e) => {
          server.close();
          reject(e);
        });

        if (body) {
          req.write(JSON.stringify(body));
        }
        req.end();
      });
    });
  }

  function getCookieToken(headers) {
    const setCookie = headers['set-cookie'];
    if (!setCookie) return null;
    const match = setCookie[0].match(/session_token=([^;]+)/);
    return match ? match[1] : null;
  }

  try {
    // ----------------------------------------------------
    // Cenário 1: Configurar primeiro administrador e autenticar
    // ----------------------------------------------------
    console.log('1. Testando configuração inicial do primeiro administrador...');
    const setupRes = await apiRequest('POST', '/api/auth/setup', {
      name: 'Admin Master',
      email: 'admin@empresa.com',
      password: 'password123',
      confirm_password: 'password123'
    });
    assert.strictEqual(setupRes.status, 201, 'Setup deve retornar 201');
    assert.strictEqual(setupRes.body.user.profile, 'Administrador');
    const adminToken = getCookieToken(setupRes.headers);
    assert.ok(adminToken, 'Deve retornar cookie de sessão para o administrador');
    console.log('✓ Cenário 1 aprovado.');

    // ----------------------------------------------------
    // Cenário 2: Cadastrar pessoa pelo admin e outra pelo fluxo público
    // ----------------------------------------------------
    console.log('2. Testando criação de usuário pelo admin e cadastro público...');
    // Cadastro via Admin
    const adminCreateUserRes = await apiRequest('POST', '/api/users', {
      name: 'Lucas Dev',
      email: 'lucas@empresa.com',
      profile: 'Colaborador',
      password: 'lucaspassword'
    }, {
      'Cookie': `session_token=${adminToken}`
    });
    assert.strictEqual(adminCreateUserRes.status, 201);
    const lucasId = adminCreateUserRes.body.user.id;

    // Cadastro Público
    const publicRegisterRes = await apiRequest('POST', '/api/auth/register', {
      name: 'Ana Designer',
      email: 'ana@empresa.com',
      password: 'anapassword',
      confirm_password: 'anapassword'
    });
    assert.strictEqual(publicRegisterRes.status, 201);
    assert.strictEqual(publicRegisterRes.body.user.profile, 'Colaborador', 'Cadastro público sempre deve ser Colaborador');
    const anaToken = getCookieToken(publicRegisterRes.headers);
    const anaId = publicRegisterRes.body.user.id;
    console.log('✓ Cenário 2 aprovado.');

    // ----------------------------------------------------
    // Cenário 3: Redefinição de senha (antiga falha, nova funciona)
    // ----------------------------------------------------
    console.log('3. Testando redefinição de senha e invalidação da senha antiga...');
    const resetRes = await apiRequest('POST', '/api/auth/reset-password', {
      email: 'ana@empresa.com',
      password: 'new_anapassword_123',
      confirm_password: 'new_anapassword_123'
    });
    assert.strictEqual(resetRes.status, 200);

    // Tentar login com senha antiga (deve falhar 401)
    const oldLoginRes = await apiRequest('POST', '/api/auth/login', {
      email: 'ana@empresa.com',
      password: 'anapassword'
    });
    assert.strictEqual(oldLoginRes.status, 401, 'Senha antiga deve ser rejeitada');

    // Tentar login com nova senha (deve funcionar 200)
    const newLoginRes = await apiRequest('POST', '/api/auth/login', {
      email: 'ana@empresa.com',
      password: 'new_anapassword_123'
    });
    assert.strictEqual(newLoginRes.status, 200, 'Nova senha deve ser aceita');
    const updatedAnaToken = getCookieToken(newLoginRes.headers);
    console.log('✓ Cenário 3 aprovado.');

    // ----------------------------------------------------
    // Cenário 4: Criar tarefas para duas pessoas e confirmar isolamento
    // ----------------------------------------------------
    console.log('4. Testando criação de demandas e isolamento estrito de Colaborador...');
    // Ana cria sua tarefa
    const anaTaskRes = await apiRequest('POST', '/api/tasks', {
      title: 'Design dos Cards',
      description: 'Fazer protótipo no papel',
      priority: 'Alta'
    }, {
      'Cookie': `session_token=${updatedAnaToken}`
    });
    assert.strictEqual(anaTaskRes.status, 201);
    const anaTaskId = anaTaskRes.body.task.id;
    assert.strictEqual(anaTaskRes.body.task.owner_id, anaId);

    // Admin cria tarefa para Lucas
    const lucasTaskRes = await apiRequest('POST', '/api/tasks', {
      title: 'Setup do Banco SQLite',
      description: 'Criar tabelas e migrations',
      priority: 'Alta',
      owner_id: lucasId
    }, {
      'Cookie': `session_token=${adminToken}`
    });
    assert.strictEqual(lucasTaskRes.status, 201);
    const lucasTaskId = lucasTaskRes.body.task.id;

    // Ana lista tarefas: deve ver SOMENTE as suas (1 tarefa), nunca a do Lucas
    const anaListRes = await apiRequest('GET', '/api/tasks', null, {
      'Cookie': `session_token=${updatedAnaToken}`
    });
    assert.strictEqual(anaListRes.body.tasks.length, 1);
    assert.strictEqual(anaListRes.body.tasks[0].id, anaTaskId);

    // Ana tenta acessar diretamente ou mover a tarefa do Lucas (deve ser bloqueada 403)
    const anaHackRes = await apiRequest('PATCH', `/api/tasks/${lucasTaskId}/status`, {
      status: 'Realizado'
    }, {
      'Cookie': `session_token=${updatedAnaToken}`
    });
    assert.strictEqual(anaHackRes.status, 403, 'Colaborador não pode alterar demanda de outro dono');
    console.log('✓ Cenário 4 aprovado.');

    // ----------------------------------------------------
    // Cenário 5: Mover para Realizado (100%), voltar e preservar valor
    // ----------------------------------------------------
    console.log('5. Testando avanço ao mover para Realizado e preservação ao retornar...');
    // Mover para Realizado: progress deve forçar 100
    const moveDoneRes = await apiRequest('PATCH', `/api/tasks/${anaTaskId}/status`, {
      status: 'Realizado'
    }, {
      'Cookie': `session_token=${updatedAnaToken}`
    });
    assert.strictEqual(moveDoneRes.status, 200);
    assert.strictEqual(moveDoneRes.body.progress, 100, 'Ao mover para Realizado deve forçar 100%');

    // Mover de volta para 'Em andamento': percentual NÃO reduz automaticamente
    const moveBackRes = await apiRequest('PATCH', `/api/tasks/${anaTaskId}/status`, {
      status: 'Em andamento'
    }, {
      'Cookie': `session_token=${updatedAnaToken}`
    });
    assert.strictEqual(moveBackRes.status, 200);
    assert.strictEqual(moveBackRes.body.status, 'Em andamento');
    assert.strictEqual(moveBackRes.body.progress, 100, 'Ao retornar para outra etapa, o progresso deve ser preservado');
    console.log('✓ Cenário 5 aprovado.');

    // ----------------------------------------------------
    // Cenário 6: Filtrar duas pessoas como administrador
    // ----------------------------------------------------
    console.log('6. Testando filtro de múltiplos responsáveis pelo Administrador...');
    // Admin lista todas
    const allTasksRes = await apiRequest('GET', '/api/tasks', null, {
      'Cookie': `session_token=${adminToken}`
    });
    assert.strictEqual(allTasksRes.body.tasks.length, 2);

    // Admin filtra por anaId e lucasId
    const filterRes = await apiRequest('GET', `/api/tasks?owner_ids=${anaId},${lucasId}`, null, {
      'Cookie': `session_token=${adminToken}`
    });
    assert.strictEqual(filterRes.body.tasks.length, 2);

    // Admin filtra apenas por lucasId
    const filterLucasRes = await apiRequest('GET', `/api/tasks?owner_ids=${lucasId}`, null, {
      'Cookie': `session_token=${adminToken}`
    });
    assert.strictEqual(filterLucasRes.body.tasks.length, 1);
    assert.strictEqual(filterLucasRes.body.tasks[0].owner_id, lucasId);
    console.log('✓ Cenário 6 aprovado.');

    // ----------------------------------------------------
    // Cenário 7: Salvar reunião e reiniciar aplicação (persistência)
    // ----------------------------------------------------
    console.log('7. Testando ata de reunião e sobrevivência ao reinício do sistema...');
    const meetingPatchRes = await apiRequest('PATCH', `/api/meeting/${anaTaskId}`, {
      meeting_notes: 'Alinhado entregar quinta-feira',
      due_date: '2026-10-15'
    }, {
      'Cookie': `session_token=${adminToken}`
    });
    assert.strictEqual(meetingPatchRes.status, 200);
    assert.strictEqual(meetingPatchRes.body.task.meeting_notes, 'Alinhado entregar quinta-feira');
    assert.strictEqual(meetingPatchRes.body.task.due_date, '2026-10-15');

    // Fechar e reabrir banco para simular reinício completo da aplicação
    db.close();
    const restartedDb = new Database(testDbPath);
    const restartedTask = restartedDb.getTask(anaTaskId);
    assert.strictEqual(restartedTask.meeting_notes, 'Alinhado entregar quinta-feira', 'Notas de reunião devem persistir após reinício');
    assert.strictEqual(restartedTask.due_date, '2026-10-15', 'Prazo alinhado deve persistir após reinício');
    restartedDb.close();
    console.log('✓ Cenário 7 aprovado.');

    // ----------------------------------------------------
    // Cenário 8: Tentar excluir pessoa com tarefas (deve falhar)
    // ----------------------------------------------------
    console.log('8. Testando integridade: bloqueio de exclusão de pessoa com tarefas...');
    const dbAgain = new Database(testDbPath);
    const { app: app2 } = createApp(dbAgain);

    // Testar com chamada API via app2
    const deleteAttempt = await new Promise((resolve) => {
      const http = require('node:http');
      const server = app2.listen(0, () => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: server.address().port,
          path: `/api/users/${anaId}`,
          method: 'DELETE',
          headers: {
            'Cookie': `session_token=${adminToken}`
          }
        }, (res) => {
          let data = '';
          res.on('data', (c) => data += c);
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          });
        });
        req.end();
      });
    });

    assert.strictEqual(deleteAttempt.status, 400, 'Exclusão deve retornar erro 400');
    assert.ok(
      deleteAttempt.body.error.includes('Não é possível remover uma pessoa que possui demandas'),
      'Mensagem deve indicar bloqueio por demandas associadas'
    );
    dbAgain.close();
    console.log('✓ Cenário 8 aprovado.');

    // Limpeza do banco de teste
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    console.log('\n======================================================');
    console.log('TODOS OS 8 CENÁRIOS DE TESTE FORAM APROVADOS COM SUCESSO!');
    console.log('======================================================\n');
  } catch (err) {
    console.error('Falha nos testes:', err);
    process.exit(1);
  }
}

runTests();
