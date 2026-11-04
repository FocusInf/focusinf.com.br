
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";

// =====================================================
// DESAFIO BÍBLICO - RESPOSTAS DOS JOGADORES
// =====================================================
// GET: consulta quantos jogadores responderam.
// POST: registra uma resposta e calcula a pontuação.
//
// PROTEÇÕES:
// - Confere a identidade secreta do jogador.
// - Impede respostas duplicadas.
// - Respeita os 60 segundos da pergunta.
// - Não revela a resposta correta antecipadamente.
// - Atualiza a pontuação no banco de dados.
// =====================================================

// Calcula o hash da identificação secreta.
// O token original nunca precisa ser salvo no banco.
function calcularHash(token) {
    return createHash("sha256")
        .update(token, "utf8")
        .digest("hex");
}

export default async function handler(req, res) {

    // Impede que o navegador reutilize respostas antigas.
    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );

    // Permite somente consultas e envio de respostas.
    if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({
            sucesso: false,
            erro: "Método não permitido."
        });
    }

    try {
        // Conexão com o PostgreSQL do Neon.
        const sql = neon(process.env.DATABASE_URL);

        // =================================================
        // GET - CONTAR RESPOSTAS
        // =================================================

        if (req.method === "GET") {

            const perguntaId =
                Number(req.query?.pergunta_id);

            if (
                !Number.isSafeInteger(perguntaId) ||
                perguntaId <= 0
            ) {
                return res.status(400).json({
                    sucesso: false,
                    erro: "Pergunta inválida."
                });
            }

            // Conta os jogadores ativos e as respostas.
            const [jogadores, respostas] = await Promise.all([
                sql`
                    SELECT COUNT(*)::integer AS total
                    FROM jogadores
                `,
                sql`
                    SELECT
                        COUNT(DISTINCT jogador_id)::integer
                        AS total
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

        // =================================================
        // POST - VALIDAR A RESPOSTA
        // =================================================

        const jogadorId = Number(req.body?.jogador_id);
        const perguntaId = Number(req.body?.pergunta_id);

        const alternativa =
            String(req.body?.resposta ?? "")
                .trim()
                .toUpperCase();

        // Verifica os dados recebidos.
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

        // =================================================
        // IDENTIFICAÇÃO SECRETA DO JOGADOR
        // =================================================

        const tokenRecebido = req.body?.token;

        let tokenHash = null;

        // O token é opcional apenas para jogadores
        // antigos, cadastrados antes da atualização.
        if (
            tokenRecebido !== undefined &&
            tokenRecebido !== null
        ) {

            if (
                typeof tokenRecebido !== "string" ||
                !/^[a-f0-9]{64}$/i.test(tokenRecebido)
            ) {
                return res.status(403).json({
                    sucesso: false,
                    erro: "Identificação do jogador inválida."
                });
            }

            tokenHash = calcularHash(tokenRecebido);
        }

        // Confere a identidade diretamente no Neon.
        //
        // Jogadores novos precisam apresentar o token.
        // Jogadores antigos sem token continuam
        // temporariamente compatíveis.
        const autorizado = await sql`
            SELECT id
            FROM jogadores
            WHERE id = ${jogadorId}
              AND (
                  (
                      token_hash IS NULL
                      AND ${tokenHash}::text IS NULL
                  )
                  OR token_hash = ${tokenHash}
              )
            LIMIT 1
        `;

        if (!autorizado.length) {
            return res.status(403).json({
                sucesso: false,
                erro:
                    "Jogador não autorizado. " +
                    "Entre novamente no Desafio Bíblico."
            });
        }

        // =================================================
        // IMPEDIR RESPOSTAS DUPLICADAS
        // =================================================

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

        // =================================================
        // REGISTRAR RESPOSTA E PONTUAÇÃO
        // =================================================
        //
        // O PostgreSQL confere:
        // 1. Se o jogo está iniciado.
        // 2. Se a pergunta está ativa.
        // 3. Se ainda não passaram 60 segundos.
        // 4. Se o jogador está cadastrado.
        // 5. Se a identificação secreta corresponde.
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
                  AND NOW() <
                      tempo_inicio + INTERVAL '60 seconds'
                ORDER BY id DESC
                LIMIT 1
            ),

            dados AS (

                SELECT
                    j.id AS jogador_id,
                    p.id AS pergunta_id,

                    UPPER(TRIM(p.resposta_correta)) =
                        ${alternativa} AS correta,

                    CASE p.dificuldade
                        WHEN 'facil' THEN 10
                        WHEN 'medio' THEN 20
                        WHEN 'dificil' THEN 30
                        WHEN 'desafio' THEN 40
                        ELSE 10
                    END AS valor

                FROM jogadores j

                JOIN perguntas p
                    ON p.id = ${perguntaId}

                JOIN jogo_atual g
                    ON g.pergunta_id = p.id

                WHERE j.id = ${jogadorId}

                  AND (
                      (
                          j.token_hash IS NULL
                          AND ${tokenHash}::text IS NULL
                      )
                      OR j.token_hash = ${tokenHash}
                  )
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
                    CASE
                        WHEN correta THEN valor
                        ELSE 0
                    END

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
                  AND EXISTS (
                      SELECT 1 FROM inserida
                  )

                RETURNING id
            )

            SELECT correta, pontos
            FROM inserida
        `;

        // =================================================
        // VERIFICAR SE A RESPOSTA FOI GRAVADA
        // =================================================

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
                erro:
                    "Pergunta encerrada, tempo esgotado " +
                    "ou jogador não encontrado."
            });
        }

        // =================================================
        // CONTAR JOGADORES E RESPOSTAS
        // =================================================

        const [jogadores, respostas] = await Promise.all([
            sql`
                SELECT COUNT(*)::integer AS total
                FROM jogadores
            `,
            sql`
                SELECT
                    COUNT(DISTINCT jogador_id)::integer
                    AS total
                FROM respostas
                WHERE pergunta_id = ${perguntaId}
            `
        ]);

        const totalJogadores = jogadores[0].total;
        const totalRespostas = respostas[0].total;

        // =================================================
        // ENCERRAR QUANDO TODOS RESPONDEREM
        // =================================================

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

        // =================================================
        // DEVOLVER RESULTADO AO JOGADOR
        // =================================================

        return res.status(200).json({
            sucesso: true,
            correta: gravacao[0].correta,
            pontos: gravacao[0].pontos,
            totalJogadores,
            totalRespostas
        });

    } catch (erro) {

        // Registra o erro para diagnóstico.
        console.error(
            "Erro em /api/responder:",
            erro
        );

        return res.status(500).json({
            sucesso: false,
            erro: "Erro interno ao registrar a resposta."
        });
    }
}
