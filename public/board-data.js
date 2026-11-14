// Dados do tabuleiro, compartilhados entre servidor (Node) e navegador.
(function (root) {
  const GROUPS = {
    norte:      { name: 'Norte',        color: '#8d5524', house: 50 },
    amazonia:   { name: 'Amazônia',     color: '#4fb3e8', house: 50 },
    meionorte:  { name: 'Meio-Norte',   color: '#d6449b', house: 100 },
    nordeste:   { name: 'Nordeste',     color: '#f08a24', house: 100 },
    litoral:    { name: 'Litoral',      color: '#e23b3b', house: 150 },
    centro:     { name: 'Centro-Oeste', color: '#e8c51c', house: 150 },
    sul:        { name: 'Sul',          color: '#2fa84f', house: 200 },
    sudeste:    { name: 'Sudeste',      color: '#2856c9', house: 200 },
  };

  const city = (name, group, price, rent) => ({ type: 'city', name, group, price, rent });
  const airport = (name) => ({ type: 'airport', name, price: 200 });
  const utility = (name) => ({ type: 'utility', name, price: 150 });

  // rent = [terreno, 1 casa, 2 casas, 3 casas, 4 casas, hotel]
  const SQUARES = [
    { type: 'start', name: 'Início' },
    city('Rio Branco', 'norte', 60, [2, 10, 30, 90, 160, 250]),
    { type: 'chance', name: 'Sorte ou Revés' },
    city('Porto Velho', 'norte', 60, [4, 20, 60, 180, 320, 450]),
    { type: 'tax', name: 'Imposto de Renda', amount: 200 },
    airport('Aeroporto de Manaus'),
    city('Macapá', 'amazonia', 100, [6, 30, 90, 270, 400, 550]),
    { type: 'chance', name: 'Sorte ou Revés' },
    city('Belém', 'amazonia', 100, [6, 30, 90, 270, 400, 550]),
    city('Manaus', 'amazonia', 120, [8, 40, 100, 300, 450, 600]),
    { type: 'jail', name: 'Prisão' },
    city('Teresina', 'meionorte', 140, [10, 50, 150, 450, 625, 750]),
    utility('Cia. de Energia'),
    city('São Luís', 'meionorte', 140, [10, 50, 150, 450, 625, 750]),
    city('Fortaleza', 'meionorte', 160, [12, 60, 180, 500, 700, 900]),
    airport('Aeroporto do Recife'),
    city('Natal', 'nordeste', 180, [14, 70, 200, 550, 750, 950]),
    { type: 'chance', name: 'Sorte ou Revés' },
    city('João Pessoa', 'nordeste', 180, [14, 70, 200, 550, 750, 950]),
    city('Recife', 'nordeste', 200, [16, 80, 220, 600, 800, 1000]),
    { type: 'travel', name: 'Viagem' },
    city('Aracaju', 'litoral', 220, [18, 90, 250, 700, 875, 1050]),
    { type: 'chance', name: 'Sorte ou Revés' },
    city('Maceió', 'litoral', 220, [18, 90, 250, 700, 875, 1050]),
    city('Salvador', 'litoral', 240, [20, 100, 300, 750, 925, 1100]),
    airport('Aeroporto de Brasília'),
    city('Cuiabá', 'centro', 260, [22, 110, 330, 800, 975, 1150]),
    city('Campo Grande', 'centro', 260, [22, 110, 330, 800, 975, 1150]),
    utility('Cia. de Saneamento'),
    city('Goiânia', 'centro', 280, [24, 120, 360, 850, 1025, 1200]),
    { type: 'gotojail', name: 'Vá para a Prisão' },
    city('Porto Alegre', 'sul', 300, [26, 130, 390, 900, 1100, 1275]),
    city('Florianópolis', 'sul', 300, [26, 130, 390, 900, 1100, 1275]),
    { type: 'chance', name: 'Sorte ou Revés' },
    city('Curitiba', 'sul', 320, [28, 150, 450, 1000, 1200, 1400]),
    airport('Aeroporto de Guarulhos'),
    { type: 'copa', name: 'Copa do Mundo' },
    city('Rio de Janeiro', 'sudeste', 350, [35, 175, 500, 1100, 1300, 1500]),
    { type: 'tax', name: 'Taxa de Luxo', amount: 100 },
    city('São Paulo', 'sudeste', 400, [50, 200, 600, 1400, 1700, 2000]),
  ];

  const RULES = {
    START_MONEY: 1500, SALARY: 200, JAIL_FINE: 50, TRAVEL_COST: 100,
    MAX_PLAYERS: 6, MIN_PLAYERS: 2,
  };

  const LEVEL_NAMES = ['Terreno', '1 casa', '2 casas', '3 casas', '4 casas', 'Hotel'];

  const data = { GROUPS, SQUARES, RULES, LEVEL_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.BOARD = data;
})(this);
