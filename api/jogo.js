
import { neon } from "@neondatabase/serverless";
import { createHash, timingSafeEqual } from "node:crypto";

// =====================================================
// DESAFIO BÍBLICO - CONTROLE DO JOGO
// =====================================================
// GET: consulta pública do estado da partida.
// POST: comandos protegidos pela senha do administrador.
//
// Funcionalidades:
// - Iniciar e finalizar partidas.
// - Liberar perguntas sem repetição.
// - Controlar o cronômetro de 60 segundos.
// - Preservar o ranking final.
// - Remover individualmente jogadores desistentes.
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

    // Evita utilizar dados antigos do navegador.
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

        // Lê a senha cadastrada na Vercel.
        const senhaConfigurada =
            process.env.DESAFIO_ADMIN_PASSWORD;

        // Bloqueia comandos se a senha não estiver definida.
        if (!senhaConfigurada) {
            return res.status(503).json({
                sucesso: false,
                erro: "Senha administrativa não configurada no servidor."
            });
        }

        // Recebe a senha enviada pelo painel.
        const senhaRecebida =
            req.headers["x-admin-password"];

        // Impede alterações sem autorização.
        if (!senhaValida(senhaRecebida, senhaConfigurada)) {
            return res.status(401).json({
                sucesso: false,
                erro: "Senha do administrador incorreta."
            });
        }
    }

    try {

        // Conexão com o banco PostgreSQL do Neon.
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

            // Calcula o tempo restante no servidor.
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
        // Todos os comandos abaixo exigem a senha.

        const { acao } = req.body || {};

        // =================================================
        // REMOVER UM JOGADOR E REGISTRAR BANIMENTO
        // =================================================

        if (acao === "remover_jogador") {

            // Recebe o ID do jogador escolhido no painel.
            const jogadorId = Number(req.body?.jogador_id);

            // Não permite IDs inválidos.
            if (
                !Number.isSafeInteger(jogadorId) ||
                jogadorId <= 0
            ) {
                return res.status(400).json({
                    sucesso: false,
                    erro: "Jogador inválido."
                });
            }

            // Confere se o jogador realmente existe.
            const existente = await sql`
                SELECT id, nome
                FROM jogadores
                WHERE id = ${jogadorId}
                LIMIT 1
            `;

            if (!existente.length) {
                return res.status(404).json({
                    sucesso: false,
                    erro: "Jogador não encontrado."
                });
            }

            // Registra o banimento antes de excluir o jogador.
            // O nome normalizado impede recadastro com o mesmo nome.
            // O token_hash permitirá bloquear o mesmo navegador
            // quando a identificação secreta estiver ativa.
            await sql`
                INSERT INTO jogadores_banidos (
                    nome_normalizado,
                    token_hash
                )
                SELECT
                    LOWER(TRIM(nome)),
                    token_hash
                FROM jogadores
                WHERE id = ${jogadorId}
                ON CONFLICT (nome_normalizado)
                DO UPDATE SET
                    token_hash = EXCLUDED.token_hash,
                    banido_em = NOW()
            `;

            // Apaga somente as respostas desse jogador.
            // As respostas dos demais são preservadas.
            await sql`
                DELETE FROM respostas
                WHERE jogador_id = ${jogadorId}
            `;

            // Remove somente o cadastro selecionado.
            // A pontuação desse jogador também é removida.
            const removidos = await sql`
                DELETE FROM jogadores
                WHERE id = ${jogadorId}
                RETURNING id, nome
            `;

            if (!removidos.length) {
                return res.status(404).json({
                    sucesso: false,
                    erro: "Jogador já foi removido."
                });
            }

            // =================================================
            // VERIFICAR SE OS JOGADORES RESTANTES RESPONDERAM
            // =================================================
            // Exemplo:
            // 10 jogadores cadastrados, 9 responderam.
            // O décimo desistiu e foi removido.
            //
            // Agora restam 9 jogadores e 9 respostas.
            // Portanto, a pergunta pode ser encerrada
            // sem esperar os 60 segundos terminarem.
            //
            // Se ninguém estiver cadastrado, a pergunta
            // não será encerrada por esta verificação.

            await sql`
                UPDATE jogo AS j
                SET
                    pergunta_ativa = FALSE,
                    tempo_restante = 0
                WHERE j.id = (
                    SELECT id
                    FROM jogo
                    ORDER BY id DESC
                    LIMIT 1
                )
                AND j.pergunta_ativa = TRUE

                AND (
                    SELECT COUNT(*)
                    FROM jogadores
                ) > 0

                AND (
                    SELECT COUNT(DISTINCT jogador_id)
                    FROM respostas
                    WHERE pergunta_id = j.pergunta_id
                ) >= (
                    SELECT COUNT(*)
                    FROM jogadores
                )
            `;

            // Informa ao painel qual jogador foi removido.
            return res.status(200).json({
                sucesso: true,
                jogador_removido: removidos[0],
                mensagem:
                    "Jogador " +
                    removidos[0].nome +
                    " removido com sucesso."
            });
        }

        // =================================================
        // INICIAR NOVA PARTIDA
        // =================================================

        if (acao === "iniciar") {

            // Uma nova partida libera os jogadores banidos
            // na partida anterior.
            await sql`
                DELETE FROM jogadores_banidos
            `;

            // Limpa as respostas da partida anterior.
            await sql`
                DELETE FROM respostas
            `;

            // Limpa o histórico das perguntas utilizadas.
            // Não apaga as perguntas cadastradas no Neon.
            await sql`
                DELETE FROM perguntas_utilizadas
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

            // Não permite perguntas após a finalização.
            if (estado.encerrado) {
                return res.status(400).json({
                    sucesso: false,
                    erro: "A partida foi encerrada."
                });
            }

            // Aguarda os 60 segundos, caso a pergunta
            // ainda esteja ativa.
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
            // SELECIONAR PERGUNTA NÃO UTILIZADA
            // =================================================

            // Escolhe uma pergunta aleatória.
            // Não permite repetir perguntas da partida.
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

            // Finaliza quando não há mais perguntas.
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
                    mensagem:
                        "Todas as perguntas disponíveis foram utilizadas."
                });
            }

            const p = resultado[0];

            // Calcula o número da próxima pergunta.
            const numero =
                Number(estado.numero_pergunta || 0) + 1;

            // =================================================
            // ATUALIZAR RODADA E REGISTRAR PERGUNTA
            // =================================================

            // Atualiza o jogo e registra a pergunta
            // utilizada dentro do mesmo comando SQL.
            //
            // Isso impede repetir a pergunta, mesmo
            // quando ninguém responder.

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

            // Evita comandos duplicados na mesma rodada.
            if (!atualizacao.length) {
                return res.status(409).json({
                    sucesso: false,
                    erro:
                        "O jogo foi atualizado. Tente novamente."
                });
            }

            // Define os pontos por dificuldade.
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

            // Finaliza a partida, mas mantém
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
                mensagem:
                    "Partida finalizada. Ranking liberado."
            });
        }

        // =================================================
        // ENCERRAR PARTIDA E LIMPAR JOGADORES
        // =================================================

        if (acao === "encerrar") {

            // Apaga todas as respostas dos jogadores.
            await sql`
                DELETE FROM respostas
            `;

            // Remove todos os jogadores cadastrados.
            await sql`
                DELETE FROM jogadores
            `;

            // Reinicia o estado do jogo.
            // Preserva as perguntas cadastradas.
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
                mensagem:
                    "Partida encerrada e jogadores removidos."
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
