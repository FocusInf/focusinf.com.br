import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

    try {

        const sql = neon(process.env.DATABASE_URL);

        // =====================================================
        // GET - ESTADO DO JOGO
        // =====================================================

        if (req.method === "GET") {

            const jogo = await sql`
                SELECT *
                FROM jogo
                ORDER BY id DESC
                LIMIT 1
            `;

            if (!jogo.length) {

                return res.status(200).json({
                    sucesso: true,
                    jogo: {
                        iniciado: false,
                        pergunta_ativa: false,
                        encerrado: false,
                        pergunta: null
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

                if (resultado.length) {

                    const p = resultado[0];

                    let pontos = 10;

                    if (p.dificuldade === "medio") pontos = 20;
                    if (p.dificuldade === "dificil") pontos = 30;
                    if (p.dificuldade === "desafio") pontos = 40;

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
        // POST
        // =====================================================

        if (req.method === "POST") {

            const { acao } = req.body;


            // =================================================
            // INICIAR PARTIDA
            // =================================================

            if (acao === "iniciar") {

                await sql`
                    DELETE FROM respostas
                `;

                await sql`
                    UPDATE jogadores
                    SET pontuacao = 0
                `;

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


                const pergunta = await sql`
                    SELECT *
                    FROM perguntas p
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM respostas r
                        WHERE r.pergunta_id = p.id
                    )
                    ORDER BY RANDOM()
                    LIMIT 1
                `;


                if (!pergunta.length) {

                    await sql`
                        UPDATE jogo
                        SET
                            iniciado = FALSE,
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


                let pontos = 10;

                if (pergunta[0].dificuldade === "medio") pontos = 20;
                if (pergunta[0].dificuldade === "dificil") pontos = 30;
                if (pergunta[0].dificuldade === "desafio") pontos = 40;


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
            // ENCERRAR PERGUNTA = FINALIZAR PARTIDA
            // =================================================

            if (acao === "encerrar_pergunta") {

                await sql`
                    UPDATE jogo
                    SET
                        iniciado = FALSE,
                        pergunta_ativa = FALSE,
                        encerrado = TRUE,
                        tempo_inicio = NULL,
                        tempo_restante = 0
                `;

                return res.status(200).json({
                    sucesso: true,
                    finalizado: true,
                    mensagem: "Partida finalizada. Ranking liberado."
                });
            }


            // =================================================
            // ENCERRAR PARTIDA = LIMPAR TUDO
            // =================================================

            if (acao === "encerrar") {

                await sql`
                    DELETE FROM respostas
                `;

                await sql`
                    DELETE FROM jogadores
                `;

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

                return res.status(200).json({
                    sucesso: true,
                    mensagem: "Partida encerrada e banco limpo."
                });
            }


            return res.status(400).json({
                sucesso: false,
                erro: "Ação inválida."
            });
        }


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
