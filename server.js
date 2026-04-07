require('dotenv').config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const { MercadoPagoConfig, Payment } = require("mercadopago");


const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_TOKEN
});

let pagamentosAprovados = {};

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));
  
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});  

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});
app.get("/teste-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ sucesso: true, hora: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao conectar no banco" });
  }
});

app.get("/criar-tabelas", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nome TEXT,
        endereco TEXT,
        cidade TEXT,
        estado TEXT,
        cep TEXT,
        cpf TEXT UNIQUE,
        login TEXT UNIQUE,
        senha TEXT
      );

      CREATE TABLE IF NOT EXISTS produtos (
        id SERIAL PRIMARY KEY,
        codigo TEXT UNIQUE,
        area TEXT,
        nome TEXT,
        descricao TEXT,
        preco NUMERIC,
        peso NUMERIC,
        status TEXT,
        foto_url TEXT
      );

      CREATE TABLE IF NOT EXISTS carrinho (
        id SERIAL PRIMARY KEY,
        cliente_id INTEGER,
        produto_id INTEGER
      );

      CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        cliente_id INTEGER,
        produto_id INTEGER,
        forma_pagamento TEXT,
        total NUMERIC
      );

      CREATE TABLE IF NOT EXISTS areas (
        id SERIAL PRIMARY KEY,
        nome TEXT UNIQUE
      );

      CREATE TABLE IF NOT EXISTS configuracoes (
        chave TEXT PRIMARY KEY,
        valor TEXT
      );
    `);

    res.send("Tabelas criadas com sucesso 🚀");
  } catch (error) {
    console.error(error);
    res.status(500).send("Erro ao criar tabelas");
  }
});
app.post("/api/clientes", async (req, res) => {
  try {
    const { nome, endereco, cidade, estado, cep, cpf, login, senha } = req.body;

    const result = await pool.query(
      `INSERT INTO clientes (nome, endereco, cidade, estado, cep, cpf, login, senha)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, nome, cpf, login`,
      [nome, endereco, cidade, estado, cep, cpf, login, senha]
    );

    res.json(result.rows[0]);
    } catch (error) {
    console.error(error);

    if (error.code === '23505') {
      if (error.constraint === 'clientes_cpf_key') {
        return res.status(400).json({ erro: 'CPF já cadastrado' });
      }

      if (error.constraint === 'clientes_login_key') {
        return res.status(400).json({ erro: 'Login já cadastrado' });
      }
    }

    res.status(500).json({ erro: "Erro ao cadastrar cliente" });
  }
});
app.get("/api/foto-tela-principal", async (req, res) => {
  try {
    const result = await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracoes (
        chave TEXT PRIMARY KEY,
        valor TEXT
      )
    `);

    const foto = await pool.query(
      `SELECT valor FROM configuracoes WHERE chave = 'foto_tela_principal'`
    );

    res.json({
      foto: foto.rows[0]?.valor || null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar foto da tela principal" });
  }
});

