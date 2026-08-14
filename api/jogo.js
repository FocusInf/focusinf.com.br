import { sql } from "@vercel/postgres";

export default async function handler(req, res) {
  try {
    const resultado = await sql`
      SELECT NOW() AS data
    `;

    return res.status(200).json({
      sucesso: true,
      mensagem: "API do Desafio Bíblico funcionando!",
      banco: "Neon conectado",
      data: resultado.rows[0].data
    });

  } catch (erro) {

    console.error(erro);

    return res.status(500).json({
      sucesso: false,
      mensagem: "Erro ao conectar com o banco de dados."
    });
  }
}
