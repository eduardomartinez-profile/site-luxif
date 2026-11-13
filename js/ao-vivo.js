(function () {
	const FAIXAS = ["1 kΩ", "10 kΩ", "100 kΩ", "470 kΩ"];
	const BARRAS = 40;

	const campoEndereco = document.getElementById("endereco");
	const campoLocal = document.getElementById("campo-local");
	const avisoHttps = document.getElementById("aviso-https");
	const opcoesModo = document.querySelectorAll('input[name="modo"]');
	const estado = document.getElementById("estado");
	const botaoDesconectar = document.getElementById("botao-desconectar");
	const historico = document.getElementById("historico");
	const registro = document.getElementById("registro");

	let leituras = [];

	function escrever(id, texto) {
		document.getElementById(id).textContent = texto;
	}

	function descreverLuz(lux) {
		if (lux < 1) return "Escuridão quase total";
		if (lux < 20) return "Penumbra";
		if (lux < 150) return "Luz de ambiente de casa";
		if (lux < 600) return "Escritório ou sala de aula";
		if (lux < 2000) return "Ambiente muito claro";
		return "Luz do dia";
	}

	// Altura da barra em escala logarítmica: 1 lux fica embaixo, 2000 lux no topo
	function alturaDaBarra(lux) {
		const altura = Math.log10(Math.max(lux, 1)) / Math.log10(2000) * 100;
		return Math.min(100, Math.max(2, altura));
	}

	function desenharHistorico() {
		const ultimas = leituras.slice(-BARRAS);
		historico.innerHTML = "";

		for (let i = 0; i < BARRAS - ultimas.length; i++) {
			historico.appendChild(document.createElement("span"));
		}

		ultimas.forEach(function (lux, i) {
			const barra = document.createElement("span");
			barra.style.height = alturaDaBarra(lux) + "%";
			barra.title = luxif.formatarLux(lux) + " lx";
			if (i === ultimas.length - 1) barra.className = "atual";
			historico.appendChild(barra);
		});
	}

	function limpar() {
		leituras = [];
		["valor-lux", "valor-faixa", "valor-minimo", "valor-maximo", "valor-media"].forEach(function (id) {
			escrever(id, "—");
		});
		escrever("nivel-luz", "Aguardando leituras.");
		desenharHistorico();
	}

	function anotar(texto) {
		const linhas = registro.textContent.split("\n").filter(Boolean);
		linhas.push("[" + new Date().toLocaleTimeString("pt-BR") + "] " + texto);
		registro.textContent = linhas.slice(-50).join("\n");
		registro.scrollTop = registro.scrollHeight;
	}

	luxif.aoMudarEstado = function () {
		estado.dataset.estado = luxif.estado;
		estado.textContent = luxif.mensagem;
		botaoDesconectar.disabled = luxif.estado === "desconectado";
	};

	luxif.aoReceberLeitura = function (leitura) {
		leituras.push(leitura.lux);

		let soma = 0;
		leituras.forEach(function (lux) { soma += lux; });

		escrever("valor-lux", luxif.formatarLux(leitura.lux));
		escrever("nivel-luz", descreverLuz(leitura.lux));
		escrever("valor-faixa", FAIXAS[leitura.faixa] || "—");
		escrever("valor-minimo", luxif.formatarLux(Math.min(...leituras)) + " lx");
		escrever("valor-maximo", luxif.formatarLux(Math.max(...leituras)) + " lx");
		escrever("valor-media", luxif.formatarLux(soma / leituras.length) + " lx");

		desenharHistorico();
	};

	luxif.aoReceberMensagem = function (texto) {
		anotar("recebido: " + texto);
	};

	function modoEscolhido() {
		return document.querySelector('input[name="modo"]:checked').value;
	}

	function mostrarCampos() {
		const local = modoEscolhido() === "local";
		campoLocal.hidden = !local;
		avisoHttps.hidden = !(local && location.protocol === "https:");
	}

	opcoesModo.forEach(function (opcao) {
		opcao.addEventListener("change", mostrarCampos);
	});

	document.getElementById("formulario-conexao").addEventListener("submit", function (evento) {
		evento.preventDefault();

		if (modoEscolhido() === "internet") {
			limpar();
			luxif.conectarInternet();
			return;
		}

		if (campoEndereco.value.trim() === "") {
			campoEndereco.focus();
			return;
		}
		limpar();
		campoEndereco.value = luxif.conectarLocal(campoEndereco.value);
	});

	document.getElementById("botao-simular").addEventListener("click", function () {
		limpar();
		luxif.simular();
	});

	botaoDesconectar.addEventListener("click", luxif.desconectar);

	document.getElementById("formulario-teste").addEventListener("submit", function (evento) {
		evento.preventDefault();
		const campo = document.getElementById("mensagem");
		if (campo.value === "") return;

		if (luxif.enviar(campo.value)) {
			anotar("enviado: " + campo.value);
			campo.value = "";
		} else {
			anotar("não enviado: conecte-se ao LUXIF primeiro");
		}
	});

	campoEndereco.value = luxif.enderecoSalvo() || "";
	if (luxif.modo() === "local") {
		document.querySelector('input[name="modo"][value="local"]').checked = true;
	}
	mostrarCampos();
	luxif.aoMudarEstado();
	desenharHistorico();
})();
