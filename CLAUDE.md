# Cantinho da Dê

Site estático (guia do hóspede) de um espaço de temporada com área de encontros:
**Condomínio Kalyandra · Rua do Jockey · Jockey Club · Brasília/DF**, casa 13. Três arquivos: `index.html`, `styles.css`, `app.js`.
Sem build, sem dependências — é só abrir o `index.html`.

## Operação da hospedagem

Informações que valem para redigir mensagens a hóspedes e para o conteúdo do guia.

### Horários padrão

| | |
|---|---|
| Check-in | **14h** |
| Check-out | **11h** |
| Intervalo mínimo entre hóspedes | **3h** para a faxina |

Quando um check-out é estendido, o check-in seguinte é o novo horário de saída + 3h
(ex.: saída flexibilizada às 16h → entrada a partir das 19h).

### Chegada / portaria

O condomínio é residencial. Orientar o hóspede a informar na portaria que vai para a
**casa 13**, como convidado, sem mencionar Airbnb ou hospedagem.

### Comandos da área da piscina

- **Hidro**: botão **nº 2**
- **Luzes**: botão com o **ícone de luz**; para **desligar**, apertar e segurar

### Reservas

Pré-aprovação enviada pelo anfitrião precisa ser **confirmada pelo hóspede dentro do
prazo**, senão expira sozinha e a data volta a ficar em aberto. Ao reenviar uma
pré-aprovação, lembrar o hóspede de confirmar pelo app.

### Preços e formatos (out/2026)

A Airbnb desconta **18,2%** do bruto (verificado na reserva da Brenda: 1.074 + 207 de
limpeza − 233,31 de taxa = 1.047,69). Todo valor combinado com hóspede é **bruto**;
para receber X líquido, cobre `X ÷ 0,818`.

Fechado:

| Formato | Cobrar | Recebe |
|---|---|---|
| Day use evento — sábado/feriado, 20+ pessoas (ref.: Mayara, 21/11) | **R$ 1.850** | ~R$ 1.513 |

Proposto, ainda sem decisão do Kauan:

| Formato | Cobrar | Recebe |
|---|---|---|
| Day use padrão (até 15 pessoas, 10h–20h) | R$ 1.600 | ~R$ 1.309 |
| Workshop corporativo, dia útil | R$ 1.700 | ~R$ 1.391 |
| Meio período (4h) | R$ 950 | ~R$ 777 |
| Hora extra | R$ 200/h | ~R$ 164 |

Pernoite segue o preço do anúncio (~R$ 1.050 bruto a diária, até 6 pessoas).
Piso para qualquer day use: R$ 1.400 bruto.

Na **Oferta Especial**, a taxa de limpeza NÃO é somada automaticamente — o valor
digitado é o total. Caução não existe mais no Airbnb: dano se resolve pelo AirCover,
com pedido em até 14 dias e fotos de antes e depois.

### Capacidade

- **Pernoite: 6 pessoas** (limite de camas)
- **Uso diurno: 30 pessoas** (day use, confraternização)

### Visitantes de hóspedes em pernoite (proposto, ainda não publicado nas regras)

Para fechar a brecha de reservar diária para 2 e receber 15 visitas:
até 4 visitantes sem custo (avisados antes, cadastrados na portaria, saída até 22h);
5 a 9 visitantes a R$ 100/pessoa/dia; 10 ou mais, ou qualquer evento, aplica-se o
pacote confraternização de R$ 900 sobre a diária, com autorização prévia.
A trava real é a portaria: toda visita precisa de autorização prévia.

### Som e música ao vivo

Caixa portátil (tipo JBL) ou som ambiente da casa em volume moderado, até as 22h.
Proibido som automotivo e caixas de alta potência.

Música ao vivo é permitida no **formato acústico**: voz, violão, cajón, teclado ou
sanfona, com caixa portátil em volume ambiente.

O Kauan é **músico** e tem indicações de instrumentistas de confiança — oferecer isso
sempre que o hóspede mencionar cantor ou música ao vivo. É diferencial de venda:
resolve um problema que o hóspede ainda tem e posiciona a casa acima de um
espaço que só se aluga.

## Publicação

O guia está no ar pelo **Netlify**: <https://cantinho-da-de.netlify.app/>
É esse o link que se manda para os hóspedes.

O deploy sai da branch `main` — mudanças em branch de trabalho só aparecem no site
depois do merge. O GitHub Pages está desativado e não é usado.

Atenção: a página é pública e expõe a senha do Wi-Fi e o celular da anfitriã.

## Conteúdo do guia

Seções (acordeão): 01 Wi-Fi · 02 Quartos · 03 Piscina, Sinuca & Encontros ·
04 Rede Suspensa · 05 Cozinha · 06 Regras · 07 Emergência · 08 Arredores · 09 Check-out.

O **Frigobar de Honra** (tabela de preços + chave Pix) foi **removido temporariamente**
em set/2026, junto com o item correspondente no checklist de check-out. O CSS
(`.frig-*`, `.pix-*`) e o handler de copiar no `app.js` continuam no projeto para quando
a seção voltar.

## Estilo das mensagens a hóspedes

Português do Brasil, tom caloroso e direto, emojis com moderação, horários e valores
sempre explícitos (nunca "mais tarde" ou "flexibilizo" sem dizer o horário).
