
import { neon } from "@neondatabase/serverless";

// =====================================================
// DESAFIO BÍBLICO - CONTROLE DO JOGO
// =====================================================
// Controla o início da partida, as perguntas,
// o cronômetro e o encerramento.
// Utiliza o banco PostgreSQL do Neon.
// =====================================================

export default async function handler(req, res) {
    // Impede que o navegador reutilize estados antigos.
    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );

    try {
        const sql = neon(process.env.DATABASE_URL);

        // =================================================
        // GET - CONSULTAR ESTADO DO JOGO
        // =================================================

        if (req.method === "GET") {
            const jogos = await sql`
                SELECT *
                FROM jogo
                ORDER BY id DESC
                LIMIT 1
            `;

            if (!jogos.length) {
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

            const estado = jogos[0];

            // Calcula o tempo com base no servidor.
            // Não depende do relógio do administrador.
            let restante = 0;

            if (
                estado.pergunta_ativa &&
                estado.tempo_inicio
            ) {
                const inicio = new Date(
                    estado.tempo_inicio
                ).getTime();

                restante = Math.max(
                    0,
                    Math.ceil(
                        (inicio + 60000 - Date.now()) / 1000
                    )
                );
            }

            const perguntaAtiva =
                estado.pergunta_ativa === true &&
                restante > 0;

            let pergunta = null;

            if (perguntaAtiva && estado.pergunta_id) {
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

                    const valores = {
                        facil: 10,
                        medio: 20,
                        dificil: 30,
                        desafio: 40
                    };

                    pergunta = {
                        ...p,
                        pontos: valores[p.dificuldade] || 10
                    };
                }
            }

            return res.status(200).json({
                sucesso: true,
                jogo: {
                    ...estado,
                    pergunta_ativa: perguntaAtiva,
                    tempo_restante: restante,
                    pergunta
                }
            });
        }

        // =================================================
        // POST - COMANDOS DO ADMINISTRADOR
        // =================================================

        if (req.method !== "POST") {
            return res.status(405).json({
                sucesso: false,
                erro: "Método não permitido."
            });
        }

        const { acao } = req.body || {};

        // =================================================
        // INICIAR NOVA PARTIDA
        // =================================================

        if (acao === "iniciar") {
            // Limpa respostas anteriores.
            await sql`
                DELETE FROM respostas
            `;

            // Zera a pontuação dos jogadores.
            await sql`
                UPDATE jogadores
                SET pontuacao = 0
            `;

            // Reinicia o controle do jogo.
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
        // LIBERAR PRÓXIMA PERGUNTA
        // =================================================

        if (acao === "proxima") {
            const jogos = await sql`
                SELECT *
                FROM jogo
                ORDER BY id DESC
                LIMIT 1
            `;

            if (!jogos.length) {
                return res.status(400).json({
                    sucesso: false,
                    erro: "Jogo não encontrado."
                });
            }

            const estado = jogos[0];

            if (estado.encerrado) {
                return res.status(400).json({
                    sucesso: false,
                    erro: "A partida foi encerrada."
                });
            }

            // Evita liberar outra pergunta enquanto
            // a pergunta atual ainda está no tempo.
            if (
                estado.pergunta_ativa &&
                estado.tempo_inicio
            ) {
                const inicio = new Date(
                    estado.tempo_inicio
                ).getTime();

                if (Date.now() < inicio + 60000) {
                    return res.status(409).json({
                        sucesso: false,
                        erro: "Aguarde o encerramento da pergunta atual."
                    });
                }
            }

            // Seleciona uma pergunta aleatória.
            // Evita a pergunta imediatamente anterior.
            // Também exclui perguntas já respondidas.
            const resultado = await sql`
                SELECT *
                FROM perguntas p
                WHERE
                    (
                        ${estado.pergunta_id}::integer IS NULL
                        OR p.id <> ${estado.pergunta_id}
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM respostas r
                        WHERE r.pergunta_id = p.id
                    )
                ORDER BY RANDOM()
                LIMIT 1
            `;

            if (!resultado.length) {
                await sql`
                    UPDATE jogo
                    SET
                        iniciado = FALSE,
                        pergunta_ativa = FALSE,
                        encerrado = TRUE,
                        tempo_inicio = NULL,
                        tempo_restante = 0
                    WHERE id = ${estado.id}
                `;

                return res.status(200).json({
                    sucesso: true,
                    finalizado: true,
                    mensagem: "Não há mais perguntas disponíveis."
                });
            }

            const p = resultado[0];

            const numero =
                Number(estado.numero_pergunta || 0) + 1;

            // Atualiza somente o jogo selecionado.
            // Confere se outro comando já alterou
            // a rodada, evitando liberações duplicadas.
            const atualizacao = await sql`
                UPDATE jogo
                SET
                    iniciado = TRUE,
                    pergunta_ativa = TRUE,
                    numero_pergunta = ${numero},
                    tempo_inicio = NOW(),
                    tempo_restante = 60,
                    pergunta_id = ${p.id},
                    encerrado = FALSE
                WHERE id = ${estado.id}
                  AND numero_pergunta IS NOT DISTINCT FROM
                      ${estado.numero_pergunta}
                  AND pergunta_id IS NOT DISTINCT FROM
                      ${estado.pergunta_id}
                  AND encerrado = FALSE
                RETURNING tempo_inicio
            `;

            if (!atualizacao.length) {
                return res.status(409).json({
                    sucesso: false,
                    erro: "O jogo foi atualizado. Tente novamente."
                });
            }

            const valores = {
                facil: 10,
                medio: 20,
                dificil: 30,
                desafio: 40
            };

            // Não envia a resposta correta ao navegador.
            return res.status(200).json({
                sucesso: true,
                pergunta: {
                    id: p.id,
                    pergunta: p.pergunta,
                    alternativa_a: p.alternativa_a,
                    alternativa_b: p.alternativa_b,
                    alternativa_c: p.alternativa_c,
                    alternativa_d: p.alternativa_d,
                    dificuldade: p.dificuldade,
                    referencia: p.referencia,
                    versiculo: p.versiculo,
                    pontos: valores[p.dificuldade] || 10
                },
                numero_pergunta: numero,
                tempo_inicio: atualizacao[0].tempo_inicio
            });
        }

        // =================================================
        // ENCERRAR PERGUNTA E FINALIZAR PARTIDA
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
        // ENCERRAR PARTIDA E LIMPAR JOGADORES
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
                mensagem: "Partida encerrada e jogadores removidos."
            });
        }

        return res.status(400).json({
            sucesso: false,
            erro: "Ação inválida."
        });

    } catch (erro) {
        console.error("Erro no controle do jogo:", erro);

        return res.status(500).json({
            sucesso: false,
            erro: "Erro interno ao processar o jogo."
        });
    }
}
