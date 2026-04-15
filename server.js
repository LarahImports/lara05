require('dotenv').config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");

const { MercadoPagoConfig, Payment } = require("mercadopago");


const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_TOKEN
});

let pagamentosAprovados = {};
let codigosCadastro = {};

const app = express();
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

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

app.delete("/api/clientes/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 🔥 primeiro remove do carrinho (IMPORTANTE)
    await pool.query(
      `DELETE FROM carrinho WHERE cliente_id = $1`,
      [Number(id)]
    );

    // 🔥 depois remove o cliente
    const result = await pool.query(
      `DELETE FROM clientes
       WHERE id = $1
       RETURNING id, nome, login`,
      [Number(id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: "Cliente não encontrado." });
    }

    return res.json({
      ok: true,
      cliente: result.rows[0]
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao excluir cliente." });
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
        total NUMERIC,
        status TEXT DEFAULT 'pendente',
        codigo_rastreio TEXT,
        local_despacho TEXT,
        ultima_atualizacao TEXT,
        observacao_envio TEXT
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
     await pool.query(`
       ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente';
     `);

     await pool.query(`
       ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS codigo_rastreio TEXT;
     `);

     await pool.query(`
      ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS local_despacho TEXT;
     `);

     await pool.query(`
      ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ultima_atualizacao TEXT;
     `);

     await pool.query(`
      ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS observacao_envio TEXT;
     `);
     await pool.query(`
      ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS despachado BOOLEAN DEFAULT FALSE;
     `);
    await pool.query(`
      ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS previsao_entrega TEXT;
    `);

    await pool.query(`
     ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS data_despacho TEXT;
    `);

    await pool.query(`
     ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS etiqueta_gerada BOOLEAN DEFAULT FALSE;
    `);

    
    res.send("Tabelas criadas/atualizadas com sucesso 🚀");
  } catch (error) {
    console.error(error);
    res.status(500).send("Erro ao criar tabelas");
  }
});

app.get("/api/pedidos/para-despacho", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        pe.*,
        p.nome AS produto_nome,
        c.nome AS cliente_nome
      FROM pedidos pe
      JOIN produtos p ON p.id = pe.produto_id
      JOIN clientes c ON c.id = pe.cliente_id
      WHERE pe.despachado = FALSE
        AND (pe.forma_pagamento = 'PIX' OR pe.forma_pagamento = 'cartao')
      ORDER BY pe.id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar pedidos para despacho" });
  }
});

