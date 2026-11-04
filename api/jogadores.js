
import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";

// =====================================================
// DESAFIO BÍBLICO - CADASTRO DE JOGADORES
// =====================================================
// GET: lista os jogadores e suas pontuações.
// POST: cadastra novos jogadores.
//
// PROTEÇÕES:
// - Impede nomes duplicados.
// - Impede o recadastro de nomes banidos.
// - Identifica jogadores por um token secreto.
// - Bloqueia tokens de jogadores banidos.
// - Não revela os tokens na lista pública.
// =====================================================

// Normaliza os nomes para comparação.
function normalizarNome(nome) {
    return nome
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

// Cria uma identificação criptográfica do token.
// O banco guarda apenas o hash, nunca o token original.
function calcularHash(token) {
    return createHash("sha256")
        .update(token, "utf8")
        .digest("hex");
}

export default async function handler(req, res) {

    // Impede o navegador de reutilizar dados antigos.
    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );

    // Aceita somente os métodos necessários.
    if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({
            sucesso: false,
            erro: "Método não permitido."
        });
    }

    try {
        // Conecta ao banco Neon.
        const sql = neon(process.env.DATABASE_URL);

        // =================================================
        // GET - LISTAR JOGADORES
        // =================================================

        if (req.method === "GET") {

            // Não retorna a identificação secreta.
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

        // =================================================
        // IDENTIFICAÇÃO SECRETA DO JOGADOR
        // =================================================

        // O navegador enviará um token aleatório.
        // Durante a atualização dos arquivos, o token
        // permanece opcional para não interromper
        // os jogadores que usam a versão anterior.
        const tokenRecebido = req.body?.token;

        let tokenHash = null;

        if (
            tokenRecebido !== undefined &&
            tokenRecebido !== null
        ) {

            // Aceita tokens de 64 caracteres hexadecimais.
            if (
                typeof tokenRecebido !== "string" ||
                !/^[a-f0-9]{64}$/i.test(tokenRecebido)
            ) {
                return res.status(400).json({
                    sucesso: false,
                    erro: "Identificação do jogador inválida."
                });
            }

            // Guarda somente o hash do token.
            tokenHash = calcularHash(tokenRecebido);
        }

        // =================================================
        // VERIFICAR BANIMENTO
        // =================================================

        const nomeNormalizado =
            normalizarNome(nomeLimpo);

        // Verifica se o nome ou o token está banido.
        const banidos = await sql`
            SELECT nome_normalizado
            FROM jogadores_banidos
            WHERE
                nome_normalizado = ${nomeNormalizado}
                OR (
                    ${tokenHash}::text IS NOT NULL
                    AND token_hash = ${tokenHash}
                )
            LIMIT 1
        `;

        if (banidos.length > 0) {
            return res.status(403).json({
                sucesso: false,
                banido: true,
                erro:
                    "🚫 Você foi banido do Desafio Bíblico. " +
                    "Sua participação foi encerrada " +
                    "pelo administrador."
            });
        }

        // =================================================
        // IMPEDIR NOMES DUPLICADOS
        // =================================================

        // Ignora diferenças entre letras maiúsculas
        // e minúsculas.
        const existente = await sql`
            SELECT id
            FROM jogadores
            WHERE LOWER(TRIM(nome)) = ${nomeNormalizado}
            LIMIT 1
        `;

        if (existente.length > 0) {

            // Nunca entrega o ID do jogador existente.
            return res.status(409).json({
                sucesso: false,
                erro:
                    "Este nome já está em uso. " +
                    "Digite outro nome para participar."
            });
        }

        // =================================================
        // IMPEDIR TOKEN DUPLICADO
        // =================================================

        if (tokenHash !== null) {

            const tokenExistente = await sql`
                SELECT id
                FROM jogadores
                WHERE token_hash = ${tokenHash}
                LIMIT 1
            `;

            if (tokenExistente.length > 0) {
                return res.status(409).json({
                    sucesso: false,
                    erro:
                        "Este navegador já possui um " +
                        "jogador cadastrado."
                });
            }
        }

        // =================================================
        // CADASTRAR NOVO JOGADOR
        // =================================================

        // O banco verifica novamente o nome e o banimento
        // antes de inserir, reduzindo conflitos entre
        // cadastros simultâneos.
        const resultado = await sql`
            INSERT INTO jogadores (
                nome,
                pontuacao,
                token_hash
            )

            SELECT
                ${nomeLimpo},
                0,
                ${tokenHash}

            WHERE NOT EXISTS (
                SELECT 1
                FROM jogadores
                WHERE LOWER(TRIM(nome)) =
                      ${nomeNormalizado}
            )

            AND NOT EXISTS (
                SELECT 1
                FROM jogadores_banidos
                WHERE
                    nome_normalizado =
                        ${nomeNormalizado}
                    OR (
                        ${tokenHash}::text IS NOT NULL
                        AND token_hash = ${tokenHash}
                    )
            )

            AND (
                ${tokenHash}::text IS NULL
                OR NOT EXISTS (
                    SELECT 1
                    FROM jogadores
                    WHERE token_hash = ${tokenHash}
                )
            )

            RETURNING id, nome, pontuacao
        `;

        // Se outro cadastro ocorreu ao mesmo tempo,
        // não permite criar um registro duplicado.
        if (!resultado.length) {
            return res.status(409).json({
                sucesso: false,
                erro:
                    "Não foi possível concluir o cadastro. " +
                    "Verifique se o nome já está em uso " +
                    "ou se o jogador foi removido."
            });
        }

        // =================================================
        // CADASTRO CONCLUÍDO
        // =================================================

        // Devolve somente os dados públicos do jogador.
        // O token secreto não aparece nesta resposta.
        return res.status(200).json({
            sucesso: true,
            jogador: resultado[0]
        });

    } catch (erro) {

        // Registra o erro para diagnóstico no servidor.
        console.error(
            "Erro em /api/jogadores:",
            erro
        );

        // Impede revelar detalhes internos do banco.
        return res.status(500).json({
            sucesso: false,
            erro: "Erro interno no cadastro de jogadores."
        });
    }
}
