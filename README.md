# Mesa de Demandas — Versão JavaScript / Node.js Full-Stack

Implementação em JavaScript, HTML e CSS baseada na **Especificação de Portabilidade da Mesa de Demandas**.

## Características
- **Tecnologia:** Node.js (v22+) com `node:sqlite` nativo (DatabaseSync) e `node:crypto` (scrypt).
- **Backend:** Express com rotas RESTful para autenticação, demandas, gestão de pessoas e ata de reunião.
- **Frontend:** HTML5 semântico, Vanilla CSS rigorosamente fiel ao Design System "Controle de Demandas" (tokens: papel, pergaminho, tinta, lápis, azul, âmbar, verde e vermelho) e Vanilla JS modular para o Kanban, drag-and-drop e formulários.
- **Segurança e RBAC:** Isolamento completo de dados no servidor — colaboradores visualizam e alteram somente as próprias demandas.
- **Persistência:** Banco relacional SQLite local (`database.sqlite`) com foreign keys e persistência de sessões, notas de reunião e prazos.

## Como Executar

### 1. Instalar dependências (caso clonado sem node_modules)
```bash
npm install
```

### 2. Iniciar o servidor
```bash
npm start
```
Acesse a aplicação no navegador em: **`http://localhost:3000`**

### 3. Executar a suíte de testes de aceitação
```bash
npm test
```
Valida de forma automatizada os 8 cenários mínimos exigidos na Seção 10 da especificação:
1. Primeiro acesso e configuração do primeiro administrador;
2. Criação de usuários via administração e fluxo de cadastro público (colaborador);
3. Redefinição de senha com invalidação imediata da senha antiga;
4. Criação de tarefas e garantia de isolamento do colaborador contra acessos diretos;
5. Mover para Realizado (forçando 100%) e retorno preservando o percentual;
6. Filtro por múltiplos responsáveis na visão do administrador;
7. Edição de notas de reunião e prazos, conferindo sobrevivência ao reinício do banco;
8. Bloqueio de integridade referencial na exclusão de pessoas com demandas associadas.