app.post("/api/foto-tela-principal", async (req, res) => {
  try {
    const { foto } = req.body;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracoes (
        chave TEXT PRIMARY KEY,
        valor TEXT
      )
    `);

    await pool.query(
      `INSERT INTO configuracoes (chave, valor)
       VALUES ('foto_tela_principal', $1)
       ON CONFLICT (chave)
       DO UPDATE SET valor = EXCLUDED.valor`,
      [foto]
    );

    res.json({ sucesso: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao salvar foto da tela principal" });
  }
});
app.get("/api/clientes", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nome, endereco, cidade, estado, cep, cpf, login
       FROM clientes
       ORDER BY id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar clientes" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { login, senha } = req.body;

    const result = await pool.query(
      `SELECT id, nome, login FROM clientes
       WHERE login = $1 AND senha = $2`,
      [login, senha]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ erro: "Login inválido" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro no login" });
  }
});


app.post("/api/produtos", async (req, res) => {
  try {
    const { area, nome, descricao, preco, peso, status, foto_url } = req.body;

    console.log("BODY RECEBIDO /api/produtos:", req.body);

    const prefixo = area ? area.charAt(0).toUpperCase() : "P";

    const ultimoProduto = await pool.query(
      `SELECT codigo FROM produtos
       WHERE codigo LIKE $1
       ORDER BY id DESC
       LIMIT 1`,
      [prefixo + "%"]
    );

    let proximoNumero = 1;

    if (ultimoProduto.rows.length > 0) {
      const codigoAnterior = ultimoProduto.rows[0].codigo || "";
      const numeroAnterior = parseInt(codigoAnterior.slice(1), 10);
      if (!isNaN(numeroAnterior)) {
        proximoNumero = numeroAnterior + 1;
      }
    }

    const codigo = prefixo + proximoNumero;

    const result = await pool.query(
      `INSERT INTO produtos (codigo, area, nome, descricao, preco, peso, status, foto_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [codigo, area, nome, descricao, preco, peso, status, foto_url]
    );

    console.log("PRODUTO SALVO NO BANCO:", result.rows[0]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error("ERRO AO CADASTRAR PRODUTO:", error);
    res.status(500).json({ erro: "Erro ao cadastrar produto" });
  }
});
app.post("/api/areas", async (req, res) => {
  try {
    const { nome } = req.body;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS areas (
        id SERIAL PRIMARY KEY,
        nome TEXT UNIQUE
      )
    `);

    const result = await pool.query(
      `INSERT INTO areas (nome)
       VALUES ($1)
       RETURNING *`,
      [nome]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);

    if (error.code === '23505') {
      return res.status(400).json({ erro: "Área já existe" });
    }

    res.status(500).json({ erro: "Erro ao criar área" });
  }
});
app.delete("/api/areas/:nome", async (req, res) => {
  try {
    const { nome } = req.params;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS areas (
        id SERIAL PRIMARY KEY,
        nome TEXT UNIQUE
      )
    `);

    const result = await pool.query(
      `DELETE FROM areas WHERE nome = $1 RETURNING *`,
      [nome]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: "Área não encontrada" });
    }

    res.json({ sucesso: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao excluir área" });
  }
});

app.get("/api/produtos", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM produtos ORDER BY id DESC`
    );

    console.log("TOTAL PRODUTOS:", result.rows.length);
    console.log("PRODUTOS:", result.rows);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar produtos" });
  }
});

app.post("/api/carrinho", async (req, res) => {
  try {
    const { cliente_id, produto_id } = req.body;

    console.log("POST /api/carrinho RECEBIDO:", {
      cliente_id,
      produto_id
    });

    const result = await pool.query(
      `INSERT INTO carrinho (cliente_id, produto_id)
       VALUES ($1,$2)
       RETURNING *`,
      [Number(cliente_id), Number(produto_id)]
    );

    console.log("POST /api/carrinho SALVO:", result.rows[0]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error("ERRO POST /api/carrinho:", error);
    res.status(500).json({ erro: "Erro ao salvar no carrinho" });
  }
});

app.get("/api/carrinho/:clienteId", async (req, res) => {
  try {
    const { clienteId } = req.params;

    const result = await pool.query(
      `SELECT c.id, c.cliente_id, c.produto_id, p.nome, p.preco, p.area, p.peso
       FROM carrinho c
       JOIN produtos p ON p.id = c.produto_id
       WHERE c.cliente_id = $1
       ORDER BY c.id DESC`,
      [clienteId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar carrinho" });
  }
});


// 🔥 NOVO: REMOVER ITEM DO CARRINHO
app.delete("/api/carrinho/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM carrinho WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: "Item não encontrado" });
    }

    res.json({ sucesso: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao remover item" });
  }
});

app.post("/api/pedidos", async (req, res) => {
  try {
    const { cliente_id, produto_id, total } = req.body;

    const result = await pool.query(
      `INSERT INTO pedidos (cliente_id, produto_id, total, status)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [Number(cliente_id), Number(produto_id), Number(total), 'pendente']
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("ERRO AO SALVAR PEDIDO:", error);
    res.status(500).json({ erro: error.message });
  }
});
app.get("/api/pedidos", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pe.id, pe.cliente_id, pe.produto_id, pe.total, pe.status, p.nome
       FROM pedidos pe
       JOIN produtos p ON p.id = pe.produto_id
       ORDER BY pe.id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar pedidos" });
  }
});

