import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
    try {
        const sql = neon(process.env.POSTGRES_URL);

        const resultado = await sql`
            SELECT NOW() AS data
        `;

        return res.status(200).json({
            sucesso: true,
            mensagem: "API do Desafio Bíblico funcionando!",
            banco: "Neon conectado",
            data: resultado[0].data
        });

    } catch (erro) {

        console.error("ERRO:", erro);

        return res.status(500).json({
            sucesso: false,
            mensagem: "Erro ao conectar com o banco de dados.",
            erro: erro.message
        });
    }
}
