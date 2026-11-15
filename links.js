const ENDPOINT_LINKS = '/api/links-do-portao';

export async function buscarLinks(senha, fetchFn = globalThis.fetch) {
  try {
    const resposta = await fetchFn(ENDPOINT_LINKS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha }),
    });
    if (resposta.status === 429) {
      return { ok: false, erro: 'muitas_tentativas' };
    }

    let dados;
    try {
      dados = await resposta.json();
    } catch {
      return { ok: false, erro: 'resposta_invalida' };
    }

    if (dados?.success === true && Array.isArray(dados.data?.reservas)) {
      const formatoValido = dados.data.reservas.every((reserva) => (
        typeof reserva?.entrada === 'string'
        && typeof reserva?.saida === 'string'
        && typeof reserva?.link === 'string'
        && ['reserva', 'bloqueio'].includes(reserva?.tipo)
      ));
      if (!formatoValido) return { ok: false, erro: 'resposta_invalida' };
      const reservas = [...dados.data.reservas].sort((a, b) => a.entrada.localeCompare(b.entrada));
      return { ok: true, reservas };
    }
    if (dados?.success === false && typeof dados.error === 'string') {
      return { ok: false, erro: dados.error };
    }
    return { ok: false, erro: 'resposta_invalida' };
  } catch {
    return { ok: false, erro: 'falha_na_rede' };
  }
}

export function formatarPeriodo(entrada, saida) {
  const diaDaSemana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const formatarData = (valor) => {
    const partes = typeof valor === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
    if (!partes) throw new RangeError('Data deve estar no formato AAAA-MM-DD.');
    const [, anoTexto, mesTexto, diaTexto] = partes;
    const ano = Number(anoTexto);
    const mes = Number(mesTexto);
    const dia = Number(diaTexto);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    if (
      ano < 1000
      || data.getUTCFullYear() !== ano
      || data.getUTCMonth() !== mes - 1
      || data.getUTCDate() !== dia
    ) {
      throw new RangeError('Data inválida.');
    }
    return `${diaDaSemana[data.getUTCDay()]}, ${diaTexto}/${mesTexto}`;
  };
  return `${formatarData(entrada)} → ${formatarData(saida)}`;
}

export function mensagemDeErro(codigo) {
  const mensagens = {
    senha_invalida: 'Senha incorreta.',
    muitas_tentativas: 'Muitas tentativas. Aguarde um minuto.',
    falha_no_calendario: 'Não consegui ler o calendário do Airbnb agora.',
    configuracao_ausente: 'A página ainda não foi configurada no Netlify.',
  };
  return mensagens[codigo] ?? 'Não foi possível carregar os links.';
}

function iniciarPaginaLinks() {
  const formulario = document.querySelector('#links-form');
  const campoSenha = document.querySelector('#links-senha');
  const botaoEnviar = document.querySelector('#links-enviar');
  const status = document.querySelector('#links-status');
  const lista = document.querySelector('#links-lista');
  if (!formulario || !campoSenha || !botaoEnviar || !status || !lista) return;

  let carregando = false;
  const temporizadoresCopia = new WeakMap();

  function criarItem(reserva) {
    const item = document.createElement('li');
    item.className = 'links-item';

    const periodo = document.createElement('h2');
    periodo.className = 'links-periodo';
    periodo.textContent = formatarPeriodo(reserva.entrada, reserva.saida);

    const horarios = document.createElement('p');
    horarios.className = 'links-horarios';
    horarios.textContent = 'Check-in às 14h · Check-out às 11h';

    const tipo = document.createElement('span');
    tipo.className = 'links-tipo';
    tipo.textContent = reserva.tipo === 'bloqueio' ? 'Bloqueio manual' : 'Reserva';

    const copiar = document.createElement('button');
    copiar.className = 'links-copy';
    copiar.type = 'button';
    copiar.textContent = 'Copiar link';
    copiar.addEventListener('click', async () => {
      if (copiar.getAttribute('aria-disabled') === 'true') return;
      copiar.setAttribute('aria-disabled', 'true');
      try {
        await navigator.clipboard.writeText(reserva.link);
        copiar.textContent = 'Copiado';
        status.textContent = 'Copiado';
        clearTimeout(temporizadoresCopia.get(copiar));
        temporizadoresCopia.set(copiar, setTimeout(() => {
          copiar.textContent = 'Copiar link';
          copiar.setAttribute('aria-disabled', 'false');
          status.textContent = '';
        }, 2000));
      } catch {
        copiar.setAttribute('aria-disabled', 'false');
        status.textContent = 'Não foi possível copiar o link.';
      }
    });

    item.append(periodo, horarios, tipo, copiar);
    return item;
  }

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (carregando) return;
    carregando = true;
    lista.replaceChildren();
    botaoEnviar.setAttribute('aria-disabled', 'true');
    botaoEnviar.textContent = 'Carregando…';
    status.textContent = 'Carregando links…';

    const resultado = await buscarLinks(campoSenha.value);
    campoSenha.value = '';
    carregando = false;
    botaoEnviar.setAttribute('aria-disabled', 'false');
    botaoEnviar.textContent = 'Ver links';

    if (!resultado.ok) {
      status.textContent = mensagemDeErro(resultado.erro);
      return;
    }
    if (resultado.reservas.length === 0) {
      status.textContent = 'Nenhuma reserva futura no calendário.';
      return;
    }

    lista.replaceChildren(...resultado.reservas.map(criarItem));
    status.textContent = 'Links carregados.';
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciarPaginaLinks, { once: true });
  } else {
    iniciarPaginaLinks();
  }
}