app.put("/api/pedidos/:id/despachar", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE pedidos
       SET despachado = TRUE,
           status = 'Despachado',
           data_despacho = NOW()::text,
           etiqueta_gerada = TRUE,
           ultima_atualizacao = NOW()::text
       WHERE id = $1
       RETURNING *`,
      [Number(id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: "Pedido não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao despachar pedido" });
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

    // 🔥 ENVIO DE EMAIL DE BOAS-VINDAS
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: login,
        subject: 'Bem-vindo à Larah Imports',
        text: `Parabéns!

Você acaba de acessar o sistema da Larah Imports, a melhor forma de realizar suas compras nos Estados Unidos com praticidade, segurança e transparência.

Para sua tranquilidade, informamos que nossas operações no Brasil são representadas pela empresa Thomaz Assessoria em Organizações Ltda., responsável pelo gerenciamento dos recebimentos e suporte aos nossos clientes.

Dessa forma, garantimos um atendimento seguro, confiável e respaldado por uma empresa com representação nacional, pronta para atender qualquer necessidade que você possa ter.

Seus dados de acesso:
Login: ${login}
Senha: ${senha}

Recomendamos que você mantenha essas informações em local seguro.

Seja muito bem-vindo à Larah Imports.

Atenciosamente,
Equipe Larah Imports`
      });

      console.log('Email de boas-vindas enviado');
    } catch (emailError) {
      console.error('Erro ao enviar e-mail de boas-vindas:', emailError);
    }

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
       ORDER BY LOWER(nome) ASC, id ASC`
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
app.put("/api/produtos/:codigo", async (req, res) => {
  try {
    const { codigo } = req.params;
    const { area, nome, descricao, preco, peso, status, foto_url } = req.body;

    const result = await pool.query(
      `UPDATE produtos
       SET area = $1,
           nome = $2,
           descricao = $3,
           preco = $4,
           peso = $5,
           status = $6,
           foto_url = $7
       WHERE codigo = $8
       RETURNING *`,
      [area, nome, descricao, preco, peso, status, foto_url, codigo]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: "Produto não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao atualizar produto" });
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
app.delete("/api/produtos/:codigo", async (req, res) => {
  try {
    const { codigo } = req.params;

    const result = await pool.query(
      `DELETE FROM produtos WHERE codigo = $1 RETURNING *`,
      [codigo]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: "Produto não encontrado" });
    }

    res.json({ sucesso: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao excluir produto" });
  }
});

app.get("/api/pedidos/despachados", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        pe.*,
        p.nome AS produto_nome,
        c.nome AS cliente_nome
      FROM pedidos pe
      JOIN produtos p ON p.id = pe.produto_id
      JOIN clientes c ON c.id = pe.cliente_id
      WHERE pe.despachado = TRUE
      ORDER BY pe.id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar pedidos despachados" });
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
app.get("/api/areas", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS areas (
        id SERIAL PRIMARY KEY,
        nome TEXT UNIQUE
      )
    `);

    const result = await pool.query(
      `SELECT * FROM areas ORDER BY nome ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar áreas" });
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

app.put("/api/pedidos/:id/atualizar-entrega", async (req, res) => {
  try {
    const { id } = req.params;
    const { codigo_rastreio, previsao_entrega } = req.body;

    const result = await pool.query(
      `UPDATE pedidos
       SET codigo_rastreio = COALESCE($1, codigo_rastreio),
           previsao_entrega = COALESCE($2, previsao_entrega),
           ultima_atualizacao = NOW()::text
       WHERE id = $3
       RETURNING *`,
      [
        codigo_rastreio || null,
        previsao_entrega || null,
        Number(id)
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: "Pedido não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao atualizar dados de entrega" });
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
    const { cliente_id, produto_id, forma_pagamento, total } = req.body;

    const result = await pool.query(
      `INSERT INTO pedidos (cliente_id, produto_id, forma_pagamento, total, status, despachado, etiqueta_gerada)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        Number(cliente_id),
        Number(produto_id),
        forma_pagamento || null,
        Number(total),
        'pendente',
        false,
        false
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("ERRO AO SALVAR PEDIDO:", error);
    res.status(500).json({ erro: error.message });
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


app.get("/api/pedidos/cliente/:clienteId", async (req, res) => {
  try {
    const { clienteId } = req.params;

    const result = await pool.query(
      `SELECT 
          pe.id,
          pe.cliente_id,
          pe.produto_id,
          pe.total,
          pe.status,
          pe.codigo_rastreio,
          pe.local_despacho,
          pe.ultima_atualizacao,
          pe.observacao_envio,
          p.nome
       FROM pedidos pe
       JOIN produtos p ON p.id = pe.produto_id
       WHERE pe.cliente_id = $1
       ORDER BY pe.id DESC`,
      [Number(clienteId)]
    );

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar pedidos do cliente" });
  }
});

app.get("/api/dolar-turismo", async (req, res) => {
  try {
    const hoje = new Date();

    for (let i = 0; i < 7; i++) {
      const dataTeste = new Date(hoje);
      dataTeste.setDate(hoje.getDate() - i);

      const dd = String(dataTeste.getDate()).padStart(2, "0");
      const mm = String(dataTeste.getMonth() + 1).padStart(2, "0");
      const yyyy = dataTeste.getFullYear();

      const dataBCB = `${mm}-${dd}-${yyyy}`;

      const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${dataBCB}'&$top=1&$format=json`;

      const resposta = await fetch(url);
      const dolarData = await resposta.json();

      if (dolarData?.value?.length) {
        return res.json(dolarData);
      }
    }

    return res.status(404).json({ erro: "Cotação não encontrada nos últimos 7 dias." });
  } catch (error) {
    console.error("Erro ao buscar dólar turismo:", error);
    return res.status(500).json({ erro: "Erro ao buscar dólar turismo" });
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
          first_name: (nome || "").split(" ")[0],
          last_name: (nome || "").split(" ").slice(1).join(" ") || ".",
          identification: {
            type: "CPF",
            number: cpf
          }
        }
      }
    });

    console.log("RESPOSTA MERCADO PAGO:", JSON.stringify(resposta, null, 2));

    const status = resposta.status;
    const detail = resposta.status_detail;

    if (status === "approved") {
      return res.status(200).json({
        sucesso: true,
        mensagem: "Pagamento aprovado com sucesso!",
        status,
        detalhe: detail,
        id: resposta.id
      });
    }

    if (status === "in_process" || status === "pending") {
      return res.status(200).json({
        sucesso: true,
        mensagem: "Pagamento em análise.",
        status,
        detalhe: detail,
        id: resposta.id
      });
    }

    return res.status(400).json({
      sucesso: false,
     erro: detail === "cc_rejected_high_risk"
     ? "Pagamento recusado por análise de risco. Tente outro cartão ou revise os dados do pagador."
     : `Pagamento não aprovado: ${detail || status}`,
      status,
      detalhe: detail,
      id: resposta.id
    });

  } catch (error) {
    console.error("ERRO AO CRIAR PAGAMENTO CARTAO:", error);

    return res.status(500).json({
      sucesso: false,
      erro: error?.message || "Erro interno ao processar pagamento com cartão"
    });
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

    return res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error);
    return res.status(200).json({ erro: String(error?.message || error) });
  }
});

