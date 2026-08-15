import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {

    try {

        const sql = neon(process.env.DATABASE_URL);

        const ranking = await sql`
            SELECT
                id,
                nome,
                pontuacao
            FROM jogadores
            ORDER BY
                pontuacao DESC,
                nome ASC
        `;

        return res.status(200).json({

            sucesso: true,

            ranking
        });

    } catch (erro) {

        console.error(erro);

        return res.status(500).json({

            sucesso: false,

            erro: erro.message
        });
    }
}
