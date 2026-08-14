import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
    try {
        const sql = neon(process.env.DATABASE_URL);

        if (req.method !== "POST") {
            return res.status(405).json({
                sucesso: false,
                erro: "Método não permitido"
            });
        }

        const {
            jogador_id,
            pergunta_id,
            resposta
        } = req.body;

        if (!jogador_id || !pergunta_id || !resposta) {
            return res.status(400).json({
                sucesso: false,
                erro: "Dados incompletos."
            });
        }

        const alternativa = String(resposta).toUpperCase();

        if (!["A", "B", "C", "D"].includes(alternativa)) {
            return res.status(400).json({
                sucesso: false,
                erro: "Alternativa inválida."
            });
        }

        // Verifica se o jogador existe
        const jogador = await sql`
            SELECT id, nome
            FROM jogadores
            WHERE id = ${jogador_id}
            LIMIT 1
        `;

        if (jogador.length === 0) {
            return res.status(404).json({
                sucesso: false,
                erro: "Jogador não encontrado."
            });
        }

        // Busca a pergunta
        const pergunta = await sql`
            SELECT
                id,
                resposta_correta,
                dificuldade
            FROM perguntas
            WHERE id = ${pergunta_id}
            LIMIT 1
        `;

        if (pergunta.length === 0) {
            return res.status(404).json({
                sucesso: false,
                erro: "Pergunta não encontrada."
            });
        }

        // Verifica se já respondeu
        const jaRespondeu = await sql`
            SELECT id
            FROM respostas
            WHERE jogador_id = ${jogador_id}
              AND pergunta_id = ${pergunta_id}
            LIMIT 1
        `;

        if (jaRespondeu.length > 0) {
            return res.status(409).json({
                sucesso: false,
                erro: "Você já respondeu esta pergunta."
            });
        }

        // Define a pontuação
        let pontos = 10;

        if (pergunta[0].dificuldade === "facil") {
            pontos = 10;
        } else if (pergunta[0].dificuldade === "medio") {
            pontos = 20;
        } else if (pergunta[0].dificuldade === "dificil") {
            pontos = 30;
        } else if (pergunta[0].dificuldade === "desafio") {
            pontos = 40;
        }

        const correta =
            alternativa === pergunta[0].resposta_correta;

        const pontosGanhos = correta ? pontos : 0;

        // Registra a resposta
        const resultado = await sql`
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
            RETURNING id
        `;

        return res.status(200).json({
            sucesso: true,
            correta: correta,
            pontos: pontosGanhos,
            resposta_id: resultado[0].id
        });

    } catch (erro) {

        console.error(erro);

        return res.status(500).json({
            sucesso: false,
            erro: erro.message
        });
    }
}
