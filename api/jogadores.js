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

        const { nome } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({
                sucesso: false,
                erro: "Digite seu nome."
            });
        }

        const nomeLimpo = nome.trim();

        // Verifica se o nome já está cadastrado
        const existente = await sql`
            SELECT id, nome
            FROM jogadores
            WHERE LOWER(nome) = LOWER(${nomeLimpo})
            LIMIT 1
        `;

        if (existente.length > 0) {
            return res.status(200).json({
                sucesso: true,
                jogador: existente[0],
                mensagem: "Jogador já cadastrado."
            });
        }

        // Cadastra o novo jogador
        const jogador = await sql`
            INSERT INTO jogadores (nome)
            VALUES (${nomeLimpo})
            RETURNING id, nome
        `;

        return res.status(200).json({
            sucesso: true,
            jogador: jogador[0]
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            sucesso: false,
            erro: erro.message
        });
    }
}
