import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
    try {
        const sql = neon(process.env.DATABASE_URL);

        // CADASTRAR JOGADOR
        if (req.method === "POST") {

            const { nome } = req.body;

            if (!nome || !nome.trim()) {
                return res.status(400).json({
                    sucesso: false,
                    erro: "Digite seu nome."
                });
            }

            const nomeLimpo = nome.trim();

            const existente = await sql`
                SELECT id, nome, pontuacao
                FROM jogadores
                WHERE LOWER(nome) = LOWER(${nomeLimpo})
                LIMIT 1
            `;

            if (existente.length > 0) {
                return res.status(200).json({
                    sucesso: true,
                    jogador: existente[0]
                });
            }

            const jogador = await sql`
                INSERT INTO jogadores (nome, pontuacao)
                VALUES (${nomeLimpo}, 0)
                RETURNING id, nome, pontuacao
            `;

            return res.status(200).json({
                sucesso: true,
                jogador: jogador[0]
            });
        }

        // LISTAR JOGADORES
        if (req.method === "GET") {

            const jogadores = await sql`
                SELECT id, nome, pontuacao
                FROM jogadores
                ORDER BY pontuacao DESC, nome ASC
            `;

            return res.status(200).json({
                sucesso: true,
                jogadores
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
