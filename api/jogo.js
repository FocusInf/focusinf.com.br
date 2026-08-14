import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
    try {
        const sql = neon(process.env.DATABASE_URL);

        const resultado = await sql`
            SELECT current_database() AS banco, current_schema() AS schema
        `;

        return res.status(200).json({
            sucesso: true,
            conexao: resultado
        });

    } catch (erro) {
        return res.status(500).json({
            sucesso: false,
            erro: erro.message
        });
    }
}
