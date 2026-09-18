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
