import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
    try {
        const sql = neon(process.env.DATABASE_URL);

        const resultado = await sql`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        `;

        return res.status(200).json({
            sucesso: true,
            mensagem: "API do Desafio Bíblico funcionando!",
            banco: "Neon conectado",
            tabelas: resultado
        });

    } catch (erro) {
        console.error(erro);

        return res.status(500).json({
            sucesso: false,
            mensagem: "Erro ao conectar ao banco Neon",
            erro: erro.message
        });
    }
}
