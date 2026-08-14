import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
    try {
        const sql = neon(process.env.DATABASE_URL);

        const perguntas = await sql`
            SELECT
                id,
                pergunta,
                alternativa_a,
                alternativa_b,
                alternativa_c,
                alternativa_d,
                resposta_correta,
                dificuldade,
                referencia,
                versiculo
            FROM perguntas
            ORDER BY id
        `;

        return res.status(200).json({
            sucesso: true,
            perguntas: perguntas
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            sucesso: false,
            erro: erro.message
        });
    }
}
