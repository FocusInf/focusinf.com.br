import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
    try {
        const sql = neon(process.env.DATABASE_URL);

        const perguntas = await sql`
            SELECT *
            FROM perguntas
            ORDER BY id
        `;

        return res.status(200).json({
            sucesso: true,
            banco: "Neon conectado",
            perguntas: perguntas
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            sucesso: false,
            mensagem: "Erro ao buscar perguntas",
            erro: erro.message
        });
    }
}
