# Magnata Brasil 🇧🇷🎲

Jogo de tabuleiro online no estilo *Business Tour*, com as capitais do Brasil. De 2 a 6 jogadores, direto no navegador (computador ou celular).

## Como jogar no seu computador

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo.

```bash
npm install
npm start
```

Abra `http://localhost:3000`. Para testar sozinho, abra várias abas (ou uma janela anônima): cada aba é um jogador.

## Como colocar online (grátis, no Render)

1. Crie uma conta no [GitHub](https://github.com) e suba esta pasta como um repositório (botão **Add file → Upload files** funciona, só não envie a pasta `node_modules`).
2. Crie uma conta no [Render](https://render.com) e clique em **New → Web Service**.
3. Conecte o repositório e configure:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Clique em **Create Web Service**. Em uns 2 minutos você recebe um link tipo `https://magnata-brasil.onrender.com`.
5. Abra o link, crie uma sala e use **Copiar link de convite** para mandar aos amigos.

> No plano grátis do Render o servidor "dorme" depois de 15 min sem uso; o primeiro acesso demora uns 30–60 s para acordar. Salas ficam na memória, então reiniciar o servidor encerra as partidas em andamento.

Alternativas que também funcionam: Railway, Fly.io ou qualquer VPS (é só rodar `npm start`; a porta vem da variável `PORT`).

## Regras

- Todos começam com **R$ 1.500**. Passar pelo Início dá **R$ 200**.
- **Cidades** (22, em 8 regiões): compre ao parar nela. Quando parar numa cidade sua, pode construir de 1 a 4 casas de uma vez; o **hotel** vem depois das 4 casas.
- Terreno sem construção paga **aluguel em dobro** se o dono tiver a região inteira.
- **Compra forçada:** depois de pagar aluguel numa cidade adversária, você pode tomá-la pagando **2× o valor investido** ao dono. Cidade com hotel não pode ser tomada.
- **Aeroportos** (4): R$ 25 / 50 / 100 / 200 conforme quantos o dono tiver. **Companhias** (2): 4× ou 10× o valor dos dados.
- **Copa do Mundo:** escolha uma cidade sua para sediar; o aluguel dela dobra (só uma cidade por vez no tabuleiro).
- **Viagem:** pague R$ 100 e vá para qualquer casa do tabuleiro.
- **Dados iguais** = joga de novo. Três duplas seguidas = Prisão.
- **Prisão:** tente tirar dupla (até 3 vezes), pague R$ 50 ou use o habeas corpus.
- **Dívida:** se o dinheiro ficar negativo, venda propriedades ao banco (metade do valor investido) ou declare falência. O último que sobrar vence.
- Cada decisão tem **60 segundos**. Se o tempo acabar, o jogo decide sozinho. Quem cai da internet volta à mesma partida ao abrir o link de novo; enquanto está fora, o jogo joga por ele.

## Estrutura

```
server.js            servidor (Express + Socket.io), salas e conexões
game.js              todas as regras (o servidor é a autoridade: ninguém trapaceia pelo navegador)
public/board-data.js casas, preços e aluguéis (mude aqui para balancear o jogo)
public/index.html    telas
public/style.css     visual
public/client.js     tabuleiro, animações e botões
tools/bots.js        teste automático: 6 bots jogam uma partida inteira
```

Para rodar o teste de bots: `npm start` num terminal e, em outro, `npm i --no-save socket.io-client && node tools/bots.js`.
