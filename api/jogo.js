
import { neon } from "@neondatabase/serverless";
import { createHash, timingSafeEqual } from "node:crypto";

// =====================================================
// DESAFIO BÍBLICO - CONTROLE DO JOGO
// =====================================================
// GET: consulta pública do estado da partida.
// POST: comandos exclusivos do administrador.
// A senha é conferida no servidor, nunca exposta no HTML.
// =====================================================

// Compara duas senhas de forma resistente a ataques de tempo.
// Os hashes têm sempre o mesmo tamanho.
function senhaValida(recebida, configurada) {
    if (typeof recebida !== "string" || recebida.length > 1024) {
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

    // Impede que o navegador reutilize informações antigas.
    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );

    // Somente GET e POST são permitidos.
    if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({
            sucesso: false,
            erro: "Método não permitido."
        });
    }

    // =================================================
    // PROTEÇÃO DOS COMANDOS ADMINISTRATIVOS
    // =================================================
    // GET permanece público para os jogadores.
    // POST exige a senha configurada na Vercel.

    if (req.method === "POST") {

        // Lê a senha secreta armazenada na Vercel.
        const senhaConfigurada =
            process.env.DESAFIO_ADMIN_PASSWORD;

        // Se a senha não estiver configurada,
        // nenhum comando administrativo será executado.
        if (!senhaConfigurada) {
            return res.status(503).json({
                sucesso: false,
                erro: "Senha administrativa não configurada no servidor."
            });
        }

        // Recebe a senha enviada pelo painel administrativo.
        const senhaRecebida =
            req.headers["x-admin-password"];

        // Bloqueia comandos com senha incorreta.
        if (!senhaValida(senhaRecebida, senhaConfigurada)) {
            return res.status(401).json({
                sucesso: false,
                erro: "Senha do administrador incorreta."
            });
        }
    }

    try {
        // Conecta ao banco de dados Neon.
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

                    // Pontuação de cada dificuldade.
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
        // A senha já foi validada antes de chegar aqui.

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

            // Impede liberar outra pergunta enquanto
            // a pergunta atual ainda está dentro dos 60 segundos.
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

            // Finaliza o jogo se não houver perguntas.
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

            // Atualiza somente a partida selecionada.
            // Impede que comandos simultâneos liberem
            // duas perguntas na mesma rodada.
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

            // Define a pontuação da pergunta.
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
        // FINALIZAR PARTIDA E MOSTRAR RANKING
        // =================================================

        if (acao === "encerrar_pergunta") {

            // Finaliza a partida, mas mantém os jogadores
            // e suas pontuações para exibir o ranking.
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

            // Reinicia o estado do jogo.
            // As perguntas cadastradas são preservadas.
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

        // Bloqueia comandos desconhecidos.
        return res.status(400).json({
            sucesso: false,
            erro: "Ação inválida."
        });

    } catch (erro) {

        // Registra o erro no servidor sem expor
        // informações internas aos jogadores.
        console.error("Erro no controle do jogo:", erro);

        return res.status(500).json({
            sucesso: false,
            erro: "Erro interno ao processar o jogo."
        });
    }
}
