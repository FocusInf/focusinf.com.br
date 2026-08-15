import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

    try {

        const sql = neon(process.env.DATABASE_URL);

        // =====================================================
        // SOMENTE POST
        // =====================================================

        if (req.method !== "POST") {

            return res.status(405).json({
                sucesso: false,
                erro: "Método não permitido."
            });

        }

        // =====================================================
        // DADOS RECEBIDOS
        // =====================================================

        const {
            jogador_id,
            pergunta_id,
            resposta
        } = req.body;


        if (
            !jogador_id ||
            !pergunta_id ||
            !resposta
        ) {

            return res.status(400).json({
                sucesso: false,
                erro: "Dados incompletos."
            });

        }


        const alternativa =
            String(resposta)
            .toUpperCase();


        if (
            !["A", "B", "C", "D"]
            .includes(alternativa)
        ) {

            return res.status(400).json({
                sucesso: false,
                erro: "Alternativa inválida."
            });

        }


        // =====================================================
        // VERIFICA A PARTIDA
        // =====================================================

        const jogo = await sql`
            SELECT *
            FROM jogo
            ORDER BY id DESC
            LIMIT 1
        `;


        if (!jogo.length) {

            return res.status(400).json({
                sucesso: false,
                erro: "Jogo não encontrado."
            });

        }


        // =====================================================
        // VERIFICA SE A PERGUNTA ESTÁ ATIVA
        // =====================================================

        if (!jogo[0].pergunta_ativa) {

            return res.status(400).json({
                sucesso: false,
                erro: "Não há pergunta ativa."
            });

        }


        // =====================================================
        // CONFERE A PERGUNTA
        // =====================================================

        if (
            Number(jogo[0].pergunta_id) !==
            Number(pergunta_id)
        ) {

            return res.status(400).json({
                sucesso: false,
                erro: "Esta não é a pergunta atual."
            });

        }


        // =====================================================
        // VERIFICA O TEMPO
        // =====================================================

        if (!jogo[0].tempo_inicio) {

            return res.status(400).json({
                sucesso: false,
                erro: "Cronômetro não iniciado."
            });

        }


        const inicio =
            new Date(
                jogo[0].tempo_inicio
            );


        const agora =
            new Date();


        const segundos =
            Math.floor(
                (agora - inicio) / 1000
            );


        if (segundos >= 60) {

            return res.status(400).json({
                sucesso: false,
                erro: "Tempo encerrado."
            });

        }


        // =====================================================
        // VERIFICA JOGADOR
        // =====================================================

        const jogador = await sql`
            SELECT
                id,
                nome
            FROM jogadores
            WHERE id = ${jogador_id}
            LIMIT 1
        `;


        if (!jogador.length) {

            return res.status(404).json({
                sucesso: false,
                erro: "Jogador não encontrado."
            });

        }


        // =====================================================
        // VERIFICA SE JÁ RESPONDEU
        // =====================================================

        const jaRespondeu = await sql`
            SELECT id
            FROM respostas
            WHERE jogador_id = ${jogador_id}
              AND pergunta_id = ${pergunta_id}
            LIMIT 1
        `;


        if (jaRespondeu.length) {

            return res.status(409).json({
                sucesso: false,
                erro: "Você já respondeu esta pergunta."
            });

        }


        // =====================================================
        // BUSCA A PERGUNTA
        // =====================================================

        const pergunta = await sql`
            SELECT
                resposta_correta,
                dificuldade
            FROM perguntas
            WHERE id = ${pergunta_id}
            LIMIT 1
        `;


        if (!pergunta.length) {

            return res.status(404).json({
                sucesso: false,
                erro: "Pergunta não encontrada."
            });

        }


        // =====================================================
        // CALCULA OS PONTOS
        // =====================================================

        let pontos = 10;


        if (
            pergunta[0].dificuldade ===
            "facil"
        ) {

            pontos = 10;

        }


        if (
            pergunta[0].dificuldade ===
            "medio"
        ) {

            pontos = 20;

        }


        if (
            pergunta[0].dificuldade ===
            "dificil"
        ) {

            pontos = 30;

        }


        if (
            pergunta[0].dificuldade ===
            "desafio"
        ) {

            pontos = 40;

        }


        // =====================================================
        // CONFERE RESPOSTA
        // =====================================================

        const correta =
            alternativa ===
            String(
                pergunta[0].resposta_correta
            ).toUpperCase();


        const pontosGanhos =
            correta
            ? pontos
            : 0;


        // =====================================================
        // SALVA A RESPOSTA
        // =====================================================

        await sql`
            INSERT INTO respostas (
                jogador_id,
                pergunta_id,
                resposta,
                correta,
                pontos
            )
            VALUES (
                ${jogador_id},
                ${pergunta_id},
                ${alternativa},
                ${correta},
                ${pontosGanhos}
            )
        `;


        // =====================================================
        // ATUALIZA PONTUAÇÃO
        // =====================================================

        if (pontosGanhos > 0) {

            await sql`
                UPDATE jogadores
                SET pontuacao =
                    pontuacao + ${pontosGanhos}
                WHERE id = ${jogador_id}
            `;

        }


        // =====================================================
        // IMPORTANTE
        //
        // NÃO ENCERRA A PERGUNTA AQUI.
        //
        // Mesmo que todos os jogadores respondam,
        // a pergunta continua ativa.
        //
        // Quem encerra é SOMENTE o administrador
        // através do botão "Encerrar pergunta".
        // =====================================================


        return res.status(200).json({

            sucesso: true,

            correta: correta,

            pontos: pontosGanhos

        });


    } catch (erro) {

        console.error(erro);

        return res.status(500).json({

            sucesso: false,

            erro: erro.message

        });

    }

}
