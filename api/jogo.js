import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
    try {
        const sql = neon(process.env.DATABASE_URL);

        const banco = await sql`
            SELECT
                current_database() AS banco,
                current_schema() AS schema,
                current_user AS usuario
        `;

        const tabelas = await sql`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        `;

        return res.status(200).json({
            sucesso: true,
            conexao: banco,
            tabelas: tabelas
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            sucesso: false,
            erro: erro.message
        });
    }
}
