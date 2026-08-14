export default function handler(req, res) {
    return res.status(200).json({
        sucesso: true,
        mensagem: "API do Desafio Bíblico funcionando!"
    });
}