app.get('/api/dolar', async (req, res) => {
  try {
    const resposta = await fetch('https://open.er-api.com/v6/latest/USD');
    const dados = await resposta.json();

    const valor = dados?.rates?.BRL || null;
    const data = dados?.time_last_update_utc || null;
    
  res.json({
  sucesso: true,
  valor,
  data
  });
    
  } catch (erro) {
    console.error('Erro ao buscar dólar:', erro);
    res.status(500).json({ erro: 'Erro ao buscar dólar' });
  }
});

app.post("/api/pagamento/pix", async (req, res) => {
  try {
    const { valor, descricao } = req.body;

    const payment = new Payment(mpClient);

        const resposta = await payment.create({
      body: {
        transaction_amount: Number(valor),
        description: descricao,
        payment_method_id: "pix",
        payer: {
          email: "teste@larahimports.com"
        }
      }
    });

    res.json({
      id: resposta.id,
      status: resposta.status,
      qr_code: resposta.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: resposta.point_of_interaction.transaction_data.qr_code_base64
    });
  } catch (error) {
    console.error('ERRO MP COMPLETO:', JSON.stringify(error, null, 2));
    console.error('ERRO MP OBJETO:', error);
    res.status(500).json({ erro: JSON.stringify(error, null, 2) });
  }
});

app.post("/api/pagamento/cartao", async (req, res) => {
  try {
    const {
      valor,
      descricao,
      token,
      parcelas,
      metodo_pagamento,
      email,
      nome,
      cpf
    } = req.body;

    const payment = new Payment(mpClient);

    const resposta = await payment.create({
      body: {
        transaction_amount: Number(valor),
        description: descricao,
        token: token,
        installments: Number(parcelas),
        payment_method_id: metodo_pagamento,
        payer: {
          email: email,
          first_name: nome,
          identification: {
            type: "CPF",
            number: cpf
          }
        }
      }
    });

    res.json({
      id: resposta.id,
      status: resposta.status
    });

  } catch (error) {
    console.error("ERRO CARTAO:", JSON.stringify(error, null, 2));
    res.status(500).json({ erro: "Erro no pagamento com cartão" });
  }
});
   
app.post("/webhook", async (req, res) => {
  console.log("Webhook recebido:", req.body);

  try {
    if (req.body?.type === "payment" && req.body?.data?.id) {
      const payment = new Payment(mpClient);
      const pagamento = await payment.get({ id: req.body.data.id });

      console.log("Status do pagamento:", pagamento.status);

      if (pagamento.status === "approved") {
  console.log("PAGAMENTO APROVADO:", pagamento.id);

  pagamentosAprovados[pagamento.id] = true;

  // 🔥 NOVO: atualizar pedido no banco
  try {
    await pool.query(
      `UPDATE pedidos
       SET status = 'pago'
       WHERE id = $1`,
      [pagamento.id]
    );
  } catch (e) {
    console.error("Erro ao atualizar pedido:", e);
  }
}
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error);
    res.status(200).json({ erro: String(error?.message || error) });
  }
});

app.get("/api/verificar-pagamento/:id", (req, res) => {
  const id = req.params.id;

  if (pagamentosAprovados[id]) {
    return res.json({ aprovado: true });
  }

  res.json({ aprovado: false });
});

app.get("/criar-status-pedidos", async (req, res) => {
  try {
    await pool.query("ALTER TABLE pedidos ADD COLUMN status TEXT DEFAULT 'pendente'");
    res.send("Coluna status criada com sucesso!");
  } catch (e) {
    console.error(e);
    res.send("Erro: " + e.message);
  }
});
app.get("/api/pedidos/:id/status", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, status FROM pedidos WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: "Pedido não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar status do pedido" });
  }
});
app.get("/criar-forma-pagamento-pedidos", async (req, res) => {
  try {
    await pool.query("ALTER TABLE pedidos ADD COLUMN forma_pagamento TEXT");
    res.send("Coluna forma_pagamento criada com sucesso!");
  } catch (e) {
    console.error(e);
    res.send("Erro: " + e.message);
  }
});
app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});