app.get("/api/verificar-pagamento/:id", (req, res) => {
  const id = req.params.id;

  if (pagamentosAprovados[id]) {
    return res.json({ aprovado: true });
  }

  return res.json({ aprovado: false });
});

app.get("/criar-status-pedidos", async (req, res) => {
  try {
    await pool.query("ALTER TABLE pedidos ADD COLUMN status TEXT DEFAULT 'pendente'");
    return res.send("Coluna status criada com sucesso!");
  } catch (e) {
    console.error(e);
    return res.send("Erro: " + e.message);
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

    return res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao buscar status do pedido" });
  }
});

app.get("/criar-forma-pagamento-pedidos", async (req, res) => {
  try {
    await pool.query("ALTER TABLE pedidos ADD COLUMN forma_pagamento TEXT");
    return res.send("Coluna forma_pagamento criada com sucesso!");
  } catch (e) {
    console.error(e);
    return res.send("Erro: " + e.message);
  }
});

app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});

app.post("/api/cadastro/enviar-codigo", async (req, res) => {
  try {
    const { email, nome } = req.body;

    if (!email) {
      return res.status(400).json({ erro: "E-mail não informado." });
    }

    // 🔥 gera código de 5 dígitos
    const codigo = String(Math.floor(Math.random() * 100000)).padStart(5, "0");

    // guarda em memória
    codigosCadastro[email.toLowerCase()] = {
      codigo,
      expiraEm: Date.now() + 10 * 60 * 1000 // 10 minutos
    };

    console.log("CODIGO GERADO PARA:", email, codigo);

    // envia e-mail
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: "Codigo de Confirmacao de seu cadastro no Site Larahimports.com",
      text:
`Olá ${nome || ""},

Seu código de confirmação é: ${codigo}

Digite esse código no site para concluir seu cadastro.

Larah Imports`
    });

    res.json({ sucesso: true, codigo });
    
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao enviar código." });
  }
});









