
import { neon } from "@neondatabase/serverless";

// API de respostas do Desafio Bíblico.
// O banco decide se a pergunta ainda está dentro dos 60 segundos.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({
      sucesso: false,
      erro: "Método não permitido."
    });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    // O painel consulta quantos jogadores já responderam.
    if (req.method === "GET") {
      const perguntaId = Number(req.query?.pergunta_id);

      if (!Number.isSafeInteger(perguntaId) || perguntaId <= 0) {
        return res.status(400).json({
          sucesso: false,
          erro: "Pergunta inválida."
        });
      }

      const [jogadores, respostas] = await Promise.all([
        sql`SELECT COUNT(*)::integer AS total FROM jogadores`,
        sql`
          SELECT COUNT(DISTINCT jogador_id)::integer AS total
          FROM respostas
          WHERE pergunta_id = ${perguntaId}
        `
      ]);

      return res.status(200).json({
        sucesso: true,
        totalJogadores: jogadores[0].total,
        totalRespostas: respostas[0].total
      });
    }

    // Confere os dados enviados pelo celular.
    const jogadorId = Number(req.body?.jogador_id);
    const perguntaId = Number(req.body?.pergunta_id);
    const alternativa = String(req.body?.resposta ?? "")
      .trim()
      .toUpperCase();

    if (
      !Number.isSafeInteger(jogadorId) ||
      jogadorId <= 0 ||
      !Number.isSafeInteger(perguntaId) ||
      perguntaId <= 0 ||
      !["A", "B", "C", "D"].includes(alternativa)
    ) {
      return res.status(400).json({
        sucesso: false,
        erro: "Dados da resposta inválidos."
      });
    }

    // Verifica se a resposta já foi registrada.
    const anterior = await sql`
      SELECT id
      FROM respostas
      WHERE jogador_id = ${jogadorId}
        AND pergunta_id = ${perguntaId}
      LIMIT 1
    `;

    if (anterior.length) {
      return res.status(409).json({
        sucesso: false,
        erro: "Você já respondeu esta pergunta."
      });
    }

    // O PostgreSQL verifica:
    // 1. Se o jogo está iniciado.
    // 2. Se esta é a pergunta ativa.
    // 3. Se ainda não passaram 60 segundos.
    // 4. Se o jogador existe.
    //
    // A resposta e a pontuação são processadas
    // no mesmo comando SQL.
    const gravacao = await sql`
      WITH jogo_atual AS (
        SELECT id, pergunta_id
        FROM jogo
        WHERE iniciado = TRUE
          AND pergunta_ativa = TRUE
          AND encerrado = FALSE
          AND pergunta_id = ${perguntaId}
          AND tempo_inicio IS NOT NULL
          AND NOW() >= tempo_inicio
          AND NOW() < tempo_inicio + INTERVAL '60 seconds'
        ORDER BY id DESC
        LIMIT 1
      ),

      dados AS (
        SELECT
          j.id AS jogador_id,
          p.id AS pergunta_id,
          UPPER(TRIM(p.resposta_correta)) = ${alternativa} AS correta,
          CASE p.dificuldade
            WHEN 'facil' THEN 10
            WHEN 'medio' THEN 20
            WHEN 'dificil' THEN 30
            WHEN 'desafio' THEN 40
            ELSE 10
          END AS valor
        FROM jogadores j
        JOIN perguntas p ON p.id = ${perguntaId}
        JOIN jogo_atual g ON g.pergunta_id = p.id
        WHERE j.id = ${jogadorId}
      ),

      inserida AS (
        INSERT INTO respostas (
          jogador_id,
          pergunta_id,
          resposta,
          correta,
          pontos
        )
        SELECT
          jogador_id,
          pergunta_id,
          ${alternativa},
          correta,
          CASE WHEN correta THEN valor ELSE 0 END
        FROM dados
        WHERE NOT EXISTS (
          SELECT 1
          FROM respostas
          WHERE jogador_id = ${jogadorId}
            AND pergunta_id = ${perguntaId}
        )
        ON CONFLICT DO NOTHING
        RETURNING correta, pontos
      ),

      somar_pontos AS (
        UPDATE jogadores
        SET pontuacao =
          COALESCE(pontuacao, 0) +
          (SELECT pontos FROM inserida)
        WHERE id = ${jogadorId}
          AND EXISTS (SELECT 1 FROM inserida)
        RETURNING id
      )

      SELECT correta, pontos
      FROM inserida
    `;

    // Se não gravou, verifica o motivo.
    if (!gravacao.length) {
      const duplicada = await sql`
        SELECT id
        FROM respostas
        WHERE jogador_id = ${jogadorId}
          AND pergunta_id = ${perguntaId}
        LIMIT 1
      `;

      if (duplicada.length) {
        return res.status(409).json({
          sucesso: false,
          erro: "Você já respondeu esta pergunta."
        });
      }

      return res.status(400).json({
        sucesso: false,
        erro: "Pergunta encerrada, tempo esgotado ou jogador não encontrado."
      });
    }

    // Conta os jogadores e as respostas registradas.
    // COUNT DISTINCT evita contar o mesmo jogador duas vezes.
    const [jogadores, respostas] = await Promise.all([
      sql`SELECT COUNT(*)::integer AS total FROM jogadores`,
      sql`
        SELECT COUNT(DISTINCT jogador_id)::integer AS total
        FROM respostas
        WHERE pergunta_id = ${perguntaId}
      `
    ]);

    const totalJogadores = jogadores[0].total;
    const totalRespostas = respostas[0].total;

    // Quando todos respondem, fecha somente a pergunta.
    // O administrador continua podendo liberar a próxima.
    if (
      totalJogadores > 0 &&
      totalRespostas >= totalJogadores
    ) {
      await sql`
        UPDATE jogo
        SET
          pergunta_ativa = FALSE,
          tempo_restante = 0
        WHERE id = (
          SELECT id
          FROM jogo
          ORDER BY id DESC
          LIMIT 1
        )
          AND pergunta_id = ${perguntaId}
          AND pergunta_ativa = TRUE
      `;
    }

    // Devolve ao celular o resultado da resposta.
    return res.status(200).json({
      sucesso: true,
      correta: gravacao[0].correta,
      pontos: gravacao[0].pontos,
      totalJogadores,
      totalRespostas
    });

  } catch (erro) {
    console.error("Erro em /api/responder:", erro);

    return res.status(500).json({
      sucesso: false,
      erro: "Erro interno ao registrar a resposta."
    });
  }
}
