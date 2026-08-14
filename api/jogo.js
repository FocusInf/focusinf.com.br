import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

    try {

        const sql = neon(process.env.DATABASE_URL);

        // =====================================================
        // GET - STATUS DO JOGO
        // =====================================================

        if (req.method === "GET") {

            const jogo = await sql`
                SELECT *
                FROM jogo
                ORDER BY id DESC
                LIMIT 1
            `;

            if (jogo.length === 0) {

                return res.status(200).json({
                    sucesso: true,
                    jogo: {
                        iniciado: false,
                        pergunta_ativa: false,
                        encerrado: false
                    }
                });
            }

            const estado = jogo[0];

            let pergunta = null;

            if (estado.pergunta_id) {

                const resultado = await sql`
                    SELECT
                        id,
                        pergunta,
                        alternativa_a,
                        alternativa_b,
                        alternativa_c,
                        alternativa_d,
                        dificuldade,
                        referencia,
                        versiculo
                    FROM perguntas
                    WHERE id = ${estado.pergunta_id}
                    LIMIT 1
                `;

                if (resultado.length > 0) {

                    const p = resultado[0];

                    let pontos = 10;

                    if (p.dificuldade === "facil") {
                        pontos = 10;
                    }

                    if (p.dificuldade === "medio") {
                        pontos = 20;
                    }

                    if (p.dificuldade === "dificil") {
                        pontos = 30;
                    }

                    if (p.dificuldade === "desafio") {
                        pontos = 40;
                    }

                    pergunta = {
                        ...p,
                        pontos
                    };
                }
            }

            return res.status(200).json({
                sucesso: true,
                jogo: {
                    ...estado,
                    pergunta
                }
            });
        }

        // =====================================================
        // POST - COMANDOS DO ADMINISTRADOR
        // =====================================================

        if (req.method === "POST") {

            const { acao } = req.body;

            // =================================================
            // INICIAR PARTIDA
            // =================================================

            if (acao === "iniciar") {

                // Apaga respostas de uma partida anterior
                await sql`
                    DELETE FROM respostas
                `;

                // Zera a pontuação dos jogadores
                await sql`
                    UPDATE jogadores
                    SET pontuacao = 0
                `;

                // Inicia o jogo
                await sql`
                    UPDATE jogo
                    SET
                        iniciado = TRUE,
                        pergunta_ativa = FALSE,
                        numero_pergunta = 0,
                        tempo_inicio = NULL,
                        tempo_restante = 60,
                        pergunta_id = NULL,
                        encerrado = FALSE
                `;

                return res.status(200).json({
                    sucesso: true,
                    mensagem: "Partida iniciada."
                });
            }

            // =================================================
            // PRÓXIMA PERGUNTA
            // =================================================

            if (acao === "proxima") {

                const estado = await sql`
                    SELECT *
                    FROM jogo
                    ORDER BY id DESC
                    LIMIT 1
                `;

                if (!estado.length) {

                    return res.status(400).json({
                        sucesso: false,
                        erro: "Jogo não encontrado."
                    });
                }

                if (estado[0].encerrado) {

                    return res.status(400).json({
                        sucesso: false,
                        erro: "A partida já foi encerrada."
                    });
                }

                const numero =
                    Number(estado[0].numero_pergunta || 0) + 1;

                // -------------------------------------------------
                // Seleciona uma pergunta que ainda não foi usada
                // nesta partida
                // -------------------------------------------------

                const pergunta = await sql`
                    SELECT
                        p.*
                    FROM perguntas p
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM respostas r
                        WHERE r.pergunta_id = p.id
                    )
                    ORDER BY RANDOM()
                    LIMIT 1
                `;

                // -------------------------------------------------
                // Não existem mais perguntas
                // -------------------------------------------------

                if (pergunta.length === 0) {

                    await sql`
                        UPDATE jogo
                        SET
                            pergunta_ativa = FALSE,
                            encerrado = TRUE,
                            tempo_inicio = NULL,
                            tempo_restante = 0
                    `;

                    return res.status(200).json({
                        sucesso: true,
                        finalizado: true,
                        mensagem: "Todas as perguntas foram utilizadas."
                    });
                }

                // -------------------------------------------------
                // Ativa a pergunta
                // -------------------------------------------------

                await sql`
                    UPDATE jogo
                    SET
                        iniciado = TRUE,
                        pergunta_ativa = TRUE,
                        numero_pergunta = ${numero},
                        tempo_inicio = NOW(),
                        tempo_restante = 60,
                        pergunta_id = ${pergunta[0].id},
                        encerrado = FALSE
                `;

                // Calcula os pontos
                let pontos = 10;

                if (pergunta[0].dificuldade === "facil") {
                    pontos = 10;
                }

                if (pergunta[0].dificuldade === "medio") {
                    pontos = 20;
                }

                if (pergunta[0].dificuldade === "dificil") {
                    pontos = 30;
                }

                if (pergunta[0].dificuldade === "desafio") {
                    pontos = 40;
                }

                return res.status(200).json({
                    sucesso: true,
                    pergunta: {
                        ...pergunta[0],
                        pontos
                    },
                    numero_pergunta: numero
                });
            }

            // =================================================
            // ENCERRAR PERGUNTA
            // =================================================

            if (acao === "encerrar_pergunta") {

                await sql`
                    UPDATE jogo
                    SET
                        pergunta_ativa = FALSE,
                        tempo_restante = 0
                `;

                return res.status(200).json({
                    sucesso: true,
                    mensagem: "Pergunta encerrada."
                });
            }

            // =================================================
            // ENCERRAR PARTIDA
            // =================================================

            if (acao === "encerrar") {

                // -------------------------------------------------
                // 1. Apaga todas as respostas
                // -------------------------------------------------

                await sql`
                    DELETE FROM respostas
                `;

                // -------------------------------------------------
                // 2. Apaga todos os jogadores
                // -------------------------------------------------
                // Isso também elimina o ranking da partida
                // -------------------------------------------------

                await sql`
                    DELETE FROM jogadores
                `;

                // -------------------------------------------------
                // 3. Reseta o jogo
                // -------------------------------------------------

                await sql`
                    UPDATE jogo
                    SET
                        iniciado = FALSE,
                        pergunta_ativa = FALSE,
                        numero_pergunta = 0,
                        tempo_inicio = NULL,
                        tempo_restante = 0,
                        pergunta_id = NULL,
                        encerrado = TRUE
                `;

                // -------------------------------------------------
                // IMPORTANTE:
                // A tabela PERGUNTAS NÃO É APAGADA.
                // -------------------------------------------------

                return res.status(200).json({
                    sucesso: true,
                    mensagem:
                        "Partida encerrada. Jogadores, respostas e ranking foram limpos."
                });
            }

            // =================================================
            // AÇÃO INVÁLIDA
            // =================================================

            return res.status(400).json({
                sucesso: false,
                erro: "Ação inválida."
            });
        }

        // =====================================================
        // MÉTODO NÃO PERMITIDO
        // =====================================================

        return res.status(405).json({
            sucesso: false,
            erro: "Método não permitido."
        });

    } catch (erro) {

        console.error(erro);

        return res.status(500).json({
            sucesso: false,
            erro: erro.message
        });
    }
}
