import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

    try {

        const sql = neon(process.env.DATABASE_URL);


        // =====================================================
        // GET - CONTAR RESPOSTAS DA PERGUNTA
        // =====================================================

        if (req.method === "GET") {

            const pergunta_id =
                Number(req.query.pergunta_id);

            if (!pergunta_id) {

                return res.status(400).json({
                    sucesso: false,
                    erro: "Pergunta não informada."
                });

            }


            // TOTAL DE JOGADORES

            const totalJogadores = await sql`
                SELECT COUNT(*)::integer AS total
                FROM jogadores
            `;


            // TOTAL DE RESPOSTAS

            const totalRespostas = await sql`
                SELECT COUNT(*)::integer AS total
                FROM respostas
                WHERE pergunta_id = ${pergunta_id}
            `;


            return res.status(200).json({

                sucesso: true,

                totalJogadores:
                    totalJogadores[0].total,

                totalRespostas:
                    totalRespostas[0].total

            });

        }


        // =====================================================
        // POST - RESPONDER
        // =====================================================

        if (req.method !== "POST") {

            return res.status(405).json({
                sucesso: false,
                erro: "Método não permitido."
            });

        }


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
            String(resposta).toUpperCase();


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
        // VERIFICAR JOGO
        // =====================================================

        const jogo = await sql`
            SELECT *
            FROM jogo
            ORDER BY id DESC
            LIMIT 1
        `;


        if (
            !jogo.length ||
            !jogo[0].pergunta_ativa
        ) {

            return res.status(400).json({
                sucesso: false,
                erro: "Não há pergunta ativa."
            });

        }


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
        // VERIFICAR TEMPO
        // =====================================================

        const inicio =
            new Date(jogo[0].tempo_inicio);

        const agora =
            new Date();

        const segundos =
            Math.floor(
                (agora - inicio) / 1000
            );


        if(segundos >= 60){

            await sql`
                UPDATE jogo
                SET
                    pergunta_ativa = FALSE,
                    tempo_restante = 0
            `;

            return res.status(400).json({
                sucesso: false,
                erro: "Tempo encerrado."
            });

        }


        // =====================================================
        // VERIFICAR JOGADOR
        // =====================================================

        const jogador = await sql`
            SELECT id, nome
            FROM jogadores
            WHERE id = ${jogador_id}
            LIMIT 1
        `;


        if(!jogador.length){

            return res.status(404).json({
                sucesso: false,
                erro: "Jogador não encontrado."
            });

        }


        // =====================================================
        // VERIFICAR SE JÁ RESPONDEU
        // =====================================================

        const jaRespondeu = await sql`
            SELECT id
            FROM respostas
            WHERE jogador_id = ${jogador_id}
              AND pergunta_id = ${pergunta_id}
            LIMIT 1
        `;


        if(jaRespondeu.length){

            return res.status(409).json({
                sucesso: false,
                erro: "Você já respondeu esta pergunta."
            });

        }


        // =====================================================
        // BUSCAR PERGUNTA
        // =====================================================

        const pergunta = await sql`
            SELECT
                resposta_correta,
                dificuldade
            FROM perguntas
            WHERE id = ${pergunta_id}
            LIMIT 1
        `;


        if(!pergunta.length){

            return res.status(404).json({
                sucesso: false,
                erro: "Pergunta não encontrada."
            });

        }


        // =====================================================
        // CALCULAR PONTOS
        // =====================================================

        let pontos = 10;


        if(
            pergunta[0].dificuldade === "facil"
        ){
            pontos = 10;
        }


        if(
            pergunta[0].dificuldade === "medio"
        ){
            pontos = 20;
        }


        if(
            pergunta[0].dificuldade === "dificil"
        ){
            pontos = 30;
        }


        if(
            pergunta[0].dificuldade === "desafio"
        ){
            pontos = 40;
        }


        const correta =
            alternativa ===
            pergunta[0].resposta_correta;


        const pontosGanhos =
            correta
            ?
            pontos
            :
            0;


        // =====================================================
        // REGISTRAR RESPOSTA
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
        // ATUALIZAR PONTUAÇÃO
        // =====================================================

        if(pontosGanhos > 0){

            await sql`
                UPDATE jogadores
                SET
                    pontuacao =
                    pontuacao +
                    ${pontosGanhos}
                WHERE id = ${jogador_id}
            `;

        }


        // =====================================================
        // CONTAR JOGADORES
        // =====================================================

        const totalJogadores = await sql`
            SELECT COUNT(*)::integer AS total
            FROM jogadores
        `;


        // =====================================================
        // CONTAR RESPOSTAS
        // =====================================================

        const totalRespostas = await sql`
            SELECT COUNT(*)::integer AS total
            FROM respostas
            WHERE pergunta_id = ${pergunta_id}
        `;


        const jogadores =
            totalJogadores[0].total;

        const respostas =
            totalRespostas[0].total;


        // =====================================================
        // TODOS RESPONDERAM
        // =====================================================

        if(
            jogadores > 0 &&
            respostas >= jogadores
        ){

            await sql`
                UPDATE jogo
                SET
                    pergunta_ativa = FALSE,
                    tempo_restante = 0
            `;

        }


        return res.status(200).json({

            sucesso: true,

            correta,

            pontos: pontosGanhos,

            totalJogadores: jogadores,

            totalRespostas: respostas

        });


    } catch(erro){

        console.error(erro);

        return res.status(500).json({

            sucesso: false,

            erro: erro.message

        });

    }

}
