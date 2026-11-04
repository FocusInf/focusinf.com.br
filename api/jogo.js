
import { neon } from "@neondatabase/serverless";
import { createHash, timingSafeEqual } from "node:crypto";

// =====================================================
// DESAFIO BÍBLICO - CONTROLE DO JOGO
// =====================================================
// GET: consulta pública do estado da partida.
// POST: comandos protegidos por senha.
//
// MELHORIA:
// Cada pergunta utilizada é registrada no Neon.
// Uma pergunta não se repete na mesma partida,
// mesmo quando nenhum jogador responder.
// =====================================================

// Compara senhas com segurança.
function senhaValida(recebida, configurada) {
    if (
        typeof recebida !== "string" ||
        recebida.length > 1024
    ) {
        return false;
    }

    const hashRecebido = createHash("sha256")
        .update(recebida, "utf8")
        .digest();

    const hashConfigurado = createHash("sha256")
        .update(configurada, "utf8")
        .digest();

    return timingSafeEqual(hashRecebido, hashConfigurado);
}

export default async function handler(req, res) {

    // Impede que o navegador reutilize dados antigos.
    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );

    // Aceita somente GET e POST.
    if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({
            sucesso: false,
            erro: "Método não permitido."
        });
    }

    // =================================================
    // SEGURANÇA DO ADMINISTRADOR
    // =================================================

    if (req.method === "POST") {

        // Senha armazenada nas variáveis da Vercel.
        const senhaConfigurada =
            process.env.DESAFIO_ADMIN_PASSWORD;

        if (!senhaConfigurada) {
            return res.status(503).json({
                sucesso: false,
                erro: "Senha administrativa não configurada no servidor."
            });
        }

        // Senha recebida pelo painel administrativo.
        const senhaRecebida =
            req.headers["x-admin-password"];

        if (!senhaValida(senhaRecebida, senhaConfigurada)) {
            return res.status(401).json({
                sucesso: false,
                erro: "Senha do administrador incorreta."
            });
        }
    }

    try {

        // Conexão com o banco de dados Neon.
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

            // Calcula os segundos restantes pelo servidor.
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

        const { acao } = req.body || {};

        // =================================================
        // INICIAR NOVA PARTIDA
        // =================================================

        if (acao === "iniciar") {

            // Apaga respostas da partida anterior.
            await sql`
                DELETE FROM respostas
            `;

            // NOVO:
            // Limpa o histórico das perguntas utilizadas.
            // Assim, todas as perguntas ficam disponíveis
            // novamente para a nova partida.
            //
            // Isso NÃO apaga nenhuma pergunta cadastrada.
            await sql`
                DELETE FROM perguntas_utilizadas
            `;

            // Zera a pontuação dos jogadores.
            await sql`
                UPDATE jogadores
                SET pontuacao = 0
            `;

            // Reinicia o estado do jogo.
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

            // Não libera perguntas após a finalização.
            if (estado.encerrado) {
                return res.status(400).json({
                    sucesso: false,
                    erro: "A partida foi encerrada."
                });
            }

            // Impede liberar outra pergunta enquanto
            // a atual ainda estiver dentro dos 60 segundos.
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

            // =================================================
            // NOVO - ESCOLHER UMA PERGUNTA NÃO UTILIZADA
            // =================================================
            // Verifica a tabela perguntas_utilizadas.
            //
            // Uma pergunta já apresentada não poderá
            // aparecer novamente nesta partida.
            //
            // Também mantém a verificação das respostas.

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
                        FROM perguntas_utilizadas pu
                        WHERE pu.pergunta_id = p.id
                    )

                    AND NOT EXISTS (
                        SELECT 1
                        FROM respostas r
                        WHERE r.pergunta_id = p.id
                    )

                ORDER BY RANDOM()
                LIMIT 1
            `;

            // =================================================
            // QUANDO TODAS AS PERGUNTAS FOREM UTILIZADAS
            // =================================================

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
                    mensagem: "Todas as perguntas disponíveis foram utilizadas."
                });
            }

            const p = resultado[0];

            // Número da próxima pergunta.
            const numero =
                Number(estado.numero_pergunta || 0) + 1;

            // =================================================
            // NOVO - ATUALIZAR O JOGO E REGISTRAR A PERGUNTA
            // =================================================
            // O PostgreSQL executa as duas operações
            // dentro de um único comando SQL.
            //
            // Se o registro da pergunta falhar,
            // a atualização do jogo também é desfeita.
            //
            // Isso evita liberar uma pergunta sem
            // registrá-la como utilizada.

            const atualizacao = await sql`
                WITH rodada_atualizada AS (

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

                      AND numero_pergunta
                          IS NOT DISTINCT FROM
                          ${estado.numero_pergunta}

                      AND pergunta_id
                          IS NOT DISTINCT FROM
                          ${estado.pergunta_id}

                      AND encerrado = FALSE

                    RETURNING pergunta_id, tempo_inicio
                ),

                pergunta_registrada AS (

                    INSERT INTO perguntas_utilizadas (
                        pergunta_id
                    )

                    SELECT pergunta_id
                    FROM rodada_atualizada

                    RETURNING pergunta_id
                )

                SELECT
                    rodada_atualizada.tempo_inicio

                FROM rodada_atualizada

                INNER JOIN pergunta_registrada
                    ON pergunta_registrada.pergunta_id =
                       rodada_atualizada.pergunta_id
            `;

            // Impede liberações duplicadas quando
            // dois comandos chegam ao mesmo tempo.
            if (!atualizacao.length) {
                return res.status(409).json({
                    sucesso: false,
                    erro: "O jogo foi atualizado. Tente novamente."
                });
            }

            // Pontuação por dificuldade.
            const valores = {
                facil: 10,
                medio: 20,
                dificil: 30,
                desafio: 40
            };

            // Retorna a pergunta sem revelar a resposta correta.
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
        // FINALIZAR PARTIDA E MOSTRAR RANKING
        // =================================================

        if (acao === "encerrar_pergunta") {

            // Finaliza a partida, mas preserva
            // jogadores e pontuações para o ranking.
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

            // Apaga as respostas dos jogadores.
            await sql`
                DELETE FROM respostas
            `;

            // Remove os jogadores cadastrados.
            await sql`
                DELETE FROM jogadores
            `;

            // Reinicia o controle da partida.
            // Não apaga as perguntas cadastradas.
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

        // Bloqueia ações desconhecidas.
        return res.status(400).json({
            sucesso: false,
            erro: "Ação inválida."
        });

    } catch (erro) {

        // Registra o erro no servidor.
        console.error("Erro no controle do jogo:", erro);

        return res.status(500).json({
            sucesso: false,
            erro: "Erro interno ao processar o jogo."
        });
    }
}
