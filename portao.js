const ENDPOINT_PORTAO = '/api/abrir-portao';
const ERRO_RESPOSTA_INVALIDA = 'resposta_invalida';
const ERRO_REDE = 'falha_na_rede';

export function lerTokenDoHash(hash) {
  if (typeof hash !== 'string') return null;

  const parametros = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = parametros.get('portao');
  return token && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

export function criarTrava(ms, agora = Date.now) {
  let liberaEm = -Infinity;
  return function tentar() {
    const instante = typeof agora === 'function' ? agora() : agora;
    if (instante < liberaEm) return false;
    liberaEm = instante + ms;
    return true;
  };
}

export function proximoEstado(estado, evento) {
  if (evento.tipo === 'toque') {
    if (estado.status === 'enviando' || evento.agora < estado.trava) return estado;
    return { status: 'enviando', trava: evento.agora + 10_000, erro: null };
  }

  if (evento.tipo === 'resposta' && estado.status === 'enviando') {
    return evento.ok
      ? { ...estado, status: 'aberto', erro: null }
      : { ...estado, status: 'erro', erro: evento.erro };
  }

  if (evento.tipo === 'tempo' && evento.agora >= estado.trava) {
    if (estado.status === 'aberto') return { status: 'parado', trava: 0, erro: null };
    if (estado.status === 'erro' && estado.trava !== 0) return { ...estado, trava: 0 };
  }
  return estado;
}

export async function pedirAbertura(token, fetchFn = globalThis.fetch) {
  try {
    const resposta = await fetchFn(ENDPOINT_PORTAO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (resposta.status === 429) {
      return { ok: false, erro: 'muitas_tentativas' };
    }
    let dados;
    try {
      dados = await resposta.json();
    } catch {
      return { ok: false, erro: ERRO_RESPOSTA_INVALIDA };
    }

    if (dados?.success === true) return { ok: true };
    if (dados?.success === false && typeof dados.error === 'string') {
      return { ok: false, erro: dados.error };
    }
    return { ok: false, erro: ERRO_RESPOSTA_INVALIDA };
  } catch {
    return { ok: false, erro: ERRO_REDE };
  }
}

function iniciarInterfacePortao() {
  const bloco = document.querySelector('#portao');
  const botao = document.querySelector('#portao-abrir');
  const estado = document.querySelector('#portao-estado');
  if (!bloco || !botao || !estado) return;

  let token = null;
  let maquina = { status: 'parado', trava: 0, erro: null };
  let intervalo;
  let mensagemErro = '';

  function atualizarToken() {
    const novoToken = lerTokenDoHash(window.location.hash);
    if (!novoToken) {
      token = null;
      bloco.hidden = true;
      clearInterval(intervalo);
      return;
    }
    if (novoToken !== token) {
      token = novoToken;
      maquina = { status: 'parado', trava: 0, erro: null };
      mensagemErro = '';
      botao.setAttribute('aria-disabled', 'false');
      botao.textContent = 'Abrir portão';
      estado.textContent = '';
      clearInterval(intervalo);
    }
    bloco.hidden = false;
  }

  function mostrarFalha() {
    const cartaoAnfitria = [...document.querySelectorAll('.contact-card')]
      .find((cartao) => cartao.querySelector('.contact-role')?.textContent.trim() === 'Anfitriã');
    const telefone = cartaoAnfitria?.querySelector('a.contact-phone');
    estado.replaceChildren(document.createTextNode(`${mensagemErro} Fale com a anfitriã`));
    if (telefone) {
      const link = document.createElement('a');
      link.href = telefone.getAttribute('href');
      link.textContent = telefone.textContent;
      estado.append(document.createTextNode(': '), link);
    } else {
      estado.append(document.createTextNode('.'));
    }
  }

  function atualizarBotao(agora = Date.now()) {
    const restante = Math.max(0, Math.ceil((maquina.trava - agora) / 1000));
    if (maquina.status === 'enviando') {
      botao.setAttribute('aria-disabled', 'true');
      botao.textContent = 'Abrindo…';
      return;
    }
    if (maquina.status === 'aberto' && restante > 0) {
      botao.setAttribute('aria-disabled', 'true');
      botao.textContent = `Portão aberto · ${restante} s`;
      return;
    }
    if (restante > 0) {
      botao.setAttribute('aria-disabled', 'true');
      botao.textContent = `Aguarde ${restante} s`;
      return;
    }
    botao.setAttribute('aria-disabled', 'false');
    botao.textContent = 'Abrir portão';
  }

  function mostrarEstadoAnterior(novoStatus) {
    if (novoStatus === 'enviando') {
      estado.textContent = 'Enviando o comando para abrir o portão.';
    } else if (novoStatus === 'aberto') {
      estado.textContent = 'Portão aberto.';
    } else if (novoStatus === 'erro') {
      mostrarFalha();
    } else if (novoStatus === 'parado') {
      estado.textContent = 'Pronto para abrir novamente.';
    }
  }

  function iniciarContagem() {
    const atualizar = () => {
      const anterior = maquina.status;
      maquina = proximoEstado(maquina, { tipo: 'tempo', agora: Date.now() });
      if (maquina.status !== anterior) mostrarEstadoAnterior(maquina.status);
      atualizarBotao();
      if (maquina.status !== 'enviando' && maquina.trava === 0) clearInterval(intervalo);
    };
    clearInterval(intervalo);
    intervalo = setInterval(atualizar, 250);
    atualizar();
  }

  botao.addEventListener('click', async () => {
    const agora = Date.now();
    const anterior = maquina.status;
    maquina = proximoEstado(maquina, { tipo: 'toque', agora });
    if (maquina.status !== 'enviando' || anterior === 'enviando') return;
    mensagemErro = '';
    mostrarEstadoAnterior(maquina.status);
    atualizarBotao(agora);
    iniciarContagem();

    const resultado = await pedirAbertura(token);
    const statusAntesResposta = maquina.status;
    const erro = resultado.erro === 'fora_do_periodo'
      ? 'Este link só vale durante a estadia (check-in às 14h e check-out às 11h).'
      : resultado.erro === 'muitas_tentativas'
        ? 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.'
        : 'Não foi possível abrir o portão agora.';
    maquina = proximoEstado(maquina, {
      tipo: 'resposta',
      ok: resultado.ok,
      erro: resultado.ok ? null : resultado.erro,
    });
    if (maquina.status !== statusAntesResposta) {
      if (maquina.status === 'erro') mensagemErro = erro;
      mostrarEstadoAnterior(maquina.status);
    }
    atualizarBotao();
    iniciarContagem();
  });

  window.addEventListener('hashchange', atualizarToken);
  atualizarToken();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciarInterfacePortao, { once: true });
  } else {
    iniciarInterfacePortao();
  }
}
