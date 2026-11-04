
import { neon } from "@neondatabase/serverless";

// =====================================================
// DESAFIO BÍBLICO - CADASTRO DE JOGADORES
// =====================================================
// GET: lista os jogadores e suas pontuações.
// POST: cadastra um novo jogador.
//
// IMPORTANTE:
// Nunca devolvemos o ID de outro jogador apenas
// porque o nome informado é igual.
// =====================================================

export default async function handler(req, res) {

    // Impede o navegador de reutilizar listas antigas.
    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );

    try {
        const sql = neon(process.env.DATABASE_URL);

        // =================================================
        // GET - LISTAR JOGADORES
        // =================================================

        if (req.method === "GET") {

            const jogadores = await sql`
                SELECT id, nome, pontuacao
                FROM jogadores
                ORDER BY pontuacao DESC, nome ASC, id ASC
            `;

            return res.status(200).json({
                sucesso: true,
                jogadores
            });
        }

        // =================================================
        // POST - CADASTRAR JOGADOR
        // =================================================

        if (req.method === "POST") {

            // Recebe o nome enviado pelo celular.
            const nome = req.body?.nome;

            if (typeof nome !== "string") {
                return res.status(400).json({
                    sucesso: false,
                    erro: "Digite seu nome."
                });
            }

            // Retira espaços extras.
            const nomeLimpo = nome
                .trim()
                .replace(/\s+/g, " ");

            // Impede nomes vazios.
            if (!nomeLimpo) {
                return res.status(400).json({
                    sucesso: false,
                    erro: "Digite seu nome."
                });
            }

            // Limita o tamanho do nome.
            if (nomeLimpo.length > 100) {
                return res.status(400).json({
                    sucesso: false,
                    erro: "O nome deve ter até 100 caracteres."
                });
            }

            // Verifica se o nome já está cadastrado.
            // Ignora diferenças entre maiúsculas e minúsculas.
            const existente = await sql`
                SELECT id
                FROM jogadores
                WHERE LOWER(TRIM(nome)) = LOWER(${nomeLimpo})
                LIMIT 1
            `;

            if (existente.length > 0) {

                // Não entrega o ID do jogador existente.
                return res.status(409).json({
                    sucesso: false,
                    erro:
                        "Este nome já está em uso. " +
                        "Digite outro nome para participar."
                });
            }

            // Cadastra somente se ainda não existir
            // jogador com o mesmo nome.
            const resultado = await sql`
                INSERT INTO jogadores (nome, pontuacao)
                SELECT ${nomeLimpo}, 0
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM jogadores
                    WHERE LOWER(TRIM(nome)) =
                          LOWER(${nomeLimpo})
                )
                RETURNING id, nome, pontuacao
            `;

            // Se outra inscrição chegou antes,
            // solicita um nome diferente.
            if (!resultado.length) {
                return res.status(409).json({
                    sucesso: false,
                    erro:
                        "Este nome acabou de ser cadastrado. " +
                        "Escolha outro nome."
                });
            }

            // Entrega o ID criado para este jogador.
            return res.status(200).json({
                sucesso: true,
                jogador: resultado[0]
            });
        }

        // =================================================
        // OUTROS MÉTODOS NÃO SÃO PERMITIDOS
        // =================================================

        return res.status(405).json({
            sucesso: false,
            erro: "Método não permitido."
        });

    } catch (erro) {

        console.error("Erro em /api/jogadores:", erro);

        return res.status(500).json({
            sucesso: false,
            erro: "Erro interno no cadastro de jogadores."
        });
    }
}
